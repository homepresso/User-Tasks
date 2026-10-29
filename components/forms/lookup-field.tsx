'use client'

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import {
  lookupDebounceMs, lookupFillValues, lookupMinChars, lookupValues, storedItemLabel, storedItemsByValue,
  type LookupItem,
} from '@/lib/forms/lookup'
import type { TaskFieldDef } from '@/lib/task-field-schema'

/**
 * Where a form's lookups get their suggestions: a real task (the server
 * reads the config from the task) or the designer's preview (the unsaved
 * config is sent; needs edit rights). No source → the control explains
 * that suggestions appear on the task.
 */
export type FormLookupSource = { kind: 'task'; taskId: string } | { kind: 'form'; formId: string } | { kind: 'preview' }

const LookupSourceContext = createContext<FormLookupSource | null>(null)

export function FormLookupProvider({ source, children }: { source: FormLookupSource | null; children: React.ReactNode }) {
  return <LookupSourceContext.Provider value={source}>{children}</LookupSourceContext.Provider>
}

/** Where the surrounding form is filled in (also where its attachments upload to). */
export function useFormLookupSource(): FormLookupSource | null {
  return useContext(LookupSourceContext)
}

interface LookupResponse { items: LookupItem[]; truncated?: boolean; too_short?: boolean; error?: string }

async function fetchSuggestions(source: FormLookupSource, field: TaskFieldDef, query: string, values: Record<string, unknown>, signal: AbortSignal): Promise<LookupResponse> {
  const body = source.kind === 'task'
    ? { task_id: source.taskId, field_key: field.key, query, values }
    : source.kind === 'form'
      ? { form_id: source.formId, field_key: field.key, query, values }
      : { field, query, values }
  const res = await fetch('/api/internal/forms/lookup', {
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

/** Formatted read-only value of a lookup (labels from the stored `<key>_item`). */
export function lookupDisplayValue(field: TaskFieldDef, value: unknown, item: unknown): string {
  const values = lookupValues(value, field.lookup?.multiple)
  if (!values.length) return '—'
  const byValue = storedItemsByValue(field.lookup, item)
  return values.map((v) => storedItemLabel(field.lookup, byValue.get(v), v)).join(', ')
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
export function LookupField({ field, value, item, values, onChange, onItem, onFill, id, describedBy, invalid, disabled, placeholder }: {
  field: TaskFieldDef
  value: unknown
  /** Stored `<key>_item` (labels for the current selection). */
  item: unknown
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
  const config = field.lookup
  const multiple = Boolean(config?.multiple)
  const freeText = Boolean(config?.allow_free_text)
  const selected = lookupValues(value, multiple)
  const storedByValue = useMemo(() => storedItemsByValue(config, item), [config, item])
  const [known, setKnown] = useState<Map<string, LookupItem>>(() => new Map())
  const labelOf = (v: string) => known.get(v)?.label ?? storedItemLabel(config, storedByValue.get(v), v)

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
  const valuesRef = useRef(values)
  useEffect(() => { valuesRef.current = values })


  useEffect(() => () => { abortRef.current?.abort(); if (timerRef.current) clearTimeout(timerRef.current) }, [])

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

  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closeRef.current()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

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
      setText('')
      search('')
      inputRef.current?.focus()
    } else {
      onChange(it.value)
      onItem(it.fields)
      setText('')
      setTyping(false)
      setOpen(false)
    }
    if (config?.fill?.length) onFill(lookupFillValues(config, it))
  }

  function chooseFreeText() {
    const typed = text.trim()
    if (!typed) return
    if (multiple) {
      if (!selected.includes(typed)) { onChange([...selected, typed]); onItem(itemsFor([...selected, typed])) }
      setText('')
    } else {
      onChange(typed)
      onItem(null)
      setTyping(false)
      setOpen(false)
    }
  }

  function remove(v: string) {
    const next = selected.filter((x) => x !== v)
    onChange(next)
    onItem(itemsFor(next))
  }

  function clearSingle() {
    onChange(null)
    onItem(null)
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
      else if (selected.length) { onChange(null); onItem(null) }
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
        className="flex min-h-10 w-full flex-wrap items-center gap-1 rounded-lg border px-2 focus-within:ring-2"
        style={{
          borderColor: invalid ? 'var(--status-blocked)' : 'var(--theme-surface-border)',
          backgroundColor: 'var(--theme-topbar)',
          color: 'var(--theme-topbar-text)',
          ['--tw-ring-color' as string]: 'var(--theme-primary)',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        <Search size={14} aria-hidden style={{ color: 'var(--theme-muted-text)' }} className="shrink-0" />
        {multiple && selected.map((v) => (
          <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-card-text)' }} data-lookup-chip={v}>
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
          className={inputBase}
          style={{ color: 'var(--theme-topbar-text)' }}
          value={typing || multiple ? text : singleLabel}
          placeholder={multiple && selected.length ? '' : placeholder || (noSource ? 'Suggestions appear on the task' : 'Start typing to search…')}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => { if (!open && !disabled && source && (multiple || !selected.length || typing)) { setOpen(true); search(typing || multiple ? text : '') } }}
          onKeyDown={onKeyDown}
        />
        {state === 'loading' && <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden style={{ color: 'var(--theme-muted-text)' }} />}
        {!multiple && selected.length > 0 && !disabled && !field.required && (
          <button type="button" onClick={(e) => { e.stopPropagation(); clearSingle() }} aria-label={`Clear ${field.label}`} className="shrink-0 rounded p-0.5 hover:opacity-80" style={{ color: 'var(--theme-muted-text)' }}>
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      <p id={statusId} className="sr-only" aria-live="polite">{open ? status : ''}</p>
      {open && !noSource && (
        <div
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border py-1 shadow-lg"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
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
                  className="cursor-pointer px-3 py-2 text-sm"
                  style={i === active ? { backgroundColor: 'var(--theme-primary-light)' } : undefined}
                  data-lookup-option={it.value}
                >
                  <span className="block truncate font-medium">{it.label}{isSelected && <span className="sr-only"> (selected)</span>}</span>
                  {it.description && <span className="block truncate text-xs" style={{ color: 'var(--theme-muted-text)' }}>{it.description}</span>}
                </li>
              )
            })}
          </ul>
          {(state !== 'done' || !items.length || truncated) && (
            <p className="px-3 py-2 text-xs" style={{ color: state === 'error' ? 'var(--status-blocked)' : 'var(--theme-muted-text)' }} role={state === 'error' ? 'alert' : undefined}>
              {state === 'done' && truncated && items.length ? 'Showing the first matches — type more to narrow down' : status}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
