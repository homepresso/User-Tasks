'use client'

/**
 * Write-kind sections of the custom reference builder: the kind picker, the
 * REST request (method, body builder with a live JSON preview, idempotency
 * key, success statuses), the database write (columns to write, key
 * columns, RETURNING, max affected rows), Execute (an introspected
 * procedure / function and its parameters) and the write Test (dry run;
 * "Send for real" for REST after a warning).
 *
 * Value inputs use the shared VariableInput with the reference's own inputs
 * as the variable set ({{input.x}}).
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Play, Plus, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VariableInput } from '@/components/automations/variable-input'
import { serverRead } from '@/lib/server-read'
import type { PickerScope } from '@/lib/variable-picker'
import { renderTemplateValue, resolveCustomInputs } from '@/lib/custom-references/inputs'
import { buildRequestBody, defaultMethodFor } from '@/lib/custom-references/write'
import {
  CUSTOM_KINDS, KIND_INFO, WRITE_HTTP_METHODS, WRITE_LIMITS, isWriteKind,
  type BodyField, type BodyFieldType, type CustomInput, type CustomKind, type CustomReferenceConfig, type SourceParam, type WriteColumn, type WriteConfig,
} from '@/lib/custom-references/types'
import { Card } from '@/components/ui/card'
import { border, fieldCls, fieldStyle, muted, smallBtn } from './sections'
import { WritesDataBadge } from '../writes-data-badge'

export { WritesDataBadge }

/* eslint-disable @typescript-eslint/no-explicit-any -- draft JSON and API responses */

/** The picker's variables in the builder: the reference's declared inputs. */
export function inputScope(inputs: CustomInput[]): PickerScope {
  return {
    items: inputs.filter((i) => i.name).map((i) => ({
      path: `input.${i.name}`,
      label: i.name,
      group: i.mode === 'fixed' ? 'Fixed inputs' : 'Inputs',
      type: i.type === 'number' || i.type === 'integer' ? 'number' : i.type === 'boolean' ? 'boolean' : i.type === 'date' ? 'date' : i.type === 'array' ? 'list' : i.type === 'object' ? 'row' : 'text',
      ...(i.description ? { hint: i.description } : {}),
    })),
    note: 'Inputs of this reference — a whole {{input.x}} keeps its type',
    problem: (path) => (path.startsWith('input.') && !inputs.some((i) => `input.${i.name}` === path) ? 'Not an input of this reference' : null),
  }
}

// ─── Kind ───────────────────────────────────────────────────────────────

export function KindPicker({ kind, onChange }: { kind: CustomKind; onChange: (kind: CustomKind) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Kind">
        {CUSTOM_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className="rounded border px-2.5 py-1 text-xs font-medium" onClick={() => onChange(k)} data-testid={`cr-kind-${k}`}
            style={kind === k ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : border}>
            {KIND_INFO[k].label}
          </button>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted" data-testid="cr-kind-description">
        {isWriteKind(kind) && <WritesDataBadge />}
        {KIND_INFO[kind].description}
        {KIND_INFO[kind].method && <span>Default REST method: <code>{KIND_INFO[kind].method}</code>.</span>}
      </p>
    </div>
  )
}

// ─── REST write ─────────────────────────────────────────────────────────

const BODY_MODES: Array<{ value: NonNullable<WriteConfig['body']>['mode']; label: string }> = [
  { value: 'mapped', label: 'Build the body (field ← value)' },
  { value: 'inputs', label: 'Send the whole input object' },
  { value: 'source', label: "The operation's own body" },
  { value: 'none', label: 'No body' },
]
const BODY_TYPES: BodyFieldType[] = ['auto', 'string', 'number', 'boolean', 'json', 'null']

export function RestWriteEditor({ kind, write, onChange, inputs }: { kind: CustomKind; write: WriteConfig; onChange: (w: WriteConfig) => void; inputs: CustomInput[] }) {
  const scope = useMemo(() => inputScope(inputs), [inputs])
  // The same default as the server (lib/custom-references/write normalizeBody).
  const body = write.body ?? { mode: kind === 'delete' ? 'none' : 'source', fields: [] }
  const fields = body.fields ?? []
  const setFields = (next: BodyField[]) => onChange({ ...write, body: { ...body, mode: 'mapped', fields: next } })
  const canIdempotent = kind === 'create' || kind === 'execute'
  return (
    <div className="space-y-2" data-testid="cr-rest-write">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">Method
          <select className={fieldCls} value={write.method ?? defaultMethodFor(kind)} onChange={(e) => onChange({ ...write, method: e.target.value as WriteConfig['method'] })} aria-label="HTTP method" data-testid="cr-write-method">
            {WRITE_HTTP_METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Body
          <select className={fieldCls} value={body.mode} onChange={(e) => onChange({ ...write, body: { mode: e.target.value as any, fields } })} aria-label="Body" data-testid="cr-body-mode">
            {BODY_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      </div>
      {body.mode === 'mapped' && (
        <div className="space-y-1" data-testid="cr-body-fields">
          {fields.map((f, i) => (
            <div key={i} className="flex items-center gap-1">
              <input className={`${fieldCls} w-44 font-mono`} value={f.path} placeholder="customer.name" aria-label="Body field path"
                onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, path: e.target.value.replace(/[^A-Za-z0-9_$@.-]/g, '') } : x)))} />
              <span aria-hidden className="text-fg-muted">←</span>
              <VariableInput value={f.value === undefined ? '' : String(f.value)} scope={scope} placeholder="{{input.x}} or a constant" ariaLabel={`Value of ${f.path || 'field'}`} wrapperClassName="flex-1 min-w-0"
                onChange={(v) => setFields(fields.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
              <select className={fieldCls} value={f.type ?? 'auto'} aria-label="Value type" onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, type: e.target.value as BodyFieldType } : x)))}>
                {BODY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button type="button" className={`${smallBtn} text-fg-muted`} onClick={() => setFields(fields.filter((_, j) => j !== i))} aria-label={`Remove ${f.path}`}><Trash2 size={11} /></button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={smallBtn} style={{ color: 'var(--theme-primary-text)' }} disabled={fields.length >= WRITE_LIMITS.maxBodyFields} data-testid="cr-add-body-field"
              onClick={() => setFields([...fields, { path: '', value: '' }])}><Plus size={11} /> Add field</button>
            {inputs.length > 0 && (
              <button type="button" className={smallBtn} style={{ color: 'var(--theme-primary-text)' }} data-testid="cr-body-from-inputs"
                onClick={() => setFields([...fields, ...inputs.filter((i) => i.name !== write.idempotency?.input && !fields.some((f) => f.path === i.name)).map((i) => ({ path: i.name, value: `{{input.${i.name}}}` }))])}>
                <Plus size={11} /> One field per input
              </button>
            )}
          </div>
          <p className="text-xs text-fg-muted">Dotted paths build nested JSON (<code>customer.address.city</code>). A whole <code>{'{{input.x}}'}</code> keeps the input&apos;s type; a blank optional input leaves its field out.</p>
        </div>
      )}
      {body.mode === 'inputs' && <p className="text-xs text-fg-muted">Sends every input as a JSON object — except credentials and the idempotency key.</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">Success statuses
          <input className={`${fieldCls} w-28 font-mono`} value={write.success_statuses ?? ''} placeholder="200-299" onChange={(e) => onChange({ ...write, success_statuses: e.target.value || undefined })} aria-label="Success statuses" />
        </label>
        {(kind === 'update' || kind === 'delete') && <NotFoundSelect write={write} onChange={onChange} />}
      </div>
      {canIdempotent && <IdempotencyEditor write={write} onChange={onChange} inputs={inputs} rest />}
    </div>
  )
}

function NotFoundSelect({ write, onChange }: { write: WriteConfig; onChange: (w: WriteConfig) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs">Nothing matched
      <select className={fieldCls} value={write.not_found ?? 'error'} onChange={(e) => onChange({ ...write, not_found: e.target.value as 'error' | 'noop' })} aria-label="Not found behaviour" data-testid="cr-not-found">
        <option value="error">fail the call (404)</option>
        <option value="noop">succeed — no-op</option>
      </select>
    </label>
  )
}

function IdempotencyEditor({ write, onChange, inputs, rest }: { write: WriteConfig; onChange: (w: WriteConfig) => void; inputs: CustomInput[]; rest: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="cr-idempotency">
      <label className="flex items-center gap-1">Idempotency key input
        <select className={fieldCls} value={write.idempotency?.input ?? ''} aria-label="Idempotency key input"
          onChange={(e) => onChange({ ...write, idempotency: e.target.value ? { ...write.idempotency, input: e.target.value } : undefined })}>
          <option value="">— none —</option>
          {inputs.map((i) => <option key={i.name} value={i.name}>{i.name}</option>)}
        </select>
      </label>
      {rest && write.idempotency && (
        <label className="flex items-center gap-1">sent as header
          <input className={`${fieldCls} w-36 font-mono`} value={write.idempotency.header ?? ''} placeholder="Idempotency-Key" aria-label="Idempotency header"
            onChange={(e) => onChange({ ...write, idempotency: { ...write.idempotency!, header: e.target.value.replace(/[^A-Za-z0-9-]/g, '') || undefined } })} />
        </label>
      )}
      <span className="text-fg-muted">A retry with the same key returns the first result instead of writing twice.</span>
    </div>
  )
}

/** Live preview of the REST request with the Test sample values. */
export function RequestPreview({ config, method, pathTemplate, params, samples }: {
  config: CustomReferenceConfig | null
  method: string
  pathTemplate: string
  params: SourceParam[]
  samples: Record<string, string>
}) {
  let preview: { line: string; body: string; error?: string } = { line: '', body: '' }
  try {
    // Typed like the server does (resolveCustomInputs); integration settings show as ‹name›.
    let values: Record<string, unknown> = {}
    const settings = Object.fromEntries((config?.inputs ?? []).filter((i) => i.fixed_setting).map((i) => [i.fixed_setting!, `‹${i.fixed_setting}›`]))
    try {
      values = config ? resolveCustomInputs({ ...config, inputs: config.inputs.map((i) => (i.fixed_setting ? { ...i, type: 'string' as const } : { ...i, required: false })) }, samples, settings).values : {}
    } catch {
      for (const i of config?.inputs ?? []) values[i.name] = i.mode === 'fixed' ? (i.fixed_setting ? `‹${i.fixed_setting}›` : i.fixed_value) : samples[i.name] ?? i.default_value ?? ''
    }
    const paramValues = Object.fromEntries(params.map((p) => [p.name, renderTemplateValue(p.value, values)]))
    const path = pathTemplate.replace(/\{\{\s*([A-Za-z0-9_.$-]+)\s*\}\}/g, (_m, name) => encodeURIComponent(String(paramValues[name] ?? `{${name}}`)))
    const body = config ? buildRequestBody(config, values) : undefined
    preview = { line: `${method} ${path || '/…'}`, body: body === undefined ? (config?.write?.body?.mode === 'none' ? '(no body)' : "(the operation's own body)") : JSON.stringify(body, null, 2) }
  } catch (error: any) {
    preview = { line: `${method} ${pathTemplate}`, body: '', error: String(error?.message ?? error) }
  }
  return (
    <div className="space-y-1.5" data-testid="cr-request-preview">
      <Card variant="inset" padding="none" className="overflow-hidden font-mono text-xs">
        <p className="border-b border-border-subtle px-3 py-1.5 font-medium text-fg">{preview.line}</p>
        {preview.error ? <p className="px-3 py-2 text-danger">{preview.error}</p>
          : <pre className="max-h-48 overflow-auto px-3 py-2 leading-5 text-fg">{preview.body}</pre>}
      </Card>
      <p className="text-xs text-fg-muted">With the Test sample values. Credentials are added on the server when it is sent.</p>
    </div>
  )
}

// ─── Database write ─────────────────────────────────────────────────────

function ColumnValues({ label, testId, rows, onChange, columns, scope, valueless }: {
  label: string
  testId: string
  rows: WriteColumn[]
  onChange: (rows: WriteColumn[]) => void
  columns: Array<{ name: string; type?: string }>
  scope: PickerScope
  valueless?: boolean
}) {
  const unused = columns.filter((c) => !rows.some((r) => r.column === c.name))
  return (
    <div className="space-y-1" data-testid={testId}>
      <p className="text-xs font-medium">{label}</p>
      {rows.map((row, i) => (
        <div key={row.column} className="flex items-center gap-1">
          <code className="w-36 shrink-0 truncate text-xs" title={row.column}>{row.column}</code>
          {!valueless && <span aria-hidden className="text-fg-muted">←</span>}
          {!valueless && (
            <VariableInput value={row.value} scope={scope} placeholder="{{input.x}} or a constant" ariaLabel={`Value of ${row.column}`} wrapperClassName="flex-1 min-w-0"
              onChange={(v) => onChange(rows.map((r, j) => (j === i ? { ...r, value: v } : r)))} />
          )}
          <button type="button" className={`${smallBtn} text-fg-muted`} onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${row.column}`}><Trash2 size={11} /></button>
        </div>
      ))}
      {unused.length > 0 && (
        <select className={fieldCls} value="" aria-label={`Add to ${label}`} data-testid={`${testId}-add`}
          onChange={(e) => e.target.value && onChange([...rows, { column: e.target.value, value: scope.items.some((it) => it.path === `input.${e.target.value}`) ? `{{input.${e.target.value}}}` : '' }])}>
          <option value="">Add a column…</option>
          {unused.map((c) => <option key={c.name} value={c.name}>{c.name}{c.type ? ` (${c.type})` : ''}</option>)}
        </select>
      )}
    </div>
  )
}

export function DbWriteEditor({ kind, write, onChange, columns, inputs, hasConditions }: {
  kind: CustomKind
  write: WriteConfig
  onChange: (w: WriteConfig) => void
  columns: Array<{ name: string; type?: string }>
  inputs: CustomInput[]
  hasConditions: boolean
}) {
  const scope = useMemo(() => inputScope(inputs), [inputs])
  const bounded = kind === 'update' || kind === 'delete'
  return (
    <div className="space-y-2" data-testid="cr-db-write">
      {kind !== 'delete' && <ColumnValues label={kind === 'update' ? 'SET (column ← value)' : 'Columns to write (column ← value)'} testId="cr-set" rows={write.set ?? []} columns={columns} scope={scope} onChange={(set) => onChange({ ...write, set })} />}
      {kind !== 'create' && (
        <ColumnValues label={kind === 'upsert' ? 'Key columns (match on conflict — need a unique constraint)' : 'WHERE key (column = value)'} testId="cr-key" rows={write.key ?? []} columns={columns} scope={scope} onChange={(key) => onChange({ ...write, key })} />
      )}
      {bounded && !(write.key ?? []).length && !hasConditions && (
        <p className="text-xs" role="alert" style={{ color: 'var(--theme-danger)' }}>Add a key column or a filter condition — an unbounded {kind} is not allowed.</p>
      )}
      {bounded && <p className="text-xs text-fg-muted">Filter conditions below are ANDed into the WHERE. A blank key value refuses the call.</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" checked={Boolean(write.returning)} onChange={(e) => onChange({ ...write, returning: e.target.checked || undefined })} data-testid="cr-returning" /> Return the written row (RETURNING / OUTPUT)</label>
        {kind !== 'create' && (
          <label className="flex items-center gap-1">Max affected rows
            <input className={`${fieldCls} w-20`} inputMode="numeric" value={write.max_affected ?? ''} placeholder="1" data-testid="cr-max-affected"
              onChange={(e) => { const n = e.target.value.replace(/\D/g, ''); onChange({ ...write, max_affected: n ? Math.min(Number(n), WRITE_LIMITS.maxAffected) : undefined }) }} />
          </label>
        )}
        {bounded && <NotFoundSelect write={write} onChange={onChange} />}
      </div>
      {kind !== 'create' && <p className="text-xs text-fg-muted">Runs in a transaction: more than {write.max_affected ?? 1} affected row{(write.max_affected ?? 1) === 1 ? '' : 's'} rolls back and fails the call (at most {WRITE_LIMITS.maxAffected}).</p>}
      {kind === 'create' && <IdempotencyEditor write={write} onChange={onChange} inputs={inputs} rest={false} />}
    </div>
  )
}

// ─── Execute (database) ─────────────────────────────────────────────────

export function ExecuteEditor({ integrationId, write, onChange, inputs }: { integrationId: string; write: WriteConfig; onChange: (w: WriteConfig) => void; inputs: CustomInput[] }) {
  const scope = useMemo(() => inputScope(inputs), [inputs])
  const proc = write.procedure
  const { data: routines, error } = useQuery({
    queryKey: ['custom-reference-routines', integrationId],
    queryFn: async () => ((await serverRead('integrations.customReferenceRoutines', { integrationId })).data as any)?.routines as Array<{ schema: string; name: string; type: string }>,
  })
  const [loading, setLoading] = useState(false)
  async function pick(value: string) {
    const [schema, name, type] = value.split('\u0001')
    if (!name) { onChange({ ...write, procedure: undefined }); return }
    setLoading(true)
    try {
      const params = (((await serverRead('integrations.customReferenceRoutineParams', { integrationId, schema, name })).data as any)?.params ?? []) as Array<{ name: string; type?: string; is_output?: boolean }>
      onChange({
        ...write,
        procedure: {
          schema, name, routine_type: type === 'procedure' ? 'procedure' : 'function',
          params: params.map((p) => ({ name: p.name, ...(p.type ? { type: p.type } : {}), ...(p.is_output ? { is_output: true } : { value: inputs.some((i) => i.name === p.name) ? `{{input.${p.name}}}` : '' }) })),
        },
      })
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="space-y-2" data-testid="cr-execute">
      <select className={`${fieldCls} w-full`} value={proc ? `${proc.schema ?? ''}\u0001${proc.name}\u0001${proc.routine_type ?? 'function'}` : ''} onChange={(e) => void pick(e.target.value)} aria-label="Procedure or function" data-testid="cr-routine-select">
        <option value="">{routines ? 'Choose a procedure or function…' : 'Loading procedures…'}</option>
        {proc && !routines?.some((r) => r.name === proc.name) && <option value={`${proc.schema ?? ''}\u0001${proc.name}\u0001${proc.routine_type ?? 'function'}`}>{proc.schema ? `${proc.schema}.` : ''}{proc.name}</option>}
        {(routines ?? []).map((r) => <option key={`${r.schema}.${r.name}`} value={`${r.schema}\u0001${r.name}\u0001${r.type}`}>{r.type === 'procedure' ? 'Procedure' : 'Function'} · {r.schema}.{r.name}</option>)}
      </select>
      {error && <p className="text-xs text-danger">{String((error as Error).message)}</p>}
      {loading && <Loader2 size={13} className="animate-spin" />}
      {proc && proc.params.map((p, i) => (
        <div key={p.name} className="flex items-center gap-1">
          <code className="w-36 shrink-0 truncate text-xs">{p.name}</code>
          <span className="w-20 shrink-0 truncate text-xs text-fg-muted">{p.type}{p.is_output ? ' (out)' : ''}</span>
          {p.is_output ? <span className="text-xs text-fg-muted">returned in the result</span> : (
            <VariableInput value={p.value ?? ''} scope={scope} placeholder="{{input.x}}, a constant, or empty (NULL)" ariaLabel={`Value of ${p.name}`} wrapperClassName="flex-1 min-w-0"
              onChange={(v) => onChange({ ...write, procedure: { ...proc, params: proc.params.map((x, j) => (j === i ? { ...x, value: v } : x)) } })} />
          )}
        </div>
      ))}
      <p className="text-xs text-fg-muted">Parameters come from the database&apos;s own definition and are bound — free-form SQL is not allowed. Supported: PostgreSQL, SQL Server, MySQL and Oracle.</p>
      <IdempotencyEditor write={write} onChange={onChange} inputs={inputs} rest={false} />
    </div>
  )
}

// ─── Test (writes) ──────────────────────────────────────────────────────

export function WriteTestResult({ preview, isTable, onSendForReal, busy }: { preview: any; isTable: boolean; onSendForReal: () => void; busy: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const data = preview?.data ?? {}
  return (
    <div className="space-y-1.5" data-testid="cr-write-result">
      <p className="text-xs">
        <span className="font-mono font-semibold" style={{ color: preview.status < 400 ? 'var(--theme-success)' : 'var(--theme-danger)' }}>{preview.status}</span>
        {' · '}{preview.duration_ms} ms · {preview.write?.sent ? <strong>sent for real</strong> : data.dry_run ? <span>dry run — {isTable ? 'rolled back' : 'not sent'}</span> : null}
      </p>
      {preview.error && <p className="text-xs text-danger">{preview.error}</p>}
      {isTable && data.dry_run && (
        <div className="space-y-1" data-testid="cr-dry-run">
          <p className="text-xs">Would affect <strong data-testid="cr-dry-run-affected">{data.affected_rows}</strong> row{data.affected_rows === 1 ? '' : 's'}
            {data.max_affected_rows !== undefined && <> (max {data.max_affected_rows})</>}
            {data.would_exceed && <span className="text-danger"> — over the cap: a real run would roll back and fail</span>}</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded p-2 font-mono text-xs bg-bg" data-testid="cr-dry-run-sql">{data.sql}</pre>
          <p className="font-mono text-xs text-fg-muted">params: {JSON.stringify(data.params)}</p>
        </div>
      )}
      {!isTable && data.request && (
        <div className="space-y-1" data-testid="cr-request-sent">
          <p className="font-mono text-xs font-semibold">{data.request.method} {data.request.url}</p>
          <pre className="max-h-40 overflow-auto rounded p-2 font-mono text-xs bg-bg">{JSON.stringify(data.request.body, null, 2)}</pre>
        </div>
      )}
      {(!data.dry_run || isTable) && <pre className="max-h-48 overflow-auto rounded p-2 font-mono text-xs bg-bg">{JSON.stringify({ status: data.status, affected_rows: data.affected_rows, id: data.id, record: data.record }, null, 2)}</pre>}
      {!isTable && data.dry_run && (
        confirming ? (
          <div className="space-y-1 rounded border p-2" style={{ borderColor: 'var(--theme-danger)' }} role="alertdialog" aria-label="Send for real" data-testid="cr-send-confirm">
            <p className="flex items-start gap-1 text-xs"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-danger" /> This sends the request to the API with the integration&apos;s credentials and can change real data. It is recorded in the call log.</p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="destructive" onClick={() => { setConfirming(false); onSendForReal() }} disabled={busy} data-testid="cr-send-confirm-yes"><Send size={12} className="mr-1" /> Send for real</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)} disabled={busy} data-testid="cr-send-for-real"><Send size={12} className="mr-1" /> Send for real…</Button>
        )
      )}
    </div>
  )
}

export function WriteTestButtonLabel({ isTable, busy }: { isTable: boolean; busy: boolean }) {
  return <>{busy ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Play size={13} className="mr-1" />} {isTable ? 'Dry run (rolled back)' : 'Preview request'}</>
}
