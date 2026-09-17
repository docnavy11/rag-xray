import { useCallback, useEffect, useMemo, useState } from 'react'
import { getKBs, getLessons, getTrace, type KB, type Lesson } from './lib/api'
import { parse, useHash } from './lib/router'
import { accentFor, useDisplay } from './lib/theme'
import SourceDrawer from './panels/SourceDrawer'
import Chat from './screens/Chat'
import Compare from './screens/Compare'
import Corpora from './screens/Corpora'
import Corpus from './screens/Corpus'
import Dashboard from './screens/Dashboard'
import Evaluate from './screens/Evaluate'
import Findings from './screens/Findings'
import History from './screens/History'
import Integrations from './screens/Integrations'
import Retrieval from './screens/Retrieval'
import SettingsScreen from './screens/SettingsScreen'
import Xray from './screens/Xray'
import Shell from './ui/Shell'
import Unlock from './ui/Unlock'
import { Empty, LevelPicker, type Level } from './ui/controls'

export default function App() {
  const hash = useHash()
  const route = parse(hash)
  const [rawKBs, setKBs] = useState<KB[] | null>(null)
  const [lessons, setLessons] = useState<Record<string, Lesson> | null>(null)
  const [level, setLevel] = useState<Level>('practical')
  const [traceKB, setTraceKB] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<{ slug: string; path: string } | null>(null)

  const { dark } = useDisplay()
  const reloadKBs = useCallback(() => { getKBs().then(setKBs).catch(() => setKBs([])) }, [])

  // Corpus accents come out of the database as data, so no stylesheet can reach
  // them. They are adapted here, once, rather than at forty call sites.
  const kbs = useMemo(
    () => rawKBs?.map(k => ({ ...k, accent: accentFor(k.accent, dark) })) ?? null,
    [rawKBs, dark])

  useEffect(() => {
    reloadKBs()
    getLessons().then(setLessons).catch(() => setLessons(null))
  }, [reloadKBs])

  // An X-ray permalink opened cold knows only its trace id; the trace itself
  // says which corpus it belongs to.
  useEffect(() => {
    if (route.name !== 'xray') return
    setTraceKB(null)
    getTrace(route.id).then(t => setTraceKB(t.kb_slug)).catch(() => setTraceKB(null))
  }, [route.name === 'xray' ? route.id : null])

  useEffect(() => { setDrawer(null) }, [hash])

  if (!kbs) return <><Unlock /><div className="grid h-app place-items-center text-ink3">Loading…</div></>

  const bySlug = (s: string | null | undefined) => kbs.find(k => k.slug === s) ?? null

  // Which corpus the sidebar's Chat and Search point at: whatever you last had
  // open, so the app comes back where you left it.
  const routeSlug =
    route.name === 'chat' || route.name === 'retrieval' || route.name === 'corpus'
      ? route.slug
      : route.name === 'xray' ? traceKB : null
  const remembered = localStorage.getItem('ragdemo.kb')
  if (routeSlug && routeSlug !== remembered) localStorage.setItem('ragdemo.kb', routeSlug)
  const activeKB = bySlug(routeSlug) ?? bySlug(remembered) ?? kbs[0] ?? null

  const levelPicker = <LevelPicker level={level} onChange={setLevel} accent="var(--color-accent)" />

  const body = () => {
    if (kbs.length === 0 && route.name !== 'corpora' && route.name !== 'settings') {
      return (
        <div className="grid grow place-items-center px-6 text-center">
          <div>
            <div className="kicker mb-2">Nothing in here yet</div>
            <p className="max-w-[52ch] text-[15px] text-ink2">
              There are no corpora. Make one and upload a few documents, or run{' '}
              <span className="num">./ingest.sh</span> to build the four that ship with this.
            </p>
          </div>
        </div>
      )
    }

    switch (route.name) {
      case 'chat': {
        const kb = bySlug(route.slug)
        if (!kb) return <Empty>No corpus called {route.slug}.</Empty>
        return (
          <Chat kb={kb} initialQ={route.q} initialCfg={route.cfg} initialConv={route.conv}
            lessons={lessons} level={level} onLevel={setLevel} />
        )
      }
      case 'retrieval': {
        const kb = bySlug(route.slug)
        if (!kb) return <Empty>No corpus called {route.slug}.</Empty>
        return <Retrieval kb={kb} lessons={lessons} level={level} onLevel={setLevel} />
      }
      case 'corpus': {
        const kb = bySlug(route.slug)
        if (!kb) return <Empty>No corpus called {route.slug}.</Empty>
        return <Corpus slug={route.slug} tab={route.tab} lessons={lessons} onChanged={reloadKBs} />
      }
      case 'xray': {
        const kb = bySlug(traceKB)
        return kb
          ? <Xray kb={kb} traceId={route.id} stage={route.stage} lessons={lessons}
              level={level} onLevel={setLevel} />
          : <Empty>Loading the trace…</Empty>
      }
      case 'compare': {
        const drawerKB = bySlug(drawer?.slug)
        return (
          <div className="flex min-h-0 grow">
            <div className="scrollthin min-w-0 grow overflow-y-auto">
              <Compare kbs={kbs} onPath={(slug, path) => setDrawer({ slug, path })} />
            </div>
            {drawer && drawerKB && (
              <div className="hidden lg:block">
                <SourceDrawer kb={drawerKB} path={drawer.path} onClose={() => setDrawer(null)} />
              </div>
            )}
          </div>
        )
      }
      case 'evaluate':
        return (
          <div className="scrollthin grow overflow-y-auto">
            <Evaluate kbs={kbs} lessons={lessons} />
          </div>
        )
      case 'findings':
        return (
          <div className="scrollthin grow overflow-y-auto">
            <Findings lessons={lessons} level={level} onLevel={setLevel} />
          </div>
        )
      case 'history':
        return <History kbs={kbs} />
      case 'settings':
        return <SettingsScreen />
      case 'api':
        return (
          <div className="scrollthin grow overflow-y-auto">
            <Integrations kbs={kbs} />
          </div>
        )
      case 'corpora':
        return <Corpora kbs={kbs} onChanged={reloadKBs} />
      default:
        return <Dashboard />
    }
  }

  const needsLevel = ['xray', 'findings', 'retrieval', 'chat'].includes(route.name)

  return (
    <>
      <Unlock />
      <Shell hash={hash} kbs={kbs} activeKB={activeKB}>
      {needsLevel && (
        <div className="hidden justify-end border-b border-rule bg-surface px-4 py-[6px] lg:flex">
          {levelPicker}
        </div>
      )}
      {body()}
      </Shell>
    </>
  )
}
