"""Postgres access and schema.

Generalised from aiact-kb's single `provision` table: one `chunk` table holds
every corpus, keyed by `kb_id`, so language / kind / validity filters apply
*before* ranking rather than after, and one retrieval implementation serves all
four knowledge bases.

What stayed first-class rather than being pushed into `meta`:

  path        the citation key. Meaningful per corpus (`art.50.1`,
              `infra/runbooks.md#deploying`, `vid.<id>#0412`) and what makes a
              citation checkable instead of decorative.
  valid_from  time-validity is not an AI Act quirk. Any corpus with versions has
  valid_to    it, and the common failure is deleting superseded text - which
              also destroys the ability to say what changed.
"""
import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None

REGCONFIG = {"en": "english", "nl": "dutch", "fr": "french", "de": "german"}

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS vector;

-- One row per knowledge base. Identity (name, accent, glyph, persona) and
-- behaviour (chunker, retrieval_config, tools) live together, because in this
-- demo they are the same decision: a KB *is* a chatbot.
CREATE TABLE IF NOT EXISTS kb (
  id                bigserial PRIMARY KEY,
  slug              text NOT NULL UNIQUE,
  name              text NOT NULL,
  tagline           text NOT NULL,
  accent            text NOT NULL,
  glyph             text NOT NULL,
  langs             text[] NOT NULL DEFAULT '{en}',
  default_lang      text NOT NULL DEFAULT 'en',
  persona_prompt    text NOT NULL,
  chunker           text NOT NULL,
  retrieval_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
  tools             text[] NOT NULL DEFAULT '{}',
  sample_questions  jsonb NOT NULL DEFAULT '[]'::jsonb,
  teaches           text NOT NULL DEFAULT '',
  cite_strength     text NOT NULL DEFAULT 'exact',  -- exact | positional | document
  sort_order        int  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chunk (
  id          bigserial PRIMARY KEY,
  kb_id       bigint NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
  source_id   text NOT NULL,           -- celex, repo path, video id
  version     text NOT NULL DEFAULT '',
  lang        text NOT NULL,
  tier        text NOT NULL DEFAULT 'binding',
  kind        text NOT NULL,           -- article | annex | recital | section | window
  path        text NOT NULL,           -- the citation key
  sort_key    text NOT NULL,
  heading     text,
  body        text NOT NULL,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from  date NOT NULL DEFAULT '2000-01-01',
  valid_to    date,
  amended_by  text,
  mod_op      text,
  source_url  text NOT NULL DEFAULT '',
  ts          tsvector,
  embedding   vector(1024),
  UNIQUE (kb_id, source_id, version, lang, path)
);

CREATE INDEX IF NOT EXISTS chunk_ts_idx     ON chunk USING gin (ts);
CREATE INDEX IF NOT EXISTS chunk_filter_idx ON chunk (kb_id, lang, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS chunk_path_idx   ON chunk (kb_id, path);
CREATE INDEX IF NOT EXISTS chunk_sort_idx   ON chunk (kb_id, lang, sort_key);

CREATE TABLE IF NOT EXISTS chunk_link (
  kb_id     bigint NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
  from_path text NOT NULL,
  to_path   text NOT NULL,
  kind      text NOT NULL,
  PRIMARY KEY (kb_id, from_path, to_path, kind)
);

-- Lexemes so common in THIS corpus that they carry no signal. Postgres text
-- search has no IDF, so in a corpus entirely about "AI systems" the term
-- "AI system" ranks everything equally and therefore ranks nothing. Derived per
-- KB at ingest, because the threshold means nothing across corpora.
CREATE TABLE IF NOT EXISTS corpus_stopword (
  kb_id  bigint NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
  lang   text NOT NULL,
  lexeme text NOT NULL,
  df     int  NOT NULL,
  PRIMARY KEY (kb_id, lang, lexeme)
);

CREATE TABLE IF NOT EXISTS query_expansion (
  key     text PRIMARY KEY,
  value   jsonb NOT NULL,
  made_at timestamptz NOT NULL DEFAULT now()
);

-- Every answered question keeps its trace, so /x-ray/<id> is a permalink
-- somebody can send to a colleague rather than a screenshot.
CREATE TABLE IF NOT EXISTS trace (
  id         text PRIMARY KEY,
  kb_id      bigint NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
  lang       text NOT NULL,
  question   text NOT NULL,
  stages     jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer     jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_usd   double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trace_time_idx ON trace (created_at DESC);

CREATE TABLE IF NOT EXISTS ask_log (
  id       bigserial PRIMARY KEY,
  ip_hash  text NOT NULL,
  asked_at timestamptz NOT NULL DEFAULT now(),
  kb_slug  text,
  model    text,
  cost_usd double precision
);

CREATE INDEX IF NOT EXISTS ask_log_ip_time_idx ON ask_log (ip_hash, asked_at DESC);

-- Bookings taken by the MCP server's book_appointment tool.
--
-- Not a RAG table, and deliberately so: the thing an integration client
-- actually buys is one agent that can both answer from the corpus *and* act.
-- Retrieval alone never writes anything down, so a demo made only of search
-- tools cannot show the half of the job that has consequences.
--
-- `slot` is unique so double-booking is refused by the database rather than by
-- a check the tool could race with itself on under concurrent callers.
CREATE TABLE IF NOT EXISTS appointment (
  id         bigserial PRIMARY KEY,
  slot       timestamptz NOT NULL UNIQUE,
  name       text NOT NULL,
  email      text NOT NULL,
  topic      text,
  kb_slug    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointment_slot_idx ON appointment (slot);

-- The document vault: what a user actually put in, before it was cut up.
--
-- `chunk` holds the retrievable pieces; this holds the thing they came from, so
-- a corpus can be re-chunked under a different chunker without re-uploading,
-- and so a passage can be traced back to the file it was cut out of.
CREATE TABLE IF NOT EXISTS document (
  id          bigserial PRIMARY KEY,
  kb_id       bigint NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
  source_id   text NOT NULL,               -- stable per KB; also the chunk source_id
  title       text NOT NULL,
  lang        text NOT NULL DEFAULT 'en',
  media_type  text NOT NULL DEFAULT 'text/markdown',
  bytes       int  NOT NULL DEFAULT 0,
  sha256      text NOT NULL DEFAULT '',
  body        text NOT NULL,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  chunks      int  NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'pending',   -- pending|ready|failed
  error       text,
  url         text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  ingested_at timestamptz,
  UNIQUE (kb_id, source_id)
);

CREATE INDEX IF NOT EXISTS document_kb_idx ON document (kb_id, created_at DESC);

-- Long-running work started from the UI. Uploading forty files should not hold
-- a request open, and the screen that started it needs something to poll.
CREATE TABLE IF NOT EXISTS ingest_job (
  id          text PRIMARY KEY,
  kb_id       bigint REFERENCES kb(id) ON DELETE CASCADE,
  kind        text NOT NULL,                 -- documents | reindex | stopwords
  status      text NOT NULL DEFAULT 'queued',-- queued|running|done|failed
  total       int  NOT NULL DEFAULT 0,
  done        int  NOT NULL DEFAULT 0,
  message     text NOT NULL DEFAULT '',
  error       text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS ingest_job_time_idx ON ingest_job (started_at DESC);

-- Conversations survive the tab being closed. A tool people come back to has to
-- still have their work in it; a demo can get away with losing it.
CREATE TABLE IF NOT EXISTS conversation (
  id         text PRIMARY KEY,
  kb_id      bigint NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT '',
  pinned     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_time_idx ON conversation (updated_at DESC);

CREATE TABLE IF NOT EXISTS message (
  id              bigserial PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  role            text NOT NULL,
  content         text NOT NULL,
  trace_id        text,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_conv_idx ON message (conversation_id, id);

-- Settings changed from the Settings screen. Env vars stay the defaults; a row
-- here overrides one, so a deployment can still be configured the usual way and
-- an operator can still change the model without a redeploy.
CREATE TABLE IF NOT EXISTS app_setting (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Where documents come from, and how often to go and look again.
--
-- A source is a connector plus a schedule. `kind` decides how items are
-- fetched: a directory on this machine, a URL, or a tool call against an
-- external MCP server. The config is per-kind and deliberately not modelled in
-- columns - an MCP server's tool names are its own business.
CREATE TABLE IF NOT EXISTS source (
  id            bigserial PRIMARY KEY,
  kb_id         bigint NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL,                    -- mcp | filesystem | http
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  every_minutes int  NOT NULL DEFAULT 0,          -- 0 = only when asked
  enabled       boolean NOT NULL DEFAULT true,
  prune         boolean NOT NULL DEFAULT false,   -- delete what vanished upstream
  lang          text NOT NULL DEFAULT '',
  last_run_at   timestamptz,
  next_run_at   timestamptz,
  last_status   text NOT NULL DEFAULT '',
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_due_idx ON source (enabled, next_run_at);

-- One row per sync, so "it says it synced" can be checked rather than believed.
CREATE TABLE IF NOT EXISTS source_run (
  id          bigserial PRIMARY KEY,
  source_id   bigint NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  trigger     text NOT NULL DEFAULT 'schedule',   -- schedule | manual
  status      text NOT NULL DEFAULT 'running',    -- running | done | failed
  added       int NOT NULL DEFAULT 0,
  updated     int NOT NULL DEFAULT 0,
  unchanged   int NOT NULL DEFAULT 0,
  removed     int NOT NULL DEFAULT 0,
  failed      int NOT NULL DEFAULT 0,
  message     text NOT NULL DEFAULT '',
  error       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS source_run_idx ON source_run (source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS source_snapshot (
  kb_id      bigint NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
  source_id  text NOT NULL,
  lang       text NOT NULL,
  sha256     text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kb_id, source_id, lang)
);
"""


async def pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=8)
    return _pool


# Columns added after the first release. Separate from SCHEMA because
# CREATE TABLE IF NOT EXISTS will not add a column to a table that already
# exists, and dropping the table to get one would throw away the corpus.
MIGRATIONS = [
    "ALTER TABLE document ADD COLUMN IF NOT EXISTS source_id_ref bigint",
    "ALTER TABLE document ADD COLUMN IF NOT EXISTS external_id text NOT NULL DEFAULT ''",
    "ALTER TABLE document ADD COLUMN IF NOT EXISTS external_rev text NOT NULL DEFAULT ''",
    "CREATE INDEX IF NOT EXISTS document_source_idx ON document (source_id_ref)",
]


async def init_schema() -> None:
    p = await pool()
    async with p.acquire() as con:
        await con.execute(SCHEMA)
        for stmt in MIGRATIONS:
            await con.execute(stmt)


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
