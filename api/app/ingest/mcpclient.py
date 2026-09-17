"""Talking to somebody else's MCP server.

The app is an MCP server already (app/mcp/server.py, for Claude Desktop and
friends). This is the other direction: connecting OUT to a server somebody else
runs - a filesystem server, a Google Drive server, whatever they have - and
using its tools to fetch documents.

Kept deliberately small and tolerant. Every server names its tools differently
and returns text in whatever shape it likes, so nothing here assumes a schema:
`discover` reports what a server actually has, and the caller decides which
tools mean "list" and "read".
"""
import json
import logging
from contextlib import asynccontextmanager
from typing import Any

log = logging.getLogger("ragdemo.mcpclient")

CONNECT_TIMEOUT = 45


@asynccontextmanager
async def session(config: dict):
    """An initialised client session for one of the three transports.

    stdio launches the server as a subprocess, which is how most desktop MCP
    servers are meant to be run; http and sse talk to one that is already
    listening.
    """
    from mcp import ClientSession, StdioServerParameters

    from ..security import check_target, require_local_exec
    transport = (config.get("transport") or "stdio").lower()

    if transport == "stdio":
        # A stdio server is a command line out of the database, executed here.
        require_local_exec("A stdio MCP server")
        from mcp.client.stdio import stdio_client
        command = config.get("command")
        if not command:
            raise ValueError("a stdio MCP source needs a command to run")
        params = StdioServerParameters(
            command=command,
            args=[str(a) for a in (config.get("args") or [])],
            env={str(k): str(v) for k, v in (config.get("env") or {}).items()} or None,
        )
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as s:
                await s.initialize()
                yield s
        return

    url = config.get("url")
    if not url:
        raise ValueError(f"an {transport} MCP source needs a url")
    check_target(url)
    headers = {str(k): str(v) for k, v in (config.get("headers") or {}).items()}

    if transport == "sse":
        from mcp.client.sse import sse_client
        async with sse_client(url, headers=headers or None) as (r, w):
            async with ClientSession(r, w) as s:
                await s.initialize()
                yield s
        return

    from mcp.client.streamable_http import streamable_http_client
    async with streamable_http_client(url, headers=headers or None) as (r, w, *_rest):
        async with ClientSession(r, w) as s:
            await s.initialize()
            yield s


def _schema(tool) -> dict:
    """mcp 2.x renamed inputSchema to input_schema; accept either."""
    return getattr(tool, "input_schema", None) or getattr(tool, "inputSchema", None) or {}


async def discover(config: dict) -> dict:
    """Connect, and report what is actually there.

    This is what the UI's "Test connection" runs, and it is the honest way to
    configure a source: you pick the list and read tools from the server's own
    list rather than from a guess about what it is called.
    """
    async with session(config) as s:
        res = await s.list_tools()
        tools = [{
            "name": t.name,
            "description": (t.description or "")[:300],
            "args": list(_schema(t).get("properties", {}).keys()),
            "required": list(_schema(t).get("required", []) or []),
        } for t in res.tools]
    return {"tools": tools, "suggested": suggest(tools)}


LIST_HINTS = ("list_directory", "list_files", "search_files", "list", "search", "gdrive_search")
READ_HINTS = ("read_text_file", "read_file", "get_file", "fetch", "gdrive_read_file", "read")


def suggest(tools: list[dict]) -> dict:
    """A first guess at which tool lists and which tool reads, for the form.

    A guess, and labelled as one in the UI - the names below are the ones the
    servers I could actually run use, not a standard.
    """
    names = [t["name"] for t in tools]

    def pick(hints):
        for h in hints:
            if h in names:
                return h
        for h in hints:
            for n in names:
                if h in n:
                    return n
        return ""

    read = pick(READ_HINTS)
    read_arg = ""
    for t in tools:
        if t["name"] == read:
            for candidate in ("path", "file_id", "fileId", "id", "uri", "url", "name"):
                if candidate in t["args"]:
                    read_arg = candidate
                    break
            if not read_arg and t["args"]:
                read_arg = t["args"][0]
    return {"list_tool": pick(LIST_HINTS), "read_tool": read, "read_arg": read_arg}


TEXTISH = ("text", "content", "result", "body", "output", "data", "value")


def _structured(result):
    return (getattr(result, "structuredContent", None)
            or getattr(result, "structured_content", None))


def _unwrap(structured):
    """A structured payload that is really just text, unwrapped.

    Measured against the reference filesystem server: it answers list_directory
    with structuredContent {"content": "[FILE] a.md\n[FILE] b.md"} - a dict whose
    single value is the same text the content block carries. Treating that dict
    as data rather than as text made the JSON braces parse as filenames, so a
    working source listed three items called "{", "\"content\": ..." and "}".
    """
    if isinstance(structured, dict):
        for key in TEXTISH:
            if isinstance(structured.get(key), str):
                return structured[key]
    return None


def content_text(result) -> str:
    """Everything textual in a tool result, joined.

    Structured content wins when a server provides it; otherwise the text blocks
    are concatenated. Anything else (images, audio) is skipped rather than
    stringified into the corpus.
    """
    structured = _structured(result)
    if structured:
        unwrapped = _unwrap(structured)
        if unwrapped is not None:
            return unwrapped
        return json.dumps(structured, indent=2)
    parts = []
    for block in getattr(result, "content", []) or []:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            parts.append(text)
    return "\n".join(parts)


def parse_listing(result) -> list[dict[str, Any]]:
    """Turn whatever the list tool returned into items with an id.

    Three shapes, in order of how much they can be trusted:

      1. structured JSON - a list of objects, or a list of strings.
      2. a JSON array in the text block, which several servers send.
      3. plain text, one item per line. The filesystem server writes
         "[FILE] contract.md"; others write bullets or bare names. The prefix
         markers are stripped and directory lines are dropped, because a
         directory is not a document.
    """
    structured = _structured(result)
    if isinstance(structured, dict):
        for key in ("files", "items", "results", "entries", "documents", "content"):
            if isinstance(structured.get(key), list):
                structured = structured[key]
                break
    if isinstance(structured, list):
        return [_item(x) for x in structured if _item(x)]

    text = content_text(result).strip()
    if not text:
        return []

    if text[0] in "[{":
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                for key in ("files", "items", "results", "entries", "documents"):
                    if isinstance(data.get(key), list):
                        data = data[key]
                        break
            if isinstance(data, list):
                out = [_item(x) for x in data]
                if any(out):
                    return [x for x in out if x]
        except json.JSONDecodeError:
            pass                                   # it was "[FILE] ..." after all

    out = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.upper().startswith("[DIR]"):
            continue                               # a directory is not a document
        for marker in ("[FILE]", "[file]", "- ", "* ", "• "):
            if line.startswith(marker):
                line = line[len(marker):].strip()
                break
        if not line or line.endswith("/"):
            continue
        out.append({"id": line, "title": line})
    return out


def _item(x: Any) -> dict | None:
    if isinstance(x, str):
        return {"id": x, "title": x}
    if not isinstance(x, dict):
        return None
    ident = next((str(x[k]) for k in ("path", "id", "fileId", "file_id", "uri", "url", "name", "key")
                  if x.get(k)), None)
    if not ident:
        return None
    title = next((str(x[k]) for k in ("name", "title", "displayName", "path") if x.get(k)), ident)
    rev = next((str(x[k]) for k in ("modifiedTime", "modified_time", "version", "rev",
                                    "updated_at", "sha", "etag", "mtime") if x.get(k)), "")
    return {"id": ident, "title": title, "rev": rev,
            "mime": str(x.get("mimeType") or x.get("mime_type") or ""), "raw": x}
