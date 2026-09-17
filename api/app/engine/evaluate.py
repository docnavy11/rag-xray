"""Recall@k over the golden set, under any retrieval config.

This is what turns the demo into an instrument rather than a display: the same
switches the X-ray exposes can be measured, here, on this corpus, instead of
being asserted from a number measured somewhere else.

The set is inherited from aiact-kb and is IN-SAMPLE - it was used to develop this
retriever - so a figure from it is a development figure, never a holdout result,
and every caller of this module is expected to say so.
"""
import asyncio

from .goldens import GOLDENS
from . import retrieval


def _hit(want: list[str], got: list[str]) -> bool:
    """A golden is satisfied when any acceptable path is retrieved. Prefix
    matching, because `art.5.1` is answered by `art.5.1a` after the Omnibus
    renumbered it."""
    for w in want:
        for g in got:
            if g == w or g.startswith(w + ".") or g.startswith(w):
                return True
    return False


async def run(kb: dict, cfg: dict, *, k: int = 8, langs: list[str] | None = None,
              concurrency: int = 4) -> dict:
    items = [g for g in GOLDENS if not langs or g["lang"] in langs]
    sem = asyncio.Semaphore(concurrency)

    async def one(g: dict) -> dict:
        async with sem:
            rows = await retrieval.retrieve(kb, g["q"], lang=g["lang"], cfg=cfg)
        got = [r["path"] for r in rows][:k]
        return {"q": g["q"], "lang": g["lang"], "want": g["want"],
                "got": got, "hit": _hit(g["want"], got)}

    results = await asyncio.gather(*(one(g) for g in items))
    hits = sum(1 for r in results if r["hit"])
    return {
        "k": k,
        "n": len(results),
        "hits": hits,
        "recall": round(hits / len(results), 4) if results else 0.0,
        "in_sample": True,
        "results": results,
    }
