import { useEffect, useMemo, useRef, useState } from 'react'
import {
  appendMessages, ask, createConversation, getConversation,
  type Citation, type Final, type KB, type Lesson, type RetrievalConfig, type Stage,
} from '../lib/api'
import { go } from '../lib/router'
import { fmtMs, fmtUsd, today } from '../lib/text'
import Knobs, { mergeCfg } from '../panels/Knobs'
import SourceDrawer from '../panels/SourceDrawer'
import Glyph from '../ui/Glyph'
import { Note, Price, Spinner, Tag, type Level } from '../ui/controls'
import XrayBody from './XrayBody'

type Msg = {
  role: 'user' | 'assistant'
  text: string
  stages?: Stage[]
  final?: Final
  error?: string
  streaming?: boolean
  traceId?: string
  config?: RetrievalConfig
  question?: string
}

/** Render the answer with [path] turned into a chip — but ONLY when that path
 *  was actually retrieved. A reference the model produced from memory stays
 *  plain text: dressing it as a source is the one thing this demo must not do. */
function Answer({ text, retrieved, accent, onCite }:
  { text: string; retrieved: Set<string>; accent: string; onCite: (p: string) => void }) {
  const parts = text.split(/(\[[^\]\s]+\]|«[^»]*»)/g)
  return (
    <div className="max-w-[72ch] whitespace-pre-wrap text-[15.5px] leading-[1.62]">
      {parts.map((p, i) => {
        if (p.startsWith('[') && p.endsWith(']')) {
          const path = p.slice(1, -1)
          if (!retrieved.has(path)) {
            return (
              <span key={i} className="num text-[12.5px] text-ink3" title="Not among the retrieved passages — shown as plain text, not as a source.">
                {p}
              </span>
            )
          }
          return (
            <button key={i} onClick={() => onCite(path)}
              className="num mx-[1px] cursor-pointer rounded-[3px] border px-[5px] py-px align-baseline text-[12px]"
              style={{ color: accent, background: 'var(--color-accentsoft)', borderColor: 'var(--color-accentline)' }}>
              {path}
            </button>
          )
        }
        if (p.startsWith('«')) return <span key={i} className="quote text-ink">{p}</span>
        return <span key={i}>{p}</span>
      })}
    </div>
  )
}

/** The ribbon SUMMARISES; it never lists every stage. One tool call is five
 *  stages and the agent may search four times — twenty chips buried the answer.
 *  Stages are grouped by kind, counted, their time summed, and each segment
 *  deep-links into the X-ray at the first stage of that kind. */
const GROUP: Record<string, string> = {
  tool: 'searches', expand: 'expanded', search: 'ranked', fuse: 'fused',
  links: 'refs', assemble: 'context', verify: 'verified', classify: 'classified',
}
const ORDER = ['expand', 'tool', 'search', 'fuse', 'links', 'assemble', 'verify', 'classify']

function Ribbon({ stages, streaming, accent, traceId, onOpen }: {
  stages: Stage[]; streaming: boolean; accent: string
  traceId?: string; onOpen: (stageIndex?: number) => void
}) {
  const groups = useMemo(() => {
    const by = new Map<string, { n: number; ms: number; tokens: number; first: number }>()
    stages.forEach((s, i) => {
      if (s.name === 'question') return
      const g = by.get(s.name) ?? { n: 0, ms: 0, tokens: 0, first: i }
      g.n += 1; g.ms += s.ms ?? 0; g.tokens += s.detail?.approx_tokens ?? 0
      by.set(s.name, g)
    })
    return ORDER.filter(n => by.has(n)).map(n => ({ name: n, ...by.get(n)! }))
  }, [stages])

  if (!groups.length && !streaming) return null

  return (
    <div className="mb-3 flex flex-wrap items-center gap-y-1">
      {groups.map((g, i) => (
        <button key={g.name} onClick={() => traceId && onOpen(g.first)} disabled={!traceId}
          title={traceId ? 'Open this stage in the X-ray' : undefined}
          className="stagein num border border-rule bg-surface px-[9px] py-[5px] text-[10px] uppercase tracking-[.11em] text-ink2 enabled:cursor-pointer"
          style={{ borderLeftWidth: i === 0 ? 1 : 0, borderRadius: i === 0 ? '4px 0 0 4px' : 0 }}>
          {GROUP[g.name] ?? g.name}
          {g.n > 1 && <span className="text-ink"> ×{g.n}</span>}
          {/* `tool` is a marker stage — it records the agent's decision, not
              work — so its 0ms is noise rather than a measurement. */}
          {g.name !== 'tool' && (
            <span className="text-ink3">
              {' '}{g.name === 'assemble' && g.tokens ? `~${(g.tokens / 1000).toFixed(1)}k tok` : fmtMs(g.ms)}
            </span>
          )}
        </button>
      ))}
      {streaming ? (
        <div className="num flex items-center gap-2 rounded-r-[4px] border border-l-0 border-rule bg-surface px-[9px] py-[5px] text-[10px] uppercase tracking-[.11em] text-ink2">
          <Spinner accent={accent} /> writing
        </div>
      ) : groups.length > 0 && (
        <button onClick={() => onOpen()}
          className="num flex cursor-pointer items-center gap-[6px] rounded-r-[4px] border px-[9px] py-[5px] text-[10px] uppercase tracking-[.11em] text-[var(--color-onaccent)]"
          style={{ background: accent, borderColor: accent }}>
          open the x-ray <Glyph name="arrow" className="h-[11px] w-[11px]" />
        </button>
      )}
    </div>
  )
}

export default function Chat({ kb, initialQ, initialCfg, initialConv, lessons, level, onLevel, onSaved }: {
  kb: KB
  initialQ: string | null
  initialCfg: string | null
  initialConv: string | null
  onSaved?: () => void
  lessons: Record<string, Lesson> | null
  level: Level; onLevel: (l: Level) => void
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [lang, setLang] = useState(kb.default_lang)
  const [asOf, setAsOf] = useState<string>(today())
  const [useAsOf, setUseAsOf] = useState(false)
  const [changes, setChanges] = useState<Partial<RetrievalConfig>>(() => parseCfg(initialCfg))
  const [showKnobs, setShowKnobs] = useState(false)
  const [split, setSplit] = useState(false)
  const [convId, setConvId] = useState<string | null>(initialConv)
  const [restoring, setRestoring] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const sentInitial = useRef<string | null>(null)

  const cfg = mergeCfg(kb.retrieval_config, changes)
  const dirty = Object.keys(changes).length > 0

  useEffect(() => {
    setMsgs([]); setOpen(null); setLang(kb.default_lang); setSplit(false)
    sentInitial.current = null
    setConvId(initialConv)
  }, [kb.slug])

  // Resuming: the conversation comes back as text plus the trace id of each
  // answer, so the X-ray link still works on a run from last week. The live
  // stage objects are not re-fetched - they are in the trace, which is where
  // they belong.
  useEffect(() => {
    if (!initialConv) return
    let live = true
    setRestoring(true)
    getConversation(initialConv)
      .then(c => {
        if (!live) return
        setConvId(c.id)
        setMsgs(c.messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          text: m.content,
          traceId: m.trace_id ?? undefined,
          final: m.role === 'assistant' && m.meta?.cost_usd !== undefined
            ? ({ ...m.meta, trace_id: m.trace_id, passages: m.meta.passages ?? [],
                 cited: m.meta.cited ?? [], unverified_quotes: m.meta.unverified_quotes ?? [] } as Final)
            : undefined,
        })))
      })
      .catch(() => { /* a deleted conversation just starts an empty one */ })
      .finally(() => live && setRestoring(false))
    return () => { live = false }
  }, [initialConv])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  // A question carried in the link is asked once, so a shared permalink lands on
  // the answer rather than on an empty box.
  useEffect(() => {
    const key = `${kb.slug}|${initialQ}`
    if (initialQ && sentInitial.current !== key && !busy) {
      sentInitial.current = key
      send(initialQ)
    }
  }, [kb.slug, initialQ])

  async function send(q: string) {
    if (!q.trim() || busy) return
    setBusy(true); setInput('')
    const history = msgs.filter(m => !m.error).map(m => ({ role: m.role, content: m.text }))
    setMsgs(m => [...m,
      { role: 'user', text: q },
      { role: 'assistant', text: '', stages: [], streaming: true, question: q }])

    const ctrl = new AbortController()
    abort.current = ctrl

    // The stream's own running total. Reading it back out of a setMsgs updater
    // does not work - the updater has not run yet when the request finishes, so
    // the turn was being saved as undefined and no conversation was ever
    // created. This is the state, and setMsgs renders it.
    const acc: { text: string; traceId?: string; final?: Final; error?: string } = { text: '' }

    await ask({
      kb: kb.slug, question: q, lang, history,
      as_of: useAsOf && cfg.as_of_filter ? asOf : null,
      config_overrides: changes,
    }, ev => {
      if (ev.type === 'start') acc.traceId = ev.trace_id
      else if (ev.type === 'text') acc.text = ev.text
      else if (ev.type === 'final') { acc.final = ev; acc.text = ev.answer ?? acc.text }
      else if (ev.type === 'error') acc.error = ev.message

      setMsgs(m => {
        const next = [...m]
        const last = { ...next[next.length - 1] }
        if (ev.type === 'start') { last.traceId = ev.trace_id; last.config = ev.config }
        else if (ev.type === 'stage') last.stages = [...(last.stages ?? []), ev.stage]
        else if (ev.type === 'text') last.text = ev.text
        else if (ev.type === 'final') { last.final = ev; last.text = ev.answer ?? ''; last.streaming = false }
        else if (ev.type === 'error') { last.error = ev.message; last.streaming = false }
        else if (ev.type === 'trace') last.stages = ev.trace.stages
        next[next.length - 1] = last
        return next
      })
    }, ctrl.signal)

    abort.current = null
    setBusy(false)
    setMsgs(m => m.map((x, i) => (i === m.length - 1 ? { ...x, streaming: false } : x)))

    // Persist the turn. A conversation is created lazily on the first answer, so
    // opening the screen and changing your mind leaves nothing behind.
    if (!acc.error && acc.text.trim()) {
      try {
        let cid = convId
        if (!cid) { cid = (await createConversation(kb.slug)).id; setConvId(cid) }
        const f = acc.final
        await appendMessages(cid, {
          question: q, answer: acc.text, trace_id: acc.traceId ?? null,
          meta: f ? {
            cost_usd: f.cost_usd, ms: f.ms, model: f.model, searches: f.searches,
            cited: f.cited, unverified_quotes: f.unverified_quotes, passages: f.passages,
          } : {},
        })
        onSaved?.()
      } catch { /* the answer is on screen either way */ }
    }
  }

  const lastRun = [...msgs].reverse().find(m => m.role === 'assistant' && m.stages?.length)
  const citations: Citation[] = msgs.flatMap(m => m.final?.cited ?? [])

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-surface px-[18px] py-[8px]">
        <div className="flex items-center gap-[9px]">
          <Glyph name={kb.glyph} className="h-[18px] w-[18px]" stroke={kb.accent} />
          <span className="text-[14.5px] font-semibold tracking-[-.015em]">{kb.name}</span>
        </div>
        <span className="num hidden text-[11px] text-ink3 md:inline">{kb.tagline}</span>
        <div className="grow" />

        {kb.langs.length > 1 && (
          <select value={lang} onChange={e => setLang(e.target.value)}
            className="num cursor-pointer rounded-[4px] border border-rule bg-surface px-2 py-1 text-[11px] text-ink2">
            {kb.langs.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}

        {cfg.as_of_filter && (
          <label className="num flex items-center gap-[6px] text-[11px] text-ink2" title="Answer as the law stood on this date">
            <input type="checkbox" checked={useAsOf} onChange={e => setUseAsOf(e.target.checked)} />
            <Glyph name="clock" className="h-[13px] w-[13px]" stroke="var(--color-ink3)" />
            <input type="date" value={asOf} disabled={!useAsOf} onChange={e => setAsOf(e.target.value)}
              className="num rounded-[4px] border border-rule bg-surface px-[6px] py-[2px] text-[11px] disabled:opacity-50" />
          </label>
        )}

        <button onClick={() => setShowKnobs(v => !v)}
          className="num flex cursor-pointer items-center gap-[6px] rounded-[4px] border px-[9px] py-[4px] text-[11px]"
          style={dirty
            ? { background: 'var(--color-accentsoft)', borderColor: 'var(--color-accentline)', color: kb.accent }
            : { borderColor: 'var(--color-rule)', color: 'var(--color-ink2)' }}>
          <Glyph name="sliders" className="h-[13px] w-[13px]" />
          {dirty ? `${Object.keys(changes).length} changed` : 'Settings'}
        </button>

        {msgs.length > 0 && (
          <button onClick={() => { setMsgs([]); setConvId(null); go(`/kb/${kb.slug}`) }}
            className="num flex cursor-pointer items-center gap-[6px] rounded-[4px] border border-rule px-[9px] py-[4px] text-[11px] text-ink2">
            <Glyph name="plus" className="h-[12px] w-[12px]" /> New
          </button>
        )}
        {convId && (
          <span className="num hidden text-[10.5px] text-ink3 lg:inline" title="Saved automatically">
            saved · {convId.slice(0, 6)}
          </span>
        )}
        <button onClick={() => setSplit(v => !v)} disabled={!lastRun}
          className="num hidden cursor-pointer items-center gap-[6px] rounded-[4px] border px-[9px] py-[4px] text-[11px] disabled:opacity-40 xl:flex"
          style={split
            ? { background: kb.accent, borderColor: kb.accent, color: 'var(--color-onaccent)' }
            : { borderColor: 'var(--color-rule)', color: 'var(--color-ink2)' }}>
          <Glyph name="xray" className="h-[13px] w-[13px]" /> X-ray beside it
        </button>
      </div>

      {showKnobs && (
        <div className="shrink-0 border-b border-rule bg-paper px-[18px] py-4">
          <div className="mx-auto max-w-[860px]">
            <p className="mt-0 mb-3 text-[13px] leading-[1.5] text-ink2">
              These settings are sent with the next question, so the answer you get is the
              answer this configuration produces. Retrieval changes are free to explore in
              the <button onClick={() => go(`/kb/${kb.slug}/retrieval`)} className="cursor-pointer underline"
                style={{ color: kb.accent }}>retrieval lab</button> first.
            </p>
            <Knobs base={kb.retrieval_config} changes={changes} accent={kb.accent} lessons={lessons}
              showAnswer onChange={p => setChanges(c => mergePatch(c, p))} onReset={() => setChanges({})} />
          </div>
        </div>
      )}

      <div className="flex min-h-0 grow">
        <div className="flex min-w-0 grow flex-col">
          <div className="scrollthin grow overflow-y-auto px-6 pt-6 lg:px-10">
            {restoring && <div className="py-6 text-center text-[13px] text-ink3">Loading the conversation…</div>}
            {msgs.length === 0 && !restoring && (
              <div className="mx-auto max-w-[72ch] pt-6">
                <div className="kicker mb-3">Try asking</div>
                <div className="flex flex-col gap-2">
                  {kb.sample_questions.map(q => (
                    <button key={q} onClick={() => send(q)}
                      className="cursor-pointer rounded-[6px] border border-rule bg-surface px-4 py-[10px] text-left text-[14.5px] text-ink2 hover:border-rule2">
                      {q}
                    </button>
                  ))}
                </div>
                <div className="mt-5">
                  <Note>
                    Answering calls the model, and there is a daily spend cap on it — so
                    questions are limited and retrieval is not. Search, the chunking
                    comparison and the evaluate screen never reach a model, and are free
                    and uncapped. Both limits are yours to change in Settings.
                  </Note>
                </div>
              </div>
            )}

            <div className="mx-auto flex max-w-[72ch] flex-col gap-6">
              {msgs.map((m, i) => m.role === 'user' ? (
                <div key={i} className="self-end rounded-[9px_9px_3px_9px] border border-rule bg-surface px-4 py-3">
                  <p className="m-0 text-[15px] leading-[1.55]">{m.text}</p>
                </div>
              ) : (
                <div key={i}>
                  <Ribbon stages={m.stages ?? []} streaming={!!m.streaming} accent={kb.accent}
                    traceId={m.traceId}
                    onOpen={s => m.traceId && go(`/x-ray/${m.traceId}${s != null ? `/${s}` : ''}`)} />

                  {m.error ? (
                    <Note tone="stop">
                      <div className="microlabel mb-1 !text-stop">It did not answer</div>
                      {m.error}
                    </Note>
                  ) : (
                    <Answer text={m.text} accent={kb.accent} onCite={setOpen}
                      retrieved={new Set((m.final?.passages ?? []).map(p => p.path))} />
                  )}

                  {m.final?.unverified_quotes?.length ? (
                    <div className="mt-3">
                      <Note tone="stop">
                        <div className="microlabel mb-[6px] !text-stop">
                          {m.final.unverified_quotes.length} quote
                          {m.final.unverified_quotes.length > 1 ? 's' : ''} not found in any retrieved passage
                        </div>
                        {m.final.unverified_quotes.map((q, j) => (
                          <div key={j} className="quote text-[13.5px] leading-[1.5] text-ink">«{q}»</div>
                        ))}
                      </Note>
                    </div>
                  ) : null}

                  {m.final && m.config?.verify_quotes === false && (
                    <div className="mt-3">
                      <Note tone="warn">
                        <div className="microlabel mb-1 !text-warn">Quote checking was off</div>
                        Nothing in this answer was verified against the retrieved text.
                      </Note>
                    </div>
                  )}

                  {m.final && (
                    <div className="num mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-rule pt-3 text-[11px] text-ink3">
                      <span>{m.final.searches} search{m.final.searches === 1 ? '' : 'es'}</span>
                      <span>{m.final.passages.length} passages</span>
                      <span>
                        {m.final.cited.length} verified
                        {m.final.unverified_quotes.length ? ` · ${m.final.unverified_quotes.length} not` : ''}
                      </span>
                      <span>{m.final.model}</span>
                      <span>{fmtUsd(m.final.cost_usd)}</span>
                      <span>{fmtMs(m.final.ms)}</span>
                      <button onClick={() => go(`/x-ray/${m.final!.trace_id}`)}
                        className="ml-auto cursor-pointer" style={{ color: kb.accent }}>
                        trace {m.final.trace_id.slice(0, 7)}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </div>

          <div className="shrink-0 px-6 pt-4 pb-5 lg:px-10">
            <div className="mx-auto max-w-[72ch]">
              {dirty && (
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-ink2">
                  <Tag tone="accent">modified run</Tag>
                  <span className="num">{Object.keys(changes).join(' · ')}</span>
                  <button onClick={() => setChanges({})} className="cursor-pointer underline" style={{ color: kb.accent }}>
                    reset
                  </button>
                </div>
              )}
              <form onSubmit={e => { e.preventDefault(); send(input) }}
                className="flex items-center gap-3 rounded-[8px] border border-rule2 bg-surface px-[14px] py-[9px]">
                <input value={input} onChange={e => setInput(e.target.value)} disabled={busy}
                  placeholder={busy ? 'Working…' : `Ask ${kb.name} something…`}
                  className="grow border-0 bg-transparent text-[15px] outline-none placeholder:text-ink3" />
                {busy ? (
                  <button type="button" onClick={() => abort.current?.abort()}
                    className="num cursor-pointer rounded-[5px] border border-rule px-[10px] py-[5px] text-[11px] text-ink2">
                    Stop
                  </button>
                ) : (
                  <button type="submit" disabled={!input.trim()}
                    className="grid h-[30px] w-[30px] place-items-center rounded-[5px] disabled:opacity-40"
                    style={{ background: kb.accent }}>
                    <Glyph name="send" className="h-[15px] w-[15px]" stroke="var(--color-onaccent)" />
                  </button>
                )}
              </form>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <Price free={false} note="answering calls the model" />
                <button onClick={() => go(`/kb/${kb.slug}/retrieval`)}
                  className="num cursor-pointer text-[11px] uppercase tracking-[.1em]" style={{ color: kb.accent }}>
                  retrieve without answering →
                </button>
              </div>
            </div>
          </div>
        </div>

        {split && lastRun && (
          <div className="hidden w-[560px] shrink-0 flex-col border-l border-rule bg-paper xl:flex">
            <div className="flex items-center gap-2 border-b border-rule bg-surface px-4 py-[7px]">
              <div className="microlabel">X-ray · last run</div>
              <div className="grow" />
              {lastRun.traceId && (
                <button onClick={() => go(`/x-ray/${lastRun.traceId}`)}
                  className="num cursor-pointer text-[11px]" style={{ color: kb.accent }}>
                  full screen →
                </button>
              )}
              <button onClick={() => setSplit(false)} className="cursor-pointer">
                <Glyph name="close" className="h-[14px] w-[14px]" stroke="var(--color-ink3)" />
              </button>
            </div>
            <div className="flex min-h-0 grow flex-col">
              <XrayBody kb={kb} compact lessons={lessons} level={level} onLevel={onLevel}
                onPath={setOpen}
                trace={{
                  id: lastRun.traceId, question: lastRun.question ?? '',
                  lang, config: lastRun.config ?? cfg, stages: lastRun.stages ?? [],
                  ms: lastRun.final?.ms,
                }} />
            </div>
          </div>
        )}

        {open && (
          <SourceDrawer kb={kb} path={open} lang={lang} citations={citations}
            onClose={() => setOpen(null)} />
        )}
      </div>
    </div>
  )
}

function parseCfg(raw: string | null): Partial<RetrievalConfig> {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function mergePatch(a: Partial<RetrievalConfig>, b: Partial<RetrievalConfig>): Partial<RetrievalConfig> {
  const out: any = { ...a }
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = { ...out[k], ...(v as object) }
    } else out[k] = v
  }
  return out
}

export { Answer }
