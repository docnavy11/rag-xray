import { setTheme, setZoom, stepZoom, useDisplay, ZOOMS, type Theme } from '../lib/theme'
import Glyph from './Glyph'

/** Appearance, where a person looks for it: at the bottom of the sidebar, on
 *  every screen, two clicks from anywhere. */
export default function Display() {
  const { theme, zoom } = useDisplay()

  const modes: { v: Theme; glyph: string; title: string }[] = [
    { v: 'light', glyph: 'sun', title: 'Light' },
    { v: 'dark', glyph: 'moon', title: 'Dark' },
    { v: 'system', glyph: 'auto', title: 'Follow the system' },
  ]

  return (
    <div className="mt-2 flex items-center gap-1 px-[9px] py-1">
      <div className="flex gap-[2px] rounded-[5px] bg-surface2 p-[2px]">
        {modes.map(m => (
          <button key={m.v} onClick={() => setTheme(m.v)} title={m.title} aria-label={m.title}
            aria-pressed={theme === m.v}
            className="grid h-[22px] w-[24px] cursor-pointer place-items-center rounded-[3px] transition-colors"
            style={theme === m.v
              ? { background: 'var(--color-accent)', color: 'var(--color-onaccent)' }
              : { color: 'var(--color-ink3)' }}>
            <Glyph name={m.glyph} className="h-[13px] w-[13px]" />
          </button>
        ))}
      </div>

      <div className="grow" />

      <div className="flex items-center gap-[2px] rounded-[5px] bg-surface2 p-[2px]">
        <button onClick={() => stepZoom(-1)} disabled={zoom <= ZOOMS[0]}
          title="Smaller" aria-label="Smaller"
          className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-[3px] text-[13px] text-ink2 disabled:opacity-30">
          A<span className="text-[9px] leading-none">−</span>
        </button>
        <button onClick={() => setZoom(1)} disabled={zoom === 1}
          title="Reset to 100%" aria-label={`Text size ${Math.round(zoom * 100)} percent, reset`}
          className="num w-[34px] cursor-pointer text-center text-[10px] text-ink3">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => stepZoom(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]}
          title="Larger" aria-label="Larger"
          className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-[3px] text-[15px] text-ink2 disabled:opacity-30">
          A<span className="text-[11px] leading-none">+</span>
        </button>
      </div>
    </div>
  )
}
