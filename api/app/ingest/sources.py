"""Sources: where documents come from, and going back for them on a schedule.

A source is a connector plus an interval. Syncing is deliberately boring and
idempotent: list what is there, fetch each item, hash it, and only re-chunk what
actually changed. Running a sync twice in a row does nothing the second time,
which is what makes it safe to run every fifteen minutes.

Nothing here deletes anything unless the source is explicitly set to prune, and
even then only documents that this source put there.
"""
import asyncio
import datetime as dt
import fnmatch
import json
import logging
import pathlib
import re

from . import documents as docs
from . import mcpclient
from ..security import check_target, require_local_exec
from .pipeline import refresh_stopwords

log = logging.getLogger("ragdemo.sources")

KINDS = {
    "filesystem": "A directory on the machine running this server.",
    "http": "One or more URLs fetched over HTTP.",
    "mcp": "Tools on an external MCP server — a filesystem server, Google Drive, "
           "Notion, anything that can list and read.",
}

MAX_ITEMS = 500
FETCH_TIMEOUT = 60


def _sanitise(ident: str) -> str:
    out = re.sub(r"[^\w.\-/]+", "-", ident.strip()).strip("-/")
    return (out or "item")[:180]


# ----------------------------------------------------------------- connectors --
async def list_filesystem(config: dict) -> list[dict]:
    require_local_exec("A filesystem source")
    root = pathlib.Path(config.get("path") or "").expanduser()
    if not root.is_dir():
        raise ValueError(f"{root} is not a directory on this server")
    patterns = [p.strip() for p in (config.get("include") or "*.md,*.txt,*.pdf").split(",") if p.strip()]
    items = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = str(path.relative_to(root))
        if not any(fnmatch.fnmatch(path.name, p) or fnmatch.fnmatch(rel, p) for p in patterns):
            continue
        stat = path.stat()
        items.append({"id": rel, "title": rel, "rev": f"{stat.st_mtime_ns}:{stat.st_size}",
                      "_path": str(path)})
        if len(items) >= MAX_ITEMS:
            break
    return items


async def read_filesystem(config: dict, item: dict) -> tuple[str, str]:
    require_local_exec("A filesystem source")
    path = pathlib.Path(item["_path"])
    raw = path.read_bytes()
    media = docs.sniff(path.name, None)
    return docs.extract(raw, media, path.name), media


async def list_http(config: dict) -> list[dict]:
    urls = config.get("urls") or ([config["url"]] if config.get("url") else [])
    for u in urls:
        check_target(u)
    return [{"id": u, "title": u.rstrip("/").rsplit("/", 1)[-1] or u, "rev": ""} for u in urls]


async def read_http(config: dict, item: dict) -> tuple[str, str]:
    check_target(item["id"])
    import httpx
    headers = {str(k): str(v) for k, v in (config.get("headers") or {}).items()}
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
        r = await client.get(item["id"], headers=headers)
        r.raise_for_status()
        media = (r.headers.get("content-type") or "").split(";")[0] or docs.sniff(item["id"], None)
        return docs.extract(r.content, media, item["title"]), media


async def list_mcp(config: dict) -> list[dict]:
    """Call the server's list tool and turn the answer into items."""
    list_tool = config.get("list_tool")
    if not list_tool:
        raise ValueError("no list tool chosen for this MCP source")
    args = dict(config.get("list_args") or {})
    async with mcpclient.session(config) as s:
        result = await s.call_tool(list_tool, args)
    items = mcpclient.parse_listing(result)

    patterns = [p.strip() for p in (config.get("include") or "").split(",") if p.strip()]
    if patterns:
        items = [i for i in items
                 if any(fnmatch.fnmatch(i["id"], p) or fnmatch.fnmatch(i["title"], p)
                        for p in patterns)]
    return items[:MAX_ITEMS]


async def read_mcp(config: dict, item: dict) -> tuple[str, str]:
    read_tool = config.get("read_tool")
    if not read_tool:
        raise ValueError("no read tool chosen for this MCP source")
    arg = config.get("read_arg") or "path"

    # A listing often names items relative to whatever was listed, while the read
    # tool wants the full path back. `read_prefix` joins them; without it a
    # filesystem server answers "Access denied - path outside allowed directories".
    ident = item["id"]
    prefix = config.get("read_prefix") or ""
    if prefix and not ident.startswith(prefix):
        ident = prefix.rstrip("/") + "/" + ident.lstrip("/")

    args = {**(config.get("read_args") or {}), arg: ident}
    async with mcpclient.session(config) as s:
        result = await s.call_tool(read_tool, args)
    if getattr(result, "isError", False) or getattr(result, "is_error", False):
        raise ValueError(mcpclient.content_text(result)[:300] or "the read tool reported an error")
    text = mcpclient.content_text(result)
    if not text.strip():
        raise ValueError("the read tool returned nothing")
    return text, docs.sniff(item["title"], "text/markdown")


LISTERS = {"filesystem": list_filesystem, "http": list_http, "mcp": list_mcp}
READERS = {"filesystem": read_filesystem, "http": read_http, "mcp": read_mcp}


async def preview(kind: str, config: dict, limit: int = 8) -> dict:
    """What a sync would find, without writing anything.

    The point of a dry run is that a source you cannot reach fails on the screen
    where you are configuring it, not silently at three in the morning.
    """
    if kind not in LISTERS:
        raise ValueError(f"unknown source kind: {kind}")
    items = await asyncio.wait_for(LISTERS[kind](config), timeout=mcpclient.CONNECT_TIMEOUT)
    sample = []
    for item in items[:limit]:
        row = {"id": item["id"], "title": item.get("title") or item["id"]}
        if len(sample) == 0:                      # read exactly one, to prove reading works
            try:
                text, media = await asyncio.wait_for(READERS[kind](config, item), timeout=FETCH_TIMEOUT)
                row["chars"] = len(text)
                row["media_type"] = media
                row["excerpt"] = text[:300]
            except Exception as exc:
                row["error"] = str(exc)[:300]
        sample.append(row)
    return {"found": len(items), "items": sample}


# ---------------------------------------------------------------------- sync --
async def sync(source_id: int, trigger: str = "schedule") -> dict:
    """Fetch everything the source offers and bring the corpus into line."""
    from ..db import pool
    p = await pool()

    async with p.acquire() as con:
        src = await con.fetchrow("SELECT * FROM source WHERE id=$1", source_id)
        if src is None:
            raise ValueError("no such source")
        kb = dict(await con.fetchrow("SELECT * FROM kb WHERE id=$1", src["kb_id"]))
        if isinstance(kb["retrieval_config"], str):
            kb["retrieval_config"] = json.loads(kb["retrieval_config"])
        run_id = await con.fetchval(
            "INSERT INTO source_run (source_id, trigger) VALUES ($1,$2) RETURNING id",
            source_id, trigger)
        await con.execute(
            "UPDATE source SET last_status='running', last_error=NULL WHERE id=$1", source_id)

    config = src["config"]
    if isinstance(config, str):
        config = json.loads(config)
    kind = src["kind"]
    lang = src["lang"] or kb["default_lang"]
    counts = {"added": 0, "updated": 0, "unchanged": 0, "removed": 0, "failed": 0}
    errors: list[str] = []

    try:
        items = await asyncio.wait_for(LISTERS[kind](config), timeout=mcpclient.CONNECT_TIMEOUT)
        seen: list[str] = []
        changed: list[str] = []

        async with p.acquire() as con:
            existing = {r["external_id"]: dict(r) for r in await con.fetch(
                "SELECT source_id, external_id, sha256 FROM document "
                "WHERE kb_id=$1 AND source_id_ref=$2", kb["id"], source_id)}
            taken = {r["source_id"] for r in await con.fetch(
                "SELECT source_id FROM document WHERE kb_id=$1", kb["id"])}

            for item in items[:MAX_ITEMS]:
                ext = str(item["id"])
                seen.append(ext)
                prior = existing.get(ext)
                try:
                    text, media = await asyncio.wait_for(
                        READERS[kind](config, item), timeout=FETCH_TIMEOUT)
                except Exception as exc:
                    counts["failed"] += 1
                    errors.append(f"{item.get('title') or ext}: {str(exc)[:160]}")
                    continue

                digest = docs.sha(text.encode())
                if prior and prior["sha256"] == digest:
                    counts["unchanged"] += 1
                    continue

                sid = prior["source_id"] if prior else docs.source_id_for(_sanitise(ext), taken)
                taken.add(sid)
                await con.execute(
                    """INSERT INTO document (kb_id,source_id,title,lang,media_type,bytes,
                                             sha256,body,status,source_id_ref,external_id,
                                             external_rev,url)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12)
                       ON CONFLICT (kb_id,source_id) DO UPDATE SET
                         body=EXCLUDED.body, bytes=EXCLUDED.bytes, sha256=EXCLUDED.sha256,
                         media_type=EXCLUDED.media_type, title=EXCLUDED.title,
                         status='pending', error=NULL, source_id_ref=EXCLUDED.source_id_ref,
                         external_id=EXCLUDED.external_id, external_rev=EXCLUDED.external_rev""",
                    kb["id"], sid, (item.get("title") or ext)[:200], lang, media,
                    len(text.encode()), digest, text, source_id, ext,
                    str(item.get("rev") or ""), item.get("url") or "")

                doc = {"source_id": sid, "title": item.get("title") or ext,
                       "lang": lang, "body": text, "url": item.get("url") or ""}
                try:
                    await docs.ingest_document(con, kb, doc)
                    changed.append(sid)
                    counts["updated" if prior else "added"] += 1
                except Exception as exc:
                    counts["failed"] += 1
                    errors.append(f"{sid}: {str(exc)[:160]}")
                    await con.execute(
                        "UPDATE document SET status='failed', error=$3 WHERE kb_id=$1 AND source_id=$2",
                        kb["id"], sid, str(exc)[:500])

            # Pruning is opt-in. A source that fails to list its items must never
            # be read as "everything was deleted upstream", so an empty listing
            # prunes nothing.
            if src["prune"] and seen:
                gone = [ext for ext in existing if ext not in set(seen)]
                for ext in gone:
                    sid = existing[ext]["source_id"]
                    await con.execute("DELETE FROM chunk WHERE kb_id=$1 AND source_id=$2", kb["id"], sid)
                    await con.execute("DELETE FROM document WHERE kb_id=$1 AND source_id=$2", kb["id"], sid)
                    counts["removed"] += 1

            if changed or counts["removed"]:
                threshold = float((kb["retrieval_config"].get("corpus_stopwords") or {})
                                  .get("df_threshold", 0.22))
                await refresh_stopwords(con, kb["id"], list(kb["langs"]), threshold=threshold)

        message = (f"{counts['added']} added · {counts['updated']} updated · "
                   f"{counts['unchanged']} unchanged"
                   + (f" · {counts['removed']} removed" if counts["removed"] else "")
                   + (f" · {counts['failed']} failed" if counts["failed"] else ""))
        status = "done" if not counts["failed"] else "done"
        error = "; ".join(errors[:5]) if errors else None

    except Exception as exc:
        log.exception("source %s failed", source_id)
        status, message, error = "failed", "", str(exc)[:800]

    async with p.acquire() as con:
        await con.execute(
            """UPDATE source_run SET status=$2, added=$3, updated=$4, unchanged=$5,
                   removed=$6, failed=$7, message=$8, error=$9, finished_at=now()
               WHERE id=$1""",
            run_id, status, counts["added"], counts["updated"], counts["unchanged"],
            counts["removed"], counts["failed"], message, error)
        await con.execute(
            """UPDATE source SET last_run_at=now(), last_status=$2, last_error=$3,
                   next_run_at=CASE WHEN every_minutes > 0
                                    THEN now() + make_interval(mins => every_minutes)
                                    ELSE NULL END
               WHERE id=$1""",
            source_id, status, error)

    return {"run": run_id, "status": status, "message": message, "error": error, **counts}


def next_run_expression(every_minutes: int) -> dt.datetime | None:
    if every_minutes <= 0:
        return None
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=every_minutes)
