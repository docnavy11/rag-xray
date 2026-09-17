export const fmtMs = (ms: number | null | undefined) =>
  ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`

export const fmtInt = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString()

export const fmtUsd = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toFixed(4)}`

export const pct = (n: number) => `${(n * 100).toFixed(1)}%`

/** Locate a quoted span inside a raw passage, and return offsets into the RAW
 *  text so the span can be highlighted where the reader is actually looking.
 *
 *  The API's own offsets cannot be used for this: engine/cite.py computes them
 *  against its normalised haystack (NFKD, folded punctuation, collapsed
 *  whitespace, lower-cased), and those positions do not line up with the
 *  original characters. So the same normalisation is redone here while keeping
 *  a map back to the source index of every normalised character.
 *
 *  Returns null when the quote is not found, and the caller then highlights
 *  nothing rather than guessing — an approximate highlight on a screen about
 *  verification would be the wrong kind of lie. */
export function locateSpan(raw: string, quote: string): [number, number] | null {
  const { norm, map } = normalise(raw)
  const needle = normalise(quote).norm
  if (needle.length < 4) return null

  let from = norm.indexOf(needle)
  let to = from >= 0 ? from + needle.length : -1

  if (from < 0) {
    // A quote may elide its middle: «up to EUR 15 000 000 ... 3 % of turnover».
    // Same rule cite.py applies: every fragment must occur, in order.
    const parts = needle.split(/\s*(?:\.\.\.|…)\s*/).filter(p => p.length >= 6)
    if (parts.length < 2) return null
    let cursor = 0
    for (const part of parts) {
      const i = norm.indexOf(part, cursor)
      if (i < 0) return null
      if (from < 0) from = i
      cursor = i + part.length
    }
    to = cursor
  }
  if (from < 0 || to <= from) return null
  const start = map[from]
  const end = to - 1 < map.length ? map[to - 1] + 1 : raw.length
  return [start, end]
}

function normalise(s: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let lastWasSpace = true
  for (let i = 0; i < s.length; i++) {
    let c = s[i]
    if (/\s/.test(c)) {
      if (lastWasSpace) continue
      norm += ' '; map.push(i); lastWasSpace = true
      continue
    }
    lastWasSpace = false
    if (c === '’' || c === '‘') c = "'"
    else if (c === '“' || c === '”' || c === '„') c = '"'
    else if (c === '—' || c === '–') c = '-'
    // NFKD, then drop the combining marks, exactly as the server's _norm does.
    const folded = c.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    for (const ch of folded) { norm += ch; map.push(i) }
  }
  // A trailing space would map past the end of a quote; trim it symmetrically.
  while (norm.endsWith(' ')) { norm = norm.slice(0, -1); map.pop() }
  return { norm, map }
}

/** Today, as the yyyy-mm-dd an <input type=date> wants. */
export const today = () => new Date().toISOString().slice(0, 10)
