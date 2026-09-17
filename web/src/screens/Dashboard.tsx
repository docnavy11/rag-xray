import { useEffect, useState } from 'react'
import { getDashboard, type Dashboard as Dash, type Job } from '../lib/api'
import { go } from '../lib/router'
import { accentFor, useDisplay } from '../lib/theme'
import { fmtInt, fmtMs, fmtUsd } from '../lib/text'
import Glyph from '../ui/Glyph'
import { Empty, Note, Tag } from '../ui/controls'

/** The front page of a tool is what it holds and what it has been doing —
 *  not a pitch for itself. */
export default function Dashboard() {
  const { dark } = useDisplay()
  const [d, setD] = useState<Dash | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const load = () => getDashboard().then(x => live && setD(x)).catch(e => live && setErr(String(e.message ?? e)))
    load()
    // Only poll while something is actually running.
    const t = setInterval(() => { if (d?.jobs.some(j => j.status === 'running' || j.status === 'queued')) load() }, 2000)
    return () => { live = false; clearInterval(t) }
  }, [d?.jobs.map(j => j.status).join(',')])

  if (err) return <Note tone="stop">{err}</Note>
  if (!d) return <Empty>Loading…</Empty>

  const chunks = d.kbs.reduce((a, k) => a + k.chunks, 0)
  const docs = d.kbs.reduce((a, k) => a + k.documents, 0)
  const failed = d.kbs.reduce((a, k) => a + k.failed, 0)
  const spentPct = d.budget_usd > 0 ? Math.min(1, d.spend.day / d.budget_usd) : 0

  return (
    <div className="scrollthin grow overflow-y-auto px-6 py-6 lg:px-8">
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-[22px] font-semibold tracking-[-.022em]">Dashboard</h1>
            <p className="m-0 mt-1 text-[13.5px] text-ink2">
              {d.kbs.length} corpora · {fmtInt(chunks)} retrievable passages · answering on{' '}
              <span className="num">{d.model}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Quick glyph="plus" label="New corpus" onClick={() => go('/corpora')} primary />
            <Quick glyph="upload" label="Add documents"
              onClick={() => go(`/corpus/${d.kbs[0]?.slug ?? ''}?tab=documents`)} />
            <Quick glyph="chat" label="Ask something" onClick={() => go(`/kb/${d.kbs[0]?.slug ?? ''}`)} />
          </div>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Documents" value={fmtInt(docs)}
            sub={failed ? `${failed} failed to index` : 'in the vault'} bad={!!failed} />
          <Metric label="Passages" value={fmtInt(chunks)} sub="after chunking" />
          <Metric label="Questions today" value={fmtInt(d.spend.asked_day)}
            sub={`${fmtInt(d.counts.traces)} traces kept`} />
          <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
            <div className="microlabel mb-1">Spend today</div>
            <div className="flex items-baseline gap-2">
              <span className="num text-[24px] leading-none">{fmtUsd(d.spend.day)}</span>
              <span className="num text-[12px] text-ink3">of {fmtUsd(d.budget_usd)}</span>
            </div>
            <div className="mt-2 h-[6px] overflow-hidden rounded-[3px] bg-surface2">
              <div className="h-full rounded-[3px]"
                style={{ width: `${spentPct * 100}%`, background: spentPct > 0.85 ? 'var(--color-stop)' : 'var(--color-accent)' }} />
            </div>
            <div className="num mt-1 text-[10.5px] text-ink3">
              {fmtUsd(d.spend.week)} this week · retrieval is free and uncapped
            </div>
          </div>
        </div>

        {d.jobs.filter(j => j.status === 'running' || j.status === 'queued').map(j => (
          <div key={j.id} className="mb-3"><JobBar job={j} /></div>
        ))}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <div className="microlabel">Corpora</div>
              <div className="h-px grow bg-rule" />
              <button onClick={() => go('/corpora')} className="num cursor-pointer text-[11px] text-accent">manage →</button>
            </div>
            <div className="scrollthin overflow-x-auto rounded-[7px] border border-rule bg-surface">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {['Corpus', 'Docs', 'Passages', 'Stopwords', ''].map(h => (
                      <th key={h} className="microlabel border-b border-rule px-[13px] py-[8px] text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.kbs.map(k => (
                    <tr key={k.slug}>
                      <td className="border-b border-rule px-[13px] py-[8px]">
                        <button onClick={() => go(`/corpus/${k.slug}`)}
                          className="flex cursor-pointer items-center gap-2 text-left">
                          <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: accentFor(k.accent, dark) }} />
                          <span className="font-medium">{k.name}</span>
                        </button>
                        <span className="num ml-[16px] text-[10.5px] text-ink3">
                          {k.chunker.replace(/_/g, ' ')} · {k.langs.join(' ')}
                        </span>
                      </td>
                      <td className="num border-b border-rule px-[13px] py-[8px] text-ink2">
                        {k.documents ? fmtInt(k.documents) : <span className="text-ink3">—</span>}
                        {k.failed > 0 && <span className="ml-1 text-stop">{k.failed}✗</span>}
                      </td>
                      <td className="num border-b border-rule px-[13px] py-[8px] text-ink2">{fmtInt(k.chunks)}</td>
                      <td className="num border-b border-rule px-[13px] py-[8px] text-ink3">{k.stopwords}</td>
                      <td className="border-b border-rule px-[13px] py-[8px] text-right">
                        <button onClick={() => go(`/kb/${k.slug}`)}
                          className="num cursor-pointer text-[11px]"
                          style={{ color: accentFor(k.accent, dark) }}>ask →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {docs === 0 && (
              <div className="mt-3">
                <Note>
                  <div className="microlabel mb-1 !text-accent">Nothing of yours in here yet</div>
                  The four corpora above were built by <span className="num">./ingest.sh</span> from
                  their own sources. To put your own documents in, make a corpus and upload them —
                  they are chunked, indexed and searchable without touching the command line.
                </Note>
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <div className="microlabel">Recent questions</div>
              <div className="h-px grow bg-rule" />
              <button onClick={() => go('/history')} className="num cursor-pointer text-[11px] text-accent">all →</button>
            </div>
            <div className="rounded-[7px] border border-rule bg-surface">
              {d.recent_traces.length === 0 && (
                <div className="px-4 py-6 text-center text-[13px] text-ink3">Nothing asked yet.</div>
              )}
              {d.recent_traces.map(t => (
                <button key={t.id} onClick={() => go(`/x-ray/${t.id}`)}
                  className="flex w-full cursor-pointer flex-col gap-1 border-b border-rule px-4 py-[9px] text-left last:border-0 hover:bg-paper">
                  <div className="flex items-start gap-2">
                    <span className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: accentFor(t.accent, dark) }} />
                    <span className="line-clamp-2 text-[13px] leading-[1.4]">{t.question}</span>
                  </div>
                  <div className="num flex flex-wrap items-center gap-x-3 pl-[15px] text-[10.5px] text-ink3">
                    <span>{t.kb}</span>
                    <span>{t.cited} cited</span>
                    {t.unverified > 0 && <span className="text-stop">{t.unverified} unverified</span>}
                    <span>{fmtMs(t.ms)}</span>
                    <span>{fmtUsd(t.cost_usd)}</span>
                    <span className="ml-auto">{t.created_at.slice(5, 16)}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-[7px] border border-rule bg-surface px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="microlabel">Scheduled sources</div>
                <div className="grow" />
                <span className="num text-[10.5px]"
                  style={{ color: d.scheduler?.running ? 'var(--color-ok)' : 'var(--color-stop)' }}>
                  scheduler {d.scheduler?.running ? 'running' : 'stopped'}
                </span>
              </div>
              {d.sources.length === 0 ? (
                <p className="m-0 text-[12px] leading-[1.5] text-ink3">
                  Nothing syncing. A corpus can pull from a folder, a list of URLs or an MCP
                  server on a schedule — set one up under a corpus's Sources tab.
                </p>
              ) : d.sources.map(s => (
                <button key={s.id} onClick={() => go(`/corpus/${s.kb}?tab=sources`)}
                  className="flex w-full cursor-pointer items-center gap-2 border-b border-rule py-[6px] text-left last:border-0">
                  <span className="h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: !s.enabled ? 'var(--color-rule2)'
                      : s.last_status === 'failed' ? 'var(--color-stop)'
                      : s.last_status === 'running' ? 'var(--color-warn)' : 'var(--color-ok)' }} />
                  <span className="min-w-0 grow truncate text-[12.5px]">{s.name}</span>
                  <span className="num shrink-0 text-[10.5px] text-ink3">
                    {!s.enabled ? 'paused'
                      : s.every_minutes > 0 ? `every ${s.every_minutes >= 1440
                          ? `${Math.round(s.every_minutes / 1440)}d`
                          : s.every_minutes >= 60 ? `${Math.round(s.every_minutes / 60)}h`
                          : `${s.every_minutes}m`}`
                      : 'manual'}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-[7px] border border-rule bg-surface px-4 py-3">
              <div className="microlabel mb-2">System</div>
              <Row label="Answer model" value={d.model} />
              <Row label="Embeddings" value={d.embeddings ? 'on' : 'off — vector runs do nothing'} bad={!d.embeddings} />
              <Row label="API key" value={d.api_key_set ? 'set' : 'not set — /v1/ask is open'} bad={!d.api_key_set} />
              <Row label="Conversations" value={fmtInt(d.counts.conversations)} />
              <button onClick={() => go('/settings')} className="num mt-2 cursor-pointer text-[11px] text-accent">
                change in settings →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
  return (
    <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
      <div className="microlabel mb-1">{label}</div>
      <div className="num text-[24px] leading-none">{value}</div>
      <div className="num mt-1 text-[10.5px]" style={{ color: bad ? 'var(--color-stop)' : 'var(--color-ink3)' }}>{sub}</div>
    </div>
  )
}

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-[5px] text-[12.5px] last:border-0">
      <span className="text-ink2">{label}</span>
      <span className="num text-right" style={{ color: bad ? 'var(--color-warn)' : 'var(--color-ink)' }}>{value}</span>
    </div>
  )
}

function Quick({ glyph, label, onClick, primary }:
  { glyph: string; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-2 rounded-[5px] border px-[12px] py-[7px] text-[12.5px]"
      style={primary
        ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: 'var(--color-onaccent)' }
        : { background: 'var(--color-surface)', borderColor: 'var(--color-rule)', color: 'var(--color-ink2)' }}>
      <Glyph name={glyph} className="h-[14px] w-[14px]" stroke={primary ? 'var(--color-onaccent)' : 'currentColor'} />
      {label}
    </button>
  )
}

export function JobBar({ job }: { job: Job }) {
  const pct = job.total ? Math.round((job.done / job.total) * 100) : job.status === 'done' ? 100 : 0
  const tone = job.status === 'failed' ? 'stop' : job.status === 'done' ? 'ok' : 'accent'
  return (
    <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Tag tone={tone as any}>{job.status}</Tag>
        <span className="text-[13px]">{job.kind === 'reindex' ? 'Re-cutting' : 'Indexing'} · {job.kb}</span>
        <span className="num text-[11.5px] text-ink3">{job.message}</span>
        <div className="grow" />
        <span className="num text-[11.5px] text-ink3">{job.done}/{job.total || '?'}</span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-[3px] bg-surface2">
        <div className="h-full rounded-[3px] transition-all"
          style={{ width: `${pct}%`, background: job.status === 'failed' ? 'var(--color-stop)' : 'var(--color-accent)' }} />
      </div>
      {job.error && <p className="num mt-2 mb-0 text-[11.5px] text-stop">{job.error}</p>}
    </div>
  )
}
