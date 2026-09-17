"""A standalone MCP server in front of RAGDemo, for clients other than the
browser demo: Claude Desktop, Cursor, n8n's MCP node, or any other MCP host.

Why this exists as a *separate* server rather than reusing `chat/tools.py`:
`create_sdk_mcp_server` in `chat/tools.py` builds an in-process MCP server that
only the Claude Agent SDK's own client ever talks to - it is not reachable from
outside that process. This module wraps the same underlying engine
(`engine.retrieval`, `chat.ask.run_ask`) in a real MCP server that speaks the
protocol over stdio (for a desktop client that spawns this file) or over
streamable HTTP (for a client, e.g. n8n, that wants a URL instead of a
subprocess).

Five tools, in two groups.

The knowledge base, read-only:

  list_knowledge_bases   what is available to search, and what each one is for
  search_kb              retrieval only - passages, no model, no cost
  ask_knowledge_base     the full pipeline - a grounded, cited answer

And one thing that is not RAG at all:

  list_appointments      what is already booked
  book_appointment       take a booking - the only tool here that writes

That second group is the point of the file, not padding. A server that can
only search is a search box with extra steps. The integration these clients
are actually asking for is one agent that answers from the corpus *and* acts
on the answer - reads the policy, then books the call about it - which needs
both halves reachable through the same connection.

Run it:
    python -m app.mcp.server            # stdio - for Claude Desktop / Cursor
    python -m app.mcp.server --http     # streamable HTTP on MCP_HTTP_PORT (default 8143)

Example Claude Desktop config entry:
    "ragdemo": {"command": "/path/to/.venv/bin/python",
                "args": ["-m", "app.mcp.server"],
                "cwd": "/path/to/RAGDemo/api"}
"""
import argparse
import asyncio
import datetime as dt

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from .. import db
from .. import runtime
from ..config import settings
from ..engine import retrieval

# Every ask through this server shares one caller identity in ask_log: an MCP
# client has no IP to hash, and the point is that it is *inside* the budget,
# not that it is individually rate-limited.
CALLER = "mcp-server"

mcp = MCPServer("ragdemo", version="1.0.0",
                instructions="Search and ask RAGDemo's knowledge bases. Call "
                             "list_knowledge_bases first if you don't already "
                             "know which `kb` slug to use.")


async def _get_kb(slug: str) -> dict:
    """Same lookup api/v1.py's get_kb does, kept independent of the FastAPI
    app so this server has no dependency on it being importable/running."""
    import json
    p = await db.pool()
    async with p.acquire() as con:
        row = await con.fetchrow("SELECT * FROM kb WHERE slug=$1", slug)
    if row is None:
        # ToolError, not ValueError: this SDK returns anything other than a
        # ToolError to the client as a bare "Error executing tool <name>",
        # which would throw away the half of this message that tells the
        # model how to recover.
        raise ToolError(f"no such knowledge base: {slug!r}. "
                        f"Call list_knowledge_bases to see valid slugs.")
    kb = dict(row)
    for k in ("retrieval_config", "sample_questions"):
        if isinstance(kb[k], str):
            kb[k] = json.loads(kb[k])
    return kb


@mcp.tool()
async def list_knowledge_bases() -> list[dict]:
    """List the knowledge bases this server can search or ask, with what each
    one covers and how strong its citations are (exact / positional /
    document) - call this before search_kb or ask_knowledge_base if the
    caller has not already named a `kb` slug."""
    p = await db.pool()
    async with p.acquire() as con:
        rows = await con.fetch(
            "SELECT slug, name, tagline, teaches, cite_strength, langs, "
            "default_lang FROM kb ORDER BY sort_order")
    return [dict(r) for r in rows]


@mcp.tool()
async def search_kb(kb: str, query: str, lang: str = "") -> dict:
    """Retrieve passages from one knowledge base. No model is called and
    nothing is cited or verified - this is the raw retrieval step, for a
    caller that wants to do its own reasoning over the passages. Use
    ask_knowledge_base instead if you want a grounded, cited answer."""
    kb_row = await _get_kb(kb)
    use_lang = lang or kb_row["default_lang"]
    cfg = kb_row["retrieval_config"]
    rows = await retrieval.retrieve(kb_row, query, lang=use_lang, cfg=cfg,
                                    as_of=dt.date.today())
    return {"kb": kb, "count": len(rows),
            "hits": [{"path": r["path"], "kind": r["kind"],
                      "heading": r.get("heading"), "body": r["body"],
                      "lang": r["lang"], "url": r.get("source_url")}
                     for r in rows]}


@mcp.tool()
async def ask_knowledge_base(kb: str, question: str, lang: str = "") -> dict:
    """Ask a question and get a grounded, cited answer: the same agent the
    browser demo uses, run to completion. Every quote in the answer is
    checked against what was actually retrieved. Shares the demo's daily
    answering budget and rate limits with every other caller."""
    from fastapi import HTTPException

    from ..api.v1 import check_quota, merged
    from ..chat.ask import run_ask

    kb_row = await _get_kb(kb)
    use_lang = lang or kb_row["default_lang"]
    q = (question or "").strip()
    if not (3 <= len(q) <= 600):
        raise ToolError("A question is between 3 and 600 characters.")

    # Shared caller identity: an MCP client has no IP to hash, but it should
    # still count against the same per-caller and global-spend limits every
    # other surface (/v1/ask, /v1/ask/stream) respects - this is not a way
    # around the budget. check_quota signals refusal by raising HTTPException,
    # which only means anything to FastAPI; translate it so the MCP client is
    # told *why* it was refused rather than getting an opaque crash.
    try:
        await check_quota(CALLER)
    except HTTPException as exc:
        raise ToolError(str(exc.detail))

    cfg = merged(kb_row, {})
    payload = await run_ask(kb_row, q, lang=use_lang, cfg=cfg,
                            as_of=dt.date.today())

    # The spend this call just incurred has to land in ask_log, or check_quota
    # above is reading a counter nothing increments: every MCP ask would pass
    # the per-caller limit forever and contribute nothing to the daily budget
    # that /v1/ask and /v1/ask/stream are both measured against.
    p = await db.pool()
    async with p.acquire() as con:
        await con.execute(
            "INSERT INTO ask_log (ip_hash,kb_slug,model,cost_usd) "
            "VALUES ($1,$2,$3,$4)",
            CALLER, kb_row["slug"], runtime.get("answer_model"), payload["cost_usd"])
    return payload


# ------------------------------------------------------- not a RAG tool --
# The point of the two tools below. A knowledge-base server that can only
# search is a search box with extra steps; what a client is buying is one
# agent that answers *and* books. These are the smallest honest version of
# the second half: a real table, real constraints, real refusals.

OPEN_HOUR, CLOSE_HOUR, SLOT_MINUTES = 9, 17, 30


def _parse_slot(slot: str) -> dt.datetime:
    """Accept an ISO 8601 datetime and hold it to the booking rules."""
    try:
        when = dt.datetime.fromisoformat(slot)
    except ValueError:
        raise ToolError(
            f"could not read {slot!r} as a date and time. Use ISO 8601, "
            f"e.g. 2026-09-21T14:30 (or 2026-09-21T14:30+02:00).")
    if when.tzinfo is None:
        when = when.replace(tzinfo=dt.timezone.utc)
    if when <= dt.datetime.now(dt.timezone.utc):
        raise ToolError(f"{when.isoformat()} is in the past.")
    if when.minute % SLOT_MINUTES or when.second or when.microsecond:
        raise ToolError(f"appointments start on the hour or the half hour; "
                        f"{when.isoformat()} does not.")
    if not (OPEN_HOUR <= when.hour < CLOSE_HOUR) or when.weekday() >= 5:
        raise ToolError(f"{when.isoformat()} is outside office hours "
                        f"(Mon-Fri, {OPEN_HOUR:02d}:00-{CLOSE_HOUR:02d}:00).")
    return when


@mcp.tool()
async def book_appointment(name: str, email: str, slot: str,
                           topic: str = "", kb: str = "") -> dict:
    """Book a 30-minute appointment and write it down. This is the one tool
    here with a side effect: it persists a row, and a slot that is already
    taken is refused rather than silently double-booked. `slot` is an ISO 8601
    datetime (e.g. 2026-09-21T14:30), on the hour or half hour, Mon-Fri
    09:00-17:00; a naive datetime is read as UTC. Call list_appointments first
    if you need to see what is already taken."""
    when = _parse_slot(slot)
    who, mail = (name or "").strip(), (email or "").strip()
    if not who:
        raise ToolError("a name is required to book.")
    if "@" not in mail or len(mail) < 5:
        raise ToolError(f"{email!r} is not a usable email address.")

    p = await db.pool()
    async with p.acquire() as con:
        row = await con.fetchrow(
            """INSERT INTO appointment (slot,name,email,topic,kb_slug)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (slot) DO NOTHING
               RETURNING id, slot, name, email, topic, kb_slug""",
            when, who, mail, (topic or "").strip() or None,
            (kb or "").strip() or None)
        if row is None:
            taken = await con.fetchval(
                "SELECT name FROM appointment WHERE slot=$1", when)
            raise ToolError(
                f"{when.isoformat()} is already booked"
                f"{f' (by {taken})' if taken else ''}. "
                f"Call list_appointments to see what is free.")
    out = dict(row)
    out["slot"] = out["slot"].isoformat()
    out["confirmed"] = True
    return out


@mcp.tool()
async def list_appointments(limit: int = 20) -> dict:
    """List upcoming booked appointments, soonest first - what is already
    taken, so a caller can offer a time that is actually free before calling
    book_appointment."""
    n = max(1, min(int(limit or 20), 100))
    p = await db.pool()
    async with p.acquire() as con:
        rows = await con.fetch(
            "SELECT id, slot, name, email, topic, kb_slug FROM appointment "
            "WHERE slot > now() ORDER BY slot LIMIT $1", n)
    return {"count": len(rows),
            "office_hours": f"Mon-Fri {OPEN_HOUR:02d}:00-{CLOSE_HOUR:02d}:00 "
                            f"({SLOT_MINUTES}-minute slots)",
            "appointments": [{**dict(r), "slot": r["slot"].isoformat()}
                             for r in rows]}


async def _amain(http: bool) -> None:
    await db.init_schema()   # idempotent (CREATE TABLE IF NOT EXISTS)
    if http:
        await mcp.run_streamable_http_async(
            host=settings.mcp_http_host, port=settings.mcp_http_port)
    else:
        await mcp.run_stdio_async()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--http", action="store_true",
                        help="serve streamable HTTP instead of stdio, on "
                             "MCP_HTTP_HOST:MCP_HTTP_PORT (default "
                             "127.0.0.1:8143) - what n8n's MCP node needs")
    args = parser.parse_args()
    asyncio.run(_amain(args.http))
