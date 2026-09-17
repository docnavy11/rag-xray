import logging
import pathlib

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import runtime, scheduler
from .api.admin import router as admin_router
from .api.v1 import router
from .db import close, init_schema, pool
from .kbs import seed

log = logging.getLogger("ragdemo")
app = FastAPI(title="RAG X-Ray",
              description="Four corpora, one pipeline, and a screen that shows "
                          "what the pipeline actually did.",
              version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])
app.include_router(router)
app.include_router(admin_router)


@app.get("/health")
async def health():
    return {"ok": True}


@app.on_event("startup")
async def startup():
    await init_schema()
    p = await pool()
    async with p.acquire() as con:
        await seed(con)
    await runtime.load()
    scheduler.start()


@app.on_event("shutdown")
async def shutdown():
    await scheduler.stop()
    await close()


# The built frontend is served from the same origin as the API, so there is one
# port to expose and no CORS in the path a visitor actually uses. Mounted last so
# it never shadows /v1 or /health.
WEB = pathlib.Path(__file__).resolve().parents[2] / "web" / "dist"
if WEB.is_dir():
    app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")

    # Asset filenames carry a content hash, so they are safe to cache forever.
    # index.html is NOT: it names the current bundle, and a cached copy pins a
    # browser to a build that no longer exists. Observed 2026-09-15 - a visitor
    # kept getting the previous UI across three rebuilds because FastAPI sent
    # only an etag and the browser reused the stale HTML.
    NO_STORE = {"Cache-Control": "no-store, must-revalidate"}

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        """Every non-API path renders the app; routing happens in the browser."""
        candidate = WEB / full_path
        if full_path and candidate.is_file():
            immutable = full_path.startswith("assets/")
            return FileResponse(
                candidate,
                headers={"Cache-Control": "public, max-age=31536000, immutable"}
                        if immutable else NO_STORE)
        return FileResponse(WEB / "index.html", headers=NO_STORE)
else:
    log.warning("no built frontend at %s - run `npm run build` in web/", WEB)
