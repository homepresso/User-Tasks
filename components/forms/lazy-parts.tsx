'use client'

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { FORM_STATE_KEY, applyLoaded, readFormState } from '@/lib/forms/form-state'
import {
  lazyParts, loadedTargets, newlyLoaded, partsHoldingFields, partsToLoad, preloadFieldKeys, unloadedFieldKeys, type LazyPart,
} from '@/lib/forms/lazy-load'
import type { FormLayout } from '@/lib/forms/layout'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { useFormRules } from './form-rules-runtime'
import { useFormRuntime } from './form-runtime'
import { useFormPager } from './form-pages'
import { MotionContainerScope } from './form-motion'

/**
 * When to load at run time (lib/forms/lazy-load.ts).
 *
 *  - LazyPartsProvider (FormRenderer): which fields are not mounted yet,
 *    whether the form is idle (background preload), and `load(targets)`,
 *    which writes the state's `loaded` list through the surface's onChange
 *    (presentation only, like a collapsed section).
 *  - LazyLoadController (editable forms with lazy parts): opens a "when
 *    first shown" tab / step when it becomes current; loads the parts a
 *    submit must check (registered with the runtime: FormButtonBar and a
 *    whole-form Validate call it) and any part an error points into;
 *    dispatches "Section / tab loaded" for every part that loads.
 *  - LazyPartPlaceholder: the skeleton a part shows until it loads (a
 *    "when first shown" section loads when it scrolls into view —
 *    IntersectionObserver — which also covers expanding a collapsed one).
 *  - LazyReveal: the loaded part fades in.
 */

export interface LazyApi {
  /** Field keys whose controls must not mount yet. */
  unloaded: ReadonlySet<string>
  /** The form's lazy parts (by target). */
  parts: ReadonlyMap<string, LazyPart>
  /** Loaded lazy targets. */
  loaded: ReadonlySet<string>
  /** Background preload may start (the visible part is idle). */
  idle: boolean
  load: (targets: string[]) => void
}

const LazyContext = createContext<LazyApi | null>(null)

export function useLazyParts(): LazyApi | null {
  return useContext(LazyContext)
}

/** True once the browser is idle after mount (requestIdleCallback; a timeout where it is missing). */
export function useIdle(enabled: boolean): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (!enabled || idle) return
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setIdle(true), { timeout: 3000 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = window.setTimeout(() => setIdle(true), 1200)
    return () => window.clearTimeout(t)
  }, [enabled, idle])
  return idle
}

/**
 * The lazy state of a form for FormRenderer: `deferred` are the field keys
 * whose expensive work waits (unloaded, minus parts being preloaded once
 * idle). Read-only views and forms without lazy parts defer nothing.
 */
export function useLazyState(layout: FormLayout | null | undefined, values: Record<string, unknown>, onChange: ((key: string, value: unknown) => void) | undefined, editable: boolean) {
  const parts = useMemo(() => new Map((editable ? lazyParts(layout) : []).map((p) => [p.target, p])), [layout, editable])
  const active = parts.size > 0
  const state = values[FORM_STATE_KEY]
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the loaded list is all that matters here
  const loaded = useMemo(() => (active ? loadedTargets(values) : new Set<string>()), [active, JSON.stringify((state as { loaded?: unknown } | undefined)?.loaded ?? null)])
  const unloaded = useMemo(() => (active ? unloadedFieldKeys(layout, { [FORM_STATE_KEY]: { loaded: [...loaded] } }) : new Set<string>()), [active, layout, loaded])
  const idle = useIdle(active && [...parts.values()].some((p) => p.preload))
  const deferred = useMemo(() => {
    if (!idle) return unloaded
    const warm = preloadFieldKeys(layout, { [FORM_STATE_KEY]: { loaded: [...loaded] } })
    return new Set([...unloaded].filter((k) => !warm.has(k)))
  }, [idle, unloaded, layout, loaded])
  const latest = useRef({ layout, values, onChange })
  useLayoutEffect(() => { latest.current = { layout, values, onChange } })
  const api = useMemo<LazyApi | null>(() => (active ? {
    unloaded, parts, loaded, idle,
    load: (targets) => {
      const { layout: l, values: v, onChange: change } = latest.current
      const current = readFormState(l, v)
      const next = applyLoaded(current, targets.filter((t) => parts.has(t)))
      if (next === current || !change) return
      // Later writes in the same tick see this one.
      latest.current = { ...latest.current, values: { ...v, [FORM_STATE_KEY]: next } }
      change(FORM_STATE_KEY, next)
    },
  } : null), [active, unloaded, parts, loaded, idle])
  return { api, deferred }
}

export function LazyPartsProvider({ value, children }: { value: LazyApi | null; children: React.ReactNode }) {
  return <LazyContext.Provider value={value}>{children}</LazyContext.Provider>
}

/**
 * Editable forms with lazy parts: tab / step "when first shown", submit
 * loading, errors loading their parts, and "Section / tab loaded" events.
 * `isHidden(key)`: the form's visibility (hidden fields are not required).
 */
export function LazyLoadController({ fields, layout, errors, values, isHidden }: {
  fields: TaskFieldDef[]
  layout: FormLayout | null | undefined
  errors?: Record<string, string>
  values: Record<string, unknown>
  isHidden: (key: string) => boolean
}) {
  const lazy = useLazyParts()
  const registry = useFormRuntime()?.lazy
  const pager = useFormPager()
  const rules = useFormRules()
  const latest = useRef({ lazy, values, isHidden, fields, layout })
  useLayoutEffect(() => { latest.current = { lazy, values, isHidden, fields, layout } })

  // A "when first shown" step / tab loads when it becomes the current one.
  const currentId = pager?.currentId
  const currentPart = currentId ? lazy?.parts.get(`page:${currentId}`) : undefined
  const currentLoaded = currentPart ? lazy?.loaded.has(currentPart.target) : true
  useEffect(() => {
    if (currentPart && currentPart.load === 'visible' && !currentLoaded) latest.current.lazy?.load([currentPart.target])
  }, [currentPart, currentLoaded])

  // A submit (or a whole-form Validate) loads the shown parts holding required fields first.
  useEffect(() => {
    if (!registry) return
    // eslint-disable-next-line react-hooks/immutability -- the runtime's registry is a ref meant to be written (like FormRulesScope's rules.current)
    registry.current = {
      loadForSubmit: () => {
        const { lazy: api, isHidden: hidden, fields: list, layout: l } = latest.current
        if (!api) return
        const required = new Set(list.filter((f) => f.required).map((f) => f.key))
        const targets = partsToLoad(l, { [FORM_STATE_KEY]: { loaded: [...api.loaded] } }, hidden, (k) => required.has(k))
        if (targets.length) api.load(targets)
      },
      loadAll: () => {
        const api = latest.current.lazy
        const targets = api ? [...api.parts.keys()].filter((t) => !api.loaded.has(t)) : []
        if (api && targets.length) api.load(targets)
        return targets.length > 0
      },
    }
    // The browser's own Print (Ctrl+P): best effort — load what is left so a second print has it all.
    const beforePrint = () => { registry.current?.loadAll() }
    window.addEventListener('beforeprint', beforePrint)
    return () => { window.removeEventListener('beforeprint', beforePrint); registry.current = null }
  }, [registry])

  // An error on a field of an unloaded part (a submit, Next, a rule's error) loads that part, so the error shows.
  const errorKeys = Object.keys(errors ?? {}).filter((k) => errors?.[k]).join('|')
  useEffect(() => {
    const api = latest.current.lazy
    if (!api || !errorKeys) return
    const targets = partsHoldingFields(latest.current.layout, { [FORM_STATE_KEY]: { loaded: [...api.loaded] } }, errorKeys.split('|'))
    if (targets.length) api.load(targets)
  }, [errorKeys])

  // "Section / tab loaded": once per part, when it loads.
  const seen = useRef<Set<string> | null>(null)
  const loadedKey = lazy ? [...lazy.loaded].sort().join('|') : ''
  useEffect(() => {
    const now = new Set(loadedKey ? loadedKey.split('|') : [])
    const before = seen.current
    seen.current = now
    // What the form opens with (a draft reopened with parts loaded) is not a load.
    if (!before || !rules) return
    for (const target of newlyLoaded(before, now)) rules.dispatch({ type: 'part_loaded', target, context: { part: target } })
  }, [loadedKey, rules])
  return null
}

/**
 * What a part shows until it loads: its title and a few input-shaped bars
 * (aria-busy), about as tall as the controls will be (`height`:
 * estimatePartHeight) so the layout holds and a section further down is
 * not pulled into view. `onVisible`: called once when it scrolls into view
 * (a "when first shown" section).
 */
export function LazyPartPlaceholder({ title, rows = 3, height, onVisible, target }: { title?: string; rows?: number; height?: number; onVisible?: () => void; target: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const fired = useRef(false)
  const cb = useRef(onVisible)
  useLayoutEffect(() => { cb.current = onVisible })
  const watching = Boolean(onVisible)
  useEffect(() => {
    const el = ref.current
    if (!watching || !el) return
    const fire = () => { if (!fired.current) { fired.current = true; cb.current?.() } }
    if (typeof IntersectionObserver === 'undefined') { fire(); return }
    // Some area must show: a collapsed section's body (0 rows tall when animated, app/form-motion.css) only touches the viewport.
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting && e.intersectionRatio > 0)) { io.disconnect(); fire() } }, { rootMargin: '120px 0px', threshold: [0, 0.01] })
    io.observe(el)
    return () => io.disconnect()
  }, [watching])
  return (
    <div ref={ref} aria-busy="true" className="flex flex-col gap-3 py-1" style={height ? { minHeight: height } : undefined} data-lazy-placeholder={target}>
      {title && <p className="sr-only">{title}: loading</p>}
      {Array.from({ length: Math.max(1, Math.min(rows, 4)) }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-8 w-full rounded-[var(--ds-radius-input)]" />
        </div>
      ))}
    </div>
  )
}

/**
 * A part that has just loaded: its controls fade up as one (app/form-motion.css,
 * at the form's animation style; opacity only under reduced motion, nothing with None).
 * Its fields don't animate on their own — only those a rule shows later.
 */
export function LazyReveal({ target, children, className }: { target: string; children: React.ReactNode; className?: string }) {
  return (
    <MotionContainerScope>
      <div className={className} data-lazy-loaded={target}>
        {children}
      </div>
    </MotionContainerScope>
  )
}
