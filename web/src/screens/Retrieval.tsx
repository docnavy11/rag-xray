import { useEffect, useState } from 'react'
import {
  counterfactual, search, type Counterfactual, type KB, type Lesson,
  type RetrievalConfig, type SearchResult, type Stage,
} from '../lib/api'
import { chatLink, go } from '../lib/router'
import { fmtInt, fmtMs, today } from '../lib/text'
import Evidence from '../panels/Evidence'
import Knobs, { mergeCfg } from '../panels/Knobs'
import RankDiff from '../panels/RankDiff'
import SourceDrawer from '../panels/SourceDrawer'
import StageDetail from '../panels/StageDetail'
import Glyph from '../ui/Glyph'
import { Btn, Note, Price, SectionHead, Seg, Spinner, Tag, type Level } from '../ui/controls'

/** Retrieval with the answer taken off the end.
 *
 *  Nothing on this screen reaches the answer model, so a visitor can turn every
 *  switch as often as they like. It is the honest place to explore the pipeline:
 *  what the chat screen shows afterwards is this, plus a model reading it. */
export default function Retrieval({ kb, lessons, level, onLevel }: {
  kb: KB; lessons: Record<string, Lesson> | null
  level: Level; onLevel: (l: Level) => void
}) {
  const [input, setInput] = useState(kb.sample_questions[0] ?? '')
  const [q, setQ] = useState(kb.sample_questions[0] ?? '')
  const [lang, setLang] = useState(kb.default_lang)
  const [asOf, setAsOf] = useState(today())
  const [useAsOf, setUseAsOf] = useState(false)
  const [changes, setChanges] = useState<Partial<RetrievalConfig>>({})
  const [res, setRes] = useState<SearchResult | null>(null)
  const [cf, setCf] = useState<Counterfactual | null>(null)
  const [busy, setBusy] = useState(false)
  const [cfBusy, setCfBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'hits' | 'pipeline'>('hits')
  const [sel, setSel] = useState(0)
  const [open, setOpen] = useState<string | null>(null)

  const cfg = mergeCfg(kb.retrieval_config, changes)
  const dirty = Object.keys(changes).length > 0

  useEffect(() => {
    setInput(kb.sample_questions[0] ?? ''); setQ(kb.sample_questions[0] ?? '')
    setLang(kb.default_lang); setChanges({}); setRes(null); setCf(null)
  }, [kb.slug])

  useEffect(() => {
    if (!q.trim()) return
    let live = true
    setBusy(true); setErr(null)
    search({
      kb: kb.slug, q, lang,
      as_of: useAsOf && cfg.as_of_filter ? asOf : null,
      config_overrides: changes,
    })
      .then(r => { if (live) { setRes(r); setSel(0) } })
      .catch(e => live && setErr(String(e.message ?? e)))
      .finally(() => live && setBusy(false))
    return () => { live = false }
    // The knobs deliberately do NOT re-run on change: a search is cheap but not
    // free to the eye, and re-ranking under your hands hides which change did it.
  }, [kb.slug, q, lang, useAsOf, asOf])

  async function rerun() {
    setBusy(true); setErr(null)
    try { setRes(await search({ kb: kb.slug, q, lang, as_of: useAsOf && cfg.as_of_filter ? asOf : null, config_overrides: changes })) }
    catch (e) { setErr(String((e as Error).message ?? e)) }
    setBusy(false)
  }

  async function compare() {
    setCfBusy(true); setErr(null)
    try {
      setCf(await counterfactual({
        kb: kb.slug, q, lang, as_of: useAsOf && cfg.as_of_filter ? asOf : null, changes,
      }))
    } catch (e) { setErr(String((e as Error).message ?? e)) }
    setCfBusy(false)
  }

  const stages: Stage[] = res?.trace?.stages ?? []
  const stage = stages[Math.min(sel, Math.max(stages.length - 1, 0))]

  return (
    <div className="flex min-h-0 grow">
      <div className="flex min-w-0 grow flex-col">
        <div className="shrink-0 border-b border-rule bg-surface px-[18px] py-3">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <Glyph name="lab" className="h-[17px] w-[17px]" stroke={kb.accent} />
            <div className="text-[14.5px] font-semibold">Retrieval lab · {kb.name}</div>
            <Price free />
            <div className="grow" />
            {kb.langs.length > 1 && (
              <select value={lang} onChange={e => setLang(e.target.value)}
                className="num cursor-pointer rounded-[4px] border border-rule bg-surface px-2 py-1 text-[11px] text-ink2">
                {kb.langs.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            )}
            {cfg.as_of_filter && (
              <label className="num flex items-center gap-[6px] text-[11px] text-ink2">
                <input type="checkbox" checked={useAsOf} onChange={e => setUseAsOf(e.target.checked)} />
                as of
                <input type="date" value={asOf} disabled={!useAsOf} onChange={e => setAsOf(e.target.value)}
                  className="num rounded-[4px] border border-rule bg-surface px-[6px] py-[2px] text-[11px] disabled:opacity-50" />
              </label>
            )}
          </div>

          <form onSubmit={e => { e.preventDefault(); setQ(input) }}
            className="flex items-center gap-3 rounded-[8px] border border-rule2 bg-surface px-[14px] py-[8px]">
            <input value={input} onChange={e => setInput(e.target.value)}
              placeholder="Search this corpus — no model, no cost…"
              className="grow border-0 bg-transparent text-[15px] outline-none placeholder:text-ink3" />
            <button type="submit" className="grid h-[28px] w-[28px] place-items-center rounded-[5px]"
              style={{ background: kb.accent }}>
              {busy ? <Spinner accent="var(--color-onaccent)" /> : <Glyph name="send" className="h-[14px] w-[14px]" stroke="var(--color-onaccent)" />}
            </button>
          </form>

          <div className="mt-2 flex flex-wrap gap-2">
            {kb.sample_questions.map(s => (
              <button key={s} onClick={() => { setInput(s); setQ(s) }}
                className="cursor-pointer rounded-[5px] border px-3 py-[5px] text-[12.5px]"
                style={s === q
                  ? { background: 'var(--color-accentsoft)', borderColor: 'var(--color-accentline)', color: kb.accent }
                  : { borderColor: 'var(--color-rule)', color: 'var(--color-ink2)' }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="scrollthin min-h-0 grow overflow-y-auto px-[18px] py-5">
          {err && <div className="mb-4"><Note tone="stop">{err}</Note></div>}

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Seg value={tab} accent={kb.accent} size="md" onChange={setTab} options={[
              { v: 'hits', label: `Ranked passages${res ? ` · ${res.count}` : ''}` },
              { v: 'pipeline', label: `The pipeline${stages.length ? ` · ${stages.length}` : ''}` },
            ]} />
            <div className="grow" />
            {res && (
              <div className="num text-[11px] text-ink3">
                {fmtMs(res.trace.ms)} · no model called · $0.00
              </div>
            )}
          </div>

          {tab === 'hits' && (
            res ? (
              <div className="flex flex-col gap-2">
                {res.hits.map((h, i) => (
                  <div key={h.path} className="rounded-[7px] border border-rule bg-surface px-4 py-3">
                    <div className="mb-[6px] flex flex-wrap items-center gap-2">
                      <span className="num w-5 text-[11.5px] text-ink3">{i + 1}</span>
                      <button onClick={() => setOpen(h.path)}
                        className="num cursor-pointer text-[12.5px] font-medium hover:underline" style={{ color: kb.accent }}>
                        {h.path}
                      </button>
                      <Tag tone="quiet">{h.kind}</Tag>
                      {h.score != null && <span className="num text-[11px] text-rule2">{h.score.toFixed(5)}</span>}
                      <span className="num text-[11px] text-ink3">{fmtInt(h.body.length)} ch</span>
                      {i >= (cfg.top_k ?? 10) && <Tag tone="warn">beyond top_k</Tag>}
                    </div>
                    {h.heading && <div className="mb-[6px] text-[13px] font-semibold leading-snug">{h.heading}</div>}
                    <p className="m-0 text-[13px] leading-[1.55] text-ink2">
                      {h.body.slice(0, 320)}{h.body.length > 320 && <span className="text-ink3">…</span>}
                    </p>
                  </div>
                ))}
                {!res.hits.length && (
                  <Note tone="warn">
                    Nothing matched. That is a real outcome and the pipeline reports it rather
                    than filling the gap — the tab beside this one shows where it emptied out.
                  </Note>
                )}
              </div>
            ) : <div className="py-10 text-center text-[14px] text-ink3">Searching…</div>
          )}

          {tab === 'pipeline' && (
            stages.length ? (
              <>
                <div className="scrollthin mb-5 flex items-stretch gap-[6px] overflow-x-auto pb-1">
                  {stages.map((s, i) => (
                    <button key={i} onClick={() => setSel(i)}
                      className="flex shrink-0 cursor-pointer flex-col gap-[3px] rounded-[6px] border px-[11px] py-[7px] text-left"
                      style={i === sel
                        ? { background: kb.accent, borderColor: kb.accent, color: 'var(--color-onaccent)' }
                        : { background: 'var(--color-surface)', borderColor: 'var(--color-rule)' }}>
                      <div className="num text-[9.5px] uppercase tracking-[.1em]"
                        style={{ color: i === sel ? 'var(--color-accentsoft)' : 'var(--color-ink3)' }}>{s.name}</div>
                      <div className="text-[12.5px] font-medium" style={{ color: i === sel ? 'var(--color-onaccent)' : 'var(--color-ink)' }}>
                        {s.label}
                      </div>
                      <div className="num text-[10.5px]" style={{ color: i === sel ? 'var(--color-accentsoft)' : 'var(--color-ink3)' }}>
                        {fmtMs(s.ms)} · {s.summary.slice(0, 30)}
                      </div>
                    </button>
                  ))}
                </div>
                {stage && (
                  <>
                    <SectionHead n={String(sel + 1).padStart(2, '0')} title={stage.label}
                      right={<div className="num text-[11px] text-ink3">{stage.summary}</div>} />
                    <StageDetail stage={stage} accent={kb.accent} onPath={setOpen} />
                  </>
                )}
              </>
            ) : <div className="py-10 text-center text-[14px] text-ink3">No stages yet.</div>
          )}

          {cf && (
            <div className="mt-8">
              <SectionHead n="CF" title="As configured, against your changes" />
              <RankDiff cf={cf} accent={kb.accent} onPath={setOpen} />
            </div>
          )}
        </div>
      </div>

      <aside className="scrollthin hidden w-[392px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-rule bg-surface px-5 py-5 lg:flex">
        <div>
          <div className="mb-3 flex items-center gap-[10px]">
            <Glyph name="sliders" className="h-[15px] w-[15px]" stroke={kb.accent} />
            <div className="microlabel">The pipeline's decisions</div>
            <div className="h-px grow bg-rule" />
          </div>

          <Knobs base={kb.retrieval_config} changes={changes} accent={kb.accent} lessons={lessons}
            onChange={p => setChanges(c => ({ ...c, ...p }))} onReset={() => { setChanges({}); setCf(null); }} />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Btn accent={kb.accent} onClick={rerun} busy={busy}>Search with these</Btn>
            <Btn accent={kb.accent} kind="quiet" onClick={compare} disabled={!dirty} busy={cfBusy}>
              Diff against the corpus default
            </Btn>
          </div>
          <div className="mt-2"><Price free /></div>

          <div className="mt-3">
            <Btn accent={kb.accent} kind="soft" onClick={() => go(chatLink(kb.slug, q, changes))}>
              <Glyph name="send" className="h-[13px] w-[13px]" />
              Answer this with these settings
            </Btn>
            <p className="mt-2 mb-0 text-[11.5px] leading-[1.5] text-ink3">
              That one calls the model and counts against the demo's daily budget.
            </p>
          </div>
        </div>

        {stage?.lesson && (
          <Evidence lesson={stage.lesson} accent={kb.accent} level={level} onLevel={onLevel} />
        )}
      </aside>

      {open && <SourceDrawer kb={kb} path={open} lang={lang} onClose={() => setOpen(null)} />}
    </div>
  )
}
