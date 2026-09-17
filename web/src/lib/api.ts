/** Every endpoint the API exposes, in one place and typed.
 *
 *  The rule the whole UI depends on: anything that reaches a model is marked
 *  `costs`, and everything else is free and unlimited. /v1/search,
 *  /v1/counterfactual, /v1/compare and /v1/eval never call the answer model —
 *  only the query expansion, and only when it is not already cached. */

export type Figure = { label: string; value: number; unit: string; bad?: boolean; good?: boolean }

export type Lesson = {
  title: string; plain: string; practical: string; technical: string
  source: string; n: number | null; measured: string | null; holdout: boolean | null
  figures: Figure[]; prior?: string
}

export type Stage = {
  name: string; label: string; ms: number | null; summary: string
  detail: any; lesson: Lesson | null; lesson_key: string | null
}

export type Trace = {
  id: string; kb: string; question: string; lang: string; config: RetrievalConfig
  stages: Stage[]; ms: number; cost_usd: number | null
  input_tokens: number; output_tokens: number
}

/** The teaching surface. Every field here is one control in <Knobs>. */
export type RetrievalConfig = {
  mode: 'lexical' | 'vector' | 'hybrid'
  expand: boolean
  corpus_stopwords: { enabled: boolean; df_threshold: number }
  length_norm: number
  fusion: 'rrf' | 'concat'
  rrf_k: number
  kind_weights: Record<string, number>
  structural_expansion: boolean
  named_paths: boolean
  context_run: boolean
  as_of_filter: boolean
  verify_quotes: boolean
  top_k: number
}

export type KB = {
  id: number; slug: string; name: string; tagline: string; accent: string; glyph: string
  langs: string[]; default_lang: string; chunker: string; retrieval_config: RetrievalConfig
  tools: string[]; sample_questions: string[]; teaches: string
  cite_strength: 'exact' | 'positional'
  chunks: number; lang_count: number; stopwords: number
}

export type Citation = {
  path: string; cited_text: string | null; field: 'body' | 'heading' | null
  start: number | null; end: number | null; elided?: boolean
  url: string; lang: string; celex: string; valid_from: string
}

export type Passage = {
  path: string; kind: string; heading: string | null
  url: string | null; valid_from?: string | null
}

export type Final = {
  type: 'final'; trace_id: string; answer: string | null; refusal: string | null
  cited: Citation[]; unverified_quotes: string[]; searches: number
  passages: Passage[]
  cost_usd: number | null; ms: number; model: string
  input_tokens: number; output_tokens: number
}

export type Chunk = {
  path: string; kind: string; heading: string | null; body: string; lang: string
  source_id: string; valid_from: string; valid_to: string | null
  url: string | null; meta: any; score: number | null
}

export type Hit = Chunk

export type SearchResult = { hits: Hit[]; count: number; trace: Trace }

export type DiffRow = {
  path: string; kind: string; heading: string
  was: number | null; now: number | null; change: number | 'entered' | 'dropped'
}

export type Counterfactual = {
  changes: Partial<RetrievalConfig>
  baseline: { config: RetrievalConfig; order: string[]; trace: Trace }
  alternative: { config: RetrievalConfig; order: string[]; trace: Trace }
  diff: DiffRow[]
  summary: { entered: number; dropped: number; moved: number; held: number }
  expansion: string; free: boolean; ms: number
}

export type EvalResult = {
  k: number; n: number; hits: number; recall: number; in_sample: boolean
  kb: string; config: RetrievalConfig
  results: { q: string; lang: string; want: string[]; got: string[]; hit: boolean }[]
}

export type CompareSide = {
  kb: {
    slug: string; name: string; accent: string; glyph: string; chunker: string
    teaches: string; cite_strength: string
  }
  corpus: { chunks: number; avg_chars: number; with_heading: number }
  hits: {
    path: string; heading: string | null; kind: string; chars: number
    preview: string; opens_mid_sentence: boolean; url: string | null
  }[]
  mid_sentence: number; citable: number; trace: Trace
}

export type Stats = {
  kbs: { slug: string; name: string; chunks: number; langs: number; chars: number }[]
  traces: number; model: string
}

/** The admin key, when this instance is being administered from somewhere other
 *  than the machine it runs on.
 *
 *  Nothing needs it locally: the server trusts localhost. Reached over a network
 *  it is required for anything that changes state, so it is kept here, sent on
 *  every request, and asked for once when the server says it is missing. */
const KEY = 'ragdemo.adminkey'

export const getAdminKey = () => localStorage.getItem(KEY) ?? ''
export const setAdminKey = (k: string) => {
  if (k) localStorage.setItem(KEY, k)
  else localStorage.removeItem(KEY)
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const key = getAdminKey()
  return { ...(extra ?? {}), ...(key ? { 'x-api-key': key } : {}) }
}

/** A 401 or 403 from the admin surface is not an error to print in a corner -
 *  it means the screen cannot work until a key is supplied, so it is announced
 *  once and the app puts up the dialog. */
function locked(status: number, detail: string): boolean {
  if (status !== 401 && status !== 403) return false
  dispatchEvent(new CustomEvent('ragdemo:locked', { detail }))
  return true
}

const J = { 'content-type': 'application/json' }

async function fail(r: Response): Promise<never> {
  const detail = (await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`
  locked(r.status, String(detail))
  throw new Error(String(detail))
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: headers() })
  if (!r.ok) return fail(r)
  return r.json()
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: headers(J), body: JSON.stringify(body) })
  if (!r.ok) return fail(r)
  return r.json()
}

export const getKBs = () => get<{ kbs: KB[] }>('/v1/kbs').then(d => d.kbs)
export const getLessons = () =>
  get<{ lessons: Record<string, Lesson> }>('/v1/lessons').then(d => d.lessons)
export const getStats = () => get<Stats>('/v1/stats')
export const getTrace = (id: string) =>
  get<Trace & { kb_slug: string; kb_name: string; accent: string; answer: Final; created_at: string }>(
    `/v1/trace/${id}`)
export const getChunk = (kb: string, path: string, lang?: string) =>
  get<Chunk>(`/v1/chunk/${kb}/${encodeURIComponent(path)}${lang ? `?lang=${lang}` : ''}`)
    .catch(() => null)

export type SearchBody = {
  kb: string; q: string; lang?: string; as_of?: string | null
  config_overrides?: Partial<RetrievalConfig>
}
export const search = (b: SearchBody) => post<SearchResult>('/v1/search', b)

export type CounterfactualBody = {
  kb: string; q: string; lang?: string; as_of?: string | null
  changes: Partial<RetrievalConfig>
  baseline_overrides?: Partial<RetrievalConfig>
}
export const counterfactual = (b: CounterfactualBody) =>
  post<Counterfactual>('/v1/counterfactual', b)

export const compare = (b: { q: string; kbs: string[]; lang?: string }) =>
  post<{ q: string; sides: CompareSide[]; cost_usd: number }>('/v1/compare', b)

export const runEval = (b: {
  kb: string; k?: number; langs?: string[] | null
  config_overrides?: Partial<RetrievalConfig>
}) => post<EvalResult>('/v1/eval', b)

export type AskBody = {
  kb: string; question: string; lang?: string; as_of?: string | null
  history?: { role: string; content: string }[]
  config_overrides?: Partial<RetrievalConfig>
}

/** Read the answer stream. Every stage event arrives as it completes, which is
 *  what lets the ribbon fill in live instead of appearing all at once. */
export async function ask(
  body: AskBody,
  on: (ev: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch('/v1/ask/stream', {
      method: 'POST', headers: headers(J), body: JSON.stringify(body), signal,
    })
  } catch (e) {
    if ((e as Error).name !== 'AbortError') on({ type: 'error', message: String(e) })
    return
  }
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).detail ?? msg } catch { /* keep the status */ }
    on({ type: 'error', message: msg })
    return
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    let chunk
    try { chunk = await reader.read() } catch { return }
    if (chunk.done) break
    buf += dec.decode(chunk.value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.split('\n').find(l => l.startsWith('data: '))
      if (!line) continue
      try { on(JSON.parse(line.slice(6))) } catch { /* a partial frame */ }
    }
  }
}

// ---------------------------------------------------------------- the app --
// Everything below is what makes this a tool rather than a showcase: corpora
// you own, documents you put in them, jobs, settings, history.

export type DashKB = {
  id: number; slug: string; name: string; accent: string; glyph: string
  chunker: string; langs: string[]; chunks: number; chars: number
  documents: number; failed: number; stopwords: number
}

export type Job = {
  id: string; kb: string | null; kind: string
  status: 'queued' | 'running' | 'done' | 'failed'
  total: number; done: number; message: string; error: string | null
  detail: { chunks?: number; failed?: number; stopwords?: Record<string, number> }
  started_at: string; finished_at: string
}

export type TraceRow = {
  id: string; question: string; lang: string; cost_usd: number | null
  created_at: string; kb: string; kb_name: string; accent: string
  stages: number; cited: number; unverified: number; ms: number
}

export type DashSource = {
  id: number; name: string; kind: string; every_minutes: number; enabled: boolean
  last_status: string; last_run_at: string; next_run_at: string; last_error: string | null
  kb: string
}

export type Dashboard = {
  kbs: DashKB[]
  sources: DashSource[]
  scheduler: { running: boolean; tick_seconds: number; in_flight: number[] }
  spend: { day: number; week: number; all_time: number; asked_day: number; asked_all: number }
  budget_usd: number
  recent_traces: TraceRow[]
  jobs: Job[]
  counts: { conversations: number; traces: number }
  model: string
  embeddings: boolean
  api_key_set: boolean
}

export type DocRow = {
  id: number; source_id: string; title: string; lang: string; media_type: string
  bytes: number; chunks: number; status: 'pending' | 'ready' | 'failed'
  error: string | null; url: string; created_at: string; ingested_at: string
}

export type KBFull = {
  kb: KB & { persona_prompt: string; teaches: string; sort_order: number }
  builtin: boolean
  stats: { chunks: number; avg_chars: number; langs: number; with_heading: number; chars: number }
  kinds: { kind: string; n: number }[]
  stopwords: { lang: string; lexeme: string; df: number }[]
  documents: number
  chunkers: Record<string, string>
}

export type Setting = {
  key: string; value: any; set: boolean | null; secret: boolean; type: string
  group: string; label: string; help: string
  min: number | null; max: number | null; source: string; default: any
}

export type McpConfig = {
  tools: { name: string; what: string; writes: boolean }[]
  kbs: { slug: string; name: string; tools: string[] }[]
  stdio: object; http: object
  host: string; port: number; key_required: boolean
}

export type Conversation = {
  id: string; title: string; pinned: boolean; created_at: string; updated_at: string
  kb: string; kb_name: string; accent: string; glyph: string; messages: number
}

const del = async <T>(url: string): Promise<T> => {
  const r = await fetch(url, { method: 'DELETE', headers: headers() })
  if (!r.ok) return fail(r)
  return r.json()
}

const put = async <T>(url: string, body: unknown): Promise<T> => {
  const r = await fetch(url, { method: 'PUT', headers: headers(J), body: JSON.stringify(body) })
  if (!r.ok) return fail(r)
  return r.json()
}

const patch = async <T>(url: string, body?: unknown): Promise<T> => {
  const r = await fetch(url, {
    method: 'PATCH', headers: headers(J), body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) return fail(r)
  return r.json()
}

export const getDashboard = () => get<Dashboard>('/v1/dashboard')
export const getKBFull = (slug: string) => get<KBFull>(`/v1/kbs/${slug}/full`)
export const createKB = (body: object) => post<KB>('/v1/kbs', body)
export const patchKB = (slug: string, body: object) => patch<KB>(`/v1/kbs/${slug}`, body)
export const deleteKB = (slug: string) =>
  del<{ deleted: string; chunks_removed: number; note: string | null }>(
    `/v1/kbs/${slug}?confirm=${encodeURIComponent(slug)}`)

export const getDocuments = (slug: string, q = '') =>
  get<{ documents: DocRow[] }>(`/v1/kbs/${slug}/documents${q ? `?q=${encodeURIComponent(q)}` : ''}`)
    .then(d => d.documents)
export const readDocument = (slug: string, sourceId: string) =>
  get<{ document: DocRow & { body: string }; chunks: { path: string; kind: string; heading: string; chars: number }[] }>(
    `/v1/kbs/${slug}/documents/${encodeURIComponent(sourceId)}`)
export const deleteDocument = (slug: string, sourceId: string) =>
  del<{ deleted: string; chunks_removed: number }>(
    `/v1/kbs/${slug}/documents/${encodeURIComponent(sourceId)}`)
export const addTextDocument = (slug: string, body: object) =>
  post<{ source_id: string; job: string }>(`/v1/kbs/${slug}/documents/text`, body)
export const reindex = (slug: string) =>
  post<{ job: string; documents: number }>(`/v1/kbs/${slug}/reindex`, {})

export async function uploadDocuments(slug: string, files: File[], lang = '') {
  const fd = new FormData()
  for (const f of files) fd.append('files', f)
  if (lang) fd.append('lang', lang)
  const r = await fetch(`/v1/kbs/${slug}/documents`, { method: 'POST', headers: headers(), body: fd })
  if (!r.ok) return fail(r)
  return r.json() as Promise<{
    accepted: { source_id: string; title: string; bytes: number }[]
    rejected: { filename: string; error: string }[]
    job: string
  }>
}

export const getJob = (id: string) => get<Job>(`/v1/jobs/${id}`)
export const getJobs = (kb = '') => get<{ jobs: Job[] }>(`/v1/jobs${kb ? `?kb=${kb}` : ''}`).then(d => d.jobs)

export const getSettings = () =>
  get<{ settings: Setting[]; chunkers: Record<string, string>; database: string; mcp: { host: string; port: number } }>('/v1/settings')
export const putSetting = (key: string, value: any) =>
  put<{ settings: Setting[] }>('/v1/settings', { key, value })
export const resetSetting = (key: string) => del<{ settings: Setting[] }>(`/v1/settings/${key}`)

export const getMcp = () => get<McpConfig>('/v1/mcp')

export const getTraces = (kb = '', q = '') =>
  get<{ traces: TraceRow[] }>(`/v1/traces?kb=${kb}&q=${encodeURIComponent(q)}`).then(d => d.traces)

export const getConversations = (kb = '') =>
  get<{ conversations: Conversation[] }>(`/v1/conversations${kb ? `?kb=${kb}` : ''}`)
    .then(d => d.conversations)
export const createConversation = (kb: string) =>
  post<{ id: string }>('/v1/conversations', { kb })
export const getConversation = (id: string) =>
  get<{ id: string; kb: string; title: string; messages: { role: string; content: string; trace_id: string | null; meta: any }[] }>(
    `/v1/conversations/${id}`)
export const appendMessages = (id: string, body: object) =>
  post<{ ok: boolean }>(`/v1/conversations/${id}/messages`, body)
export const deleteConversation = (id: string) => del<{ deleted: string }>(`/v1/conversations/${id}`)

// ------------------------------------------------------------- sources -----
// Where documents come from, and how often to go back and look.

export type Source = {
  id: number; kb_id: number; name: string; kind: 'mcp' | 'filesystem' | 'http'
  config: any; every_minutes: number; enabled: boolean; prune: boolean; lang: string
  last_run_at: string; next_run_at: string; last_status: string; last_error: string | null
  created_at: string; documents: number
}

export type SourceRun = {
  id: number; trigger: string; status: string
  added: number; updated: number; unchanged: number; removed: number; failed: number
  message: string; error: string | null; started_at: string; finished_at: string
}

export type McpTool = { name: string; description: string; args: string[]; required: string[] }

export type Preset = {
  id: string; kind: Source['kind']; verified: boolean
  name: string; what: string; config: any
}

export const getSourceKinds = () =>
  get<{
    kinds: Record<string, string>; presets: Preset[]
    scheduler: { running: boolean; tick_seconds: number; in_flight: number[] }
  }>('/v1/source-kinds')

export const getSources = (slug: string) =>
  get<{ sources: Source[] }>(`/v1/kbs/${slug}/sources`).then(d => d.sources)
export const createSource = (slug: string, body: object) =>
  post<Source>(`/v1/kbs/${slug}/sources`, body)
export const patchSource = (id: number, body: object) => patch<Source>(`/v1/sources/${id}`, body)
export const deleteSource = (id: number, withDocuments = false) =>
  del<{ deleted: number; documents_removed: number }>(
    `/v1/sources/${id}${withDocuments ? '?documents=true' : ''}`)
export const syncSource = (id: number) => post<{ started: number }>(`/v1/sources/${id}/sync`, {})
export const getSourceRuns = (id: number) =>
  get<{ runs: SourceRun[] }>(`/v1/sources/${id}/runs`).then(d => d.runs)

export const discoverMcp = (config: object) =>
  post<{ tools: McpTool[]; suggested: { list_tool: string; read_tool: string; read_arg: string } }>(
    '/v1/sources/discover', { kind: 'mcp', config })
export const previewSource = (kind: string, config: object) =>
  post<{ found: number; items: { id: string; title: string; chars?: number; excerpt?: string; error?: string }[] }>(
    '/v1/sources/preview', { kind, config })
