"""Running the thing: corpora, the document vault, jobs, settings, history.

Everything in here exists because a tool needs it and a demo does not. The
retrieval endpoints in v1.py answer questions; these let somebody own the corpus
the answers come out of - make one, put their own documents in it, re-cut it
under a different chunker, change the model, and find what they asked last week.
"""
import asyncio
import datetime as dt
import json
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import runtime, scheduler
from ..security import require_admin
from ..config import settings
from ..db import pool
from ..ingest import documents as docs
from ..kbs import DEFAULT_RETRIEVAL, KBS

# Every route in this module can change state or reveal configuration, so the
# gate goes on the router rather than on each handler - a new endpoint added
# here is protected by default instead of by remembering to protect it.
router = APIRouter(prefix="/v1", dependencies=[Depends(require_admin)])

BUILTIN = {k["slug"] for k in KBS}

GENERIC_PERSONA = """You answer questions from the documents in this collection.

Answer from the retrieved passages and nothing else. Lead with the answer in two \
to four plain sentences, then the specifics, each ending with the identifier of \
the passage it came from in square brackets.

GUILLEMETS ARE FOR COPIED TEXT ONLY. Put «...» around a span you have copied \
character for character out of a retrieved passage, and around nothing else. \
Your own summary and the user's phrasing repeated back are ordinary prose. Every \
«...» span is checked against the retrieved passages and anything not found is \
shown to the reader as unverified.

If the passages do not answer the question, say so plainly and say what would \
settle it. Never supply a fact, a number or a date from memory. When two \
documents disagree, show both rather than silently picking one.

Write in the language of the question. Be short."""

ACCENTS = [
    "oklch(0.42 0.070 195)", "oklch(0.42 0.070 65)", "oklch(0.42 0.070 330)",
    "oklch(0.42 0.070 150)", "oklch(0.42 0.070 265)", "oklch(0.42 0.070 25)",
    "oklch(0.42 0.070 110)", "oklch(0.42 0.070 300)",
]


def _json_fields(d: dict) -> dict:
    for k in ("retrieval_config", "sample_questions", "meta", "detail"):
        if k in d and isinstance(d[k], str):
            d[k] = json.loads(d[k])
    return d


async def _kb(con, slug: str) -> dict:
    row = await con.fetchrow("SELECT * FROM kb WHERE slug=$1", slug)
    if row is None:
        raise HTTPException(404, f"no such knowledge base: {slug}")
    return _json_fields(dict(row))


# ------------------------------------------------------------------ models --
class KBCreate(BaseModel):
    name: str
    slug: str | None = None
    tagline: str = ""
    accent: str | None = None
    glyph: str = "file"
    langs: list[str] = ["en"]
    default_lang: str = "en"
    chunker: str = "markdown_headings"
    persona_prompt: str | None = None
    sample_questions: list[str] = []
    retrieval_config: dict | None = None
    tools: list[str] = ["search_kb"]
    cite_strength: str = "exact"


class KBPatch(BaseModel):
    name: str | None = None
    tagline: str | None = None
    accent: str | None = None
    glyph: str | None = None
    langs: list[str] | None = None
    default_lang: str | None = None
    chunker: str | None = None
    persona_prompt: str | None = None
    sample_questions: list[str] | None = None
    retrieval_config: dict | None = None
    tools: list[str] | None = None
    cite_strength: str | None = None
    teaches: str | None = None
    sort_order: int | None = None


class TextDoc(BaseModel):
    title: str
    body: str
    lang: str | None = None
    url: str = ""


class SettingPut(BaseModel):
    key: str
    value: object


class ConversationCreate(BaseModel):
    kb: str
    title: str = ""


class MessagePair(BaseModel):
    question: str
    answer: str = ""
    trace_id: str | None = None
    meta: dict = Field(default_factory=dict)


def _slugify(name: str) -> str:
    import re
    s = re.sub(r"[^\w\s-]", "", name.lower()).strip()
    s = re.sub(r"[\s_]+", "-", s)[:40].strip("-")
    return s or f"kb-{uuid.uuid4().hex[:6]}"


# --------------------------------------------------------------- dashboard --
@router.get("/dashboard")
async def dashboard():
    """One request for the front page: what is in here, what it has been doing,
    and what it has cost."""
    p = await pool()
    async with p.acquire() as con:
        kbs = await con.fetch(
            """SELECT k.id, k.slug, k.name, k.accent, k.glyph, k.chunker, k.langs,
                      count(c.id) AS chunks,
                      coalesce(sum(length(c.body)),0) AS chars,
                      (SELECT count(*) FROM document d WHERE d.kb_id=k.id) AS documents,
                      (SELECT count(*) FROM document d WHERE d.kb_id=k.id
                                                       AND d.status='failed') AS failed,
                      (SELECT count(*) FROM corpus_stopword s WHERE s.kb_id=k.id) AS stopwords
               FROM kb k LEFT JOIN chunk c ON c.kb_id=k.id
               GROUP BY k.id ORDER BY k.sort_order, k.id""")
        spend = await con.fetchrow(
            """SELECT coalesce(sum(cost_usd) FILTER (WHERE asked_at > now() - interval '1 day'),0) AS day,
                      coalesce(sum(cost_usd) FILTER (WHERE asked_at > now() - interval '7 days'),0) AS week,
                      coalesce(sum(cost_usd),0) AS all_time,
                      count(*) FILTER (WHERE asked_at > now() - interval '1 day') AS asked_day,
                      count(*) AS asked_all
               FROM ask_log""")
        recent = await con.fetch(
            """SELECT t.id, t.question, t.lang, t.cost_usd, t.created_at, k.slug AS kb,
                      k.name AS kb_name, k.accent,
                      jsonb_array_length(coalesce(t.stages,'[]'::jsonb)) AS stages,
                      coalesce(jsonb_array_length(t.answer->'unverified_quotes'),0) AS unverified,
                      coalesce(jsonb_array_length(t.answer->'cited'),0) AS cited
               FROM trace t JOIN kb k ON k.id=t.kb_id
               ORDER BY t.created_at DESC LIMIT 8""")
        jobs = await con.fetch(
            """SELECT j.*, k.slug AS kb FROM ingest_job j LEFT JOIN kb k ON k.id=j.kb_id
               ORDER BY j.started_at DESC LIMIT 5""")
        srcs = await con.fetch(
            """SELECT s.id, s.name, s.kind, s.every_minutes, s.enabled, s.last_status,
                      s.last_run_at, s.next_run_at, s.last_error, k.slug AS kb
               FROM source s JOIN kb k ON k.id=s.kb_id
               ORDER BY s.next_run_at NULLS LAST LIMIT 10""")
        convs = await con.fetchval("SELECT count(*) FROM conversation")
        traces = await con.fetchval("SELECT count(*) FROM trace")

    return {
        "kbs": [dict(r) for r in kbs],
        "spend": dict(spend),
        "budget_usd": runtime.get("ask_daily_budget_usd"),
        "recent_traces": [dict(r) | {"created_at": str(r["created_at"])} for r in recent],
        "jobs": [_json_fields(dict(r)) | {"started_at": str(r["started_at"]),
                                          "finished_at": str(r["finished_at"] or "")}
                 for r in jobs],
        "sources": [dict(r) | {"last_run_at": str(r["last_run_at"] or ""),
                               "next_run_at": str(r["next_run_at"] or "")} for r in srcs],
        "scheduler": scheduler.status(),
        "counts": {"conversations": convs, "traces": traces},
        "model": runtime.get("answer_model"),
        "embeddings": bool(runtime.get("embed_enabled")),
        "api_key_set": bool(runtime.get("api_key")),
    }


# ------------------------------------------------------------------- corpora --
@router.post("/kbs")
async def create_kb(req: KBCreate):
    slug = _slugify(req.slug or req.name)
    if req.chunker not in docs.CHUNKERS:
        raise HTTPException(422, f"unknown chunker: {req.chunker}")
    p = await pool()
    async with p.acquire() as con:
        if await con.fetchval("SELECT 1 FROM kb WHERE slug=$1", slug):
            raise HTTPException(409, f"a corpus called {slug} already exists")
        n = await con.fetchval("SELECT count(*) FROM kb")
        cfg = {**DEFAULT_RETRIEVAL, **(req.retrieval_config or {})}
        row = await con.fetchrow(
            """INSERT INTO kb (slug,name,tagline,accent,glyph,langs,default_lang,
                               persona_prompt,chunker,retrieval_config,tools,
                               sample_questions,teaches,cite_strength,sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15)
               RETURNING *""",
            slug, req.name, req.tagline or "Your documents.",
            req.accent or ACCENTS[n % len(ACCENTS)], req.glyph, req.langs,
            req.default_lang, req.persona_prompt or GENERIC_PERSONA, req.chunker,
            json.dumps(cfg), req.tools, json.dumps(req.sample_questions), "",
            req.cite_strength, 100 + n)
    return _json_fields(dict(row))


@router.patch("/kbs/{slug}")
async def patch_kb(slug: str, req: KBPatch):
    fields = {k: v for k, v in req.model_dump(exclude_none=True).items()}
    if not fields:
        raise HTTPException(422, "nothing to change")
    if "chunker" in fields and fields["chunker"] not in docs.CHUNKERS:
        raise HTTPException(422, f"unknown chunker: {fields['chunker']}")
    sets, args = [], []
    for i, (k, v) in enumerate(fields.items(), start=2):
        if k in ("retrieval_config", "sample_questions"):
            sets.append(f"{k}=${i}::jsonb"); args.append(json.dumps(v))
        else:
            sets.append(f"{k}=${i}"); args.append(v)
    p = await pool()
    async with p.acquire() as con:
        row = await con.fetchrow(
            f"UPDATE kb SET {', '.join(sets)} WHERE slug=$1 RETURNING *", slug, *args)
    if row is None:
        raise HTTPException(404, f"no such knowledge base: {slug}")
    return _json_fields(dict(row)) | {
        "note": "A built-in corpus is re-seeded from kbs.py on restart, which will "
                "put these fields back." if slug in BUILTIN else None,
    }


@router.delete("/kbs/{slug}")
async def delete_kb(slug: str, confirm: str = ""):
    """Deleting a corpus deletes its chunks and its documents with it.

    `confirm` must repeat the slug: this is the one destructive button in the
    app and a mis-click should not be able to reach it.
    """
    if confirm != slug:
        raise HTTPException(422, "pass ?confirm=<slug> to delete a corpus")
    p = await pool()
    async with p.acquire() as con:
        row = await con.fetchrow(
            "SELECT id, (SELECT count(*) FROM chunk WHERE kb_id=kb.id) AS chunks "
            "FROM kb WHERE slug=$1", slug)
        if row is None:
            raise HTTPException(404, f"no such knowledge base: {slug}")
        await con.execute("DELETE FROM kb WHERE slug=$1", slug)
    return {"deleted": slug, "chunks_removed": row["chunks"],
            "note": "This is a built-in corpus and will reappear (empty) when the "
                    "server restarts, because kbs.py seeds it." if slug in BUILTIN else None}


@router.get("/kbs/{slug}/full")
async def kb_full(slug: str):
    """Everything about one corpus, including the persona prompt the catalogue
    endpoint deliberately withholds."""
    p = await pool()
    async with p.acquire() as con:
        kb = await _kb(con, slug)
        stats = await con.fetchrow(
            """SELECT count(*) AS chunks, coalesce(avg(length(body)),0)::int AS avg_chars,
                      count(DISTINCT lang) AS langs, count(heading) AS with_heading,
                      coalesce(sum(length(body)),0) AS chars
               FROM chunk WHERE kb_id=$1""", kb["id"])
        kinds = await con.fetch(
            "SELECT kind, count(*) AS n FROM chunk WHERE kb_id=$1 GROUP BY kind ORDER BY n DESC",
            kb["id"])
        stops = await con.fetch(
            "SELECT lang, lexeme, df FROM corpus_stopword WHERE kb_id=$1 "
            "ORDER BY df DESC LIMIT 40", kb["id"])
        ndocs = await con.fetchval("SELECT count(*) FROM document WHERE kb_id=$1", kb["id"])
    return {"kb": kb, "builtin": slug in BUILTIN, "stats": dict(stats),
            "kinds": [dict(r) for r in kinds], "stopwords": [dict(r) for r in stops],
            "documents": ndocs, "chunkers": docs.CHUNKERS}


# -------------------------------------------------------------------- vault --
@router.get("/kbs/{slug}/documents")
async def list_documents(slug: str, q: str = "", limit: int = 200):
    p = await pool()
    async with p.acquire() as con:
        kb = await _kb(con, slug)
        rows = await con.fetch(
            """SELECT id, source_id, title, lang, media_type, bytes, chunks, status,
                      error, url, created_at, ingested_at
               FROM document WHERE kb_id=$1
                 AND ($2='' OR title ILIKE '%'||$2||'%' OR source_id ILIKE '%'||$2||'%')
               ORDER BY created_at DESC LIMIT $3""",
            kb["id"], q, limit)
    return {"documents": [dict(r) | {"created_at": str(r["created_at"]),
                                     "ingested_at": str(r["ingested_at"] or "")}
                          for r in rows]}


@router.get("/kbs/{slug}/documents/{source_id:path}")
async def read_document(slug: str, source_id: str):
    p = await pool()
    async with p.acquire() as con:
        kb = await _kb(con, slug)
        row = await con.fetchrow(
            "SELECT * FROM document WHERE kb_id=$1 AND source_id=$2", kb["id"], source_id)
        if row is None:
            raise HTTPException(404, "no such document")
        chunks = await con.fetch(
            "SELECT path, kind, heading, length(body) AS chars FROM chunk "
            "WHERE kb_id=$1 AND source_id=$2 ORDER BY sort_key LIMIT 500",
            kb["id"], source_id)
    d = _json_fields(dict(row))
    d["created_at"] = str(d["created_at"]); d["ingested_at"] = str(d["ingested_at"] or "")
    return {"document": d, "chunks": [dict(c) for c in chunks]}


@router.post("/kbs/{slug}/documents")
async def upload_documents(slug: str, files: list[UploadFile] = File(...),
                           lang: str = Form("")):
    """Take the files, store the text, and start a background job to index them.

    Storing and indexing are separate on purpose: the upload returns as soon as
    the text is safely in the database, so a slow corpus-wide reindex cannot
    lose somebody's files by timing out.
    """
    p = await pool()
    async with p.acquire() as con:
        kb = await _kb(con, slug)
        existing = {r["source_id"] for r in
                    await con.fetch("SELECT source_id FROM document WHERE kb_id=$1", kb["id"])}
        accepted, rejected = [], []
        for f in files:
            raw = await f.read()
            media = docs.sniff(f.filename or "document", f.content_type)
            try:
                text = docs.extract(raw, media, f.filename or "document")
                if not text.strip():
                    raise ValueError("the file is empty")
            except Exception as exc:
                rejected.append({"filename": f.filename, "error": str(exc)[:300]})
                continue
            sid = docs.source_id_for(f.filename or "document", existing)
            existing.add(sid)
            await con.execute(
                """INSERT INTO document (kb_id,source_id,title,lang,media_type,bytes,
                                         sha256,body,status)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
                   ON CONFLICT (kb_id,source_id) DO UPDATE SET
                     body=EXCLUDED.body, bytes=EXCLUDED.bytes, sha256=EXCLUDED.sha256,
                     status='pending', error=NULL""",
                kb["id"], sid, (f.filename or sid)[:200],
                lang or kb["default_lang"], media, len(raw), docs.sha(raw), text)
            accepted.append({"source_id": sid, "title": f.filename, "bytes": len(raw)})

        job_id = ""
        if accepted:
            job_id = await _start_job(con, kb["id"], "documents",
                                      [a["source_id"] for a in accepted])
    return {"accepted": accepted, "rejected": rejected, "job": job_id}


@router.post("/kbs/{slug}/documents/text")
async def add_text_document(slug: str, req: TextDoc):
    p = await pool()
    async with p.acquire() as con:
        kb = await _kb(con, slug)
        existing = {r["source_id"] for r in
                    await con.fetch("SELECT source_id FROM document WHERE kb_id=$1", kb["id"])}
        sid = docs.source_id_for(req.title + ".md", existing)
        raw = req.body.encode()
        await con.execute(
            """INSERT INTO document (kb_id,source_id,title,lang,media_type,bytes,
                                     sha256,body,url,status)
               VALUES ($1,$2,$3,$4,'text/markdown',$5,$6,$7,$8,'pending')""",
            kb["id"], sid, req.title[:200], req.lang or kb["default_lang"],
            len(raw), docs.sha(raw), req.body, req.url)
        job_id = await _start_job(con, kb["id"], "documents", [sid])
    return {"source_id": sid, "job": job_id}


@router.delete("/kbs/{slug}/documents/{source_id:path}")
async def delete_document(slug: str, source_id: str):
    p = await pool()
    async with p.acquire() as con:
        kb = await _kb(con, slug)
        n = await con.fetchval(
            "SELECT count(*) FROM chunk WHERE kb_id=$1 AND source_id=$2", kb["id"], source_id)
        await con.execute("DELETE FROM chunk WHERE kb_id=$1 AND source_id=$2",
                          kb["id"], source_id)
        gone = await con.execute("DELETE FROM document WHERE kb_id=$1 AND source_id=$2",
                                 kb["id"], source_id)
    if gone.endswith("0"):
        raise HTTPException(404, "no such document")
    return {"deleted": source_id, "chunks_removed": n}


@router.post("/kbs/{slug}/reindex")
async def reindex(slug: str):
    """Re-cut every document in the corpus under its current chunker.

    This is what makes the chunker a setting rather than a decision taken once at
    upload: change it, re-cut, and the same documents come back as different
    passages.
    """
    p = await pool()
    async with p.acquire() as con:
        kb = await _kb(con, slug)
        n = await con.fetchval("SELECT count(*) FROM document WHERE kb_id=$1", kb["id"])
        if not n:
            raise HTTPException(
                422, "This corpus has no stored documents to re-cut. The built-in "
                     "corpora were ingested by ./ingest.sh from their own sources.")
        job_id = await _start_job(con, kb["id"], "reindex", None)
    return {"job": job_id, "documents": n}


async def _start_job(con, kb_id: int, kind: str, source_ids: list[str] | None) -> str:
    job_id = uuid.uuid4().hex[:12]
    await con.execute(
        "INSERT INTO ingest_job (id,kb_id,kind,status,total) VALUES ($1,$2,$3,'queued',$4)",
        job_id, kb_id, kind, len(source_ids or []))
    asyncio.create_task(docs.run_job(job_id, kb_id, source_ids, kind=kind))
    return job_id


@router.get("/jobs")
async def list_jobs(kb: str = "", limit: int = 20):
    p = await pool()
    async with p.acquire() as con:
        rows = await con.fetch(
            """SELECT j.*, k.slug AS kb FROM ingest_job j LEFT JOIN kb k ON k.id=j.kb_id
               WHERE ($1='' OR k.slug=$1) ORDER BY j.started_at DESC LIMIT $2""",
            kb, limit)
    return {"jobs": [_json_fields(dict(r)) | {"started_at": str(r["started_at"]),
                                              "finished_at": str(r["finished_at"] or "")}
                     for r in rows]}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    p = await pool()
    async with p.acquire() as con:
        row = await con.fetchrow(
            "SELECT j.*, k.slug AS kb FROM ingest_job j LEFT JOIN kb k ON k.id=j.kb_id "
            "WHERE j.id=$1", job_id)
    if row is None:
        raise HTTPException(404, "no such job")
    d = _json_fields(dict(row))
    d["started_at"] = str(d["started_at"]); d["finished_at"] = str(d["finished_at"] or "")
    return d


# ----------------------------------------------------------------- settings --
@router.get("/settings")
async def get_settings():
    return {"settings": runtime.describe(),
            "chunkers": docs.CHUNKERS,
            "database": settings.database_url.rsplit("@", 1)[-1],
            "mcp": {"host": settings.mcp_http_host, "port": settings.mcp_http_port}}


@router.put("/settings")
async def put_setting(req: SettingPut):
    if req.key not in runtime.EDITABLE:
        raise HTTPException(422, f"{req.key} is not a setting that can be changed here")
    await runtime.put(req.key, req.value)
    return {"ok": True, "settings": runtime.describe()}


@router.delete("/settings/{key}")
async def reset_setting(key: str):
    await runtime.clear(key)
    return {"ok": True, "settings": runtime.describe()}


# ---------------------------------------------------------------------- mcp --
@router.get("/mcp")
async def mcp_config(request_host: str = ""):
    """What to paste into an MCP client, and what it will get when it connects."""
    from ..mcp import server as mcp_server
    host, port = settings.mcp_http_host, settings.mcp_http_port
    key = runtime.get("api_key")
    p = await pool()
    async with p.acquire() as con:
        kbs = await con.fetch("SELECT slug, name, tools FROM kb ORDER BY sort_order, id")
    tools = [
        {"name": "list_knowledge_bases", "what": "The corpora available, with their size and what they hold.", "writes": False},
        {"name": "search_kb", "what": "Retrieval against one corpus. No model, so no cost.", "writes": False},
        {"name": "ask_knowledge_base", "what": "A full answer with verified citations. Calls the model.", "writes": False},
        {"name": "book_appointment", "what": "Takes a booking. The half of the job that has consequences.", "writes": True},
        {"name": "list_appointments", "what": "What has been booked.", "writes": False},
    ]
    stdio = {
        "mcpServers": {
            "ragdemo": {
                "command": "python",
                "args": ["-m", "app.mcp.server"],
                "cwd": "/path/to/RAGDemo/api",
                "env": {"DATABASE_URL": "postgresql://ragdemo:ragdemo@localhost:5444/ragdemo",
                        **({"API_KEY": "YOUR_KEY"} if key else {})},
            }
        }
    }
    http = {
        "mcpServers": {
            "ragdemo": {
                "type": "http",
                "url": f"http://{host}:{port}/mcp",
                **({"headers": {"X-API-Key": "YOUR_KEY"}} if key else {}),
            }
        }
    }
    return {
        "tools": tools,
        "kbs": [{"slug": r["slug"], "name": r["name"], "tools": list(r["tools"])} for r in kbs],
        "stdio": stdio, "http": http,
        "host": host, "port": port,
        "key_required": bool(key),
        "module": getattr(mcp_server, "__name__", "app.mcp.server"),
    }


# -------------------------------------------------------------- history -----
@router.get("/conversations")
async def list_conversations(kb: str = "", limit: int = 100):
    p = await pool()
    async with p.acquire() as con:
        rows = await con.fetch(
            """SELECT c.id, c.title, c.pinned, c.created_at, c.updated_at,
                      k.slug AS kb, k.name AS kb_name, k.accent, k.glyph,
                      (SELECT count(*) FROM message m WHERE m.conversation_id=c.id) AS messages
               FROM conversation c JOIN kb k ON k.id=c.kb_id
               WHERE ($1='' OR k.slug=$1)
               ORDER BY c.pinned DESC, c.updated_at DESC LIMIT $2""", kb, limit)
    return {"conversations": [dict(r) | {"created_at": str(r["created_at"]),
                                         "updated_at": str(r["updated_at"])}
                              for r in rows]}


@router.post("/conversations")
async def create_conversation(req: ConversationCreate):
    p = await pool()
    async with p.acquire() as con:
        kb = await _kb(con, req.kb)
        cid = uuid.uuid4().hex[:12]
        await con.execute(
            "INSERT INTO conversation (id,kb_id,title) VALUES ($1,$2,$3)",
            cid, kb["id"], req.title[:200])
    return {"id": cid}


@router.get("/conversations/{cid}")
async def get_conversation(cid: str):
    p = await pool()
    async with p.acquire() as con:
        row = await con.fetchrow(
            "SELECT c.*, k.slug AS kb FROM conversation c JOIN kb k ON k.id=c.kb_id "
            "WHERE c.id=$1", cid)
        if row is None:
            raise HTTPException(404, "no such conversation")
        msgs = await con.fetch(
            "SELECT role, content, trace_id, meta, created_at FROM message "
            "WHERE conversation_id=$1 ORDER BY id", cid)
    d = dict(row)
    return {
        "id": d["id"], "kb": d["kb"], "title": d["title"], "pinned": d["pinned"],
        "created_at": str(d["created_at"]), "updated_at": str(d["updated_at"]),
        "messages": [_json_fields(dict(m)) | {"created_at": str(m["created_at"])}
                     for m in msgs],
    }


@router.post("/conversations/{cid}/messages")
async def append_messages(cid: str, req: MessagePair):
    p = await pool()
    async with p.acquire() as con:
        row = await con.fetchrow("SELECT id, title FROM conversation WHERE id=$1", cid)
        if row is None:
            raise HTTPException(404, "no such conversation")
        await con.execute(
            "INSERT INTO message (conversation_id,role,content) VALUES ($1,'user',$2)",
            cid, req.question)
        await con.execute(
            "INSERT INTO message (conversation_id,role,content,trace_id,meta) "
            "VALUES ($1,'assistant',$2,$3,$4::jsonb)",
            cid, req.answer, req.trace_id, json.dumps(req.meta))
        # The first question is the title, until somebody renames it.
        if not row["title"]:
            await con.execute("UPDATE conversation SET title=$2 WHERE id=$1",
                              cid, req.question[:120])
        await con.execute("UPDATE conversation SET updated_at=now() WHERE id=$1", cid)
    return {"ok": True}


@router.patch("/conversations/{cid}")
async def rename_conversation(cid: str, title: str = "", pinned: bool | None = None):
    p = await pool()
    async with p.acquire() as con:
        if title:
            await con.execute("UPDATE conversation SET title=$2 WHERE id=$1", cid, title[:200])
        if pinned is not None:
            await con.execute("UPDATE conversation SET pinned=$2 WHERE id=$1", cid, pinned)
    return {"ok": True}


@router.delete("/conversations/{cid}")
async def delete_conversation(cid: str):
    p = await pool()
    async with p.acquire() as con:
        await con.execute("DELETE FROM conversation WHERE id=$1", cid)
    return {"deleted": cid}


@router.get("/traces")
async def list_traces(kb: str = "", q: str = "", limit: int = 100):
    p = await pool()
    async with p.acquire() as con:
        rows = await con.fetch(
            """SELECT t.id, t.question, t.lang, t.cost_usd, t.created_at,
                      k.slug AS kb, k.name AS kb_name, k.accent,
                      jsonb_array_length(coalesce(t.stages,'[]'::jsonb)) AS stages,
                      coalesce(jsonb_array_length(t.answer->'cited'),0) AS cited,
                      coalesce(jsonb_array_length(t.answer->'unverified_quotes'),0) AS unverified,
                      coalesce((t.answer->>'ms')::float,0) AS ms
               FROM trace t JOIN kb k ON k.id=t.kb_id
               WHERE ($1='' OR k.slug=$1) AND ($2='' OR t.question ILIKE '%'||$2||'%')
               ORDER BY t.created_at DESC LIMIT $3""", kb, q, limit)
    return {"traces": [dict(r) | {"created_at": str(r["created_at"])} for r in rows]}


# ------------------------------------------------------------------ sources --
class SourceCreate(BaseModel):
    name: str
    kind: str
    config: dict = Field(default_factory=dict)
    every_minutes: int = 0
    enabled: bool = True
    prune: bool = False
    lang: str = ""


class SourcePatch(BaseModel):
    name: str | None = None
    config: dict | None = None
    every_minutes: int | None = None
    enabled: bool | None = None
    prune: bool | None = None
    lang: str | None = None


class Probe(BaseModel):
    kind: str = "mcp"
    config: dict = Field(default_factory=dict)


# Starting points for the form. `verified` says whether this exact configuration
# was actually run against a live server on this machine - the difference between
# "we tested it" and "this is the shape it takes", which the UI prints as-is.
PRESETS = [
    {
        "id": "local-folder", "kind": "filesystem", "verified": True,
        "name": "A folder on this server",
        "what": "Watches a directory this process can read. No credentials, nothing to install.",
        "config": {"path": "/srv/docs", "include": "*.md,*.txt,*.pdf"},
    },
    {
        "id": "mcp-filesystem", "kind": "mcp", "verified": True,
        "name": "Filesystem MCP server",
        "what": "The reference filesystem server over stdio. Useful for checking the MCP path works "
                "before pointing it at something with credentials.",
        "config": {
            "transport": "stdio", "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "/srv/docs"],
            "list_tool": "list_directory", "list_args": {"path": "/srv/docs"},
            "read_tool": "read_text_file", "read_arg": "path", "read_prefix": "/srv/docs",
            "include": "*.md,*.txt",
        },
    },
    {
        "id": "mcp-gdrive", "kind": "mcp", "verified": False,
        "name": "Google Drive MCP server",
        "what": "Google Drive through an MCP server you run and authenticate yourself. The shape below "
                "is right; the tool names and arguments belong to whichever Drive server you use, so "
                "press Test connection and pick them from what it reports. Not verified here — this "
                "machine has no Drive credentials.",
        "config": {
            "transport": "stdio", "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-gdrive"],
            "env": {"GDRIVE_CREDENTIALS_PATH": "/path/to/credentials.json"},
            "list_tool": "gdrive_search", "list_args": {"query": "mimeType='application/vnd.google-apps.document'"},
            "read_tool": "gdrive_read_file", "read_arg": "fileId",
        },
    },
    {
        "id": "mcp-http", "kind": "mcp", "verified": False,
        "name": "An MCP server over HTTP",
        "what": "Any MCP server already listening somewhere. Test connection lists its tools so you can "
                "choose which one lists documents and which one reads them.",
        "config": {"transport": "http", "url": "http://localhost:8143/mcp", "headers": {}},
    },
    {
        "id": "urls", "kind": "http", "verified": True,
        "name": "A list of URLs",
        "what": "Fetched over HTTP on the schedule. HTML is stripped to text.",
        "config": {"urls": ["https://example.com/handbook.md"]},
    },
]


def _source_row(r) -> dict:
    d = _json_fields(dict(r))
    for k in ("last_run_at", "next_run_at", "created_at"):
        if k in d:
            d[k] = str(d[k] or "")
    return d


@router.get("/source-kinds")
async def source_kinds():
    from ..ingest import sources
    return {"kinds": sources.KINDS, "presets": PRESETS, "scheduler": scheduler.status()}


@router.get("/kbs/{slug}/sources")
async def list_sources(slug: str):
    p = await pool()
    async with p.acquire() as con:
        kb = await _kb(con, slug)
        rows = await con.fetch(
            """SELECT s.*, (SELECT count(*) FROM document d WHERE d.source_id_ref=s.id) AS documents
               FROM source s WHERE s.kb_id=$1 ORDER BY s.created_at""", kb["id"])
    return {"sources": [_source_row(r) for r in rows]}


@router.post("/kbs/{slug}/sources")
async def create_source(slug: str, req: SourceCreate):
    from ..ingest import sources
    if req.kind not in sources.KINDS:
        raise HTTPException(422, f"unknown source kind: {req.kind}")
    p = await pool()
    async with p.acquire() as con:
        kb = await _kb(con, slug)
        row = await con.fetchrow(
            """INSERT INTO source (kb_id,name,kind,config,every_minutes,enabled,prune,lang,
                                   next_run_at)
               VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,
                       CASE WHEN $5 > 0 THEN now() ELSE NULL END)
               RETURNING *""",
            kb["id"], req.name[:200], req.kind, json.dumps(req.config),
            max(0, req.every_minutes), req.enabled, req.prune, req.lang)
    return _source_row(row)


@router.patch("/sources/{source_id}")
async def patch_source(source_id: int, req: SourcePatch):
    fields = req.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(422, "nothing to change")
    sets, args = [], []
    every_ph: int | None = None
    for i, (k, v) in enumerate(fields.items(), start=2):
        if k == "config":
            sets.append(f"config=${i}::jsonb"); args.append(json.dumps(v))
        else:
            sets.append(f"{k}=${i}"); args.append(v)
        if k == "every_minutes":
            every_ph = i
    # Changing the interval re-bases the next run from now, so "every 15 minutes"
    # set at 10:00 means 10:15 rather than whatever the old schedule had queued.
    # The interval reuses its own placeholder rather than binding a second copy -
    # appending one made the parameter count disagree with the statement and
    # every schedule change returned a 500.
    if every_ph is not None:
        sets.append(f"next_run_at = CASE WHEN ${every_ph}::int > 0 "
                    f"THEN now() + make_interval(mins => ${every_ph}::int) ELSE NULL END")
    p = await pool()
    async with p.acquire() as con:
        row = await con.fetchrow(
            f"UPDATE source SET {', '.join(sets)} WHERE id=$1 RETURNING *", source_id, *args)
    if row is None:
        raise HTTPException(404, "no such source")
    return _source_row(row)


@router.delete("/sources/{source_id}")
async def delete_source(source_id: int, documents: bool = False):
    """Remove a source. Its documents stay unless `documents=true`, because
    stopping a sync is not the same decision as throwing away what it fetched."""
    p = await pool()
    async with p.acquire() as con:
        row = await con.fetchrow("SELECT kb_id FROM source WHERE id=$1", source_id)
        if row is None:
            raise HTTPException(404, "no such source")
        removed = 0
        if documents:
            sids = [r["source_id"] for r in await con.fetch(
                "SELECT source_id FROM document WHERE source_id_ref=$1", source_id)]
            for sid in sids:
                await con.execute("DELETE FROM chunk WHERE kb_id=$1 AND source_id=$2",
                                  row["kb_id"], sid)
            removed = await con.fetchval(
                "WITH d AS (DELETE FROM document WHERE source_id_ref=$1 RETURNING 1) "
                "SELECT count(*) FROM d", source_id)
        await con.execute("DELETE FROM source WHERE id=$1", source_id)
    return {"deleted": source_id, "documents_removed": removed}


@router.post("/sources/{source_id}/sync")
async def sync_source(source_id: int):
    """Run one source now, without waiting for its schedule."""
    from ..ingest import sources
    p = await pool()
    async with p.acquire() as con:
        if not await con.fetchval("SELECT 1 FROM source WHERE id=$1", source_id):
            raise HTTPException(404, "no such source")
    asyncio.create_task(sources.sync(source_id, trigger="manual"))
    return {"started": source_id}


@router.get("/sources/{source_id}/runs")
async def source_runs(source_id: int, limit: int = 20):
    p = await pool()
    async with p.acquire() as con:
        rows = await con.fetch(
            "SELECT * FROM source_run WHERE source_id=$1 ORDER BY started_at DESC LIMIT $2",
            source_id, limit)
    return {"runs": [dict(r) | {"started_at": str(r["started_at"]),
                                "finished_at": str(r["finished_at"] or "")} for r in rows]}


@router.post("/sources/discover")
async def discover_source(req: Probe):
    """Connect to an MCP server and report the tools it actually has.

    Configuring a source from a guess about tool names is how you get a sync that
    silently fetches nothing; this is the alternative.
    """
    from ..ingest import mcpclient
    try:
        return await asyncio.wait_for(mcpclient.discover(req.config),
                                      timeout=mcpclient.CONNECT_TIMEOUT)
    except asyncio.TimeoutError:
        raise HTTPException(504, "the MCP server did not answer in time")
    except Exception as exc:
        raise HTTPException(422, f"could not connect: {str(exc)[:400]}")


@router.post("/sources/preview")
async def preview_source(req: Probe):
    """A dry run: what this source would fetch, and one item actually read."""
    from ..ingest import sources
    try:
        return await sources.preview(req.kind, req.config)
    except asyncio.TimeoutError:
        raise HTTPException(504, "the source did not answer in time")
    except Exception as exc:
        raise HTTPException(422, str(exc)[:400])
