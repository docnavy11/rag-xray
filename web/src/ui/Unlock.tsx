import { useEffect, useState } from 'react'
import { getAdminKey, setAdminKey } from '../lib/api'
import { Btn, Note } from './controls'
import Glyph from './Glyph'

/** Shown when the server refuses an administration request for want of a key.
 *
 *  Not a login: there are no accounts here. It is the API key the server was
 *  started with, kept in this browser so the admin screens work from somewhere
 *  other than the machine it runs on. */
export default function Unlock() {
  const [reason, setReason] = useState<string | null>(null)
  const [key, setKey] = useState(getAdminKey())

  useEffect(() => {
    const on = (e: Event) => setReason(String((e as CustomEvent).detail ?? 'Authentication required.'))
    addEventListener('ragdemo:locked', on)
    return () => removeEventListener('ragdemo:locked', on)
  }, [])

  if (!reason) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-6">
      <div className="w-full max-w-[520px] rounded-[8px] border border-rule bg-surface px-6 py-5">
        <div className="mb-3 flex items-center gap-[9px]">
          <Glyph name="key" className="h-[17px] w-[17px]" stroke="var(--color-accent)" />
          <h2 className="m-0 text-[17px] font-semibold tracking-[-.018em]">This needs the API key</h2>
        </div>

        <p className="mt-0 mb-3 text-[13.5px] leading-[1.55] text-ink2">{reason}</p>

        <input autoFocus type="password" value={key} onChange={e => setKey(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && key.trim()) { setAdminKey(key.trim()); location.reload() } }}
          placeholder="X-API-Key"
          className="num mb-3 w-full rounded-[6px] border border-rule bg-paper px-3 py-[8px] text-[13px] outline-none" />

        <div className="flex flex-wrap items-center gap-2">
          <Btn accent="var(--color-accent)" disabled={!key.trim()}
            onClick={() => { setAdminKey(key.trim()); location.reload() }}>
            Unlock
          </Btn>
          <Btn accent="var(--color-accent)" kind="quiet" onClick={() => setReason(null)}>
            Not now
          </Btn>
          {getAdminKey() && (
            <Btn accent="var(--color-accent)" kind="quiet"
              onClick={() => { setAdminKey(''); setKey(''); location.reload() }}>
              Forget the key
            </Btn>
          )}
        </div>

        <div className="mt-4">
          <Note>
            Reading is unaffected — asking questions, searching and opening traces need no key.
            This is only for the parts that change something: corpora, documents, sources and
            settings. From the machine the server runs on, none of it is needed.
          </Note>
        </div>
      </div>
    </div>
  )
}
