'use client'

/**
 * Pick the list in an API response that holds the rows — at any depth — and
 * the item fields to use from it. One component for every place that binds a
 * reference to a list: the form Data table field, lookup (autocomplete)
 * fields, the workflow Loop and the call-reference step's response model.
 *
 *  - "Load sample" runs the reference once (POST /api/integrations/reference-sample)
 *    and folds the response into its model;
 *  - the response as a tree: objects expand, lists show "list of N items" and
 *    can be chosen as the collection, search filters by key;
 *  - a typed path fallback (`contents`, `data.items`, `value[0].children`);
 *  - the chosen list's item fields (nested up to 3 levels) with types,
 *    examples and the format a column starts with.
 *
 * Paths are relative to what the runtime reads (lib/response-collections).
 */

import { useEffect, useId, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, FlaskConical, List, Loader2, Plus, Search } from 'lucide-react'
import { describeSchemaType, type ResponseSchema, type SchemaNode } from '@/lib/response-schema'
import {
  autoPickCollection, collectionItemFields, findCollections, pagingHints, runtimeView, validateCollectionPath,
  type CollectionCandidate, type CollectionField, type PagingHint,
} from '@/lib/response-collections'
import { CELL_FORMAT_LABELS } from '@/lib/formatting/cell-format'

/* eslint-disable @typescript-eslint/no-explicit-any -- sample JSON */

const muted = { color: 'var(--theme-muted-text)' }
const border = { borderColor: 'var(--theme-surface-border)' }
const inputCls = 'h-7 w-full min-w-0 rounded border px-2 font-mono text-2xs outline-none focus-visible:ring-2'
const inputStyle: React.CSSProperties = { ...border, backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)', ['--tw-ring-color' as string]: 'var(--theme-primary)' }

export interface ReferenceInputLike { name: string; required?: boolean; default_value?: unknown; description?: string }

// ─── Load sample ────────────────────────────────────────────────────────

/** A sample value for an input: a fixed mapping as it is, else the input's default. */
export function sampleInputValue(mapping: string | undefined, input: ReferenceInputLike): string {
  if (mapping && !mapping.includes('{{')) return mapping
  const fallback = input.default_value
  return fallback === undefined || fallback === null ? '' : String(fallback)
}

export function LoadSampleButton({ referenceId, inputs, mappings, onLoaded, compact }: {
  referenceId: string
  inputs: ReferenceInputLike[]
  /** The designer's input mappings (fixed values are used as sample values). */
  mappings?: Record<string, string | undefined>
  onLoaded: (schema: ResponseSchema, saved: boolean) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; message?: string }>({ status: 'idle' })
  const id = useId()
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const input of inputs) next[input.name] = sampleInputValue(mappings?.[input.name], input)
    setValues(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the reference changes
  }, [referenceId])

  const missing = inputs.filter((input) => input.required && !String(values[input.name] ?? '').trim())
  async function run() {
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/integrations/reference-sample', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ reference_id: referenceId, inputs: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')) }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.response_schema) throw new Error(json?.error ?? 'The test call failed')
      onLoaded(json.response_schema as ResponseSchema, json.saved === true)
      setState({ status: 'done', message: json.saved ? 'Sample loaded and saved as the reference\'s response model.' : 'Sample loaded for this session (saving the model needs the Manage references permission).' })
      setOpen(false)
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'The test call failed' })
    }
  }

  return (
    <div className="space-y-1" data-testid="load-sample">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => (inputs.length && !open ? setOpen(true) : run())} disabled={state.status === 'loading'}
          className="flex items-center gap-1 rounded border px-2 py-1 text-2xs font-medium disabled:opacity-50" style={{ ...border, color: 'var(--theme-primary-text)' }}
          data-testid="load-sample-button" aria-expanded={inputs.length ? open : undefined} aria-controls={inputs.length ? `${id}-inputs` : undefined}>
          {state.status === 'loading' ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <FlaskConical size={11} aria-hidden />}
          {compact ? 'Load sample' : 'Load sample (test call)'}
        </button>
        {state.status === 'done' && <span className="text-2xs text-fg-muted" role="status">{state.message}</span>}
      </div>
      {state.status === 'error' && <p role="alert" className="text-2xs" style={{ color: 'var(--status-blocked)' }}>{state.message}</p>}
      {open && inputs.length > 0 && (
        <div id={`${id}-inputs`} className="space-y-1 rounded border p-1.5 border-border">
          <p className="text-2xs text-fg-muted">Sample inputs for one test call (fixed mappings and defaults are filled in):</p>
          {inputs.map((input) => (
            <label key={input.name} className="grid grid-cols-[7rem_1fr] items-center gap-1 text-2xs">
              <span className="truncate font-mono">{input.name}{input.required ? ' *' : ''}</span>
              <input className={inputCls} style={inputStyle} value={values[input.name] ?? ''} placeholder={input.description || ''}
                onChange={(e) => setValues((v) => ({ ...v, [input.name]: e.target.value }))} />
            </label>
          ))}
          <div className="flex items-center gap-2">
            <button type="button" onClick={run} disabled={state.status === 'loading' || missing.length > 0}
              className="rounded px-2 py-1 text-2xs font-medium disabled:opacity-50 bg-primary text-primary-fg" data-testid="load-sample-run">
              Run test call
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-2xs text-fg-muted">Cancel</button>
            {missing.length > 0 && <span className="text-2xs text-fg-muted">Needs {missing.map((m) => m.name).join(', ')}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tree ───────────────────────────────────────────────────────────────

interface TreeRow {
  key: string
  /** Collection path when the row is a list ('' = root). */
  path: string
  name: string
  schema: SchemaNode
  depth: number
  list?: CollectionCandidate
  children: TreeRow[]
}

function buildRows(node: SchemaNode, path: string, name: string, depth: number, lists: Map<string, CollectionCandidate>): TreeRow {
  const row: TreeRow = { key: path || '$', path, name, schema: node, depth, list: node.type === 'array' ? lists.get(path) : undefined, children: [] }
  if (depth > 9) return row
  if (node.type === 'object') {
    row.children = (node.fields ?? []).map((field) => buildRows(field, path ? `${path}.${field.name}` : field.name, field.name, depth + 1, lists))
  } else if (node.type === 'array' && node.items) {
    if (node.items.type === 'object') row.children = (node.items.fields ?? []).map((field) => buildRows(field, `${path}[].${field.name}`, field.name, depth + 1, lists))
    else if (node.items.type === 'array') row.children = [buildRows(node.items, `${path}[]`, 'each item', depth + 1, lists)]
  }
  return row
}

function matches(row: TreeRow, q: string): boolean {
  return row.name.toLowerCase().includes(q) || row.children.some((child) => matches(child, q))
}

function itemPreview(sampleList: unknown, schema: SchemaNode): string {
  const first = Array.isArray(sampleList) ? sampleList[0] : undefined
  if (first !== undefined) {
    const text = typeof first === 'string' ? first : JSON.stringify(first)
    return text.length > 80 ? `${text.slice(0, 79)}…` : text
  }
  const fields = schema.items?.type === 'object' ? (schema.items.fields ?? []).map((f) => f.name) : []
  return fields.length ? `{ ${fields.slice(0, 5).join(', ')}${fields.length > 5 ? ', …' : ''} }` : ''
}

function sampleAt(sample: unknown, path: string): unknown {
  if (path.includes('[]')) return undefined
  let cursor: any = sample
  for (const part of path ? path.split('.') : []) cursor = cursor == null ? undefined : cursor[part]
  return cursor
}

function typeLabel(row: TreeRow, sample: unknown): string {
  const s = row.schema
  if (s.type === 'array') {
    const count = row.list?.count
    const of = s.items?.type === 'object' ? 'objects' : s.items && s.items.type !== 'any' ? `${s.items.type === 'integer' ? 'number' : s.items.type}s` : 'items'
    return count !== undefined ? `list of ${count} ${count === 1 ? of.replace(/s$/, '') : of}` : `list of ${of}`
  }
  if (s.type === 'object') return `object · ${(s.fields ?? []).length} field${(s.fields ?? []).length === 1 ? '' : 's'}`
  void sample
  return describeSchemaType(s)
}

function exampleOf(schema: SchemaNode): string | null {
  if (schema.example === undefined) return null
  const text = typeof schema.example === 'string' ? `"${schema.example}"` : String(schema.example)
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}

export function CollectionTree({ root, sample, value, onSelect, maxHeight = 260 }: {
  root: SchemaNode
  sample?: unknown
  value: string | null
  onSelect: (path: string) => void
  maxHeight?: number
}) {
  const [query, setQuery] = useState('')
  const lists = useMemo(() => new Map(findCollections(root, sample).map((c) => [c.path, c])), [root, sample])
  const tree = useMemo(() => buildRows(root, '', 'response', 0, lists), [root, lists])
  const [open, setOpen] = useState<Set<string>>(() => {
    // Open the way to the chosen list and the first level.
    const out = new Set<string>(['$'])
    if (value) {
      let acc = ''
      for (const part of value.split('.')) { acc = acc ? `${acc}.${part}` : part; out.add(acc.replace(/\[\]$/, '')) }
    }
    return out
  })
  // A newly chosen list opens (its item preview shows), along with the way to it.
  useEffect(() => {
    if (value === null) return
    setOpen((current) => {
      const next = new Set(current)
      let acc = ''
      for (const part of value ? value.split('.') : []) { acc = acc ? `${acc}.${part}` : part; next.add(acc); next.add(acc.replace(/\[\d*\]$/, '')) }
      return next
    })
  }, [value])
  const q = query.trim().toLowerCase()
  const toggle = (key: string) => setOpen((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })

  const render = (row: TreeRow): React.ReactNode => {
    if (q && !matches(row, q)) return null
    const expandable = row.children.length > 0
    const isOpen = q ? true : open.has(row.key)
    const selectable = row.schema.type === 'array'
    const selected = selectable && value === row.path
    const example = exampleOf(row.schema)
    return (
      <li key={row.key} role="treeitem" aria-expanded={expandable ? isOpen : undefined} aria-selected={selectable ? selected : undefined}>
        <div className="flex items-center gap-1 rounded px-1 py-0.5 text-2xs" style={{ paddingLeft: 4 + row.depth * 12, ...(selected ? { backgroundColor: 'var(--theme-primary-light)', outline: '1px solid var(--theme-primary)' } : {}) }}
          data-collection-row={row.path}>
          {expandable
            ? <button type="button" className="rounded p-0.5" aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${row.name}`} onClick={() => toggle(row.key)}>{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
            : <span className="inline-block w-[19px]" aria-hidden />}
          {selectable && <List size={11} aria-hidden className="text-primary-text" />}
          <span className="font-mono" style={row.depth === 0 ? muted : undefined}>{row.depth === 0 ? '(the whole response)' : row.name}</span>
          <span className="truncate text-2xs text-fg-muted">{typeLabel(row, sample)}{example ? ` · ${example}` : ''}</span>
          {selectable && (
            <button type="button" onClick={() => onSelect(row.path)} aria-pressed={selected}
              className="ml-auto shrink-0 rounded border px-1.5 text-2xs font-medium" data-use-collection={row.path}
              style={selected ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { ...border, color: 'var(--theme-primary-text)' }}>
              {selected ? <span className="flex items-center gap-0.5"><Check size={10} aria-hidden /> Rows</span> : 'Use as rows'}
            </button>
          )}
        </div>
        {selectable && isOpen && (
          <p className="truncate font-mono text-2xs" style={{ ...muted, paddingLeft: 26 + row.depth * 12 }} title="First item">{itemPreview(sampleAt(sample, row.path), row.schema) || ' '}</p>
        )}
        {expandable && isOpen && <ul role="group">{row.children.map(render)}</ul>}
      </li>
    )
  }

  return (
    <div className="space-y-1" data-testid="collection-tree">
      <label className="relative block">
        <span className="sr-only">Search the response</span>
        <Search size={11} className="pointer-events-none absolute left-2 top-2 text-fg-muted" aria-hidden />
        <input className={`${inputCls} pl-6`} style={inputStyle} placeholder="Search keys…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul role="tree" aria-label="Response" className="overflow-y-auto rounded border py-0.5" style={{ ...border, maxHeight }}>
        {render(tree)}
      </ul>
    </div>
  )
}

// ─── Item fields ────────────────────────────────────────────────────────

export function CollectionFieldList({ fields, selected, onAdd, maxHeight = 200 }: {
  fields: CollectionField[]
  selected: string[]
  onAdd: (fields: CollectionField[]) => void
  maxHeight?: number
}) {
  const addable = fields.filter((f) => !f.container && !selected.includes(f.path))
  if (!fields.length) return null
  return (
    <div className="space-y-1" data-testid="collection-fields">
      <div className="flex items-center gap-2">
        <span className="text-2xs font-medium text-fg-muted">Item fields</span>
        {addable.length > 1 && (
          <button type="button" className="ml-auto text-2xs font-medium text-primary-text" onClick={() => onAdd(addable)} data-testid="collection-add-all">
            Add all ({addable.length})
          </button>
        )}
      </div>
      <ul className="overflow-y-auto rounded border" style={{ ...border, maxHeight }}>
        {fields.map((f) => {
          const added = selected.includes(f.path)
          const example = f.example === undefined ? null : typeof f.example === 'string' ? f.example : JSON.stringify(f.example)
          return (
            <li key={f.path} className="flex items-center gap-1 border-b px-1.5 py-0.5 text-2xs last:border-b-0" style={{ ...border, paddingLeft: 6 + f.level * 12 }} data-collection-field={f.path}>
              <span className="font-mono">{f.container ? `${f.name} ›` : f.name}</span>
              {!f.container && (
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted">
                  {f.type === 'integer' ? 'number' : f.type}{f.format !== 'text' && f.format !== 'number' ? ` · ${CELL_FORMAT_LABELS[f.format]}` : ''}{example ? ` · ${example.length > 32 ? `${example.slice(0, 31)}…` : example}` : ''}
                </span>
              )}
              {!f.container && (added
                ? <span className="flex items-center gap-0.5 text-2xs text-fg-muted"><Check size={10} aria-hidden /> Added</span>
                : <button type="button" className="flex items-center gap-0.5 rounded px-1 text-2xs font-medium text-primary-text" onClick={() => onAdd([f])} aria-label={`Add ${f.path}`}><Plus size={10} aria-hidden /> Add</button>)}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── The picker ─────────────────────────────────────────────────────────

const PAGING_LABELS: Record<PagingHint['kind'], string> = { total: 'total count', next_link: 'next page link', cursor: 'next page token', has_more: 'more pages?' }

export interface ResponseCollectionPickerProps {
  /** The reference's model (stored, or derived from its outputs). */
  schema: ResponseSchema | null
  /** Collection path ('' / undefined = the response itself). */
  value: string | undefined
  onChange: (path: string, options: { auto: boolean }) => void
  /** Load sample: the reference to call, its inputs and the designer's mappings. */
  referenceId?: string
  inputs?: ReferenceInputLike[]
  mappings?: Record<string, string | undefined>
  /** A model loaded by "Load sample" (saved or not) — the parent refreshes its copy of the reference. */
  onSchemaLoaded?: (schema: ResponseSchema, saved: boolean) => void
  /** Show the chosen list's item fields with Add buttons. */
  fields?: { selected: string[]; onAdd: (fields: CollectionField[]) => void }
  /** Preselect the only list of objects. */
  autoPick?: boolean
  label?: string
  /** The expression a path becomes (workflow Loops), shown under the path. */
  expressionFor?: (path: string) => string
  testId?: string
}

export function ResponseCollectionPicker({ schema, value, onChange, referenceId, inputs = [], mappings, onSchemaLoaded, fields, autoPick = true, label = 'Rows list', expressionFor, testId }: ResponseCollectionPickerProps) {
  const [local, setLocal] = useState<ResponseSchema | null>(null)
  useEffect(() => { setLocal(null) }, [referenceId])
  const effective = local ?? schema
  const view = useMemo(() => runtimeView(effective), [effective])
  const root = view.root && view.root.type !== 'any' ? view.root : null
  const candidates = useMemo(() => (root ? findCollections(root, view.sample) : []), [root, view.sample])
  const current = value ?? ''
  const check = useMemo(() => validateCollectionPath(root, current), [root, current])
  const chosenIsList = !!root && check.ok && check.schema?.type === 'array'

  // Smart default: nothing chosen and the response itself isn't a list → the only list of objects.
  const suggestion = autoPick && root && !current && !chosenIsList ? autoPickCollection(candidates) : null
  useEffect(() => {
    if (suggestion !== null && suggestion !== current) onChange(suggestion, { auto: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- when a suggestion appears
  }, [suggestion])

  const [typed, setTyped] = useState(current)
  useEffect(() => { setTyped(current) }, [current])
  const typedCheck = validateCollectionPath(root, typed)
  const applyTyped = () => { if (typedCheck.ok && typedCheck.path !== current) onChange(typedCheck.path, { auto: false }) }

  const itemFields = useMemo(() => collectionItemFields(check.ok ? check.itemSchema ?? null : null), [check])
  const paging = useMemo(() => pagingHints(root), [root])
  const lists = candidates.length
  const chosenNoFields = chosenIsList && !itemFields.length

  return (
    // contain: inline-size — long previews never widen the properties panel (fieldsets size to their content).
    <div className="min-w-0 space-y-1.5" style={{ contain: 'inline-size' }} data-testid={testId ?? 'response-collection-picker'}>
      <div className="flex items-center gap-2">
        <span className="text-2xs font-medium text-fg-muted">{label}</span>
        {root && <span className="text-2xs text-fg-muted">{lists} list{lists === 1 ? '' : 's'} in the response</span>}
      </div>
      {referenceId && (
        <LoadSampleButton referenceId={referenceId} inputs={inputs} mappings={mappings} compact={!!root}
          onLoaded={(loaded, saved) => { setLocal(loaded); onSchemaLoaded?.(loaded, saved) }} />
      )}
      {!root && (
        <p className="text-2xs text-fg-muted">
          No response model yet. {referenceId ? 'Load a sample to see the response and pick the list that holds the rows' : 'Test the reference to capture one'} — or type the list&apos;s path below.
        </p>
      )}
      {view.unwrapped && <p className="text-2xs text-fg-muted">Paths are inside the response body (<code>{view.unwrapped}</code>) — that is what is read at run time.</p>}
      {root && <CollectionTree key={referenceId ?? 'tree'} root={root} sample={view.sample} value={chosenIsList ? current : null} onSelect={(p) => onChange(p, { auto: false })} />}
      <div>
        <label className="flex items-center gap-1">
          <span className="shrink-0 text-2xs text-fg-muted">Path</span>
          <input className={inputCls} style={inputStyle} value={typed} placeholder="(the whole response) — e.g. contents, data.items, value[0].children"
            aria-label={`${label} path`} aria-invalid={!typedCheck.ok} data-testid="collection-path-input"
            onChange={(e) => setTyped(e.target.value)} onBlur={applyTyped} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyTyped() } }} />
        </label>
        {expressionFor && <p className="mt-0.5 truncate font-mono text-2xs text-fg-muted" title="What the step reads">{expressionFor(current)}</p>}
        {typedCheck.message && <p className="mt-0.5 text-2xs" role={typedCheck.ok || !typed ? undefined : 'alert'} style={typedCheck.ok || !typed ? muted : { color: 'var(--status-blocked)' }}>{typedCheck.message}</p>}
      </div>
      {chosenNoFields && <p className="text-2xs text-fg-muted">The model doesn&apos;t describe this list&apos;s items yet{referenceId ? ' — Load sample to see their fields' : ''}.</p>}
      {fields && itemFields.length > 0 && <CollectionFieldList fields={itemFields} selected={fields.selected} onAdd={fields.onAdd} />}
      {paging.length > 0 && (
        <p className="text-2xs text-fg-muted" data-testid="paging-hints">
          Paging keys: {paging.map((h, i) => <span key={h.path}>{i ? ', ' : ''}<code>{h.path}</code> ({PAGING_LABELS[h.kind]})</span>)}
        </p>
      )}
    </div>
  )
}
