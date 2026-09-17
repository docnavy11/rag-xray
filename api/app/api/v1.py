import asyncio
import datetime as dt
import hashlib
import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import runtime
from ..config import settings
from ..db import pool
from ..engine import retrieval
from ..engine.cite import verify
from ..engine.trace import LESSONS, Trace

router = APIRouter(prefix="/v1")


# ------------------------------------------------------------------ models --
class Turn(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    kb: str
    question: str
    lang: str | None = None
    as_of: dt.date | None = None
    history: list[Turn] = []
    config_overrides: dict = Field(default_factory=dict)


class SearchRequest(BaseModel):
    kb: str
    q: str
    lang: str | None = None
    as_of: dt.date | None = None
    config_overrides: dict = Field(default_factory=dict)


class CompareRequest(BaseModel):
    q: str
    kbs: list[str] = ["aiact", "aiact-naive"]
    lang: str | None = None


class EvalRequest(BaseModel):
    kb: str = "aiact"
    k: int = 8
    langs: list[str] | None = None
    config_overrides: dict = Field(default_factory=dict)


class CounterfactualRequest(BaseModel):
    kb: str
    q: str
    lang: str | None = None
    as_of: dt.date | None = None
    changes: dict = Field(default_factory=dict)
    baseline_overrides: dict = Field(default_factory=dict)


# ------------------------------------------------------------------- utils --
async def get_kb(slug: str) -> dict:
    p = await pool()
    async with p.acquire() as con:
        row = await con.fetchrow("SELECT * FROM kb WHERE slug=$1", slug)
    if row is None:
        raise HTTPException(404, f"no such knowledge base: {slug}")
    kb = dict(row)
    for k in ("retrieval_config", "sample_questions"):
        if isinstance(kb[k], str):
            kb[k] = json.loads(kb[k])
    return kb


def merged(kb: dict, overrides: dict) -> dict:
    """The KB's config with the X-ray's switches applied on top.

    One level of nesting is merged rather than replaced, so a client can send
    {"corpus_stopwords": {"enabled": false}} without having to restate the
    threshold it is not changing.
    """
    cfg = json.loads(json.dumps(kb["retrieval_config"]))
    for k, v in (overrides or {}).items():
        if isinstance(v, dict) and isinstance(cfg.get(k), dict):
            cfg[k].update(v)
        else:
            cfg[k] = v
    return cfg


def _ip_hash(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() or (request.client.host if request.client else "?")
    return hashlib.sha256(f"{settings.ask_ip_salt}|{ip}".encode()).hexdigest()[:32]


async def check_quota(ip_hash: str) -> None:
    """Per-caller limits, plus a spend cap across everyone.

    The budget is the one that matters: a rate limit keyed on the caller cannot
    see a thousand callers. Counterfactuals and search are not limited here -
    they never reach a model, which is exactly why they are free.
    """
    p = await pool()
    async with p.acquire() as con:
        hour, day = await con.fetchrow(
            "SELECT count(*) FILTER (WHERE asked_at > now() - interval '1 hour'),"
            "       count(*) FILTER (WHERE asked_at > now() - interval '1 day') "
            "FROM ask_log WHERE ip_hash=$1", ip_hash)
        spent = await con.fetchval(
            "SELECT coalesce(sum(cost_usd),0) FROM ask_log "
            "WHERE asked_at > now() - interval '1 day'")
    per_hour, per_day = runtime.get("ask_per_hour"), runtime.get("ask_per_day")
    if per_hour <= 0:
        raise HTTPException(503, "Answering is switched off in Settings. Retrieval, "
                                 "counterfactuals and evaluation still work.")
    if hour >= per_hour:
        raise HTTPException(429, f"{per_hour} questions an hour. "
                                 "Search and the X-ray switches are not limited.")
    if day >= per_day:
        raise HTTPException(429, f"{per_day} questions a day. "
                                 "Search and the X-ray switches are not limited.")
    if float(spent or 0) >= runtime.get("ask_daily_budget_usd"):
        raise HTTPException(503, "The daily spend cap has been reached. Raise it in Settings, or wait — retrieval, counterfactuals and evaluation are unaffected.")


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Gate for callers that are not the browser demo: n8n, Zapier, Make, or
    anything else hitting POST /v1/ask directly. A no-op when settings.api_key
    is unset, which is the local/dev default - set it before exposing this
    endpoint off localhost."""
    key = runtime.get("api_key")
    if key and x_api_key != key:
        raise HTTPException(401, "missing or invalid X-API-Key")


def shape(r: dict) -> dict:
    return {"path": r["path"], "kind": r["kind"], "heading": r.get("heading"),
            "body": r["body"], "lang": r["lang"], "source_id": r["source_id"],
            "valid_from": r["valid_from"], "valid_to": r.get("valid_to"),
            "url": r.get("source_url"), "meta": r.get("meta"),
            "score": r.get("score")}


def for_verify(rows: list[dict]) -> list[dict]:
    """cite.verify came from aiact-kb and speaks `celex`; here that is source_id."""
    return [{**r, "celex": r["source_id"]} for r in rows]


# ----------------------------------------------------------------- catalog --
@router.get("/kbs")
async def kbs():
    p = await pool()
    async with p.acquire() as con:
        rows = await con.fetch(
            """SELECT k.*, count(c.id) AS chunks,
                      count(DISTINCT c.lang) AS lang_count,
                      (SELECT count(*) FROM corpus_stopword s WHERE s.kb_id=k.id)
                        AS stopwords
               FROM kb k LEFT JOIN chunk c ON c.kb_id=k.id
               GROUP BY k.id ORDER BY k.sort_order""")
    out = []
    for r in rows:
        d = dict(r)
        for k in ("retrieval_config", "sample_questions"):
            if isinstance(d[k], str):
                d[k] = json.loads(d[k])
        d.pop("persona_prompt", None)
        out.append(d)
    return {"kbs": out}


@router.get("/lessons")
async def lessons():
    """Every claim the X-ray makes, with its provenance. Anything not in here is
    design rather than measurement, and the UI must label it as such."""
    return {"lessons": LESSONS}


@router.get("/chunk/{kb_slug}/{path:path}")
async def chunk(kb_slug: str, path: str, lang: str | None = None):
    kb = await get_kb(kb_slug)
    rows = await retrieval.by_paths(kb["id"], [path], lang=lang or kb["default_lang"],
                                    prefix=False, cfg=kb["retrieval_config"])
    if not rows:
        raise HTTPException(404, f"no such passage: {path}")
    return shape(rows[0])


# --------------------------------------------------------------- retrieval --
@router.post("/search")
async def search(req: SearchRequest):
    """Retrieval on its own, with the full trace. No model, no cost, no limit."""
    kb = await get_kb(req.kb)
    lang = req.lang or kb["default_lang"]
    cfg = merged(kb, req.config_overrides)
    tr = Trace(kb["slug"], req.q, lang, cfg)
    rows = await retrieval.retrieve(kb, req.q, lang=lang, cfg=cfg, trace=tr,
                                    as_of=req.as_of)
    return {"hits": [shape(r) for r in rows], "count": len(rows),
            "trace": tr.as_dict()}


@router.post("/counterfactual")
async def counterfactual(req: CounterfactualRequest):
    """Run retrieval twice - as configured, and with `changes` applied - and
    return the ranking diff.

    This is the demo's core move, and it is free: nothing here reaches a model,
    so a visitor can turn switches all afternoon.
    """
    kb = await get_kb(req.kb)
    lang = req.lang or kb["default_lang"]
    base_cfg = merged(kb, req.baseline_overrides)
    alt_cfg = merged(kb, {**req.baseline_overrides, **req.changes})

    # Warm the expansion ONCE, sequentially, before the two runs.
    #
    # Without this the two parallel runs both miss the cache and both call the
    # model, which made the screen say "no model called - $0.00" while taking
    # nine seconds and spending money. The claim is the point of this endpoint,
    # so it has to be true: after this await, both runs read the same cached
    # expansion, and `expansion` below reports honestly whether reaching that
    # state cost a call.
    expansion = "disabled"
    if base_cfg.get("expand") or alt_cfg.get("expand"):
        from ..engine.expand import expand_query
        expansion = (await expand_query(req.q, lang, kb)).get("source", "unknown")

    t_base = Trace(kb["slug"], req.q, lang, base_cfg)
    t_alt = Trace(kb["slug"], req.q, lang, alt_cfg)
    base, alt = await asyncio.gather(
        retrieval.retrieve(kb, req.q, lang=lang, cfg=base_cfg, trace=t_base,
                           as_of=req.as_of),
        retrieval.retrieve(kb, req.q, lang=lang, cfg=alt_cfg, trace=t_alt,
                           as_of=req.as_of))

    base_rank = {r["path"]: i + 1 for i, r in enumerate(base)}
    alt_rank = {r["path"]: i + 1 for i, r in enumerate(alt)}
    rows = []
    for r in alt:
        was = base_rank.get(r["path"])
        now = alt_rank[r["path"]]
        rows.append({"path": r["path"], "kind": r["kind"],
                     "heading": (r.get("heading") or "")[:120],
                     "was": was, "now": now,
                     "change": "entered" if was is None else was - now})
    dropped = [{"path": r["path"], "kind": r["kind"],
                "heading": (r.get("heading") or "")[:120],
                "was": base_rank[r["path"]], "now": None, "change": "dropped"}
               for r in base if r["path"] not in alt_rank]

    return {
        "changes": req.changes,
        "baseline": {"config": base_cfg, "order": [r["path"] for r in base],
                     "trace": t_base.as_dict()},
        "alternative": {"config": alt_cfg, "order": [r["path"] for r in alt],
                        "trace": t_alt.as_dict()},
        "diff": rows + dropped,
        "summary": {
            "entered": sum(1 for r in rows if r["was"] is None),
            "dropped": len(dropped),
            "moved": sum(1 for r in rows
                         if r["was"] is not None and r["was"] != r["now"]),
            "held": sum(1 for r in rows if r["was"] == r["now"]),
        },
        # A comparison is free once the expansion for this question is cached.
        # The first one on a brand-new question pays for a single cheap call.
        "expansion": expansion,
        "free": expansion in ("cache", "disabled", "unavailable"),
        "ms": round(max(t_base.ms, t_alt.ms), 1),
    }


# --------------------------------------------------------------------- ask --
@router.post("/ask", dependencies=[Depends(require_api_key)])
async def ask(req: AskRequest, request: Request):
    """The chat, as one request/response - for callers that want an answer,
    not an event stream: n8n, Zapier, Make, or any plain HTTP client.

    Same pipeline, same citation verification, same trace persisted as
    /v1/ask/stream. Gated by X-API-Key when API_KEY is set (see config.py);
    open by default for local/dev use, same as every other endpoint here.
    """
    kb = await get_kb(req.kb)
    q = (req.question or "").strip()
    if not (3 <= len(q) <= 600):
        raise HTTPException(422, "A question is between 3 and 600 characters.")
    lang = req.lang or kb["default_lang"]
    cfg = merged(kb, req.config_overrides)
    ip_hash = _ip_hash(request)
    await check_quota(ip_hash)

    from ..chat.ask import run_ask
    hist = [h.model_dump() for h in req.history]
    try:
        payload = await run_ask(kb, q, lang=lang, cfg=cfg, as_of=req.as_of,
                                history=hist)
    except Exception as exc:  # the honest failure is "it did not answer"
        raise HTTPException(502, f"agent run failed: {str(exc)[:400]}")

    p = await pool()
    async with p.acquire() as con:
        await con.execute(
            "INSERT INTO ask_log (ip_hash,kb_slug,model,cost_usd) "
            "VALUES ($1,$2,$3,$4)",
            ip_hash, kb["slug"], runtime.get("answer_model"), payload["cost_usd"])
    return payload


@router.post("/ask/stream")
async def ask_stream(req: AskRequest, request: Request):
    """The chat, streamed: stage events as the pipeline runs, then the answer."""
    kb = await get_kb(req.kb)
    q = (req.question or "").strip()
    if not (3 <= len(q) <= 600):
        raise HTTPException(422, "A question is between 3 and 600 characters.")
    lang = req.lang or kb["default_lang"]
    cfg = merged(kb, req.config_overrides)
    ip_hash = _ip_hash(request)
    await check_quota(ip_hash)

    hist = [h.model_dump() for h in req.history][-4:]
    prev_q = next((h["content"] for h in reversed(hist)
                   if h["role"] == "user"), "")
    tr = Trace(kb["slug"], q, lang, cfg)

    async def events():
        from ..chat import agent

        def sse(obj) -> str:
            return f"data: {json.dumps(obj)}\n\n"

        yield sse({"type": "start", "trace_id": tr.id, "kb": kb["slug"],
                   "config": cfg})
        answer, chunks, searches = "", [], 0
        try:
            async for ev in agent.run(kb, q, cfg=cfg, trace=tr, lang=lang,
                                      as_of=req.as_of, history=hist,
                                      context=prev_q[:300]):
                if ev["type"] == "answer_done":
                    answer, chunks = ev["text"], ev["chunks"]
                    searches = ev["searches"]
                else:
                    yield sse(ev)
        except Exception as exc:  # the honest failure is "it did not answer"
            yield sse({"type": "error", "message": str(exc)[:400]})
            return

        st = tr.stage("verify", "Check every quote", "verify")
        cited, unverified = ([], [])
        if answer and cfg.get("verify_quotes", True):
            cited, unverified = verify(answer, for_verify(chunks))
        st.done(f"{len(cited)} verified · {len(unverified)} not found",
                cited=cited, unverified=unverified,
                enabled=bool(cfg.get("verify_quotes", True)))
        yield sse({"type": "stage", "stage": st.as_dict()})

        payload = {
            "type": "final", "trace_id": tr.id, "answer": answer or None,
            "refusal": None if answer else "empty_model_response",
            "cited": cited, "unverified_quotes": unverified,
            "searches": searches,
            "passages": [{"path": c["path"], "kind": c["kind"],
                          "heading": c.get("heading"), "url": c.get("source_url"),
                          "valid_from": c.get("valid_from")} for c in chunks],
            "cost_usd": tr.cost_usd, "ms": tr.ms,
            "model": runtime.get("answer_model"),
            "input_tokens": tr.input_tokens, "output_tokens": tr.output_tokens,
        }
        tr_dict = tr.as_dict()
        p = await pool()
        async with p.acquire() as con:
            await con.execute(
                """INSERT INTO trace (id,kb_id,lang,question,stages,answer,cost_usd)
                   VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
                   ON CONFLICT (id) DO NOTHING""",
                tr.id, kb["id"], lang, q, json.dumps(tr_dict["stages"]),
                json.dumps(payload), tr.cost_usd)
            await con.execute(
                "INSERT INTO ask_log (ip_hash,kb_slug,model,cost_usd) "
                "VALUES ($1,$2,$3,$4)",
                ip_hash, kb["slug"], runtime.get("answer_model"), tr.cost_usd)
        yield sse(payload)
        yield sse({"type": "trace", "trace": tr_dict})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@router.get("/trace/{trace_id}")
async def get_trace(trace_id: str):
    """A permalink. Somebody can send a colleague the exact run."""
    p = await pool()
    async with p.acquire() as con:
        row = await con.fetchrow(
            "SELECT t.*, k.slug AS kb_slug, k.name AS kb_name, k.accent "
            "FROM trace t JOIN kb k ON k.id=t.kb_id WHERE t.id=$1", trace_id)
    if row is None:
        raise HTTPException(404, "no such trace")
    d = dict(row)
    for k in ("stages", "answer"):
        if isinstance(d[k], str):
            d[k] = json.loads(d[k])
    d["created_at"] = str(d["created_at"])
    d.pop("kb_id", None)
    return d


@router.get("/stats")
async def stats():
    p = await pool()
    async with p.acquire() as con:
        rows = await con.fetch(
            """SELECT k.slug, k.name, count(c.id) AS chunks,
                      count(DISTINCT c.lang) AS langs,
                      sum(length(c.body)) AS chars
               FROM kb k LEFT JOIN chunk c ON c.kb_id=k.id
               GROUP BY k.id ORDER BY k.sort_order""")
        traces = await con.fetchval("SELECT count(*) FROM trace")
    return {"kbs": [dict(r) for r in rows], "traces": traces,
            "model": runtime.get("answer_model")}


@router.post("/eval")
async def run_eval(req: EvalRequest):
    """Measure recall@k over the golden set under a given configuration.

    Retrieval only, so it costs nothing beyond any uncached query expansions.
    The set is IN-SAMPLE - it was used to build this retriever - so what comes
    back is a development figure and the UI must not present it as a holdout.
    """
    from ..engine import evaluate
    kb = await get_kb(req.kb)
    cfg = merged(kb, req.config_overrides)
    out = await evaluate.run(kb, cfg, k=req.k, langs=req.langs)
    return {**out, "kb": kb["slug"], "config": cfg}


def _opens_mid_sentence(body: str) -> bool:
    """A chunk that begins lower-case, or on a closing bracket or conjunction,
    was cut out of the middle of something."""
    b = body.lstrip()
    if not b:
        return False
    first = b.split(" ", 1)[0].strip("(),;:")
    return b[0].islower() or first.lower() in {"and", "or", "but", "which", "that"}


@router.post("/compare")
async def compare(req: CompareRequest):
    """The same question against two corpora, side by side.

    Built for one comparison in particular: the AI Act chunked on its own legal
    structure against the identical English text cut into fixed windows. Same
    retriever, same query, same everything but where the cuts fall.

    Retrieval only - no model, no cost - so the difference you see is the
    chunking and nothing else.
    """
    out = []
    for slug in req.kbs[:3]:
        kb = await get_kb(slug)
        lang = req.lang or kb["default_lang"]
        cfg = kb["retrieval_config"]
        tr = Trace(slug, req.q, lang, cfg)
        rows = await retrieval.retrieve(kb, req.q, lang=lang, cfg=cfg, trace=tr)

        p = await pool()
        async with p.acquire() as con:
            stats = await con.fetchrow(
                """SELECT count(*) AS n, avg(length(body))::int AS avg_chars,
                          count(heading) AS with_heading
                   FROM chunk WHERE kb_id=$1 AND lang=$2""", kb["id"], lang)

        hits = [{
            "path": r["path"],
            "heading": r.get("heading"),
            "kind": r["kind"],
            "chars": len(r["body"]),
            "preview": r["body"][:340],
            "opens_mid_sentence": _opens_mid_sentence(r["body"]),
            "url": r.get("source_url"),
        } for r in rows[:8]]

        out.append({
            "kb": {"slug": kb["slug"], "name": kb["name"], "accent": kb["accent"],
                   "glyph": kb["glyph"], "chunker": kb["chunker"],
                   "teaches": kb["teaches"], "cite_strength": kb["cite_strength"]},
            "corpus": {"chunks": stats["n"], "avg_chars": stats["avg_chars"],
                       "with_heading": stats["with_heading"]},
            "hits": hits,
            "mid_sentence": sum(1 for h in hits if h["opens_mid_sentence"]),
            "citable": sum(1 for h in hits if h["heading"]),
            "trace": tr.as_dict(),
        })
    return {"q": req.q, "sides": out, "cost_usd": 0.0}
