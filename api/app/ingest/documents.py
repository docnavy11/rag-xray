"""Ingest whatever a person actually has, into whatever corpus they made.

The four built-in corpora each have a bespoke ingest - Cellar XHTML, a SQLite
scraper database, a directory of runbooks. This is the generic path: bytes come
in from an upload or a URL, text comes out, the KB's own chunker cuts it, and it
lands in the same `chunk` table the rest of the pipeline reads. Nothing here
knows anything about the AI Act.

The original text is kept in `document`, which is what makes re-chunking
possible: changing a corpus's chunker re-cuts what is already there instead of
asking for the files again.
"""
import asyncio
import datetime as dt
import hashlib
import json
import logging
import re
import uuid

from . import chunkers
from .pipeline import refresh_stopwords, store

log = logging.getLogger("ragdemo.documents")

# What a corpus can be cut with when it holds ordinary documents. `aiact_structural`
# is not here: it parses one specific Regulation's XHTML and means nothing else.
CHUNKERS = {
    "markdown_headings": "Heading hierarchy — a section per heading, breadcrumb kept as its title",
    "fixed_overlap": "Fixed windows — ~800 tokens, 15% overlap, ignores structure",
    "transcript_window": "Transcript windows — sentence-aware, for spoken text with no structure",
}

TEXTUAL = {
    "text/markdown", "text/plain", "text/x-markdown", "text/csv",
    "application/json", "text/html", "application/xhtml+xml", "text/rtf",
}

MAX_BYTES = 32 * 1024 * 1024


def sniff(filename: str, declared: str | None) -> str:
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    by_ext = {
        "md": "text/markdown", "markdown": "text/markdown", "mdx": "text/markdown",
        "txt": "text/plain", "text": "text/plain", "log": "text/plain",
        "rst": "text/plain", "csv": "text/csv", "json": "application/json",
        "html": "text/html", "htm": "text/html", "xml": "application/xhtml+xml",
        "pdf": "application/pdf", "vtt": "text/plain", "srt": "text/plain",
    }
    return by_ext.get(ext) or declared or "text/plain"


def extract(raw: bytes, media_type: str, filename: str) -> str:
    """Bytes to text. Anything that cannot be read as text is refused here rather
    than being stored as mojibake and retrieved as nonsense later."""
    if len(raw) > MAX_BYTES:
        raise ValueError(f"{filename} is larger than {MAX_BYTES // 1024 // 1024}MB")

    if media_type == "application/pdf":
        try:
            import io

            from pypdf import PdfReader
        except ImportError:
            raise ValueError(
                "PDF support needs pypdf installed on the server "
                "(pip install pypdf). Upload the text instead, or install it.")
        reader = PdfReader(io.BytesIO(raw))
        pages = []
        for i, page in enumerate(reader.pages):
            t = (page.extract_text() or "").strip()
            if t:
                pages.append(t)
        text = "\n\n".join(pages)
        if not text.strip():
            raise ValueError(
                f"{filename} has no extractable text — it is probably a scan. "
                "It would need OCR, which this does not do.")
        return text

    if media_type in ("text/html", "application/xhtml+xml"):
        try:
            from lxml import html as lxml_html
            doc = lxml_html.fromstring(raw)
            for bad in doc.xpath("//script|//style|//nav|//footer"):
                bad.getparent().remove(bad)
            return re.sub(r"\n{3,}", "\n\n", doc.text_content())
        except Exception:
            pass                                  # fall through to plain decode

    for enc in ("utf-8", "utf-16", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError(f"{filename} is not text in any encoding tried")


def source_id_for(filename: str, existing: set[str]) -> str:
    base = re.sub(r"[^\w.\-/]+", "-", filename.strip()).strip("-/") or "document"
    if base not in existing:
        return base
    stem, _, ext = base.rpartition(".")
    for n in range(2, 500):
        cand = f"{stem}-{n}.{ext}" if stem else f"{base}-{n}"
        if cand not in existing:
            return cand
    return f"{base}-{uuid.uuid4().hex[:6]}"


def cut(kb: dict, doc: dict) -> list[chunkers.Chunk]:
    """The KB's chunker, applied to one document's text."""
    chunker = kb.get("chunker") or "markdown_headings"
    text = doc["body"]
    sid = doc["source_id"]

    if chunker == "transcript_window":
        return chunkers.transcript_window(text, video_id=sid, title=doc["title"])
    if chunker == "fixed_overlap":
        return chunkers.fixed_overlap(text, prefix=sid)
    # markdown_headings is the default, and it degrades sensibly: a file with no
    # headings comes back as one section rather than as nothing.
    out = chunkers.markdown_headings(text, doc_path=sid)
    if not out and text.strip():
        out = chunkers.fixed_overlap(text, prefix=sid)
    return out


async def ingest_document(con, kb: dict, doc: dict) -> int:
    """Cut one stored document and index its chunks. Returns the chunk count."""
    chunks = cut(kb, doc)
    if not chunks:
        raise ValueError("nothing to index — the file held no usable text")
    await store(con, kb["id"], chunks, source_id=doc["source_id"],
                lang=doc["lang"], url=doc.get("url") or "",
                valid_from=dt.date(2000, 1, 1))
    await con.execute(
        """UPDATE document SET chunks=$3, status='ready', error=NULL,
                               ingested_at=now() WHERE kb_id=$1 AND source_id=$2""",
        kb["id"], doc["source_id"], len(chunks))
    return len(chunks)


async def run_job(job_id: str, kb_id: int, source_ids: list[str] | None,
                  *, kind: str = "documents") -> None:
    """Ingest documents in the background, reporting progress into `ingest_job`.

    Failures are per document: one unreadable file marks itself failed and the
    rest of the batch still lands. A job that fails wholesale records why.
    """
    from ..db import pool
    p = await pool()
    try:
        async with p.acquire() as con:
            kb = dict(await con.fetchrow("SELECT * FROM kb WHERE id=$1", kb_id))
            if isinstance(kb["retrieval_config"], str):
                kb["retrieval_config"] = json.loads(kb["retrieval_config"])
            if source_ids:
                rows = await con.fetch(
                    "SELECT * FROM document WHERE kb_id=$1 AND source_id = ANY($2::text[])",
                    kb_id, source_ids)
            else:
                rows = await con.fetch("SELECT * FROM document WHERE kb_id=$1", kb_id)

            await con.execute(
                "UPDATE ingest_job SET status='running', total=$2, message=$3 WHERE id=$1",
                job_id, len(rows),
                f"{'re-cutting' if kind == 'reindex' else 'indexing'} {len(rows)} document(s)")

            done, failed, chunks = 0, 0, 0
            langs = set()
            for row in rows:
                doc = dict(row)
                langs.add(doc["lang"])
                try:
                    chunks += await ingest_document(con, kb, doc)
                except Exception as exc:
                    failed += 1
                    log.warning("ingest failed for %s: %s", doc["source_id"], exc)
                    await con.execute(
                        "UPDATE document SET status='failed', error=$3 "
                        "WHERE kb_id=$1 AND source_id=$2",
                        kb_id, doc["source_id"], str(exc)[:500])
                done += 1
                await con.execute(
                    "UPDATE ingest_job SET done=$2, message=$3 WHERE id=$1",
                    job_id, done, f"{doc['title'][:60]}")
                await asyncio.sleep(0)            # let the poller see progress

            # Stopwords are derived FROM the corpus, so they are only correct once
            # everything in this batch is in it.
            await con.execute(
                "UPDATE ingest_job SET message='deriving corpus stopwords' WHERE id=$1",
                job_id)
            threshold = float(
                (kb["retrieval_config"].get("corpus_stopwords") or {}).get("df_threshold", 0.22))
            stops = await refresh_stopwords(
                con, kb_id, sorted(langs) or list(kb["langs"]), threshold=threshold)

            await con.execute(
                """UPDATE ingest_job SET status='done', finished_at=now(),
                       message=$2, detail=$3::jsonb WHERE id=$1""",
                job_id,
                f"{done - failed} indexed · {chunks} chunks" + (f" · {failed} failed" if failed else ""),
                json.dumps({"chunks": chunks, "failed": failed, "stopwords": stops}))
    except Exception as exc:
        log.exception("ingest job %s failed", job_id)
        async with p.acquire() as con:
            await con.execute(
                "UPDATE ingest_job SET status='failed', error=$2, finished_at=now() "
                "WHERE id=$1", job_id, str(exc)[:800])


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()
