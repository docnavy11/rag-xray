"""Retrieval, driven entirely by the KB's `retrieval_config`.

Every branch in here is a field in that JSON object, which is what makes the
X-ray screen's switches real: a counterfactual is this same function called with
one field changed. Nothing in this module reaches a model except `expand_query`,
which is why turning a switch and re-ranking costs nothing.
"""
import datetime as dt
import re

from ..db import REGCONFIG, pool

SELECT = """
  id, kb_id, source_id, version, lang, tier, kind, path, heading, body, meta,
  valid_from, valid_to, amended_by, mod_op, source_url
"""

PATH_RE = re.compile(
    r"\b(?:art(?:icle|ikel)?\.?\s*)(\d+)(?:\s*\(\s*(\d+[a-z]?)\s*\))?"
    r"|\b(?:annex|bijlage|annexe|anhang)\s*([IVXLC]+)(?:\s*[.,]?\s*(\d+))?",
    re.I)


def paths_in_query(q: str) -> list[str]:
    """A question that names a provision should return that provision."""
    out = []
    for m in PATH_RE.finditer(q):
        if m.group(1):
            out.append(f"art.{m.group(1)}.{m.group(2)}" if m.group(2)
                       else f"art.{m.group(1)}")
        elif m.group(3):
            r = m.group(3).upper()
            out.append(f"annex.{r}.{m.group(4)}" if m.group(4) else f"annex.{r}")
    return out


def _row(r) -> dict:
    d = dict(r)
    d["valid_from"] = str(d["valid_from"])
    d["valid_to"] = str(d["valid_to"]) if d.get("valid_to") else None
    return d


async def lexical(kb_id: int, q: str, *, lang: str, cfg: dict,
                  as_of: dt.date | None = None, limit: int = 12) -> list[dict]:
    """One lexical run.

    Three corrections live in this query, each from a measurement:

    1. `plainto_tsquery` ANDs every term, so a natural question matches nothing.
       Its normalised output is turned into an OR query - stemming and stopword
       removal kept, recall restored.
    2. `ts_rank_cd` normalisation 32|1 divides by document length, so a long
       article stops outranking the short paragraph that answers the question.
       Switchable, because seeing it off is the point.
    3. Corpus stopwords are stripped from the query. Postgres text search has no
       IDF; in a corpus entirely about one subject its own subject word ranks
       everything equally.
    """
    regconf = REGCONFIG.get(lang, "simple")
    norm = int(cfg.get("length_norm") or 0)
    stop = (cfg.get("corpus_stopwords") or {}).get("enabled", True)
    as_of = as_of or dt.date.today()

    # Parameters are numbered as they are appended. An unreferenced placeholder
    # is not merely untidy: Postgres cannot infer its type and rejects the whole
    # statement, so a KB with as_of_filter off must not bind a date at all.
    args: list = [q, kb_id, lang]
    as_of_clause = ""
    if cfg.get("as_of_filter"):
        args.append(as_of)
        n = len(args)
        as_of_clause = (f"AND valid_from <= ${n} "
                        f"AND (valid_to IS NULL OR valid_to > ${n})")
    args.append(limit)
    limit_n = len(args)

    # kind_weights multiply the score: recitals explain the law without imposing
    # anything, so on the AI Act they are damped rather than dropped.
    kw = cfg.get("kind_weights") or {}
    if kw:
        cases = " ".join(f"WHEN '{k}' THEN {float(v)}" for k, v in kw.items())
        weight = f"CASE kind {cases} ELSE 1.0 END"
    else:
        weight = "1.0"

    stop_filter = ("AND lex NOT IN (SELECT lexeme FROM corpus_stopword "
                   "WHERE kb_id=$2 AND lang=$3)") if stop else ""

    sql = f"""
        WITH f AS (
          SELECT * FROM chunk
          WHERE kb_id=$2 AND lang=$3 {as_of_clause}
        ), terms AS (
          SELECT btrim(unnest(string_to_array(
                   plainto_tsquery('{regconf}', $1)::text, ' & ')), '''') AS lex
        ), kept AS (
          SELECT lex FROM terms WHERE lex <> '' {stop_filter}
        ), qq AS (
          SELECT COALESCE(
            NULLIF(string_agg(lex, ' | '), ''),
            replace(plainto_tsquery('{regconf}', $1)::text, '&', '|')
          )::tsquery AS query FROM kept
        )
        SELECT {SELECT}, ts_rank_cd(ts, qq.query, {norm}) * {weight} AS score
        FROM f, qq
        WHERE qq.query <> ''::tsquery AND f.ts @@ qq.query
        ORDER BY score DESC, sort_key
        LIMIT ${limit_n}
    """
    p = await pool()
    async with p.acquire() as con:
        rows = await con.fetch(sql, *args)
    return [_row(r) for r in rows]


async def query_lexemes(kb_id: int, q: str, lang: str, cfg: dict) -> dict:
    """What the query became, and what was stripped from it - for the X-ray."""
    regconf = REGCONFIG.get(lang, "simple")
    p = await pool()
    async with p.acquire() as con:
        raw = await con.fetchval(
            f"SELECT plainto_tsquery('{regconf}', $1)::text", q) or ""
        lexemes = [t.strip().strip("'") for t in raw.split(" & ") if t.strip()]
        stripped = []
        if lexemes and (cfg.get("corpus_stopwords") or {}).get("enabled", True):
            rows = await con.fetch(
                "SELECT lexeme, df FROM corpus_stopword "
                "WHERE kb_id=$1 AND lang=$2 AND lexeme = ANY($3::text[])",
                kb_id, lang, lexemes)
            stripped = [{"lexeme": r["lexeme"], "df": r["df"]} for r in rows]
        total = await con.fetchval(
            "SELECT count(*) FROM chunk WHERE kb_id=$1 AND lang=$2", kb_id, lang)
    dropped = {s["lexeme"] for s in stripped}
    return {
        "lexemes": lexemes,
        "kept": [x for x in lexemes if x not in dropped],
        "stripped": stripped,
        "corpus_size": total,
    }


async def vector(kb_id: int, q: str, *, lang: str, limit: int = 12) -> list[dict]:
    """Nearest neighbours by embedding. Returns [] when nothing is embedded."""
    from .embed import embed_one, available
    if not available():
        return []
    vec = embed_one(q)
    if vec is None:
        return []
    p = await pool()
    async with p.acquire() as con:
        rows = await con.fetch(
            f"""SELECT {SELECT}, 1 - (embedding <=> $1::vector) AS score
                FROM chunk
                WHERE kb_id=$2 AND lang=$3 AND embedding IS NOT NULL
                ORDER BY embedding <=> $1::vector
                LIMIT $4""",
            str(vec), kb_id, lang, limit)
    return [_row(r) for r in rows]


async def by_paths(kb_id: int, paths: list[str], *, lang: str,
                   as_of: dt.date | None = None, prefix: bool = True,
                   cfg: dict | None = None) -> list[dict]:
    """Exact lookup. With prefix=True, 'art.6' also returns art.6.1, art.6.2 ..."""
    if not paths:
        return []
    cfg = cfg or {}
    as_of = as_of or dt.date.today()
    # Numbered as appended - an unreferenced placeholder cannot be typed by
    # Postgres and fails the statement, so a KB without a date filter binds none.
    args: list = [paths, kb_id, lang]
    as_of_clause = ""
    if cfg.get("as_of_filter"):
        args.append(as_of)
        n = len(args)
        as_of_clause = (f"AND valid_from <= ${n} "
                        f"AND (valid_to IS NULL OR valid_to > ${n})")
    clause = "path = ANY($1::text[])"
    if prefix:
        args.append([f"{x}.%" for x in paths])
        clause += f" OR path LIKE ANY(${len(args)}::text[])"
    sql = f"""SELECT {SELECT} FROM chunk
              WHERE ({clause}) AND kb_id=$2 AND lang=$3 {as_of_clause}
              ORDER BY sort_key LIMIT 60"""
    p = await pool()
    async with p.acquire() as con:
        rows = await con.fetch(sql, *args)
    return [_row(r) for r in rows]


async def follow_links(kb_id: int, hits: list[dict], *, lang: str,
                       as_of: dt.date | None = None, cfg: dict | None = None,
                       limit: int = 6) -> list[dict]:
    """Follow the cross-references a hit makes (Art. 6(2) -> Annex III)."""
    if not hits:
        return []
    p = await pool()
    async with p.acquire() as con:
        rows = await con.fetch(
            "SELECT DISTINCT to_path FROM chunk_link "
            "WHERE kb_id=$1 AND from_path = ANY($2::text[]) AND kind='cites' LIMIT 40",
            kb_id, [h["path"] for h in hits])
    have = {h["path"] for h in hits}
    extra = [r["to_path"] for r in rows if r["to_path"] not in have]
    got = await by_paths(kb_id, extra[:12], lang=lang, as_of=as_of, cfg=cfg)
    return got[:limit]


def fuse(runs: list[dict], cfg: dict) -> tuple[list[dict], list[dict]]:
    """Combine the runs, and show your working.

    Returns (rows, breakdown). The breakdown is what the X-ray's fusion table
    renders: per-provision, the rank it held in each run and the score that
    produced. Concatenation is offered because seeing it lose is the lesson -
    it ranked the expansion model's GUESSES above measured hits.
    """
    k = int(cfg.get("rrf_k") or 60)
    mode = cfg.get("fusion") or "rrf"
    by_path: dict[str, dict] = {}
    ranks: dict[str, dict[str, int]] = {}

    for run in runs:
        for i, r in enumerate(run["rows"], start=1):
            by_path.setdefault(r["path"], r)
            ranks.setdefault(r["path"], {})[run["name"]] = i

    if mode == "concat":
        order, seen = [], set()
        for run in runs:
            for r in run["rows"]:
                if r["path"] not in seen:
                    seen.add(r["path"])
                    order.append(r["path"])
        scores = {p: None for p in order}
    else:
        scores = {p: sum(1.0 / (k + rank) for rank in rr.values())
                  for p, rr in ranks.items()}
        order = sorted(scores, key=lambda p: scores[p], reverse=True)

    breakdown = [{
        "path": p,
        "heading": (by_path[p].get("heading") or "")[:120],
        "kind": by_path[p]["kind"],
        "ranks": ranks.get(p, {}),
        "score": round(scores[p], 5) if scores.get(p) is not None else None,
    } for p in order]
    return [by_path[p] for p in order], breakdown


async def retrieve(kb: dict, q: str, *, lang: str, cfg: dict, trace=None,
                   as_of: dt.date | None = None, context: str = "",
                   expansion: dict | None = None) -> list[dict]:
    """What the chat tool calls. Every stage reports itself into the trace."""
    kb_id = kb["id"]
    limit = int(cfg.get("top_k") or 10)
    as_of = as_of or dt.date.today()

    # --- expand ---------------------------------------------------------
    ex = {"terms": [], "paths": [], "source": "disabled"}
    if expansion is not None:
        ex = expansion                      # already expanded for this turn
    elif cfg.get("expand"):
        st = trace.stage("expand", "Expand the question", "expand") if trace else None
        ex = await expand_for(q, lang, kb)
        if st:
            st.done(f"{len(ex['terms'])} terms · {ex['source']}",
                    terms=ex["terms"], guessed_paths=ex["paths"],
                    source=ex["source"], model_used=ex.get("source") == "model")

    # --- lexical / vector runs -------------------------------------------
    runs: list[dict] = []
    st = trace.stage("search", "Search the corpus", "search") if trace else None
    lex_info = await query_lexemes(kb_id, q, lang, cfg)
    mode = cfg.get("mode") or "lexical"

    if mode in ("lexical", "hybrid"):
        runs.append({"name": "A · as typed", "kind": "lexical",
                     "rows": await lexical(kb_id, q, lang=lang, cfg=cfg,
                                           as_of=as_of, limit=limit)})
        if ex.get("terms"):
            runs.append({"name": "B · corpus vocabulary", "kind": "lexical",
                         "rows": await lexical(kb_id, " ".join(ex["terms"]), lang=lang,
                                               cfg=cfg, as_of=as_of, limit=limit)})
        # A follow-up carries its subject in the turn before it. "what must we do
        # about that?" has no lexical content of its own; searching the previous
        # question together with this one recovers the subject, and it goes in as
        # another run rather than replacing the question, so a genuinely new
        # question asked mid-conversation is not dragged back to the old topic.
        if context and cfg.get("context_run"):
            runs.append({"name": "C · with prior turn", "kind": "lexical",
                         "rows": await lexical(kb_id, f"{context} {q}", lang=lang,
                                               cfg=cfg, as_of=as_of, limit=limit)})
    if mode in ("vector", "hybrid"):
        vrows = await vector(kb_id, q, lang=lang, limit=limit)
        if vrows:
            runs.append({"name": "V · embeddings", "kind": "vector", "rows": vrows})

    if st:
        st.done(
            f"{sum(len(r['rows']) for r in runs)} hits over {len(runs)} run(s)",
            mode=mode, query=lex_info,
            runs=[{"name": r["name"], "kind": r["kind"], "n": len(r["rows"]),
                   "top": [{"path": x["path"], "score": round(x.get("score") or 0, 5),
                            "heading": (x.get("heading") or "")[:100]}
                           for x in r["rows"][:8]]}
                  for r in runs])

    # --- fuse -------------------------------------------------------------
    st = trace.stage("fuse", "Fuse the rankings", "fuse") if trace else None
    fused, breakdown = fuse(runs, cfg)
    if st:
        st.done(f"{sum(len(r['rows']) for r in runs)}→{len(fused)} · {cfg.get('fusion')}",
                mode=cfg.get("fusion"), rrf_k=cfg.get("rrf_k"),
                run_names=[r["name"] for r in runs], table=breakdown[:12])

    # --- named paths, then guesses, then what they point at ---------------
    # Order matters more than it looks. A provision the question NAMES is
    # certain; a lexical hit is measured; a path the expansion model guessed is
    # neither. Ranking guesses above measurements cost 18 points of recall@8 when
    # it was measured the wrong way round.
    named = []
    if cfg.get("named_paths"):
        named = await by_paths(kb_id, paths_in_query(q), lang=lang, as_of=as_of, cfg=cfg)
    guessed = await by_paths(kb_id, ex.get("paths", []), lang=lang, as_of=as_of,
                             prefix=False, cfg=cfg) if ex.get("paths") else []

    seen, out = set(), []
    for r in named + fused + guessed:
        if r["path"] in seen:
            continue
        seen.add(r["path"])
        out.append(r)

    if cfg.get("structural_expansion"):
        st = trace.stage("links", "Follow cross-references") if trace else None
        extra = [r for r in await follow_links(kb_id, out[:5], lang=lang, as_of=as_of,
                                               cfg=cfg) if r["path"] not in seen]
        out += extra
        if st:
            st.done(f"+{len(extra)}", added=[e["path"] for e in extra])

    return out[: limit + 4]


async def expand_for(q: str, lang: str, kb: dict) -> dict:
    from .expand import expand_query
    return await expand_query(q, lang, kb)
