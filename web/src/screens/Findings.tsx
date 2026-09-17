import type { Lesson } from '../lib/api'
import Evidence from '../panels/Evidence'
import { Empty, Note, Tag, type Level } from '../ui/controls'

/** Every claim the X-ray makes, in one place, with its provenance attached.
 *
 *  The ledger is the server's (`GET /v1/lessons`), never retyped here: if the
 *  prose on this screen ever says more than the numbers under it, the prose is
 *  what is wrong. A lesson with no measurement is listed as design and is not
 *  allowed to borrow the authority of the ones that have one. */
export default function Findings({ lessons, level, onLevel }: {
  lessons: Record<string, Lesson> | null
  level: Level; onLevel: (l: Level) => void
}) {
  if (!lessons) return <Empty>Loading the ledger…</Empty>
  const entries = Object.entries(lessons)
  const measured = entries.filter(([, l]) => l.measured && l.figures.length)
  const design = entries.filter(([, l]) => !l.measured || !l.figures.length)

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-6 lg:px-10">
      <h1 className="m-0 mb-3 text-[22px] font-semibold tracking-[-.022em]">
        What was measured, and how strongly
      </h1>
      <p className="mb-5 max-w-[86ch] text-[15px] leading-[1.6] text-ink2">
        None of this is “best practice says”. Each card below is a decision in the
        pipeline, the number it was measured at, how many questions that was over, when,
        and whether the set was in-sample. Where an earlier measurement disagrees, it is
        printed next to the current one rather than quietly replaced.
      </p>

      <div className="mb-6 scrollthin overflow-x-auto rounded-[7px] border border-rule bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="microlabel border-b border-rule px-[14px] py-[9px] text-left font-medium">Decision</th>
              <th className="microlabel border-b border-rule px-[14px] py-[9px] text-left font-medium">Strength</th>
              <th className="microlabel border-b border-rule px-[14px] py-[9px] text-left font-medium">n</th>
              <th className="microlabel border-b border-rule px-[14px] py-[9px] text-left font-medium">Measured</th>
              <th className="microlabel border-b border-rule px-[14px] py-[9px] text-left font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, l]) => (
              <tr key={key}>
                <td className="border-b border-rule px-[14px] py-[9px]">
                  <a href={`#/findings`} onClick={() => document.getElementById(`lesson-${key}`)?.scrollIntoView({ behavior: 'smooth' })}
                    className="cursor-pointer text-ink no-underline">{l.title}</a>
                </td>
                <td className="border-b border-rule px-[14px] py-[9px]">
                  {l.measured && l.figures.length
                    ? <Tag tone={l.holdout === false ? 'warn' : 'ok'}>{l.holdout === false ? 'in-sample' : 'measured'}</Tag>
                    : l.measured ? <Tag tone="quiet">observed</Tag> : <Tag tone="quiet">design</Tag>}
                </td>
                <td className="num border-b border-rule px-[14px] py-[9px] text-ink2">{l.n ?? '—'}</td>
                <td className="num border-b border-rule px-[14px] py-[9px] text-ink2">{l.measured ?? '—'}</td>
                <td className="num border-b border-rule px-[14px] py-[9px] text-[11.5px] text-ink3">{l.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-3 flex items-center gap-[10px]">
        <div className="microlabel">Measured on this build</div>
        <div className="h-px grow bg-rule" />
      </div>
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        {measured.map(([key, l]) => (
          <div key={key} id={`lesson-${key}`}>
            <Evidence lesson={l} accent="var(--color-accent)" level={level} onLevel={onLevel} />
          </div>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-[10px]">
        <div className="microlabel">Architecture, and observations without a figure</div>
        <div className="h-px grow bg-rule" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {design.map(([key, l]) => (
          <div key={key} id={`lesson-${key}`}>
            <Evidence lesson={l} accent="var(--color-ink2)" level={level} onLevel={onLevel} />
          </div>
        ))}
      </div>

      <div className="mt-8">
        <Note tone="warn">
          <div className="microlabel mb-1 !text-warn">What is not measured here</div>
          Embeddings are not enabled on this build, so nothing on this screen says whether
          hybrid retrieval would beat lexical on any of these corpora. The naive-chunking
          corpus is shown as a demonstration and was never put through the golden set. And
          every recall figure above is in-sample.
        </Note>
      </div>
    </div>
  )
}
