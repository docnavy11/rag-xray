"""Embeddings, loaded lazily and never required.

bge-m3 is 1024-dimensional, which is what `chunk.embedding` already is, and
multilingual across the four languages the Act ships in. A KB whose
retrieval_config never asks for vectors never pays for the model, and a missing
model degrades to lexical rather than failing - which is the honest behaviour for
a demo whose whole claim is that you can see what it is doing.
"""
import logging

from .. import runtime
from ..config import settings

log = logging.getLogger("ragdemo.embed")
_model = None
_tried = False


def available() -> bool:
    return bool(runtime.get("embed_enabled")) and _load() is not None


def _load():
    global _model, _tried
    if _model is not None or _tried:
        return _model
    _tried = True
    if not runtime.get("embed_enabled"):
        return None
    try:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(settings.embed_model)
        log.info("embeddings ready: %s", settings.embed_model)
    except Exception as exc:
        log.warning("embeddings unavailable (%s) - falling back to lexical", exc)
        _model = None
    return _model


def embed_one(text: str) -> list[float] | None:
    m = _load()
    if m is None:
        return None
    return m.encode(text, normalize_embeddings=True).tolist()


def embed_many(texts: list[str], batch_size: int = 16) -> list[list[float]] | None:
    m = _load()
    if m is None:
        return None
    return m.encode(texts, normalize_embeddings=True,
                    batch_size=batch_size, show_progress_bar=False).tolist()
