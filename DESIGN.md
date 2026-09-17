# RAG Demo — design

> This is the working design journal, kept as written rather than tidied up
> afterwards, so the measurements and the decisions that went against them stay
> legible. It refers in places to sibling projects that are not public
> (`aiact-kb`, a transcript scraper, an internal documentation tree); those are
> context for how a decision was reached, not dependencies of this repository.

> **Status, 2026-09-15: built and running** at `http://localhost:8041`.
> All four corpora are ingested, the chat runs on the Claude Agent SDK, the X-ray
> and its counterfactuals work, and `POST /v1/eval` measures the pipeline against
> a golden set. See `README.md` for what it measured — the headline is that this
> build does **not** reproduce aiact-kb's 41%/68% fusion spread, and the largest
> measured effect is corpus stopwords (13.6 points), not fusion (4.6).
> Still open: embeddings are off, so the `video` KB's `hybrid` mode runs lexical.

A showcase that answers questions from four different knowledge bases, and a
second screen that shows **exactly how it got the answer** — with the knobs
exposed, so a visitor can turn a decision off and watch the ranking change.

The demo is not a diagram of a pipeline. It is the pipeline, instrumented.

---

## 1. Why this exists, and what makes it different

Most RAG demos show a chatbot and a flowchart. The flowchart is always the same
five boxes and it teaches nothing, because nothing in it can be wrong.

`aiact-kb` is an unusually good basis because it is a **ledger of RAG decisions
that were measured and came out against the textbook**. Those measurements are
the demo's content. Measured 2026-08-27 on a 22-question golden set
(`aiact-kb/eval/`):

| Decision | Measured result |
|---|---|
| lexical only | recall@8 **59%** (13/22) |
| + query expansion, results concatenated | **41%** — *worse than no expansion* |
| + query expansion, results fused by RRF | **68%** (15/22) |
| retrieval-score gate for out-of-scope questions | **abandoned**: adjacent EU law (GDPR, Data Act, Machinery Reg.) scores 0.62–0.78, *above* most in-scope questions; the fitted threshold rejects 2 of 10 |
| corpus stopwords (Postgres FTS has no IDF) | `ai` appears in 626 provisions, `system` in 574; any lexeme above 22% document frequency is stripped from queries |
| phantom citations, 2 models × 14 answers | **0** in every run of every population |

So the second screen's claim is never "best practice says X". It is "we measured
X, here is n, here is the date, here is the counterfactual — run it yourself."

**Audience: layered.** Every explanatory panel carries three reading levels —
*plain / practical / technical* — switchable per panel, reusing the pattern
already built in `AI-readiness/ai-act-readiness.html`. A prospect reads the top
level and sees rigour; a developer opens the bottom level and sees the SQL.

---

## 2. The four knowledge bases

Each is a **different chatbot**: its own name, accent colour, glyph, tagline,
persona prompt, sample questions, tool surface and retrieval config. Choosing
one re-skins the whole app. They are chosen to **fail differently** — the
contrast is the lesson.

| KB | Corpus | Chunker | What it teaches |
|---|---|---|---|
| **EU AI Act** | 3,378 provisions, EN/NL/FR/DE, re-ingested from Cellar | `aiact_structural` | The good case. Structured corpus, lexical retrieval wins, every quote verified against retrieved text, a deterministic classifier the model may not overrule. Time-validity as a *filter*. |
| **AI Act, naive** | *the same corpus*, re-chunked | `fixed_overlap` (≈800 tokens, 15% overlap) | Chunking decides the outcome. Same question, same retriever, two KBs, side by side. Turns a README assertion into something the visitor proves to themselves. |
| **Video transcripts** | Video KB (`scraper/data/app.db`), topic: **AI Automation & Agents** | `transcript_window` | Where lexical breaks, and where *scale* breaks. Spoken, unstructured, stored as flat text with **no timestamps**. Speech says "that thing" where the query says "reciprocal rank fusion". The case for embeddings — and the case for citing something weaker than a clause. |
| **Internal docs** | `infra/` + `internal_tools_reference/` markdown | `markdown_headings` | The ordinary corporate RAG case every visitor recognises. Heading hierarchy as structure, and what happens when the corpus contradicts itself across two documents. |

### 2.1 What the video corpus actually is — measured 2026-09-15

Read directly from `scraper/data/app.db` (read-only), because the design turned
on facts that had been assumed:

| | |
|---|---|
| videos | 2,668 — all YouTube, no TikTok |
| with a usable transcript | 2,435 (>200 chars) |
| total transcript text | 72.6M characters ≈ **18M tokens** |
| mean transcript | ~29,800 characters |
| language | 2,419 `en`, 10 `en-US`, 229 null, 10 `live_chat` |
| topics | 5,279 assigned; largest are Content & SEO (809), No-Code & Tools (730), SaaS & Product (691), AI Automation & Agents (649) |
| timestamps | **none** — `videos.transcript` is one flat `Text` column |

Three consequences for the design:

**Scale is the contrast, not just structure.** 18M tokens against ~100k per
language for the AI Act is a 180× difference in the same demo. Lexical retrieval
degrading as the haystack grows is something a visitor can watch happen, rather
than be told.

**Ingest a subset, not the corpus.** One topic — a few hundred videos — keeps
embedding cost and build time sane and still dwarfs the Act. The full corpus can
be a later switch if it earns it.

**Citations get weaker, and that is the lesson.** With no timestamps, a citation
can only name the video and a character offset. Deep-linking a YouTube time would
mean *estimating* it from position in the transcript — an estimate, and it must
be labelled as one, never rendered as a precise cite. The honest alternative is
re-fetching timestamped captions via `youtube-transcript-api` for the subset
only; all 2,668 are YouTube, so that route is open. Either way, the X-ray screen
should say plainly that this KB cannot offer what the AI Act KB offers. A demo
that shows citation quality varying by corpus teaches more than one where every
answer carries a perfect receipt.

The second and third rows are the demo's two strongest moments, because both
produce a *visibly worse* answer and the X-ray screen says why.

---

## 3. Architecture

### 3.1 A new service — `aiact-kb` is not touched

`aiact-kb` is a separate service already in production, called by another site,
and deleted from prod in error once already (2026-09-03, restored from archive). RAGDemo is standalone, with its own Postgres
and its own corpus. It **vendors and generalises** the retrieval code
(`retrieval.py`, `expand.py`, `cite.py`, `answer.py`) rather than importing from
or calling into the running service. The AI Act corpus is ~100k tokens per
language; re-ingesting it costs one pass over Cellar. Zero coupling to prod.

### 3.2 Data model — `provision` generalises to `chunk`

    kb(slug, name, tagline, accent, glyph, langs[], persona_prompt,
       chunker, retrieval_config jsonb, tools[], sample_questions jsonb)

    chunk(id, kb_id, path, heading, body, kind, lang, meta jsonb,
          valid_from, valid_to, source_url, sort_key,
          ts tsvector, embedding vector(1024))

    chunk_link(kb_id, from_path, to_path, kind)     -- cross-references
    corpus_stopword(kb_id, lang, lexeme, df)        -- per-KB, derived at ingest
    query_expansion(key, value)                     -- cached, as today
    trace(id, kb_id, lang, question, stages jsonb, answer jsonb,
          cost_usd, created_at)

`path` stays the citation key and stays meaningful per corpus:

    art.6.3                          AI Act
    chunk.0417                       AI Act, naive
    vid.dQw4w9WgXcQ@00:14:32         transcript
    infra/runbooks.md#deploying      markdown

Everything corpus-specific goes in `meta`. `valid_from` / `valid_to` stay
first-class because time-validity is not an AI Act quirk — any corpus with
versions has it, and most RAG systems get it wrong by deleting the old text.

### 3.3 The retrieval config *is* the control panel

One JSON object per KB, and every field is one toggle on the X-ray screen:

```json
{ "mode": "hybrid",
  "expand": true,
  "corpus_stopwords": { "enabled": true, "df_threshold": 0.22 },
  "length_norm": 32,
  "fusion": "rrf",
  "rrf_k": 60,
  "kind_weights": { "recital": 0.55 },
  "structural_expansion": true,
  "context_run": true,
  "as_of_filter": true,
  "top_k": 10 }
```

**A counterfactual is the same request with a mutated config.** Retrieval has no
model in it, so counterfactuals are free and near-instant. They stop *before*
the LLM by default and render a rank diff; "…and answer it too" is a separate,
explicit button. This is what lets the demo sit running in front of an audience
without a bill.

### 3.4 The trace bus

A `Trace` object threaded through the pipeline, recording each stage's input,
output, timing and cost. Two surfaces:

    POST /v1/ask?trace=1       full trace on the response
    GET  /v1/ask/stream        SSE: stage events, then answer tokens, then final

Stages:

    question → expand → lexical run ×N → fuse (RRF) → named-path lookup
            → structural expansion → assemble context → model → verify quotes

Every trace is persisted, so **every answer has a permalink**: `/x-ray/<id>` is
shareable. That matters for a showcase — someone can send a colleague the exact
run, not a screenshot.

### 3.4a The chat runs on the Claude Agent SDK

Decided 2026-09-15. This is a different library from the Anthropic API SDK that
`aiact-kb` uses today (`anthropic`): the **Claude Agent SDK**
(`claude-agent-sdk` / `@anthropic-ai/claude-agent-sdk`) is Claude Code packaged
as a library — it supplies the agent loop, context management, hooks, subagents
and permissions, and you host it. It is *not* the API SDK's `tool_runner`, and
the two are easy to confuse.

**What it changes about the demo, and it is an improvement.** Retrieval stops
being a fixed pre-step and becomes a tool the agent *chooses* to call. The X-ray
screen therefore has two tiers: the agent loop on top (turn → tool call → tool
result → turn), and the retrieval pipeline nested inside the tool call. That is
more honest about how the answer was produced, and it shows something a fixed
pipeline diagram cannot — the model deciding what to look up, and sometimes
deciding to look twice.

**Two things to get right at build time:**

- **Disable the built-in tools.** The Agent SDK ships Read/Write/Edit/Bash/
  Glob/Grep/WebSearch/WebFetch. On a demo reachable from the public internet,
  the tool surface must be exactly one thing: `search_kb`, exposed over MCP,
  plus the deterministic `classify_system` engine for the AI Act corpus. Nothing
  that touches the filesystem or the shell. This is a hard gate, not a tidy-up.
- **The per-corpus persona is the system prompt.** Each KB's `persona_prompt`
  becomes the agent's system prompt, and its `tools[]` its tool surface. That is
  what makes four chatbots rather than one with a filter.

Model: `claude-opus-5`. Note this changes the cost picture from the figures in
§1, which were measured on `google/gemini-3.7-flash` and
`anthropic/claude-sonnet-5` through OpenRouter — those numbers do not carry
over and must be re-measured, not scaled.

The Agent SDK is only for this demo. `aiact-kb` in production keeps its current
`anthropic`-SDK answer path untouched.

### 3.5 Embeddings

`bge-m3`, run locally: 1024 dimensions, which matches the `embedding vector(1024)`
column that already exists and has never been used, and multilingual across
EN/NL/FR/DE. **Untested here** — its latency on this box is unmeasured, and
whether hybrid beats lexical on the AI Act corpus is an open question. The demo
is the right instrument to answer it; it must not ship asserting the answer.

---

## 4. UI / UX

### 4.1 Entry — a shelf, not a dropdown

Four cards, each with its own accent, glyph, tagline and three sample questions.
Picking one re-skins header, accent, persona and tool surface. A dropdown reads
as a filter on one product; a shelf reads as four chatbots.

### 4.2 Screen one — Chat

Quiet and clean. The mechanism lives on the other screen; this one has to look
like a product.

- **Pipeline ribbon.** While the answer streams, a thin strip above it fills in
  with real stage timings — `expanded · 3 runs · fused 27→14 · 8.1k tokens in ·
  writing`. Each segment is clickable and deep-links to that stage in the X-ray.
- **Citations as chips.** `[art.50.1]` renders as a chip only when that chunk was
  *actually retrieved* — a path the model produced from memory stays plain text.
  (This rule already exists in the readiness panel and is worth keeping.)
- **Source drawer.** Clicking a chip opens the full source text with **the
  verified span highlighted**. `cite.py` already returns the offsets it computed
  itself, so this is real, not approximate.
- **Unverified quotes are shown, not hidden.** A quote that cannot be found in a
  retrieved chunk gets a visible warning treatment. A guardrail catching
  something is a better demo than a guardrail sitting silent — and there is a
  toggle to switch verification off so a visitor can see the difference.

### 4.3 Screen two — X-ray

Its own route, with an optional split view on wide screens so chat and X-ray
stay linked.

A horizontal stage rail across the top. Selecting a stage opens three things:

1. **The real data** — the expansion terms and where they came from
   (`model` / `cache` / `unavailable`); the actual `tsquery` after stopword
   stripping, with the stripped lexemes shown struck through and their document
   frequencies; each ranked run; the RRF fusion table with per-run contributions;
   the exact document blocks sent to the model with a **token budget bar**.
2. **The knobs** — expansion off, RRF → concat, corpus stopwords off, length
   normalisation off, `as_of` moved. Re-ranks instantly into a two-column diff
   with rank-change arrows.
3. **The evidence card** — what happened when this was measured, at its recorded
   strength: the number, n, the date, and whether it was in-sample. Never "best
   practice says". Three reading levels, per the layered audience.

The assemble stage deserves special attention: the token-budget bar is the
single most misunderstood part of RAG for non-technical viewers, and showing
"this, and only this, is what the model could see" lands harder than any
explanation of embeddings.

---

## 5. Stack and deployment

| | |
|---|---|
| Backend | FastAPI + Postgres/pgvector, reusing the vendored `services/` |
| Chat harness | Claude Agent SDK (`claude-agent-sdk`), built-in tools disabled, `search_kb` over MCP |
| Frontend | Vite + React + TypeScript + Tailwind → `dist/` |
| Design tokens | IBM Plex + the paper/ink palette from `AI-readiness/rag-architecture.html`, so it reads as part of the same family |
| Deploy | `docker compose up -d --build` behind whatever reverse proxy you already run |

The frontend build step is the one divergence from the house style of
self-contained HTML. It is justified by the X-ray inspector, which is genuinely
stateful — streaming, replay, diff views. `deploy.sh` is unchanged either way,
because it ships `dist/`.

---

## 6. Build order

1. **Skeleton + AI Act KB.** Generalise the schema, vendor the services, re-ingest
   the Act, get `/v1/ask` answering. No UI beyond curl.
2. **The trace bus.** Instrument every stage; `?trace=1` returns a complete,
   honest object. This is the foundation — everything visual reads from it.
3. **Chat screen.** Streaming, citation chips, source drawer, pipeline ribbon.
4. **X-ray screen.** Stage rail, real data panels, permalinks.
5. **Counterfactual knobs.** Config mutation endpoint + the rank diff view.
6. **KB two: naive chunking.** Cheapest large win — same corpus, one chunker.
7. **KB three and four.** Transcripts and markdown. Embeddings land here, because
   this is where they are needed and can be measured.
8. **Reading levels.** Plain / practical / technical across every panel.
9. **An eval page.** Re-run the golden set from the UI and show recall@8 move as
   the knobs move. Turns the demo into an instrument.

## 7. Evidence ledger

Everything in §1 is **measured** — `aiact-kb/eval/`, 2026-08-27, n=22 for recall,
n=14 answers per model for the citation counts. In-sample: the golden set was
used to develop the retriever, so 68% is not a holdout figure.

Everything else in this document is **design** — untested. Specifically:
bge-m3's latency here, whether hybrid beats lexical on this corpus, and whether
the naive-chunking KB will visibly lose (expected, unmeasured).

§2.1 is measured — read from the transcript database on 2026-09-15. Note that the
scraper's own HTTP service was *not* reachable at the time, so the SQLite file is
the source, not the API.

## 8. Open

- Timestamps for KB three: estimate them from transcript position (cheap, and
  must be labelled an estimate), re-fetch captions for the subset via
  `youtube-transcript-api` (accurate, costs a pass over a few hundred videos), or
  cite the video only. Decide before ingest — it sets the chunk `path` format.
- The video subset is the **AI Automation & Agents** topic (649 videos, decided
  2026-09-15). That is still ~19M characters, so a cap on video count is needed
  before embedding — the cap itself is not yet decided.
- Public or noindex? The readiness pages ship `noindex, nofollow` as proofs of
  concept. A showcase may want the opposite.
- `/v1/ask` here will be a billable endpoint on the public internet. The rate
  limit + daily budget circuit breaker from `aiact-kb/app/api/v1.py` should be
  carried over on day one, not retrofitted.
