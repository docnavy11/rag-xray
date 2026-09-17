import { useState } from 'react'
import { runEval, type EvalResult, type KB, type Lesson, type RetrievalConfig } from '../lib/api'
import { pct } from '../lib/text'
import Knobs, { mergeCfg } from '../panels/Knobs'
import Glyph from '../ui/Glyph'
import { Btn, Note, Price, SectionHead, Slider, Tag } from '../ui/controls'

const LANGS = ['en', 'nl', 'fr', 'de']

/** Re-run the golden set from the UI and watch recall@k move as the knobs move.
 *
 *  Two things this screen must keep saying, because they are what make the
 *  number worth anything: the set is IN-SAMPLE — it was used to build this
 *  retriever — and it is a set of AI Act questions, so running it against
 *  another corpus measures the mismatch and nothing else. */
export default function Evaluate({ kbs, lessons }: {
  kbs: KB[]; lessons: Record<string, Lesson> | null
}) {
  const [slug, setSlug] = useState('aiact')
  const [k, setK] = useState(8)
  const [langs, setLangs] = useState<string[]>([])
  const [changes, setChanges] = useState<Partial<RetrievalConfig>>({})
  const [base, setBase] = useState<EvalResult | null>(null)
  const [variant, setVariant] = useState<EvalResult | null>(null)
  const [busy, setBusy] = useState<'base' | 'variant' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const kb = kbs.find(x => x.slug === slug) ?? kbs[0]
  const dirty = Object.keys(changes).length > 0
  const offCorpus = slug !== 'aiact' && slug !== 'aiact-naive'

  async function run(which: 'base' | 'variant') {
    setBusy(which); setErr(null)
    try {
      const out = await runEval({
        kb: slug, k, langs: langs.length ? langs : null,
        config_overrides: which === 'variant' ? changes : {},
      })
      which === 'base' ? setBase(out) : setVariant(out)
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    }
    setBusy(null)
  }

  const delta = base && variant ? variant.recall - base.recall : null

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6 lg:px-10">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-.022em]">Measure it yourself</h1>
        <Price free note="only uncached query expansions" />
      </div>
      <p className="mb-5 max-w-[86ch] text-[15px] leading-[1.6] text-ink2">
        Recall@k over the golden set, under whatever configuration you set on the right.
        Retrieval only — the answer model is never called, so the only thing this can cost
        is a query expansion that is not cached yet. The first run on a cold cache is slow
        for that reason and the ones after it are not.
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[7px] border border-rule bg-surface px-4 py-3">
            <label className="flex items-center gap-2 text-[13px]">
              <span className="microlabel">corpus</span>
              <select value={slug} onChange={e => { setSlug(e.target.value); setBase(null); setVariant(null) }}
                className="num cursor-pointer rounded-[4px] border border-rule bg-surface px-2 py-1 text-[12px]">
                {kbs.map(x => <option key={x.slug} value={x.slug}>{x.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <span className="microlabel">k</span>
              <Slider value={k} min={1} max={20} accent={kb?.accent ?? 'var(--color-accent)'} onChange={setK} />
            </label>
            <div className="flex items-center gap-2">
              <span className="microlabel">languages</span>
              {LANGS.map(l => {
                const on = langs.includes(l)
                return (
                  <button key={l} onClick={() => setLangs(p => on ? p.filter(x => x !== l) : [...p, l])}
                    className="num cursor-pointer rounded-[4px] border px-[8px] py-[3px] text-[11px]"
                    style={on
                      ? { background: kb?.accent, borderColor: kb?.accent, color: 'var(--color-onaccent)' }
                      : { borderColor: 'var(--color-rule)', color: 'var(--color-ink2)' }}>
                    {l}
                  </button>
                )
              })}
              {!langs.length && <span className="num text-[11px] text-ink3">all</span>}
            </div>
          </div>

          {offCorpus && (
            <div className="mb-4">
              <Note tone="warn">
                <div className="microlabel mb-1 !text-warn">This set does not belong to this corpus</div>
                The golden set is 22 AI Act questions with AI Act provisions as their
                answers. Run against {kb?.name}, a low score measures the mismatch between
                the set and the corpus — it says nothing about how good that corpus is.
              </Note>
            </div>
          )}

          {err && <div className="mb-4"><Note tone="stop">{err}</Note></div>}

          <div className="mb-5 grid gap-4 sm:grid-cols-2">
            <ResultCard title="As this corpus is configured" res={base} busy={busy === 'base'}
              accent={kb?.accent ?? 'var(--color-accent)'} onRun={() => run('base')} />
            <ResultCard title="With your changes" res={variant} busy={busy === 'variant'}
              accent={kb?.accent ?? 'var(--color-accent)'} onRun={() => run('variant')}
              disabled={!dirty} disabledNote="Change a setting on the right first."
              delta={delta} />
          </div>

          {(base || variant) && (
            <>
              <SectionHead n="Q" title="Question by question"
                right={
                  <button onClick={() => setShowAll(v => !v)} className="num cursor-pointer text-[11px] uppercase tracking-[.1em] text-ink3">
                    {showAll ? 'only the misses' : 'every question'}
                  </button>
                } />
              <QuestionTable base={base} variant={variant} showAll={showAll} accent={kb?.accent ?? 'var(--color-accent)'} />
            </>
          )}

          <div className="mt-6">
            <Note>
              <div className="microlabel mb-1 !text-accent">How much this number is worth</div>
              The golden set was used to develop this retriever, so every figure here is
              in-sample — a development number, not a holdout result. n is small
              {base ? ` (${base.n} questions this run)` : ''}, so a difference of one or two
              questions is one or two questions, not a trend.
            </Note>
          </div>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-[7px] border border-rule bg-surface px-5 py-4">
            <div className="mb-3 flex items-center gap-[10px]">
              <Glyph name="sliders" className="h-[15px] w-[15px]" stroke={kb?.accent} />
              <div className="microlabel">The configuration to measure</div>
              <div className="h-px grow bg-rule" />
            </div>
            {kb && (
              <Knobs base={kb.retrieval_config} changes={changes} accent={kb.accent} lessons={lessons}
                onChange={p => setChanges(c => ({ ...c, ...p }))}
                onReset={() => { setChanges({}); setVariant(null) }} />
            )}
            {kb && dirty && (
              <p className="num mt-3 mb-0 text-[11px] leading-[1.5] text-ink3">
                measuring: {JSON.stringify(mergeCfg(kb.retrieval_config, changes).fusion)} fusion,
                top_k {mergeCfg(kb.retrieval_config, changes).top_k}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function ResultCard({ title, res, busy, onRun, accent, disabled, disabledNote, delta }: {
  title: string; res: EvalResult | null; busy: boolean; onRun: () => void; accent: string
  disabled?: boolean; disabledNote?: string; delta?: number | null
}) {
  return (
    <div className="rounded-[7px] border border-rule bg-surface px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="microlabel">{title}</div>
        <div className="grow" />
        <Btn accent={accent} kind={res ? 'quiet' : 'primary'} onClick={onRun} busy={busy}
          disabled={disabled} title={disabled ? disabledNote : undefined}>
          {res ? 'Run again' : 'Run'}
        </Btn>
      </div>
      {!res ? (
        <p className="m-0 text-[13px] leading-[1.5] text-ink3">
          {disabled ? disabledNote : 'Not run yet.'}
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="num text-[34px] leading-none">{pct(res.recall)}</span>
            <span className="text-[13px] text-ink2">recall@{res.k}</span>
            {delta != null && (
              <span className="num text-[13px]"
                style={{ color: delta > 0 ? 'var(--color-ok)' : delta < 0 ? 'var(--color-stop)' : 'var(--color-ink3)' }}>
                {delta > 0 ? '+' : ''}{(delta * 100).toFixed(1)} pts
              </span>
            )}
          </div>
          <div className="mt-2 h-[7px] overflow-hidden rounded-[3px] bg-surface2">
            <div className="h-full rounded-[3px]" style={{ width: `${res.recall * 100}%`, background: accent }} />
          </div>
          <div className="num mt-2 flex flex-wrap gap-x-4 text-[11px] text-ink3">
            <span>{res.hits} of {res.n} questions</span>
            <span>{res.in_sample ? 'in-sample' : 'holdout'}</span>
          </div>
        </>
      )}
    </div>
  )
}

function QuestionTable({ base, variant, showAll, accent }: {
  base: EvalResult | null; variant: EvalResult | null; showAll: boolean; accent: string
}) {
  const rows = (base ?? variant)!.results.map((r, i) => ({
    q: r.q, lang: r.lang, want: r.want,
    a: base?.results[i], b: variant?.results[i],
  }))
  const shown = showAll ? rows : rows.filter(r => r.a?.hit === false || r.b?.hit === false)

  if (!shown.length) return <p className="text-[14px] text-ink2">Every question in the set was answered by the retrieved passages.</p>

  return (
    <div className="scrollthin overflow-x-auto rounded-[7px] border border-rule bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="microlabel border-b border-rule px-[14px] py-[9px] text-left font-medium">Question</th>
            <th className="microlabel border-b border-rule px-[14px] py-[9px] text-left font-medium">Wanted</th>
            {base && <th className="microlabel border-b border-rule px-[14px] py-[9px] text-left font-medium">Configured</th>}
            {variant && <th className="microlabel border-b border-rule px-[14px] py-[9px] text-left font-medium">Changed</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              <td className="border-b border-rule px-[14px] py-[9px] align-top">
                <div className="max-w-[40ch] leading-[1.45]">{r.q}</div>
                <span className="num text-[10.5px] text-ink3">{r.lang}</span>
              </td>
              <td className="num border-b border-rule px-[14px] py-[9px] align-top text-[12px] text-ink2">
                {r.want.join(' | ')}
              </td>
              {base && <Cell res={r.a} accent={accent} />}
              {variant && <Cell res={r.b} accent={accent} />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ res, accent }: { res?: { hit: boolean; got: string[] }; accent: string }) {
  if (!res) return <td className="border-b border-rule px-[14px] py-[9px] text-ink3">—</td>
  return (
    <td className="border-b border-rule px-[14px] py-[9px] align-top">
      <div className="mb-1"><Tag tone={res.hit ? 'ok' : 'stop'}>{res.hit ? 'found' : 'missed'}</Tag></div>
      <div className="num max-w-[34ch] text-[11.5px] leading-[1.5] text-ink3">
        {res.got.slice(0, 5).map((g, i) => (
          <span key={g}>{i > 0 && ' · '}<span style={{ color: accent }}>{g}</span></span>
        ))}
        {res.got.length > 5 && <span> +{res.got.length - 5}</span>}
      </div>
    </td>
  )
}
