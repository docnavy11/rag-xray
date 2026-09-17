import type { Stage } from '../lib/api'
import { fmtInt } from '../lib/text'
import Glyph from '../ui/Glyph'
import { Note, Tag } from '../ui/controls'

/** Every stage renders its own real data — never a diagram of what a stage of
 *  that name usually does. When a stage carries a shape this file does not know,
 *  the raw payload is shown rather than nothing. */
export default function StageDetail({ stage, accent, onPath }:
  { stage: Stage; accent: string; onPath?: (path: string) => void }) {
  const d = stage.detail ?? {}

  const Path = ({ p }: { p: string }) =>
    onPath ? (
      <button onClick={() => onPath(p)} className="num cursor-pointer text-[12.5px] font-medium hover:underline"
        style={{ color: accent }}>{p}</button>
    ) : <span className="num text-[12.5px] font-medium" style={{ color: accent }}>{p}</span>

  if (stage.name === 'question') {
    return (
      <div className="rounded-[7px] border border-rule bg-surface px-4 py-[13px]">
        <div className="microlabel mb-2">Exactly as it was typed</div>
        <p className="m-0 text-[15.5px] leading-[1.55]">{d.text}</p>
        <div className="num mt-3 flex gap-4 text-[11px] text-ink3">
          <span>language {d.lang}</span><span>corpus {d.kb}</span>
        </div>
      </div>
    )
  }

  if (stage.name === 'expand') {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-[13px]">
          <div className="mb-[10px] flex flex-wrap items-center gap-2">
            <div className="microlabel">The corpus's own words for this question</div>
            <div className="grow" />
            <Tag tone={d.source === 'model' ? 'accent' : d.source === 'cache' ? 'ok' : 'warn'}>
              {d.source}
            </Tag>
            {d.reused && <Tag tone="quiet">reused for every search this turn</Tag>}
          </div>
          {d.expanded && (
            <p className="m-0 mb-3 text-[13px] text-ink3">
              expanded from <span className="text-ink2">“{d.expanded}”</span>
            </p>
          )}
          <div className="flex flex-wrap gap-[6px]">
            {(d.terms ?? []).map((t: string) => (
              <span key={t} className="num rounded-[4px] border border-rule bg-paper px-[8px] py-[3px] text-[12px] text-ink2">
                {t}
              </span>
            ))}
            {!(d.terms ?? []).length && <span className="text-[13px] text-ink3">No terms came back.</span>}
          </div>
        </div>

        {(d.guessed_paths ?? []).length > 0 && (
          <Note tone="warn">
            <div className="microlabel mb-[6px] !text-warn">Guessed, not measured</div>
            <div className="mb-2 flex flex-wrap gap-[6px]">
              {d.guessed_paths.map((p: string) => (
                <span key={p} className="num rounded-[4px] border border-warnrule px-[8px] py-[3px] text-[12px]">{p}</span>
              ))}
            </div>
            The expansion model also volunteers provision numbers. Its terms are good and
            its citations are not, so a guessed path is ranked last and only fills space
            nothing measured has claimed.
          </Note>
        )}
      </div>
    )
  }

  if (stage.name === 'tool') {
    return (
      <div className="rounded-[7px] border border-rule bg-surface px-4 py-[13px]">
        <div className="microlabel mb-2">The agent decided to search — call #{d.call_number}</div>
        <p className="num m-0 text-[14px]">“{d.query}” <span className="text-ink3">· {d.lang}</span></p>
        <p className="m-0 mt-2 text-[13px] leading-[1.5] text-ink2">
          Nothing forces this. The model has one search tool and chooses whether, and how
          often, to reach for it — this is the call it chose to make, in its own words
          rather than yours.
        </p>
      </div>
    )
  }

  if (stage.name === 'search' && d.query) {
    const stripped = new Set((d.query.stripped ?? []).map((s: any) => s.lexeme))
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-[13px]">
          <div className="mb-[9px] flex flex-wrap items-center gap-2">
            <div className="microlabel">The query that actually ran</div>
            <div className="grow" />
            <Tag tone="quiet">mode {d.mode}</Tag>
          </div>
          <div className="num text-[12.5px] leading-[1.75] text-ink2">
            <span className="text-ink3">tsquery&nbsp;&nbsp;</span>
            {(d.query.lexemes ?? []).map((l: string, i: number) => (
              <span key={i}>
                {i > 0 && ' | '}
                <span style={stripped.has(l)
                  ? { textDecoration: 'line-through', textDecorationColor: 'var(--color-stop)', color: 'var(--color-rule2)' }
                  : undefined}>'{l}'</span>
              </span>
            ))}
            {!(d.query.lexemes ?? []).length && <span className="text-ink3">— nothing lexical in this query</span>}
          </div>
          {(d.query.stripped ?? []).length > 0 && (
            <p className="mt-[9px] mb-0 text-[13px] leading-[1.5] text-ink2">
              Stripped before searching:{' '}
              {(d.query.stripped as any[]).map((s, i) => (
                <span key={s.lexeme}>
                  {i > 0 && ', '}<span className="num">{s.lexeme}</span>{' '}
                  ({fmtInt(s.df)} of {fmtInt(d.query.corpus_size)})
                </span>
              ))}. Postgres full-text search has no IDF, so a word describing the whole
              corpus ranks everything equally — and therefore ranks nothing.
            </p>
          )}
        </div>

        {(d.runs ?? []).map((r: any) => (
          <div key={r.name} className="rounded-[7px] border border-rule bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-[9px]">
              <div className="microlabel" style={{ color: accent }}>{r.name}</div>
              <div className="num text-[11px] text-ink3">{r.kind} · {r.n} hits</div>
            </div>
            <div className="flex flex-col">
              {r.top.map((t: any, i: number) => (
                <div key={t.path} className="flex items-center gap-3 border-b border-rule px-4 py-[7px] last:border-0">
                  <span className="num w-5 shrink-0 text-[11.5px] text-ink3">{i + 1}</span>
                  <Path p={t.path} />
                  <span className="truncate text-[12.5px] text-ink3">{t.heading}</span>
                  <span className="num ml-auto shrink-0 text-[11.5px] text-rule2">{t.score}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {d.mode !== 'lexical' && !(d.runs ?? []).some((r: any) => r.kind === 'vector') && (
          <Note tone="warn">
            <div className="microlabel mb-[6px] !text-warn">No vector run happened</div>
            This corpus asks for <span className="num">{d.mode}</span> retrieval, but no embedding
            run appears above — embeddings are not enabled on this server, so what ran was
            lexical alone. Whether vectors would beat it here is unmeasured.
          </Note>
        )}
      </div>
    )
  }

  if (stage.name === 'fuse' && d.table) {
    const runs: string[] = d.run_names ?? []
    return (
      <div className="flex flex-col gap-3">
        <div className="num flex flex-wrap gap-4 text-[11.5px] text-ink3">
          <span>method <span className="text-ink">{d.mode}</span></span>
          {d.mode === 'rrf' && <span>k <span className="text-ink">{d.rrf_k}</span></span>}
          <span>{runs.length} run(s) in</span>
        </div>
        <div className="scrollthin overflow-x-auto rounded-[7px] border border-rule bg-surface">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr>
                <th className="microlabel border-b border-rule px-[14px] py-[10px] text-left font-medium">Passage</th>
                {runs.map(r => (
                  <th key={r} className="microlabel whitespace-nowrap border-b border-rule px-[14px] py-[10px] text-left font-medium">{r}</th>
                ))}
                <th className="microlabel border-b border-rule px-[14px] py-[10px] text-right font-medium">Fused</th>
              </tr>
            </thead>
            <tbody>
              {d.table.map((row: any) => (
                <tr key={row.path}>
                  <td className="border-b border-rule px-[14px] py-[10px]">
                    <Path p={row.path} />
                    {row.kind === 'recital' && (
                      <span className="ml-2 text-[10px] uppercase tracking-[.08em] text-ink3">recital</span>
                    )}
                  </td>
                  {runs.map(r => (
                    <td key={r} className="num border-b border-rule px-[14px] py-[10px] text-[12.5px] text-ink2">
                      {row.ranks?.[r] ? `#${row.ranks[r]}` : <span className="text-rule2">—</span>}
                    </td>
                  ))}
                  <td className="num border-b border-rule px-[14px] py-[10px] text-right text-[12.5px] font-medium">
                    {row.score ?? <span className="text-rule2">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (stage.name === 'links') {
    const added: string[] = d.added ?? []
    return added.length ? (
      <div className="rounded-[7px] border border-rule bg-surface px-4 py-[13px]">
        <div className="microlabel mb-[9px]">Pulled in because a retrieved passage points at it</div>
        <div className="flex flex-wrap gap-[6px]">
          {added.map(p => (
            <button key={p} onClick={() => onPath?.(p)}
              className="num cursor-pointer rounded-[4px] border border-rule bg-paper px-[8px] py-[3px] text-[12px]"
              style={{ color: accent }}>{p}</button>
          ))}
        </div>
      </div>
    ) : (
      <p className="m-0 text-[14px] text-ink2">The top hits pointed at nothing that was not already retrieved.</p>
    )
  }

  if (stage.name === 'assemble' && d.passages) {
    const total = d.approx_tokens ?? 0
    return (
      <div>
        <div className="mb-3 flex h-[34px] overflow-hidden rounded-[5px] border border-rule">
          {d.passages.map((p: any, i: number) => (
            <div key={p.path} title={`${p.path} · ~${p.approx_tokens} tokens`}
              className="grid place-items-center border-r border-white/20 last:border-0"
              style={{
                width: `${(p.approx_tokens / Math.max(total, 1)) * 100}%`,
                background: i % 2 ? accent : 'var(--color-ink2)',
              }} />
          ))}
        </div>
        <p className="mb-4 max-w-[80ch] text-[14px] leading-[1.55] text-ink2">
          <b className="font-semibold text-ink">~{fmtInt(total)} tokens</b> across{' '}
          {d.passages.length} passages. Nothing else reached the model — no web, no memory
          of this corpus. If a passage is not in this bar, it could not have been read.
        </p>
        <div className="rounded-[7px] border border-rule bg-surface">
          {d.passages.map((p: any) => (
            <div key={p.path} className="flex items-center gap-3 border-b border-rule px-4 py-[7px] last:border-0">
              <Path p={p.path} />
              <span className="truncate text-[12.5px] text-ink3">{p.heading}</span>
              <span className="num ml-auto shrink-0 text-[11.5px] text-ink3">~{fmtInt(p.approx_tokens)} tok</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (stage.name === 'verify') {
    const cited = d.cited ?? []
    const unverified = d.unverified ?? []
    if (d.enabled === false) {
      return (
        <Note tone="warn">
          <div className="microlabel mb-[6px] !text-warn">Checking was switched off for this answer</div>
          Nothing above was verified against the retrieved text. Every quotation in the
          answer is the model's word for it — which is exactly what an unchecked citation
          is worth everywhere else.
        </Note>
      )
    }
    return (
      <div className="flex flex-col gap-3">
        {cited.map((c: any, i: number) => (
          <div key={i} className="rounded-[7px] border border-rule bg-surface px-4 py-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Path p={c.path} />
              {c.start != null ? (
                <Tag tone="ok">found in the {c.field} at {c.start}–{c.end}</Tag>
              ) : (
                <Tag tone="quiet">referenced, nothing quoted</Tag>
              )}
              {c.elided && <Tag tone="quiet">elided middle</Tag>}
            </div>
            {c.cited_text && <div className="quote text-[13.5px] leading-[1.5]">«{c.cited_text}»</div>}
          </div>
        ))}
        {unverified.map((q: string, i: number) => (
          <Note key={i} tone="stop">
            <div className="microlabel mb-1 !text-stop">Not found in any retrieved passage</div>
            <div className="quote text-[13.5px] leading-[1.5]">«{q}»</div>
          </Note>
        ))}
        {!cited.length && !unverified.length && (
          <p className="m-0 text-[14px] text-ink2">No quotes to check in this answer.</p>
        )}
      </div>
    )
  }

  if (stage.name === 'classify' && d.verdict) {
    const v = d.verdict
    const tone = v.band === 'red' ? 'stop' : v.band === 'amber' ? 'warn' : 'ok'
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-[13px]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Tag tone={tone as any}>{v.band}</Tag>
            <span className="text-[15px] font-semibold">{v.classification}</span>
          </div>
          <ul className="m-0 mb-3 list-none p-0">
            {(v.reasons ?? []).map((r: string, i: number) => (
              <li key={i} className="flex gap-2 py-[3px] text-[13.5px] leading-[1.5] text-ink2">
                <Glyph name="arrow" className="mt-[5px] h-[12px] w-[12px] shrink-0" stroke="var(--color-rule2)" />
                {r}
              </li>
            ))}
          </ul>
          {(v.actions ?? []).length > 0 && (
            <>
              <div className="microlabel mb-[6px]">What it says to do</div>
              <ul className="m-0 list-none p-0">
                {v.actions.map((a: string, i: number) => (
                  <li key={i} className="py-[2px] text-[13.5px] text-ink2">· {a}</li>
                ))}
              </ul>
            </>
          )}
          <div className="num mt-3 border-t border-rule pt-2 text-[11px] text-ink3">
            engine {v.engine} · the model may explain this verdict and may not overrule it
          </div>
        </div>
        <div className="rounded-[7px] border border-rule bg-surface px-4 py-3">
          <div className="microlabel mb-2">What the model passed in</div>
          <pre className="scrollthin m-0 overflow-x-auto text-[12px] leading-[1.6] text-ink2">
{JSON.stringify(d.input, null, 2)}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <pre className="scrollthin overflow-x-auto rounded-[7px] border border-rule bg-surface px-4 py-3 text-[12.5px] leading-[1.65] text-ink2">
{JSON.stringify(d, null, 2)}
    </pre>
  )
}
