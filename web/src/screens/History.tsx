import { useEffect, useState } from 'react'
import {
  deleteConversation, getConversations, getTraces,
  type Conversation, type KB, type TraceRow,
} from '../lib/api'
import { chatLink, go } from '../lib/router'
import { accentFor, useDisplay } from '../lib/theme'
import { fmtMs, fmtUsd } from '../lib/text'
import Glyph from '../ui/Glyph'
import { Empty, Seg, Tag } from '../ui/controls'

/** Work you did before, still here. Conversations you can pick back up, and
 *  every answered question with the trace that produced it. */
export default function History({ kbs }: { kbs: KB[] }) {
  const { dark } = useDisplay()
  const [tab, setTab] = useState<'conversations' | 'questions'>('conversations')
  const [kb, setKb] = useState('')
  const [q, setQ] = useState('')
  const [convs, setConvs] = useState<Conversation[] | null>(null)
  const [traces, setTraces] = useState<TraceRow[] | null>(null)

  useEffect(() => { getConversations(kb).then(setConvs).catch(() => setConvs([])) }, [kb])
  useEffect(() => { getTraces(kb, q).then(setTraces).catch(() => setTraces([])) }, [kb, q])

  const shown = (convs ?? []).filter(c => !q || c.title.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="scrollthin grow overflow-y-auto px-6 py-6 lg:px-8">
      <div className="mx-auto max-w-[1100px]">
        <h1 className="m-0 mb-4 text-[22px] font-semibold tracking-[-.022em]">History</h1>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Seg value={tab} accent="var(--color-accent)" size="md" onChange={setTab} options={[
            { v: 'conversations', label: `Conversations${convs ? ` · ${convs.length}` : ''}` },
            { v: 'questions', label: `Questions${traces ? ` · ${traces.length}` : ''}` },
          ]} />
          <select value={kb} onChange={e => setKb(e.target.value)}
            className="num cursor-pointer rounded-[5px] border border-rule bg-surface px-2 py-[5px] text-[12px]">
            <option value="">every corpus</option>
            {kbs.map(k => <option key={k.slug} value={k.slug}>{k.name}</option>)}
          </select>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…"
            className="grow rounded-[5px] border border-rule bg-surface px-3 py-[6px] text-[13px] outline-none sm:grow-0 sm:w-[240px]" />
        </div>

        {tab === 'conversations' && (
          !convs ? <Empty>Loading…</Empty> : shown.length === 0 ? (
            <Empty>No conversations yet — they are saved automatically once you ask something.</Empty>
          ) : (
            <div className="rounded-[7px] border border-rule bg-surface">
              {shown.map(c => (
                <div key={c.id} className="flex items-center gap-3 border-b border-rule px-4 py-[10px] last:border-0">
                  <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: accentFor(c.accent, dark) }} />
                  <button onClick={() => go(chatLink(c.kb, undefined, undefined, c.id))}
                    className="min-w-0 grow cursor-pointer text-left">
                    <div className="truncate text-[13.5px]">{c.title || 'Untitled'}</div>
                    <div className="num text-[10.5px] text-ink3">
                      {c.kb_name} · {c.messages} messages · {c.updated_at.slice(0, 16)}
                    </div>
                  </button>
                  <button onClick={async () => {
                    if (!confirm('Delete this conversation?')) return
                    await deleteConversation(c.id)
                    setConvs(cs => (cs ?? []).filter(x => x.id !== c.id))
                  }} className="shrink-0 cursor-pointer">
                    <Glyph name="trash" className="h-[14px] w-[14px]" stroke="var(--color-ink3)" />
                  </button>
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'questions' && (
          !traces ? <Empty>Loading…</Empty> : traces.length === 0 ? (
            <Empty>Nothing answered yet.</Empty>
          ) : (
            <div className="scrollthin overflow-x-auto rounded-[7px] border border-rule bg-surface">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {['Question', 'Corpus', 'Citations', 'Time', 'Cost', 'When'].map(h => (
                      <th key={h} className="microlabel border-b border-rule px-[13px] py-[8px] text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {traces.map(t => (
                    <tr key={t.id} className="cursor-pointer hover:bg-paper" onClick={() => go(`/x-ray/${t.id}`)}>
                      <td className="border-b border-rule px-[13px] py-[8px]">
                        <div className="max-w-[46ch] truncate">{t.question}</div>
                        <span className="num text-[10.5px] text-ink3">trace {t.id.slice(0, 8)}</span>
                      </td>
                      <td className="border-b border-rule px-[13px] py-[8px]">
                        <span className="num text-[11.5px]" style={{ color: accentFor(t.accent, dark) }}>{t.kb}</span>
                      </td>
                      <td className="border-b border-rule px-[13px] py-[8px]">
                        <Tag tone={t.unverified ? 'stop' : 'ok'}>
                          {t.cited} verified{t.unverified ? ` · ${t.unverified} not` : ''}
                        </Tag>
                      </td>
                      <td className="num border-b border-rule px-[13px] py-[8px] text-ink2">{fmtMs(t.ms)}</td>
                      <td className="num border-b border-rule px-[13px] py-[8px] text-ink2">{fmtUsd(t.cost_usd)}</td>
                      <td className="num border-b border-rule px-[13px] py-[8px] text-ink3">{t.created_at.slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  )
}
