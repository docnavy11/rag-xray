import { useState, type ReactNode } from 'react'
import type { KB } from '../lib/api'
import { go } from '../lib/router'
import Display from './Display'
import Glyph from './Glyph'

/** The app frame: one sidebar that is always there, so every part of the tool
 *  is one click from every other part and nothing is buried behind a tour. */
export default function Shell({ hash, kbs, activeKB, children }: {
  hash: string; kbs: KB[]; activeKB: KB | null; children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const kb = activeKB ?? kbs[0]

  const item = (to: string, label: string, glyph: string, active: boolean, accent?: string) => (
    <button key={to + label} onClick={() => { go(to); setOpen(false) }}
      className="flex w-full shrink-0 cursor-pointer items-center gap-[9px] rounded-[5px] px-[9px] py-[6px] text-left text-[13px] transition-colors"
      style={active
        ? { background: accent ?? 'var(--color-accentsoft)', color: accent ? 'var(--color-onaccent)' : 'var(--color-accent)' }
        : { color: 'var(--color-ink2)' }}>
      <Glyph name={glyph} className="h-[14px] w-[14px] shrink-0"
        stroke={active && accent ? 'var(--color-onaccent)' : 'currentColor'} />
      <span className="truncate">{label}</span>
    </button>
  )

  const section = (label: string, right?: ReactNode) => (
    <div className="mt-4 mb-1 flex items-center gap-2 px-[9px]">
      <span className="microlabel">{label}</span>
      <div className="h-px grow bg-rule" />
      {right}
    </div>
  )

  const nav = (
    <>
      {section('Workspace')}
      {item('/', 'Dashboard', 'grid', hash === '/')}
      {kb && item(`/kb/${kb.slug}`, 'Chat', 'chat', hash.startsWith('/kb/') && !hash.includes('/retrieval'))}
      {kb && item(`/kb/${kb.slug}/retrieval`, 'Search', 'lab', hash.includes('/retrieval'))}
      {item('/history', 'History', 'clock', hash.startsWith('/history'))}

      {section('Corpora', (
        <button onClick={() => { go('/corpora'); setOpen(false) }} title="New corpus"
          className="cursor-pointer text-[15px] leading-none text-ink3 hover:text-ink">+</button>
      ))}
      {kbs.map(k => (
        <button key={k.slug} onClick={() => { go(`/corpus/${k.slug}`); setOpen(false) }}
          className="flex w-full shrink-0 cursor-pointer items-center gap-[9px] rounded-[5px] px-[9px] py-[6px] text-left text-[13px]"
          style={hash === `/corpus/${k.slug}`
            ? { background: 'var(--color-surface2)', color: 'var(--color-ink)' }
            : { color: 'var(--color-ink2)' }}>
          <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: k.accent }} />
          <span className="truncate">{k.name}</span>
          <span className="num ml-auto shrink-0 text-[10px] text-ink3">
            {k.chunks > 999 ? `${Math.round(k.chunks / 1000)}k` : k.chunks}
          </span>
        </button>
      ))}
      {item('/corpora', 'All corpora', 'book', hash === '/corpora')}

      {section('Analysis')}
      {item('/compare', 'Chunking', 'columns', hash === '/compare')}
      {item('/evaluate', 'Evaluate', 'chart', hash === '/evaluate')}
      {item('/findings', 'Findings', 'scales', hash === '/findings')}

      <div className="grow" />
      <div className="mt-4 border-t border-rule pt-2">
        {item('/api', 'API & MCP', 'plug', hash === '/api')}
        {item('/settings', 'Settings', 'sliders', hash === '/settings')}
        <Display />
      </div>
    </>
  )

  return (
    <div className="flex h-app">
      <aside className="scrollthin hidden w-[216px] shrink-0 flex-col overflow-y-auto border-r border-rule bg-surface px-[10px] pb-3 lg:flex">
        <button onClick={() => go('/')} className="mt-3 mb-1 flex cursor-pointer items-center gap-[8px] px-[9px]">
          <Glyph name="xray" className="h-[17px] w-[17px]" stroke="var(--color-accent)" />
          <span className="num text-[11px] font-medium uppercase tracking-[.14em]">RAG X-ray</span>
        </button>
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <aside className="scrollthin relative z-10 flex w-[240px] flex-col overflow-y-auto border-r border-rule bg-surface px-[10px] pb-3">
            <div className="mt-3 mb-1 flex items-center gap-[8px] px-[9px]">
              <Glyph name="xray" className="h-[17px] w-[17px]" stroke="var(--color-accent)" />
              <span className="num text-[11px] font-medium uppercase tracking-[.14em]">RAG X-ray</span>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 grow flex-col">
        <button onClick={() => setOpen(true)}
          className="flex h-[42px] shrink-0 cursor-pointer items-center gap-2 border-b border-rule bg-surface px-4 text-[13px] text-ink2 lg:hidden">
          <Glyph name="menu" className="h-[16px] w-[16px]" /> Menu
        </button>
        <div className="flex min-h-0 grow flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
