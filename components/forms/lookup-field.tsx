'use client'

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import {
  lookupDebounceMs, lookupDependencyKeys, lookupFillValues, lookupMinChars, lookupValues, recheckedSelection, storedItemLabel, storedItemsByValue,
  type LookupItem,
} from '@/lib/forms/lookup'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { FloatingLayer } from '@/components/ui/floating-layer'
import { useFormRules } from './form-rules-runtime'
import { cn } from '@/lib/utils'

/**
 * Where a form's lookups get their suggestions: a real task (the server
 * reads the config from the task) or the designer's preview (the unsaved
 * config is sent; needs edit rights). No source → the control explains
 * that suggestions appear on the task.
 */
/** `anonymous`: a public form link (/p/<token>): requests go to /api/public/forms/<token>/… with the visit's upload key. */
export interface AnonymousFormSource { token: string; uploadKey: string }

export type FormLookupSource = { kind: 'task'; taskId: string } | { kind: 'form'; formId: string; anonymous?: AnonymousFormSource } | { kind: 'preview' }

/** The endpoint a form's server call goes to: the session one, or a public link's (anonymous visitors). */
export function formApiUrl(source: { kind: string; anonymous?: AnonymousFormSource } | null | undefined, path: string): string {
  if (source?.kind === 'form' && source.anonymous) return `/api/public/forms/${encodeURIComponent(source.anonymous.token)}/${path}`
  return `/api/internal/forms/${path}`
}

/** Extra headers of a form's server call (an anonymous visit's upload key). */
export function formApiHeaders(source: { kind: string; anonymous?: AnonymousFormSource } | null | undefined): Record<string, string> {
  return source?.kind === 'form' && source.anonymous ? { 'x-upload-key': source.anonymous.uploadKey } : {}
}

/** True on a public form link (anonymous visitor). */
export function isAnonymousSource(source: { kind: string; anonymous?: AnonymousFormSource } | null | undefined): boolean {
  return source?.kind === 'form' && Boolean(source.anonymous)
}

const LookupSourceContext = createContext<FormLookupSource | null>(null)

export function FormLookupProvider({ source, children }: { source: FormLookupSource | null; children: React.ReactNode }) {
  return <LookupSourceContext.Provider value={source}>{children}</LookupSourceContext.Provider>
}

/** Where the surrounding form is filled in (also where its attachments upload to). */
export function useFormLookupSource(): FormLookupSource | null {
  return useContext(LookupSourceContext)
}

interface LookupResponse { items: LookupItem[]; truncated?: boolean; too_short?: boolean; error?: string }

async function fetchSuggestions(source: FormLookupSource, field: TaskFieldDef, query: string, values: Record<string, unknown>, signal: AbortSignal, resolve?: string[]): Promise<LookupResponse> {
  const extra = resolve ? { resolve } : {}
  const body = source.kind === 'task'
    ? { task_id: source.taskId, field_key: field.key, query, values, ...extra }
    : source.kind === 'form'
      ? { form_id: source.formId, field_key: field.key, query, values, ...extra }
      : { field, query, values, ...extra }
  const res = await fetch(formApiUrl(source, 'lookup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal,
  })
  const json = await res.json().catch(() => null) as (LookupResponse & { error?: string }) | null
  if (!res.ok) {
    const message = res.status === 429 ? 'Too many lookups — wait a moment' : json?.error ?? 'The lookup is not available right now'
    throw new Error(message)
  }
  return { items: Array.isArray(json?.items) ? json!.items : [], truncated: json?.truncated, too_short: json?.too_short }
}

/** The stored `<key>_label` for one value (a string for single lookups, a list aligned with the values for multiple). */
function storedLabelFor(stored: unknown, values: string[], v: string): string | null {
  if (typeof stored === 'string') return values.length === 1 && stored.trim() ? stored : null
  if (Array.isArray(stored)) {
    const i = values.indexOf(v)
    const label = i >= 0 ? stored[i] : undefined
    return typeof label === 'string' && label.trim() ? label : null
  }
  return null
}

/** Formatted read-only value of a lookup: labels from the stored `<key>_item`, else the stored `<key>_label`, else the value. */
export function lookupDisplayValue(field: TaskFieldDef, value: unknown, item: unknown, label?: unknown): string {
  const values = lookupValues(value, field.lookup?.multiple)
  if (!values.length) return '—'
  const byValue = storedItemsByValue(field.lookup, item)
  return values.map((v) => {
    const entry = byValue.get(v)
    if (entry) return storedItemLabel(field.lookup, entry, v)
    return storedLabelFor(label, values, v) ?? v
  }).join(', ')
}

const inputBase = 'h-10 w-full min-w-[6rem] flex-1 bg-transparent text-sm outline-none disabled:opacity-60'

/**
 * Autocomplete / lookup control: an ARIA 1.2 combobox (input + listbox).
 * ↑/↓ move, Enter selects, Esc closes (and clears the typed text when
 * closed), Backspace on an empty input removes the last chip. Suggestions
 * are fetched (debounced, the previous request aborted) as the user types;
 * loading / empty / error states are announced. Selecting fills the
 * configured other fields. The selected item is mirrored into
 * `<key>_item` locally (labels, test runs) — on a real task the server
 * recomputes it on save.
 */
export function LookupField({ field, value, item, label, values, onChange, onItem, onLabel, onFill, onSelectItem, onFocusChange, id, describedBy, invalid, disabled, placeholder }: {
  field: TaskFieldDef
  value: unknown
  /** Stored `<key>_item` (labels for the current selection). */
  item: unknown
  /** Stored `<key>_label` (the display label kept beside the value). */
  label?: unknown
  /** Keep `<key>_label` in step with the selection (the server recomputes it on save). */
  onLabel?: (label: string | string[] | null) => void
  /** A suggestion was chosen (form rules' "Autocomplete: item selected"). */
  onSelectItem?: (item: LookupItem) => void
  onFocusChange?: (focused: boolean) => void
  values: Record<string, unknown>
  onChange: (value: unknown) => void
  onItem: (item: unknown) => void
  onFill: (patch: Record<string, unknown>) => void
  id: string
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const source = useContext(LookupSourceContext)
  const rules = useFormRules()
  const config = field.lookup
  const multiple = Boolean(config?.multiple)
  const freeText = Boolean(config?.allow_free_text)
  const selected = lookupValues(value, multiple)
  const storedByValue = useMemo(() => storedItemsByValue(config, item), [config, item])
  const [known, setKnown] = useState<Map<string, LookupItem>>(() => new Map())
  const labelOf = (v: string) => {
    const hit = known.get(v)
    if (hit) return hit.label
    const entry = storedByValue.get(v)
    if (entry) return storedItemLabel(config, entry, v)
    return storedLabelFor(label, selected, v) ?? v
  }

  const singleLabel = !multiple && selected[0] ? labelOf(selected[0]) : ''
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<LookupItem[]>([])
  const [active, setActive] = useState(-1)
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error' | 'short'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const listId = useId()
  const statusId = `${id}-status`
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const valuesRef = useRef(values)
  useEffect(() => { valuesRef.current = values })


  useEffect(() => () => { abortRef.current?.abort(); if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // A value the form opened with (default, task data, draft) and no label for it yet: ask the server for its
  // item — from the field's own source, under the same rules as a search — so the input shows the label, not the id.
  const unresolved = selected.filter((v) => !known.has(v) && !storedByValue.has(v) && !storedLabelFor(label, selected, v))
  const unresolvedKey = unresolved.join('\u0000')
  const triedRef = useRef<Set<string>>(new Set())
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  // Stable keys: the renderer may hand over new field objects on every render.
  const sourceKey = source ? (source.kind === 'task' ? `task:${source.taskId}` : source.kind === 'form' ? `form:${source.formId}` : 'preview') : ''
  const configKey = config ? JSON.stringify(config) : ''
  useEffect(() => {
    if (!config || !source || !unresolvedKey) return
    const wanted = unresolvedKey.split('\u0000').filter((v) => !triedRef.current.has(v))
    if (!wanted.length) return
    for (const v of wanted) triedRef.current.add(v)
    fetchSuggestions(source, field, '', valuesRef.current, new AbortController().signal, wanted)
      .then((result) => {
        if (!mounted.current || !result.items.length) return
        setKnown((prev) => { const next = new Map(prev); for (const it of result.items) next.set(it.value, it); return next })
      })
      .catch(() => { /* the value shows as is */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the unresolved values, the source and the config
  }, [unresolvedKey, sourceKey, configKey])

  // A cascade: when a field this lookup reads changes ({{task_data.country}} in a filter or an input), the selection is
  // checked again against the source under the new parent — kept when still offered, cleared when not (or the parent emptied).
  const parents = useMemo(() => lookupDependencyKeys(config), [configKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const parentKey = JSON.stringify(parents.map((k) => values[k] ?? null))
  const seenParents = useRef(parentKey)
  const selectedRef = useRef(selected)
  useEffect(() => { selectedRef.current = selected })
  useEffect(() => {
    if (parentKey === seenParents.current) return
    seenParents.current = parentKey
    const current = selectedRef.current
    if (!config || !source || !current.length || freeText) return
    const clear = (kept: string[]) => {
      if (multiple) { onChange(kept); onItem(itemsFor(kept)); onLabel?.(kept.map(labelOf)) }
      else { onChange(null); onItem(null); onLabel?.(null); if (config.fill?.length) onFill(lookupFillValues(config, null)) }
    }
    if (parents.every((k) => { const v = valuesRef.current[k]; return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) })) { clear([]); return }
    const controller = new AbortController()
    setState('loading')
    fetchSuggestions(source, field, '', valuesRef.current, controller.signal, current)
      .then((result) => {
        if (controller.signal.aborted || !mounted.current) return
        setState('idle')
        const kept = recheckedSelection(current, result.items.map((i) => i.value))
        if (kept) clear(kept)
      })
      .catch(() => { if (!controller.signal.aborted && mounted.current) setState('idle') })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the parents' values
  }, [parentKey])

  function search(query: string) {
    if (!config || !source) return
    if (timerRef.current) clearTimeout(timerRef.current)
    abortRef.current?.abort()
    if (query.trim().length < lookupMinChars(config)) {
      setItems([]); setState('short'); setError(null)
      return
    }
    setState('loading')
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const result = await fetchSuggestions(source, field, query.trim(), valuesRef.current, controller.signal)
        if (controller.signal.aborted) return
        setItems(result.items)
        setTruncated(Boolean(result.truncated))
        setActive(result.items.length ? 0 : -1)
        setState(result.too_short ? 'short' : 'done')
        setError(null)
      } catch (e) {
        if (controller.signal.aborted) return
        setItems([])
        setState('error')
        setError(e instanceof Error ? e.message : 'The lookup is not available right now')
      }
    }, lookupDebounceMs(config))
  }

  function close() {
    setOpen(false)
    setActive(-1)
    // Leaving without choosing: the input shows the selection again (or the free text).
    if (typing && !multiple) setTyping(false)
    if (multiple) setText('')
  }


  function remember(it: LookupItem) {
    setKnown((prev) => (prev.has(it.value) ? prev : new Map(prev).set(it.value, it)))
  }

  function itemsFor(list: string[], extra?: LookupItem) {
    return list.map((v) => (extra && extra.value === v ? extra.fields : known.get(v)?.fields ?? storedByValue.get(v))).filter(Boolean)
  }

  function choose(it: LookupItem) {
    remember(it)
    if (multiple) {
      const next = selected.includes(it.value) ? selected : [...selected, it.value]
      onChange(next)
      onItem(itemsFor(next, it))
      onLabel?.(next.map((v) => (v === it.value ? it.label : labelOf(v))))
      setText('')
      search('')
      inputRef.current?.focus()
    } else {
      onChange(it.value)
      onItem(it.fields)
      onLabel?.(it.label)
      setText('')
      setTyping(false)
      setOpen(false)
    }
    if (config?.fill?.length) onFill(lookupFillValues(config, it))
    onSelectItem?.(it)
    rules?.dispatch({ type: 'item_select', target: field.key, context: { field: field.key, value: it.value, item: { value: it.value, label: it.label, fields: it.fields } } })
  }

  function chooseFreeText() {
    const typed = text.trim()
    if (!typed) return
    if (multiple) {
      if (!selected.includes(typed)) { onChange([...selected, typed]); onItem(itemsFor([...selected, typed])); onLabel?.([...selected.map(labelOf), typed]) }
      setText('')
    } else {
      onChange(typed)
      onItem(null)
      onLabel?.(typed)
      setTyping(false)
      setOpen(false)
    }
  }

  function remove(v: string) {
    const next = selected.filter((x) => x !== v)
    onChange(next)
    onItem(itemsFor(next))
    onLabel?.(next.map(labelOf))
  }

  function clearSingle() {
    onChange(null)
    onItem(null)
    onLabel?.(null)
    setText('')
    if (config?.fill?.length) onFill(lookupFillValues(config, null))
    inputRef.current?.focus()
  }

  function onInput(next: string) {
    setText(next)
    setTyping(true)
    setOpen(true)
    if (!multiple) {
      if (freeText) onChange(next.trim() ? next : null)
      else if (selected.length) { onChange(null); onItem(null); onLabel?.(null) }
    }
    search(next)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); search(text); return }
      setActive((i) => (items.length ? (i + 1) % items.length : -1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return
      setActive((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1))
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && items[active]) { e.preventDefault(); choose(items[active]) }
      else if (freeText && text.trim()) { e.preventDefault(); chooseFreeText() }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); close() }
      else if (text && multiple) setText('')
    } else if (e.key === 'Backspace' && multiple && !text && selected.length) {
      remove(selected[selected.length - 1])
    } else if (e.key === 'Tab' && open) {
      close()
    }
  }

  if (!config) return null
  const activeId = open && active >= 0 && items[active] ? `${listId}-opt-${active}` : undefined
  const status = state === 'loading' ? 'Searching…'
    : state === 'error' ? (error ?? 'The lookup is not available right now')
      : state === 'short' ? `Type at least ${lookupMinChars(config)} character${lookupMinChars(config) === 1 ? '' : 's'}`
        : state === 'done' && !items.length ? (freeText && text.trim() ? `No matches — press Enter to use "${text.trim()}"` : 'No matches')
          : state === 'done' ? `${items.length}${truncated ? '+' : ''} suggestion${items.length === 1 ? '' : 's'}` : ''
  const noSource = !source

  return (
    <div ref={rootRef} className="relative" data-lookup-field={field.key}>
      <div
        ref={boxRef}
        data-input-shell=""
        className={cn('flex min-h-10 w-full flex-wrap items-center gap-1 rounded-lg border px-2 focus-within:ring-2 bg-input text-fg', invalid ? 'border-(--status-blocked)' : 'border-border')}
        onClick={() => inputRef.current?.focus()}
      >
        <Search size={14} aria-hidden className="shrink-0 text-fg-muted" />
        {multiple && selected.map((v) => (
          <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-primary-wash text-fg"
            data-lookup-chip={v}>
            <span className="truncate">{labelOf(v)}</span>
            {!disabled && (
              <button type="button" onClick={(e) => { e.stopPropagation(); remove(v) }} aria-label={`Remove ${labelOf(v)}`} className="rounded-full p-0.5 hover:opacity-80">
                <X size={11} aria-hidden />
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={[describedBy, statusId].filter(Boolean).join(' ') || undefined}
          aria-invalid={invalid || undefined}
          aria-required={field.required || undefined}
          autoComplete="off"
          disabled={disabled}
          className={cn(inputBase, 'text-fg')}
          value={typing || multiple ? text : singleLabel}
          placeholder={multiple && selected.length ? '' : placeholder || (noSource ? 'Suggestions appear on the task' : 'Start typing to search…')}
          onChange={(e) => onInput(e.target.value)}
          onBlur={() => onFocusChange?.(false)}
          onFocus={() => { onFocusChange?.(true); if (!open && !disabled && source && (multiple || !selected.length || typing)) { setOpen(true); search(typing || multiple ? text : '') } }}
          onKeyDown={onKeyDown}
        />
        {state === 'loading' && <Loader2 size={14} className="shrink-0 animate-spin text-fg-muted" aria-hidden />}
        {!multiple && selected.length > 0 && !disabled && !field.required && (
          <button type="button" onClick={(e) => { e.stopPropagation(); clearSingle() }} aria-label={`Clear ${field.label}`} className="shrink-0 rounded p-0.5 hover:opacity-80 text-fg-muted">
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      <p id={statusId} className="sr-only" aria-live="polite">{open ? status : ''}</p>
      <FloatingLayer
        anchorRef={boxRef}
        open={open && !noSource}
        onDismiss={close}
        className="overflow-y-auto rounded-lg border py-1 shadow-lg bg-panel border-border text-fg"
        data-testid="lookup-suggestions"
      >
          <ul id={listId} role="listbox" aria-label={`${field.label} suggestions`} aria-multiselectable={multiple || undefined}>
            {items.map((it, i) => {
              const isSelected = selected.includes(it.value)
              return (
                <li
                  key={`${it.value}-${i}`}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(it)}
                  className={cn('cursor-pointer px-3 py-2 text-sm', i === active ? 'bg-primary-wash' : '')}
                  data-lookup-option={it.value}
                >
                  <span className="block truncate font-medium">{it.label}{isSelected && <span className="sr-only"> (selected)</span>}</span>
                  {it.description && <span className="block truncate text-xs text-fg-muted">{it.description}</span>}
                </li>
              )
            })}
          </ul>
          {(state !== 'done' || !items.length || truncated) && (
            <p className={cn('px-3 py-2 text-xs', state === 'error' ? 'text-(--status-blocked)' : 'text-fg-muted')} role={state === 'error' ? 'alert' : undefined}>
              {state === 'done' && truncated && items.length ? 'Showing the first matches — type more to narrow down' : status}
            </p>
          )}
      </FloatingLayer>
    </div>
  )
}
