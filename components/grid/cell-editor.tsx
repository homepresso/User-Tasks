'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Loader2, PenLine, Upload, X } from 'lucide-react'
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog'
import { controlClass } from '@/components/ui/input'
import { RichTextField } from '@/components/forms/rich-text-field'
import { SignatureField } from '@/components/forms/signature-field'
import { normalizePeopleValue, type PersonRef } from '@/lib/forms/people-field'
import type { AttachmentFile } from '@/lib/forms/attachments'
import type { LookupItem } from '@/lib/forms/lookup'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import {
  SEARCH_CONTROLS, isMultiValue, normalizeFileValue, normalizeGridSignature, type GridColumnDef, type GridSignatureValue,
} from '@/lib/grid/column-model'
import { cn } from '@/lib/utils'
import { useBoundLabel, useBoundOptions, useGridSurface } from './grid-context'

/**
 * The in-place editor of one cell, by its control (lib/grid/column-model.ts)
 * — shared by the form Data table and the Data grid. Spreadsheet keys:
 * Enter keeps the value and moves on, Tab / Shift+Tab keep it and move
 * sideways, Escape cancels. Bound dropdowns / autocompletes / multi-selects
 * load their options from the server (lazily, cached per binding); the
 * signature pad and rich text open a dialog; files upload through the
 * surface. Every control is labelled with the column (and the row).
 */
export interface GridCellEditorProps {
  col: GridColumnDef
  value: unknown
  /** The row being edited (cascading bindings read it). */
  row: Record<string, unknown>
  /** Accessible name: "<column>, row <n>". */
  label: string
  /** Keep the value; `move`: where focus goes next. */
  onCommit: (value: unknown, move?: 'next' | 'prev' | 'down') => void
  onCancel: () => void
  invalid?: boolean
  /** Typing on a cell started the edit ("Edit all rows"): the editor opens with this text instead of the value, caret at the end. */
  initialText?: string
}

const inputBase = cn(controlClass, 'h-8 w-full min-w-[6rem] px-2 text-xs')

function rawText(col: GridColumnDef, v: unknown): string {
  if (v === null || v === undefined) return ''
  if (col.control === 'datetime') {
    const d = new Date(String(v))
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  if (col.control === 'date') return String(v).slice(0, 10)
  if (typeof v === 'object') return ''
  return String(v)
}

/** Spreadsheet keys on a text-like editor. */
function keyHandler(commit: (move?: 'next' | 'prev' | 'down') => void, cancel: () => void, multiline = false) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); commit('down') }
    else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); commit(e.shiftKey ? 'prev' : 'next') }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel() }
    else e.stopPropagation()
  }
}

export function GridCellEditor(props: GridCellEditorProps) {
  const { col } = props
  switch (col.control) {
    case 'boolean': return <BooleanEditor {...props} />
    case 'dropdown': return col.binding ? <SearchEditor {...props} listOnly /> : <ChoiceEditor {...props} />
    case 'autocomplete': case 'lookup': return <SearchEditor {...props} />
    case 'multiselect': return <MultiEditor {...props} />
    case 'people': return <PeopleEditor {...props} />
    case 'signature': return <SignatureEditor {...props} />
    case 'file': return <FileEditor {...props} />
    case 'rich_text': return <RichTextEditor {...props} />
    case 'display': return null
    default: return <TextEditor {...props} />
  }
}

function TextEditor({ col, value, label, onCommit, onCancel, invalid, initialText }: GridCellEditorProps) {
  // A date / time input can't start from a typed character: it opens on the value.
  const typed = initialText !== undefined && !['date', 'datetime'].includes(col.control) && !(initialText.trim() && (col.control === 'number' || col.control === 'currency') && !/[\d.,-]/.test(initialText))
  const [text, setText] = useState(() => (typed ? initialText! : rawText(col, value)))
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
    if (!typed) ref.current?.select?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- on open only
  }, [])
  const o = col.control_options ?? {}
  const done = useRef(false)
  const commit = (move?: 'next' | 'prev' | 'down') => {
    if (done.current) return
    done.current = true
    onCommit(col.control === 'datetime' && text ? new Date(text).toISOString() : text, move)
  }
  const cancel = () => { done.current = true; onCancel() }
  if (col.control === 'multiline') {
    return (
      <textarea ref={ref} aria-label={label} aria-invalid={invalid || undefined} className={cn(inputBase, 'h-20 py-1')} value={text} maxLength={o.max_length}
        placeholder={o.placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={keyHandler(commit, cancel, true)} onBlur={() => commit()} />
    )
  }
  const numeric = col.control === 'number' || col.control === 'currency'
  const decimals = o.decimals ?? (col.control === 'currency' ? 2 : undefined)
  const type = numeric ? 'number' : col.control === 'date' ? 'date' : col.control === 'datetime' ? 'datetime-local' : col.control === 'link' ? 'url' : 'text'
  return (
    <span className="relative flex items-center">
      {col.control === 'currency' && <span aria-hidden className="pointer-events-none absolute left-2 text-2xs text-fg-muted">{o.currency ?? 'USD'}</span>}
      <input ref={ref} type={type} aria-label={label} aria-invalid={invalid || undefined} className={cn(inputBase, numeric && 'num text-right', col.control === 'currency' && 'pl-10')} value={text}
        step={numeric ? (decimals !== undefined ? (decimals === 0 ? '1' : String(1 / 10 ** decimals)) : 'any') : undefined}
        min={numeric ? o.min : undefined} max={numeric ? o.max : undefined} maxLength={numeric ? undefined : o.max_length} placeholder={o.placeholder}
        onChange={(e) => setText(e.target.value)} onKeyDown={keyHandler(commit, cancel)} onBlur={() => commit()} />
    </span>
  )
}

function BooleanEditor({ col, value, label, onCommit, onCancel }: GridCellEditorProps) {
  const ref = useRef<HTMLInputElement & HTMLButtonElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const on = value === true
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onCommit(on, 'down') }
    else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onCommit(on, e.shiftKey ? 'prev' : 'next') }
    else e.stopPropagation()
  }
  if (col.control_options?.boolean_style === 'toggle') {
    return (
      <button ref={ref} type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onCommit(!on)} onKeyDown={keys}
        className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors', on ? 'border-primary bg-primary' : 'border-border bg-subtle')}>
        <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-4' : 'translate-x-0.5')} />
      </button>
    )
  }
  return <input ref={ref} className="accent-primary size-4" type="checkbox" aria-label={label} checked={on} onChange={(e) => onCommit(e.target.checked)} onKeyDown={keys} />
}

function ChoiceEditor({ col, value, label, onCommit, onCancel, invalid }: GridCellEditorProps) {
  const ref = useRef<HTMLSelectElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const current = value === null || value === undefined ? '' : String(value)
  return (
    <select ref={ref} aria-label={label} aria-invalid={invalid || undefined} className={inputBase} defaultValue={current}
      onChange={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onCommit((e.target as HTMLSelectElement).value, 'down') }
        else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onCommit((e.target as HTMLSelectElement).value, e.shiftKey ? 'prev' : 'next') }
        else e.stopPropagation()
      }}
      onBlur={(e) => { if (e.target.value !== current) onCommit(e.target.value) ; else onCancel() }}>
      <option value="">—</option>
      {(col.control_options?.choices ?? []).map((c) => <option key={c.value} value={c.value}>{c.label ?? c.value}</option>)}
    </select>
  )
}

/**
 * A bound single value: a combobox over the source's options. `listOnly`
 * (a bound dropdown): the options load at once and the text filters them;
 * otherwise (autocomplete / lookup) the typed text is searched on the server.
 */
function SearchEditor({ col, value, row, label, onCommit, onCancel, invalid, listOnly, initialText }: GridCellEditorProps & { listOnly?: boolean }) {
  const currentLabel = useBoundLabel(col, value)
  const [text, setText] = useState(initialText?.trim() ? initialText : '')
  const [active, setActive] = useState(0)
  const listId = useId()
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const search = SEARCH_CONTROLS.has(col.control) && !listOnly
  const { items, loading, error, tooShort } = useBoundOptions(col, row, search ? text : '', true)
  const shown = useMemo(() => (search || !text ? items : items.filter((i) => `${i.label} ${i.description ?? ''}`.toLowerCase().includes(text.toLowerCase()))).slice(0, 50), [items, search, text])
  const pick = (item: LookupItem | null, move?: 'next' | 'prev' | 'down') => onCommit(item ? item.value : null, move)
  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setActive((a) => Math.min(shown.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (shown[active]) pick(shown[active], 'down'); else if (!text && col.binding?.allow_free_text !== true) onCancel(); else if (col.binding?.allow_free_text) onCommit(text, 'down') }
    else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); if (shown[active] && text) pick(shown[active], e.shiftKey ? 'prev' : 'next'); else onCancel() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
    else if (e.key === 'Delete' && !text) { e.preventDefault(); e.stopPropagation(); pick(null, 'down') }
    else e.stopPropagation()
  }
  return (
    <div className="relative" data-grid-combobox={col.key}>
      <input ref={ref} role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list" aria-label={label} aria-invalid={invalid || undefined}
        aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
        className={inputBase} value={text} placeholder={currentLabel ?? (search ? 'Type to search…' : 'Choose…')}
        onChange={(e) => { setText(e.target.value); setActive(0) }} onKeyDown={keys}
        onBlur={() => setTimeout(() => onCancel(), 150)} />
      <ul id={listId} role="listbox" aria-label={`${col.label} options`}
        className="absolute left-0 top-full z-30 mt-1 max-h-60 min-w-full w-max max-w-[22rem] overflow-auto rounded-md border border-border bg-panel py-1 text-xs shadow-lg">
        {loading && <li className="flex items-center gap-1 px-2 py-1 text-fg-muted" role="presentation"><Loader2 className="size-3 animate-spin" aria-hidden /> Loading…</li>}
        {!loading && error && <li className="px-2 py-1 text-(--status-blocked)" role="presentation">{error}</li>}
        {!loading && !error && tooShort && <li className="px-2 py-1 text-fg-muted" role="presentation">Keep typing…</li>}
        {!loading && !error && !tooShort && !shown.length && <li className="px-2 py-1 text-fg-muted" role="presentation">No matches</li>}
        {value !== null && value !== undefined && value !== '' && (
          <li role="option" aria-selected={false} className="cursor-pointer px-2 py-1 text-fg-muted hover:bg-subtle" onMouseDown={(e) => { e.preventDefault(); pick(null) }}>Clear</li>
        )}
        {shown.map((item, i) => (
          <li key={item.value} id={`${listId}-${i}`} role="option" aria-selected={i === active || String(value) === item.value}
            className={cn('cursor-pointer px-2 py-1', i === active ? 'bg-primary-wash text-primary-text' : 'hover:bg-subtle')}
            onMouseDown={(e) => { e.preventDefault(); pick(item) }} onMouseEnter={() => setActive(i)}>
            <span className="flex items-center gap-1">{String(value) === item.value && <Check className="size-3" aria-hidden />}<span className="truncate">{item.label}</span></span>
            {item.description && col.control !== 'dropdown' && <span className="block truncate text-2xs text-fg-muted">{item.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Several values: a checklist (static choices, or the bound source's options — searched on the server when large). */
function MultiEditor({ col, value, row, label, onCommit, onCancel }: GridCellEditorProps) {
  const initial = useMemo(() => (Array.isArray(value) ? value.map(String) : []), [value])
  const [picked, setPicked] = useState<string[]>(initial)
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const bound = useBoundOptions(col, row, col.binding ? text : '', Boolean(col.binding))
  const items: Array<{ value: string; label: string }> = col.binding
    ? bound.items.map((i) => ({ value: i.value, label: i.label }))
    : (col.control_options?.choices ?? []).map((c) => ({ value: c.value, label: c.label ?? c.value })).filter((c) => !text || c.label.toLowerCase().includes(text.toLowerCase()))
  const toggle = (v: string) => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
    else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'INPUT') { e.preventDefault(); e.stopPropagation(); onCommit(picked, 'down') }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onCommit(picked, 'down') }
    else e.stopPropagation()
  }
  return (
    <div role="group" aria-label={label} className="absolute left-0 top-0 z-30 w-64 rounded-md border border-border bg-panel p-2 text-xs shadow-lg" onKeyDown={keys} data-grid-multiselect={col.key}>
      <input ref={ref} aria-label={`Filter ${col.label} options`} className={inputBase} placeholder="Filter…" value={text} onChange={(e) => setText(e.target.value)} />
      <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto" aria-label={`${col.label} options`}>
        {bound.loading && <li className="flex items-center gap-1 text-fg-muted"><Loader2 className="size-3 animate-spin" aria-hidden /> Loading…</li>}
        {items.map((item) => (
          <li key={item.value}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-subtle">
              <input type="checkbox" className="accent-primary" checked={picked.includes(item.value)} onChange={() => toggle(item.value)} />
              <span className="truncate">{item.label}</span>
            </label>
          </li>
        ))}
        {!bound.loading && !items.length && <li className="text-fg-muted">No options</li>}
      </ul>
      <div className="mt-2 flex justify-end gap-1">
        <button type="button" className="rounded px-2 py-1 hover:bg-subtle" onClick={onCancel}>Cancel</button>
        <button type="button" className="rounded bg-primary px-2 py-1 font-medium text-white" onClick={() => onCommit(picked, 'down')}>Done ({picked.length})</button>
      </div>
    </div>
  )
}

function PeopleEditor({ col, value, label, onCommit, onCancel }: GridCellEditorProps) {
  const surface = useGridSurface()
  const [text, setText] = useState('')
  const multiple = isMultiValue(col)
  const [refs, setRefs] = useState<PersonRef[]>(() => normalizePeopleValue(value))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const people = (surface?.people ?? []).filter((p) => !text || `${p.display_name ?? ''} ${p.email ?? ''}`.toLowerCase().includes(text.toLowerCase())).slice(0, 30)
  const add = (p: { id: string; display_name: string | null; email: string | null }) => {
    const next: PersonRef = { kind: 'user', id: p.id, name: p.display_name || p.email || undefined }
    if (!multiple) { onCommit([next], 'down'); return }
    setRefs((r) => (r.some((x) => x.id === p.id) ? r : [...r, next]))
  }
  return (
    <div role="group" aria-label={label} className="absolute left-0 top-0 z-30 w-64 rounded-md border border-border bg-panel p-2 text-xs shadow-lg"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() } else e.stopPropagation() }} data-grid-people={col.key}>
      {multiple && refs.length > 0 && (
        <ul className="mb-1 flex flex-wrap gap-1" aria-label="Picked">
          {refs.map((r) => (
            <li key={r.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-subtle px-2 py-0.5">
              {r.name ?? 'Person'}<button type="button" aria-label={`Remove ${r.name ?? 'person'}`} onClick={() => setRefs((x) => x.filter((y) => y.id !== r.id))}><X className="size-3" /></button>
            </li>
          ))}
        </ul>
      )}
      <input ref={ref} aria-label={`Search people for ${col.label}`} className={inputBase} placeholder="Search people…" value={text} onChange={(e) => setText(e.target.value)} />
      <ul className="mt-1 max-h-48 overflow-auto" role="listbox" aria-label="People">
        {people.map((p) => (
          <li key={p.id} role="option" aria-selected={refs.some((r) => r.id === p.id)} tabIndex={0}
            className="cursor-pointer rounded px-1 py-0.5 hover:bg-subtle focus:bg-subtle" onClick={() => add(p)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(p) } }}>
            <span className="block truncate">{p.display_name || p.email}</span>
            {p.display_name && p.email && <span className="block truncate text-2xs text-fg-muted">{p.email}</span>}
          </li>
        ))}
        {!people.length && <li className="text-fg-muted">No people</li>}
      </ul>
      <div className="mt-2 flex justify-end gap-1">
        <button type="button" className="rounded px-2 py-1 hover:bg-subtle" onClick={() => onCommit(null, 'down')}>Clear</button>
        {multiple && <button type="button" className="rounded bg-primary px-2 py-1 font-medium text-white" onClick={() => onCommit(refs, 'down')}>Done</button>}
        {!multiple && <button type="button" className="rounded px-2 py-1 hover:bg-subtle" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  )
}

/**
 * A signature cell: the Signature control's pad in a dialog. On forms the
 * PNG goes through the form's upload pipeline (key `<field>.<column>`, the
 * server stamps who signed); in the Data grid it is stored as a table file
 * and the server stamps who signed (lib/services/data-table-views.ts).
 */
function SignatureEditor({ col, value, label, onCommit, onCancel }: GridCellEditorProps) {
  const surface = useGridSurface()
  const padId = useId()
  const uploadKey = surface?.signatureUploadKey?.(col)
  const field: TaskFieldDef = { key: uploadKey ?? col.key, label: col.label, type: 'signature', ...(col.control_options?.signature ? { signature: col.control_options.signature } : {}) }
  const upload = !uploadKey && surface?.upload
    ? async (png: Blob, name: string) => {
      const stored = await surface.upload!(png, name, col)
      return { id: '', name: stored.name, size: stored.size ?? png.size, mime_type: 'image/png', url: stored.url, storage_ref: stored.path ?? '', uploaded_by: null, uploaded_at: new Date().toISOString(), checksum_sha256: '' } as AttachmentFile
    }
    : undefined
  const current = normalizeGridSignature(value)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent size="md" title={label} data-grid-signature-dialog={col.key}>
        <DialogBody>
          <span id={`${padId}-label`} className="sr-only">{label}</span>
          {current && <p className="mb-2 text-2xs text-fg-muted">Signing again replaces the current signature.</p>}
          {!uploadKey && !upload
            ? <p className="text-sm text-fg-muted">Signatures can&apos;t be captured here.</p>
            : <SignatureField field={field} value={null} id={padId} upload={upload}
              onChange={(next) => {
                if (!next) return
                const sig: GridSignatureValue = uploadKey
                  ? (next as unknown as GridSignatureValue)
                  : { file: { name: next.file.name, url: next.file.url, size: next.file.size, ...(next.file.storage_ref ? { path: next.file.storage_ref } : {}) }, method: next.method, signed_at: next.signed_at, ...(next.typed_name ? { typed_name: next.typed_name } : {}) }
                onCommit(sig, 'down')
              }} />}
          {current && (
            <button type="button" className="mt-2 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs" onClick={() => onCommit(null, 'down')} data-grid-signature-clear>
              <X className="size-3" aria-hidden /> Clear signature
            </button>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function FileEditor({ col, value, label, onCommit, onCancel }: GridCellEditorProps) {
  const surface = useGridSurface()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = normalizeFileValue(value)
  useEffect(() => { input.current?.focus() }, [])
  if (!surface?.upload) return <span className="text-2xs text-fg-muted">Files can&apos;t be uploaded here</span>
  return (
    <div className="flex items-center gap-1" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() } else e.stopPropagation() }}>
      <label className={cn('inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-subtle', busy && 'opacity-60')}>
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
        {current ? 'Replace' : 'Upload'}
        <input ref={input} type="file" className="sr-only" aria-label={label} disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setBusy(true); setError(null)
            try { onCommit(await surface.upload!(file, file.name, col), 'down') } catch (err) { setError(err instanceof Error ? err.message : 'The upload failed') } finally { setBusy(false) }
          }} />
      </label>
      {current && <button type="button" className="rounded p-1 hover:bg-subtle" aria-label={`Remove the file from ${col.label}`} onClick={() => onCommit(null, 'down')}><X className="size-3.5" /></button>}
      <button type="button" className="rounded px-1 text-2xs text-fg-muted hover:bg-subtle" onClick={onCancel}>Cancel</button>
      {error && <span role="alert" className="text-2xs text-(--status-blocked)">{error}</span>}
    </div>
  )
}

function RichTextEditor({ col, value, label, onCommit, onCancel }: GridCellEditorProps) {
  const [html, setHtml] = useState(() => (typeof value === 'string' ? value : ''))
  const id = useId()
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent size="lg" title={label} data-grid-richtext-dialog={col.key}>
        <DialogBody>
          <span id={`${id}-label`} className="sr-only">{label}</span>
          <RichTextField value={html} onChange={setHtml} id={id} labelledBy={`${id}-label`} />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="rounded px-3 py-1.5 text-sm hover:bg-subtle" onClick={onCancel}>Cancel</button>
            <button type="button" className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm font-medium text-white" onClick={() => onCommit(html, 'down')}><Check className="size-3.5" aria-hidden /> Save</button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

/** Controls whose editor floats above the grid (the cell keeps its size). */
export function editorFloats(col: GridColumnDef): boolean {
  return col.control === 'multiselect' || col.control === 'people'
}

/** Controls edited in a dialog (the cell shows its value meanwhile). */
export function editorInDialog(col: GridColumnDef): boolean {
  return col.control === 'signature' || col.control === 'rich_text'
}

export { PenLine as SignIcon }
