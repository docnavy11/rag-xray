import type { Counterfactual } from '../lib/api'
import { fmtMs } from '../lib/text'
import Glyph from '../ui/Glyph'
import { Stat } from '../ui/controls'

/** The same request run twice — as configured, and with one decision changed —
 *  and the ranking diff between them. No model is involved, which is why a
 *  visitor can turn switches all afternoon. */
export default function RankDiff({ cf, accent, onPath, limit = 18 }:
  { cf: Counterfactual; accent: string; onPath?: (p: string) => void; limit?: number }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-7 gap-y-3">
        <Stat value={String(cf.summary.entered)} label="entered the window" tone="good" />
        <Stat value={String(cf.summary.dropped)} label="fell out" tone="bad" />
        <Stat value={String(cf.summary.moved)} label="changed rank" />
        <Stat value={String(cf.summary.held)} label="held position" />
        <div className="grow" />
        <div className="num text-[11px] text-ink3">
          re-ranked in {fmtMs(cf.ms)} ·{' '}
          {cf.free
            ? 'no model called · $0.00'
            : `the expansion for this question was not cached yet (${cf.expansion})`}
        </div>
      </div>

      <div className="overflow-hidden rounded-[7px] border border-rule bg-surface">
        <div className="flex items-center gap-3 border-b border-rule bg-paper px-4 py-[6px]">
          <span className="microlabel w-9 shrink-0">was</span>
          <span className="w-3 shrink-0" />
          <span className="microlabel w-8 shrink-0">now</span>
          <span className="microlabel">passage</span>
        </div>
        {cf.diff.slice(0, limit).map(r => (
          <div key={r.path} className="flex items-center gap-3 border-b border-rule px-4 py-[8px] last:border-0"
            style={r.change === 'dropped' ? { background: 'var(--color-stopbg)' }
              : r.change === 'entered' ? { background: 'var(--color-okbg)' } : undefined}>
            <span className="num w-9 shrink-0 text-[11.5px] text-ink3">{r.was ?? '—'}</span>
            <Glyph name="arrow" className="h-3 w-3 shrink-0" stroke="var(--color-rule2)" />
            <span className="num w-8 shrink-0 text-[11.5px] text-ink3">{r.now ?? '—'}</span>
            {onPath ? (
              <button onClick={() => onPath(r.path)}
                className="num shrink-0 cursor-pointer text-[12.5px] font-medium hover:underline"
                style={{ color: accent }}>{r.path}</button>
            ) : (
              <span className="num shrink-0 text-[12.5px] font-medium" style={{ color: accent }}>{r.path}</span>
            )}
            <span className="truncate text-[12.5px] text-ink3">{r.heading}</span>
            <span className="num ml-auto shrink-0 text-[11px]"
              style={{
                color: r.change === 'dropped' ? 'var(--color-stop)'
                  : r.change === 'entered' ? 'var(--color-ok)'
                  : typeof r.change === 'number' && r.change > 0 ? 'var(--color-ok)'
                  : r.change === 0 ? 'var(--color-rule2)' : 'var(--color-stop)',
              }}>
              {r.change === 'dropped' ? 'fell out'
                : r.change === 'entered' ? 'entered'
                : r.change === 0 ? 'held'
                : (r.change as number) > 0 ? `up ${r.change}` : `down ${-(r.change as number)}`}
            </span>
          </div>
        ))}
        {cf.diff.length > limit && (
          <div className="num px-4 py-2 text-[11px] text-ink3">
            and {cf.diff.length - limit} more
          </div>
        )}
      </div>
    </div>
  )
}
