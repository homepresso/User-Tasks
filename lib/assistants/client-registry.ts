/**
 * AI assistants, browser side: what is on screen, for the assistant host
 * (components/assistants/assistant-host.tsx). A small external store —
 *
 *  - surface: the page says what it is (a form being filled, a task) via
 *    useAssistantSurface; builder pages are recognised by their path, and
 *    editors can describe the open item (useDesignerContext);
 *  - form bridge: the editable form renderer (components/forms/form-renderer
 *    FormGridBody) registers how to read the live form (fields, values,
 *    visibility, read-only, errors) and how to set a value through the
 *    form's own change handler (form rules and validation run). The latest
 *    registration wins; unmounting removes it.
 *
 * Client-safe; no React import beyond the hooks below.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { AssistantEvent, DesignerContext, FormSnapshot } from './types'

export type AssistantSurface =
  | { kind: 'form'; formId: string; title?: string | null }
  | { kind: 'task'; taskId: string; title?: string | null }

export interface FormBridge {
  snapshot: () => FormSnapshot
  /** Set one value as if the person typed it. Refused (ok: false) when the field is hidden, read-only, secret or the value is invalid. */
  apply: (key: string, value: unknown) => { ok: true } | { ok: false; reason: string }
}

interface State {
  surfaces: Array<{ id: number; surface: AssistantSurface }>
  bridges: Array<{ id: number; bridge: FormBridge }>
  designer: Array<{ id: number; context: DesignerContext }>
}

let state: State = { surfaces: [], bridges: [], designer: [] }
let nextId = 1
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function registerSurface(surface: AssistantSurface): () => void {
  const id = nextId++
  set({ ...state, surfaces: [...state.surfaces, { id, surface }] })
  return () => set({ ...state, surfaces: state.surfaces.filter((s) => s.id !== id) })
}

export function registerFormBridge(bridge: FormBridge): () => void {
  const id = nextId++
  set({ ...state, bridges: [...state.bridges, { id, bridge }] })
  return () => set({ ...state, bridges: state.bridges.filter((b) => b.id !== id) })
}

export function registerDesignerContext(context: DesignerContext): () => void {
  const id = nextId++
  set({ ...state, designer: [...state.designer, { id, context }] })
  return () => set({ ...state, designer: state.designer.filter((d) => d.id !== id) })
}

/** The latest form bridge (null: no form on screen). */
export function currentFormBridge(): FormBridge | null {
  return state.bridges.length ? state.bridges[state.bridges.length - 1].bridge : null
}

const getSurface = () => (state.surfaces.length ? state.surfaces[state.surfaces.length - 1].surface : null)
const getDesigner = () => (state.designer.length ? state.designer[state.designer.length - 1].context : null)
const getHasForm = () => state.bridges.length > 0

export function useCurrentSurface(): AssistantSurface | null {
  return useSyncExternalStore(subscribe, getSurface, () => null)
}

export function useRegisteredDesignerContext(): DesignerContext | null {
  return useSyncExternalStore(subscribe, getDesigner, () => null)
}

export function useHasFormBridge(): boolean {
  return useSyncExternalStore(subscribe, getHasForm, () => false)
}

/** A page announces what it is (a form being filled, a task). */
export function useAssistantSurface(surface: AssistantSurface | null) {
  const key = surface ? `${surface.kind}:${surface.kind === 'form' ? surface.formId : surface.taskId}:${surface.title ?? ''}` : ''
  useEffect(() => {
    if (!surface) return
    return registerSurface(surface)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the surface's identity
  }, [key])
}

/** An editor describes the open item (id, name, unsaved changes) for the designer assistant. */
export function useDesignerContext(context: DesignerContext | null) {
  const key = context ? JSON.stringify(context) : ''
  useEffect(() => {
    if (!context) return
    return registerDesignerContext(context)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the context's JSON
  }, [key])
}

/* ── Changes the designer assistant made ── */

export const ASSISTANT_CHANGED_EVENT = 'usertasks:assistant-changed'
export type AssistantChange = Extract<AssistantEvent, { type: 'changed' }>

export function announceChange(change: AssistantChange) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AssistantChange>(ASSISTANT_CHANGED_EVENT, { detail: change }))
}

/** Run `onChange` when the assistant changed something (an editor reloads its item). */
export function useAssistantChanges(onChange: (change: AssistantChange) => void) {
  useEffect(() => {
    const handler = (e: Event) => onChange((e as CustomEvent<AssistantChange>).detail)
    window.addEventListener(ASSISTANT_CHANGED_EVENT, handler)
    return () => window.removeEventListener(ASSISTANT_CHANGED_EVENT, handler)
  }, [onChange])
}
