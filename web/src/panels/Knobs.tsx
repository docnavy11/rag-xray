import { useState } from 'react'
import type { Lesson, RetrievalConfig } from '../lib/api'
import { Copy, Seg, Slider, Toggle } from '../ui/controls'

/** One level of nesting merged rather than replaced — the same rule the API's
 *  `merged()` applies, so what the panel shows is what the server will run. */
export function mergeCfg(base: RetrievalConfig, changes: Partial<RetrievalConfig>): RetrievalConfig {
  const out: any = JSON.parse(JSON.stringify(base ?? {}))
  for (const [k, v] of Object.entries(changes ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = { ...out[k], ...(v as object) }
    } else {
      out[k] = v
    }
  }
  return out as RetrievalConfig
}

type Group = 'query' | 'ranking' | 'structure' | 'answer'

type Knob = {
  key: string
  group: Group
  label: string
  hint: string
  lesson?: string
  render: (cfg: RetrievalConfig, set: (p: Partial<RetrievalConfig>) => void, accent: string) => React.ReactNode
}

const bool = (
  key: string, group: Group, label: string, hint: string,
  get: (c: RetrievalConfig) => boolean, set: (v: boolean) => Partial<RetrievalConfig>,
  lesson?: string,
): Knob => ({
  key, group, label, hint, lesson,
  render: (cfg, apply, accent) => (
    <Toggle on={get(cfg)} accent={accent} onClick={() => apply(set(!get(cfg)))} />
  ),
})

export const KNOBS: Knob[] = [
  {
    key: 'mode', group: 'query', label: 'Retrieval mode',
    hint: 'Lexical is Postgres full-text search. A vector run needs embeddings enabled on the server; when they are not, the run simply does not appear in the trace.',
    render: (cfg, apply, accent) => (
      <Seg value={cfg.mode} accent={accent} onChange={v => apply({ mode: v })} options={[
        { v: 'lexical', label: 'lexical' }, { v: 'vector', label: 'vector' }, { v: 'hybrid', label: 'hybrid' },
      ]} />
    ),
  },
  bool('expand', 'query', 'Query expansion',
    "Ask a cheap model to say the question again in the corpus's own vocabulary, and search both.",
    c => !!c.expand, v => ({ expand: v }), 'expand'),
  bool('stopwords', 'query', 'Corpus stopwords',
    'Strip the words that describe the whole corpus. Postgres full-text search has no IDF, so it cannot do this on its own.',
    c => !!c.corpus_stopwords?.enabled, v => ({ corpus_stopwords: { enabled: v } as any }), 'search'),
  {
    key: 'df', group: 'query', label: 'Stopword threshold',
    hint: 'A lexeme in more than this share of the corpus is stripped from queries. Derived per KB at ingest, because the threshold means nothing across corpora.',
    lesson: 'search',
    render: (cfg, apply, accent) => (
      <Slider value={cfg.corpus_stopwords?.df_threshold ?? 0.22} min={0.05} max={0.6} step={0.01}
        accent={accent} format={v => `${Math.round(v * 100)}%`}
        onChange={v => apply({ corpus_stopwords: { df_threshold: v } as any })} />
    ),
  },
  bool('context_run', 'query', 'Search the prior turn',
    'A follow-up carries its subject in the turn before it. That goes in as another run rather than replacing the question.',
    c => !!c.context_run, v => ({ context_run: v })),
  {
    key: 'fusion', group: 'ranking', label: 'Fusion',
    hint: 'How the separate runs are combined into one ranking.',
    lesson: 'fuse',
    render: (cfg, apply, accent) => (
      <Seg value={cfg.fusion} accent={accent} onChange={v => apply({ fusion: v })}
        options={[{ v: 'rrf', label: 'RRF' }, { v: 'concat', label: 'concat' }]} />
    ),
  },
  {
    key: 'rrf_k', group: 'ranking', label: 'RRF k',
    hint: 'Each result scores 1/(k+rank) per run, summed. A larger k flattens the advantage of being first.',
    lesson: 'fuse',
    render: (cfg, apply, accent) => (
      <Slider value={cfg.rrf_k ?? 60} min={1} max={200} step={1} accent={accent}
        onChange={v => apply({ rrf_k: v })} />
    ),
  },
  bool('length_norm', 'ranking', 'Length normalisation',
    'ts_rank_cd scaled by document length, so a 20,000-character definitions article stops outranking the paragraph that answers.',
    c => !!c.length_norm, v => ({ length_norm: v ? 33 : 0 }), 'search'),
  {
    key: 'top_k', group: 'ranking', label: 'Passages kept',
    hint: 'How many passages survive into the context. The pipeline returns a few more than this, so cross-references have room.',
    render: (cfg, apply, accent) => (
      <Slider value={cfg.top_k ?? 10} min={2} max={30} step={1} accent={accent}
        onChange={v => apply({ top_k: v })} />
    ),
  },
  {
    key: 'recital', group: 'ranking', label: 'Recital weight',
    hint: 'Recitals explain the law and impose nothing, so they are held below the binding text rather than removed.',
    render: (cfg, apply, accent) => (
      <Slider value={cfg.kind_weights?.recital ?? 1} min={0} max={1} step={0.05} accent={accent}
        format={v => v.toFixed(2)}
        onChange={v => apply({ kind_weights: { ...(cfg.kind_weights ?? {}), recital: v } })} />
    ),
  },
  bool('named_paths', 'structure', 'Named provisions',
    'A question that names a provision gets that provision, ahead of anything a search scored.',
    c => !!c.named_paths, v => ({ named_paths: v })),
  bool('structural_expansion', 'structure', 'Follow cross-references',
    'Pull in what the top hits point at. A provision that says "subject to Article 6(3)" is incomplete without it.',
    c => !!c.structural_expansion, v => ({ structural_expansion: v })),
  bool('as_of_filter', 'structure', 'Time filter',
    'Keep only text in force on the chosen date. Old versions stay in the corpus rather than being deleted.',
    c => !!c.as_of_filter, v => ({ as_of_filter: v })),
  bool('verify_quotes', 'answer', 'Verify every quote',
    'Search for each quoted span, character by character, in the passages actually retrieved. Turn it off to see what the checking was catching.',
    c => c.verify_quotes !== false, v => ({ verify_quotes: v }), 'verify'),
]

const GROUP_LABEL: Record<Group, string> = {
  query: 'The query',
  ranking: 'The ranking',
  structure: 'The corpus structure',
  answer: 'The answer',
}

/** A knob only earns its place when the KB it belongs to can express it: the
 *  recital weight is meaningless on a corpus of transcripts. */
function relevant(k: Knob, base: RetrievalConfig, showAnswer: boolean): boolean {
  if (k.group === 'answer' && !showAnswer) return false
  if (k.key === 'recital') return 'recital' in (base.kind_weights ?? {})
  return true
}

export default function Knobs({ base, changes, onChange, onReset, accent, lessons, showAnswer }: {
  base: RetrievalConfig
  changes: Partial<RetrievalConfig>
  onChange: (patch: Partial<RetrievalConfig>) => void
  onReset: () => void
  accent: string
  lessons?: Record<string, Lesson> | null
  showAnswer?: boolean
}) {
  const [showJson, setShowJson] = useState(false)
  const cfg = mergeCfg(base, changes)
  const dirty = Object.keys(changes ?? {}).length > 0
  const groups: Group[] = ['query', 'ranking', 'structure', 'answer']

  return (
    <div>
      {groups.map(g => {
        const items = KNOBS.filter(k => k.group === g && relevant(k, base, !!showAnswer))
        if (!items.length) return null
        return (
          <div key={g} className="mb-4">
            <div className="mb-[10px] flex items-center gap-[10px]">
              <div className="microlabel">{GROUP_LABEL[g]}</div>
              <div className="h-px grow bg-rule" />
            </div>
            <div className="flex flex-col gap-[11px]">
              {items.map(k => {
                const lesson = k.lesson && lessons ? lessons[k.lesson] : null
                const changed = touched(changes, k.key)
                return (
                  <div key={k.key}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 grow">
                        <div className="flex items-center gap-2 text-[13.5px] leading-tight">
                          <span className={changed ? 'font-semibold' : ''}>{k.label}</span>
                          {changed && (
                            <span className="num text-[9.5px] uppercase tracking-[.1em]" style={{ color: accent }}>
                              changed
                            </span>
                          )}
                        </div>
                        <p className="m-0 mt-[3px] text-[11.5px] leading-[1.45] text-ink3">{k.hint}</p>
                        {lesson && lesson.figures.length >= 2 && (
                          <p className="num m-0 mt-[3px] text-[11px] leading-[1.4] text-ink3">
                            measured here:{' '}
                            {lesson.figures.map((f, i) => (
                              <span key={f.label}>
                                {i > 0 && ' → '}
                                <span style={{ color: f.bad ? 'var(--color-stop)' : f.good ? 'var(--color-ok)' : undefined }}>
                                  {f.value}{f.unit}
                                </span>
                                <span className="text-rule2"> {f.label}</span>
                              </span>
                            ))}
                            {lesson.n != null && <> · n={lesson.n}</>}
                            {lesson.holdout === false && <> · in-sample</>}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 pt-[2px]">{k.render(cfg, onChange, accent)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <button onClick={() => setShowJson(v => !v)}
          className="num cursor-pointer text-[11px] uppercase tracking-[.1em] text-ink3">
          {showJson ? 'hide' : 'show'} the config
        </button>
        <div className="grow" />
        {dirty && (
          <button onClick={onReset} className="num cursor-pointer text-[11px] uppercase tracking-[.1em]"
            style={{ color: accent }}>
            reset to this corpus
          </button>
        )}
      </div>
      {showJson && (
        <div className="mt-2">
          <pre className="scrollthin m-0 max-h-[280px] overflow-auto rounded-[6px] border border-rule bg-surface px-3 py-2 text-[11.5px] leading-[1.6] text-ink2">
{JSON.stringify(cfg, null, 2)}
          </pre>
          <div className="mt-2">
            <Copy accent={accent} label="Copy config_overrides"
              text={JSON.stringify(changes, null, 2)} />
          </div>
        </div>
      )}
    </div>
  )
}

function touched(changes: Partial<RetrievalConfig>, key: string): boolean {
  const c: any = changes ?? {}
  if (key === 'stopwords') return c.corpus_stopwords?.enabled !== undefined
  if (key === 'df') return c.corpus_stopwords?.df_threshold !== undefined
  if (key === 'recital') return c.kind_weights !== undefined
  return c[key] !== undefined
}
