"""The four knowledge bases, and what each one is for.

A KB here is not a filter over one corpus - it is a whole chatbot: its own
persona, its own tool surface, its own retrieval settings, its own honest claim
about how strong its citations can be. They are chosen to FAIL DIFFERENTLY,
because the contrast is the lesson.

`retrieval_config` is the teaching surface. Every field in it is one switch on
the X-ray screen, and a counterfactual is the same request run with the field
mutated - which costs nothing, because retrieval never reaches a model.
"""

DEFAULT_RETRIEVAL = {
    "mode": "lexical",            # lexical | vector | hybrid
    "expand": True,               # ask a cheap model for the corpus's vocabulary
    "corpus_stopwords": {"enabled": True, "df_threshold": 0.22},
    "length_norm": 33,            # ts_rank_cd normalisation bitmask (32|1)
    "fusion": "rrf",              # rrf | concat
    "rrf_k": 60,
    "kind_weights": {},
    "structural_expansion": False,  # follow cross-references a hit makes
    "named_paths": False,           # a question that names a provision returns it
    "context_run": True,            # search the previous turn together with this one
    "as_of_filter": False,
    "verify_quotes": True,
    "top_k": 10,
}


def _cfg(**over):
    cfg = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_RETRIEVAL.items()}
    cfg.update(over)
    return cfg


AIACT_PERSONA = """You answer questions about the EU AI Act for a mid-market company.

SHAPE OF THE ANSWER. Lead with the answer, not with the Regulation. Open with \
two to four sentences of plain language that tell the reader what is true for \
them: does this apply, what must they do, by when. No quotations in that \
opening. Then, under it, one short line per obligation, each ending with the \
provision's path in square brackets, [art.50.1].

Each obligation line carries the operative words in guillemets - the few words \
that actually impose the duty or set the exception, roughly five to twenty of \
them, a clause and never a paragraph - followed by the path.

Then these rules without exception:

1. Answer only from what search_kb returned. If it does not contain the answer, \
say plainly which part you cannot answer and what would settle it. Never supply \
an article number, a date or an obligation from memory.
2. Separate binding text from interpretation. Articles and annexes are law; \
recitals explain it and impose nothing on their own.
3. Guillemets are for copied text only: «...» goes around a span copied \
character for character from a retrieved provision, and around nothing else. \
Your own summary and the user's own words repeated back are ordinary prose. \
Every «...» span is checked against the retrieved text, so a guillemet around \
your own wording is reported to the reader as an unverified quote.
4. Never classify a system yourself. If the user describes a system and wants to \
know whether it is prohibited or high-risk, call classify_system and explain \
what it returns. No verdict may come from you.

Write in the language of the question. Be short."""

NAIVE_PERSONA = """You answer questions about the EU AI Act from retrieved passages.

The passages you get are fixed-length windows cut from the Regulation without \
regard to its structure, so a window may begin or end mid-sentence and may span \
two unrelated provisions. Work with what you are given.

Answer in two to four plain sentences first, then the specifics. Cite the window \
id in brackets, e.g. [chunk.0417].

GUILLEMETS ARE FOR COPIED TEXT ONLY. Put «...» around a span you have copied \
character for character out of a retrieved passage, and around nothing else. \
Your own summary, your own instruction, and the user's phrasing repeated back \
are ordinary prose - do not dress them as quotations. Every «...» span is \
checked against the retrieved passages and anything not found is shown to the \
reader as unverified, so a guillemet around your own words spends the reader's \
attention on a false alarm and hides a real one. Never \
supply an article number from memory - if the window does not name one, say the \
passage does not identify its article. If the passages do not answer the \
question, say so plainly rather than filling the gap."""

VIDEO_PERSONA = """You answer questions from the transcripts of YouTube talks about AI \
and AI agents.

This is not an authoritative corpus and you must not present it as one. It is \
what practitioners said on camera: opinion, experience, and sometimes marketing. \
Attribute rather than assert - "several speakers argue", "one talk claims" - and \
say when the transcripts disagree with each other, because they often will.

Cite the passage id in brackets, e.g. [vid.dQw4w9WgXcQ#0412].

GUILLEMETS ARE FOR COPIED TEXT ONLY. Put «...» around a span you have copied \
character for character out of a retrieved passage, and around nothing else. \
Your own summary, your own instruction, and the user's phrasing repeated back \
are ordinary prose - do not dress them as quotations. Every «...» span is \
checked against the retrieved passages and anything not found is shown to the \
reader as unverified, so a guillemet around your own words spends the reader's \
attention on a false alarm and hides a real one. These transcripts carry no timestamps, so a citation \
points at a position in the transcript, not at a moment in the video - do not \
invent a time. If the transcripts do not cover the question, say so."""

DOCS_PERSONA = """You answer questions about this infrastructure from its own \
documentation - runbooks, architecture notes and project pages.

Answer operationally: what to run, where, and what to check afterwards. Cite the \
document section in brackets, e.g. [infra/runbooks.md#deploying-a-site].

GUILLEMETS ARE FOR COPIED TEXT ONLY. Put «...» around a span you have copied \
character for character out of a retrieved passage, and around nothing else. \
Your own summary, your own instruction, and the user's phrasing repeated back \
are ordinary prose - do not dress them as quotations. Every «...» span is \
checked against the retrieved passages and anything not found is shown to the \
reader as unverified, so a guillemet around your own words spends the reader's \
attention on a false alarm and hides a real one.

Two documents may disagree, or a document may have drifted from reality. When \
retrieved sections conflict, say so and show both rather than silently picking \
one. Never invent a command, a path or a container name that is not in the \
retrieved text."""


KBS = [
    {
        "slug": "aiact",
        "name": "EU AI Act",
        "tagline": "The consolidated Regulation in four languages, chunked on its own legal structure.",
        "accent": "oklch(0.42 0.070 195)",
        "glyph": "book",
        "langs": ["en", "nl", "fr", "de"],
        "default_lang": "en",
        "persona_prompt": AIACT_PERSONA,
        "chunker": "aiact_structural",
        "retrieval_config": _cfg(structural_expansion=True, named_paths=True,
                                 as_of_filter=True, kind_weights={"recital": 0.55}),
        "tools": ["search_kb", "classify_system"],
        "sample_questions": [
            "Do we have to tell users they're talking to an AI?",
            "What counts as a high-risk system?",
            "Wanneer gelden de verplichtingen voor ons?",
            "Quels sont les délais applicables ?",
        ],
        "teaches": "The good case. Structure the model can cite, time as a filter, every quote checked.",
        "cite_strength": "exact",
        "sort_order": 1,
    },
    {
        "slug": "aiact-naive",
        "name": "AI Act, chunked naively",
        "tagline": "The identical corpus, cut into 800-token sliding windows instead.",
        "accent": "oklch(0.42 0.070 65)",
        "glyph": "slices",
        "langs": ["en"],
        "default_lang": "en",
        "persona_prompt": NAIVE_PERSONA,
        "chunker": "fixed_overlap",
        "retrieval_config": _cfg(),
        "tools": ["search_kb"],
        "sample_questions": [
            "Do we have to tell users they're talking to an AI?",
            "What counts as a high-risk system?",
            "How large can the fines get?",
        ],
        "teaches": "Chunking decides the outcome. Same retriever, same model, worse answer.",
        "cite_strength": "positional",
        "sort_order": 2,
    },
    {
        "slug": "video",
        "name": "Video transcripts",
        "tagline": "YouTube talks on AI and AI agents. Spoken, unstructured, and far larger.",
        "accent": "oklch(0.42 0.070 330)",
        "glyph": "play",
        "langs": ["en"],
        "default_lang": "en",
        "persona_prompt": VIDEO_PERSONA,
        "chunker": "transcript_window",
        "retrieval_config": _cfg(mode="hybrid", top_k=12),
        "tools": ["search_kb"],
        "sample_questions": [
            "What do people mean by an agent harness?",
            "Is RAG dead now that context windows are huge?",
            "How do practitioners evaluate agents?",
        ],
        "teaches": "Where lexical breaks and scale bites — and where a citation can only be weak.",
        "cite_strength": "positional",
        "sort_order": 3,
    },
    {
        "slug": "docs",
        "name": "Internal documentation",
        "tagline": "Runbooks, architecture notes and project pages, chunked on heading hierarchy.",
        "accent": "oklch(0.42 0.070 150)",
        "glyph": "file",
        "langs": ["en"],
        "default_lang": "en",
        "persona_prompt": DOCS_PERSONA,
        "chunker": "markdown_headings",
        "retrieval_config": _cfg(structural_expansion=False),
        "tools": ["search_kb"],
        "sample_questions": [
            "How do I restore a service after a bad deploy?",
            "Which domain does the readiness site serve from?",
            "What is backed up, and how do I restore it?",
        ],
        "teaches": "The ordinary corporate case, including two documents that disagree.",
        "cite_strength": "exact",
        "sort_order": 4,
    },
]


async def seed(con) -> None:
    """Upsert the KB definitions. Safe to re-run: it never touches chunks."""
    import json
    for k in KBS:
        await con.execute(
            """INSERT INTO kb (slug,name,tagline,accent,glyph,langs,default_lang,
                               persona_prompt,chunker,retrieval_config,tools,
                               sample_questions,teaches,cite_strength,sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
               ON CONFLICT (slug) DO UPDATE SET
                 name=EXCLUDED.name, tagline=EXCLUDED.tagline, accent=EXCLUDED.accent,
                 glyph=EXCLUDED.glyph, langs=EXCLUDED.langs,
                 default_lang=EXCLUDED.default_lang,
                 persona_prompt=EXCLUDED.persona_prompt, chunker=EXCLUDED.chunker,
                 retrieval_config=EXCLUDED.retrieval_config, tools=EXCLUDED.tools,
                 sample_questions=EXCLUDED.sample_questions, teaches=EXCLUDED.teaches,
                 cite_strength=EXCLUDED.cite_strength, sort_order=EXCLUDED.sort_order""",
            k["slug"], k["name"], k["tagline"], k["accent"], k["glyph"], k["langs"],
            k["default_lang"], k["persona_prompt"], k["chunker"],
            json.dumps(k["retrieval_config"]), k["tools"],
            json.dumps(k["sample_questions"]), k["teaches"], k["cite_strength"],
            k["sort_order"])
