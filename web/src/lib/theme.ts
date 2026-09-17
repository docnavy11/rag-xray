import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'

const THEME_KEY = 'ragdemo.theme'
const ZOOM_KEY = 'ragdemo.zoom'

/** Interface scale, not font scale. See the note in index.css: the app is drawn
 *  in px, so the whole thing is zoomed rather than the type alone. */
export const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6]

export function getTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function getZoom(): number {
  const v = Number(localStorage.getItem(ZOOM_KEY))
  return ZOOMS.includes(v) ? v : 1
}

export function resolved(theme: Theme = getTheme()): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function apply(theme: Theme, zoom: number): void {
  const root = document.documentElement
  // "system" removes the attribute rather than stamping a value, so the media
  // query in index.css is what decides — and keeps deciding if the OS flips.
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  root.style.setProperty('--ui-zoom', String(zoom))
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme)
  apply(theme, getZoom())
  dispatchEvent(new Event('ragdemo:display'))
}

export function setZoom(zoom: number): void {
  localStorage.setItem(ZOOM_KEY, String(zoom))
  apply(getTheme(), zoom)
  dispatchEvent(new Event('ragdemo:display'))
}

export function stepZoom(direction: 1 | -1): number {
  const i = ZOOMS.indexOf(getZoom())
  const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? 2 : i) + direction))]
  setZoom(next)
  return next
}

/** The current display settings, and the resolved light/dark that components
 *  need in order to pick colours a stylesheet cannot reach — the per-corpus
 *  accents, which arrive from the database as data. */
export function useDisplay() {
  const [state, setState] = useState(() => ({
    theme: getTheme(), zoom: getZoom(), dark: resolved() === 'dark',
  }))

  useEffect(() => {
    const read = () => setState({ theme: getTheme(), zoom: getZoom(), dark: resolved() === 'dark' })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    addEventListener('ragdemo:display', read)
    addEventListener('storage', read)            // another tab changed it
    mq.addEventListener('change', read)
    return () => {
      removeEventListener('ragdemo:display', read)
      removeEventListener('storage', read)
      mq.removeEventListener('change', read)
    }
  }, [])

  return state
}

/** A corpus accent, lightened for a dark background.
 *
 *  These colours live in the database as `oklch(0.42 0.070 195)` — chosen to
 *  carry white text on a white page. On a dark page the same value is a dark
 *  smudge, so the lightness is raised and the text on top flips to
 *  --color-onaccent. Anything that is not oklch is returned untouched rather
 *  than mangled by a guess. */
export function accentFor(accent: string, dark: boolean): string {
  if (!dark) return accent
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(accent.trim())
  if (!m) return accent
  const [, l, c, h] = m
  const light = Math.min(0.88, Math.max(Number(l), 0.74))
  return `oklch(${light} ${Number(c) * 0.9} ${h})`
}
