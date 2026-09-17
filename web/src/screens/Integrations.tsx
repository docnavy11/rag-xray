import { useEffect, useState } from 'react'
import { getMcp, getStats, type KB, type McpConfig, type Stats } from '../lib/api'
import Glyph from '../ui/Glyph'
import { Btn, Copy, Note, Price, SectionHead, Seg, Spinner, Tag } from '../ui/controls'

type Ep = {
  method: 'GET' | 'POST'; path: string; what: string; costs: boolean
  body?: (kb: string) => object
}

const ENDPOINTS: Ep[] = [
  { method: 'GET', path: '/v1/kbs', what: 'The corpora, each with its retrieval config and sample questions.', costs: false },
  { method: 'GET', path: '/v1/stats', what: 'Chunk and character counts per corpus, traces kept, answer model.', costs: false },
  { method: 'GET', path: '/v1/lessons', what: 'The measurement ledger every explanatory panel reads from.', costs: false },
  { method: 'GET', path: '/v1/chunk/{kb}/{path}', what: 'One passage, verbatim, by the identifier an answer cites it as.', costs: false },
  {
    method: 'POST', path: '/v1/search', costs: false,
    what: 'Retrieval on its own, with the whole trace. No model, no limit.',
    body: kb => ({ kb, q: 'high risk recruitment', lang: 'en' }),
  },
  {
    method: 'POST', path: '/v1/counterfactual', costs: false,
    what: 'The same query run twice, as configured and with changes, plus the ranking diff.',
    body: kb => ({ kb, q: 'high risk recruitment', changes: { corpus_stopwords: { enabled: false } } }),
  },
  {
    method: 'POST', path: '/v1/compare', costs: false,
    what: 'One question against two or three corpora at once.',
    body: () => ({ q: 'What counts as a high-risk system?', kbs: ['aiact', 'aiact-naive'] }),
  },
  {
    method: 'POST', path: '/v1/eval', costs: false,
    what: 'Recall@k over the golden set under any configuration.',
    body: kb => ({ kb, k: 8 }),
  },
  { method: 'GET', path: '/v1/trace/{id}', what: 'A finished run: every stage, the answer, the cost.', costs: false },
  {
    method: 'POST', path: '/v1/ask', costs: true,
    what: 'One request, one answer, same pipeline and same verification as the chat. For n8n, Zapier, Make, or any plain HTTP client.',
  },
  { method: 'POST', path: '/v1/ask/stream', what: 'The same thing as Server-Sent Events: stage by stage, then the answer.', costs: true },
]

/** Everything here is reachable from something other than this browser tab —
 *  which is the point: the demo is a service with a UI on it, not a UI with a
 *  demo behind it. */
export default function Integrations({ kbs }: { kbs: KB[] }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [mcp, setMcp] = useState<McpConfig | null>(null)
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [kb, setKb] = useState(kbs[0]?.slug ?? 'aiact')
  const [sel, setSel] = useState(4)
  const [body, setBody] = useState('')
  const [out, setOut] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getStats().then(setStats).catch(() => setStats(null))
    getMcp().then(setMcp).catch(() => setMcp(null))
  }, [])

  const ep = ENDPOINTS[sel]
  const runnable = ENDPOINTS.map((e, i) => ({ e, i })).filter(({ e }) => !e.costs && !e.path.includes('{'))

  useEffect(() => {
    setOut(null)
    setBody(ep.body ? JSON.stringify(ep.body(kb), null, 2) : '')
  }, [sel, kb])

  async function run() {
    setBusy(true); setOut(null)
    try {
      const res = ep.method === 'GET'
        ? await fetch(ep.path)
        : await fetch(ep.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      const json = await res.json()
      setOut(JSON.stringify(json, null, 2))
    } catch (e) {
      setOut(String(e))
    }
    setBusy(false)
  }

  const origin = location.origin
  const askCurl = `curl -s ${origin}/v1/ask \\
  -H 'content-type: application/json' \\
  -H 'X-API-Key: YOUR_KEY' \\
  -d '${JSON.stringify({ kb, question: 'Do we have to tell users they are talking to an AI?', lang: 'en' })}'`

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-6 lg:px-10">
      <h1 className="m-0 mb-3 text-[22px] font-semibold tracking-[-.022em]">Call it from something else</h1>
      <p className="mb-6 max-w-[86ch] text-[15px] leading-[1.6] text-ink2">
        The same pipeline this screen is built on is an HTTP API and an MCP server. The
        retrieval endpoints are open and free; the two that answer are the ones that reach
        a model, and they are the ones with a key and a budget in front of them.
      </p>

      <SectionHead n="01" title="The endpoints"
        right={stats ? <div className="num text-[11px] text-ink3">answer model {stats.model}</div> : undefined} />
      <div className="scrollthin mb-8 overflow-x-auto rounded-[7px] border border-rule bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {ENDPOINTS.map((e, i) => (
              <tr key={e.path} className={i === sel ? 'bg-paper' : undefined}>
                <td className="num border-b border-rule px-[14px] py-[9px] align-top text-[11px] text-ink3">{e.method}</td>
                <td className="num border-b border-rule px-[14px] py-[9px] align-top text-[12.5px]">
                  <span style={{ color: 'var(--color-accent)' }}>{e.path}</span>
                </td>
                <td className="border-b border-rule px-[14px] py-[9px] align-top leading-[1.45] text-ink2">{e.what}</td>
                <td className="border-b border-rule px-[14px] py-[9px] align-top">
                  {e.costs ? <Tag tone="warn">calls the model</Tag> : <Tag tone="ok">free</Tag>}
                </td>
                <td className="border-b border-rule px-[14px] py-[9px] align-top">
                  {!e.costs && !e.path.includes('{') && (
                    <button onClick={() => setSel(i)} className="num cursor-pointer text-[11px] uppercase tracking-[.1em]"
                      style={{ color: 'var(--color-accent)' }}>try it</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionHead n="02" title="Run one from here"
        right={<Price free />} />
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={sel} onChange={e => setSel(Number(e.target.value))}
              className="num cursor-pointer rounded-[4px] border border-rule bg-surface px-2 py-1 text-[12px]">
              {runnable.map(({ e, i }) => <option key={e.path} value={i}>{e.method} {e.path}</option>)}
            </select>
            <select value={kb} onChange={e => setKb(e.target.value)}
              className="num cursor-pointer rounded-[4px] border border-rule bg-surface px-2 py-1 text-[12px]">
              {kbs.map(k => <option key={k.slug} value={k.slug}>{k.slug}</option>)}
            </select>
            <div className="grow" />
            <Btn accent="var(--color-accent)" onClick={run} busy={busy}>Send</Btn>
          </div>
          {ep.method === 'POST' && (
            <textarea value={body} onChange={e => setBody(e.target.value)} spellCheck={false}
              className="scrollthin h-[190px] w-full resize-y rounded-[6px] border border-rule bg-paper px-3 py-2 font-mono text-[12px] leading-[1.6] outline-none" />
          )}
          <div className="mt-3">
            <Copy accent="var(--color-accent)" label="Copy as curl"
              text={ep.method === 'GET'
                ? `curl -s ${origin}${ep.path}`
                : `curl -s ${origin}${ep.path} -H 'content-type: application/json' -d '${body.replace(/\s+/g, ' ')}'`} />
          </div>
        </div>
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-4">
          <div className="microlabel mb-2">Response</div>
          {busy ? (
            <div className="flex items-center gap-2 text-[13px] text-ink3"><Spinner accent="var(--color-accent)" /> running…</div>
          ) : out ? (
            <pre className="scrollthin m-0 max-h-[260px] overflow-auto text-[11.5px] leading-[1.6] text-ink2">{out}</pre>
          ) : (
            <p className="m-0 text-[13px] text-ink3">Nothing sent yet.</p>
          )}
        </div>
      </div>

      <SectionHead n="03" title="Answering from a workflow tool" right={<Price free={false} />} />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mt-0 mb-3 text-[14px] leading-[1.6] text-ink2">
            <span className="num">POST /v1/ask</span> takes a question and returns the answer,
            the verified citations and the unverified quotes in one response — the same
            pipeline the chat streams, without the event stream. It is gated by an
            <span className="num"> X-API-Key</span> header whenever a key is configured on the
            server, and open when one is not, which is the local default.
          </p>
          <pre className="scrollthin m-0 overflow-x-auto rounded-[6px] border border-rule bg-surface px-3 py-2 text-[11.5px] leading-[1.6] text-ink2">{askCurl}</pre>
          <div className="mt-2"><Copy accent="var(--color-accent)" text={askCurl} label="Copy" /></div>
        </div>
        <div className="flex flex-col gap-3">
          <Note tone="warn">
            <div className="microlabel mb-1 !text-warn">What it refuses, and when</div>
            Answering is rate-limited per caller and capped by a shared daily budget. Over
            either, the endpoint returns <span className="num">429</span> or{' '}
            <span className="num">503</span> with the exact figure in the message — and
            retrieval, counterfactuals and evaluation keep working, because none of them
            spend anything.
          </Note>
          <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <Glyph name="plug" className="h-[15px] w-[15px]" stroke="var(--color-accent)" />
              <div className="text-[14px] font-semibold">A ready-made n8n workflow</div>
            </div>
            <p className="m-0 mb-3 text-[13.5px] leading-[1.55] text-ink2">
              Import this and it calls the endpoint above, keeps the verified citations and
              flags any answer that carried an unverified quote.
            </p>
            <a href="/n8n-ragdemo-sample.json" download
              className="inline-flex items-center gap-2 text-[13px] no-underline" style={{ color: 'var(--color-accent)' }}>
              <Glyph name="arrow" className="h-[13px] w-[13px]" /> n8n-ragdemo-sample.json
            </a>
          </div>
        </div>
      </div>

      <SectionHead n="04" title="As a tool for another agent"
        right={mcp && <Seg value={transport} accent="var(--color-accent)"
          onChange={setTransport}
          options={[{ v: 'stdio', label: 'stdio' }, { v: 'http', label: 'http' }]} />} />
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mt-0 mb-3 text-[14px] leading-[1.6] text-ink2">
            Every corpus is also an MCP server, so Claude Desktop, Claude Code or Cursor can
            search and ask them directly. Paste this into the client's config file:
          </p>
          {mcp ? (
            <>
              <pre className="scrollthin m-0 max-h-[280px] overflow-auto rounded-[6px] border border-rule bg-surface px-3 py-2 text-[11.5px] leading-[1.6] text-ink2">
{JSON.stringify(transport === 'stdio' ? mcp.stdio : mcp.http, null, 2)}
              </pre>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Copy accent="var(--color-accent)"
                  text={JSON.stringify(transport === 'stdio' ? mcp.stdio : mcp.http, null, 2)} />
                {mcp.key_required
                  ? <Tag tone="warn">replace YOUR_KEY with the configured API key</Tag>
                  : <Tag tone="stop">no API key set — anyone who can reach it can call it</Tag>}
              </div>
              <p className="m-0 mt-3 text-[12.5px] leading-[1.55] text-ink3">
                {transport === 'stdio'
                  ? 'The client launches the server itself and talks to it over stdin; set cwd to this repo\'s api/ directory. Nothing needs to be listening in advance.'
                  : `Point the client at the HTTP server on ${mcp.host}:${mcp.port}. It binds to localhost unless you change mcp_http_host, which is the right default \u2014 it is unauthenticated until an API key is set.`}
              </p>
            </>
          ) : (
            <p className="m-0 text-[13px] text-ink3">Could not read the MCP configuration.</p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
            <div className="microlabel mb-2">What the client gets</div>
            {(mcp?.tools ?? []).map(t => (
              <div key={t.name} className="border-b border-rule py-[7px] last:border-0">
                <div className="flex items-center gap-2">
                  <span className="num text-[12.5px]" style={{ color: 'var(--color-accent)' }}>{t.name}</span>
                  {t.writes ? <Tag tone="warn">writes</Tag> : <Tag tone="ok">read only</Tag>}
                </div>
                <div className="text-[12px] leading-[1.45] text-ink2">{t.what}</div>
              </div>
            ))}
          </div>

          <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
            <div className="microlabel mb-3">Tool surface inside this app</div>
            {kbs.map(k => (
              <div key={k.slug} className="flex items-center gap-3 border-b border-rule py-[7px] last:border-0">
                <Glyph name={k.glyph} className="h-[15px] w-[15px] shrink-0" stroke={k.accent} />
                <span className="text-[13.5px]">{k.name}</span>
                <div className="grow" />
                <span className="num text-[11.5px] text-ink3">{k.tools.join(' · ')}</span>
              </div>
            ))}
            <p className="m-0 mt-2 text-[11.5px] leading-[1.5] text-ink3">
              Exactly these. Every built-in file and shell tool the Agent SDK ships is excluded by
              whitelist, which is a hard gate rather than a tidy-up.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
