'use client'

/**
 * The custom reference builder: a guided editor for a tidy, reusable
 * reference — name and kind, source (an operation of the integration or a
 * database table/view), declared inputs (Ask callers / Fixed value), rows
 * and columns, filter, sort, distinct, paging, and a live Test through the
 * real executor. Write kinds (Create, Update, Upsert, Delete, Execute) add
 * the request body builder, the database write / procedure, safety caps and
 * a dry-run Test (write-sections.tsx). Saving builds the public inputs, outputs and response model
 * on the server (lib/services/custom-references).
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FlaskConical, Loader2, Play, Save, Server } from 'lucide-react'
import { serverRead } from '@/lib/server-read'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DialogFooter } from '@/components/ui/dialog'
import { JsonViewer } from '@/components/integrations/json-viewer'
import { cn } from '@/lib/utils'
import { ResponseCollectionPicker } from '@/components/integrations/response-collection-picker'
import { createCustomReference, updateCustomReference } from '@/app/actions/integration-references'
import { collectionItemFields, runtimeView, validateCollectionPath } from '@/lib/response-collections'
import type { ResponseSchema } from '@/lib/response-schema'
import { normalizeCustomConfig } from '@/lib/custom-references/normalize'
import { describeShaping } from '@/lib/custom-references/shaping'
import { columnName, isWriteKind, type CustomColumn, type CustomInput, type CustomKind, type CustomReferenceConfig, type FilterGroup, type SortSpec, type SourceInputDef, type SourceParam, type WriteConfig } from '@/lib/custom-references/types'
import { defaultMethodFor } from '@/lib/custom-references/write'
import { ColumnsEditor, FilterEditor, InputsEditor, OptionalSelect, ParamsEditor, Section, SortEditor, border, fieldCls, fieldStyle, muted } from './sections'
import { DbWriteEditor, ExecuteEditor, KindPicker, RequestPreview, RestWriteEditor, WriteTestButtonLabel, WriteTestResult, WritesDataBadge } from './write-sections'

/* eslint-disable @typescript-eslint/no-explicit-any -- draft JSON and API responses */

interface Sources {
  integration: { id: string; name: string; type: string }
  database: boolean
  references: Array<{ id: string; name: string; method: string; path_template: string; inputs: SourceInputDef[] }>
  templates: Array<{ key: string; name: string; method: string; path_template: string; inputs: SourceInputDef[] }>
  operations: Array<{ key: string; name: string; method: string; path_template: string; inputs: SourceInputDef[] }>
  settings: Array<{ name: string; secret: boolean }>
}

export interface CustomReferenceBuilderProps {
  integrationId: string
  /** An existing custom reference to edit (null = new). */
  reference?: { id: string; name: string; description?: string | null; request_config?: any } | null
  /** Preselect a source operation (e.g. from a reference row). */
  initialSourceReferenceId?: string
  onClose: () => void
  onSaved: (id: string) => void
}

type SourceChoice = string // 'keep' | 'ref:<id>' | 'tpl:<key>' | 'op:<key>' | 'endpoint' | 'table'

const emptyFilter = (): FilterGroup => ({ op: 'and', conditions: [] })

/** The write settings that apply to the source (REST vs database). */
function cleanWrite(write: WriteConfig, isTable: boolean): WriteConfig {
  const { method, body, success_statuses, set, key, returning, procedure, max_affected, ...common } = write
  return isTable ? { ...common, set, key, returning, procedure, max_affected } : { ...common, method, body, success_statuses }
}

export function CustomReferenceBuilder({ integrationId, reference, initialSourceReferenceId, onClose, onSaved }: CustomReferenceBuilderProps) {
  const stored: Partial<CustomReferenceConfig> = reference?.request_config?.custom ?? {}
  const { data: sources } = useQuery({
    queryKey: ['custom-reference-sources', integrationId],
    queryFn: async () => (await serverRead('integrations.customReferenceSources', { integrationId })).data as Sources,
  })

  const [name, setName] = useState(reference?.name ?? '')
  const [description, setDescription] = useState(reference?.description ?? '')
  const [kind, setKind] = useState<CustomKind>(stored.kind ?? 'list')
  const [write, setWrite] = useState<WriteConfig>(stored.write ?? {})
  const writes = isWriteKind(kind)
  const [choice, setChoice] = useState<SourceChoice>(reference ? (stored.source?.type === 'table' ? 'table' : 'keep') : initialSourceReferenceId ? `ref:${initialSourceReferenceId}` : '')
  const [endpoint, setEndpoint] = useState({ method: 'GET', path_template: '', body_template: '' })
  const [table, setTable] = useState<{ schema?: string; table: string; columns: Array<{ name: string; type?: string }> } | null>(stored.source?.type === 'table' ? stored.source : null)
  const [inputs, setInputs] = useState<CustomInput[]>(stored.inputs ?? [])
  const [params, setParams] = useState<SourceParam[]>(stored.source?.type === 'operation' ? stored.source.params ?? [] : [])
  const [rowsPath, setRowsPath] = useState(stored.rows_path ?? '')
  const [columns, setColumns] = useState<CustomColumn[]>(stored.columns ?? [])
  const [filter, setFilter] = useState<FilterGroup>(stored.filter ?? emptyFilter())
  const [sort, setSort] = useState<SortSpec[]>(stored.sort ?? [])
  const [distinct, setDistinct] = useState(Boolean(stored.distinct))
  const [pageSize, setPageSize] = useState(String(stored.page_size ?? ''))
  const [maxRows, setMaxRows] = useState(String(stored.max_rows ?? ''))
  const [pagingInputs, setPagingInputs] = useState(Boolean(stored.paging_inputs))
  const [includeTotal, setIncludeTotal] = useState(Boolean(stored.include_total))
  const [api, setApi] = useState<Record<string, string | undefined>>((stored.api as any) ?? {})
  const [read, setRead] = useState<{ key_input?: string; key_field?: string; not_found?: 'null' | 'error' }>(stored.read ?? { not_found: 'null' })
  const [sourceSchema, setSourceSchema] = useState<ResponseSchema | null>(null)
  const [samples, setSamples] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<null | 'sample' | 'test' | 'save'>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [preview, setPreview] = useState<any>(null)

  // Database tables (table source).
  const [tables, setTables] = useState<Array<{ schema: string; name: string; type: string }>>([])
  useEffect(() => {
    if (choice !== 'table' || tables.length) return
    void fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tables', integrationId }) })
      .then((r) => r.json()).then((j) => setTables(Array.isArray(j?.tables) ? j.tables : [])).catch(() => {})
  }, [choice, integrationId, tables.length])
  async function pickTable(value: string) {
    const [schema, tableName] = value.split('\u0001')
    if (!tableName) { setTable(null); return }
    const resp = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'describe', integrationId, schema, table: tableName }) })
    const json = await resp.json().catch(() => ({}))
    const cols = (Array.isArray(json?.columns) ? json.columns : []).map((c: any) => ({ name: String(c.column ?? c.name), type: c.type ? String(c.type) : undefined }))
    setTable({ schema: schema || undefined, table: tableName, columns: cols })
    setColumns(cols.slice(0, 8).map((c: any) => ({ path: c.name })))
  }

  // The operation's own parameters for the chosen source.
  const sourceInputs: SourceInputDef[] = useMemo(() => {
    if (choice === 'keep') return stored.source?.type === 'operation' ? stored.source.inputs ?? [] : []
    if (choice.startsWith('ref:')) return sources?.references.find((r) => r.id === choice.slice(4))?.inputs ?? []
    if (choice.startsWith('tpl:')) return sources?.templates.find((t) => t.key === choice.slice(4))?.inputs ?? []
    if (choice.startsWith('op:')) return sources?.operations.find((o) => o.key === choice.slice(3))?.inputs ?? []
    if (choice === 'endpoint') {
      const names = new Set<string>()
      for (const m of `${endpoint.path_template} ${endpoint.body_template}`.matchAll(/\{\{\s*([A-Za-z0-9_.$-]{1,100})\s*\}\}/g)) names.add(m[1])
      return Array.from(names, (n) => ({ name: n, location: endpoint.path_template.split('?')[0].includes(`{{${n}}}`) ? 'path' : 'query' }))
    }
    return []
  }, [choice, sources, endpoint, stored.source])
  const isTable = choice === 'table'
  const isProcedure = isTable && kind === 'execute'
  const sourcePath = useMemo(() => {
    if (choice === 'keep') return ''
    if (choice.startsWith('ref:')) return sources?.references.find((r) => r.id === choice.slice(4))?.path_template ?? ''
    if (choice.startsWith('tpl:')) return sources?.templates.find((t) => t.key === choice.slice(4))?.path_template ?? ''
    if (choice.startsWith('op:')) return sources?.operations.find((o) => o.key === choice.slice(3))?.path_template ?? ''
    return choice === 'endpoint' ? endpoint.path_template : ''
  }, [choice, sources, endpoint])

  // New source picked: ask for its parameters by default (inputs + pass-through).
  function chooseSource(next: SourceChoice) {
    setChoice(next)
    setSourceSchema(null)
    setPreview(null)
    if (next === 'table' || next === 'keep' || !sources) return
    const list = next.startsWith('ref:') ? sources.references.find((r) => r.id === next.slice(4))?.inputs
      : next.startsWith('tpl:') ? sources.templates.find((t) => t.key === next.slice(4))?.inputs
      : next.startsWith('op:') ? sources.operations.find((o) => o.key === next.slice(3))?.inputs : []
    const required = (list ?? []).filter((i) => i.required && /^[A-Za-z_][A-Za-z0-9_]*$/.test(i.name))
    if (!inputs.length && required.length) {
      setInputs(required.map((i) => ({ name: i.name, type: 'string', mode: 'ask', required: true, ...(i.description ? { description: i.description } : {}) })))
      setParams(required.map((i) => ({ name: i.name, value: `{{input.${i.name}}}` })))
    } else setParams([])
    if (!name && next.startsWith('ref:')) setName(`${sources.references.find((r) => r.id === next.slice(4))?.name ?? 'Custom'} (custom)`)
  }

  const askInputs = inputs.filter((i) => i.mode !== 'fixed')
  const inputNames = inputs.map((i) => i.name).filter(Boolean)
  const view = useMemo(() => runtimeView(sourceSchema), [sourceSchema])
  const itemFields = useMemo(() => {
    const check = validateCollectionPath(view.root, rowsPath)
    return collectionItemFields(check.ok ? check.itemSchema ?? null : null).filter((f) => !f.container)
  }, [view.root, rowsPath])
  const fieldNames = useMemo(() => {
    const out = new Set<string>()
    if (isTable) for (const c of table?.columns ?? []) out.add(c.name)
    for (const f of itemFields) out.add(f.path)
    for (const c of columns) { out.add(c.path); out.add(columnName(c)) }
    return Array.from(out)
  }, [isTable, table, itemFields, columns])

  const sourcePayload = (): any => {
    if (isProcedure) return { type: 'table', table: '', columns: [] }
    if (isTable) return table ? { type: 'table', ...table } : { type: 'table', table: '', columns: [] }
    const base = { type: 'operation', params }
    if (choice.startsWith('ref:')) return { ...base, reference_id: choice.slice(4) }
    if (choice.startsWith('tpl:')) return { ...base, from: 'template', key: choice.slice(4) }
    if (choice.startsWith('op:')) return { ...base, from: 'openapi', key: choice.slice(3) }
    if (choice === 'endpoint') return { ...base, from: 'endpoint', ...endpoint }
    return base
  }
  const custom = (): any => ({
    version: 1,
    kind,
    source: sourcePayload(),
    inputs,
    rows_path: rowsPath,
    columns: columns.map((c) => ({ path: c.path, ...(c.alias?.trim() ? { alias: c.alias.trim() } : {}), ...(c.type ? { type: c.type } : {}) })),
    ...(filter.conditions.length ? { filter } : {}),
    ...(sort.length ? { sort } : {}),
    ...(distinct ? { distinct } : {}),
    ...(pageSize ? { page_size: Number(pageSize) } : {}),
    ...(maxRows ? { max_rows: Number(maxRows) } : {}),
    ...(pagingInputs ? { paging_inputs: true } : {}),
    ...(includeTotal ? { include_total: true } : {}),
    ...(Object.values(api).some(Boolean) ? { api } : {}),
    ...(kind === 'read' ? { read } : {}),
    ...(writes ? { write: cleanWrite(write, isTable) } : {}),
    ...(sourceSchema ? { source_model: sourceSchema } : {}),
  })

  // Live validation + "where it runs" (the same normaliser the server uses).
  const checked = useMemo(() => {
    try {
      const draft = custom()
      const source = isTable ? draft.source : { ...draft.source, type: 'operation', inputs: sourceInputs }
      const config = normalizeCustomConfig({ ...draft, source })
      return { config, stages: describeShaping(config), error: null as string | null }
    } catch (error: any) {
      return { config: null, stages: null, error: String(error?.message ?? error) }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed from the draft state
  }, [kind, choice, table, inputs, params, rowsPath, columns, filter, sort, distinct, pageSize, maxRows, pagingInputs, includeTotal, api, read, sourceInputs, endpoint, write])

  async function runPreview(stage: 'source' | 'shaped', send = false) {
    setBusy(stage === 'source' ? 'sample' : 'test')
    setMessage(null)
    try {
      const resp = await fetch('/api/integrations/custom-reference-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integration_id: integrationId, reference_id: reference?.id ?? null, custom: custom(), inputs: samples, stage, ...(send ? { send: true, confirm: 'send' } : {}) }),
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json?.error ?? `Failed (${resp.status})`)
      if (stage === 'source') {
        if (json.source_schema) setSourceSchema(json.source_schema)
        setMessage(json.error ? { tone: 'error', text: `The API answered ${json.status}: ${json.error}` } : { tone: 'info', text: `Sample loaded (${json.status}, ${json.duration_ms} ms) — pick the rows list and columns.` })
      } else setPreview(json)
    } catch (error: any) {
      setMessage({ tone: 'error', text: error?.message ?? 'Failed' })
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (!name.trim()) { setMessage({ tone: 'error', text: 'Give the reference a name' }); return }
    setBusy('save')
    setMessage(null)
    const result = reference
      ? await updateCustomReference(reference.id, { name: name.trim(), description: description || null, custom: custom() })
      : await createCustomReference(integrationId, { name: name.trim(), description: description || null, custom: custom() })
    setBusy(null)
    if (!result.ok) { setMessage({ tone: 'error', text: result.error }); return }
    onSaved(result.data.id)
  }

  const apiParamNames = sourceInputs.map((i) => i.name)
  const apiTaken = new Map<string, string>()
  for (const node of filter.op === 'and' ? filter.conditions : []) if (!('conditions' in node) && node.api_param) apiTaken.set(node.api_param, `filter on ${node.field}`)
  for (const [k, v] of Object.entries(api)) if (v) apiTaken.set(v, k.replace('_param', '').replace('_', ' '))

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent
        size="lg"
        // The builder keeps its test column beside the form: wider than a plain lg sheet.
        className="w-[min(1040px,100vw)]"
        title={
          <span className="inline-flex items-center gap-2">
            {reference ? 'Edit custom reference' : 'New custom reference'}
            <Badge tone="brand">Custom</Badge>
            {writes && <WritesDataBadge />}
          </span>
        }
        description="Shape an operation or table into a reusable call: pick the source, the inputs, the columns and the filter, then test it."
        aria-label="Custom reference builder"
        data-testid="custom-reference-builder"
      >
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto px-6 py-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-3">
            <Section title="Name and kind" testId="cr-basics">
              <Field label="Name">
                <Input placeholder="e.g. Open orders by customer" value={name} onChange={(e) => setName(e.target.value)} aria-label="Reference name" data-testid="cr-name" />
              </Field>
              <KindPicker kind={kind} onChange={(k) => { setKind(k); setPreview(null) }} />
              <Field label="Description" optional>
                <Input placeholder="What it returns and when to use it" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
              </Field>
            </Section>

            <Section title="Source" hint={`The operation or ${kind === 'execute' ? 'database' : 'table'} this reference ${writes ? 'writes to' : 'reads'}. Calls go only to this integration, with its credentials and egress rules.`} testId="cr-source">
              <select className={`${fieldCls} w-full`} value={choice} onChange={(e) => chooseSource(e.target.value)} aria-label="Source" data-testid="cr-source-select">
                <option value="">Choose a source…</option>
                {reference && stored.source?.type === 'operation' && <option value="keep">Current: {stored.source.label ?? 'saved operation'}</option>}
                {!!sources?.references.length && (
                  <optgroup label="This integration's references">
                    {sources.references.map((r) => <option key={r.id} value={`ref:${r.id}`}>{r.method} · {r.name}</option>)}
                  </optgroup>
                )}
                {!!sources?.templates.length && (
                  <optgroup label="Connector catalogue">
                    {sources.templates.map((t) => <option key={t.key} value={`tpl:${t.key}`}>{t.method} · {t.name}</option>)}
                  </optgroup>
                )}
                {!!sources?.operations.length && (
                  <optgroup label="Imported API operations">
                    {sources.operations.map((o) => <option key={o.key} value={`op:${o.key}`}>{o.method} · {o.name}</option>)}
                  </optgroup>
                )}
                {!sources?.database && <option value="endpoint">An endpoint on this integration (method + path)…</option>}
                {sources?.database && <option value="table">{kind === 'execute' ? 'A stored procedure or function…' : 'A table or view…'}</option>}
              </select>
              {choice === 'endpoint' && (
                <div className="flex gap-1.5">
                  <select className={fieldCls} value={endpoint.method} onChange={(e) => setEndpoint({ ...endpoint, method: e.target.value })} aria-label="Method">
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <input className={`${fieldCls} flex-1 font-mono`} placeholder="/path/{{id}}?q={{q}}" value={endpoint.path_template} aria-label="Path"
                    onChange={(e) => setEndpoint({ ...endpoint, path_template: e.target.value })} data-testid="cr-endpoint-path" />
                </div>
              )}
              {isTable && !isProcedure && (
                <select className={`${fieldCls} w-full`} value={table ? `${table.schema ?? ''}\u0001${table.table}` : ''} onChange={(e) => void pickTable(e.target.value)} aria-label="Table" data-testid="cr-table-select">
                  <option value="">{tables.length ? 'Choose a table or view…' : 'Loading tables…'}</option>
                  {table && !tables.some((t) => t.name === table.table) && <option value={`${table.schema ?? ''}\u0001${table.table}`}>{table.schema ? `${table.schema}.` : ''}{table.table}</option>}
                  {tables.map((t) => <option key={`${t.schema}.${t.name}`} value={`${t.schema}\u0001${t.name}`}>{t.type === 'view' ? 'View' : 'Table'} · {t.schema}.{t.name}</option>)}
                </select>
              )}
              {isTable && !writes && <p className="text-xs text-fg-muted">Filter, distinct, sort, columns and limit compile to one parameterised SQL query — values are always bound parameters.</p>}
              {isTable && writes && <p className="text-xs text-fg-muted">One parameterised statement in a transaction — introspected names only, values always bound parameters.</p>}
            </Section>

            <Section title="Inputs" hint="What callers provide (Ask callers) — or a value fixed inside the reference that callers never see (Fixed value). Use them as {{input.name}} in parameters and filters." testId="cr-inputs">
              <InputsEditor inputs={inputs} onChange={setInputs} settings={sources?.settings ?? []} />
            </Section>

            {!isTable && choice && (
              <Section title="Operation parameters" hint="What each of the operation's parameters receives — a constant, {{input.name}}, or empty (its default)." testId="cr-params">
                <ParamsEditor sourceInputs={sourceInputs} params={params} onChange={setParams} inputNames={inputNames} apiTaken={apiTaken} />
              </Section>
            )}

            {writes && !isTable && choice && (
              <Section title="Request" hint="The method, the body and how success is decided. Path and query placeholders are the operation parameters above." testId="cr-write">
                <RestWriteEditor kind={kind} write={write} onChange={setWrite} inputs={inputs} />
              </Section>
            )}
            {writes && isProcedure && (
              <Section title="Procedure" hint="A stored procedure or function from the database, with its parameters mapped from inputs." testId="cr-write">
                <ExecuteEditor integrationId={integrationId} write={write} onChange={setWrite} inputs={inputs} />
              </Section>
            )}
            {writes && isTable && !isProcedure && table && (
              <Section title={kind === 'create' ? 'Insert' : kind === 'update' ? 'Update' : kind === 'upsert' ? 'Upsert' : 'Delete'} hint="Columns come from the table's definition; values are inputs or constants." testId="cr-write">
                <DbWriteEditor kind={kind} write={write} onChange={setWrite} columns={table.columns} inputs={inputs} hasConditions={filter.conditions.length > 0} />
              </Section>
            )}

            {writes && !isTable && choice && (
              <Section title="Returned record" hint="Where the written record is in the response (empty = the whole response) and the fields to keep. Leave the columns empty to keep it whole." testId="cr-columns">
                <input className={`${fieldCls} w-full font-mono`} value={rowsPath} placeholder="(the whole response)" aria-label="Record path" onChange={(e) => setRowsPath(e.target.value)} />
                <ColumnsEditor columns={columns} onChange={setColumns} />
              </Section>
            )}
            {isProcedure && (
              <Section title="Returned columns" hint="Columns of the first result row to keep (empty = all)." testId="cr-columns">
                <ColumnsEditor columns={columns} onChange={setColumns} />
              </Section>
            )}

            {!writes && !isTable && choice && (
              <Section title={kind === 'list' ? 'Rows and columns' : 'Record and columns'} hint="Load a sample to see the response, then pick the list that holds the rows and the fields to return. Only these columns come back."
                testId="cr-columns"
                actions={(
                  <Button size="sm" variant="outline" onClick={() => runPreview('source')} disabled={busy !== null} data-testid="cr-load-sample">
                    {busy === 'sample' ? <Loader2 size={13} className="mr-1 animate-spin" /> : <FlaskConical size={13} className="mr-1" />} Load sample
                  </Button>
                )}>
                <ResponseCollectionPicker schema={sourceSchema} value={rowsPath} onChange={(p) => setRowsPath(p)} autoPick={kind === 'list'}
                  label={kind === 'list' ? 'Rows list' : 'Record (a list — the first match is returned — or leave empty for the whole response)'}
                  fields={{
                    selected: columns.map((c) => c.path),
                    onAdd: (added) => setColumns((current) => [...current, ...added.filter((f) => f.level < 3).map((f) => ({ path: f.path, ...(f.type && f.type !== 'any' && f.type !== 'null' ? { type: f.type === 'integer' ? 'integer' : f.type } : {}) }))]),
                  }} testId="cr-rows-picker" />
                <ColumnsEditor columns={columns} onChange={setColumns} />
              </Section>
            )}

            {isTable && !isProcedure && table && (
              <Section title={writes ? 'Returned columns' : 'Columns'} hint={writes ? 'With "Return the written row": the columns that come back (empty = every column).' : 'Pick and rename the columns that come back.'} testId="cr-columns">
                <div className="flex flex-wrap gap-1.5">
                  {table.columns.map((c) => {
                    const on = columns.some((x) => x.path === c.name)
                    return (
                      <label key={c.name} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs border-border">
                        <input type="checkbox" checked={on} onChange={(e) => setColumns(e.target.checked ? [...columns, { path: c.name }] : columns.filter((x) => x.path !== c.name))} />
                        <code>{c.name}</code><span className="text-fg-muted">{c.type}</span>
                      </label>
                    )
                  })}
                </div>
                <ColumnsEditor columns={columns} onChange={setColumns} />
              </Section>
            )}

            {(!writes || (isTable && (kind === 'update' || kind === 'delete'))) && (
            <Section title={writes ? 'WHERE conditions' : 'Filter'} hint={writes ? 'ANDed with the key columns. Bound parameters; a blank optional {{input.x}} skips its condition, but the WHERE can never end up empty.' : isTable ? 'Compiled to the WHERE clause.' : 'Conditions run on the server after fetching (at most 1,000 rows), unless you send one to the API as a parameter. A blank {{input.x}} skips its condition.'} testId="cr-filter">
              <FilterEditor group={filter} onChange={setFilter} fields={fieldNames} inputNames={inputNames} apiParams={isTable ? [] : apiParamNames} />
            </Section>

            )}

            {!writes && (
            <Section title="Sort, distinct and paging" testId="cr-sort">
              <SortEditor sort={sort} onChange={setSort} fields={fieldNames} />
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={distinct} onChange={(e) => setDistinct(e.target.checked)} data-testid="cr-distinct" />
                Only distinct values of the selected columns {!sort.length && distinct ? '(ordered by those columns)' : ''}
              </label>
              {kind === 'list' && (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1">Page size <input className={`${fieldCls} w-20`} inputMode="numeric" value={pageSize} placeholder="100" onChange={(e) => setPageSize(e.target.value.replace(/\D/g, ''))} /></label>
                  <label className="flex items-center gap-1">Max rows <input className={`${fieldCls} w-20`} inputMode="numeric" value={maxRows} placeholder="1000" onChange={(e) => setMaxRows(e.target.value.replace(/\D/g, ''))} /></label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={pagingInputs} onChange={(e) => setPagingInputs(e.target.checked)} /> Expose page / limit inputs</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={includeTotal} onChange={(e) => setIncludeTotal(e.target.checked)} /> Return {'{ rows, total }'}</label>
                </div>
              )}
              {!isTable && apiParamNames.length > 0 && (
                <details className="rounded border p-2 border-border">
                  <summary className="cursor-pointer text-xs font-medium">Let the API sort and page (optional)</summary>
                  <div className="mt-2 space-y-1">
                    <OptionalSelect label="Sort field parameter" value={api.sort_param} options={apiParamNames} onChange={(v) => setApi({ ...api, sort_param: v })} />
                    <OptionalSelect label="Sort order parameter" value={api.order_param} options={apiParamNames} onChange={(v) => setApi({ ...api, order_param: v })} />
                    <OptionalSelect label="Page size parameter" value={api.limit_param} options={apiParamNames} onChange={(v) => setApi({ ...api, limit_param: v })} />
                    <OptionalSelect label="Offset parameter" value={api.offset_param} options={apiParamNames} onChange={(v) => setApi({ ...api, offset_param: v })} />
                    <OptionalSelect label="Page number parameter" value={api.page_param} options={apiParamNames} onChange={(v) => setApi({ ...api, page_param: v })} />
                  </div>
                </details>
              )}
            </Section>

            )}

            {kind === 'read' && (
              <Section title="Read" hint="Which input identifies the record, and what happens when nothing matches." testId="cr-read">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1">Key input
                    <select className={fieldCls} value={read.key_input ?? ''} onChange={(e) => setRead({ ...read, key_input: e.target.value || undefined })}>
                      <option value="">—</option>
                      {inputNames.map((n) => <option key={n}>{n}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-1">matches field
                    <input className={`${fieldCls} w-36 font-mono`} list="cr-sort-fields" value={read.key_field ?? ''} placeholder="(the API looks it up)" onChange={(e) => setRead({ ...read, key_field: e.target.value || undefined })} />
                  </label>
                  <label className="flex items-center gap-1">Not found
                    <select className={fieldCls} value={read.not_found ?? 'null'} onChange={(e) => setRead({ ...read, not_found: e.target.value as 'null' | 'error' })}>
                      <option value="null">return empty (null)</option>
                      <option value="error">fail the call (404)</option>
                    </select>
                  </label>
                </div>
              </Section>
            )}
          </div>

          <aside className="min-w-0 space-y-3">
            <Section title="Where it runs" testId="cr-where">
              {checked.error
                ? <p className="text-xs text-danger" data-testid="cr-validation">{checked.error}</p>
                : (
                  <div className="space-y-1.5 text-xs">
                    <p className="font-medium">At the {isTable ? 'database' : 'API'}</p>
                    {checked.stages?.api.length ? <ul className="list-disc pl-4">{checked.stages.api.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="text-fg-muted">Nothing — the operation is called with its parameters.</p>}
                    <p className="flex items-center gap-1 font-medium"><Server size={11} /> Applied by the server</p>
                    <ul className="list-disc pl-4" data-testid="cr-server-stages">{checked.stages?.server.map((s) => <li key={s}>{s}</li>)}</ul>
                  </div>
                )}
            </Section>

            {writes && !isTable && choice && (
              <Section title="Request preview" testId="cr-preview">
                <RequestPreview config={checked.config} method={write.method ?? defaultMethodFor(kind) ?? 'POST'} pathTemplate={sourcePath} params={params} samples={samples} />
              </Section>
            )}

            <Section title="Test" hint={writes ? (isTable ? 'A dry run: the statement runs in a transaction that is always rolled back.' : 'Shows the request first; it is sent only when you confirm "Send for real".') : 'Runs the draft through the real executor (permissions, egress guard, call log).'} testId="cr-test">
              {askInputs.length > 0 && (
                <div className="space-y-1">
                  {askInputs.map((i) => (
                    <label key={i.name} className="flex items-center gap-1.5 text-xs">
                      <code className="w-24 shrink-0 truncate">{i.name}</code>
                      <input className={`${fieldCls} flex-1 font-mono`} value={samples[i.name] ?? ''} placeholder={i.default_value ? String(i.default_value) : 'sample value'}
                        onChange={(e) => setSamples({ ...samples, [i.name]: e.target.value })} data-testid={`cr-sample-${i.name}`} />
                    </label>
                  ))}
                </div>
              )}
              <Button size="sm" onClick={() => runPreview('shaped')} disabled={busy !== null || !!checked.error} data-testid="cr-test-run">
                {writes ? <WriteTestButtonLabel isTable={isTable} busy={busy === 'test'} /> : <>{busy === 'test' ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Play size={13} className="mr-1" />} Test</>}
              </Button>
              {preview && writes && <WriteTestResult preview={preview} isTable={isTable} busy={busy !== null} onSendForReal={() => void runPreview('shaped', true)} />}
              {preview && !writes && (
                <div className="space-y-1" data-testid="cr-test-result">
                  <p className="text-xs">
                    <Badge tone={preview.status < 400 ? 'success' : 'danger'} className="num font-mono">{preview.status}</Badge>
                    {' · '}{preview.duration_ms} ms
                    {preview.shaping?.stats && ` · ${preview.shaping.stats.fetched} fetched → ${preview.shaping.stats.matched} matched → ${preview.shaping.stats.returned} returned${preview.shaping.stats.truncated ? ' (source cut at 1,000)' : ''}`}
                  </p>
                  {preview.error && <p className="text-xs text-danger">{preview.error}</p>}
                  <JsonViewer value={preview.data} title="Response" maxHeightClass="max-h-72" />
                  {Array.isArray(preview.outputs) && (
                    <p className="text-xs text-fg-muted">Outputs: {preview.outputs.map((o: any) => `${o.name} (${o.type})`).join(', ') || '—'}</p>
                  )}
                </div>
              )}
            </Section>
          </aside>
        </div>

        <DialogFooter>
          {message && <p className={cn('min-w-0 flex-1 truncate text-xs', message.tone === 'error' ? 'text-danger' : 'text-fg-muted')} role={message.tone === 'error' ? 'alert' : undefined} title={message.text}>{message.text}</p>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy === 'save'} disabled={busy !== null || !choice || !!checked.error} leadingIcon={<Save />} data-testid="cr-save">
            Save reference
          </Button>
        </DialogFooter>
      </SheetContent>
    </Sheet>
  )
}
