"""Chunkers.

Four ways of deciding what a retrievable unit is. Three of them are honest
attempts at their corpus; `fixed_overlap` is deliberately the naive one, so the
demo can show the same corpus answering the same question well and badly, with
nothing else changed.
"""
import re
from dataclasses import dataclass, field


@dataclass
class Chunk:
    kind: str
    path: str
    sort_key: str
    heading: str | None
    body: str
    meta: dict = field(default_factory=dict)
    cites: list[str] = field(default_factory=list)
    amended_by: str | None = None
    mod_op: str | None = None


# --------------------------------------------------------------------------
# 1. The legal structure itself: the article paragraph, the annex point, the
#    recital, the single definition. Article 3 left whole is a 20,000-character
#    blob that matches every query and answers none; split into its definitions
#    it answers "what is a deployer" precisely.
# --------------------------------------------------------------------------
def aiact_structural(xhtml: str, want: str, base_celex: str) -> list[Chunk]:
    from .parse import parse
    return [Chunk(kind=p.kind, path=p.path, sort_key=p.sort_key, heading=p.heading,
                  body=p.body, cites=p.cites, amended_by=p.amended_by,
                  mod_op=p.mod_op)
            for p in parse(xhtml, want, base_celex=base_celex)]


# --------------------------------------------------------------------------
# 2. The naive one. No structure, no headings, no citable identity - a window
#    may open mid-sentence and close across two unrelated provisions.
#    Approximately 800 tokens at ~1.35 words per token, 15% overlap.
# --------------------------------------------------------------------------
def fixed_overlap(text: str, *, words: int = 590, overlap: float = 0.15,
                  prefix: str = "chunk") -> list[Chunk]:
    toks = text.split()
    if not toks:
        return []
    step = max(1, int(words * (1 - overlap)))
    out: list[Chunk] = []
    for i in range(0, len(toks), step):
        window = toks[i:i + words]
        if len(window) < 40 and out:
            break
        n = len(out)
        out.append(Chunk(
            kind="window",
            path=f"{prefix}.{n:04d}",
            sort_key=f"{n:06d}",
            heading=None,
            body=" ".join(window),
            meta={"window_words": len(window), "starts_at_word": i},
        ))
        if i + words >= len(toks):
            break
    return out


# --------------------------------------------------------------------------
# 3. Markdown, chunked on its heading hierarchy. The heading path is the
#    citation and also the breadcrumb a reader needs to trust the answer.
# --------------------------------------------------------------------------
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.M)
FENCE_RE = re.compile(r"^(?:```|~~~).*?$", re.M)


def _fenced_spans(text: str) -> list[tuple[int, int]]:
    """Character ranges covered by fenced code blocks.

    A shell comment is a markdown heading as far as the regex is concerned, so a
    runbook full of `# restart the container` lines gets shredded into sections
    that open mid-block. Measured 2026-09-15 on the infra docs: 8 sections came
    out with an odd number of fences - each one a code block cut in half - and
    the model reading them said so unprompted ("came back truncated at their
    code blocks"). Fences are matched in pairs; an unclosed one runs to the end.
    """
    marks = [m.start() for m in FENCE_RE.finditer(text)]
    spans = []
    for i in range(0, len(marks) - 1, 2):
        spans.append((marks[i], marks[i + 1]))
    if len(marks) % 2:
        spans.append((marks[-1], len(text)))
    return spans


def _slug(s: str) -> str:
    s = re.sub(r"[^\w\s-]", "", s.lower()).strip()
    return re.sub(r"[\s_]+", "-", s)[:70] or "section"


def markdown_headings(text: str, *, doc_path: str,
                      min_words: int = 12) -> list[Chunk]:
    fences = _fenced_spans(text)
    marks = [m for m in HEADING_RE.finditer(text)
             if not any(a <= m.start() < b for a, b in fences)]
    if not marks:
        body = text.strip()
        if len(body.split()) < min_words:
            return []
        return [Chunk(kind="section", path=f"{doc_path}#top", sort_key="000000",
                      heading=doc_path, body=body, meta={"doc": doc_path})]

    out: list[Chunk] = []
    stack: list[tuple[int, str]] = []
    for i, m in enumerate(marks):
        level, title = len(m.group(1)), m.group(2).strip()
        start = m.end()
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = text[start:end].strip()
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, title))
        breadcrumb = " › ".join(t for _l, t in stack)
        if len(body.split()) < min_words:
            continue
        out.append(Chunk(
            kind="section",
            path=f"{doc_path}#{_slug(title)}",
            sort_key=f"{i:06d}",
            heading=breadcrumb,
            body=body,
            meta={"doc": doc_path, "level": level, "title": title},
        ))
    return out


# --------------------------------------------------------------------------
# 4. Transcripts. Flat spoken text with no timestamps in the source, so the unit
#    is a window over words and the citation can only point at a POSITION in the
#    transcript - never at a moment in the video. Sentence-aware at the edges,
#    because a window that opens mid-clause reads as a transcription error.
# --------------------------------------------------------------------------
SENT_END = re.compile(r"(?<=[.!?])\s+")


def transcript_window(text: str, *, video_id: str, title: str = "",
                      words: int = 320, overlap: float = 0.2) -> list[Chunk]:
    sents = [s.strip() for s in SENT_END.split(text) if s.strip()]
    if not sents:
        return []
    out: list[Chunk] = []
    buf: list[str] = []
    count = 0
    word_pos = 0
    start_pos = 0
    for s in sents:
        w = len(s.split())
        buf.append(s)
        count += w
        word_pos += w
        if count >= words:
            n = len(out)
            out.append(Chunk(
                kind="passage",
                path=f"vid.{video_id}#{start_pos:04d}",
                sort_key=f"{n:06d}",
                heading=title[:180] or None,
                body=" ".join(buf),
                meta={"video_id": video_id, "title": title,
                      "starts_at_word": start_pos, "words": count,
                      "timestamps": False},
            ))
            keep = max(1, int(len(buf) * overlap))
            buf = buf[-keep:]
            count = sum(len(x.split()) for x in buf)
            start_pos = word_pos - count
    if buf and count >= 60:
        n = len(out)
        out.append(Chunk(
            kind="passage",
            path=f"vid.{video_id}#{start_pos:04d}",
            sort_key=f"{n:06d}",
            heading=title[:180] or None,
            body=" ".join(buf),
            meta={"video_id": video_id, "title": title,
                  "starts_at_word": start_pos, "words": count,
                  "timestamps": False},
        ))
    return out
