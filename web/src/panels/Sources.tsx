import { useCallback, useEffect, useState } from 'react'
import {
  createSource, deleteSource, discoverMcp, getSourceKinds, getSourceRuns, getSources,
  patchSource, previewSource, syncSource,
  type McpTool, type Preset, type Source, type SourceRun,
} from '../lib/api'
import Glyph from '../ui/Glyph'
import { Btn, Empty, Note, Seg, Tag, Toggle } from '../ui/controls'

const SCHEDULES: { v: number; label: string }[] = [
  { v: 0, label: 'Only when I ask' },
  { v: 15, label: 'Every 15 minutes' },
  { v: 60, label: 'Hourly' },
  { v: 360, label: 'Every 6 hours' },
  { v: 1440, label: 'Daily' },
  { v: 10080, label: 'Weekly' },
]

const everyLabel = (m: number) =>
  SCHEDULES.find(s => s.v === m)?.label ?? (m >= 1440 ? `Every ${Math.round(m / 1440)} days`
    : m >= 60 ? `Every ${Math.round(m / 60)} hours` : `Every ${m} minutes`)

function when(ts: string): string {
  if (!ts) return '—'
  const d = new Date(ts.replace(' ', 'T'))
  const mins = Math.round((d.getTime() - Date.now()) / 60000)
  if (Number.isNaN(mins)) return ts.slice(0, 16)
  if (mins <= -1440 || mins >= 1440) return ts.slice(0, 16)
  if (mins === 0) return 'now'
  return mins > 0 ? `in ${mins} min` : `${-mins} min ago`
}

/** Sources: a connector plus a schedule.
 *
 *  The two things this screen has to make obvious, because they are what people
 *  get wrong: whether it can actually reach the thing (Test connection, before
 *  saving), and what it did last time it tried (the run log, not a green dot). */
export default function Sources({ slug, accent, onChanged }:
  { slug: string; accent: string; onChanged: () => void }) {
  const [sources, setSources] = useState<Source[] | null>(null)
  const [kinds, setKinds] = useState<Awaited<ReturnType<typeof getSourceKinds>> | null>(null)
  const [adding, setAdding] = useState(false)
  const [openRuns, setOpenRuns] = useState<number | null>(null)

  const load = useCallback(() => {
    getSources(slug).then(setSources).catch(() => setSources([]))
  }, [slug])

  useEffect(() => { load(); getSourceKinds().then(setKinds).catch(() => setKinds(null)) }, [load])

  // Poll while anything is mid-sync, so "running" resolves on its own.
  useEffect(() => {
    if (!sources?.some(s => s.last_status === 'running')) return
    const t = setInterval(() => { load(); onChanged() }, 2500)
    return () => clearInterval(t)
  }, [sources?.map(s => s.last_status).join(','), load, onChanged])

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="microlabel">Connected sources</div>
          <div className="h-px grow bg-rule" />
          <Btn accent={accent} onClick={() => setAdding(a => !a)}>
            <Glyph name="plus" className="h-[13px] w-[13px]" /> Add a source
          </Btn>
        </div>

        {adding && kinds && (
          <AddSource slug={slug} accent={accent} presets={kinds.presets}
            onDone={() => { setAdding(false); load(); onChanged() }}
            onCancel={() => setAdding(false)} />
        )}

        {!sources ? <Empty>Loading…</Empty> : sources.length === 0 && !adding ? (
          <Note>
            Nothing connected. A source fetches documents on a schedule — a folder on this
            server, a list of URLs, or any MCP server that can list and read files. Uploading by
            hand keeps working either way.
          </Note>
        ) : (
          <div className="flex flex-col gap-3">
            {sources.map(s => (
              <div key={s.id} className="rounded-[7px] border border-rule bg-surface px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Glyph name={s.kind === 'mcp' ? 'plug' : s.kind === 'http' ? 'link' : 'doc'}
                    className="h-[15px] w-[15px] shrink-0" stroke={accent} />
                  <span className="text-[14px] font-medium">{s.name}</span>
                  <Tag tone="quiet">{s.kind}</Tag>
                  {s.last_status === 'failed'
                    ? <Tag tone="stop">last run failed</Tag>
                    : s.last_status === 'running'
                      ? <Tag tone="warn">syncing…</Tag>
                      : s.last_status === 'done' ? <Tag tone="ok">ok</Tag> : null}
                  {s.prune && <Tag tone="warn">prunes</Tag>}
                  <div className="grow" />
                  <Toggle on={s.enabled} accent={accent}
                    onClick={async () => { await patchSource(s.id, { enabled: !s.enabled }); load() }} />
                </div>

                <div className="num mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-ink3">
                  <span>{everyLabel(s.every_minutes)}</span>
                  <span>{s.documents} documents</span>
                  <span>last run {when(s.last_run_at)}</span>
                  {s.every_minutes > 0 && s.enabled && <span>next {when(s.next_run_at)}</span>}
                </div>

                {s.last_error && (
                  <div className="mb-2">
                    <Note tone="stop">
                      <div className="microlabel mb-1 !text-stop">What it said</div>
                      <span className="num text-[12px]">{s.last_error}</span>
                    </Note>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <select value={s.every_minutes}
                    onChange={async e => { await patchSource(s.id, { every_minutes: Number(e.target.value) }); load() }}
                    className="num cursor-pointer rounded-[5px] border border-rule bg-paper px-2 py-[5px] text-[12px]">
                    {SCHEDULES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                  <Btn accent={accent} kind="quiet"
                    onClick={async () => { await syncSource(s.id); load() }}>
                    <Glyph name="refresh" className="h-[13px] w-[13px]" /> Sync now
                  </Btn>
                  <Btn accent={accent} kind="quiet"
                    onClick={() => setOpenRuns(openRuns === s.id ? null : s.id)}>
                    {openRuns === s.id ? 'Hide runs' : 'Run history'}
                  </Btn>
                  <div className="grow" />
                  <button title="Disconnect this source"
                    onClick={async () => {
                      const withDocs = confirm(
                        `Disconnect "${s.name}".\n\nOK also deletes the ${s.documents} documents it fetched.\n` +
                        'Cancel keeps them and only stops the syncing.')
                      await deleteSource(s.id, withDocs); load(); onChanged()
                    }}
                    className="cursor-pointer">
                    <Glyph name="trash" className="h-[14px] w-[14px]" stroke="var(--color-ink3)" />
                  </button>
                </div>

                {openRuns === s.id && <Runs id={s.id} />}
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
          <div className="microlabel mb-2">The scheduler</div>
          {kinds ? (
            <>
              <div className="flex items-center gap-2 text-[13px]">
                <span className="h-[8px] w-[8px] rounded-full"
                  style={{ background: kinds.scheduler.running ? 'var(--color-ok)' : 'var(--color-stop)' }} />
                {kinds.scheduler.running ? 'Running' : 'Not running'}
                <span className="num text-[11px] text-ink3">
                  checks every {kinds.scheduler.tick_seconds}s
                </span>
              </div>
              <p className="m-0 mt-2 text-[11.5px] leading-[1.5] text-ink3">
                It lives in this API process, so nothing syncs while the server is down. Anything
                that fell due meanwhile runs once, shortly after it comes back — missed intervals
                are not replayed.
              </p>
            </>
          ) : <span className="text-[13px] text-ink3">Unknown.</span>}
        </div>

        <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
          <div className="microlabel mb-2">How a sync decides</div>
          <ul className="m-0 list-none p-0 text-[12px] leading-[1.55] text-ink2">
            <li className="py-[3px]">Every item is hashed. Unchanged ones are skipped — no re-chunking, no churn.</li>
            <li className="py-[3px]">Changed ones are re-cut and re-indexed in place, keeping their citation id.</li>
            <li className="py-[3px]">Deleting upstream only removes anything here if <b>prune</b> is on for that source.</li>
            <li className="py-[3px]">A listing that comes back empty prunes nothing, so an outage cannot empty a corpus.</li>
          </ul>
        </div>
      </aside>
    </div>
  )
}

function Runs({ id }: { id: number }) {
  const [runs, setRuns] = useState<SourceRun[] | null>(null)
  useEffect(() => { getSourceRuns(id).then(setRuns).catch(() => setRuns([])) }, [id])
  if (!runs) return <div className="mt-3 text-[12px] text-ink3">Loading…</div>
  if (!runs.length) return <div className="mt-3 text-[12px] text-ink3">It has not run yet.</div>
  return (
    <div className="mt-3 rounded-[6px] border border-rule bg-paper">
      {runs.map(r => (
        <div key={r.id} className="border-b border-rule px-3 py-[6px] last:border-0">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={r.status === 'failed' ? 'stop' : r.status === 'running' ? 'warn' : 'ok'}>
              {r.status}
            </Tag>
            <span className="num text-[11px] text-ink3">{r.trigger}</span>
            <span className="text-[12px]">{r.message || (r.status === 'running' ? 'in progress' : '')}</span>
            <span className="num ml-auto text-[10.5px] text-ink3">{r.started_at.slice(0, 16)}</span>
          </div>
          {r.error && <div className="num mt-1 text-[11px] text-stop">{r.error}</div>}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------- add ----
function AddSource({ slug, accent, presets, onDone, onCancel }: {
  slug: string; accent: string; presets: Preset[]
  onDone: () => void; onCancel: () => void
}) {
  const [preset, setPreset] = useState<Preset | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Source['kind']>('mcp')
  const [config, setConfig] = useState<any>({})
  const [every, setEvery] = useState(60)
  const [prune, setPrune] = useState(false)
  const [tools, setTools] = useState<McpTool[] | null>(null)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewSource>> | null>(null)
  const [busy, setBusy] = useState<'discover' | 'preview' | 'save' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function choose(p: Preset) {
    setPreset(p); setKind(p.kind); setConfig(JSON.parse(JSON.stringify(p.config)))
    setName(n => n || p.name); setTools(null); setPreview(null); setErr(null)
  }

  const set = (k: string, v: any) => setConfig((c: any) => ({ ...c, [k]: v }))

  async function discover() {
    setBusy('discover'); setErr(null); setTools(null)
    try {
      const out = await discoverMcp(config)
      setTools(out.tools)
      setConfig((c: any) => ({
        ...c,
        list_tool: c.list_tool || out.suggested.list_tool,
        read_tool: c.read_tool || out.suggested.read_tool,
        read_arg: c.read_arg || out.suggested.read_arg,
      }))
    } catch (e) { setErr(String((e as Error).message ?? e)) }
    setBusy(null)
  }

  async function dryRun() {
    setBusy('preview'); setErr(null); setPreview(null)
    try { setPreview(await previewSource(kind, config)) }
    catch (e) { setErr(String((e as Error).message ?? e)) }
    setBusy(null)
  }

  async function save() {
    setBusy('save'); setErr(null)
    try {
      await createSource(slug, { name: name || 'Source', kind, config, every_minutes: every, prune })
      onDone()
    } catch (e) { setErr(String((e as Error).message ?? e)) }
    setBusy(null)
  }

  const text = (label: string, key: string, placeholder = '', help = '') => (
    <label className="mb-2 block">
      <span className="microlabel">{label}</span>
      <input value={config[key] ?? ''} onChange={e => set(key, e.target.value)} placeholder={placeholder}
        className="num mt-1 w-full rounded-[5px] border border-rule bg-paper px-3 py-[6px] text-[12.5px] outline-none" />
      {help && <span className="mt-[2px] block text-[11px] leading-[1.4] text-ink3">{help}</span>}
    </label>
  )

  const json = (label: string, key: string, help = '') => (
    <label className="mb-2 block">
      <span className="microlabel">{label}</span>
      <textarea
        value={typeof config[key] === 'string' ? config[key] : JSON.stringify(config[key] ?? {}, null, 0)}
        onChange={e => {
          try { set(key, JSON.parse(e.target.value || '{}')) } catch { set(key, e.target.value) }
        }}
        className="scrollthin num mt-1 h-[52px] w-full resize-y rounded-[5px] border border-rule bg-paper px-3 py-2 text-[12px] outline-none" />
      {help && <span className="mt-[2px] block text-[11px] leading-[1.4] text-ink3">{help}</span>}
    </label>
  )

  return (
    <div className="mb-4 rounded-[7px] border border-rule bg-surface px-5 py-4">
      <div className="microlabel mb-2">Start from</div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        {presets.map(p => (
          <button key={p.id} onClick={() => choose(p)}
            className="cursor-pointer rounded-[6px] border px-3 py-2 text-left"
            style={preset?.id === p.id
              ? { borderColor: accent, background: 'var(--color-accentsoft)' }
              : { borderColor: 'var(--color-rule)', background: 'var(--color-paper)' }}>
            <div className="mb-[2px] flex items-center gap-2">
              <span className="text-[13px] font-medium">{p.name}</span>
              {p.verified
                ? <Tag tone="ok">tested here</Tag>
                : <Tag tone="warn">shape only</Tag>}
            </div>
            <div className="text-[11.5px] leading-[1.45] text-ink2">{p.what}</div>
          </button>
        ))}
      </div>

      {preset && (
        <>
          <label className="mb-3 block">
            <span className="microlabel">Name</span>
            <input value={name} onChange={e => setName(e.target.value)}
              className="mt-1 w-full rounded-[5px] border border-rule bg-paper px-3 py-[6px] text-[13px] outline-none" />
          </label>

          {kind === 'filesystem' && (
            <>
              {text('Directory on this server', 'path', '/srv/docs')}
              {text('Include', 'include', '*.md,*.txt,*.pdf', 'Comma-separated globs, matched on the file name or its relative path.')}
            </>
          )}

          {kind === 'http' && json('URLs', 'urls', 'A JSON array of URLs to fetch each time.')}

          {kind === 'mcp' && (
            <>
              <div className="mb-2">
                <span className="microlabel">Transport</span>
                <div className="mt-1">
                  <Seg value={config.transport ?? 'stdio'} accent={accent}
                    onChange={v => set('transport', v)}
                    options={[{ v: 'stdio', label: 'stdio' }, { v: 'http', label: 'http' }, { v: 'sse', label: 'sse' }]} />
                </div>
              </div>

              {(config.transport ?? 'stdio') === 'stdio' ? (
                <>
                  {text('Command', 'command', 'npx', 'Run as a subprocess of this server, so it has to be installed where this runs.')}
                  {json('Arguments', 'args')}
                  {json('Environment', 'env', 'Credentials the server needs. Stored in the database as written.')}
                </>
              ) : (
                <>
                  {text('URL', 'url', 'http://localhost:8143/mcp')}
                  {json('Headers', 'headers')}
                </>
              )}

              <div className="my-3 flex flex-wrap items-center gap-2">
                <Btn accent={accent} kind="quiet" busy={busy === 'discover'} onClick={discover}>
                  <Glyph name="plug" className="h-[13px] w-[13px]" /> Test connection
                </Btn>
                {tools && <span className="num text-[11.5px] text-ok">{tools.length} tools found</span>}
              </div>

              {tools && (
                <div className="mb-3 grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="microlabel">Tool that lists documents</span>
                    <select value={config.list_tool ?? ''} onChange={e => set('list_tool', e.target.value)}
                      className="num mt-1 w-full cursor-pointer rounded-[5px] border border-rule bg-paper px-2 py-[6px] text-[12px]">
                      <option value="">—</option>
                      {tools.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="microlabel">Tool that reads one</span>
                    <select value={config.read_tool ?? ''} onChange={e => set('read_tool', e.target.value)}
                      className="num mt-1 w-full cursor-pointer rounded-[5px] border border-rule bg-paper px-2 py-[6px] text-[12px]">
                      <option value="">—</option>
                      {tools.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="microlabel">Which argument carries the id</span>
                    <select value={config.read_arg ?? ''} onChange={e => set('read_arg', e.target.value)}
                      className="num mt-1 w-full cursor-pointer rounded-[5px] border border-rule bg-paper px-2 py-[6px] text-[12px]">
                      <option value="">—</option>
                      {(tools.find(t => t.name === config.read_tool)?.args ?? []).map(a =>
                        <option key={a} value={a}>{a}</option>)}
                    </select>
                  </label>
                  {text('Prefix for read (optional)', 'read_prefix', '',
                        'When the listing gives bare names and the read tool wants a full path.')}
                </div>
              )}

              {json('Arguments for the list tool', 'list_args')}
              {text('Include', 'include', '*.md', 'Optional. Filters the listing before anything is fetched.')}
            </>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[13px]">
              <span className="microlabel">Check</span>
              <select value={every} onChange={e => setEvery(Number(e.target.value))}
                className="num cursor-pointer rounded-[5px] border border-rule bg-paper px-2 py-[5px] text-[12px]">
                {SCHEDULES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <Toggle on={prune} accent={accent} onClick={() => setPrune(p => !p)} />
              Delete documents that vanish upstream
            </label>
          </div>

          {err && <div className="mb-3"><Note tone="stop">{err}</Note></div>}

          {preview && (
            <div className="mb-3 rounded-[6px] border border-rule bg-paper px-3 py-2">
              <div className="microlabel mb-1">
                {preview.found} item{preview.found === 1 ? '' : 's'} found
              </div>
              {preview.items.map(i => (
                <div key={i.id} className="border-b border-rule py-[5px] text-[12px] last:border-0">
                  <span className="num" style={{ color: accent }}>{i.title}</span>
                  {i.chars != null && <span className="num text-ink3"> · {i.chars} chars read</span>}
                  {i.error && <div className="text-[11.5px] text-stop">{i.error}</div>}
                  {i.excerpt && <div className="mt-[2px] text-[11.5px] leading-[1.4] text-ink3">{i.excerpt.slice(0, 160)}…</div>}
                </div>
              ))}
              {preview.found === 0 && (
                <p className="m-0 text-[12px] text-ink2">
                  Nothing came back. Check the list tool's arguments and the include filter before
                  saving — a source that lists nothing will sync nothing, quietly.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Btn accent={accent} kind="quiet" busy={busy === 'preview'} onClick={dryRun}>
              Test fetch
            </Btn>
            <Btn accent={accent} busy={busy === 'save'} onClick={save} disabled={!name.trim()}>
              Connect
            </Btn>
            <Btn accent={accent} kind="quiet" onClick={onCancel}>Cancel</Btn>
            <span className="num text-[11px] text-ink3">Test fetch reads one item; it writes nothing.</span>
          </div>
        </>
      )}
    </div>
  )
}
