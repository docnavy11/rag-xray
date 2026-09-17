import { useEffect, useState } from 'react'

/** Hash routing, so every screen is a real link: an X-ray permalink, a corpus,
 *  a conversation somebody can send to a colleague. */
export function useHash(): string {
  const [hash, setHash] = useState(() => location.hash.slice(1) || '/')
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/')
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}

export function go(path: string) {
  location.hash = path
}

export type Route =
  | { name: 'dashboard' }
  | { name: 'corpora' }
  | { name: 'corpus'; slug: string; tab: string }
  | { name: 'chat'; slug: string; q: string | null; cfg: string | null; conv: string | null }
  | { name: 'retrieval'; slug: string }
  | { name: 'xray'; id: string; stage: number | null }
  | { name: 'compare' }
  | { name: 'evaluate' }
  | { name: 'findings' }
  | { name: 'history' }
  | { name: 'settings' }
  | { name: 'api' }

export function parse(raw: string): Route {
  const [hash, qs] = raw.split('?')
  const p = new URLSearchParams(qs ?? '')
  let m
  if ((m = hash.match(/^\/kb\/([\w-]+)\/retrieval$/))) return { name: 'retrieval', slug: m[1] }
  if ((m = hash.match(/^\/kb\/([\w-]+)$/)))
    return { name: 'chat', slug: m[1], q: p.get('q'), cfg: p.get('cfg'), conv: p.get('c') }
  if ((m = hash.match(/^\/corpus\/([\w-]+)$/)))
    return { name: 'corpus', slug: m[1], tab: p.get('tab') || 'documents' }
  if ((m = hash.match(/^\/x-ray\/([a-f0-9]+)(?:\/(\d+))?$/)))
    return { name: 'xray', id: m[1], stage: m[2] != null ? Number(m[2]) : null }
  if (hash === '/corpora') return { name: 'corpora' }
  if (hash === '/compare') return { name: 'compare' }
  if (hash === '/evaluate') return { name: 'evaluate' }
  if (hash === '/findings') return { name: 'findings' }
  if (hash === '/history') return { name: 'history' }
  if (hash === '/settings') return { name: 'settings' }
  if (hash === '/api') return { name: 'api' }
  return { name: 'dashboard' }
}

/** A chat link that carries the question, the settings it was asked under, or
 *  the conversation to resume — so a modified run is shareable too. */
export function chatLink(slug: string, q?: string, changes?: object, conv?: string): string {
  const p = new URLSearchParams()
  if (q) p.set('q', q)
  if (changes && Object.keys(changes).length) p.set('cfg', JSON.stringify(changes))
  if (conv) p.set('c', conv)
  const qs = p.toString()
  return `/kb/${slug}${qs ? `?${qs}` : ''}`
}
