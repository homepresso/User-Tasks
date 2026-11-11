'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import {
  applyDynamicValues, bindingInputs, bindingReadsUser, blankInputsBehaviour, coerceDynamicValue, expectedType, isSourceBinding, resolveExpression, restrictsToList, staleChoiceValue,
  type DynamicBinding, type DynamicValueType,
} from '@/lib/forms/dynamic-values'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { formApiHeaders, formApiUrl, isAnonymousSource, useFormLookupSource, type FormLookupSource } from './lookup-field'

/**
 * Dynamic properties at run time (lib/forms/dynamic-values.ts): the form's
 * fields with their bound properties resolved.
 *
 *  - Expressions resolve here, on every change of what they read.
 *  - Data table / API reference bindings are fetched from the server
 *    (/api/…/forms/dynamic-value — the binding is read from the saved form
 *    there), debounced, cached per form, field, property and inputs, and
 *    fetched again when a parameter / variable / field they read changes.
 *  - While a source loads, or when it fails, the static value stays in place;
 *    choice options say so (FieldControl reads useDynamicStatus).
 *  - A bound default fills the field while it is empty (or still holds the
 *    previous bound default) — never over what the person typed.
 *  - Fields of a part that has not loaded yet (`deferred`, lib/forms/lazy-load.ts)
 *    resolve their bound default only — the rest waits until the part loads.
 *  - Public links: a source without "Allow anonymous read" is not asked for
 *    (it resolves empty: options offer none, other properties keep the static value).
 */

export interface DynamicStatus { loading?: boolean; error?: string; empty?: boolean }
type StatusMap = Record<string, Record<string, DynamicStatus>>

const StatusContext = createContext<StatusMap>({})

/** A field property's load state (choice options show "Loading…" / "Couldn't load options"). */
export function useDynamicStatus(fieldKey: string, prop: string): DynamicStatus | undefined {
  return useContext(StatusContext)[fieldKey]?.[prop]
}

export function DynamicStatusProvider({ value, children }: { value: StatusMap; children: React.ReactNode }) {
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
}

const DEBOUNCE_MS = 250
const EMPTY: Record<string, unknown> = {}

function useDebounced<T>(value: T, key: string, ms: number): T {
  const [state, setState] = useState<{ key: string; value: T }>({ key, value })
  useEffect(() => {
    if (key === state.key) return
    const t = setTimeout(() => setState({ key, value }), ms)
    return () => clearTimeout(t)
  }, [key, value, ms, state.key])
  return state.value
}

interface SourceRequest { field: TaskFieldDef; prop: string; binding: DynamicBinding; expects: DynamicValueType; deps: Record<string, unknown> }

async function fetchDynamic(source: FormLookupSource, req: SourceRequest, signal?: AbortSignal): Promise<{ value: unknown; truncated?: boolean }> {
  const base = { field_key: req.field.key, prop: req.prop, values: req.deps }
  const body = source.kind === 'task' ? { task_id: source.taskId, ...base } : source.kind === 'form' ? { form_id: source.formId, ...base } : { field: req.field, ...base }
  const res = await fetch(formApiUrl(source, 'dynamic-value'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...formApiHeaders(source) },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal,
  })
  const json = await res.json().catch(() => null) as { value?: unknown; truncated?: boolean; error?: string } | null
  if (!res.ok) throw new Error(res.status === 429 ? 'Too many requests — wait a moment' : json?.error ?? "Couldn't load the value")
  return { value: json?.value, truncated: json?.truncated }
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

/**
 * The fields with their dynamic properties resolved, the load state per
 * field and property, and (with `onChange`) bound defaults applied to empty
 * fields. Forms without bindings get their fields back as they are.
 */
export function useDynamicFields(fields: TaskFieldDef[], values: Record<string, unknown>, onChange?: (key: string, value: unknown) => void, live = true, deferred?: ReadonlySet<string>): { fields: TaskFieldDef[]; status: StatusMap } {
  // Read-only views (a completed task) show what was answered: sources are not asked again.
  const source = useFormLookupSource()
  const anonymous = isAnonymousSource(source)
  const bound = useMemo(() => {
    const out: Array<{ field: TaskFieldDef; prop: string; binding: DynamicBinding; expects: DynamicValueType }> = []
    for (const field of fields) {
      // When to load (lib/forms/lazy-load.ts): a field of a part not loaded yet resolves only its bound default (a value).
      const waiting = deferred?.has(field.key) ?? false
      for (const [prop, binding] of Object.entries(field.dynamic ?? {})) {
        if (waiting && prop !== 'default') continue
        const expects = expectedType(field, prop, binding)
        if (expects) out.push({ field, prop, binding, expects })
      }
    }
    return out
  }, [fields, deferred])
  const needsUser = !anonymous && bound.some((b) => b.binding.kind === 'expr' && bindingReadsUser(b.binding))
  const { data: user = null } = useQuery({
    queryKey: ['form-rule-user'],
    enabled: needsUser,
    staleTime: 5 * 60_000,
    queryFn: async () => ((await serverRead('forms.ruleUser')).data ?? null) as { id?: string; email?: string; name?: string } | null,
  })

  // Sources: what each reads, debounced; one cached query per form / field / property / inputs.
  const sources = useMemo(() => (live ? bound.filter((b) => isSourceBinding(b.binding)) : []), [bound, live])
  const depsNow = sources.map((b) => bindingInputs(b.binding, values))
  const depsKey = JSON.stringify(depsNow)
  const deps = useDebounced(depsNow, depsKey, DEBOUNCE_MS)
  const sourceKey = source ? (source.kind === 'task' ? `task:${source.taskId}` : source.kind === 'form' ? `form:${source.formId}${anonymous ? ':anon' : ''}` : 'preview') : 'none'
  const results = useQueries({
    queries: sources.map((b, i) => {
      // A cascade's parent not chosen yet: options aren't asked for (cleared or kept).
      const blocked = (anonymous && isSourceBinding(b.binding) && b.binding.anonymous_read !== true) || (b.prop === 'options' && blankInputsBehaviour(b.binding, deps[i] ?? EMPTY) !== null)
      const req: SourceRequest = { ...b, deps: deps[i] ?? EMPTY }
      return {
        queryKey: ['form-dynamic-value', sourceKey, b.field.key, b.prop, source?.kind === 'preview' ? JSON.stringify(b.binding) : '', JSON.stringify(req.deps)],
        enabled: Boolean(source) && !blocked,
        staleTime: 60_000,
        retry: 1,
        queryFn: ({ signal }: { signal?: AbortSignal }) => fetchDynamic(source!, req, signal),
      }
    }),
  })

  const scope = useMemo(() => ({ values, user, now: new Date() }), [values, user])
  const resolved = useMemo(() => {
    const out: Record<string, Record<string, unknown>> = {}
    const status: StatusMap = {}
    const set = (key: string, prop: string, value: unknown) => { (out[key] ??= {})[prop] = value }
    const mark = (key: string, prop: string, s: DynamicStatus) => { (status[key] ??= {})[prop] = s }
    for (const b of bound) {
      if (b.binding.kind !== 'expr') continue
      const coerced = coerceDynamicValue(b.expects, resolveExpression(b.binding.expr, scope))
      if (coerced.ok) set(b.field.key, b.prop, coerced.value)
      else mark(b.field.key, b.prop, { error: coerced.error })
    }
    sources.forEach((b, i) => {
      if (!source) return
      if (anonymous && isSourceBinding(b.binding) && b.binding.anonymous_read !== true) {
        // Not readable by anonymous visitors: empty options, the static value elsewhere.
        set(b.field.key, b.prop, b.prop === 'options' ? [] : undefined)
        mark(b.field.key, b.prop, { empty: true })
        return
      }
      const blank = b.prop === 'options' ? blankInputsBehaviour(b.binding, values) : null
      if (blank === 'clear') { set(b.field.key, b.prop, []); mark(b.field.key, b.prop, { empty: true }); return }
      if (blank === 'keep') return
      const r = results[i]
      if (r?.data) {
        set(b.field.key, b.prop, r.data.value)
        if (isBlank(r.data.value)) mark(b.field.key, b.prop, { empty: true })
      } else if (r?.error) mark(b.field.key, b.prop, { error: r.error instanceof Error ? r.error.message : "Couldn't load" })
      else mark(b.field.key, b.prop, { loading: true })
    })
    return { out, status }
  }, [bound, sources, results, scope, source, anonymous])
  const resolvedKey = JSON.stringify(resolved.out)
  const statusKey = JSON.stringify(resolved.status)

  const next = useMemo(() => {
    if (!bound.length) return fields
    return fields.map((f) => (resolved.out[f.key] ? applyDynamicValues(f, resolved.out[f.key]) : f))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- resolvedKey stands for resolved.out
  }, [fields, resolvedKey, bound.length])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- statusKey stands for resolved.status
  const status = useMemo(() => resolved.status, [statusKey])

  // Bound defaults: fill an empty field (or one still holding the previous bound default) — again after it is emptied (a List's Add resets its inputs).
  const emptiedKey = Object.keys(resolved.out).filter((k) => Object.prototype.hasOwnProperty.call(resolved.out[k], 'default') && isBlank(values[k])).join('|')
  const applied = useRef<Record<string, string>>({})
  const valuesRef = useRef(values)
  valuesRef.current = values
  useEffect(() => {
    if (!onChange) return
    for (const [key, props] of Object.entries(resolved.out)) {
      if (!Object.prototype.hasOwnProperty.call(props, 'default') || props.default === undefined) continue
      const text = JSON.stringify(props.default)
      const current = valuesRef.current[key]
      const previous = applied.current[key]
      // Applied before and still there (or changed by the person): leave it. Emptied (an "Add row" reset): apply again.
      if (previous === text && !isBlank(current)) continue
      if (isBlank(current) || (previous !== undefined && JSON.stringify(current) === previous)) {
        applied.current[key] = text
        onChange(key, props.default)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- resolvedKey stands for resolved.out; emptiedKey re-runs it when a bound field is emptied
  }, [resolvedKey, onChange, emptiedKey])

  // Cascades: a dependent choice's value its new options no longer offer is cleared (a valid one — a draft's,
  // a prefilled one — is kept). Only once the options are in (never while they load or failed).
  useEffect(() => {
    if (!onChange) return
    for (const b of sources) {
      if (b.prop !== 'options' || (b.field.type !== 'choice' && b.field.type !== 'multi_choice') || !restrictsToList(b.binding)) continue
      const s = resolved.status[b.field.key]?.options
      if (s?.loading || s?.error) continue
      const options = resolved.out[b.field.key]?.options
      if (options === undefined) continue
      const fixed = staleChoiceValue(b.field.type, valuesRef.current[b.field.key], options)
      if (fixed !== undefined) onChange(b.field.key, fixed)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- resolvedKey / statusKey stand for resolved
  }, [resolvedKey, statusKey, onChange])

  return { fields: next, status }
}
