import { useEffect, useState } from 'react'
import { compare, type CompareSide, type KB } from '../lib/api'
import { fmtInt, fmtMs } from '../lib/text'
import { accentFor, useDisplay } from '../lib/theme'
import Glyph from '../ui/Glyph'
import { Empty, Note, Price, SectionHead, Spinner, Stat, Tag } from '../ui/controls'

const SAMPLES = [
  'Do we have to tell users they are talking to an AI?',
  'What counts as a high-risk system?',
  'How large can the administrative fines get?',
  'What must the technical documentation contain?',
]

function Column({ side, onPath }: { side: CompareSide; onPath: (kb: string, p: string) => void }) {
  const { dark } = useDisplay()
  const { kb, corpus } = { ...side, kb: { ...side.kb, accent: accentFor(side.kb.accent, dark) } }
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-3 rounded-[7px] border border-rule bg-surface p-4" style={{ borderTop: `3px solid ${kb.accent}` }}>
        <div className="mb-1 flex flex-wrap items-center gap-[9px]">
          <Glyph name={kb.glyph} className="h-[18px] w-[18px] shrink-0" stroke={kb.accent} />
          <div className="text-[16px] font-semibold tracking-[-.015em]">{kb.name}</div>
          <Tag tone={kb.cite_strength === 'exact' ? 'ok' : 'stop'}>{kb.cite_strength} cites</Tag>
        </div>
        <div className="num mb-3 text-[11.5px] text-ink3">
          {fmtInt(corpus.chunks)} chunks · avg {fmtInt(corpus.avg_chars)} chars ·{' '}
          {fmtInt(corpus.with_heading)} with a heading · {kb.chunker.replace(/_/g, ' ')}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Stat value={`${side.citable}`} label="of 8 carry a citable identity" tone={side.citable < 4 ? 'bad' : undefined} />
          <Stat value={`${side.mid_sentence}`} label="open mid-sentence" tone={side.mid_sentence > 0 ? 'bad' : undefined} />
        </div>
        <div className="num mt-3 border-t border-rule pt-2 text-[11px] text-ink3">
          retrieved in {fmtMs(side.trace.ms)} · {side.trace.stages.length} stages
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {side.hits.map((h, i) => (
          <div key={h.path} className="rounded-[7px] border border-rule bg-surface px-4 py-3"
            style={h.opens_mid_sentence ? { background: 'var(--color-stopbg)', borderColor: 'var(--color-stoprule)' } : undefined}>
            <div className="mb-[6px] flex flex-wrap items-center gap-2">
              <span className="num w-5 text-[11.5px] text-ink3">{i + 1}</span>
              <button onClick={() => onPath(kb.slug, h.path)}
                className="num cursor-pointer text-[12.5px] font-medium hover:underline" style={{ color: kb.accent }}>
                {h.path}
              </button>
              <span className="num text-[11px] text-ink3">{fmtInt(h.chars)} ch</span>
              {h.opens_mid_sentence && <Tag tone="stop">opens mid-sentence</Tag>}
            </div>
            <div className="mb-[6px] text-[13px] font-semibold leading-snug">
              {h.heading ?? <span className="font-normal italic text-ink3">no heading — nothing to cite it by</span>}
            </div>
            <p className="m-0 text-[13px] leading-[1.55] text-ink2">
              {h.preview}<span className="text-ink3">…</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The same question against two or three corpora at once.
 *
 *  Built for one comparison in particular — the AI Act on its own legal
 *  structure against the identical English text cut into fixed windows — but any
 *  pair can be put up, because the point generalises: same retriever, same
 *  query, and the chunking decides the outcome. */
export default function Compare({ kbs, onPath }: {
  kbs: KB[]; onPath: (kbSlug: string, path: string) => void
}) {
  const [picked, setPicked] = useState<string[]>(['aiact', 'aiact-naive'])
  const [q, setQ] = useState(SAMPLES[0])
  const [input, setInput] = useState(SAMPLES[0])
  const [data, setData] = useState<{ sides: CompareSide[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (picked.length < 2) { setData(null); return }
    let live = true
    setBusy(true); setErr(null)
    compare({ q, kbs: picked })
      .then(d => live && setData(d))
      .catch(e => live && setErr(String(e.message ?? e)))
      .finally(() => live && setBusy(false))
    return () => { live = false }
  }, [q, picked.join(',')])

  function toggle(slug: string) {
    setPicked(p => p.includes(slug)
      ? (p.length > 2 ? p.filter(x => x !== slug) : p)
      : (p.length >= 3 ? [...p.slice(1), slug] : [...p, slug]))
  }

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-6 lg:px-10">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-.022em]">Chunking, side by side</h1>
        <Price free />
      </div>

      <p className="mb-4 max-w-[86ch] text-[15px] leading-[1.6] text-ink2">
        The default pair is <b className="font-semibold text-ink">the same English text of the AI Act</b>,
        the same retriever and the same query. The only difference is where the cuts fall:
        on one side the Regulation's own structure — the article paragraph, the annex
        point; on the other, 800-token windows that ignore it. Swap in any corpus to see
        how far the point carries.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="microlabel mr-1">corpora</span>
        {kbs.map(kb => {
          const on = picked.includes(kb.slug)
          return (
            <button key={kb.slug} onClick={() => toggle(kb.slug)}
              className="flex cursor-pointer items-center gap-[6px] rounded-[5px] border px-3 py-[5px] text-[12.5px]"
              style={on
                ? { background: kb.accent, borderColor: kb.accent, color: 'var(--color-onaccent)' }
                : { borderColor: 'var(--color-rule)', color: 'var(--color-ink2)' }}>
              <Glyph name={kb.glyph} className="h-[13px] w-[13px]" stroke={on ? 'var(--color-onaccent)' : kb.accent} />
              {kb.name}
            </button>
          )
        })}
        <span className="num text-[11px] text-ink3">two or three at a time</span>
      </div>

      <form onSubmit={e => { e.preventDefault(); setQ(input) }}
        className="mb-4 flex max-w-[860px] items-center gap-3 rounded-[8px] border border-rule2 bg-surface px-[14px] py-[9px]">
        <input value={input} onChange={e => setInput(e.target.value)}
          className="grow border-0 bg-transparent text-[15px] outline-none placeholder:text-ink3"
          placeholder="Ask them all at once…" />
        <button type="submit" disabled={busy}
          className="grid h-[30px] w-[30px] place-items-center rounded-[5px] bg-accent disabled:opacity-40">
          {busy ? <Spinner accent="var(--color-onaccent)" /> : <Glyph name="send" className="h-[15px] w-[15px]" stroke="var(--color-onaccent)" />}
        </button>
      </form>

      <div className="mb-6 flex flex-wrap gap-2">
        {SAMPLES.map(s => (
          <button key={s} onClick={() => { setInput(s); setQ(s) }}
            className="cursor-pointer rounded-[5px] border px-3 py-[6px] text-[13px]"
            style={s === q
              ? { background: 'var(--color-accentsoft)', borderColor: 'var(--color-accentline)', color: 'var(--color-accent)' }
              : { borderColor: 'var(--color-rule)', color: 'var(--color-ink2)' }}>
            {s}
          </button>
        ))}
      </div>

      {err && <Note tone="stop">{err}</Note>}

      {!data ? (
        <Empty>Retrieving from each corpus…</Empty>
      ) : (
        <>
          <SectionHead n="01" title="What each one retrieves"
            right={<div className="num text-[11px] text-ink3">top 8, same query, no model</div>} />
          <div className={`grid gap-6 ${data.sides.length > 2 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
            {data.sides.map(s => <Column key={s.kb.slug} side={s} onPath={onPath} />)}
          </div>

          <div className="mt-8 rounded-r-[6px] border-l-[3px] border-accent bg-surface px-5 py-4">
            <div className="microlabel mb-2 !text-accent">What the numbers above mean</div>
            <p className="m-0 mb-2 max-w-[84ch] text-[14px] leading-[1.6] text-ink2">
              A column without headings has nothing to cite by name — an answer built on it
              can only say “one of the passages”. Longer windows match far more queries and
              discriminate between them far less. And a window boundary has no reason to
              respect where a provision ends, which is why so many of them open in the
              middle of a sentence.
            </p>
            <p className="m-0 max-w-[84ch] text-[14px] leading-[1.6] text-ink2">
              Article 3 left whole is a 20,000-character blob that matches every query and
              answers none. Split into its individual definitions, it answers “what is a
              deployer” precisely. That is the whole of the difference on this screen — and
              it is a demonstration, not a measurement: the recall figures under{' '}
              <span className="num">Findings</span> were measured on the structured corpus only.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
