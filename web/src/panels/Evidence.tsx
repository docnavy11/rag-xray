import type { Lesson } from '../lib/api'
import { LevelPicker, type Level } from '../ui/controls'

/** What was measured, at its recorded strength.
 *
 *  The rule this component exists to enforce: a claim on screen may not be more
 *  confident than the measurement under it. So n, the date, the source and
 *  whether the figure is in-sample are rendered from the server's own ledger
 *  (/v1/lessons) and never retyped into the UI, and a lesson with no
 *  measurement says so instead of borrowing authority from the ones that have
 *  one. */
export default function Evidence({ lesson, accent, level, onLevel, compact }: {
  lesson: Lesson; accent: string; level: Level; onLevel: (l: Level) => void
  compact?: boolean
}) {
  const max = Math.max(100, ...lesson.figures.map(f => f.value))
  return (
    <div className="rounded-r-[6px] border-l-[3px] bg-paper px-4 py-[14px]" style={{ borderColor: accent }}>
      <div className="mb-[10px] flex flex-wrap items-center gap-2">
        <div className="microlabel" style={{ color: accent }}>
          {lesson.measured ? 'What we measured' : 'Design, not measured'}
        </div>
        <div className="grow" />
        <LevelPicker level={level} onChange={onLevel} accent={accent} />
      </div>

      <div className="mb-2 text-[14px] font-semibold leading-snug">{lesson.title}</div>
      <p className="m-0 mb-3 text-[13.5px] leading-[1.55] text-ink">{lesson[level]}</p>

      {lesson.figures.length > 0 && (
        <div className="num mb-3 flex flex-col gap-[5px] text-[11.5px]">
          {lesson.figures.map(f => (
            <div key={f.label} className="flex items-center gap-2">
              <span className={`shrink-0 text-ink3 ${compact ? 'w-[104px]' : 'w-[128px]'}`}>{f.label}</span>
              <div className="h-[7px] min-w-[2px] rounded-[2px] transition-all"
                style={{
                  width: `${(f.value / max) * (compact ? 110 : 150)}px`,
                  background: f.bad ? 'var(--color-stop)' : f.good ? 'var(--color-ok)' : 'var(--color-rule2)',
                }} />
              <span style={{ color: f.bad ? 'var(--color-stop)' : f.good ? 'var(--color-ok)' : 'var(--color-ink)' }}>
                {f.value}{f.unit}
              </span>
            </div>
          ))}
        </div>
      )}

      {lesson.prior && (
        <p className="m-0 mb-2 border-l-2 border-rule pl-3 text-[12px] leading-[1.5] text-ink3">
          <span className="microlabel mr-2">earlier, elsewhere</span>{lesson.prior}
        </p>
      )}

      <p className="num m-0 text-[11px] leading-[1.5] text-ink3">
        {lesson.source}
        {lesson.n != null && <> · n={lesson.n}</>}
        {lesson.measured ? <> · {lesson.measured}</> : <> · not a measurement</>}
        {lesson.holdout === false && <> · in-sample, not a holdout figure</>}
      </p>
    </div>
  )
}
