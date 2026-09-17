"""Turn Cellar XHTML into provisions.

Legislation is pre-chunked by its own structure: title > chapter > article >
paragraph > point, numbered and stable across all 24 language versions and
every consolidated snapshot. The unit here is the *paragraph* (with its points
kept attached, because a lone "(b) ..." is not quotable), the annex *point*,
and the *recital*.

Consolidated texts also carry their own provenance: a <p class="modref"> marker
links to the CELEX of the act that inserted or replaced what follows, so
amended_by / mod_op populate themselves.
"""
import re
from dataclasses import dataclass, field

from lxml import html as LH

ART_ID = re.compile(r"^art_(\d+)$")
ANX_ID = re.compile(r"^anx_([IVXLC]+)$")
RCT_ID = re.compile(r"^rct_(\d+)$")

# "Article 6(2)", "Annex III", and their nl/fr/de equivalents
XREF = re.compile(
    r"\b(?:Article|Artikel|artikel|article)\s+(\d+)(?:\((\d+[a-z]?)\))?"
    r"|\b(?:Annex|Bijlage|bijlage|Annexe|annexe|Anhang)\s+([IVXLC]+)",
)


@dataclass
class Provision:
    kind: str
    path: str
    sort_key: str
    heading: str | None
    body: str
    amended_by: str | None = None
    mod_op: str | None = None
    cites: list[str] = field(default_factory=list)


def _txt(el) -> str:
    """Readable text of an element, with list bullets kept inline."""
    parts = []
    for node in el.iter():
        if node.tag in ("p", "div", "span", "td", "br"):
            t = (node.text or "").strip()
            if t:
                parts.append(t)
        tail = (node.tail or "").strip()
        if tail:
            parts.append(tail)
    out = " ".join(parts)
    out = re.sub(r"\s+", " ", out)
    out = re.sub(r"\s+([,.;:)])", r"\1", out)
    return out.strip()


NUM_RE = re.compile(r"(\d+[a-z]?)")


def _num(raw: str) -> str | None:
    """'1.' | '(1)' | '1a.' | 'Article 1' -> '1' | '1' | '1a'"""
    m = NUM_RE.search(raw or "")
    return m.group(1) if m else None


def _pad(*nums) -> str:
    return ".".join(str(n).rjust(6, "0") for n in nums)


def _roman(v: str) -> int:
    vals = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}
    total, prev = 0, 0
    for ch in reversed(v.upper()):
        n = vals.get(ch, 0)
        total = total - n if n < prev else total + n
        prev = max(prev, n)
    return total


def _xrefs(text: str) -> list[str]:
    out = set()
    for m in XREF.finditer(text):
        if m.group(1):
            out.add(f"art.{m.group(1)}" + (f".{m.group(2)}" if m.group(2) else ""))
        elif m.group(3):
            out.add(f"annex.{m.group(3).upper()}")
    return sorted(out)


def _modref(el):
    """(celex, operation) from a <p class="modref"> marker, if this is one."""
    if el.get("class") != "modref":
        return None
    a = el.find(".//a")
    if a is None:
        return None
    title = a.get("title") or ""          # e.g. "32026R1744: INSERTED"
    href = a.get("href") or ""
    celex = title.split(":")[0].strip() or href.rsplit("/", 1)[-1]
    op = title.split(":", 1)[1].strip() if ":" in title else None
    if celex.upper().startswith("▼") or not celex:
        return None
    return celex, op


def parse_articles(doc, base_celex: str = "32024R1689") -> list[Provision]:
    out: list[Provision] = []
    for div in doc.xpath('//div[@id]'):
        m = ART_ID.match(div.get("id") or "")
        if not m:
            continue
        art = int(m.group(1))
        h = div.xpath('.//p[@class="stitle-article-norm"]')
        heading = _txt(h[0]) if h else None

        cur_mod: tuple[str | None, str | None] = (None, None)
        paras = []
        for child in div.iterchildren():
            mod = _modref(child)
            if mod:
                # A marker pointing back at the base act is the consolidator's
                # "unamended from here" flag, not an amendment.
                cur_mod = (None, None) if mod[0] == base_celex else mod
                continue
            if child.tag == "div" and "norm" in (child.get("class") or ""):
                no = child.xpath('./span[@class="no-parag"]')
                # The same paragraph is numbered "1." in English and "(1)" in
                # German. Paths must be identical in every language or a citation
                # stops being a citation, so keep only the number itself.
                num = _num(_txt(no[0])) if no else None
                body = _txt(child)
                if num and body.startswith(num):
                    body = body[len(num):].lstrip(" .")
                if body:
                    paras.append((num, body, cur_mod))

        if not paras:
            # Articles built as a list rather than as numbered paragraphs -
            # Art. 3 (definitions) is the important one. Left whole it becomes a
            # 20k-character unit that matches every query and answers none, so
            # split it the same way an annex is split: one unit per numbered item.
            items = div.xpath('.//div[contains(@class,"grid-list-column-1")]/..')
            emitted = 0
            for it in items:
                c1 = it.xpath('.//div[contains(@class,"grid-list-column-1")]')
                c2 = it.xpath('.//div[contains(@class,"grid-list-column-2")]')
                if not c1 or not c2:
                    continue
                num = _num(_txt(c1[0]))
                body = _txt(c2[0])
                if not body or not num:
                    continue
                nm = re.match(r"(\d+)", num)
                if not nm:
                    continue
                emitted += 1
                out.append(Provision(
                    "article", f"art.{art}.{num}", _pad(art, int(nm.group(1))),
                    heading, body, cites=_xrefs(body)))
            if emitted:
                continue
            body = _txt(div)
            if heading and body.startswith(heading):
                body = body[len(heading):].strip()
            body = re.sub(rf"^Article\s+{art}\s*", "", body).strip()
            if body:
                out.append(Provision("article", f"art.{art}", _pad(art, 0), heading,
                                     body, cites=_xrefs(body)))
            continue

        for i, (num, body, mod) in enumerate(paras, start=1):
            suffix = num if num else str(i)
            base = re.match(r"(\d+)([a-z]*)", suffix)
            n1 = int(base.group(1)) if base else i
            out.append(Provision(
                "article", f"art.{art}.{suffix}", _pad(art, n1) + (base.group(2) if base else ""),
                heading, body, amended_by=mod[0], mod_op=mod[1], cites=_xrefs(body)))
    return out


def parse_annexes(doc) -> list[Provision]:
    out: list[Provision] = []
    for div in doc.xpath('//div[@id]'):
        m = ANX_ID.match(div.get("id") or "")
        if not m:
            continue
        roman = m.group(1).upper()
        t1 = div.xpath('.//p[contains(@class,"title-annex-2")]')
        heading = _txt(t1[0]) if t1 else None
        items = div.xpath('./div[contains(@class,"grid-list")]')
        if not items:
            items = div.xpath('.//div[contains(@class,"grid-container")]')[:1]
        seen = 0
        for it in items:
            c1 = it.xpath('.//div[contains(@class,"grid-list-column-1")]')
            c2 = it.xpath('.//div[contains(@class,"grid-list-column-2")]')
            if not c1 or not c2:
                continue
            num = _num(_txt(c1[0]))
            body = _txt(c2[0])
            if not body or not num:
                continue
            seen += 1
            n = re.match(r"\d+", num)
            out.append(Provision(
                "annex", f"annex.{roman}.{num}", _pad(_roman(roman), int(n.group(0)) if n else seen),
                heading, body, cites=_xrefs(body)))
        if not seen:
            body = _txt(div)
            if body:
                out.append(Provision("annex", f"annex.{roman}", _pad(_roman(roman), 0),
                                     heading, body, cites=_xrefs(body)))
    return out


def parse_recitals(doc) -> list[Provision]:
    out: list[Provision] = []
    for div in doc.xpath('//div[@id]'):
        m = RCT_ID.match(div.get("id") or "")
        if not m:
            continue
        n = int(m.group(1))
        cells = div.xpath(".//td")
        body = _txt(cells[1]) if len(cells) > 1 else _txt(div)
        body = re.sub(rf"^\({n}\)\s*", "", body).strip()
        if body:
            out.append(Provision("recital", f"rec.{n}", _pad(n), None, body,
                                 cites=_xrefs(body)))
    return out


def parse(xhtml: str, want: str, base_celex: str = "32024R1689") -> list[Provision]:
    doc = LH.fromstring(xhtml.encode("utf-8"))
    if want == "recitals":
        return parse_recitals(doc)
    return parse_articles(doc, base_celex) + parse_annexes(doc)
