"""Fetch -> chunk -> index, for all four corpora.

One `store` for every KB, so a chunker is the only thing that differs. Superseded
rows are closed with `valid_to` rather than deleted: deleting them would make
"what changed" unanswerable and silently lose a deadline that used to apply.
"""
import datetime as dt
import hashlib
import json
import logging
import pathlib
import re

from ..config import settings
from ..db import REGCONFIG, pool
from . import cellar
from .chunkers import (Chunk, aiact_structural, fixed_overlap, markdown_headings,
                       transcript_window)

log = logging.getLogger("ragdemo.ingest")

CONSOLIDATION_DATE = {"02024R1689-20260727": dt.date(2026, 7, 27)}
# Both of these come from the environment (VIDEO_DB, DOC_ROOTS). They used to be
# absolute paths into one person's home directory, which meant two of the four
# corpora could only ever be built on that machine.
VIDEO_DB = pathlib.Path(settings.video_db) if settings.video_db else None
VIDEO_TOPICS = tuple(settings.video_topic_list)
VIDEO_CAP = settings.video_cap
DOC_ROOTS = [pathlib.Path(p).expanduser() for p in settings.doc_root_paths]


async def kb_by_slug(con, slug: str) -> dict:
    row = await con.fetchrow("SELECT * FROM kb WHERE slug=$1", slug)
    if row is None:
        raise RuntimeError(f"no such kb: {slug} (run seed first)")
    return dict(row)


async def store(con, kb_id: int, chunks: list[Chunk], *, source_id: str, lang: str,
                version: str = "", tier: str = "binding",
                valid_from: dt.date | None = None, url: str = "",
                url_for=None) -> int:
    """Replace this (kb, source, version, lang) slice and rebuild its index."""
    valid_from = valid_from or dt.date(2000, 1, 1)
    async with con.transaction():
        await con.execute(
            "DELETE FROM chunk WHERE kb_id=$1 AND source_id=$2 AND version=$3 AND lang=$4",
            kb_id, source_id, version, lang)
        rows = [(
            kb_id, source_id, version, lang, tier, c.kind, c.path, c.sort_key,
            c.heading, c.body, json.dumps(c.meta), valid_from, None,
            c.amended_by, c.mod_op, (url_for(c) if url_for else url),
        ) for c in chunks]
        await con.executemany(
            """INSERT INTO chunk (kb_id,source_id,version,lang,tier,kind,path,
                                  sort_key,heading,body,meta,valid_from,valid_to,
                                  amended_by,mod_op,source_url)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)
               ON CONFLICT (kb_id,source_id,version,lang,path) DO UPDATE SET
                 body=EXCLUDED.body, heading=EXCLUDED.heading, meta=EXCLUDED.meta,
                 valid_to=NULL""",
            rows)

        # A heading match is worth more than the same word buried in a long
        # paragraph, so headings carry weight A and bodies B.
        regconf = REGCONFIG.get(lang, "simple")
        await con.execute(
            f"""UPDATE chunk SET ts =
                  setweight(to_tsvector('{regconf}', coalesce(heading,'')), 'A') ||
                  setweight(to_tsvector('{regconf}', body), 'B')
                WHERE kb_id=$1 AND source_id=$2 AND version=$3 AND lang=$4""",
            kb_id, source_id, version, lang)

        links = [(kb_id, c.path, t, "cites") for c in chunks for t in c.cites]
        if links:
            await con.executemany(
                "INSERT INTO chunk_link (kb_id,from_path,to_path,kind) "
                "VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", links)
    return len(chunks)


async def refresh_stopwords(con, kb_id: int, langs: list[str],
                            threshold: float = 0.22) -> dict:
    """Derive per-KB stopwords from the corpus itself.

    Any lexeme in more than `threshold` of a corpus is doing no discriminating
    work THERE, whatever a general-purpose stopword list thinks. Per KB, because
    'agent' is noise in the video corpus and signal in the Act.
    """
    out = {}
    for lang in langs:
        total = await con.fetchval(
            "SELECT count(*) FROM chunk WHERE kb_id=$1 AND lang=$2", kb_id, lang)
        if not total:
            continue
        await con.execute(
            "DELETE FROM corpus_stopword WHERE kb_id=$1 AND lang=$2", kb_id, lang)
        await con.execute(
            """INSERT INTO corpus_stopword (kb_id, lang, lexeme, df)
               SELECT $1, $2, word, ndoc FROM ts_stat(
                 format('SELECT ts FROM chunk WHERE kb_id=%s AND lang=%L',
                        $1::bigint, $2::text))
               WHERE ndoc > $3::int
               ON CONFLICT DO NOTHING""",
            kb_id, lang, int(total * threshold))
        out[lang] = await con.fetchval(
            "SELECT count(*) FROM corpus_stopword WHERE kb_id=$1 AND lang=$2",
            kb_id, lang)
    return out


# ---------------------------------------------------------------- KB 1 + 2 ---
async def ingest_aiact(force: bool = False) -> dict:
    """The consolidated Act, structurally chunked, in four languages.

    The English consolidated body is kept in memory on the way through and fed
    to the naive chunker as well, so both KBs are provably the same text.
    """
    p = await pool()
    counts, naive_source = {}, None
    async with p.acquire() as con:
        kb = await kb_by_slug(con, "aiact")
        cons, base = settings.consolidated_celex, settings.base_celex
        vfrom = CONSOLIDATION_DATE.get(cons, dt.date(2024, 8, 1))

        for lang in settings.langs:
            xhtml, sha = await cellar.fetch(cons, lang)
            chunks = aiact_structural(xhtml, "body", base)
            n = await store(con, kb["id"], chunks, source_id=cons, lang=lang,
                            version=cons, valid_from=vfrom,
                            url_for=lambda c: cellar.public_url(
                                cons, lang, c.path.replace(".", "_")))
            if lang == "en":
                naive_source = "\n\n".join(
                    f"{c.heading or ''}\n{c.body}".strip() for c in chunks)
            await con.execute(
                """INSERT INTO source_snapshot (kb_id,source_id,lang,sha256)
                   VALUES ($1,$2,$3,$4) ON CONFLICT (kb_id,source_id,lang)
                   DO UPDATE SET sha256=EXCLUDED.sha256, fetched_at=now()""",
                kb["id"], cons, lang, sha)

            rx, _ = await cellar.fetch(base, lang)
            rn = await store(con, kb["id"], aiact_structural(rx, "recitals", base),
                             source_id=base, lang=lang, version=base,
                             valid_from=dt.date(2024, 8, 1),
                             url_for=lambda c: cellar.public_url(base, lang))
            counts[lang] = n + rn
            log.info("aiact %s: %d articles/annexes + %d recitals", lang, n, rn)

        stop = await refresh_stopwords(con, kb["id"], settings.langs)

    naive = await ingest_aiact_naive(naive_source) if naive_source else {}
    return {"aiact": counts, "stopwords": stop, "naive": naive}


async def ingest_aiact_naive(text: str) -> dict:
    """The same English text, cut into fixed windows. The control group."""
    p = await pool()
    async with p.acquire() as con:
        kb = await kb_by_slug(con, "aiact-naive")
        chunks = fixed_overlap(text, prefix="chunk")
        n = await store(con, kb["id"], chunks, source_id=settings.consolidated_celex,
                        lang="en", version="naive",
                        url=cellar.public_url(settings.consolidated_celex, "en"))
        stop = await refresh_stopwords(con, kb["id"], ["en"])
    log.info("aiact-naive: %d windows", n)
    return {"chunks": n, "stopwords": stop}


# -------------------------------------------------------------------- KB 3 ---
async def ingest_video(cap: int = VIDEO_CAP) -> dict:
    """Transcripts from the local Video KB.

    Read-only, and from the SQLite file rather than the scraper's own service:
    measured 2026-09-15, nothing was listening on its HTTP port.
    """
    import sqlite3
    if VIDEO_DB is None:
        return {"skipped": "VIDEO_DB is not set - point it at a transcript database "
                           "to build this corpus, or leave it unset to skip it"}
    if not VIDEO_DB.exists():
        return {"skipped": f"no video db at {VIDEO_DB}"}
    con_s = sqlite3.connect(f"file:{VIDEO_DB}?mode=ro&immutable=1", uri=True)
    marks = ",".join("?" for _ in VIDEO_TOPICS)
    rows = con_s.execute(
        f"""SELECT DISTINCT v.external_id, v.title, v.author, v.url, v.transcript,
                            v.published_at, length(v.transcript) AS n
            FROM videos v
            JOIN video_topics vt ON vt.video_id = v.id
            JOIN topics t ON t.id = vt.topic_id
            WHERE t.name IN ({marks})
              AND v.transcript IS NOT NULL AND length(v.transcript) > 2000
              AND v.transcript_lang LIKE 'en%'
            ORDER BY v.published_at DESC
            LIMIT ?""", (*VIDEO_TOPICS, cap)).fetchall()
    con_s.close()

    p = await pool()
    total = 0
    async with p.acquire() as con:
        kb = await kb_by_slug(con, "video")
        await con.execute("DELETE FROM chunk WHERE kb_id=$1", kb["id"])
        for ext, title, author, url, transcript, published, _n in rows:
            chunks = transcript_window(transcript, video_id=ext,
                                       title=f"{title} — {author}" if author else title)
            for c in chunks:
                c.meta["url"] = url
                c.meta["published_at"] = str(published) if published else None
            total += await store(con, kb["id"], chunks, source_id=ext,
                                 lang="en", url=url)
        stop = await refresh_stopwords(con, kb["id"], ["en"])
    log.info("video: %d videos -> %d passages", len(rows), total)
    return {"videos": len(rows), "chunks": total, "stopwords": stop,
            "timestamps": False}


# -------------------------------------------------------------------- KB 4 ---
SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", "dist", "secrets"}


async def ingest_docs() -> dict:
    """Markdown from whatever documentation roots DOC_ROOTS names."""
    if not DOC_ROOTS:
        return {"skipped": "DOC_ROOTS is not set - point it at one or more directories "
                           "of markdown to build this corpus, or leave it unset to skip it"}
    files: list[tuple[str, str]] = []
    for root in DOC_ROOTS:
        if not root.exists():
            continue
        for f in sorted(root.rglob("*.md")):
            if any(part in SKIP_DIRS for part in f.parts):
                continue
            try:
                text = f.read_text(encoding="utf-8")
            except Exception:
                continue
            if len(text.split()) < 40:
                continue
            files.append((f"{root.name}/{f.relative_to(root)}", text))

    p = await pool()
    total = 0
    async with p.acquire() as con:
        kb = await kb_by_slug(con, "docs")
        await con.execute("DELETE FROM chunk WHERE kb_id=$1", kb["id"])
        for doc_path, text in files:
            chunks = markdown_headings(text, doc_path=doc_path)
            for c in chunks:
                c.meta["doc"] = doc_path
            total += await store(con, kb["id"], chunks, source_id=doc_path,
                                 lang="en", url=f"file://{doc_path}")
        stop = await refresh_stopwords(con, kb["id"], ["en"])
    log.info("docs: %d files -> %d sections", len(files), total)
    return {"files": len(files), "chunks": total, "stopwords": stop}


async def ingest_all() -> dict:
    return {
        "aiact": await ingest_aiact(),
        "video": await ingest_video(),
        "docs": await ingest_docs(),
    }
