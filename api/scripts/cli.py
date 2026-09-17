"""Command line: seed the knowledge bases and ingest their corpora."""
import asyncio
import logging
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))

from app.db import close, init_schema, pool          # noqa: E402
from app.ingest import pipeline                       # noqa: E402
from app.kbs import seed                              # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


async def main() -> None:
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    await init_schema()
    p = await pool()
    async with p.acquire() as con:
        await seed(con)
    print("knowledge bases seeded")

    if what in ("all", "aiact"):
        print(await pipeline.ingest_aiact())
    if what in ("all", "docs"):
        print(await pipeline.ingest_docs())
    if what in ("all", "video"):
        print(await pipeline.ingest_video())

    p = await pool()
    async with p.acquire() as con:
        rows = await con.fetch(
            """SELECT k.slug, count(c.id) AS chunks,
                      count(DISTINCT c.lang) AS langs,
                      (SELECT count(*) FROM corpus_stopword s WHERE s.kb_id=k.id) AS stop
               FROM kb k LEFT JOIN chunk c ON c.kb_id=k.id
               GROUP BY k.id, k.slug ORDER BY k.sort_order""")
    print("\n  KB              chunks   langs  stopwords")
    for r in rows:
        print(f"  {r['slug']:<14} {r['chunks']:>7}  {r['langs']:>5}  {r['stop']:>9}")
    await close()


asyncio.run(main())
