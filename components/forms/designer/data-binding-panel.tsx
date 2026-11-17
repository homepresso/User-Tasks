'use client'

/* eslint-disable @typescript-eslint/no-explicit-any -- table / reference rows are free-form JSON */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Ban, Check, Database, ExternalLink, Info, Link2, Lock, Plus, Unlink } from 'lucide-react'
import { SearchInput } from '@/components/ui/input'
import { serverRead } from '@/lib/server-read'
import type { DesignerField, DesignerState } from '@/lib/forms/designer-state'
import { bindingCapabilities, type DataBindingKind, type FormDataBinding } from '@/lib/forms/data-binding'
import { defaultRecordParam } from '@/lib/forms/data-binding-sources'
import { layoutFormParams, type FormParam } from '@/lib/forms/form-params'
import type { FormDefinition } from '@/lib/forms/definition'
import type { FormSourceState } from '@/lib/services/form-sources'
import type { FormTargetSourceField } from '@/lib/extensions/sdk'
import { TASK_FIELD_TYPE_LABELS, type TaskFieldType } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'
import { DRAG_SOURCE_FIELD, FIELD_ICONS, paletteGroupClass } from './field-icons'

/**
 * Data binding in the form designer (lib/forms/data-binding.ts):
 *
 *  - DataSourcePanel   the "Data" section beside the Outline: every field of
 *                      the bound source, grouped, with a type icon, required
 *                      and read-only markers, "new" columns, search, and
 *                      whether it is on the form. Drag one onto the grid (the
 *                      palette's drop zones), or click / Enter to add it;
 *                      "Add all missing fields". A field already on the form
 *                      selects it on the canvas.
 *  - DataBindingSettings  the Data tab's "Data binding" section: choose None /
 *                      a Data table / an API reference (row id parameter,
 *                      saving rows, reference inputs). A form bound to an
 *                      extension target (e.g. a SharePoint list) is bound by
 *                      that extension: shown locked to it.
 *  - BoundToProperty   a field's "Bound to: <source field>" (change / clear).
 *
 * One code path for every source: the server describes it in the extension
 * SDK's FormTargetDescription shape (forms.sourceDescribe) and changes the
 * mapping through bind (bindFormSource) — the provider's own hooks for an
 * extension target, core's for tables and references.
 */

/** The bound source as the designer reads it (forms.sourceDescribe), refreshed when the binding or the fields change. */
export function useFormSource({ formId, name, definition }: { formId?: string; name: string; definition: FormDefinition }) {
  const layout = (definition.layout ?? {}) as Record<string, any>
  const target = layout.data_target ?? null
  const binding = target ? null : layout.data_binding ?? null
  const bound = Boolean(target || binding)
  // Extension targets map inside their config: ask again when the fields change; core bindings when the binding does.
  const key = JSON.stringify([formId ?? null, target, binding, target ? definition.fields.map((f) => [f.key, f.type]) : definition.fields.map((f) => f.key)])
  return useQuery({
    queryKey: ['form-source', key],
    enabled: bound,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<FormSourceState> => {
      const { data, error } = await serverRead('forms.sourceDescribe', { ...(formId ? { id: formId } : {}), name, fields: definition.fields as never, layout: definition.layout as never })
      if (error) throw new Error(error.message)
      return data as FormSourceState
    },
  })
}

/** Form field key → source field key: the core binding's own map (instant), else the provider's description. */
export function sourceMapping(state: Pick<DesignerState, 'layout'>, source: FormSourceState | undefined): Map<string, string> {
  const layout = state.layout as Record<string, any>
  if (!layout.data_target && layout.data_binding?.fields) return new Map(Object.entries(layout.data_binding.fields as Record<string, string>))
  return new Map((source?.description?.mappings ?? []).filter((m) => m.source).map((m) => [m.field, m.source as string]))
}

const GROUP_ORDER = ['columns', 'fields', 'lookups', 'nested', 'system']
const GROUP_LABELS: Record<string, string> = { columns: 'Columns', fields: 'Fields', lookups: 'Lookups', nested: 'Nested fields', system: 'System and read-only' }
const groupLabel = (g: string) => GROUP_LABELS[g] ?? (g ? g[0].toUpperCase() + g.slice(1) : 'Fields')

function sourceIcon(field: FormTargetSourceField) {
  const type = field.fieldTypes[0] as TaskFieldType | undefined
  return type ? FIELD_ICONS[type] ?? Database : Ban
}

export function DataSourcePanel({ state, source, loading, error, mapping, selectedId, busy, readOnly, onSelectField, onAdd, onChooseSource }: {
  state: DesignerState
  source: FormSourceState | undefined
  loading: boolean
  error: string | null
  mapping: Map<string, string>
  selectedId: string | null
  busy: boolean
  readOnly?: boolean
  onSelectField: (id: string) => void
  onAdd: (sourceKeys: string[]) => void
  onChooseSource: () => void
}) {
  const [query, setQuery] = useState('')
  const layout = state.layout as Record<string, any>
  const bound = Boolean(layout.data_target || layout.data_binding)
  const fieldsBySource = useMemo(() => {
    const out = new Map<string, DesignerField>()
    const byKey = new Map(state.fields.map((f) => [f.key, f]))
    for (const [key, src] of mapping) { const f = byKey.get(key); if (f && !out.has(src)) out.set(src, f) }
    return out
  }, [mapping, state.fields])
  const all = source?.description?.sourceFields ?? []
  const q = query.trim().toLowerCase()
  const shown = all.filter((f) => !q || f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q) || f.typeLabel.toLowerCase().includes(q))
  const groups = [...new Set([...GROUP_ORDER, ...shown.map((f) => f.group ?? 'fields')])].map((g) => ({ key: g, items: shown.filter((f) => (f.group ?? 'fields') === g) })).filter((g) => g.items.length)
  const missing = all.filter((f) => f.fieldTypes.length && !fieldsBySource.has(f.key) && !f.readOnly)
  const canBind = Boolean(source?.bind) && !readOnly
  const caps = layout.data_binding && !layout.data_target ? bindingCapabilities(layout.data_binding as FormDataBinding) : null

  if (!bound) {
    return (
      <div className="space-y-2 px-3 py-2 text-xs text-fg-muted" data-data-panel="none">
        <p>Bind the form to a data source (a Data table or an API reference) to list its fields here: drag them onto the form, or click to add.</p>
        {!readOnly && <button type="button" onClick={onChooseSource} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline" data-choose-source="">
          <Link2 size={12} aria-hidden /> Choose a data source
        </button>}
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-col" data-data-panel={source?.kind ?? 'loading'}>
      <div className="space-y-1.5 px-3 pb-2 pt-1">
        <div className="flex min-w-0 items-start gap-1.5 text-xs">
          {source?.locked ? <Lock size={12} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden /> : <Database size={12} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-fg" title={source?.description?.title ?? source?.label}>{source?.description?.title ?? source?.label ?? 'Loading the data source…'}</p>
            <p className="text-2xs text-fg-muted" data-source-access="">
              {source?.locked ? 'Bound by its extension: loads and saves records' : source ? (source.writable ? 'Loads and saves rows' : 'Read only: prefills the form') : ''}
            </p>
          </div>
          {!readOnly && !source?.locked && <button type="button" onClick={onChooseSource} className="shrink-0 text-2xs font-medium text-primary-text hover:underline" aria-label="Change the data source">Change</button>}
        </div>
        {error && <p className="flex items-start gap-1 text-2xs text-danger" role="alert"><AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden />{error}</p>}
        {(source?.description?.notes ?? []).filter((n) => n.severity !== 'info').slice(0, 3).map((n, i) => (
          <p key={i} className={cn('flex items-start gap-1 text-2xs', n.severity === 'error' ? 'text-danger' : 'text-warning')}><AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden />{n.message}</p>
        ))}
        {caps && !caps.writable && <p className="flex items-start gap-1 text-2xs text-fg-muted" data-read-only-source=""><Info size={11} className="mt-0.5 shrink-0" aria-hidden />{caps.saves}</p>}
        {source && !source.bind && !source.locked && <p className="text-2xs text-fg-muted">This source can&apos;t be mapped here.</p>}
        {source?.locked && !source.bind && <p className="text-2xs text-fg-muted">Its provider doesn&apos;t offer field mapping in the designer yet.</p>}
        {all.length > 0 && <SearchInput size="sm" aria-label="Search the data source's fields" placeholder="Search data fields" value={query} onValueChange={setQuery} />}
        {canBind && missing.length > 0 && (
          <button type="button" disabled={busy} onClick={() => onAdd(missing.map((f) => f.key))} className="inline-flex items-center gap-1 text-2xs font-medium text-primary-text hover:underline disabled:opacity-50" data-add-all-missing="">
            <Plus size={11} aria-hidden /> Add all missing fields ({missing.length})
          </button>
        )}
        {canBind && all.length > 0 && <p className="text-2xs text-fg-muted">Drag onto the grid, or press Enter to add.</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin" aria-busy={loading || busy}>
        {loading && !source && <p className="px-2 py-1 text-xs text-fg-muted">Loading…</p>}
        {source && !all.length && <p className="px-2 py-1 text-xs text-fg-muted">The source has no fields to list.</p>}
        {groups.map((group) => (
          <div key={group.key} className="mb-2" role="group" aria-labelledby={`data-group-${group.key}`}>
            <p id={`data-group-${group.key}`} className={paletteGroupClass}>{groupLabel(group.key)}</p>
            <ul>
              {group.items.map((f) => {
                const Icon = sourceIcon(f)
                const onForm = fieldsBySource.get(f.key)
                const bindable = f.fieldTypes.length > 0 && canBind
                const selected = onForm && onForm._id === selectedId
                const label = onForm ? `${f.label}, ${f.typeLabel}, on the form as "${onForm.label || onForm.key}": select it`
                  : bindable ? `Add ${f.label} (${f.typeLabel}${f.required ? ', required' : ''}${f.readOnly ? ', read only' : ''}) to the form` : `${f.label} (${f.typeLabel}) can't be added${f.help ? `: ${f.help}` : ''}`
                return (
                  <li key={f.key}>
                    <button
                      type="button"
                      draggable={bindable && !onForm}
                      onDragStart={(e) => { e.dataTransfer.setData(DRAG_SOURCE_FIELD, f.key); e.dataTransfer.effectAllowed = 'copy' }}
                      onClick={() => { if (onForm) onSelectField(onForm._id); else if (bindable && !busy) onAdd([f.key]) }}
                      aria-disabled={!onForm && !bindable ? true : undefined}
                      aria-label={label}
                      aria-pressed={onForm ? Boolean(selected) : undefined}
                      title={f.help ?? undefined}
                      className={cn('flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-subtle', selected && 'bg-primary-wash text-primary-text', !onForm && !bindable && 'cursor-default opacity-60', bindable && !onForm && 'cursor-grab')}
                      data-source-field={f.key}
                      data-on-form={onForm ? onForm.key : undefined}
                    >
                      <Icon size={13} className="shrink-0 text-fg-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {f.label}
                        {f.required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
                      </span>
                      {f.isNew && <span className="shrink-0 rounded bg-info-wash px-1 text-2xs font-medium text-info" data-source-new="">new</span>}
                      {f.readOnly && <Lock size={10} className="shrink-0 text-fg-muted" aria-hidden />}
                      {onForm ? <Check size={12} className="shrink-0 text-success" aria-hidden /> : <span className="shrink-0 text-2xs text-fg-muted">{f.typeLabel}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Data tab: choosing the source ────────────────────────────────── */

const ROW_PARAM: FormParam = { name: 'row_id', label: 'Row id', type: 'text', source: 'url', query_name: 'row', description: 'The data table row this form loads and updates' }

export function DataBindingSettings({ state, source, readOnly, onChange }: {
  state: DesignerState
  source: FormSourceState | undefined
  readOnly?: boolean
  onChange: (next: DesignerState, tag?: string) => void
}) {
  const layout = state.layout as Record<string, any>
  const target = layout.data_target
  const binding = target ? null : (layout.data_binding as FormDataBinding | undefined) ?? null
  const [kind, setKind] = useState<'none' | DataBindingKind>(binding?.kind ?? 'none')
  const { data: tables = [], isLoading: tablesLoading } = useQuery({
    queryKey: ['forms-table-columns'], enabled: !target && kind === 'table', staleTime: 60_000,
    queryFn: async () => (await serverRead('forms.tableColumns')).data ?? [],
  })
  const { data: refs, isLoading: refsLoading } = useQuery({
    queryKey: ['forms-lookup-references-binding'], enabled: !target && kind === 'reference', staleTime: 60_000,
    queryFn: async () => { const r = await serverRead('integrations.references'); return { rows: (r.data ?? []) as any[], error: r.error?.message ?? null } },
  })
  const params = layoutFormParams(state.layout)

  if (target) {
    return (
      <section className="space-y-1.5 rounded-md border border-border-subtle p-2 text-xs" aria-label="Data binding" data-binding-settings="target">
        <p className="flex items-center gap-1 font-semibold"><Lock size={12} aria-hidden /> Data binding</p>
        <p>Bound to <strong>{source?.description?.title ?? source?.label ?? target.label ?? 'an extension\'s records'}</strong>, automatically: this form loads and saves its records.</p>
        <p className="text-2xs text-fg-muted">The source is set by its extension and can&apos;t be changed here. Its fields are in the Data panel beside the Outline; the connection&apos;s own settings are in its &ldquo;Connected to {source?.label ?? target.label ?? 'the source'}&rdquo; panel.</p>
        {(source?.description?.facts ?? []).map((f) => <p key={f.label} className="text-2xs"><span className="text-fg-muted">{f.label}:</span> {f.value}</p>)}
        {source?.description?.link && <a href={source.description.link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-2xs text-primary-text hover:underline">{source.description.link.label}<ExternalLink size={10} aria-hidden /></a>}
      </section>
    )
  }

  const setBinding = (next: FormDataBinding | null, extraParams?: FormParam[]) => {
    const out = { ...state.layout } as Record<string, any>
    if (next) out.data_binding = next
    else delete out.data_binding
    if (extraParams?.length) out.params = [...params, ...extraParams.filter((p) => !params.some((q) => q.name === p.name))]
    onChange({ ...state, layout: out as DesignerState['layout'] }, 'data-binding')
  }
  const chooseTable = (id: string) => {
    const table = tables.find((t: any) => t.id === id)
    if (!table) { setBinding(null); return }
    const recordParam = defaultRecordParam(state.layout) ?? undefined
    setBinding({ kind: 'table', source_id: id, label: table.name, fields: binding?.source_id === id ? binding.fields : {}, ...(recordParam ? { record_param: recordParam } : {}) })
  }
  const chooseReference = (id: string) => {
    const ref = refs?.rows.find((r) => String(r.id) === id)
    if (!ref) { setBinding(null); return }
    const declared = new Set(params.map((p) => p.name))
    const inputs = Object.fromEntries((Array.isArray(ref.inputs) ? ref.inputs : []).map((i: any) => String(i?.name ?? '')).filter(Boolean).map((n: string) => [n, declared.has(n) ? `{{param.${n}}}` : '']).filter(([, v]: [string, string]) => v))
    setBinding({ kind: 'reference', source_id: String(ref.id), ...(ref.integration?.id ? { integration_id: String(ref.integration.id) } : {}), label: String(ref.name), fields: binding?.source_id === id ? binding.fields : {}, ...(Object.keys(inputs).length ? { inputs } : {}) })
  }
  const refInputs: string[] = kind === 'reference' && binding ? (Array.isArray(refs?.rows.find((r) => String(r.id) === binding.source_id)?.inputs) ? refs!.rows.find((r) => String(r.id) === binding.source_id)!.inputs.map((i: any) => String(i?.name ?? '')).filter(Boolean) : []) : []
  const caps = binding ? bindingCapabilities(binding) : null
  const boundCount = binding ? Object.keys(binding.fields).length : 0

  return (
    <section className="space-y-2 rounded-md border border-border-subtle p-2 text-xs" aria-label="Data binding" data-binding-settings={binding?.kind ?? 'none'}>
      <p className="font-semibold">Data binding</p>
      <p className="text-2xs text-fg-muted">The data source whose fields the Data panel lists. Bound fields load from it; tables can also be written.</p>
      <div>
        <label htmlFor="data-binding-kind" className="mb-0.5 block text-2xs font-semibold text-fg-muted">Source</label>
        <select id="data-binding-kind" className={inputClass} value={kind} disabled={readOnly}
          onChange={(e) => { const next = e.target.value as 'none' | DataBindingKind; setKind(next); if (next === 'none' || (binding && binding.kind !== next)) setBinding(null) }}>
          <option value="none">None</option>
          <option value="table">A data table</option>
          <option value="reference">An API reference</option>
        </select>
        <p className="mt-0.5 text-2xs text-fg-muted">Forms for a SharePoint list (or another extension&apos;s records) are bound by that extension, automatically.</p>
      </div>
      {kind === 'table' && (
        <div className="space-y-2">
          <div>
            <label htmlFor="data-binding-table" className="mb-0.5 block text-2xs font-semibold text-fg-muted">Data table</label>
            <select id="data-binding-table" className={inputClass} value={binding?.kind === 'table' ? binding.source_id : ''} disabled={readOnly || tablesLoading} onChange={(e) => chooseTable(e.target.value)}>
              <option value="">{tablesLoading ? 'Loading…' : 'Choose a table…'}</option>
              {tables.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {binding?.kind === 'table' && (<>
            <div>
              <label htmlFor="data-binding-row" className="mb-0.5 block text-2xs font-semibold text-fg-muted">Row to load</label>
              <select id="data-binding-row" className={inputClass} value={binding.record_param ?? ''} disabled={readOnly}
                onChange={(e) => { const v = e.target.value; const b = { ...binding }; if (v) b.record_param = v; else delete b.record_param; setBinding(b) }}>
                <option value="">None (a new row each time)</option>
                {params.filter((p) => p.type === 'text' || p.type === 'number').map((p) => <option key={p.name} value={p.name}>The row id in parameter “{p.name}”</option>)}
              </select>
              {!params.some((p) => p.name === 'row_id') && !readOnly && (
                <button type="button" className="mt-1 text-2xs font-medium text-primary-text hover:underline" onClick={() => setBinding({ ...binding, record_param: 'row_id' }, [ROW_PARAM])} data-add-row-param="">
                  Add a “row_id” URL parameter (?row=…) and load that row
                </button>
              )}
            </div>
            <label className="flex items-start gap-1.5">
              <input type="checkbox" className="mt-0.5" checked={Boolean(binding.save)} disabled={readOnly}
                onChange={(e) => { const b = { ...binding }; if (e.target.checked) b.save = true; else delete b.save; setBinding(b) }} data-binding-save="" />
              <span>Save to the table when the form is submitted <span className="block text-2xs text-fg-muted">Updates the loaded row, or adds a row when none was loaded, with the submitter&apos;s own data rights (data.manage_rows).</span></span>
            </label>
          </>)}
        </div>
      )}
      {kind === 'reference' && (
        <div className="space-y-2">
          <div>
            <label htmlFor="data-binding-reference" className="mb-0.5 block text-2xs font-semibold text-fg-muted">API reference</label>
            <select id="data-binding-reference" className={inputClass} value={binding?.kind === 'reference' ? binding.source_id : ''} disabled={readOnly || refsLoading} onChange={(e) => chooseReference(e.target.value)}>
              <option value="">{refsLoading ? 'Loading…' : 'Choose a reference…'}</option>
              {(refs?.rows ?? []).map((r) => <option key={r.id} value={String(r.id)}>{String(r.name)}{r.integration?.name ? ` · ${r.integration.name}` : ''}</option>)}
            </select>
            {refs?.error && <p className="mt-0.5 text-2xs text-danger">{refs.error}</p>}
          </div>
          {binding?.kind === 'reference' && refInputs.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="text-2xs font-semibold text-fg-muted">Inputs</legend>
              {refInputs.map((name) => (
                <div key={name} className="flex items-center gap-1.5">
                  <label htmlFor={`data-binding-input-${name}`} className="w-24 shrink-0 truncate font-mono text-2xs">{name}</label>
                  <input id={`data-binding-input-${name}`} className={inputClass} value={binding.inputs?.[name] ?? ''} placeholder="{{param.customer_id}}" disabled={readOnly}
                    onChange={(e) => { const inputs = { ...(binding.inputs ?? {}) }; if (e.target.value) inputs[name] = e.target.value; else delete inputs[name]; const b: FormDataBinding = { ...binding }; if (Object.keys(inputs).length) b.inputs = inputs; else delete b.inputs; setBinding(b) }} />
                </div>
              ))}
            </fieldset>
          )}
        </div>
      )}
      {caps && (
        <div className="space-y-0.5 text-2xs" data-binding-capabilities="">
          <p><span className="text-fg-muted">Loads:</span> {caps.loads}</p>
          <p className={caps.writable ? undefined : 'text-warning'}><span className="text-fg-muted">Saves:</span> {caps.saves}</p>
          <p className="text-fg-muted">{boundCount} field{boundCount === 1 ? '' : 's'} bound. The loads and saves run as managed form rules.</p>
        </div>
      )}
    </section>
  )
}

/* ── Field properties: "Bound to" ─────────────────────────────────── */

export function BoundToProperty({ field, source, mapping, busy, readOnly, onBind }: {
  field: DesignerField
  source: FormSourceState | undefined
  mapping: Map<string, string>
  busy: boolean
  readOnly?: boolean
  onBind: (sourceKey: string | null) => void
}) {
  if (!source || source.kind === 'none') return null
  const current = mapping.get(field.key) ?? null
  const fields = source.description?.sourceFields ?? []
  const currentField = fields.find((f) => f.key === current)
  const locked = source.description?.mappings.find((m) => m.field === field.key)?.locked
  const compatible = fields.filter((f) => f.fieldTypes.includes(field.type as TaskFieldType))
  const id = `bound-to-${field._id}`
  return (
    <div className="space-y-1 rounded-md border border-border-subtle p-2" data-bound-to={current ?? ''}>
      <label htmlFor={id} className="flex items-center gap-1 text-2xs font-semibold text-fg-muted">
        {current ? <Link2 size={11} aria-hidden /> : <Unlink size={11} aria-hidden />} Bound to
      </label>
      {locked || !source.bind || readOnly ? (
        <p className="text-xs">{currentField ? `${currentField.label} (${currentField.typeLabel})` : current ?? 'Not bound'}{locked ? ' · managed by the connection' : ''}</p>
      ) : (
        <div className="flex items-center gap-1">
          <select id={id} className={inputClass} value={current ?? ''} disabled={busy} onChange={(e) => onBind(e.target.value || null)}>
            <option value="">Not bound</option>
            {current && !compatible.some((f) => f.key === current) && <option value={current}>{currentField?.label ?? current} (doesn&apos;t fit a {TASK_FIELD_TYPE_LABELS[field.type as TaskFieldType] ?? field.type} field)</option>}
            {compatible.map((f) => <option key={f.key} value={f.key}>{f.label} ({f.typeLabel})</option>)}
          </select>
          {current && <button type="button" className="shrink-0 rounded p-1 text-fg-muted hover:text-fg" aria-label="Clear the binding" title="Clear the binding" disabled={busy} onClick={() => onBind(null)}><Unlink size={12} /></button>}
        </div>
      )}
      <p className="text-2xs text-fg-muted">{current ? (source.writable ? `Loads from and saves to ${source.label}.` : `Loads from ${source.label} (read only).`) : `Not tied to ${source.label}: kept with the submission only.`}</p>
    </div>
  )
}
