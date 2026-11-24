'use client'

/**
 * The generated, typed input form used by Extensibility's Test tab
 * (workflow actions) and Try it dialog (form controls): one field per
 * declared input / property with the right control, its label, help,
 * required marker and inline error, plus an "Edit as JSON" view kept in
 * sync both ways. Field mapping and validation live in
 * lib/extensibility-test-inputs.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- test values are free-form JSON */

import { useCallback, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Braces, KeyRound, ListPlus, Plus, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import {
  coerceListItem, defaultTestValues, forgetTestInputs, fromLocalDateTimeInput, isSecretField, mergeJsonIntoValues,
  parseTestJson, recallTestInputs, rememberTestInputs, testInputsOf, toLocalDateTimeInput, type TestField,
} from '@/lib/extensibility-test-inputs'

export interface TestInputsState {
  fields: TestField[]
  values: Record<string, unknown>
  /** Bumped when values change from outside a field (reset, JSON view): fields with a text buffer re-read their value. */
  revision: number
  setValue: (name: string, value: unknown) => void
  /** Fields whose text can't become a value yet (JSON that doesn't parse): they block a run. */
  textErrors: Record<string, string>
  setTextError: (name: string, message: string | null) => void
  jsonMode: boolean
  setJsonMode: (on: boolean) => void
  jsonText: string
  jsonError: string | null
  setJsonText: (text: string) => void
  reset: () => void
  remember: () => void
  /** The values to send (secrets included). */
  inputs: () => Record<string, unknown>
}

/**
 * Form state for one set of fields. Starts from the remembered inputs (local
 * storage, never secrets) over the defaults / sample. Key the caller by the
 * function so switching functions starts a fresh form.
 */
export function useTestInputs(fields: TestField[], opts: { storageKey: string | null; sample?: Record<string, unknown> | null }): TestInputsState {
  const { storageKey, sample } = opts
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...defaultTestValues(fields, sample),
    ...(storageKey ? recallTestInputs(storageKey, fields) ?? {} : {}),
  }))
  const [revision, setRevision] = useState(0)
  const [textErrors, setTextErrors] = useState<Record<string, string>>({})
  const [jsonMode, setJsonModeState] = useState(false)
  const [jsonText, setJsonTextState] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const setValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => {
      const next = { ...prev }
      if (value === undefined) delete next[name]
      else next[name] = value
      return next
    })
  }, [])
  const setTextError = useCallback((name: string, message: string | null) => {
    setTextErrors((prev) => {
      if ((prev[name] ?? null) === message) return prev
      const next = { ...prev }
      if (message) next[name] = message
      else delete next[name]
      return next
    })
  }, [])
  const showJson = (from: Record<string, unknown>) => JSON.stringify(testInputsOf(fields, from, { withSecrets: false }), null, 2)

  return {
    fields,
    values,
    revision,
    setValue,
    textErrors,
    setTextError,
    jsonMode,
    setJsonMode: (on) => {
      if (on) { setJsonTextState(showJson(values)); setJsonError(null) }
      else { setRevision((r) => r + 1); setTextErrors({}) }
      setJsonModeState(on)
    },
    jsonText,
    jsonError,
    setJsonText: (text) => {
      setJsonTextState(text)
      const parsed = parseTestJson(text)
      if ('error' in parsed) { setJsonError(parsed.error); return }
      setJsonError(null)
      setValues((prev) => mergeJsonIntoValues(fields, prev, parsed.value))
    },
    reset: () => {
      const next = defaultTestValues(fields, sample)
      setValues(next)
      setTextErrors({})
      setRevision((r) => r + 1)
      if (storageKey) forgetTestInputs(storageKey)
      if (jsonMode) { setJsonTextState(showJson(next)); setJsonError(null) }
    },
    remember: () => { if (storageKey) rememberTestInputs(storageKey, fields, values) },
    inputs: () => testInputsOf(fields, values),
  }
}

/** Cmd / Ctrl + Enter in a multi-line box submits the form (Enter alone adds a line). */
function submitOnModEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
}

export function TestInputForm({ state, idBase, errors, highlight = [], disabled, emptyText, toolbar }: {
  state: TestInputsState
  idBase: string
  /** Validation errors by field name (shown inline). */
  errors: Record<string, string>
  /** Fields a failed run named (highlighted even without an inline error). */
  highlight?: string[]
  disabled?: boolean
  emptyText: string
  /** Extra buttons at the right of the toolbar. */
  toolbar?: ReactNode
}) {
  const { fields } = state
  if (!fields.length) return <p className="text-ui text-fg-muted" data-testid="test-no-inputs">{emptyText}</p>
  const secrets = fields.filter(isSecretField)
  return (
    <div className="space-y-3" data-testid="test-input-form">
      <div className="flex flex-wrap items-center gap-2">
        <Switch size="sm" label={<span className="inline-flex items-center gap-1 text-xs"><Braces size={12} aria-hidden="true" /> Edit as JSON</span>} checked={state.jsonMode} onCheckedChange={state.setJsonMode} />
        <span className="flex-1" />
        {toolbar}
        <Button type="button" size="sm" variant="ghost" leadingIcon={<RotateCcw />} onClick={state.reset} disabled={disabled}>Reset to defaults</Button>
      </div>
      {state.jsonMode ? (
        <Field
          label="Inputs (JSON)"
          id={`${idBase}-json`}
          error={state.jsonError}
          description={secrets.length ? `Secret inputs (${secrets.map((f) => f.label).join(', ')}) stay in the form and are not shown here.` : 'Changes here update the form. Cmd / Ctrl + Enter runs.'}
        >
          <Textarea
            value={state.jsonText}
            onChange={(e) => state.setJsonText(e.target.value)}
            onKeyDown={submitOnModEnter}
            rows={Math.min(16, Math.max(6, state.jsonText.split('\n').length + 1))}
            spellCheck={false}
            className="bg-subtle font-mono text-xs"
            disabled={disabled}
          />
        </Field>
      ) : null}
      {state.jsonMode && Object.keys(errors).length > 0 && (
        <ul className="space-y-0.5 text-xs text-danger" data-testid="json-input-errors">
          {Object.entries(errors).map(([name, message]) => <li key={name}>{message}</li>)}
        </ul>
      )}
      {state.jsonMode ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <FieldRow
              key={`${field.name}:${state.revision}`}
              field={field}
              id={`${idBase}-${field.name}`}
              value={state.values[field.name]}
              onChange={(v) => state.setValue(field.name, v)}
              onTextError={(m) => state.setTextError(field.name, m)}
              error={state.textErrors[field.name] ?? errors[field.name] ?? (highlight.includes(field.name) ? 'The run refused this input' : null)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const WIDE: TestField['kind'][] = ['text', 'json', 'object', 'objectList', 'keyvalue', 'list']

function FieldRow({ field, id, value, onChange, onTextError, error, disabled }: {
  field: TestField
  id: string
  value: unknown
  onChange: (value: unknown) => void
  onTextError: (message: string | null) => void
  error: string | null
  disabled?: boolean
}) {
  const help = [field.description, hintOf(field)].filter(Boolean).join(' · ')
  const label = (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      {field.label}
      {field.kind === 'secret' && <KeyRound size={12} className="text-fg-muted" aria-label="Secret" />}
      <code className="font-mono text-2xs font-normal text-fg-muted">{field.name}</code>
      <span className="text-2xs font-normal text-fg-muted">{field.typeLabel}</span>
    </span>
  )
  const control = (
    <FieldControl field={field} id={id} value={value} onChange={onChange} onTextError={onTextError} disabled={disabled} invalid={Boolean(error)} />
  )
  const wide = WIDE.includes(field.kind)
  // Grouped kinds hold several controls: label them as a group instead of one <label for>.
  if (field.kind === 'object' || field.kind === 'objectList' || field.kind === 'keyvalue') {
    return (
      <fieldset className={cn('min-w-0 space-y-1.5', wide && 'sm:col-span-2')} data-field={field.name} aria-invalid={error ? true : undefined}>
        <legend className="text-ui font-medium text-fg">{label}{field.required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}</legend>
        {help && <p className="text-xs text-fg-muted">{help}</p>}
        {control}
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      </fieldset>
    )
  }
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')} data-field={field.name}>
      <Field label={label} id={id} required={field.required} error={error} description={help || undefined}>
        {control}
      </Field>
    </div>
  )
}

function hintOf(field: TestField): string | null {
  if (field.kind === 'secret') return 'Masked; never saved or shown in results'
  if (field.kind === 'file') return 'A file URL (https) or a storage reference from a run: Test cannot upload a sample file'
  if (field.kind === 'list') return 'One per line'
  if (field.default !== undefined && field.kind !== 'boolean') {
    const option = field.options?.find((o) => o.value === field.default)
    return `Default ${option ? option.label : typeof field.default === 'string' ? field.default : JSON.stringify(field.default)}`
  }
  if (field.min !== undefined && field.max !== undefined) return `${field.min} to ${field.max}`
  if (field.min !== undefined) return `At least ${field.min}`
  if (field.max !== undefined) return `At most ${field.max}`
  return null
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** One field's control (recursive for objects and lists of objects). Props beyond `id` are spread by <Field> (aria-*). */
function FieldControl({ field, id, value, onChange, onTextError, disabled, invalid, ...aria }: {
  field: TestField
  id: string
  value: unknown
  onChange: (value: unknown) => void
  onTextError: (message: string | null) => void
  disabled?: boolean
  invalid?: boolean
  [aria: `aria-${string}`]: unknown
}) {
  const common = { id, disabled, 'aria-invalid': invalid || undefined, ...aria } as Record<string, any>
  switch (field.kind) {
    case 'string':
      return <Input {...common} type="text" value={asText(value)} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value || undefined)} />
    case 'secret':
      return <Input {...common} type="password" autoComplete="off" value={asText(value)} placeholder={field.placeholder ?? 'Value'} onChange={(e) => onChange(e.target.value || undefined)} />
    case 'text':
      return <Textarea {...common} rows={4} value={asText(value)} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value || undefined)} onKeyDown={submitOnModEnter} />
    case 'number': case 'integer':
      return (
        <Input
          {...common}
          type="number"
          inputMode={field.kind === 'integer' ? 'numeric' : 'decimal'}
          step={field.step ?? 'any'}
          min={field.min}
          max={field.max}
          value={typeof value === 'number' ? String(value) : asText(value)}
          placeholder={field.placeholder}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') return onChange(undefined)
            const n = Number(raw)
            onChange(Number.isFinite(n) ? n : raw)
          }}
        />
      )
    case 'boolean': {
      const on = value === true || value === 'true'
      return (
        <span className="flex h-8 items-center gap-2">
          <Switch {...common} checked={on} onCheckedChange={(checked) => onChange(checked)} />
          <span className="text-xs text-fg-muted">{value === undefined ? `Not set${field.default !== undefined ? ` (default ${String(field.default)})` : ''}` : on ? 'True' : 'False'}</span>
        </span>
      )
    }
    case 'date':
      return <Input {...common} type="date" value={typeof value === 'string' ? value.slice(0, 10) : ''} onChange={(e) => onChange(e.target.value || undefined)} />
    case 'datetime':
      return <Input {...common} type="datetime-local" value={toLocalDateTimeInput(value)} onChange={(e) => onChange(fromLocalDateTimeInput(e.target.value))} />
    case 'select': {
      const current = asText(value)
      const known = (field.options ?? []).some((o) => o.value === current)
      return (
        <Select {...common} value={current} onChange={(e) => onChange(e.target.value || undefined)} placeholder={field.required && known ? undefined : 'Choose…'}>
          {current && !known && <option value={current}>{current} (not a choice)</option>}
          {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )
    }
    case 'color': {
      const s = asText(value)
      return (
        <span className="flex items-center gap-2">
          <input type="color" aria-label={`${field.label} picker`} value={/^#[0-9a-f]{6}$/i.test(s) ? s : '#000000'} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-panel" />
          <Input {...common} value={s} placeholder="#RRGGBB" onChange={(e) => onChange(e.target.value || undefined)} className="font-mono text-xs" />
        </span>
      )
    }
    case 'list':
      return <ListText {...common} field={field} value={value} onChange={onChange} />
    case 'keyvalue':
      return <KeyValueEditor field={field} id={id} value={value} onChange={onChange} disabled={disabled} />
    case 'object': {
      const obj = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
      return (
        <div className="grid gap-2 rounded-md border border-border-subtle p-2 sm:grid-cols-2">
          {(field.fields ?? []).map((f) => (
            <FieldRow key={f.name} field={f} id={`${id}-${f.name}`} value={obj[f.name]} disabled={disabled} error={null} onTextError={() => {}}
              onChange={(v) => { const next = { ...obj }; if (v === undefined) delete next[f.name]; else next[f.name] = v; onChange(Object.keys(next).length ? next : undefined) }} />
          ))}
        </div>
      )
    }
    case 'objectList':
      return <ObjectListEditor field={field} id={id} value={value} onChange={onChange} disabled={disabled} />
    case 'file':
      return <Input {...common} type="text" inputMode="url" value={asText(value)} placeholder={field.placeholder ?? 'https://example.com/sample.pdf'} onChange={(e) => onChange(e.target.value || undefined)} />
    case 'json':
    default:
      return <JsonText {...common} value={value} onChange={onChange} onTextError={onTextError} />
  }
}

/** A list as one item per line (items coerced to the declared item type). */
function ListText({ field, value, onChange, ...rest }: { field: TestField; value: unknown; onChange: (value: unknown) => void } & Record<string, any>) {
  const [text, setText] = useState(() => (Array.isArray(value) ? value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\n') : asText(value)))
  return (
    <Textarea
      {...rest}
      rows={Math.min(8, Math.max(3, text.split('\n').length + 1))}
      value={text}
      placeholder={field.itemKind === 'number' || field.itemKind === 'integer' ? '1\n2\n3' : field.itemKind === 'boolean' ? 'true\nfalse' : 'First\nSecond'}
      onKeyDown={submitOnModEnter}
      onChange={(e) => {
        setText(e.target.value)
        const items = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => coerceListItem(field.itemKind, s))
        onChange(items.length ? items : undefined)
      }}
    />
  )
}

/** Free JSON for complex values: the value updates when the text parses, otherwise the field shows why. */
function JsonText({ value, onChange, onTextError, ...rest }: { value: unknown; onChange: (value: unknown) => void; onTextError: (message: string | null) => void } & Record<string, any>) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)))
  return (
    <Textarea
      {...rest}
      rows={Math.min(10, Math.max(3, text.split('\n').length + 1))}
      spellCheck={false}
      className="bg-subtle font-mono text-xs"
      value={text}
      placeholder='{ "key": "value" }'
      onKeyDown={submitOnModEnter}
      onChange={(e) => {
        const next = e.target.value
        setText(next)
        if (!next.trim()) { onTextError(null); onChange(undefined); return }
        try {
          onChange(JSON.parse(next))
          onTextError(null)
        } catch (err) {
          onTextError(`Not valid JSON: ${(err as Error).message}`)
        }
      }}
    />
  )
}

/** A small object without declared fields: key / value rows (values as text). */
function KeyValueEditor({ field, id, value, onChange, disabled }: { field: TestField; id: string; value: unknown; onChange: (value: unknown) => void; disabled?: boolean }) {
  const [rows, setRows] = useState<Array<[string, string]>>(() => {
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
    const entries = Object.entries(obj).map(([k, v]) => [k, asText(v)] as [string, string])
    return entries.length ? entries : [['', '']]
  })
  const commit = (next: Array<[string, string]>) => {
    setRows(next)
    const obj = Object.fromEntries(next.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]))
    onChange(Object.keys(obj).length ? obj : undefined)
  }
  return (
    <div className="space-y-1.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <Input size="sm" aria-label={`${field.label} key ${i + 1}`} id={i === 0 ? id : undefined} value={k} placeholder="Key" disabled={disabled} onChange={(e) => commit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} className="font-mono text-xs" />
          <Input size="sm" aria-label={`${field.label} value ${i + 1}`} value={v} placeholder="Value" disabled={disabled} onChange={(e) => commit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
          <IconButton type="button" size="sm" label={`Remove row ${i + 1}`} icon={<X />} disabled={disabled} onClick={() => commit(rows.length > 1 ? rows.filter((_, j) => j !== i) : [['', '']])} />
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" leadingIcon={<Plus />} disabled={disabled} onClick={() => setRows([...rows, ['', '']])}>Add a key</Button>
    </div>
  )
}

/** A list of objects with declared scalar fields: one group per item. */
function ObjectListEditor({ field, id, value, onChange, disabled }: { field: TestField; id: string; value: unknown; onChange: (value: unknown) => void; disabled?: boolean }) {
  const items = Array.isArray(value) ? value.map((v) => (v && typeof v === 'object' ? v as Record<string, unknown> : {})) : []
  const commit = (next: Array<Record<string, unknown>>) => onChange(next.length ? next : undefined)
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="relative rounded-md border border-border-subtle p-2 pr-10">
          <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-fg-muted">Item {i + 1}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(field.fields ?? []).map((f) => (
              <FieldRow key={f.name} field={f} id={`${id}-${i}-${f.name}`} value={item[f.name]} disabled={disabled} error={null} onTextError={() => {}}
                onChange={(v) => commit(items.map((it, j) => {
                  if (j !== i) return it
                  const next = { ...it }
                  if (v === undefined) delete next[f.name]
                  else next[f.name] = v
                  return next
                }))} />
            ))}
          </div>
          <IconButton type="button" size="sm" label={`Remove item ${i + 1}`} icon={<X />} disabled={disabled} className="absolute right-1.5 top-1.5" onClick={() => commit(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" leadingIcon={<ListPlus />} disabled={disabled} onClick={() => commit([...items, {}])}>Add an item</Button>
    </div>
  )
}
