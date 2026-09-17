"""The trace bus.

Every stage of answering records what went in, what came out and how long it
took. This is not logging: the trace is the product. The X-ray screen renders it,
`/x-ray/<id>` is a permalink to it, and a counterfactual is a second trace run
with one setting changed.

A stage carries its own `detail` payload, shaped for the panel that renders it,
plus a `lesson` key naming which measured finding that stage exists because of.
The lessons live in one place (`LESSONS`) so the prose can never drift from the
number it claims, and each records its own strength - n, date, and whether it was
in-sample - because a summary may not be more confident than its measurement.
"""
import time
import uuid
from typing import Any

# Every claim the X-ray screen makes, with its provenance attached. Anything not
# in here is design, not measurement, and must be labelled as such in the UI.
LESSONS: dict[str, dict] = {
    "expand": {
        "title": "Ask twice: once in the user's words, once in the corpus's",
        "plain": "People do not write the way a corpus does. Asking the question a "
                 "second time in the corpus's own vocabulary finds passages the "
                 "original wording misses entirely.",
        "practical": "Measured on this build: 59.1% recall@8 with expansion, 54.5% "
                     "without. Every miss it recovers is a vocabulary gap - 'tell "
                     "users they are talking to an AI' against 'interact directly "
                     "with natural persons'.",
        "technical": "A cheap model maps the question onto the legislator's register. "
                     "Its TERMS are good; its CITATIONS are not - asked where the "
                     "fines live it answered art.71 and art.72 (they are in Article "
                     "99) and three of five guessed paths did not exist. So guessed "
                     "paths are ranked last and only fill space nothing else claimed.",
        "source": "this build, POST /v1/eval",
        "n": 22, "measured": "2026-09-15", "holdout": False,
        "figures": [
            {"label": "expansion off", "value": 54.5, "unit": "% recall@8", "bad": True},
            {"label": "expansion on", "value": 59.1, "unit": "% recall@8", "good": True},
        ],
        "prior": "aiact-kb measured 59% lexical-only on the same 22 questions "
                 "(2026-08-27), through a different provider and a slightly "
                 "different parse of the corpus.",
    },
    "fuse": {
        "title": "Fuse the rankings; do not concatenate them",
        "plain": "Two ways of combining the same two searches. One made the results "
                 "worse than not searching twice at all; the other made them better.",
        "practical": "Measured on this build: fusing by reciprocal rank reaches "
                     "59.1% recall@8; concatenating the same two runs reaches "
                     "54.5%. Same searches, same corpus - only the way they are "
                     "combined differs.",
        "technical": "RRF scores each result 1/(k+rank) per run and sums, k=60. No "
                     "score normalisation and no weight to justify. Concatenating put "
                     "the expansion model's guessed article numbers ahead of measured "
                     "hits, displacing real ones out of the window.",
        "source": "this build, POST /v1/eval",
        "n": 22, "measured": "2026-09-15", "holdout": False,
        "figures": [
            {"label": "concatenated", "value": 54.5, "unit": "% recall@8", "bad": True},
            {"label": "fused by RRF", "value": 59.1, "unit": "% recall@8", "good": True},
        ],
        "prior": "aiact-kb measured a much wider gap on these same 22 questions "
                 "(41% concatenated vs 68% fused, 2026-08-27). This build does "
                 "NOT reproduce that spread - the direction holds, the magnitude "
                 "does not. It runs a different expansion model through a "
                 "different provider, so the two are not the same experiment.",
    },
    "search": {
        "title": "Postgres full-text search has no IDF",
        "plain": "In a corpus entirely about AI systems, the words 'AI' and 'system' "
                 "describe everything, so they rank everything equally - and "
                 "therefore rank nothing.",
        "practical": "Any word appearing in more than 22% of the corpus is derived "
                     "at ingest and stripped from queries. Measured on this build, "
                     "that single step is worth more than anything else here: "
                     "59.1% recall@8 with it, 45.5% without.",
        "technical": "Three corrections, each from a measurement: plainto_tsquery ANDs "
                     "every term so a question matches nothing - its normalised output "
                     "is turned into an OR query; ts_rank_cd normalisation 32|1 scales "
                     "by length so a 20,000-character definitions article stops "
                     "outranking the paragraph that answers; and corpus stopwords are "
                     "per-KB, because the threshold means nothing across corpora.",
        "source": "this build, POST /v1/eval",
        "n": 22, "measured": "2026-09-15", "holdout": False,
        "figures": [
            {"label": "stopwords off", "value": 45.5, "unit": "% recall@8", "bad": True},
            {"label": "stopwords on", "value": 59.1, "unit": "% recall@8", "good": True},
        ],
        "prior": "Length normalisation is in the same query and measured as no "
                 "change on this set (59.1% either way) - it is kept because a "
                 "null result on 22 questions is not evidence of no effect.",
    },
    "assemble": {
        "title": "This, and only this, is what the model could see",
        "plain": "The model has no memory of the corpus and no access to the web. If a "
                 "passage is not in this list, it could not have read it.",
        "practical": "Which is why a citation to anything outside the retrieved set is "
                     "reported to you rather than rendered as if it were a source.",
        "technical": "Chunks go in as separate document blocks with their path and "
                     "in-force context written into the body text, not only into "
                     "metadata - a path carried only as metadata does not survive "
                     "every provider, and the model then improvises one.",
        "source": "aiact-kb/app/services/answer.py",
        "n": None, "measured": "2026-08-27", "holdout": False,
        "figures": [],
    },
    "verify": {
        "title": "Quotes are checked, not trusted",
        "plain": "Every quoted phrase is searched for, character by character, in the "
                 "passages that were actually retrieved. One that cannot be found is "
                 "shown to you as unverified.",
        "practical": "Native API citations are produced by the model and taken on "
                     "trust. These are checked. A fabricated quote becomes a fact "
                     "about the response instead of a plausible sentence.",
        "technical": "The haystack includes the heading, not just the body: measured "
                     "on a near-miss question, the one quote reported unverified was "
                     "the heading of the provision the answer was correctly relying "
                     "on - text the model had been given, flagged as if invented.",
        "source": "aiact-kb/app/services/cite.py",
        "n": None, "measured": "2026-08-27", "holdout": False,
        "figures": [],
    },
    "gate": {
        "title": "There is no retrieval-score gate, and that was measured",
        "plain": "The obvious way to reject an off-topic question is to check whether "
                 "retrieval found anything good. It does not work.",
        "practical": "Adjacent EU law - GDPR, the Data Act, the Machinery Regulation - "
                     "is what a user of an AI Act tool actually asks out of scope, and "
                     "those questions score 0.62-0.78, ABOVE most real ones, because "
                     "they share the corpus's whole vocabulary. The fitted threshold "
                     "rejected 2 of 10.",
        "technical": "Eight of ten lexically alien questions scored zero only because "
                     "the expansion model returned no terms - a model judgment wearing "
                     "a numeric costume, indistinguishable from the empty terms an API "
                     "error also returns. The gate would have turned an expansion "
                     "outage into 'the AI Act does not cover your question'. The "
                     "defence is behavioural instead: the model declining, and every "
                     "quote checked.",
        "source": "aiact-kb/eval/bench_gate.py",
        "n": 32, "measured": "2026-08-27", "holdout": False,
        "figures": [],
    },
    "agent": {
        "title": "Retrieval is a tool the agent chooses to call",
        "plain": "Nothing here forces a search. The model is given one tool and decides "
                 "whether, and how often, to reach for it.",
        "practical": "Which means you can watch it decide - and sometimes watch it "
                     "search twice because the first result did not answer the "
                     "question.",
        "technical": "The Claude Agent SDK supplies the loop. Its built-in file and "
                     "shell tools are disabled outright; the surface is exactly "
                     "search_kb, plus the deterministic classify_system engine on the "
                     "AI Act corpus, which the model may call but may never overrule.",
        "source": "this codebase — api/app/chat/agent.py",
        "n": None, "measured": None, "holdout": None,
        "figures": [],
    },
}


class Stage:
    def __init__(self, name: str, label: str, lesson: str | None = None):
        self.name = name
        self.label = label
        self.lesson = lesson
        self.t0 = time.perf_counter()
        self.ms: float | None = None
        self.detail: dict[str, Any] = {}
        self.summary: str = ""

    def done(self, summary: str = "", **detail) -> "Stage":
        self.ms = round((time.perf_counter() - self.t0) * 1000, 1)
        self.summary = summary
        self.detail.update(detail)
        return self

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "ms": self.ms,
            "summary": self.summary,
            "detail": self.detail,
            "lesson": LESSONS.get(self.lesson) if self.lesson else None,
            "lesson_key": self.lesson,
        }


class Trace:
    """One question's worth of evidence."""

    def __init__(self, kb_slug: str, question: str, lang: str, config: dict):
        self.id = uuid.uuid4().hex[:12]
        self.kb_slug = kb_slug
        self.question = question
        self.lang = lang
        self.config = config
        self.stages: list[Stage] = []
        self.t0 = time.perf_counter()
        self.cost_usd: float | None = None
        self.input_tokens = 0
        self.output_tokens = 0

    def stage(self, name: str, label: str, lesson: str | None = None) -> Stage:
        s = Stage(name, label, lesson)
        self.stages.append(s)
        return s

    @property
    def ms(self) -> float:
        return round((time.perf_counter() - self.t0) * 1000, 1)

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "kb": self.kb_slug,
            "question": self.question,
            "lang": self.lang,
            "config": self.config,
            "stages": [s.as_dict() for s in self.stages],
            "ms": self.ms,
            "cost_usd": self.cost_usd,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
        }
