import { useEffect, useState } from 'react'
import { getTrace, type Final, type KB, type Lesson, type Trace } from '../lib/api'
import { go } from '../lib/router'
import { fmtMs, fmtUsd } from '../lib/text'
import SourceDrawer from '../panels/SourceDrawer'
import Glyph from '../ui/Glyph'
import { Copy, Empty, Tag, type Level } from '../ui/controls'
import XrayBody from './XrayBody'

type Persisted = Trace & { kb_slug: string; kb_name: string; answer: Final; created_at: string }

/** A permalink to one run. Somebody can send a colleague the exact question,
 *  the exact ranking and the exact answer — not a screenshot of it. */
export default function Xray({ kb, traceId, stage, lessons, level, onLevel }: {
  kb: KB; traceId: string; stage: number | null
  lessons: Record<string, Lesson> | null
  level: Level; onLevel: (l: Level) => void
}) {
  const [trace, setTrace] = useState<Persisted | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showAnswer, setShowAnswer] = useState(true)

  useEffect(() => {
    let live = true
    setTrace(null); setErr(null)
    getTrace(traceId).then(t => live && setTrace(t as Persisted))
      .catch(e => live && setErr(String(e.message ?? e)))
    return () => { live = false }
  }, [traceId])

  if (err) return <Empty>No trace with id {traceId}. It may have been made before this database was rebuilt.</Empty>
  if (!trace) return <Empty>Loading the trace…</Empty>

  const answer = trace.answer
  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-surface px-[18px] py-[9px]">
        <button onClick={() => go(`/kb/${kb.slug}`)} className="flex cursor-pointer items-center gap-[7px] text-[13.5px] text-ink2">
          <Glyph name="back" className="h-[14px] w-[14px]" /> Back to chat
        </button>
        <div className="hidden h-[22px] w-px bg-rule sm:block" />
        <div className="min-w-0 grow truncate text-[14px]">“{trace.question}”</div>
        <div className="num hidden text-[11px] text-ink3 lg:block">
          trace {trace.id} · {fmtMs(answer?.ms ?? trace.ms)}
          {trace.cost_usd != null && <> · {fmtUsd(trace.cost_usd)}</>}
          {' · '}{trace.created_at?.slice(0, 16)}
        </div>
        <Copy accent={kb.accent} label="Copy permalink" text={location.href} />
      </div>

      {answer?.answer && (
        <div className="shrink-0 border-b border-rule bg-paper px-[18px] py-3">
          <button onClick={() => setShowAnswer(v => !v)}
            className="flex w-full cursor-pointer items-center gap-2 text-left">
            <div className="microlabel">The answer this run produced</div>
            <div className="h-px grow bg-rule" />
            {answer.unverified_quotes?.length > 0 && <Tag tone="stop">{answer.unverified_quotes.length} unverified</Tag>}
            <Tag tone="ok">{answer.cited.length} verified</Tag>
            <Glyph name={showAnswer ? 'up' : 'down'} className="h-[13px] w-[13px]" stroke="var(--color-ink3)" />
          </button>
          {showAnswer && (
            <p className="mt-2 mb-0 max-w-[86ch] whitespace-pre-wrap text-[14px] leading-[1.6] text-ink2">
              {answer.answer}
            </p>
          )}
        </div>
      )}

      <div className="flex min-h-0 grow">
        <div className="flex min-w-0 grow flex-col">
          <XrayBody kb={kb} trace={trace} lessons={lessons} level={level} onLevel={onLevel}
            initialStage={stage} onPath={setOpen} />
        </div>
        {open && (
          <SourceDrawer kb={kb} path={open} lang={trace.lang} citations={answer?.cited}
            onClose={() => setOpen(null)} />
        )}
      </div>
    </div>
  )
}
