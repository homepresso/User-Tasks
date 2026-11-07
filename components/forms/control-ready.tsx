'use client'

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ControlReadyGate, READY_WAIT_MS } from '@/lib/forms/custom-controls/loading'
import { frameUrl } from '@/lib/forms/custom-controls/frame'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { useFormLookupSource } from './lookup-field'

/**
 * Holds a form part (a FormGrid: one page, a section, the whole form) back
 * until its custom controls have painted — at most READY_WAIT_MS — so the
 * person sees the form appear once, complete, with no "Loading…" labels and
 * no fields jumping (lib/forms/custom-controls/loading.ts). The part is laid
 * out the whole time (opacity, not display), so the control frames load in
 * parallel with everything else. Parts without controls are never held.
 */

interface GateApi { register: (id: string) => void; ready: (id: string) => void; unregister: (id: string) => void }

const GateContext = createContext<GateApi | null>(null)

export function ControlReadyBoundary({ children, className }: { children: React.ReactNode; className?: string }) {
  const [hidden, setHidden] = useState(false)
  // One gate per boundary, and the context talks to that same object (a ref, not a state initializer
  // that development double rendering may call twice).
  const gateRef = useRef<ControlReadyGate | null>(null)
  /* eslint-disable react-hooks/refs -- lazy one-time init of the gate (React docs: "Avoiding recreating the ref contents") */
  if (!gateRef.current) gateRef.current = new ControlReadyGate({ onReveal: () => setHidden(false) })
  const gate = gateRef.current
    /* eslint-enable react-hooks/refs */
  // Children's layout effects (registration) run before ours: hide before the first paint, or settle.
  useLayoutEffect(() => {
    if (gate.waiting) setHidden(true)
    else gate.settle()
  }, [gate])
  const api = useMemo<GateApi>(() => ({ register: (id) => gate.register(id), ready: (id) => gate.ready(id), unregister: (id) => gate.unregister(id) }), [gate])
  return (
    <GateContext.Provider value={api}>
      <div className={className} style={{ opacity: hidden ? 0 : undefined, transition: hidden ? 'none' : 'opacity var(--fm-gate-dur, 120ms) var(--ds-ease-out)' }} aria-busy={hidden || undefined} data-control-gate data-controls-ready={hidden ? 'false' : 'true'}>
        {children}
      </div>
    </GateContext.Provider>
  )
}

/**
 * A control in a boundary: registers before the first paint, `ready()` when it
 * has painted. `late` turns true once the bounded wait is over and it is still
 * loading (show the input-shaped skeleton).
 */
export function useControlReady(id: string, ready: boolean): { late: boolean } {
  const gate = useContext(GateContext)
  const [late, setLate] = useState(false)
  const readyRef = useRef(ready)
  // eslint-disable-next-line react-hooks/refs -- the latest `ready` for the layout effect below (no re-registration)
  readyRef.current = ready
  useLayoutEffect(() => {
    // (Registered again after it was ready — a re-mount: it does not hold the form.)
    if (!readyRef.current) gate?.register(id)
    return () => gate?.unregister(id)
  }, [gate, id])
  useEffect(() => {
    if (ready) { gate?.ready(id); setLate(false); return }
    const timer = window.setTimeout(() => setLate(true), READY_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [gate, id, ready])
  return { late }
}

/** The skeleton of a control still loading after the wait: the outline of a native input, softly pulsing. */
export function ControlSkeleton({ height }: { height: number }) {
  return (
    <div
      aria-hidden
      data-control-skeleton
      className="pointer-events-none absolute inset-x-0 top-0 rounded-[var(--ds-radius-input)] border border-input-border bg-input motion-safe:animate-pulse"
      style={{ height }}
    />
  )
}

/**
 * Warms the browser cache with the frame documents of controls the person
 * will meet later (other steps / tabs), once the current part has had its
 * turn. Each is a hidden, equally sandboxed frame without a bridge channel:
 * the module loads but no element is created and nothing is posted, and the
 * frame is dropped as soon as it has loaded. Never shared with the real
 * control (that one is a frame of its own with its own channel).
 */
export function ControlPrewarm({ fields }: { fields: TaskFieldDef[] }) {
  const source = useFormLookupSource()
  const [go, setGo] = useState(false)
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    const timer = window.setTimeout(() => setGo(true), READY_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [])
  const task = source?.kind === 'task' ? source.taskId : null
  const urls = [...new Set(fields.filter((f) => f.type === 'custom' && f.custom).map((f) => frameUrl(f.custom!.tag, f.custom!.version, { task })))]
  const todo = urls.filter((u) => !loaded.has(u)).slice(0, 6)
  if (!go || !todo.length) return null
  return (
    <div hidden aria-hidden data-control-prewarm>
      {todo.map((url) => (
        <iframe key={url} src={url} title="" tabIndex={-1} sandbox="allow-scripts" referrerPolicy="no-referrer" allow=""
          onLoad={() => setLoaded((prev) => new Set(prev).add(url))} />
      ))}
    </div>
  )
}
