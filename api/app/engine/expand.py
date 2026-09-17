"""Query expansion: the user's words in, the corpus's vocabulary out.

Measured on the AI Act golden set, lexical retrieval alone reaches 59% recall@8
and every remaining miss is a vocabulary gap. Mapping a question onto the
register a corpus actually uses is a small, well-posed task - what a cheap model
is good at, and what a general-purpose embedding is weak at on legal register.

Cached by (model, kb, lang, question) so a repeated question costs nothing and an
eval run measures retrieval rather than model variance.
"""
import hashlib
import json
import logging
import re

from .. import runtime
from ..config import settings
from ..db import pool

log = logging.getLogger("ragdemo.expand")

PROMPT = """You turn a practitioner's question into search terms for one specific corpus.

Reply with JSON only:
{"terms": ["..."], "paths": ["..."]}

- terms: 3-8 words or short phrases in the SAME LANGUAGE as the question, using
  the vocabulary THIS CORPUS uses. Prefer the source's words over the asker's.
- paths: identifiers you are confident the answer lives in, in the corpus's own
  citation form. Empty list if unsure. Never guess an identifier to fill the
  field.

Corpus: {corpus}
Citation form: {cite_form}

Question:"""


async def _cached(key: str) -> dict | None:
    p = await pool()
    async with p.acquire() as con:
        row = await con.fetchrow("SELECT value FROM query_expansion WHERE key=$1", key)
    return json.loads(row["value"]) if row else None


async def _store(key: str, value: dict) -> None:
    p = await pool()
    async with p.acquire() as con:
        await con.execute(
            "INSERT INTO query_expansion (key, value) VALUES ($1, $2) "
            "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
            key, json.dumps(value))


async def expand_query(q: str, lang: str, kb: dict) -> dict:
    """{"terms": [...], "paths": [...], "source": ...}.

    `source` is always reported, because an empty expansion from an API error
    looks exactly like an empty expansion from a confident model - and treating
    those as the same thing is how an outage becomes "this corpus does not cover
    your question".
    """
    corpus = f"{kb['name']} - {kb['tagline']}"
    cite_form = {
        "aiact": "art.N, art.N.M, annex.ROMAN.N, rec.N",
        "aiact-naive": "chunk.NNNN (opaque window ids - you will not know them, "
                       "so return an empty paths list)",
        "video": "vid.<videoid>#NNNN (opaque - return an empty paths list)",
        "docs": "path/to/file.md#heading-slug",
    }.get(kb["slug"], "opaque identifiers - return an empty paths list")

    key = hashlib.sha256(
        f"{runtime.get('expand_model')}|{kb['slug']}|{lang}|{q}".encode()).hexdigest()
    hit = await _cached(key)
    if hit is not None:
        return {**hit, "source": "cache"}

    try:
        # .replace, not .format: the prompt contains a literal JSON example, and
        # str.format reads its braces as field names.
        system = (PROMPT.replace("{corpus}", corpus)
                        .replace("{cite_form}", cite_form))
        raw = await _ask(system, f"({lang}) {q}\n\nJSON:")
        start, end = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[start:end + 1]) if start >= 0 else {}
        out = {
            "terms": [t for t in data.get("terms", []) if isinstance(t, str)][:8],
            "paths": [p for p in data.get("paths", []) if isinstance(p, str)][:6],
        }
    except Exception as exc:
        log.warning("expansion failed, falling back to the raw query: %s", exc)
        return {"terms": [], "paths": [], "source": "error", "error": str(exc)[:200]}

    await _store(key, out)
    return {**out, "source": "model"}


async def _ask(system: str, prompt: str) -> str:
    """One short turn on the cheap model, through the same harness the chat uses.

    Deliberately the Agent SDK rather than the Messages API: it is the only
    credential path this demo has (it authenticates the way the Claude Code CLI
    does), so expansion works wherever the chat works instead of silently
    degrading whenever ANTHROPIC_API_KEY happens to be unset - which is exactly
    the failure that makes an empty expansion indistinguishable from a confident
    one.
    """
    from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, TextBlock,
                                  query)

    opts = ClaudeAgentOptions(
        model=runtime.get("expand_model"),
        system_prompt=system,
        setting_sources=[],
        allowed_tools=[],
        disallowed_tools=["Read", "Write", "Edit", "Bash", "Glob", "Grep",
                          "WebSearch", "WebFetch", "Task", "TodoWrite"],
        max_turns=1,
        env={"ANTHROPIC_API_KEY": settings.anthropic_api_key}
            if settings.anthropic_api_key else {},
    )
    parts: list[str] = []
    async for msg in query(prompt=prompt, options=opts):
        if isinstance(msg, AssistantMessage):
            for b in msg.content:
                if isinstance(b, TextBlock):
                    parts.append(b.text)
    return "".join(parts)
