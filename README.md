# RAG X-Ray

Four knowledge bases, one retrieval pipeline, and a second screen that shows
exactly how each answer was produced — with a switch beside every decision, so
you can turn one off and watch the ranking move.

MIT licensed. Built as a showcase, then turned into something usable: you can
put your own documents in it, point it at a source that syncs on a schedule, and
watch every retrieval decision it makes.

## What this is for

**A workbench for experimenting with RAG approaches and the Claude Agent SDK.**
Not a product, and not built for production: no accounts, no tenancy, one shared
instance with one key, and no operational story for backups, upgrades or scale.
Run it on your own machine, point it at your own documents, and use it to find
out how retrieval behaves before you commit to a design somewhere that matters.

That framing is the point rather than a disclaimer. The things it is good for:

- **Trying a retrieval decision and seeing what it costs you.** Turn query
  expansion off, swap RRF for concatenation, move the stopword threshold, and
  watch the ranking diff and recall@k move. Every one of those is free — nothing
  but answering reaches a model.
- **Comparing chunking on a corpus you care about.** Upload the same documents
  twice under different chunkers and put them side by side.
- **Seeing what an agent loop actually does.** The chat runs on the Claude Agent
  SDK, so retrieval is a tool the model chooses to call, once or four times, and
  the X-ray shows each call and the pipeline nested inside it.
- **Checking whether the answer is supported.** Every quoted span is verified
  against the passages actually retrieved, and a citation to anything unretrieved
  renders as plain text rather than as a source.

If you take ideas from here into production, take the measurements and the
architecture — the quote verification, the per-corpus stopwords, the trace bus —
and leave the deployment model behind.

## Quickstart

Needs Docker (for Postgres + pgvector), Python 3.12+ with [uv], Node 20+, and a
Claude credential — either `ANTHROPIC_API_KEY` in `api/.env`, or an already
logged-in Claude Code CLI, which the Agent SDK picks up on its own.

    cp api/.env.example api/.env     # edit ASK_IP_SALT; the rest has defaults
    ./run.sh                         # postgres + api + the built frontend, one port
    ./ingest.sh aiact                # build the EU AI Act corpora (~one pass over Cellar)

Then open **http://localhost:8041**. Retrieval, the X-ray, chunking comparison
and evaluation cost nothing and need no credential at all; only answering calls
a model.

`./ingest.sh` builds two more corpora — video transcripts and a markdown
documentation tree — from paths you set as `VIDEO_DB` and `DOC_ROOTS`. Both skip
cleanly when unset, so a fresh clone works without them. Or skip the bundled
corpora entirely: make your own from the UI and upload documents into it.

[uv]: https://docs.astral.sh/uv/

## Before you expose this

Read this bit. The reading surface — asking, searching, opening a trace — is
meant to be reachable. The administering surface is not, and the defaults assume
you might forget:

- **Administration is trusted from localhost and needs `API_KEY` from anywhere
  else.** With no key set there is no remote administration at all. A proxy
  header (`x-forwarded-for`) counts as remote, so a caller cannot claim to be
  local.
- **`ALLOW_LOCAL_EXEC=false` by default.** Sources of kind `filesystem`, and MCP
  servers over stdio, let this process read host files and run host commands. On
  a single-user local install you want them; with them on, admin access *is*
  command execution as the user running the server. Never on a shared host.
- **`ALLOW_PRIVATE_NETWORK=false` by default**, so a source cannot be pointed at
  your internal network or at a cloud metadata endpoint.
- **CORS is `*` and there are no user accounts.** This is one shared instance
  with one key, not a multi-tenant application. Put it behind your own
  authentication if it needs to be more than that.
- Documents you ingest are shown to the model. Treat an untrusted corpus as
  untrusted input: it can attempt to steer an answer, which is why every quote is
  checked against retrieved text and a citation to anything unretrieved is
  rendered as plain text rather than as a source.

The per-caller log stores a salted hash of the address, never the address.
Change `ASK_IP_SALT` per deployment.

## What the corpora are, and whose they are

This repository ships ingest code, not corpora. What `./ingest.sh` fetches:

- **EU AI Act** — from EUR-Lex/Cellar. EU legislation, reusable under the
  Commission's reuse policy, attribution expected.
- **Video transcripts** — YouTube transcripts from a local scraper database you
  supply. Third-party content: whether you may ingest and store it is your call
  to make, not this repository's.
- **Documentation** — whatever markdown tree you point `DOC_ROOTS` at.

Running at **http://localhost:8041** (bound to every interface).

    ./run.sh          # postgres + api + the built frontend, one port
    ./ingest.sh       # seed the knowledge bases and fetch their corpora

## What is in it

| KB | Corpus | Chunker | What it is for |
|---|---|---|---|
| `aiact` | Consolidated EU AI Act, **3,362 chunks**, en/nl/fr/de | legal structure | The good case: structure the model can cite, time as a filter, every quote checked |
| `aiact-naive` | *The same English text*, **108 chunks** | 800-token sliding windows | The control group. Same retriever, same model, worse answer |
| `video` | 300 YouTube talks on AI and AI agents, **6,636 passages** | sentence-aware windows | Where lexical breaks and scale bites — and where a citation can only be weak |
| `docs` | 135 infra/runbook markdown files, **577 sections** | heading hierarchy | The ordinary corporate case, including documents that disagree |

Each KB is a different chatbot: its own persona, tool surface, retrieval config,
accent colour, and its own honest claim about how strong its citations can be.

## The chat runs on the Claude Agent SDK

Retrieval is a **tool the model chooses to call**, not a step that happens to it.
The X-ray shows that choice — and shows it searching twice when the first result
did not answer.

The Agent SDK is Claude Code as a library, so it ships Read/Write/Edit/Bash/
Glob/Grep/WebSearch/WebFetch. All of them are off:

- `allowed_tools` is a whitelist of exactly the MCP tools (`search_kb`, plus
  `classify_system` on the AI Act).
- every built-in is *additionally* named in `disallowed_tools`. This is not
  belt-and-braces: measured 2026-09-15, the built-in `ToolSearch` ran on the
  first turn despite the whitelist. The whitelist alone does not close the
  surface.
- `setting_sources=[]`, so it never loads this machine's settings, CLAUDE.md or
  MCP servers.

It authenticates the way the Claude Code CLI does, so no `ANTHROPIC_API_KEY` is
needed when the CLI is logged in. Query expansion goes through the same harness
for the same reason: one credential path, so an expansion outage cannot be
mistaken for "this corpus does not cover your question".

## Integrations beyond the browser demo

The Agent SDK's MCP server in `chat/tools.py` is in-process - only the demo's
own agent can call it. Two more surfaces exist for everything else:

- **`POST /v1/ask`** - the same agent, one request/response instead of an SSE
  stream. For n8n, Zapier, Make, or any plain HTTP client that wants a
  grounded, cited JSON answer without parsing events. Gated by an optional
  `X-API-Key` header (`API_KEY` in `.env`; unset = open, the local/dev default).
- **`app/mcp/server.py`** - a standalone MCP server, separate from the demo's
  internal one, exposing five tools. Three are the knowledge base:
  `list_knowledge_bases`, `search_kb` (retrieval only, free) and
  `ask_knowledge_base` (the full cited answer). Two are not RAG at all:
  `list_appointments` and `book_appointment`, which writes a row to
  `appointment`. Run `python -m app.mcp.server` for stdio (Claude Desktop,
  Cursor - see the docstring for the config entry) or `--http` for streamable
  HTTP on `MCP_HTTP_PORT` (default 8143; what n8n's MCP node needs). Shares
  the same daily budget and rate limits as every other caller.

Both are additions on top of the existing pipeline, not a second one - same
retrieval, same citation verification, same trace persisted to `trace`.

The booking tools are there because a server that can only search is a search
box with extra steps. The integration most clients actually describe is one
agent that answers from the corpus *and* acts on the answer - reads the
policy, then books the call about it - and that needs both halves on the same
connection. They are a working example of the second half, not a mock: the
slot is `UNIQUE`, so a double-booking is refused by Postgres rather than by a
check that races itself.

### The n8n sample

`integrations/n8n-ragdemo-sample.json` imports into n8n as two independent
branches - keep either, delete the other:

- **HTTP Request → `POST /v1/ask`**, then a check on `unverified_quotes`
  before the answer is allowed downstream. Note the 120s timeout: an ask takes
  20-60 seconds and n8n's 10s default would abort a good answer.
- **AI Agent + MCP Client node**, which hands the model all five tools and
  lets it decide when to search and when to book.

If n8n runs in Docker, `localhost` is the container - use
`host.docker.internal` or the host's LAN address. Branch B additionally needs
`MCP_HTTP_HOST=0.0.0.0`: the MCP server binds `127.0.0.1` by default, which a
container cannot reach. The API on 8041 already binds `0.0.0.0`, so branch A
works unchanged.

Tested against n8n 2.39.6: all 16 nodes resolve, and branch A was executed end
to end (HTTP request through the verification gate). Branch B's nodes and
parameters were validated against the node registry, but the agent was not run
- that needs a model credential.

## The retrieval config is the teaching surface

One JSON object per KB. Every field is one switch on the X-ray:

```json
{ "mode": "lexical", "expand": true, "fusion": "rrf", "rrf_k": 60,
  "corpus_stopwords": {"enabled": true, "df_threshold": 0.22},
  "length_norm": 33, "kind_weights": {"recital": 0.55},
  "structural_expansion": true, "named_paths": true,
  "context_run": true, "as_of_filter": true, "top_k": 10 }
```

A counterfactual is the same request with one field changed. `POST
/v1/counterfactual` runs both and returns the rank diff. Retrieval never reaches
a model, so a comparison is instant and free — *once the query expansion for that
question is cached*. The first comparison on a brand-new question pays for one
cheap call, and the response says so (`"free": false`) rather than claiming $0.00.

## What this build measures

`POST /v1/eval` runs a 22-question golden set through any configuration. Measured
on **this** build, 2026-09-15, recall@8 on the AI Act:

| Configuration | recall@8 |
|---|---|
| as configured | **59.1%** (13/22) |
| corpus stopwords off | **45.5%** (10/22) |
| query expansion off | **54.5%** (12/22) |
| concatenated instead of fused | **54.5%** (12/22) |
| length normalisation off | 59.1% — no change on this set |

**These are in-sample.** The golden set was used to develop the retriever this one
is descended from, so they are development figures, not holdout results.

**They do not reproduce the numbers this project was designed from.** `aiact-kb`
measured 59% lexical-only, 41% concatenated and 68% fused by RRF on the same 22
questions (2026-08-27). Here the direction holds — fusing beats concatenating —
but the spread is 4.6 points, not 27. The two are not the same experiment: a
different expansion model through a different provider, and a slightly different
parse of the corpus (3,362 chunks here against 3,378 there). The X-ray screen
shows this build's figures and attributes the earlier ones separately.

The largest measured effect here is the one that sounds least interesting:
stripping corpus stopwords is worth 13.6 points. Postgres full-text search has no
IDF, so in a corpus entirely about AI systems the word "ai" (618 of 849 English
provisions) ranks everything equally and therefore ranks nothing.

## Endpoints

    GET  /v1/kbs                    the four knowledge bases and their configs
    POST /v1/search                 retrieval + full trace, no model, no limit
    POST /v1/counterfactual         run twice, diff the rankings
    POST /v1/ask/stream             the chat, SSE: stages, then the answer
    GET  /v1/trace/{id}             a permalink to one run
    POST /v1/eval                   recall@k over the golden set
    GET  /v1/chunk/{kb}/{path}      one passage, exactly
    GET  /v1/lessons                every claim the X-ray makes, with provenance
    GET  /v1/dashboard              corpora, spend, recent runs, running jobs
    POST /v1/kbs                    make a corpus  (PATCH/DELETE /v1/kbs/{slug})
    POST /v1/kbs/{slug}/documents   upload files; indexes in a background job
    POST /v1/kbs/{slug}/reindex     re-cut the stored documents
    GET  /v1/jobs/{id}              progress of one ingest job
    GET  /v1/settings               live settings  (PUT to change, DELETE to reset)
    GET  /v1/mcp                    client config for Claude Desktop / Cursor
    GET  /v1/conversations          saved chats  (POST to create, /messages to append)
    GET  /v1/traces                 every answered question
    GET  /v1/source-kinds           connector kinds, presets, scheduler state
    POST /v1/kbs/{slug}/sources     connect a source  (PATCH/DELETE /v1/sources/{id})
    POST /v1/sources/discover       list an MCP server's tools before configuring
    POST /v1/sources/preview        dry run: what it would fetch, nothing written
    POST /v1/sources/{id}/sync      run one now
    GET  /v1/sources/{id}/runs      what each sync actually did

## Layout

    api/app/engine/     retrieval, expansion, quote verification, the trace bus
    api/app/chat/       the Agent SDK harness, its two tools, the classifier
    api/app/ingest/     Cellar fetch, the four chunkers, the pipeline
    api/app/kbs.py      the four built-in knowledge bases, as data
    api/app/api/admin.py  corpora, the vault, jobs, settings, history
    api/app/ingest/documents.py  the generic path: your files into any corpus
    api/app/runtime.py  settings an operator can change while it runs
    api/app/ingest/sources.py    connectors, hashing, pruning
    api/app/ingest/mcpclient.py  the app as an MCP *client*
    api/app/scheduler.py         the tick that runs what is due
    web/src/screens/    Shelf, Chat, Retrieval, Xray, Compare, Evaluate,
                        Findings, Integrations — one per route
    web/src/panels/     Knobs, StageDetail, Evidence, RankDiff, SourceDrawer
    web/src/lib/        the typed API client, the hash router, span location
    mockups/            the design canvas the screens were drawn from

## Screens

    #/                      dashboard — what is in here, what it cost, what ran
    #/corpora               every corpus, and the form that makes another
    #/corpus/<slug>         one corpus: the document vault, what it became, its settings
    #/kb/<slug>             chat — streams, cites, verifies, saves the conversation
    #/kb/<slug>/retrieval   the same pipeline with the answer taken off the end (free)
    #/x-ray/<trace>[/<n>]   a permalink to one run, optionally at one stage
    #/history               conversations to pick back up, and every answered question
    #/compare               two or three corpora on the same question
    #/evaluate              recall@k over the golden set, under any configuration
    #/findings              the measurement ledger, at its recorded strength
    #/api                   endpoints, a console for the free ones, MCP client config
    #/settings              models, limits, budget, API key — live, no redeploy

A chat link may carry the question, the settings it was asked under, or a
conversation to resume — `#/kb/aiact?q=...&cfg={"expand":false}`, `?c=<id>`.

## Your own documents

The four built-in corpora are ingested from their own sources by `./ingest.sh`.
Everything else is done from the app:

1. **Corpora → New corpus.** Pick a chunker: heading hierarchy for docs and
   runbooks, fixed windows for anything, transcript windows for speech.
2. **Drop files in.** Markdown, plain text, HTML, CSV, JSON and PDF. The text is
   stored first and indexed in a background job, so a large batch cannot be lost
   to a timed-out request.
3. The corpus derives its **own stopwords** from what you gave it, and the
   passages are citable immediately.

The original text is kept in `document`, so changing the chunker and pressing
**Re-cut everything** gives different passages from the same files — no
re-upload. A PDF that is a scan is refused rather than stored as empty text;
there is no OCR here.

## Appearance

Bottom of the sidebar, on every screen: **light / dark / follow the system**, and
**A− / A+** from 80% to 160%. Both are remembered per browser in
`localStorage`, and an inline script in `index.html` applies them before first
paint so a dark user never gets a white flash on load.

Two things worth knowing about how this is built:

- **Dark is a redefinition, not a second stylesheet.** Every colour in the app is
  a token in `index.css`; dark mode redefines the tokens and nothing else. It is
  declared twice — once under `prefers-color-scheme` (guarded, so choosing Light
  on a dark machine actually works) and once under `[data-theme="dark"]`.
- **A+ scales the interface, not only the type.** Every size in this app is in
  px, deliberately, so a root font-size would move nothing. `body` is zoomed
  instead, which scales the px themselves and keeps the proportions the screens
  were drawn at; full-height panes use `.h-app`, which divides `100dvh` by the
  zoom so the window does not overflow.

Corpus accents come out of the database as `oklch(...)` chosen for white text on
a white page, so they are lightened in dark mode (`accentFor` in
`web/src/lib/theme.ts`) and the text on them flips to `--color-onaccent`.

## Sources and the scheduler

A corpus can pull documents instead of waiting to be given them. A **source** is
a connector plus an interval, configured under a corpus's **Sources** tab:

| Kind | What it is |
|---|---|
| `filesystem` | A directory on the machine running the API. |
| `http` | A list of URLs, fetched each time. HTML is stripped to text. |
| `mcp` | Tools on an external MCP server — over stdio, HTTP or SSE. |

The MCP kind is the general one: **Test connection** lists the server's actual
tools, and you choose which one lists documents and which one reads them, rather
than the app guessing. `read_prefix` joins a bare name from the listing back onto
the path the read tool wants.

Verified here, against `@modelcontextprotocol/server-filesystem` over stdio:
discovery (14 tools), a dry run, a manual sync and two scheduled syncs, the
second of which reported `1 added · 0 updated · 2 unchanged`. **Google Drive is a
preset, not a tested path** — it needs a Drive MCP server you run and
authenticate yourself, and this machine has no Drive credentials, so the preset
is labelled *shape only* in the UI.

What a sync does, and does not do:

- Every item is hashed; unchanged ones are skipped, so re-running costs nothing
  and changes nothing.
- A changed item is re-cut and re-indexed in place, keeping its citation id.
- Documents are only deleted when **prune** is on for that source — and a
  listing that comes back empty prunes nothing, so an upstream outage cannot
  empty a corpus.
- Corpus stopwords are re-derived once per sync, only if something changed.

The scheduler is one task inside the API process, ticking every 30 seconds.
**Nothing syncs while the server is down**; anything that fell due meanwhile runs
once shortly after it comes back, and missed intervals are not replayed.

## Known limits

- **Embeddings are off.** `EMBED_ENABLED=false`; the `video` KB is configured
  `hybrid` but runs lexical-only until bge-m3 is installed. Whether hybrid beats
  lexical on any of these corpora is **not measured**.
- **An answer costs real money.** Measured here: $0.22–$0.70 per question on
  `claude-opus-5`, 22–74s, depending on how many times the agent chooses to
  search. The daily budget defaults to $5, which is roughly a dozen questions.
  Counterfactuals and search are free and unlimited.
- **Query expansion runs once per turn, not once per search.** Measured
  2026-09-15: one expansion costs 8–13s, because the Agent SDK spawns a CLI
  subprocess per call, and the agent re-phrases its query on every search — so
  four searches meant four expansions, 29s of a 74s answer. It now expands the
  *user's* question once and reuses it, which took the same question from 74s to
  22–33s. The finding underneath is worth stating plainly: with an agent in the
  loop, expanding the agent's own query is largely redundant, because the agent
  has already translated the question into the corpus's vocabulary. Expansion
  earns its place on what the human typed, not on what the agent asked.
- **The video corpus has no timestamps** — the source stores transcripts as one
  flat text column — so a citation there points at a position in the transcript,
  never at a moment in the video.
- **The naive KB derives 180 corpus stopwords from 108 windows.** The same 22%
  threshold behaves completely differently on few large chunks than on many small
  ones. That is a real property of the method, left visible rather than tuned away.

## Licence

MIT — see [LICENSE](LICENSE).
