'use client'

/**
 * Top-bar breadcrumbs (docs/design/ui-polish-spec.md §4.2). The dashboard
 * shell derives a trail from the route (lib/page-title ROUTES); a page
 * refines it with the object's name:
 *
 *   <PageHeader breadcrumbs={[{ label: 'Workflows', href: '/automations' }, { label: wf.name }]} … />
 *   // or, without a PageHeader:
 *   usePageBreadcrumbs([{ label: 'Workflows', href: '/automations' }, { label: wf.name }])
 *
 * The trail also names the browser tab ("Invoice approval · Workflows · UserTasks").
 * Outside the shell (public pages, tests) the hooks do nothing.
 */
import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react'
import type { Crumb } from './page-title'

export type { Crumb } from './page-title'

type SetCrumbs = (owner: string, crumbs: Crumb[] | null) => void

// Two contexts: the setter is stable, so reporting a trail never re-runs effects.
const SetterContext = createContext<SetCrumbs | null>(null)
const OverrideContext = createContext<Crumb[] | null>(null)

export function BreadcrumbsProvider({ children, resetKey }: { children: ReactNode; resetKey?: string }) {
  const [state, setState] = useState<{ owner: string; crumbs: Crumb[] } | null>(null)
  // A new route starts from its own trail.
  const [lastKey, setLastKey] = useState(resetKey)
  if (resetKey !== lastKey) {
    setLastKey(resetKey)
    setState(null)
  }
  const set = useCallback<SetCrumbs>((owner, crumbs) => setState((current) => {
    if (crumbs === null) return current?.owner === owner ? null : current
    if (current && current.owner === owner && sameCrumbs(current.crumbs, crumbs)) return current
    return { owner, crumbs }
  }), [])
  return (
    <SetterContext.Provider value={set}>
      <OverrideContext.Provider value={state?.crumbs ?? null}>{children}</OverrideContext.Provider>
    </SetterContext.Provider>
  )
}

function sameCrumbs(a: Crumb[], b: Crumb[]) {
  return a.length === b.length && a.every((c, i) => c.label === b[i].label && c.href === b[i].href)
}

/** True inside the dashboard shell (PageHeader then leaves its breadcrumbs to the top bar). */
export function useInShellBreadcrumbs(): boolean {
  return useContext(SetterContext) !== null
}

/** The page's own trail (null: use the route's). */
export function useBreadcrumbOverride(): Crumb[] | null {
  return useContext(OverrideContext)
}

/**
 * Report this page's breadcrumbs to the top bar (string labels only; the last
 * one is the current page). Pass null / [] to keep the route's trail.
 */
export function usePageBreadcrumbs(crumbs: readonly Crumb[] | null | undefined) {
  const set = useContext(SetterContext)
  const owner = useId()
  const key = crumbs && crumbs.length ? JSON.stringify(crumbs.map((c) => [c.label, c.href ?? null])) : ''
  useEffect(() => {
    if (!set) return
    if (!key) return
    const parsed = (JSON.parse(key) as Array<[string, string | null]>).map(([label, href]) => (href ? { label, href } : { label }))
    set(owner, parsed)
    return () => set(owner, null)
  }, [set, owner, key])
}
