import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addTextDocument, deleteDocument, deleteKB, getDocuments, getJob, getKBFull, patchKB,
  readDocument, reindex, uploadDocuments,
  type DocRow, type Job, type KBFull, type Lesson, type RetrievalConfig,
} from '../lib/api'
import { go } from '../lib/router'
import { fmtInt } from '../lib/text'
import Knobs, { mergeCfg } from '../panels/Knobs'
import Sources from '../panels/Sources'
import Glyph from '../ui/Glyph'
import { Btn, Empty, Note, Seg, Tag } from '../ui/controls'
import { JobBar } from './Dashboard'

const bytes = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`

/** One corpus, and everything you can do to it: what is in the vault, what it
 *  became after chunking, and the settings that decide both. */
export default function Corpus({ slug, tab, lessons, onChanged }: {
  slug: string; tab: string
  lessons: Record<string, Lesson> | null
  onChanged: () => void
}) {
  const [full, setFull] = useState<KBFull | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  // Bumped whenever a job finishes, so the document list refetches: the rows on
  // screen were read before the indexing that just changed them.
  const [version, setVersion] = useState(0)

  const reload = useCallback(() => {
    getKBFull(slug).then(setFull).catch(e => setErr(String(e.message ?? e)))
  }, [slug])

  useEffect(() => { setFull(null); setErr(null); reload() }, [slug, reload])

  // While a job runs, poll it — and refresh the corpus once it finishes, because
  // its chunk counts have just changed underneath the page.
  //
  // The callbacks go through a ref rather than the dependency array: passed in
  // as inline arrows they change identity on every render, and an interval that
  // is torn down and recreated each render never reaches its own delay.
  const after = useRef<() => void>(() => {})
  after.current = () => { reload(); onChanged(); setVersion(v => v + 1) }

  const jobId = job?.id
  const jobDone = job?.status === 'done' || job?.status === 'failed'
  useEffect(() => {
    if (!jobId || jobDone) return
    const t = setInterval(async () => {
      try {
        const j = await getJob(jobId)
        setJob(j)
        if (j.status === 'done' || j.status === 'failed') after.current()
      } catch { /* the job row is gone; stop bothering */ }
    }, 1200)
    return () => clearInterval(t)
  }, [jobId, jobDone])

  if (err) return <div className="p-6"><Note tone="stop">{err}</Note></div>
  if (!full) return <Empty>Loading the corpus…</Empty>

  const kb = full.kb
  const tabs = [
    { v: 'documents', label: `Documents${full.documents ? ` · ${full.documents}` : ''}` },
    { v: 'sources', label: 'Sources' },
    { v: 'overview', label: 'What it became' },
    { v: 'settings', label: 'Settings' },
  ]

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="shrink-0 border-b border-rule bg-surface px-6 pt-4 pb-3 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="h-[11px] w-[11px] shrink-0 rounded-full" style={{ background: kb.accent }} />
            <h1 className="m-0 text-[20px] font-semibold tracking-[-.022em]">{kb.name}</h1>
            {full.builtin && <Tag tone="quiet">built in</Tag>}
            <Tag tone={kb.cite_strength === 'exact' ? 'ok' : 'stop'}>{kb.cite_strength} cites</Tag>
            <div className="grow" />
            <Btn accent={kb.accent} kind="quiet" onClick={() => go(`/kb/${kb.slug}/retrieval`)}>
              <Glyph name="lab" className="h-[13px] w-[13px]" /> Search
            </Btn>
            <Btn accent={kb.accent} onClick={() => go(`/kb/${kb.slug}`)}>
              <Glyph name="chat" className="h-[13px] w-[13px]" /> Ask
            </Btn>
          </div>
          <p className="m-0 mb-3 max-w-[80ch] text-[13.5px] text-ink2">{kb.tagline}</p>
          <Seg value={tab} accent={kb.accent} size="md"
            onChange={v => go(`/corpus/${slug}?tab=${v}`)} options={tabs} />
        </div>
      </div>

      <div className="scrollthin grow overflow-y-auto px-6 py-5 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          {job && <div className="mb-4"><JobBar job={job} /></div>}

          {tab === 'documents' && (
            <Documents full={full} version={version} onJob={setJob}
              onChanged={() => { reload(); onChanged() }} />
          )}
          {tab === 'sources' && (
            <Sources slug={slug} accent={kb.accent}
              onChanged={() => { reload(); onChanged(); setVersion(v => v + 1) }} />
          )}
          {tab === 'overview' && <Overview full={full} />}
          {tab === 'settings' && (
            <Settings full={full} lessons={lessons} onJob={setJob}
              onChanged={() => { reload(); onChanged() }} />
          )}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ vault --
function Documents({ full, version, onJob, onChanged }:
  { full: KBFull; version: number; onJob: (j: Job) => void; onChanged: () => void }) {
  const kb = full.kb
  const [docs, setDocs] = useState<DocRow[] | null>(null)
  const [q, setQ] = useState('')
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rejected, setRejected] = useState<{ filename: string; error: string }[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [paste, setPaste] = useState(false)
  const [text, setText] = useState({ title: '', body: '' })
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    getDocuments(kb.slug, q).then(setDocs).catch(() => setDocs([]))
  }, [kb.slug, q])
  useEffect(() => { load() }, [load, version])

  async function send(files: File[]) {
    if (!files.length) return
    setBusy(true); setRejected([])
    try {
      const out = await uploadDocuments(kb.slug, files)
      setRejected(out.rejected)
      if (out.job) onJob({ id: out.job, kb: kb.slug, kind: 'documents', status: 'queued',
                           total: out.accepted.length, done: 0, message: 'queued', error: null,
                           detail: {}, started_at: '', finished_at: '' })
      load(); onChanged()
    } catch (e) {
      setRejected([{ filename: 'upload', error: String((e as Error).message ?? e) }])
    }
    setBusy(false)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter documents…"
            className="grow rounded-[6px] border border-rule bg-surface px-3 py-[6px] text-[13px] outline-none" />
          <Btn accent={kb.accent} kind="quiet" onClick={() => setPaste(p => !p)}>
            <Glyph name="doc" className="h-[13px] w-[13px]" /> Paste text
          </Btn>
        </div>

        {paste && (
          <div className="mb-3 rounded-[7px] border border-rule bg-surface px-4 py-3">
            <input value={text.title} onChange={e => setText({ ...text, title: e.target.value })}
              placeholder="Title"
              className="mb-2 w-full rounded-[5px] border border-rule bg-paper px-3 py-[6px] text-[13px] outline-none" />
            <textarea value={text.body} onChange={e => setText({ ...text, body: e.target.value })}
              placeholder="Markdown or plain text. Headings become the citable sections."
              className="scrollthin mb-2 h-[160px] w-full resize-y rounded-[5px] border border-rule bg-paper px-3 py-2 text-[13px] outline-none" />
            <Btn accent={kb.accent} disabled={!text.title.trim() || !text.body.trim()}
              onClick={async () => {
                const out = await addTextDocument(kb.slug, text)
                onJob({ id: out.job, kb: kb.slug, kind: 'documents', status: 'queued', total: 1,
                        done: 0, message: 'queued', error: null, detail: {}, started_at: '', finished_at: '' })
                setText({ title: '', body: '' }); setPaste(false); load(); onChanged()
              }}>
              Add to the corpus
            </Btn>
          </div>
        )}

        <div onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); send([...e.dataTransfer.files]) }}
          onClick={() => input.current?.click()}
          className="mb-4 cursor-pointer rounded-[8px] border-2 border-dashed px-5 py-7 text-center transition-colors"
          style={{ borderColor: drag ? kb.accent : 'var(--color-rule2)', background: drag ? 'var(--color-accentsoft)' : 'var(--color-surface)' }}>
          <input ref={input} type="file" multiple hidden
            accept=".md,.markdown,.txt,.text,.rst,.csv,.json,.html,.htm,.pdf,.log,.vtt,.srt"
            onChange={e => { send([...(e.target.files ?? [])]); e.target.value = '' }} />
          <Glyph name="upload" className="mx-auto mb-2 h-[22px] w-[22px]" stroke={kb.accent} />
          <div className="text-[14px] font-medium">
            {busy ? 'Reading the files…' : 'Drop documents here, or choose files'}
          </div>
          <div className="num mt-1 text-[11px] text-ink3">
            markdown · plain text · html · csv · json · pdf — cut with {kb.chunker.replace(/_/g, ' ')}
          </div>
        </div>

        {rejected.length > 0 && (
          <div className="mb-4">
            <Note tone="stop">
              <div className="microlabel mb-1 !text-stop">{rejected.length} not taken</div>
              {rejected.map(r => (
                <div key={r.filename} className="text-[12.5px]">
                  <span className="num">{r.filename}</span> — {r.error}
                </div>
              ))}
            </Note>
          </div>
        )}

        {!docs ? <Empty>Loading…</Empty> : docs.length === 0 ? (
          <Note>
            {full.builtin
              ? <>This corpus was ingested from its own source by <span className="num">./ingest.sh</span>,
                  so the vault is empty even though the corpus is not. Anything you upload here is
                  added alongside it and indexed the same way.</>
              : <>Nothing in this corpus yet. Drop a few files above and they are chunked, indexed
                  and searchable in a couple of seconds.</>}
          </Note>
        ) : (
          <div className="scrollthin overflow-x-auto rounded-[7px] border border-rule bg-surface">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {['Document', 'Size', 'Passages', 'Status', ''].map(h => (
                    <th key={h} className="microlabel border-b border-rule px-[13px] py-[8px] text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {docs.map(doc => (
                  <tr key={doc.id}>
                    <td className="border-b border-rule px-[13px] py-[8px]">
                      <button onClick={() => setOpen(doc.source_id)}
                        className="cursor-pointer text-left font-medium hover:underline">{doc.title}</button>
                      <div className="num text-[10.5px] text-ink3">
                        {doc.source_id} · {doc.media_type.replace(/^\w+\//, '')} · {doc.lang}
                      </div>
                    </td>
                    <td className="num border-b border-rule px-[13px] py-[8px] text-ink2">{bytes(doc.bytes)}</td>
                    <td className="num border-b border-rule px-[13px] py-[8px] text-ink2">{doc.chunks || '—'}</td>
                    <td className="border-b border-rule px-[13px] py-[8px]">
                      <Tag tone={doc.status === 'ready' ? 'ok' : doc.status === 'failed' ? 'stop' : 'warn'}>
                        {doc.status}
                      </Tag>
                      {doc.error && <div className="mt-1 max-w-[30ch] text-[11px] text-stop">{doc.error}</div>}
                    </td>
                    <td className="border-b border-rule px-[13px] py-[8px] text-right">
                      <button title="Remove this document and its passages"
                        onClick={async () => {
                          if (!confirm(`Remove ${doc.title} and its ${doc.chunks} passages?`)) return
                          await deleteDocument(kb.slug, doc.source_id); load(); onChanged()
                        }}
                        className="cursor-pointer">
                        <Glyph name="trash" className="h-[14px] w-[14px]" stroke="var(--color-ink3)" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
          <div className="microlabel mb-2">How this corpus is cut</div>
          <div className="text-[13px] font-medium">{kb.chunker.replace(/_/g, ' ')}</div>
          <p className="m-0 mt-1 text-[12px] leading-[1.5] text-ink3">
            {full.chunkers[kb.chunker] ??
              'A chunker specific to this corpus — it parses one source format and does not apply to uploads.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn accent={kb.accent} kind="quiet" disabled={!full.documents}
              title={full.documents ? undefined : 'Nothing stored to re-cut'}
              onClick={async () => {
                const out = await reindex(kb.slug)
                onJob({ id: out.job, kb: kb.slug, kind: 'reindex', status: 'queued',
                        total: out.documents, done: 0, message: 'queued', error: null,
                        detail: {}, started_at: '', finished_at: '' })
              }}>
              <Glyph name="refresh" className="h-[13px] w-[13px]" /> Re-cut everything
            </Btn>
          </div>
          <p className="m-0 mt-2 text-[11.5px] leading-[1.5] text-ink3">
            The original text is kept, so changing the chunker in Settings and re-cutting
            gives different passages from the same files — no re-upload.
          </p>
        </div>

        {open && <DocPreview slug={kb.slug} sourceId={open} accent={kb.accent} onClose={() => setOpen(null)} />}
      </aside>
    </div>
  )
}

function DocPreview({ slug, sourceId, accent, onClose }:
  { slug: string; sourceId: string; accent: string; onClose: () => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof readDocument>> | null>(null)
  useEffect(() => { setD(null); readDocument(slug, sourceId).then(setD).catch(() => setD(null)) }, [slug, sourceId])
  return (
    <div className="rounded-[7px] border border-rule bg-surface">
      <div className="flex items-center gap-2 border-b border-rule px-4 py-[8px]">
        <div className="microlabel truncate">{sourceId}</div>
        <div className="grow" />
        <button onClick={onClose} className="cursor-pointer">
          <Glyph name="close" className="h-[14px] w-[14px]" stroke="var(--color-ink3)" />
        </button>
      </div>
      {!d ? <div className="px-4 py-4 text-[13px] text-ink3">Loading…</div> : (
        <div className="scrollthin max-h-[420px] overflow-y-auto px-4 py-3">
          <div className="microlabel mb-2">{d.chunks.length} passages cut from it</div>
          {d.chunks.map(c => (
            <div key={c.path} className="border-b border-rule py-[6px] last:border-0">
              <div className="num text-[11.5px]" style={{ color: accent }}>{c.path}</div>
              <div className="text-[12px] leading-[1.4] text-ink2">{c.heading}</div>
              <div className="num text-[10.5px] text-ink3">{c.chars} chars</div>
            </div>
          ))}
          <div className="microlabel mt-4 mb-1">The text as stored</div>
          <pre className="scrollthin m-0 max-h-[220px] overflow-auto whitespace-pre-wrap text-[11.5px] leading-[1.6] text-ink2">
{d.document.body.slice(0, 4000)}
          </pre>
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------- overview --
function Overview({ full }: { full: KBFull }) {
  const s = full.stats
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div>
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          {[
            ['Passages', fmtInt(s.chunks)],
            ['Avg length', `${fmtInt(s.avg_chars)} ch`],
            ['With a heading', fmtInt(s.with_heading)],
            ['Languages', String(s.langs)],
          ].map(([l, v]) => (
            <div key={l} className="rounded-[7px] border border-rule bg-surface px-4 py-3">
              <div className="microlabel mb-1">{l}</div>
              <div className="num text-[20px] leading-none">{v}</div>
            </div>
          ))}
        </div>

        <div className="mb-2 flex items-center gap-2">
          <div className="microlabel">What kind of passage</div><div className="h-px grow bg-rule" />
        </div>
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
          {full.kinds.map(k => (
            <div key={k.kind} className="flex items-center gap-3 py-[4px]">
              <span className="w-[110px] shrink-0 text-[13px]">{k.kind}</span>
              <div className="h-[7px] rounded-[2px]"
                style={{ width: `${(k.n / Math.max(...full.kinds.map(x => x.n))) * 60}%`, background: full.kb.accent }} />
              <span className="num ml-auto text-[11.5px] text-ink2">{fmtInt(k.n)}</span>
            </div>
          ))}
          {!full.kinds.length && <span className="text-[13px] text-ink3">Nothing indexed yet.</span>}
        </div>

        {s.with_heading < s.chunks && s.chunks > 0 && (
          <div className="mt-4">
            <Note tone="warn">
              <div className="microlabel mb-1 !text-warn">
                {fmtInt(s.chunks - s.with_heading)} passages have no heading
              </div>
              A passage without a heading has nothing to cite it by beyond its position, so an
              answer resting on one can only say “one of the passages”. That is a property of
              how this corpus was cut, not of the retriever.
            </Note>
          </div>
        )}
      </div>

      <aside>
        <div className="mb-2 flex items-center gap-2">
          <div className="microlabel">Words this corpus ignores</div><div className="h-px grow bg-rule" />
        </div>
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
          <p className="m-0 mb-3 text-[12px] leading-[1.5] text-ink3">
            Derived from the corpus itself: any lexeme in more than the configured share of it
            carries no signal here and is stripped from queries. Postgres full-text search has no
            IDF, so nothing else does this.
          </p>
          <div className="flex flex-wrap gap-[5px]">
            {full.stopwords.map(w => (
              <span key={w.lang + w.lexeme} title={`${w.df} passages · ${w.lang}`}
                className="num rounded-[3px] border border-rule bg-paper px-[6px] py-[2px] text-[11px] text-ink2">
                {w.lexeme}
              </span>
            ))}
            {!full.stopwords.length && <span className="text-[12.5px] text-ink3">None derived yet.</span>}
          </div>
        </div>
      </aside>
    </div>
  )
}

// --------------------------------------------------------------- settings --
function Settings({ full, lessons, onJob, onChanged }: {
  full: KBFull; lessons: Record<string, Lesson> | null
  onJob: (j: Job) => void; onChanged: () => void
}) {
  const kb = full.kb
  const [form, setForm] = useState({
    name: kb.name, tagline: kb.tagline, chunker: kb.chunker,
    persona_prompt: kb.persona_prompt, default_lang: kb.default_lang,
    langs: kb.langs.join(', '), cite_strength: kb.cite_strength,
    sample_questions: (kb.sample_questions ?? []).join('\n'),
  })
  const [cfg, setCfg] = useState<Partial<RetrievalConfig>>({})
  const [saved, setSaved] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  useEffect(() => {
    setForm({
      name: kb.name, tagline: kb.tagline, chunker: kb.chunker,
      persona_prompt: kb.persona_prompt, default_lang: kb.default_lang,
      langs: kb.langs.join(', '), cite_strength: kb.cite_strength,
      sample_questions: (kb.sample_questions ?? []).join('\n'),
    })
    setCfg({})
  }, [kb.slug])

  const chunkerChanged = form.chunker !== kb.chunker

  async function save() {
    setErr(null)
    try {
      await patchKB(kb.slug, {
        name: form.name, tagline: form.tagline, chunker: form.chunker,
        persona_prompt: form.persona_prompt, default_lang: form.default_lang,
        langs: form.langs.split(',').map(s => s.trim()).filter(Boolean),
        cite_strength: form.cite_strength,
        sample_questions: form.sample_questions.split('\n').map(s => s.trim()).filter(Boolean),
        ...(Object.keys(cfg).length ? { retrieval_config: mergeCfg(kb.retrieval_config, cfg) } : {}),
      })
      setSaved('Saved.')
      setTimeout(() => setSaved(null), 2500)
      onChanged()
      if (chunkerChanged && full.documents) {
        const out = await reindex(kb.slug)
        onJob({ id: out.job, kb: kb.slug, kind: 'reindex', status: 'queued', total: out.documents,
                done: 0, message: 'queued', error: null, detail: {}, started_at: '', finished_at: '' })
      }
    } catch (e) { setErr(String((e as Error).message ?? e)) }
  }

  const field = (label: string, key: keyof typeof form, help?: string, area?: boolean) => (
    <label className="mb-3 block">
      <span className="microlabel">{label}</span>
      {area ? (
        <textarea value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
          className="scrollthin mt-1 h-[150px] w-full resize-y rounded-[6px] border border-rule bg-surface px-3 py-2 text-[13px] leading-[1.55] outline-none" />
      ) : (
        <input value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
          className="mt-1 w-full rounded-[6px] border border-rule bg-surface px-3 py-[7px] text-[13.5px] outline-none" />
      )}
      {help && <span className="mt-1 block text-[11.5px] leading-[1.45] text-ink3">{help}</span>}
    </label>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        {full.builtin && (
          <div className="mb-4">
            <Note tone="warn">
              <div className="microlabel mb-1 !text-warn">This corpus is defined in code</div>
              Changes here are saved, and <span className="num">kbs.py</span> re-seeds them back on
              the next restart. To keep them, edit that file — or copy this corpus into one of your
              own.
            </Note>
          </div>
        )}

        {field('Name', 'name')}
        {field('What it holds', 'tagline')}

        <label className="mb-3 block">
          <span className="microlabel">Chunker</span>
          <select value={form.chunker} onChange={e => setForm({ ...form, chunker: e.target.value })}
            className="mt-1 w-full cursor-pointer rounded-[6px] border border-rule bg-surface px-3 py-[7px] text-[13.5px]">
            {Object.entries(full.chunkers).map(([k, v]) => <option key={k} value={k}>{k.replace(/_/g, ' ')} — {v}</option>)}
            {!(form.chunker in full.chunkers) && <option value={form.chunker}>{form.chunker} (source-specific)</option>}
          </select>
          <span className="mt-1 block text-[11.5px] leading-[1.45] text-ink3">
            {chunkerChanged && full.documents > 0
              ? `Saving re-cuts all ${full.documents} stored documents under the new chunker.`
              : 'How documents are cut into retrievable passages. The single decision with the largest effect on what can be cited.'}
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          {field('Languages', 'langs', 'Comma-separated. Each gets its own text-search configuration.')}
          {field('Default language', 'default_lang')}
        </div>

        {field('Sample questions', 'sample_questions', 'One per line. They appear on the chat and search screens.', true)}
        {field('Persona', 'persona_prompt', 'The system prompt this corpus answers under. The quote-verification rules live here — removing them does not disable checking, it just stops the model being told about it.', true)}

        <div className="flex flex-wrap items-center gap-3">
          <Btn accent={kb.accent} onClick={save}>Save</Btn>
          {saved && <span className="num text-[12px] text-ok">{saved}</span>}
          {err && <span className="num text-[12px] text-stop">{err}</span>}
        </div>

        <div className="mt-8 rounded-[7px] border border-stoprule bg-stopbg px-4 py-4">
          <div className="microlabel mb-2 !text-stop">Delete this corpus</div>
          <p className="m-0 mb-3 text-[13px] leading-[1.5] text-ink2">
            Removes the corpus, its {fmtInt(full.stats.chunks)} passages and its {full.documents}{' '}
            stored documents. Traces of past answers survive, but their passages will no longer
            resolve.{full.builtin && ' This one is built in, so an empty copy reappears on restart.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={confirmText} onChange={e => setConfirmText(e.target.value)}
              placeholder={`type ${kb.slug} to confirm`}
              className="num rounded-[5px] border border-stoprule bg-surface px-3 py-[6px] text-[12.5px] outline-none" />
            <button disabled={confirmText !== kb.slug}
              onClick={async () => { await deleteKB(kb.slug); onChanged(); go('/corpora') }}
              className="cursor-pointer rounded-[5px] border border-stoprule bg-stop px-[13px] py-[7px] text-[12.5px] text-[var(--color-onaccent)] disabled:opacity-40">
              Delete
            </button>
          </div>
        </div>
      </div>

      <aside>
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-4">
          <div className="mb-3 flex items-center gap-[10px]">
            <Glyph name="sliders" className="h-[15px] w-[15px]" stroke={kb.accent} />
            <div className="microlabel">Retrieval defaults</div>
            <div className="h-px grow bg-rule" />
          </div>
          <p className="m-0 mb-3 text-[11.5px] leading-[1.5] text-ink3">
            What every question against this corpus uses unless it is overridden for one run. Try a
            change in the search lab first — there it is free and reversible.
          </p>
          <Knobs base={kb.retrieval_config} changes={cfg} accent={kb.accent} lessons={lessons}
            showAnswer onChange={p => setCfg(c => ({ ...c, ...p }))} onReset={() => setCfg({})} />
          {Object.keys(cfg).length > 0 && (
            <p className="num mt-3 mb-0 text-[11.5px] text-warn">
              Unsaved — press Save on the left to make these the corpus defaults.
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}
