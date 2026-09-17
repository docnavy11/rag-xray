"""The thing that goes back and looks again.

One asyncio task in the API process, waking every TICK seconds to run whatever
is due. Deliberately not a cron daemon and not a queue: the scheduler has to be
understandable from the screen that shows it, and "next run at" on a row is
something a person can check.

What that costs, stated plainly: nothing runs while this process is not running.
Anything that fell due while it was down runs within TICK seconds of it coming
back, once - missed intervals are not replayed, because running the same sync
six times to catch up would do nothing except six times.
"""
import asyncio
import contextlib
import logging

log = logging.getLogger("ragdemo.scheduler")

TICK = 30
_task: asyncio.Task | None = None
_running: set[int] = set()


async def _tick() -> None:
    from .db import pool
    from .ingest import sources

    p = await pool()
    async with p.acquire() as con:
        due = await con.fetch(
            """SELECT id, name FROM source
               WHERE enabled AND every_minutes > 0
                 AND (next_run_at IS NULL OR next_run_at <= now())
               ORDER BY next_run_at NULLS FIRST LIMIT 10""")

    for row in due:
        sid = row["id"]
        if sid in _running:
            continue                     # a slow source must not stack up on itself
        _running.add(sid)

        async def run(source_id=sid, name=row["name"]):
            try:
                out = await sources.sync(source_id, trigger="schedule")
                log.info("synced %s: %s", name, out.get("message") or out.get("error"))
            except Exception:
                log.exception("scheduled sync failed for %s", name)
            finally:
                _running.discard(source_id)

        asyncio.create_task(run())


async def _loop() -> None:
    log.info("source scheduler started, ticking every %ss", TICK)
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            raise
        except Exception:                # a bad tick must not end the scheduler
            log.exception("scheduler tick failed")
        await asyncio.sleep(TICK)


def start() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())


async def stop() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _task
        _task = None


def status() -> dict:
    return {
        "running": bool(_task and not _task.done()),
        "tick_seconds": TICK,
        "in_flight": sorted(_running),
    }
