"""The chat, on the Claude Agent SDK.

The SDK supplies the loop; we supply one tool and a persona. Two things are
deliberate and load-bearing:

**The built-in tools are off.** The Agent SDK is Claude Code as a library, so it
ships Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch. This demo is reachable
from a browser, so the surface is a whitelist of exactly our MCP tools, the
built-ins are additionally named in `disallowed_tools`, and `setting_sources=[]`
stops it loading the host machine's settings, CLAUDE.md or MCP servers.

**Retrieval is a tool the model chooses to call**, not a step that happens to it.
That is worth more to this demo than a fixed pipeline would be: you can watch it
decide, and watch it search again when the first result did not answer.
"""
import logging
from typing import AsyncIterator

from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient,
                              ResultMessage, TextBlock, ThinkingBlock, ToolUseBlock)

from .. import runtime
from ..config import settings
from . import tools as toolmod

log = logging.getLogger("ragdemo.agent")

# Named explicitly rather than trusted to the whitelist: measured 2026-09-15, the
# built-in ToolSearch ran on the first turn despite `allowed_tools` listing only
# the MCP tools, so the whitelist alone does not close the surface.
BUILTINS = ["Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash",
            "BashOutput", "KillShell", "Glob", "Grep", "WebSearch", "WebFetch",
            "Task", "TodoWrite", "SlashCommand", "ToolSearch", "ExitPlanMode",
            "EnterPlanMode", "Artifact", "Skill", "Workflow", "AskUserQuestion"]

FRAME = """You are answering inside a demo whose entire point is that the reader can \
see how the answer was produced. So: never answer from your own knowledge of this \
subject. Call search_kb first, and answer only from what it returns. If it returns \
nothing useful, say so plainly - that is a good answer here, and inventing one is \
the only real failure.

You have no file, shell or web access, and you do not need any."""


def options_for(kb: dict) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        model=runtime.get("answer_model"),
        system_prompt=f"{kb['persona_prompt']}\n\n{FRAME}",
        mcp_servers={"ragdemo": toolmod.server_for(kb)},
        allowed_tools=toolmod.tool_names_for(kb),
        disallowed_tools=BUILTINS,
        setting_sources=[],          # do not load this machine's settings or CLAUDE.md
        permission_mode="bypassPermissions",  # the whitelist above is the real gate
        max_turns=runtime.get("max_agent_turns"),
        include_partial_messages=True,
        env={"ANTHROPIC_API_KEY": settings.anthropic_api_key}
            if settings.anthropic_api_key else {},
    )


async def run(kb: dict, question: str, *, cfg: dict, trace, lang: str,
              as_of=None, history: list[dict] | None = None,
              context: str = "") -> AsyncIterator[dict]:
    """Yield events as they happen: stage, text delta, then final."""
    toolmod.set_context(kb, cfg, trace, lang, as_of=as_of, context=context,
                        question=question)

    st = trace.stage("question", "The question").done(
        f"{len(question.split())} words · {lang}", text=question, lang=lang,
        kb=kb["slug"])
    yield {"type": "stage", "stage": st.as_dict()}
    seen = len(trace.stages)

    prompt = question
    if history:
        prior = "\n".join(
            f"{'You' if h.get('role') == 'assistant' else 'User'}: "
            f"{str(h.get('content') or '')[:1500]}"
            for h in history[-4:])
        prompt = (f"Earlier in this conversation:\n{prior}\n\n"
                  f"The question now, asked in {lang}:\n{question}")

    text_parts: list[str] = []
    result: ResultMessage | None = None

    async with ClaudeSDKClient(options_for(kb)) as client:
        await client.query(prompt)
        async for msg in client.receive_response():
            # Stages recorded by the tool while it ran are flushed out in order,
            # so the ribbon fills in live rather than arriving at the end. Only
            # FINISHED stages go out: a stage is appended when it starts, and
            # streaming it then sends a timing of null and an empty detail.
            while (len(trace.stages) > seen
                   and trace.stages[seen].ms is not None):
                yield {"type": "stage", "stage": trace.stages[seen].as_dict()}
                seen += 1

            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock) and block.text:
                        text_parts.append(block.text)
                        yield {"type": "text", "delta": block.text,
                               "text": "".join(text_parts)}
                    elif isinstance(block, ThinkingBlock):
                        yield {"type": "thinking"}
                    elif isinstance(block, ToolUseBlock):
                        yield {"type": "tool_use", "name": block.name}
            elif isinstance(msg, ResultMessage):
                result = msg

    # Anything still unfinished at the end is emitted as it stands - a stage that
    # never completed is itself worth showing.
    while len(trace.stages) > seen:
        yield {"type": "stage", "stage": trace.stages[seen].as_dict()}
        seen += 1

    body = "".join(text_parts).strip()
    if result is not None:
        trace.cost_usd = getattr(result, "total_cost_usd", None)
        usage = getattr(result, "usage", None) or {}
        if isinstance(usage, dict):
            trace.input_tokens = usage.get("input_tokens", 0) or 0
            trace.output_tokens = usage.get("output_tokens", 0) or 0

    yield {"type": "answer_done", "text": body,
           "searches": toolmod.call_count(),
           "chunks": toolmod.retrieved_chunks()}
