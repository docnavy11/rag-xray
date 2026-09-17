"""The agent's entire tool surface.

Two tools, and nothing else. The Claude Agent SDK ships Read, Write, Edit, Bash,
Glob, Grep, WebSearch and WebFetch; on a demo reachable from a browser the tool
surface must be exactly what the demo is about, so every built-in is excluded by
whitelist in `agent.py` and none of them is registered here.

`search_kb` is the retrieval pipeline. Calling it writes the whole pipeline into
the live trace, which is what the X-ray screen renders - so the tool is also the
instrument.
"""
import json

from claude_agent_sdk import create_sdk_mcp_server, tool

from ..engine import retrieval

# The trace and KB for the request currently being served. The SDK calls tools
# without a request context, so the surrounding request installs them here; one
# agent run happens at a time per request.
_ctx: dict = {}


def set_context(kb: dict, cfg: dict, trace, lang: str, as_of=None,
                context: str = "", question: str = "") -> None:
    _ctx.clear()
    _ctx.update(kb=kb, cfg=cfg, trace=trace, lang=lang, as_of=as_of,
                context=context, question=question, retrieved={}, calls=0,
                expansion=None)


def retrieved_chunks() -> list[dict]:
    """Everything any search returned this turn - the haystack quotes are
    checked against. A quote is only verifiable against text the model was
    actually given, so this accumulates across calls rather than replacing."""
    return list(_ctx.get("retrieved", {}).values())


def call_count() -> int:
    return _ctx.get("calls", 0)


@tool(
    "search_kb",
    "Search this knowledge base and return the passages that match, each with "
    "the identifier you must cite it by. Call it more than once if the first "
    "result does not answer the question - a second search with different words "
    "is cheap and is often what is needed.",
    {"query": str, "lang": str},
)
async def search_kb(args: dict) -> dict:
    kb, cfg, trace = _ctx["kb"], _ctx["cfg"], _ctx["trace"]
    q = (args.get("query") or "").strip()
    lang = (args.get("lang") or _ctx.get("lang") or kb["default_lang"]).strip()
    if lang not in (kb["langs"] or ["en"]):
        lang = kb["default_lang"]
    _ctx["calls"] = _ctx.get("calls", 0) + 1

    st = trace.stage("tool", f"Agent calls search_kb", "agent") if trace else None
    if st:
        st.done(f'"{q[:60]}" · {lang}', query=q, lang=lang,
                call_number=_ctx["calls"])

    # Expand ONCE per turn, on the user's original question, and reuse it for
    # every later search.
    #
    # Measured 2026-09-15: one expansion costs 8-13s (the Agent SDK spawns a CLI
    # subprocess per call), the agent made four searches on one question, and
    # each re-expanded because it phrases the query differently every time - 29s
    # of a 74s answer spent re-translating text the agent had ALREADY translated
    # into the corpus's vocabulary. That is the honest finding here: with an
    # agent in the loop, expanding the agent's own query is largely redundant
    # work. It is still expanded once, on what the human actually typed, because
    # that is the mapping the agent did not do.
    if _ctx.get("expansion") is None and cfg.get("expand"):
        st_e = trace.stage("expand", "Expand the question", "expand") if trace else None
        _ctx["expansion"] = await retrieval.expand_for(
            _ctx.get("question") or q, _ctx.get("lang") or lang, kb)
        ex = _ctx["expansion"]
        if st_e:
            st_e.done(f"{len(ex['terms'])} terms · {ex['source']} · reused for "
                      f"every search this turn",
                      terms=ex["terms"], guessed_paths=ex["paths"],
                      source=ex["source"], expanded=_ctx.get("question") or q,
                      reused=True)

    rows = await retrieval.retrieve(kb, q, lang=lang, cfg=cfg, trace=trace,
                                    as_of=_ctx.get("as_of"),
                                    context=_ctx.get("context", ""),
                                    expansion=_ctx.get("expansion"))
    for r in rows:
        _ctx.setdefault("retrieved", {})[r["path"]] = r

    # Path and in-force context go into the TEXT, not only into a metadata
    # field: a path carried only as metadata does not survive every transport,
    # and a model asked to tag a citation it was never given will improvise one.
    passages = []
    for r in rows:
        head = f"[{r['path']}]" + (f" {r['heading']}" if r.get("heading") else "")
        ctx = f"{r['kind']}"
        if kb["slug"] == "aiact":
            ctx += f", {r['tier']} text, in force from {r['valid_from']}"
        passages.append(f"{head}\n{ctx}\n\n{r['body']}")

    st2 = trace.stage("assemble", "Assemble the context", "assemble") if trace else None
    if st2:
        chars = sum(len(p) for p in passages)
        st2.done(f"{len(passages)} passages · ~{chars // 4:,} tokens",
                 passages=[{"path": r["path"], "kind": r["kind"],
                            "heading": (r.get("heading") or "")[:120],
                            "chars": len(r["body"]),
                            "approx_tokens": len(r["body"]) // 4,
                            "url": r.get("source_url")} for r in rows],
                 approx_tokens=chars // 4)

    if not passages:
        return {"content": [{"type": "text",
                             "text": "No passages matched. Say so plainly rather "
                                     "than answering from memory."}]}
    return {"content": [{"type": "text", "text": "\n\n---\n\n".join(passages)}]}


@tool(
    "classify_system",
    "Classify one AI system under the EU AI Act using the deterministic engine. "
    "Returns a band (red/amber/green) with reasons. Use this whenever the user "
    "describes a system and wants to know what it is - never decide that "
    "yourself.",
    {"kind": str, "role": str, "detail": str},
)
async def classify_system(args: dict) -> dict:
    """The one path the architecture depends on: the model may call the engine
    and explain what it returns, and may not produce a verdict of its own."""
    from .classify import assess
    trace = _ctx.get("trace")
    verdict = assess(args)
    if trace:
        trace.stage("classify", "Deterministic classifier").done(
            verdict["band"], input=args, verdict=verdict)
    return {"content": [{"type": "text", "text": json.dumps(verdict, indent=2)}]}


def server_for(kb: dict):
    tools = [search_kb]
    if "classify_system" in (kb.get("tools") or []):
        tools.append(classify_system)
    return create_sdk_mcp_server("ragdemo", "1.0.0", tools=tools)


def tool_names_for(kb: dict) -> list[str]:
    names = ["mcp__ragdemo__search_kb"]
    if "classify_system" in (kb.get("tools") or []):
        names.append("mcp__ragdemo__classify_system")
    return names
