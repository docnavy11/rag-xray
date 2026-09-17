import { useEffect, useState } from 'react'
import { getSettings, putSetting, resetSetting, type Setting } from '../lib/api'
import { go } from '../lib/router'
import Glyph from '../ui/Glyph'
import { Btn, Empty, Note, Tag, Toggle } from '../ui/controls'

/** What an operator can change while it runs.
 *
 *  Env vars stay the defaults; a change here overrides one and says so, and
 *  "use the default again" is always one click away. */
export default function SettingsScreen() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getSettings>> | null>(null)
  const [draft, setDraft] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { getSettings().then(setData).catch(e => setErr(String(e.message ?? e))) }, [])

  async function save(key: string, value: any) {
    setSaving(key); setErr(null)
    try {
      const out = await putSetting(key, value)
      setData(d => d && { ...d, settings: out.settings })
      setDraft(x => { const y = { ...x }; delete y[key]; return y })
    } catch (e) { setErr(String((e as Error).message ?? e)) }
    setSaving(null)
  }

  async function reset(key: string) {
    setSaving(key)
    try {
      const out = await resetSetting(key)
      setData(d => d && { ...d, settings: out.settings })
      setDraft(x => { const y = { ...x }; delete y[key]; return y })
    } catch (e) { setErr(String((e as Error).message ?? e)) }
    setSaving(null)
  }

  if (err && !data) return <div className="p-6"><Note tone="stop">{err}</Note></div>
  if (!data) return <Empty>Loading settings…</Empty>

  const groups = [...new Set(data.settings.map(s => s.group))]

  return (
    <div className="scrollthin grow overflow-y-auto px-6 py-6 lg:px-8">
      <div className="mx-auto max-w-[900px]">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-.022em]">Settings</h1>
        <p className="mt-1 mb-5 max-w-[80ch] text-[13.5px] text-ink2">
          These take effect immediately, for every caller — the browser, the API and the MCP
          server alike. Environment variables remain the defaults; anything changed here overrides
          one until you put it back.
        </p>

        {err && <div className="mb-4"><Note tone="stop">{err}</Note></div>}

        {groups.map(g => (
          <div key={g} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <div className="microlabel">{g}</div><div className="h-px grow bg-rule" />
            </div>
            <div className="rounded-[7px] border border-rule bg-surface">
              {data.settings.filter(s => s.group === g).map(s => (
                <Field key={s.key} s={s} draft={draft} setDraft={setDraft}
                  saving={saving === s.key} onSave={save} onReset={reset} />
              ))}
            </div>
          </div>
        ))}

        <div className="mb-2 flex items-center gap-2">
          <div className="microlabel">Where it runs</div><div className="h-px grow bg-rule" />
        </div>
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
          <Line label="Database" value={data.database} />
          <Line label="MCP server" value={`${data.mcp.host}:${data.mcp.port}`} />
          <Line label="Chunkers available" value={Object.keys(data.chunkers).join(' · ')} />
          <button onClick={() => go('/api')} className="num mt-2 cursor-pointer text-[11.5px] text-accent">
            MCP client config →
          </button>
        </div>

        <div className="mt-5">
          <Note tone="warn">
            <div className="microlabel mb-1 !text-warn">Two of these have teeth</div>
            An empty <span className="num">API key</span> means <span className="num">POST /v1/ask</span>{' '}
            and the MCP server answer anyone who can reach them. Setting{' '}
            <span className="num">questions per hour</span> to 0 switches answering off entirely —
            retrieval, counterfactuals and evaluation keep working, because none of them reach a
            model.
          </Note>
        </div>
      </div>
    </div>
  )
}

function Field({ s, draft, setDraft, saving, onSave, onReset }: {
  s: Setting; draft: Record<string, any>; setDraft: (f: (d: Record<string, any>) => Record<string, any>) => void
  saving: boolean; onSave: (k: string, v: any) => void; onReset: (k: string) => void
}) {
  const dirty = s.key in draft
  const value = dirty ? draft[s.key] : s.value
  const set = (v: any) => setDraft(d => ({ ...d, [s.key]: v }))

  return (
    <div className="border-b border-rule px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 grow">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-medium">{s.label}</span>
            <span className="num text-[10.5px] text-ink3">{s.key}</span>
            {s.source !== 'environment default' && <Tag tone="accent">changed here</Tag>}
          </div>
          {s.help && <p className="m-0 mt-1 max-w-[70ch] text-[11.5px] leading-[1.45] text-ink3">{s.help}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {s.type === 'bool' ? (
            <Toggle on={!!value} accent="var(--color-accent)"
              onClick={() => onSave(s.key, !value)} disabled={saving} />
          ) : (
            <input
              type={s.type === 'str' ? (s.secret ? 'password' : 'text') : 'number'}
              value={s.secret && !dirty ? '' : String(value ?? '')}
              placeholder={s.secret ? (s.set ? '•••••• set' : 'not set') : ''}
              min={s.min ?? undefined} max={s.max ?? undefined}
              step={s.type === 'float' ? 0.5 : 1}
              onChange={e => set(s.type === 'str' ? e.target.value : Number(e.target.value))}
              className="num w-[170px] rounded-[5px] border border-rule bg-paper px-3 py-[6px] text-[12.5px] outline-none" />
          )}
          {dirty && (
            <Btn accent="var(--color-accent)" busy={saving} onClick={() => onSave(s.key, value)}>Save</Btn>
          )}
          {s.source !== 'environment default' && !dirty && (
            <button onClick={() => onReset(s.key)} title="Use the environment default again"
              className="cursor-pointer"><Glyph name="refresh" className="h-[14px] w-[14px]" stroke="var(--color-ink3)" /></button>
          )}
        </div>
      </div>
      {s.default != null && s.source !== 'environment default' && (
        <div className="num mt-1 text-[10.5px] text-ink3">environment default: {String(s.default)}</div>
      )}
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-[5px] text-[12.5px] last:border-0">
      <span className="text-ink2">{label}</span>
      <span className="num truncate text-right">{value}</span>
    </div>
  )
}
