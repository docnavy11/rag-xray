"""Fetch documents from the Publications Office's Cellar repository.

Verified 2026-08-26: content negotiation on
http://publications.europa.eu/resource/celex/<CELEX> with
  Accept: application/xhtml+xml
  Accept-Language: eng|nld|fra|deu
returns the structured XHTML manifestation. The EUR-Lex web UI itself answers
202 (queue page) to scripted requests - Cellar is the door, not the website.
"""
import hashlib
import httpx

CELLAR = "http://publications.europa.eu/resource/celex/{celex}"
ISO3 = {"en": "eng", "nl": "nld", "fr": "fra", "de": "deu"}
PUBLIC_URL = "https://eur-lex.europa.eu/legal-content/{LANG}/TXT/?uri=CELEX:{celex}"


async def fetch(celex: str, lang: str, timeout: float = 90.0) -> tuple[str, str]:
    """Return (xhtml, sha256) for one CELEX in one language."""
    headers = {
        "Accept": "application/xhtml+xml",
        "Accept-Language": ISO3.get(lang, "eng"),
    }
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as c:
        r = await c.get(CELLAR.format(celex=celex), headers=headers)
        r.raise_for_status()
        text = r.text
    return text, hashlib.sha256(text.encode("utf-8")).hexdigest()


def public_url(celex: str, lang: str, fragment: str = "") -> str:
    url = PUBLIC_URL.format(LANG=lang.upper(), celex=celex)
    return f"{url}#{fragment}" if fragment else url
