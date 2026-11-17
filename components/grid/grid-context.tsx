'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { LookupItem } from '@/lib/forms/lookup'
import { bindingCacheKey, bindingClientTtl, bindingRowDependencies, type GridColumnDef, type GridFileValue } from '@/lib/grid/column-model'

/**
 * What a grid surface gives the shared cell engine (components/grid/*):
 * how a bound column's options are fetched (forms: forms.lookup with the
 * key `<field>.<column>`; the Data grid: the view's options endpoint), how
 * a file / signature PNG is uploaded, who can be picked in a people cell,
 * and the locale for formatting. Everything security-relevant happens on
 * the server — the surface only names the column and sends the row.
 */
export interface GridOptionsRequest {
  column: string
  query: string
  /** Resolve these stored values to their labels instead of searching. */
  resolve?: string[]
  /** The row being edited ({{row.<column>}} in the binding's filters / inputs). */
  row: Record<string, unknown>
}

export interface GridOptionsResult { items: LookupItem[]; truncated?: boolean; too_short?: boolean }

export interface GridSurface {
  /** Distinguishes caches of different tables / forms. */
  scope: string
  fetchOptions?: (request: GridOptionsRequest, signal: AbortSignal) => Promise<GridOptionsResult>
  /** File cells: store one file; signature cells: store the PNG. Absent: those cells are read-only here. */
  upload?: (file: File | Blob, name: string, column: GridColumnDef) => Promise<GridFileValue>
  /** A signature as the surface stores it (forms: the Signature value of the form upload pipeline). */
  people?: Array<{ id: string; display_name: string | null; email: string | null }>
  locale?: string
  /** Forms: the signature pad uploads through the form's own pipeline (components/forms/signature-cell.tsx). */
  signatureUploadKey?: (column: GridColumnDef) => string
}

const GridSurfaceContext = createContext<GridSurface | null>(null)

export function GridSurfaceProvider({ value, children }: { value: GridSurface; children: React.ReactNode }) {
  return <GridSurfaceContext.Provider value={value}>{children}</GridSurfaceContext.Provider>
}

export function useGridSurface(): GridSurface | null {
  return useContext(GridSurfaceContext)
}

/* ── Option cache (per binding, per inputs, per typed text) ─────────── */

type Entry = { at: number; ttl: number; promise: Promise<GridOptionsResult> }
const cache = new Map<string, Entry>()
const MAX_ENTRIES = 300

/**
 * A cached request is shared by every cell / effect that asks for the same
 * key, so it never takes one caller's abort signal (a re-render would cancel
 * it for all): callers ignore results once their own effect is gone.
 */
function cached(key: string, ttl: number, run: () => Promise<GridOptionsResult>): Promise<GridOptionsResult> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise
  const promise = run().catch((err) => { cache.delete(key); throw err })
  cache.set(key, { at: Date.now(), ttl, promise })
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
  return promise
}

/** Forget cached options (tests; a view's bindings changed). */
export function clearGridOptionCache() {
  cache.clear()
}

/** The row values a binding reads (only its {{row.<column>}} inputs: other edits don't re-query). */
export function bindingInputs(col: GridColumnDef, row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(bindingRowDependencies(col.binding).map((k) => [k, row[k] ?? null]))
}

/**
 * A bound column's options: fetched lazily (when `enabled`), debounced while
 * typing, cached per binding + row inputs + text for the binding's TTL.
 */
export function useBoundOptions(col: GridColumnDef, row: Record<string, unknown>, query: string, enabled: boolean) {
  const surface = useGridSurface()
  const [state, setState] = useState<{ items: LookupItem[]; loading: boolean; error: string | null; truncated?: boolean; tooShort?: boolean }>({ items: [], loading: false, error: null })
  const inputs = bindingInputs(col, row)
  const inputKey = JSON.stringify(inputs)
  const debounce = col.binding?.debounce_ms ?? 250
  useEffect(() => {
    if (!enabled || !col.binding || !surface?.fetchOptions) return
    const controller = new AbortController()
    const key = bindingCacheKey(surface.scope, col.key, col.binding, inputs, query)
    setState((s) => ({ ...s, loading: true, error: null }))
    const t = setTimeout(() => {
      cached(key, bindingClientTtl(col.binding), () => surface.fetchOptions!({ column: col.key, query, row: { ...row } }, new AbortController().signal))
        .then((res) => { if (!controller.signal.aborted) setState({ items: res.items, loading: false, error: null, truncated: res.truncated, tooShort: res.too_short }) })
        .catch((err) => { if (!controller.signal.aborted) setState({ items: [], loading: false, error: err instanceof Error ? err.message : 'The options are not available right now' }) })
    }, query ? debounce : 0)
    return () => { clearTimeout(t); controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inputKey stands for the row inputs
  }, [enabled, col.key, col.binding, surface, query, inputKey, debounce])
  return state
}

/**
 * Labels of stored values of a bound column (display mode): one batched
 * `resolve` per column and value set, cached. Values without a label show
 * as they are.
 */
export function useBoundLabels(col: GridColumnDef, values: string[]): Map<string, string> {
  const surface = useGridSurface()
  const [labels, setLabels] = useState<Map<string, string>>(new Map())
  const wanted = useMemo(() => [...new Set(values.filter(Boolean))].sort().slice(0, 50), [values])
  const key = wanted.join('\u0001')
  useEffect(() => {
    if (!col.binding || !surface?.fetchOptions || !wanted.length) return
    const controller = new AbortController()
    cached(bindingCacheKey(surface.scope, col.key, col.binding, { resolve: key }, ''), bindingClientTtl(col.binding),
      () => surface.fetchOptions!({ column: col.key, query: '', resolve: wanted, row: {} }, new AbortController().signal))
      .then((res) => { if (!controller.signal.aborted) setLabels(new Map(res.items.map((i) => [i.value, i.label]))) })
      .catch(() => { /* values show as they are */ })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key stands for wanted
  }, [col.key, col.binding, surface, key])
  return labels
}

/** Labels for one row's cell (the editor shows the current value's label before the options load). */
export function useBoundLabel(col: GridColumnDef, value: unknown): string | null {
  const values = useMemo(() => (Array.isArray(value) ? value.map(String) : value === null || value === undefined || value === '' ? [] : [String(value)]), [value])
  const labels = useBoundLabels(col, values)
  if (!values.length) return null
  return values.map((v) => labels.get(v) ?? v).join(', ')
}

/** Shared label context for a whole page of rows: a grid gathers each bound column's values and resolves them once. */
const LabelsContext = createContext<Record<string, Map<string, string>> | null>(null)
export const GridLabelsProvider = LabelsContext.Provider
export function useGridLabels(column: string): Map<string, string> | null {
  return useContext(LabelsContext)?.[column] ?? null
}

/**
 * Labels for every bound column of a page of rows: one batched `resolve` per
 * column (cached), so a page of 100 rows costs one request per bound column.
 */
export function usePageLabels(columns: GridColumnDef[], rows: Array<Record<string, unknown>>, own?: GridSurface): Record<string, Map<string, string>> {
  // `own`: the surface of a grid that renders its own provider (it can't read it from context yet).
  const context = useGridSurface()
  const surface = own ?? context
  const [labels, setLabels] = useState<Record<string, Map<string, string>>>({})
  const wanted = useMemo(() => {
    const out: Array<{ col: GridColumnDef; values: string[] }> = []
    for (const col of columns) {
      if (!col.binding || col.hidden) continue
      const set = new Set<string>()
      for (const row of rows) {
        const v = row[col.key]
        for (const x of Array.isArray(v) ? v : [v]) if (x !== null && x !== undefined && x !== '' && typeof x !== 'object') set.add(String(x))
      }
      if (set.size) out.push({ col, values: [...set].sort().slice(0, 50) })
    }
    return out
  }, [columns, rows])
  const key = JSON.stringify(wanted.map((w) => [w.col.key, w.values]))
  useEffect(() => {
    if (!surface?.fetchOptions || !wanted.length) return
    const controller = new AbortController()
    for (const { col, values } of wanted) {
      cached(bindingCacheKey(surface.scope, col.key, col.binding, { resolve: values.join('\u0001') }, ''), bindingClientTtl(col.binding),
        () => surface.fetchOptions!({ column: col.key, query: '', resolve: values, row: {} }, new AbortController().signal))
        .then((res) => {
          if (controller.signal.aborted) return
          setLabels((prev) => {
            const have = prev[col.key]
            // Nothing new: keep the same state object (no re-render).
            if (have && res.items.every((i) => have.get(i.value) === i.label)) return prev
            return { ...prev, [col.key]: new Map([...(have ?? []), ...res.items.map((i) => [i.value, i.label] as [string, string])]) }
          })
        })
        .catch(() => { /* values show as they are */ })
    }
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key stands for wanted
  }, [surface, key])
  return labels
}
