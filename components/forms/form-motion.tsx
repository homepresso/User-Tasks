'use client'

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { confettiPieces, formAnimation, motionLevel, type FormMotionLevel, type ResolvedFormAnimation } from '@/lib/forms/motion'
import type { FormLayout } from '@/lib/forms/layout'
import { useFormRuntime } from './form-runtime'

/**
 * Form animations at run time (lib/forms/motion.ts; the motion itself is
 * CSS in app/form-motion.css). Components put `motionAttrs(level)` on their
 * root (the theme scope's card, the grid, the pager, the banner stack, the
 * Submitted page) so the CSS knows the level, and mark what animates with
 * `data-fm…` attributes.
 *
 * Nothing here delays input or focus: elements are in place and
 * interactive from the first frame; only their opacity / transform animate
 * (and the row height of a collapse).
 */

const ScopeMotion = createContext<ResolvedFormAnimation | null>(null)

/** The form's animation for the parts drawn around the fields (FormThemeScope provides it). */
export function FormMotionProvider({ value, children }: { value: ResolvedFormAnimation | null | undefined; children: React.ReactNode }) {
  return value ? <ScopeMotion.Provider value={value}>{children}</ScopeMotion.Provider> : <>{children}</>
}

const query = '(prefers-reduced-motion: reduce)'
function subscribe(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(query)
  mq.addEventListener?.('change', cb)
  return () => mq.removeEventListener?.('change', cb)
}

/** The person prefers reduced motion (false on the server: the CSS media query covers the first paint). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches), () => false)
}

export interface FormMotion extends ResolvedFormAnimation {
  level: FormMotionLevel
  /** Something animates (not None). */
  on: boolean
}

/** The form's animation: the theme scope's, else this layout's, else the runtime's layout (default Subtle). */
export function useFormMotion(layout?: FormLayout | null): FormMotion {
  const scope = useContext(ScopeMotion)
  const runtime = useFormRuntime()
  const reduced = usePrefersReducedMotion()
  const resolved = scope ?? formAnimation(layout ?? runtime?.layout ?? null)
  const level = motionLevel(resolved.style, reduced)
  const { style, confetti } = resolved
  return useMemo(() => ({ style, confetti, level, on: level !== 'none' }), [style, confetti, level])
}

/** The attributes the CSS keys off. */
export function motionAttrs(level: FormMotionLevel): { 'data-form-motion': FormMotionLevel; 'data-fm-on'?: '' } {
  return level === 'none' ? { 'data-form-motion': level } : { 'data-form-motion': level, 'data-fm-on': '' }
}

/* ── Containers and cells ────────────────────────────────────────────── */

/**
 * A container cells animate relative to (a grid, a lazy part, a step
 * body): `settled` once it has painted. A cell that mounts into a settled
 * container was shown later (a rule, a section added) and reveals; one that
 * mounts with its container enters with it (staggered on the form's first
 * load, otherwise the container's own animation covers it).
 */
interface MotionContainer { settled: boolean; entering: boolean }
const ContainerContext = createContext<MotionContainer | null>(null)
const EnteringContext = createContext<boolean | null>(null)

/** True after the first paint. */
export function useSettled(): boolean {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return settled
}

/**
 * The form's first load (FormRenderer's root): true until the entrance has
 * had time to run. Nested renderers share the outermost one's flag.
 */
export function FormEnteringScope({ children }: { children: React.ReactNode }) {
  const outer = useContext(EnteringContext)
  const [entering, setEntering] = useState(true)
  useEffect(() => {
    if (outer !== null) return
    const t = window.setTimeout(() => setEntering(false), 700)
    return () => window.clearTimeout(t)
  }, [outer])
  if (outer !== null) return <>{children}</>
  return <EnteringContext.Provider value={entering}>{children}</EnteringContext.Provider>
}

/** Cells under this container enter with it on the form's first load (`entering`), or not at all. */
export function MotionContainerScope({ children, entering }: { children: React.ReactNode; entering?: boolean }) {
  const settled = useSettled()
  const formEntering = useContext(EnteringContext)
  const value = useMemo(() => ({ settled, entering: Boolean(entering && formEntering) }), [settled, entering, formEntering])
  return <ContainerContext.Provider value={value}>{children}</ContainerContext.Provider>
}

export type CellMotion = 'enter' | 'reveal' | 'exit' | null

/** How a cell animates, fixed when it mounts. */
export function useCellMotion(on: boolean): Exclude<CellMotion, 'exit'> {
  const container = useContext(ContainerContext)
  const [mode] = useState<Exclude<CellMotion, 'exit'>>(() => (!on || !container ? null : container.settled ? 'reveal' : container.entering ? 'enter' : null))
  return mode
}

/**
 * Keys that have just left `keys` (hidden by a rule): kept `ms` longer so
 * they can collapse out. Off → always empty.
 */
export function useExitingKeys(keys: string[], enabled: boolean, ms: number): ReadonlySet<string> {
  const joined = keys.join('\n')
  const [prev, setPrev] = useState(joined)
  const [exiting, setExiting] = useState<ReadonlySet<string>>(() => new Set())
  if (prev !== joined) {
    setPrev(joined)
    const now = new Set(keys)
    const gone = enabled ? prev.split('\n').filter((k) => k && !now.has(k)) : []
    const back = [...exiting].filter((k) => now.has(k))
    if (gone.length || back.length || (!enabled && exiting.size)) {
      const next = new Set(enabled ? exiting : [])
      for (const k of gone) next.add(k)
      for (const k of back) next.delete(k)
      setExiting(next)
    }
  }
  useEffect(() => {
    if (!exiting.size) return
    const t = window.setTimeout(() => setExiting(new Set()), ms)
    return () => window.clearTimeout(t)
  }, [exiting, ms])
  return exiting
}

/** The stagger slot as a CSS variable. */
export function staggerStyle(index: number | undefined): React.CSSProperties | undefined {
  return index === undefined ? undefined : ({ '--fm-i': index } as React.CSSProperties)
}

/* ── Submitted page ──────────────────────────────────────────────────── */

const PIECES = confettiPieces(18)

/** A light, pure-CSS confetti burst behind the Submitted page's icon (decorative; Expressive only). */
export function ConfettiBurst() {
  return (
    <span aria-hidden className="fm-confetti" data-fm-confetti>
      {PIECES.map((p, i) => (
        <span key={i} className={p.round ? 'fm-confetti-piece fm-confetti-dot' : 'fm-confetti-piece'} data-c={p.color}
          style={{ left: `${p.x}%`, width: p.size, height: p.round ? p.size : Math.round(p.size * 0.45), '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--r': `${p.rotate}deg`, animationDelay: `${p.delay}ms` } as React.CSSProperties} />
      ))}
    </span>
  )
}
