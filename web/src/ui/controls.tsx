import { useState, type ReactNode } from 'react'
import Glyph from './Glyph'

export function Toggle({ on, onClick, accent, disabled }:
  { on: boolean; onClick?: () => void; accent: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} aria-pressed={on} disabled={disabled}
      className="relative h-[18px] w-8 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-40"
      style={{ background: on ? accent : 'var(--color-surface3)' }}>
      <span className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all"
        style={{ left: on ? 16 : 2, boxShadow: on ? 'none' : '0 1px 2px rgba(20,24,20,.2)' }} />
    </button>
  )
}

export function Seg<T extends string>({ value, options, onChange, accent, size = 'sm' }: {
  value: T; options: { v: T; label: string; title?: string }[]
  onChange: (v: T) => void; accent: string; size?: 'sm' | 'md'
}) {
  return (
    <div className="flex gap-[2px] rounded-[4px] bg-surface2 p-[2px]">
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} title={o.title}
          className={`cursor-pointer rounded-[3px] font-mono transition-colors ${
            size === 'sm' ? 'px-[9px] py-[3px] text-[11px]' : 'px-[12px] py-[5px] text-[12px]'}`}
          style={o.v === value ? { background: accent, color: 'var(--color-onaccent)' } : { color: 'var(--color-ink2)' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Slider({ value, min, max, step = 1, onChange, accent, format }: {
  value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; accent: string; format?: (v: number) => string
}) {
  return (
    <div className="flex min-w-[132px] items-center gap-[10px]">
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="h-[3px] grow cursor-pointer appearance-none rounded-full bg-surface3
                   [&::-webkit-slider-thumb]:h-[13px] [&::-webkit-slider-thumb]:w-[13px]
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full"
        style={{ accentColor: accent }} />
      <span className="num w-[42px] shrink-0 text-right text-[11.5px] text-ink2">
        {format ? format(value) : value}
      </span>
    </div>
  )
}

export function Spinner({ accent }: { accent: string }) {
  return (
    <span className="inline-block h-[11px] w-[11px] animate-spin rounded-full border-2 border-transparent"
      style={{ borderTopColor: accent, borderRightColor: accent }} />
  )
}

export function SectionHead({ n, title, right }: { n: string; title: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-[13px] border-t-2 border-ink pt-3">
      <span className="num shrink-0 pt-[3px] text-[11.5px] text-accent">{n}</span>
      <h2 className="m-0 text-[20px] font-semibold leading-tight tracking-[-.022em]">{title}</h2>
      <div className="grow" />
      {right}
    </div>
  )
}

export function Stat({ label, value, tone }:
  { label: string; value: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="num text-[20px] leading-none"
        style={{ color: tone === 'bad' ? 'var(--color-stop)' : tone === 'good' ? 'var(--color-ok)' : 'var(--color-ink)' }}>
        {value}
      </span>
      <span className="text-[12.5px] leading-tight text-ink2">{label}</span>
    </div>
  )
}

export function Tag({ children, tone = 'quiet' }:
  { children: ReactNode; tone?: 'quiet' | 'ok' | 'warn' | 'stop' | 'accent' }) {
  const tones = {
    quiet: { background: 'var(--color-surface2)', color: 'var(--color-ink2)', border: '1px solid var(--color-rule)' },
    ok: { background: 'var(--color-okbg)', color: 'var(--color-ok)', border: '1px solid var(--color-okrule)' },
    warn: { background: 'var(--color-warnbg)', color: 'var(--color-warn)', border: '1px solid var(--color-warnrule)' },
    stop: { background: 'var(--color-stopbg)', color: 'var(--color-stop)', border: '1px solid var(--color-stoprule)' },
    accent: { background: 'var(--color-accentsoft)', color: 'var(--color-accent)', border: '1px solid var(--color-accentline)' },
  }[tone]
  return (
    <span className="num inline-block rounded-[3px] px-[7px] py-[2px] text-[9.5px] uppercase tracking-[.11em]"
      style={tones}>{children}</span>
  )
}

/** Free / costs money. The distinction is the reason a visitor can play with
 *  this all afternoon, so it is stated on every control that spends. */
export function Price({ free, note }: { free: boolean; note?: string }) {
  return (
    <span className="num inline-flex items-center gap-[5px] text-[10.5px] uppercase tracking-[.1em]"
      style={{ color: free ? 'var(--color-ok)' : 'var(--color-warn)' }}>
      <Glyph name={free ? 'free' : 'warn'} className="h-[12px] w-[12px]" />
      {free ? 'no model · free' : note ?? 'calls the model'}
    </span>
  )
}

export function Btn({ children, onClick, accent, kind = 'primary', disabled, busy, title, type }: {
  children: ReactNode; onClick?: () => void; accent: string
  kind?: 'primary' | 'quiet' | 'soft'; disabled?: boolean; busy?: boolean
  title?: string; type?: 'button' | 'submit'
}) {
  const style = kind === 'primary'
    ? { background: accent, borderColor: accent, color: 'var(--color-onaccent)' }
    : kind === 'soft'
      ? { background: 'var(--color-accentsoft)', borderColor: 'var(--color-accentline)', color: accent }
      : { background: 'var(--color-surface)', borderColor: 'var(--color-rule)', color: 'var(--color-ink2)' }
  return (
    <button type={type ?? 'button'} onClick={onClick} disabled={disabled} title={title}
      className="inline-flex cursor-pointer items-center gap-2 rounded-[5px] border px-[13px] py-[7px]
                 text-[12.5px] transition-opacity disabled:cursor-default disabled:opacity-40"
      style={style}>
      {busy && <Spinner accent={kind === 'primary' ? 'var(--color-onaccent)' : accent} />}
      {children}
    </button>
  )
}

export function Copy({ text, label = 'Copy', accent }:
  { text: string; label?: string; accent: string }) {
  const [done, setDone] = useState(false)
  return (
    <Btn kind="soft" accent={accent} onClick={() => {
      navigator.clipboard?.writeText(text).then(() => {
        setDone(true); setTimeout(() => setDone(false), 1400)
      })
    }}>
      <Glyph name={done ? 'check' : 'copy'} className="h-[13px] w-[13px]" />
      {done ? 'Copied' : label}
    </Btn>
  )
}

export type Level = 'plain' | 'practical' | 'technical'

/** The layered audience, per DESIGN §1: a prospect reads the top level, a
 *  developer opens the bottom one. The choice is remembered across every panel
 *  on the screen, because switching it per panel got tedious. */
export function LevelPicker({ level, onChange, accent }:
  { level: Level; onChange: (l: Level) => void; accent: string }) {
  return (
    <Seg value={level} accent={accent} onChange={onChange} options={[
      { v: 'plain', label: 'Plain', title: 'What it means' },
      { v: 'practical', label: 'Practical', title: 'What it changed, with the number' },
      { v: 'technical', label: 'Technical', title: 'How it works' },
    ]} />
  )
}

export function Card({ children, accent, className = '' }:
  { children: ReactNode; accent?: string; className?: string }) {
  return (
    <div className={`rounded-[7px] border border-rule bg-surface ${className}`}
      style={accent ? { borderTop: `3px solid ${accent}` } : undefined}>
      {children}
    </div>
  )
}

export function Note({ children, tone = 'accent' }:
  { children: ReactNode; tone?: 'accent' | 'warn' | 'stop' }) {
  const border = { accent: 'var(--color-accent)', warn: 'var(--color-warnrule)', stop: 'var(--color-stoprule)' }[tone]
  const bg = { accent: 'var(--color-surface)', warn: 'var(--color-warnbg)', stop: 'var(--color-stopbg)' }[tone]
  return (
    <div className="rounded-r-[6px] border-l-[3px] px-[15px] py-3 text-[13.5px] leading-[1.55]"
      style={{ borderColor: border, background: bg }}>
      {children}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-14 text-center text-[14px] text-ink3">{children}</div>
}
