import { useMemo, useState } from 'react'
import {
  counterfactual, type Counterfactual, type KB, type Lesson, type RetrievalConfig, type Stage,
} from '../lib/api'
import { chatLink, go } from '../lib/router'
import { fmtMs } from '../lib/text'
import Evidence from '../panels/Evidence'
import Knobs, { mergeCfg } from '../panels/Knobs'
import RankDiff from '../panels/RankDiff'
import StageDetail from '../panels/StageDetail'
import Glyph from '../ui/Glyph'
import { Btn, Note, Price, SectionHead, type Level } from '../ui/controls'

export type TraceLike = {
  id?: string
  question: string
  lang: string
  config: RetrievalConfig
  stages: Stage[]
  ms?: number
  cost_usd?: number | null
}

/** The X-ray, as a component rather than a page, so the same thing can be a
 *  route (a permalink to a finished run) and a panel beside a live chat. */
export default function XrayBody({ kb, trace, lessons, level, onLevel, onPath, compact, initialStage }: {
  kb: KB; trace: TraceLike
  lessons: Record<string, Lesson> | null
  level: Level; onLevel: (l: Level) => void
  onPath?: (p: string) => void
  compact?: boolean
  initialStage?: number | null
}) {
  const [sel, setSel] = useState(initialStage ?? 0)
  const [changes, setChanges] = useState<Partial<RetrievalConfig>>({})
  const [cf, setCf] = useState<Counterfactual | null>(null)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const stages = trace.stages ?? []
  const base = (trace.config ?? kb.retrieval_config) as RetrievalConfig
  const dirty = Object.keys(changes).length > 0
  const stage: Stage | undefined = stages[Math.min(sel, stages.length - 1)]

  // A tool call opens a new group; everything after it belongs to that search
  // until the next one. That is the agent loop on top and the retrieval pipeline
  // nested inside it, which is what actually happened.
  const groups = useMemo(() => {
    const out: { label: string; items: { s: Stage; i: number }[] }[] = []
    stages.forEach((s, i) => {
      if (!out.length || s.name === 'tool') {
        out.push({ label: s.name === 'tool' ? `search ${out.filter(g => g.label.startsWith('search')).length + 1}` : 'the turn', items: [] })
      }
      out[out.length - 1].items.push({ s, i })
    })
    return out
  }, [stages])

  async function run() {
    setRunning(true); setErr(null)
    try {
      setCf(await counterfactual({
        kb: kb.slug, q: trace.question, lang: trace.lang, changes,
        baseline_overrides: diffFrom(kb.retrieval_config, base),
      }))
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    }
    setRunning(false)
  }

  return (
    <div className={`grid min-h-0 grow ${compact ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]'}`}>
      <div className="scrollthin min-w-0 overflow-y-auto">
        <div className="border-b border-rule bg-surface px-[18px] py-3">
          <div className="mb-[10px] flex flex-wrap items-center gap-3">
            <div className="microlabel">Agent loop · Claude Agent SDK</div>
            <div className="hidden h-px grow bg-rule sm:block" />
            <div className="num text-[10.5px] text-ink3">
              {stages.filter(s => s.name === 'tool').length} tool call(s) · {stages.length} stages
              {trace.ms != null && <> · {fmtMs(trace.ms)}</>}
            </div>
          </div>
          <div className="scrollthin flex items-stretch gap-[10px] overflow-x-auto pb-1">
            {groups.map((g, gi) => (
              <div key={gi} className="flex shrink-0 items-stretch gap-[5px] rounded-[7px] border border-dashed border-rule p-[5px]">
                <div className="num flex w-[15px] shrink-0 items-end justify-center pb-1 text-[9px] uppercase tracking-[.1em] text-ink3"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  {g.label}
                </div>
                {g.items.map(({ s, i }) => {
                  const on = i === sel
                  return (
                    <button key={i} onClick={() => setSel(i)}
                      className="flex shrink-0 cursor-pointer flex-col gap-[3px] rounded-[6px] border px-[11px] py-[7px] text-left transition-colors"
                      style={on
                        ? { background: kb.accent, borderColor: kb.accent, color: 'var(--color-onaccent)' }
                        : { background: 'var(--color-surface)', borderColor: 'var(--color-rule)' }}>
                      <div className="num text-[9.5px] uppercase tracking-[.1em]"
                        style={{ color: on ? 'var(--color-accentsoft)' : 'var(--color-ink3)' }}>
                        {s.name}
                      </div>
                      <div className="text-[12.5px] font-medium" style={{ color: on ? 'var(--color-onaccent)' : 'var(--color-ink)' }}>
                        {s.label.replace(/^Agent calls /, '')}
                      </div>
                      <div className="num text-[10.5px]" style={{ color: on ? 'var(--color-accentsoft)' : 'var(--color-ink3)' }}>
                        {s.ms != null ? fmtMs(s.ms) : '—'} · {s.summary.slice(0, 34)}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="px-[18px] py-5">
          {!stage ? (
            <p className="text-[14px] text-ink3">This run recorded no stages.</p>
          ) : (
            <>
              <SectionHead n={String(sel + 1).padStart(2, '0')} title={stage.label}
                right={<div className="num text-[11px] text-ink3">{stage.summary}</div>} />
              <StageDetail stage={stage} accent={kb.accent} onPath={onPath} />

              {compact && stage.lesson && (
                <div className="mt-5">
                  <Evidence lesson={stage.lesson} accent={kb.accent} level={level} onLevel={onLevel} compact />
                </div>
              )}
            </>
          )}

          {err && <div className="mt-6"><Note tone="stop">{err}</Note></div>}

          {cf && (
            <div className="mt-8">
              <SectionHead n="CF" title="What that switch did"
                right={
                  <div className="flex flex-wrap items-center gap-3">
                    {Object.keys(cf.changes).map(k => (
                      <span key={k} className="num rounded-[3px] px-[7px] py-[2px] text-[10px] uppercase tracking-[.1em]"
                        style={{ background: 'var(--color-accentsoft)', color: kb.accent }}>{k}</span>
                    ))}
                  </div>
                } />
              <RankDiff cf={cf} accent={kb.accent} onPath={onPath} />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Btn accent={kb.accent} kind="quiet"
                  onClick={() => go(chatLink(kb.slug, trace.question, changes))}>
                  <Glyph name="send" className="h-[13px] w-[13px]" />
                  …and answer it with these settings
                </Btn>
                <Price free={false} note="this one costs" />
              </div>
            </div>
          )}
        </div>
      </div>

      {!compact && (
        <aside className="scrollthin flex flex-col gap-4 overflow-y-auto border-t border-rule bg-surface px-5 py-5 lg:border-t-0 lg:border-l">
          <div>
            <div className="mb-3 flex items-center gap-[10px]">
              <Glyph name="sliders" className="h-[15px] w-[15px]" stroke={kb.accent} />
              <div className="microlabel">Turn a decision off</div>
              <div className="h-px grow bg-rule" />
            </div>

            <Knobs base={base} changes={changes} accent={kb.accent} lessons={lessons}
              onChange={p => setChanges(c => merge(c, p))} onReset={() => { setChanges({}); setCf(null) }} />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Btn accent={kb.accent} onClick={run} disabled={!dirty} busy={running}>
                Re-rank
              </Btn>
              <Price free />
            </div>
            <p className="mt-2 mb-0 text-[11.5px] leading-[1.5] text-ink3">
              Re-ranking is retrieval only — no answer is generated. The first comparison on
              a brand-new question warms the query expansion (one cheap call); every
              comparison after that is free and instant.
            </p>
          </div>

          {stage?.lesson && (
            <Evidence lesson={stage.lesson} accent={kb.accent} level={level} onLevel={onLevel} />
          )}
        </aside>
      )}
    </div>
  )
}

function merge(a: Partial<RetrievalConfig>, b: Partial<RetrievalConfig>): Partial<RetrievalConfig> {
  const out: any = { ...a }
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = { ...out[k], ...(v as object) }
    } else out[k] = v
  }
  return out
}

/** What this trace's config differs by from the KB's own — so a counterfactual
 *  run from a modified trace compares against the run that actually happened,
 *  not against the corpus default. */
function diffFrom(kbCfg: RetrievalConfig, used: RetrievalConfig): Partial<RetrievalConfig> {
  const out: any = {}
  const merged = mergeCfg(kbCfg, {})
  for (const [k, v] of Object.entries(used ?? {})) {
    if (JSON.stringify((merged as any)[k]) !== JSON.stringify(v)) out[k] = v
  }
  return out
}
