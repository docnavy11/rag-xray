"""Verify the model's quotes against the corpus.

The native citations feature of the Messages API returns cited_text plus
character offsets. OpenRouter's translation layer drops it - measured
2026-08-27, zero citation blocks whether routed through Bedrock or pinned to
Anthropic - so the receipt has to be rebuilt on our side.

This is not a downgrade. Native citations are produced by the model and taken on
trust; these are checked: every quoted span must occur verbatim in a provision
that was actually retrieved, or it is returned marked unverified. A fabricated
quote becomes a fact about the response rather than a plausible sentence.
"""
import re
import unicodedata

# «...» as the rules ask for, plus the double-quote variants a model reaches for
# anyway. The straight apostrophe is NOT a delimiter: measured 2026-08-27 on a
# French answer, treating it as one matched the span between the apostrophes of
# «l'» and «d'» and reported "œuvre créative" and "autres obligations**\nL" as
# fabricated quotes - six of them in one answer, noise that would also hide a
# real fabrication among it. A quote may not run across a newline either, which
# is what let one match swallow a paragraph of the model's own prose.
QUOTE_RE = re.compile(
    r"«([^«»\n]{12,400})»"
    r'|\u201c([^\u201c\u201d\n]{12,400})\u201d'
    r'|\u201e([^\u201c\u201d\u201e\n]{12,400})\u201c'
    r'|"([^"\n]{12,400})"')
REF_RE = re.compile(r"\[([\w./#-]+)\]")

# A quote may elide its middle: «up to EUR 15 000 000 or ... 3 % of turnover».
# That is a legitimate convention and the span is real, but exact matching fails
# on it, so every elided quote reads as a fabrication. Four of those in an answer
# is enough noise to hide the one that matters - which is the same failure
# aiact-kb hit from the other side, where treating apostrophes as delimiters
# reported six phantom fabrications in a single French answer.
ELLIPSIS_RE = re.compile(r"\s*(?:\.\.\.|\u2026)\s*")
MIN_FRAGMENT = 6


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = s.replace("—", "-").replace("–", "-").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip().lower()


def _locate(hay: str, needle: str) -> tuple[int, int] | None:
    """Where `needle` occurs in `hay`, allowing an elided middle.

    An exact hit wins. Otherwise the quote is split on its ellipses and every
    fragment must occur, IN ORDER, in the same passage - so a real elision
    verifies while a paraphrase still fails. Fragments shorter than
    MIN_FRAGMENT are dropped rather than matched: a two-character fragment
    occurs in almost any text and would verify anything.
    """
    pos = hay.find(needle)
    if pos >= 0:
        return pos, pos + len(needle)

    parts = [f for f in ELLIPSIS_RE.split(needle) if len(f) >= MIN_FRAGMENT]
    if len(parts) < 2:
        return None
    start: int | None = None
    cursor = 0
    for part in parts:
        i = hay.find(part, cursor)
        if i < 0:
            return None
        if start is None:
            start = i
        cursor = i + len(part)
    return (start, cursor) if start is not None else None


def verify(answer_text: str, provisions: list[dict]) -> tuple[list[dict], list[str]]:
    """Return (citations, unverified_quotes).

    A citation carries the provision it was found in and the offsets *we*
    computed, so a reader can highlight the exact span in the source text.
    """
    # Heading as well as body: the heading is part of the provision and is text
    # the model was given, so quoting it is not fabrication. Measured 2026-08-27
    # on a near-miss question, the single "unverified quote" reported was the
    # heading of the provision the answer was correctly relying on. Offsets stay
    # within whichever field matched, so a reader can still highlight the span.
    index = [(p, field, _norm(p[field]))
             for p in provisions
             for field in ("body", "heading")
             if p.get(field)]
    cited: list[dict] = []
    unverified: list[str] = []

    for m in QUOTE_RE.finditer(answer_text):
        quote = next(g for g in m.groups() if g).strip()
        needle = _norm(quote)
        if len(needle) < 12:
            continue
        found = None
        for p, field, hay in index:
            span = _locate(hay, needle)
            if span is not None:
                found = (p, field, span)
                break
        if found is None:
            unverified.append(quote)
            continue
        p, field, (start, end) = found
        cited.append({
            "path": p["path"], "celex": p["celex"], "lang": p["lang"],
            "cited_text": quote, "field": field,
            "start": start, "end": end,
            "elided": ELLIPSIS_RE.search(needle) is not None,
            "url": p["source_url"], "valid_from": str(p["valid_from"]),
            "verified": True,
        })

    # Bracketed references without a quote still tell the reader where to look.
    quoted_paths = {c["path"] for c in cited}
    by_path = {p["path"]: p for p in provisions}
    for m in REF_RE.finditer(answer_text):
        path = m.group(1).lower()
        if path in quoted_paths or path not in by_path:
            continue
        p = by_path[path]
        cited.append({
            "path": p["path"], "celex": p["celex"], "lang": p["lang"],
            "cited_text": None, "field": None, "start": None, "end": None,
            "url": p["source_url"], "valid_from": str(p["valid_from"]),
            "verified": True,
        })
        quoted_paths.add(path)

    return cited, unverified
