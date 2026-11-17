'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, Lock, Plus, X } from 'lucide-react'
import type { LookupConfig } from '@/lib/forms/lookup'
import {
  BOUND_CONTROLS, GRID_CONTROLS, GRID_CONTROL_LABELS, GRID_LIMITS, controlsForType, gridColumnProblem, inferredColumn, isColumnEditable,
  type GridChoice, type GridColumnDef, type GridControl, type GridControlOptions, type TableSchemaColumn,
} from '@/lib/grid/column-model'
import { cn } from '@/lib/utils'

/**
 * The Columns editor of the shared grid engine (lib/grid/column-model.ts):
 * per column the control type, its options, the data binding (source,
 * filter, sort, value / display — the surface renders the lookup editor),
 * editable / read-only, required and width. The form designer's Data table
 * panel embeds ColumnControlFields per column; the Data grid's view
 * settings use GridColumnsEditor (pick, reorder, show / hide too).
 */

const field = 'h-7 w-full rounded border border-border bg-panel px-2 text-2xs text-fg'

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Toggle({ checked, onChange, children, testId }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; testId?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-fg" data-testid={testId}>
      <input type="checkbox" className="accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}
    </label>
  )
}

function choicesText(choices: GridChoice[] | undefined): string {
  return (choices ?? []).map((c) => (c.label && c.label !== c.value ? `${c.value} | ${c.label}` : c.value)).join('\n')
}

function parseChoices(text: string): GridChoice[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, GRID_LIMITS.choices).map((line) => {
    const [value, ...rest] = line.split('|')
    const label = rest.join('|').trim()
    return { value: value.trim(), ...(label ? { label } : {}) }
  }).filter((c) => c.value)
}

export interface ColumnControlFieldsProps {
  col: GridColumnDef
  /** The column's data type (the controls that suit it are offered first). */
  typeHint?: string
  onChange: (patch: Partial<GridColumnDef>, tag?: string) => void
  /** The binding editor (source, filter, sort, value / display): the surface's lookup editor. */
  renderBinding?: (binding: LookupConfig | undefined, onBinding: (binding: LookupConfig | undefined) => void) => React.ReactNode
  /** Hide the editable toggle (forms: the column's own "Read-only when editing"). */
  hideEditable?: boolean
  /** Hide choices / bounds (forms: a column whose control is its type's keeps its own fields). */
  hideNativeOptions?: boolean
  idBase: string
}

/** The control part of one column: control type, its options, binding, editable, required, width. */
export function ColumnControlFields({ col, typeHint, onChange, renderBinding, hideEditable, hideNativeOptions, idBase }: ColumnControlFieldsProps) {
  const suggested = controlsForType(typeHint)
  const others = GRID_CONTROLS.filter((c) => !suggested.includes(c))
  const o = col.control_options ?? {}
  const setOptions = (patch: Partial<GridControlOptions>, tag?: string) => {
    const next = { ...o, ...patch }
    for (const k of Object.keys(next) as Array<keyof GridControlOptions>) if (next[k] === undefined || next[k] === '' ) delete next[k]
    onChange({ control_options: Object.keys(next).length ? next : undefined }, tag)
  }
  const bound = BOUND_CONTROLS.has(col.control)
  const needsBinding = col.control === 'autocomplete' || col.control === 'lookup'
  const [useSource, setUseSource] = useState<boolean>(Boolean(col.binding) || needsBinding)
  const fromSource = needsBinding || useSource
  const problem = gridColumnProblem(col)
  return (
    <div className="space-y-1.5" data-grid-column-fields={col.key}>
      <div className="grid grid-cols-2 gap-1">
        <div>
          <Label htmlFor={`${idBase}-control`}>Control</Label>
          <select id={`${idBase}-control`} className={field} value={col.control} data-testid="grid-col-control"
            onChange={(e) => {
              const control = e.target.value as GridControl
              onChange({ control, control_options: undefined, ...(BOUND_CONTROLS.has(control) ? {} : { binding: undefined }), ...(control === 'display' ? { editable: false } : {}) })
              setUseSource(control === 'autocomplete' || control === 'lookup' || (BOUND_CONTROLS.has(control) && Boolean(col.binding)))
            }}>
            <optgroup label="Suits this column">{suggested.map((c) => <option key={c} value={c}>{GRID_CONTROL_LABELS[c]}</option>)}</optgroup>
            <optgroup label="Other controls">{others.map((c) => <option key={c} value={c}>{GRID_CONTROL_LABELS[c]}</option>)}</optgroup>
          </select>
        </div>
        <div>
          <Label htmlFor={`${idBase}-width`}>Width (px)</Label>
          <input id={`${idBase}-width`} type="number" min={40} max={800} className={field} value={col.width ?? ''} placeholder="Auto"
            onChange={(e) => onChange({ width: e.target.value ? Number(e.target.value) : undefined }, `${idBase}-width`)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {!hideEditable && col.control !== 'display' && (
          <Toggle checked={col.editable === false} onChange={(v) => onChange({ editable: v ? false : undefined })} testId="grid-col-readonly">Read-only</Toggle>
        )}
        {!hideEditable && col.control !== 'display' && <Toggle checked={col.required === true} onChange={(v) => onChange({ required: v || undefined })}>Required</Toggle>}
        {col.control === 'boolean' && <Toggle checked={o.boolean_style === 'toggle'} onChange={(v) => setOptions({ boolean_style: v ? 'toggle' : undefined })}>Show as a switch</Toggle>}
        {col.control === 'people' && <Toggle checked={o.multiple === true} onChange={(v) => setOptions({ multiple: v || undefined })}>Several people</Toggle>}
        {col.control === 'people' && <Toggle checked={o.allow_teams === true} onChange={(v) => setOptions({ allow_teams: v || undefined })}>Teams too</Toggle>}
      </div>

      {(col.control === 'number' || col.control === 'currency') && !hideNativeOptions && (
        <div className="grid grid-cols-3 gap-1">
          {col.control === 'currency' && (
            <div><Label htmlFor={`${idBase}-cur`}>Currency</Label><input id={`${idBase}-cur`} className={field} maxLength={3} value={o.currency ?? 'USD'} onChange={(e) => setOptions({ currency: e.target.value.toUpperCase() || undefined }, `${idBase}-cur`)} /></div>
          )}
          <div><Label htmlFor={`${idBase}-min`}>Minimum</Label><input id={`${idBase}-min`} type="number" className={field} value={o.min ?? ''} onChange={(e) => setOptions({ min: e.target.value === '' ? undefined : Number(e.target.value) }, `${idBase}-min`)} /></div>
          <div><Label htmlFor={`${idBase}-max`}>Maximum</Label><input id={`${idBase}-max`} type="number" className={field} value={o.max ?? ''} onChange={(e) => setOptions({ max: e.target.value === '' ? undefined : Number(e.target.value) }, `${idBase}-max`)} /></div>
          <div><Label htmlFor={`${idBase}-dec`}>Decimals</Label><input id={`${idBase}-dec`} type="number" min={0} max={10} className={field} value={o.decimals ?? ''} placeholder={col.control === 'currency' ? '2' : 'Any'} onChange={(e) => setOptions({ decimals: e.target.value === '' ? undefined : Number(e.target.value) }, `${idBase}-dec`)} /></div>
        </div>
      )}
      {(col.control === 'text' || col.control === 'multiline' || col.control === 'link') && !hideNativeOptions && (
        <div className="w-32"><Label htmlFor={`${idBase}-len`}>Max length</Label><input id={`${idBase}-len`} type="number" min={1} className={field} value={o.max_length ?? ''} onChange={(e) => setOptions({ max_length: e.target.value === '' ? undefined : Number(e.target.value) }, `${idBase}-len`)} /></div>
      )}
      {col.control === 'display' && (
        <div>
          <Label htmlFor={`${idBase}-formula`}>Formula (optional)</Label>
          <input id={`${idBase}-formula`} className={cn(field, 'font-mono')} placeholder="e.g. quantity * unit_price" value={o.formula ?? ''} onChange={(e) => setOptions({ formula: e.target.value || undefined }, `${idBase}-formula`)} />
          <p className="mt-0.5 text-2xs text-fg-muted">Empty: the stored value, read-only. A formula works it out from the row&apos;s number columns (+ − × ÷, brackets).</p>
        </div>
      )}
      {col.control === 'signature' && (
        <div className="grid grid-cols-2 gap-1">
          <div>
            <Label htmlFor={`${idBase}-sigmode`}>Sign by</Label>
            <select id={`${idBase}-sigmode`} className={field} value={o.signature?.mode ?? 'both'} onChange={(e) => setOptions({ signature: { ...(o.signature ?? {}), mode: e.target.value === 'both' ? undefined : e.target.value as 'draw' | 'type' } })}>
              <option value="both">Drawing or typing</option><option value="draw">Drawing only</option><option value="type">Typing only</option>
            </select>
          </div>
          <div><Label htmlFor={`${idBase}-sigstmt`}>Statement</Label><input id={`${idBase}-sigstmt`} className={field} placeholder="I confirm…" value={o.signature?.statement ?? ''} onChange={(e) => setOptions({ signature: { ...(o.signature ?? {}), statement: e.target.value || undefined } }, `${idBase}-sigstmt`)} /></div>
        </div>
      )}

      {bound && (
        <div className="space-y-1 rounded border border-border p-1.5" data-testid="grid-col-binding">
          {!needsBinding && (
            <div className="flex gap-1" role="radiogroup" aria-label="Options from">
              {[[false, 'A list of choices'], [true, 'A data table or API']].map(([value, text]) => (
                <button key={String(value)} type="button" role="radio" aria-checked={fromSource === value}
                  className={cn('h-6 flex-1 rounded border text-2xs font-medium', fromSource === value ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg')}
                  onClick={() => { setUseSource(Boolean(value)); if (!value) onChange({ binding: undefined }) }}>{String(text)}</button>
              ))}
            </div>
          )}
          {fromSource
            ? (renderBinding ? renderBinding(col.binding, (binding) => onChange({ binding }, `${idBase}-binding`)) : <p className="text-2xs text-fg-muted">Binding is not available here.</p>)
            : !hideNativeOptions && (
              <div>
                <Label htmlFor={`${idBase}-choices`}>Choices (one per line; &quot;value | label&quot; to show a different label)</Label>
                <textarea id={`${idBase}-choices`} className={cn(field, 'h-20 py-1 font-mono')} defaultValue={choicesText(o.choices)} onBlur={(e) => setOptions({ choices: parseChoices(e.target.value) })} data-testid="grid-col-choices" />
              </div>
            )}
          {fromSource && <p className="text-2xs text-fg-muted">The value stored is the binding&apos;s value column; people see its display columns (or template). Filters may read this row ({'{{row.<column>}}'}) for cascading choices.</p>}
        </div>
      )}
      {problem && <p className="text-2xs text-(--status-blocked)" role="alert" data-grid-column-problem>{problem}</p>}
    </div>
  )
}

/**
 * The Data grid view's Columns editor: the view's columns (reorder, show /
 * hide, remove, edit) and the table's columns not shown yet (add).
 */
export function GridColumnsEditor({ columns, tableColumns, onChange, renderBinding }: {
  columns: GridColumnDef[]
  tableColumns: TableSchemaColumn[]
  onChange: (columns: GridColumnDef[]) => void
  renderBinding?: (col: GridColumnDef, binding: LookupConfig | undefined, onBinding: (binding: LookupConfig | undefined) => void) => React.ReactNode
}) {
  const [open, setOpen] = useState<string | null>(null)
  const typeOf = (key: string) => tableColumns.find((c) => c.key === key)?.type
  const notShown = tableColumns.filter((c) => !columns.some((x) => x.key === c.key))
  const patch = (i: number, p: Partial<GridColumnDef>) => onChange(columns.map((c, j) => (j === i ? { ...c, ...p } : c)))
  const move = (i: number, d: number) => { const next = [...columns]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next) }
  return (
    <div className="space-y-1" data-testid="grid-columns-editor">
      {columns.map((col, i) => {
        const isOpen = open === col.key
        return (
          <div key={col.key} className="rounded border border-border" data-grid-column={col.key}>
            <div className="flex items-center gap-1 px-1.5 py-1 text-xs">
              <button type="button" className="rounded p-0.5" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Edit'} ${col.label}`} onClick={() => setOpen(isOpen ? null : col.key)}>
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              <span className={cn('flex-1 truncate', col.hidden && 'opacity-50')}>
                {col.label}<span className="text-fg-muted"> · {GRID_CONTROL_LABELS[col.control]}</span>
              </span>
              {!isColumnEditable(col) && <Lock size={11} className="text-fg-muted" aria-label="Read-only" />}
              <button type="button" className="rounded p-0.5" aria-pressed={!col.hidden} aria-label={col.hidden ? `Show ${col.label}` : `Hide ${col.label}`} onClick={() => patch(i, { hidden: col.hidden ? undefined : true })}>{col.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
              <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === 0} aria-label={`Move ${col.label} up`} onClick={() => move(i, -1)}><ArrowUp size={12} /></button>
              <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === columns.length - 1} aria-label={`Move ${col.label} down`} onClick={() => move(i, 1)}><ArrowDown size={12} /></button>
              <button type="button" className="rounded p-0.5" aria-label={`Remove ${col.label}`} onClick={() => onChange(columns.filter((_, j) => j !== i))}><X size={12} /></button>
            </div>
            {isOpen && (
              <div className="space-y-1.5 border-t border-border p-1.5">
                <div>
                  <Label htmlFor={`gc-${col.key}-label`}>Header</Label>
                  <input id={`gc-${col.key}-label`} className={field} value={col.label} onChange={(e) => patch(i, { label: e.target.value })} />
                </div>
                <ColumnControlFields idBase={`gc-${col.key}`} col={col} typeHint={typeOf(col.key)} onChange={(p) => patch(i, p)}
                  renderBinding={renderBinding ? (binding, onBinding) => renderBinding(col, binding, onBinding) : undefined} />
              </div>
            )}
          </div>
        )
      })}
      {notShown.length > 0 && columns.length < GRID_LIMITS.columns && (
        <div className="flex items-center gap-1">
          <Plus size={12} className="text-fg-muted" aria-hidden />
          <select aria-label="Add a column" className={field} value="" data-testid="grid-add-column"
            onChange={(e) => { const c = tableColumns.find((x) => x.key === e.target.value); if (c) onChange([...columns, inferredColumn(c)]) }}>
            <option value="">Add a column…</option>
            {notShown.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}
