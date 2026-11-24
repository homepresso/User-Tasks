/**
 * Extensibility Test tab / Try it: the generated typed input form (schema →
 * field mapping, defaults, validation with the runtime's own rules, the
 * JSON view's two-way sync, secrets never persisted or echoed, remembered
 * inputs, function switching) and the typed results panel.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ActionField, ActionManifest, ActionOperation } from '@/lib/custom-actions/contract'
import { prepareActionInputs, checkActionInput } from '@/lib/custom-actions/manifest'
import type { ControlPropSpec } from '@/lib/forms/custom-controls/contract'
import {
  REDACTED, actionFieldToTestField, coerceListItem, controlPropToTestField, defaultTestValues, fieldsNamedInError,
  formatOutputValue, fromLocalDateTimeInput, mergeJsonIntoValues, operationSample, outputRows, parseTestJson,
  previewPropsOf, recallTestInputs, redactSecrets, rememberTestInputs, secretValuesOf, testInputsOf,
  testInputsStorageKey, toLocalDateTimeInput, validateActionInputs, validateControlProps,
} from '@/lib/extensibility-test-inputs'
import { TestInputForm, useTestInputs } from '@/components/extensibility/test-input-form'
import { ActionTestResultPanel, ActionTestRunner } from '@/components/extensibility/action-test-runner'

class MemoryStorage {
  data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null }
  key(i: number) { return [...this.data.keys()][i] ?? null }
  removeItem(k: string) { this.data.delete(k) }
  setItem(k: string, v: string) { this.data.set(k, String(v)) }
}

const kind = (field: ActionField) => actionFieldToTestField(field).kind

describe('schema → field mapping (actions)', () => {
  it('maps every declared input type to its control', () => {
    expect(kind({ name: 'a', type: 'string' })).toBe('string')
    expect(kind({ name: 'a', type: 'text' })).toBe('text')
    expect(actionFieldToTestField({ name: 'a', type: 'number' })).toMatchObject({ kind: 'number', step: 'any' })
    expect(actionFieldToTestField({ name: 'a', type: 'integer' })).toMatchObject({ kind: 'integer', step: 1 })
    expect(kind({ name: 'a', type: 'boolean' })).toBe('boolean')
    expect(kind({ name: 'a', type: 'date' })).toBe('date')
    expect(kind({ name: 'a', type: 'datetime' })).toBe('datetime')
    expect(actionFieldToTestField({ name: 'a', type: 'select', options: [{ value: 'x' }, { value: 'y', label: 'Why' }] }).options)
      .toEqual([{ value: 'x', label: 'x' }, { value: 'y', label: 'Why' }])
    expect(kind({ name: 'a', type: 'file' })).toBe('file')
    expect(kind({ name: 'a', type: 'json' })).toBe('json')
  })

  it('lists of scalars are line lists with the item type; lists of flat objects are repeatable groups; the rest JSON', () => {
    expect(actionFieldToTestField({ name: 'a', type: 'array', items: { type: 'number' } })).toMatchObject({ kind: 'list', itemKind: 'number', typeLabel: 'list of numbers' })
    expect(actionFieldToTestField({ name: 'a', type: 'array', items: { type: 'boolean' } })).toMatchObject({ kind: 'list', itemKind: 'boolean' })
    const rows = actionFieldToTestField({ name: 'a', type: 'array', items: { type: 'object', fields: [{ name: 'label', type: 'string' }, { name: 'qty', type: 'integer' }] } })
    expect(rows.kind).toBe('objectList')
    expect(rows.fields!.map((f) => f.kind)).toEqual(['string', 'integer'])
    expect(kind({ name: 'a', type: 'array' })).toBe('json')
    expect(kind({ name: 'a', type: 'array', items: { type: 'object' } })).toBe('json')
    expect(kind({ name: 'a', type: 'array', items: { type: 'object', fields: [{ name: 'deep', type: 'object', fields: [{ name: 'x', type: 'string' }] }] } })).toBe('json')
  })

  it('objects with fields get nested fields; free objects a key / value editor', () => {
    const obj = actionFieldToTestField({ name: 'addr', type: 'object', fields: [{ name: 'city', type: 'string' }, { name: 'zip', type: 'string', required: true }] })
    expect(obj.kind).toBe('object')
    expect(obj.fields!.map((f) => [f.name, f.required])).toEqual([['city', false], ['zip', true]])
    expect(kind({ name: 'headers', type: 'object' })).toBe('keyvalue')
  })

  it('carries label, description, placeholder, default and required; credential-looking names are secrets', () => {
    expect(actionFieldToTestField({ name: 'n', type: 'number', label: 'Number', description: 'The input', default: 4, required: true, placeholder: '9' }))
      .toMatchObject({ label: 'Number', description: 'The input', default: 4, required: true, placeholder: '9', typeLabel: 'number' })
    expect(kind({ name: 'api_key', type: 'string' })).toBe('secret')
    expect(kind({ name: 'password', type: 'string' })).toBe('secret')
    expect(kind({ name: 'jwt', type: 'string' })).toBe('string')
  })
})

describe('schema → field mapping (form control props)', () => {
  it('maps every prop type', () => {
    const map = (prop: ControlPropSpec) => controlPropToTestField(prop)
    expect(map({ name: 'a', type: 'string' }).kind).toBe('string')
    expect(map({ name: 'a', type: 'text' }).kind).toBe('text')
    expect(map({ name: 'a', type: 'number', min: 1, max: 5 })).toMatchObject({ kind: 'number', min: 1, max: 5 })
    expect(map({ name: 'a', type: 'boolean' }).kind).toBe('boolean')
    expect(map({ name: 'a', type: 'select', options: ['x', { value: 'y', label: 'Why' }] }).options).toEqual([{ value: 'x', label: 'x' }, { value: 'y', label: 'Why' }])
    expect(map({ name: 'a', type: 'color' }).kind).toBe('color')
    expect(map({ name: 'a', type: 'string[]' })).toMatchObject({ kind: 'list', itemKind: 'string', typeLabel: 'list of strings' })
    expect(map({ name: 'a', type: 'json' }).kind).toBe('json')
  })
})

const OP: ActionOperation = {
  id: 'gst',
  label: 'GST',
  inputs: [
    { name: 'amount', label: 'Amount', type: 'number', required: true },
    { name: 'rate', label: 'Rate', type: 'number', default: 15 },
    { name: 'mode', label: 'Mode', type: 'select', options: [{ value: 'add' }, { value: 'remove' }] },
    { name: 'count', label: 'Count', type: 'integer' },
    { name: 'when', label: 'When', type: 'date' },
    { name: 'tags', label: 'Tags', type: 'array', items: { type: 'number' } },
  ],
  outputs: [{ name: 'total', type: 'number' }, { name: 'note', type: 'text' }],
}

describe('defaults and validation', () => {
  it('starts from defaults with the sample / examples over them', () => {
    const fields = OP.inputs.map((f) => actionFieldToTestField(f))
    expect(defaultTestValues(fields)).toEqual({ rate: 15 })
    expect(defaultTestValues(fields, { amount: 100, rate: 10 })).toEqual({ amount: 100, rate: 10 })
    expect(operationSample({ ...OP, inputs: [{ name: 'x', type: 'string', example: 'hi' }] })).toEqual({ x: 'hi' })
    expect(operationSample({ ...OP, sample: { amount: 3 } })).toEqual({ amount: 3 })
  })

  it('flags exactly what the runtime refuses (same messages as prepareActionInputs)', () => {
    const values = { amount: 'abc', mode: 'double', count: 1.5, when: 'not a date', tags: [1, 'x'] }
    const errors = validateActionInputs(OP, values)
    expect(Object.values(errors)).toEqual(prepareActionInputs(OP, values).errors)
    expect(errors).toEqual({
      amount: 'Amount must be a number',
      mode: 'Mode must be one of add, remove',
      count: 'Count must be a whole number',
      when: 'When must be a date (YYYY-MM-DD or ISO 8601)',
      tags: 'Tags item 2 must be a number',
    })
    expect(validateActionInputs(OP, {})).toEqual({ amount: 'Amount is required' })
    expect(validateActionInputs(OP, { amount: 12 })).toEqual({})
  })

  it('checkActionInput is what prepareActionInputs runs (defaults fill blanks before the required check)', () => {
    expect(checkActionInput({ name: 'r', type: 'number', required: true, default: 2 }, '')).toEqual({ value: 2 })
    expect(checkActionInput({ name: 'r', type: 'number', required: true }, null)).toEqual({ error: 'is required' })
    expect(prepareActionInputs(OP, { amount: '7' })).toEqual({ inputs: { amount: 7, rate: 15, mode: null, count: null, when: null, tags: null }, errors: [] })
  })

  it('control props: required, choices, colours, JSON and number bounds', () => {
    const props: ControlPropSpec[] = [
      { name: 'title', label: 'Title', type: 'string', required: true },
      { name: 'size', label: 'Size', type: 'number', min: 1, max: 10 },
      { name: 'tone', label: 'Tone', type: 'select', options: ['a', 'b'] },
      { name: 'accent', label: 'Accent', type: 'color' },
      { name: 'config', label: 'Config', type: 'json' },
      { name: 'withDefault', type: 'string', required: true, default: 'x' },
    ]
    expect(validateControlProps(props, {})).toEqual({ title: 'Title is required' })
    expect(validateControlProps(props, { title: 'T', size: 20, tone: 'c', accent: 'red', config: '{bad' })).toEqual({
      size: 'Size must be at most 10',
      tone: 'Tone must be one of the choices',
      accent: 'Accent must be a colour (#RRGGBB, rgb() or hsl())',
      config: 'Config must be valid JSON (at most 32 KB)',
    })
    expect(validateControlProps(props, { title: 'T', size: 0 })).toEqual({ size: 'Size must be at least 1' })
    expect(previewPropsOf(props, { title: 'T', size: 20, tone: 'c' })).toEqual({ title: 'T', size: 10, withDefault: 'x' })
  })

  it('names the fields a run refused in its error message', () => {
    const fields = [...OP.inputs, { name: 'amount_due', label: 'Amount due', type: 'number' as const }].map((f) => actionFieldToTestField(f))
    expect(fieldsNamedInError(fields, 'Invalid inputs: Amount due must be a number; Mode must be one of add, remove').sort()).toEqual(['amount_due', 'mode'])
    expect(fieldsNamedInError(fields, 'Invalid inputs: amount is required')).toEqual(['amount'])
    expect(fieldsNamedInError(fields, null)).toEqual([])
  })

  it('coerces typed list items and round-trips datetime-local', () => {
    expect(coerceListItem('number', ' 4.5 ')).toBe(4.5)
    expect(coerceListItem('integer', 'x')).toBe('x')
    expect(coerceListItem('boolean', 'Yes')).toBe(true)
    expect(coerceListItem('string', ' a ')).toBe('a')
    const iso = fromLocalDateTimeInput('2026-03-04T05:06')!
    expect(new Date(iso).toISOString()).toBe(iso)
    expect(toLocalDateTimeInput(iso)).toBe('2026-03-04T05:06')
    expect(toLocalDateTimeInput('nope')).toBe('')
    expect(fromLocalDateTimeInput('')).toBeUndefined()
  })
})

describe('JSON view two-way sync', () => {
  const fields = [
    actionFieldToTestField({ name: 'amount', type: 'number' }),
    actionFieldToTestField({ name: 'api_key', type: 'string' }),
  ]

  it('form → JSON: declared non-blank values; secrets left out of the view', () => {
    expect(testInputsOf(fields, { amount: 3, api_key: 'sk-123456', other: 1, blank: '' })).toEqual({ amount: 3, api_key: 'sk-123456' })
    expect(testInputsOf(fields, { amount: 3, api_key: 'sk-123456' }, { withSecrets: false })).toEqual({ amount: 3 })
    expect(testInputsOf(fields, { amount: '', api_key: undefined })).toEqual({})
  })

  it('JSON → form: parsed values replace the form, secrets keep the form value; invalid JSON is an error, not a reset', () => {
    expect(mergeJsonIntoValues(fields, { amount: 1, api_key: 'sk-keep' }, { amount: 9, api_key: 'from-json', extra: true }))
      .toEqual({ amount: 9, api_key: 'sk-keep', extra: true })
    expect(parseTestJson('{ "amount": 2 }')).toEqual({ value: { amount: 2 } })
    expect(parseTestJson('')).toEqual({ value: {} })
    expect('error' in parseTestJson('{ amount: ')).toBe(true)
    expect(parseTestJson('[1]')).toEqual({ error: 'Inputs must be a JSON object ({ "name": value })' })
  })
})

describe('secrets', () => {
  const fields = [
    actionFieldToTestField({ name: 'amount', type: 'number' }),
    actionFieldToTestField({ name: 'client_secret', type: 'string' }),
  ]

  it('are never remembered in local storage', () => {
    const storage = new MemoryStorage() as unknown as Storage
    const key = testInputsStorageKey('action', 'act-1', 'gst')
    rememberTestInputs(key, fields, { amount: 5, client_secret: 'hunter22' }, storage)
    expect(storage.getItem(key)).toBe('{"amount":5}')
    expect(storage.getItem(key)).not.toContain('hunter22')
    // A tampered entry holding a secret is not read back either.
    storage.setItem(key, JSON.stringify({ amount: 6, client_secret: 'planted', unknown: 1 }))
    expect(recallTestInputs(key, fields, storage)).toEqual({ amount: 6 })
    expect(recallTestInputs('missing', fields, storage)).toBeNull()
    storage.setItem(key, '{oops')
    expect(recallTestInputs(key, fields, storage)).toBeNull()
  })

  it('are redacted from outputs, logs and errors', () => {
    const secrets = secretValuesOf(fields, { amount: 1, client_secret: 'hunter22' })
    expect(secrets).toEqual(['hunter22'])
    const result = {
      ok: false,
      outputs: { echo: 'token=hunter22', nested: [{ v: 'hunter22' }], n: 4 },
      logs: [{ level: 'info', message: 'using hunter22' }],
      error: { message: 'bad hunter22', code: 'action' },
    }
    const redacted = redactSecrets(result, secrets)
    expect(JSON.stringify(redacted)).not.toContain('hunter22')
    expect(redacted.outputs.echo).toBe(`token=${REDACTED}`)
    expect(redacted.outputs.n).toBe(4)
    expect(redactSecrets(result, [])).toBe(result)
    // Very short values are not treated as secrets (they would redact noise).
    expect(secretValuesOf(fields, { client_secret: 'ab' })).toEqual([])
  })
})

/** Renders the form with its state hook (static markup: the first paint). */
function renderForm(fieldsIn: ActionField[], opts: { sample?: Record<string, unknown>; errors?: Record<string, string>; storageKey?: string | null } = {}) {
  const fields = fieldsIn.map((f) => actionFieldToTestField(f))
  function Harness() {
    const state = useTestInputs(fields, { storageKey: opts.storageKey ?? null, sample: opts.sample })
    return createElement(TestInputForm, { state, idBase: 't', errors: opts.errors ?? {}, emptyText: 'This function takes no inputs.' })
  }
  return renderToStaticMarkup(createElement(Harness))
}

describe('generated form rendering', () => {
  it('renders one typed control per input with label, required marker, help and the sample pre-filled', () => {
    const html = renderForm([
      { name: 'value', label: 'Value', type: 'number', required: true, description: 'Number to take the root of' },
      { name: 'precise', label: 'Precise', type: 'boolean', default: true },
      { name: 'unit', label: 'Unit', type: 'select', options: [{ value: 'm' }, { value: 'ft', label: 'Feet' }] },
      { name: 'on', label: 'On', type: 'date' },
      { name: 'at', label: 'At', type: 'datetime' },
      { name: 'notes', label: 'Notes', type: 'text' },
      { name: 'list', label: 'List', type: 'array', items: { type: 'string' } },
      { name: 'payload', label: 'Payload', type: 'json' },
      { name: 'doc', label: 'Doc', type: 'file' },
      { name: 'api_key', label: 'API key', type: 'string' },
      { name: 'headers', label: 'Headers', type: 'object' },
      { name: 'customer', label: 'Customer', type: 'string', placeholder: 'Acme' },
    ], { sample: { value: 16, list: ['a', 'b'], payload: { x: 1 }, customer: 'Globex' } })
    // A string is a plain text box holding the raw text (not JSON-quoted).
    expect(html).toMatch(/<input[^>]*type="text"[^>]*id="t-customer"[^>]*value="Globex"|<input[^>]*id="t-customer"[^>]*type="text"[^>]*value="Globex"/)
    expect(html).toContain('data-testid="test-input-form"')
    expect(html).toMatch(/<input[^>]*type="number"[^>]*value="16"/)
    expect(html).toContain('Number to take the root of')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('<option value="ft">Feet</option>')
    expect(html).toContain('type="date"')
    expect(html).toContain('type="datetime-local"')
    expect(html).toContain('a\nb</textarea>')
    expect(html).toContain('&quot;x&quot;: 1')
    expect(html).toContain('Test cannot upload a sample file')
    expect(html).toMatch(/<input[^>]*type="password"[^>]*autoComplete="off"|<input[^>]*autoComplete="off"[^>]*type="password"/)
    expect(html).toContain('Masked; never saved or shown in results')
    expect(html).toContain('Add a key')
    expect(html).toContain('Edit as JSON')
    expect(html).toContain('Reset to defaults')
    // Required marker on the required field only.
    expect((html.match(/text-danger" aria-hidden="true">\*/g) ?? []).length).toBe(1)
  })

  it('shows inline errors on the failing input', () => {
    const html = renderForm([{ name: 'value', label: 'Value', type: 'number' }], { errors: { value: 'Value must be a number' } })
    expect(html).toContain('Value must be a number')
    expect(html).toContain('aria-invalid="true"')
  })

  it('a function without inputs says so', () => {
    expect(renderForm([])).toContain('This function takes no inputs.')
  })

  it('pre-fills remembered inputs (never secrets) over the sample', () => {
    const storage = new MemoryStorage()
    const prev = (globalThis as { window?: unknown }).window
    ;(globalThis as { window?: unknown }).window = { localStorage: storage }
    try {
      const key = testInputsStorageKey('action', 'a1', 'run')
      storage.setItem(key, JSON.stringify({ value: 81 }))
      const html = renderForm([{ name: 'value', label: 'Value', type: 'number' }], { sample: { value: 16 }, storageKey: key })
      expect(html).toMatch(/value="81"/)
    } finally {
      ;(globalThis as { window?: unknown }).window = prev
    }
  })
})

const MANIFEST: ActionManifest = {
  manifest_version: 1,
  key: 'math',
  name: 'Math',
  version: '1.0.0',
  operations: [
    { id: 'pi', label: 'Pi', inputs: [], outputs: [{ name: 'value', type: 'number' }] },
    { id: 'sqrt', label: 'Square root', inputs: [{ name: 'value', label: 'Value', type: 'number', required: true }], outputs: [{ name: 'root', type: 'number' }] },
  ],
  capabilities: {},
  limits: { timeout_ms: 1000, memory_mb: 32 },
}

describe('function switching', () => {
  const run = async () => ({ ok: true as const, data: { ok: true } })
  it('the picker lists the functions and the form is generated for the chosen one', () => {
    const html = renderToStaticMarkup(createElement(ActionTestRunner, { manifest: MANIFEST, activityId: 'a', canEdit: true, run: run as never }))
    expect(html).toContain('<option value="pi" selected="">Pi</option>')
    expect(html).toContain('This function takes no inputs.')
    expect(html).toContain('Run test')
    const sqrtFirst = { ...MANIFEST, operations: [MANIFEST.operations[1], MANIFEST.operations[0]] }
    const html2 = renderToStaticMarkup(createElement(ActionTestRunner, { manifest: sqrtFirst, activityId: 'a', canEdit: true, run: run as never }))
    expect(html2).not.toContain('This function takes no inputs.')
    expect(html2).toContain('id="test-sqrt-value"')
  })

  it("a script activity starts from its saved demo inputs (the function's sample wins where both set a value)", () => {
    const legacy = { ...MANIFEST, operations: [{ ...MANIFEST.operations[1], id: 'run' }] }
    const html = renderToStaticMarkup(createElement(ActionTestRunner, { manifest: legacy, activityId: 'a', canEdit: true, strict: false, demoInputs: { value: 49 }, run: run as never }))
    expect(html).toMatch(/id="test-run-value"[^>]*value="49"|value="49"[^>]*id="test-run-value"/)
  })

  it('a single-function action shows no picker', () => {
    const single = { ...MANIFEST, operations: [MANIFEST.operations[1]] }
    const html = renderToStaticMarkup(createElement(ActionTestRunner, { manifest: single, activityId: 'a', canEdit: true, run: run as never }))
    expect(html).not.toContain('<select')
    expect(html).toContain('Square root')
    expect(html).toContain('type="submit"')
  })
})

describe('results', () => {
  const op = MANIFEST.operations[1]
  it('typed outputs table: declared in order, missing ones flagged, undeclared ones kept; long values collapse', () => {
    const rows = outputRows([...op.outputs, { name: 'steps', type: 'array', items: { type: 'string' } }], { root: 4, extra: { a: 1 } })
    expect(rows).toEqual([
      { name: 'root', type: 'number', value: 4, declared: true, missing: false },
      { name: 'steps', type: 'list of strings', value: undefined, declared: true, missing: true },
      { name: 'extra', type: 'object', value: { a: 1 }, declared: false, missing: false },
    ])
    expect(formatOutputValue('short')).toEqual({ text: 'short', long: false })
    expect(formatOutputValue('x'.repeat(200)).long).toBe(true)
    expect(formatOutputValue({ a: [1, 2, 3, 4, 5] }).long).toBe(true)
  })

  it('renders success with duration, the typed table, logs, warnings and raw JSON', () => {
    const html = renderToStaticMarkup(createElement(ActionTestResultPanel, {
      operation: op,
      result: { ok: true, outputs: { root: 4 }, logs: [{ level: 'warn', message: 'rounded' }], warnings: ['returned undeclared output "x" (kept)'], stats: { duration_ms: 12, host_calls: 0, memory_bytes: 2048 } },
    }))
    expect(html).toContain('Succeeded in 12 ms')
    expect(html).toContain('data-output="root"')
    expect(html).toMatch(/<td[^>]*>root<\/td><td[^>]*>number<\/td>/)
    expect(html).toContain('rounded')
    expect(html).toContain('returned undeclared output')
    expect(html).toContain('Raw JSON')
  })

  it('renders a failure with its code and message', () => {
    const html = renderToStaticMarkup(createElement(ActionTestResultPanel, {
      operation: op,
      result: { ok: false, error: { message: 'Invalid inputs: Value is required', code: 'invalid' }, logs: [], stats: null },
    }))
    expect(html).toContain('Failed (invalid): Invalid inputs: Value is required')
    expect(html).not.toContain('Raw JSON')
  })
})
