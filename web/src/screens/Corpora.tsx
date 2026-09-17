import { useState } from 'react'
import { createKB, type KB } from '../lib/api'
import { go } from '../lib/router'
import { fmtInt } from '../lib/text'
import Glyph from '../ui/Glyph'
import { Btn, Note, Tag } from '../ui/controls'

const CHUNKERS: [string, string][] = [
  ['markdown_headings', 'Heading hierarchy — one passage per heading, the breadcrumb kept as its title. Best for docs, runbooks, wikis.'],
  ['fixed_overlap', 'Fixed windows — ~800 tokens with overlap, ignores structure. Works on anything, cites nothing well.'],
  ['transcript_window', 'Transcript windows — sentence-aware, for spoken text with no headings.'],
]

/** Every corpus in the system, and the front door for making another. */
export default function Corpora({ kbs, onChanged }: { kbs: KB[]; onChanged: () => void }) {
  const [making, setMaking] = useState(false)
  const [form, setForm] = useState({ name: '', tagline: '', chunker: 'markdown_headings', langs: 'en' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true); setErr(null)
    try {
      const kb = await createKB({
        name: form.name, tagline: form.tagline,
        chunker: form.chunker,
        langs: form.langs.split(',').map(s => s.trim()).filter(Boolean),
        default_lang: form.langs.split(',')[0]?.trim() || 'en',
      })
      onChanged()
      go(`/corpus/${kb.slug}?tab=documents`)
    } catch (e) { setErr(String((e as Error).message ?? e)) }
    setBusy(false)
  }

  return (
    <div className="scrollthin grow overflow-y-auto px-6 py-6 lg:px-8">
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-[22px] font-semibold tracking-[-.022em]">Corpora</h1>
            <p className="m-0 mt-1 max-w-[70ch] text-[13.5px] text-ink2">
              Each one is a separate collection with its own documents, its own chunker, its own
              retrieval settings and its own persona — not a filter over a single pile.
            </p>
          </div>
          <Btn accent="var(--color-accent)" onClick={() => setMaking(m => !m)}>
            <Glyph name="plus" className="h-[13px] w-[13px]" /> New corpus
          </Btn>
        </div>

        {making && (
          <div className="mb-6 rounded-[7px] border border-rule bg-surface px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="microlabel">Name</span>
                <input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Team runbooks"
                  className="mt-1 w-full rounded-[6px] border border-rule bg-paper px-3 py-[7px] text-[13.5px] outline-none" />
              </label>
              <label className="block">
                <span className="microlabel">What it holds</span>
                <input value={form.tagline} onChange={e => setForm({ ...form, tagline: e.target.value })}
                  placeholder="Operational docs for the platform team"
                  className="mt-1 w-full rounded-[6px] border border-rule bg-paper px-3 py-[7px] text-[13.5px] outline-none" />
              </label>
            </div>

            <div className="mt-3">
              <span className="microlabel">How to cut it up</span>
              <div className="mt-1 flex flex-col gap-2">
                {CHUNKERS.map(([k, what]) => (
                  <button key={k} onClick={() => setForm({ ...form, chunker: k })}
                    className="cursor-pointer rounded-[6px] border px-3 py-2 text-left"
                    style={form.chunker === k
                      ? { borderColor: 'var(--color-accent)', background: 'var(--color-accentsoft)' }
                      : { borderColor: 'var(--color-rule)', background: 'var(--color-paper)' }}>
                    <div className="num text-[12.5px] font-medium">{k.replace(/_/g, ' ')}</div>
                    <div className="text-[12px] leading-[1.45] text-ink2">{what}</div>
                  </button>
                ))}
              </div>
            </div>

            <label className="mt-3 block max-w-[240px]">
              <span className="microlabel">Languages</span>
              <input value={form.langs} onChange={e => setForm({ ...form, langs: e.target.value })}
                className="num mt-1 w-full rounded-[6px] border border-rule bg-paper px-3 py-[7px] text-[13px] outline-none" />
            </label>

            {err && <div className="mt-3"><Note tone="stop">{err}</Note></div>}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Btn accent="var(--color-accent)" onClick={create} busy={busy} disabled={!form.name.trim()}>
                Create and add documents
              </Btn>
              <Btn accent="var(--color-accent)" kind="quiet" onClick={() => setMaking(false)}>Cancel</Btn>
            </div>
          </div>
        )}

        <div className="grid gap-[14px] lg:grid-cols-2">
          {kbs.map(kb => (
            <div key={kb.slug} className="flex flex-col rounded-[7px] border border-rule bg-surface p-5"
              style={{ borderTop: `3px solid ${kb.accent}` }}>
              <div className="mb-1 flex flex-wrap items-center gap-[10px]">
                <Glyph name={kb.glyph} className="h-[18px] w-[18px] shrink-0" stroke={kb.accent} />
                <button onClick={() => go(`/corpus/${kb.slug}`)}
                  className="cursor-pointer text-[16.5px] font-semibold tracking-[-.015em] hover:underline">
                  {kb.name}
                </button>
                <Tag tone={kb.cite_strength === 'exact' ? 'ok' : 'stop'}>{kb.cite_strength} cites</Tag>
              </div>
              <p className="mt-0 mb-3 text-[14px] leading-[1.5] text-ink2">{kb.tagline}</p>
              <div className="num mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink3">
                <span>{fmtInt(kb.chunks)} passages</span>
                <span>{kb.langs.join(' ')}</span>
                <span>{kb.chunker.replace(/_/g, ' ')}</span>
                {kb.stopwords > 0 && <span>{kb.stopwords} stopwords</span>}
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Btn accent={kb.accent} onClick={() => go(`/kb/${kb.slug}`)}>Ask</Btn>
                <Btn accent={kb.accent} kind="quiet" onClick={() => go(`/kb/${kb.slug}/retrieval`)}>Search</Btn>
                <Btn accent={kb.accent} kind="quiet" onClick={() => go(`/corpus/${kb.slug}?tab=documents`)}>
                  <Glyph name="doc" className="h-[13px] w-[13px]" /> Documents
                </Btn>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
