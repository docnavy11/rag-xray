"""Non-streaming ask: run the agent to completion, verify, log, return one dict.

`/v1/ask/stream` exists for the browser demo, which wants to paint the X-ray
ribbon as the pipeline runs. Nothing else does. A caller from n8n, Zapier, Make,
or the external MCP server (`app/mcp/server.py`) wants one request, one JSON
response - parsing Server-Sent Events is friction those tools don't need to pay
for. This module is that path: same agent, same citation check, same trace
persisted, just collected to completion instead of streamed.
"""
import datetime as dt
import json

from .. import runtime
from ..config import settings
from ..db import pool
from ..engine.cite import verify
from ..engine.trace import Trace
from . import agent


def for_verify(rows: list[dict]) -> list[dict]:
    """cite.verify came from aiact-kb and speaks `celex`; here that is source_id."""
    return [{**r, "celex": r["source_id"]} for r in rows]


async def run_ask(kb: dict, q: str, *, lang: str, cfg: dict,
                  as_of: dt.date | None = None,
                  history: list[dict] | None = None) -> dict:
    """Run one question through the agent to completion. Raises nothing the
    caller needs to catch specially - an empty answer is reported, not thrown."""
    tr = Trace(kb["slug"], q, lang, cfg)
    hist = (history or [])[-4:]
    prev_q = next((h.get("content") for h in reversed(hist)
                   if h.get("role") == "user"), "")

    answer, chunks, searches = "", [], 0
    async for ev in agent.run(kb, q, cfg=cfg, trace=tr, lang=lang, as_of=as_of,
                              history=hist, context=(prev_q or "")[:300]):
        if ev["type"] == "answer_done":
            answer, chunks, searches = ev["text"], ev["chunks"], ev["searches"]

    cited, unverified = ([], [])
    if answer and cfg.get("verify_quotes", True):
        cited, unverified = verify(answer, for_verify(chunks))

    payload = {
        "trace_id": tr.id, "kb": kb["slug"], "answer": answer or None,
        "refusal": None if answer else "empty_model_response",
        "cited": cited, "unverified_quotes": unverified, "searches": searches,
        "passages": [{"path": c["path"], "kind": c["kind"],
                      "heading": c.get("heading"), "url": c.get("source_url"),
                      "valid_from": c.get("valid_from")} for c in chunks],
        "cost_usd": tr.cost_usd, "ms": tr.ms, "model": runtime.get("answer_model"),
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
    return payload
