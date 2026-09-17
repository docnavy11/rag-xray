import { useEffect, useMemo, useState } from 'react'
import { getChunk, type Chunk, type Citation, type KB } from '../lib/api'
import { locateSpan } from '../lib/text'
import Glyph from '../ui/Glyph'
import { Note, Tag } from '../ui/controls'

/** The passage, with the verified span highlighted where it really is.
 *
 *  The highlight is recomputed in the browser rather than read off the API's
 *  offsets, which are positions in cite.py's normalised haystack and do not line
 *  up with the characters on screen. When the span cannot be located, nothing is
 *  highlighted — on a screen about verification, an approximate highlight would
 *  be the wrong kind of lie. */
export default function SourceDrawer({ kb, path, lang, citations, onClose }: {
  kb: KB; path: string; lang?: string
  citations?: Citation[]
  onClose: () => void
}) {
  const [chunk, setChunk] = useState<Chunk | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let live = true
    setChunk(null); setMissing(false)
    getChunk(kb.slug, path, lang).then(c => {
      if (!live) return
      if (c) setChunk(c); else setMissing(true)
    })
    return () => { live = false }
  }, [kb.slug, path, lang])

  const quotes = useMemo(
    () => (citations ?? []).filter(c => c.path === path && c.cited_text).map(c => c.cited_text!),
    [citations, path])

  return (
    <aside className="flex w-full shrink-0 flex-col border-l border-rule bg-surface lg:w-[392px]">
      <div className="border-b border-rule px-[22px] pt-[17px] pb-[13px]">
        <div className="mb-2 flex items-center gap-[10px]">
          <div className="num text-[13px] font-medium" style={{ color: kb.accent }}>{path}</div>
          {chunk && (
            <Tag tone="ok">
              {chunk.kind}{chunk.valid_from && chunk.valid_from !== '2000-01-01' ? ' · in force' : ''}
            </Tag>
          )}
          <div className="grow" />
          <button onClick={onClose} className="cursor-pointer" aria-label="Close">
            <Glyph name="close" className="h-[15px] w-[15px]" stroke="var(--color-ink3)" />
          </button>
        </div>
        {chunk?.heading && (
          <div className="text-[14.5px] font-semibold leading-tight">
            <Marked text={chunk.heading} quotes={quotes} accent={kb.accent} />
          </div>
        )}
      </div>

      <div className="scrollthin grow overflow-y-auto px-[22px] py-4">
        {missing ? (
          <p className="m-0 text-[13.5px] leading-[1.6] text-ink2">
            This corpus has no passage at <span className="num">{path}</span>. That is the
            interesting case: the model produced an identifier that does not exist, and
            nothing here will dress it as a source.
          </p>
        ) : !chunk ? (
          <div className="text-[13px] text-ink3">Loading the passage…</div>
        ) : (
          <>
            {quotes.length > 0 && (
              <div className="mb-3 text-[11.5px] text-ink3">
                {quotes.length} verified quotation{quotes.length > 1 ? 's' : ''} highlighted below.
              </div>
            )}
            <p className="m-0 whitespace-pre-wrap text-[14px] leading-[1.72] text-ink2">
              <Marked text={chunk.body} quotes={quotes} accent={kb.accent} />
            </p>

            <div className="num mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-rule pt-3 text-[11px] text-ink3">
              <span>{chunk.body.length.toLocaleString()} characters</span>
              <span>lang {chunk.lang}</span>
              {chunk.valid_from && <span>in force from {chunk.valid_from}</span>}
              {chunk.valid_to && <span>until {chunk.valid_to}</span>}
            </div>

            {chunk.url && (
              <a href={chunk.url} target="_blank" rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-[13px] no-underline" style={{ color: kb.accent }}>
                <Glyph name="link" className="h-[13px] w-[13px]" /> Open the source
              </a>
            )}

            {kb.cite_strength !== 'exact' && (
              <div className="mt-4">
                <Note tone="warn">
                  <div className="microlabel mb-[6px] !text-warn">Weaker citation</div>
                  This corpus has no canonical identifiers, so a citation points at a
                  position in the text, not at a clause or a timestamp. A demo where every
                  answer carries a perfect receipt would be hiding that.
                </Note>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

/** Highlight each located quote. Overlapping spans are merged so a passage
 *  quoted twice does not nest <mark> inside <mark>. */
function Marked({ text, quotes, accent }: { text: string; quotes: string[]; accent: string }) {
  const spans = useMemo(() => {
    const found = quotes
      .map(q => locateSpan(text, q))
      .filter((s): s is [number, number] => s != null)
      .sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const s of found) {
      const last = merged[merged.length - 1]
      if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
      else merged.push([...s] as [number, number])
    }
    return merged
  }, [text, quotes])

  if (!spans.length) return <>{text}</>

  const out: React.ReactNode[] = []
  let cursor = 0
  spans.forEach(([s, e], i) => {
    if (s > cursor) out.push(<span key={`t${i}`}>{text.slice(cursor, s)}</span>)
    out.push(
      <mark key={`m${i}`} className="rounded-[2px] px-[1px]"
        style={{ background: 'var(--color-accentsoft)', color: 'var(--color-ink)', boxShadow: `inset 0 -1.5px 0 ${accent}` }}>
        {text.slice(s, e)}
      </mark>)
    cursor = e
  })
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>)
  return <>{out}</>
}
