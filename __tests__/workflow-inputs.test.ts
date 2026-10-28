import { describe, expect, it } from 'vitest'
import {
  coerceValue,
  deriveInputFields,
  formatInputErrors,
  humanizeKey,
  initialFormValues,
  inputTypeOf,
  validateWorkflowInputs,
} from '@/lib/workflow-inputs'

describe('deriveInputFields', () => {
  it('maps the designer variable shape (string/number/boolean/object) to fields', () => {
    const fields = deriveInputFields([
      { id: '1', name: 'customer_name', type: 'string', defaultValue: '', description: 'Who it is for', required: true },
      { id: '2', name: 'amount', type: 'number', defaultValue: '100', description: '' },
      { id: '3', name: 'urgent', type: 'boolean', defaultValue: 'true', description: '' },
      { id: '4', name: 'payload', type: 'object', defaultValue: '{"a":1}', description: '' },
    ])
    expect(fields).toEqual([
      { key: 'customer_name', label: 'Customer name', type: 'text', required: true, default: null, description: 'Who it is for', options: null },
      { key: 'amount', label: 'Amount', type: 'number', required: false, default: 100, description: null, options: null },
      { key: 'urgent', label: 'Urgent', type: 'boolean', required: false, default: true, description: null, options: null },
      { key: 'payload', label: 'Payload', type: 'json', required: false, default: { a: 1 }, description: null, options: null },
    ])
  })

  it('refines strings by format and options, accepts direct types and labels', () => {
    const fields = deriveInputFields([
      { name: 'due', type: 'string', format: 'date', defaultValue: '2026-11-01' },
      { name: 'at', type: 'string', format: 'datetime' },
      { name: 'contact', type: 'email' },
      { name: 'site', type: 'string', format: 'url' },
      { name: 'region', type: 'string', format: 'select', options: 'EMEA, APAC,AMER', label: 'Sales region' },
      { name: 'tier', options: [{ value: 'gold', label: 'Gold' }, 'silver'] },
      { name: 'count', type: 'integer', required: 'true' },
      { name: 'list', type: 'array' },
      { name: 'weird', type: 'mystery' },
    ])
    expect(fields.map((f) => [f.key, f.type])).toEqual([
      ['due', 'date'], ['at', 'datetime'], ['contact', 'email'], ['site', 'url'], ['region', 'select'],
      ['tier', 'select'], ['count', 'number'], ['list', 'json'], ['weird', 'text'],
    ])
    expect(fields[0].default).toBe('2026-11-01')
    expect(fields[4]).toMatchObject({ label: 'Sales region', options: [{ value: 'EMEA', label: 'EMEA' }, { value: 'APAC', label: 'APAC' }, { value: 'AMER', label: 'AMER' }] })
    expect(fields[5].options).toEqual([{ value: 'gold', label: 'Gold' }, { value: 'silver', label: 'silver' }])
    expect(fields[6].required).toBe(true)
  })

  it('skips unnamed / duplicate variables and tolerates junk', () => {
    expect(deriveInputFields(null)).toEqual([])
    expect(deriveInputFields('nope')).toEqual([])
    expect(deriveInputFields([null, 42, { type: 'string' }, { name: 'a' }, { name: 'a', type: 'number' }]).map((f) => f.key)).toEqual(['a'])
  })

  it('drops an invalid default instead of failing', () => {
    expect(deriveInputFields([{ name: 'n', type: 'number', defaultValue: 'abc' }])[0].default).toBeNull()
    expect(deriveInputFields([{ name: 'j', type: 'object', defaultValue: '{bad' }])[0].default).toBeNull()
    expect(deriveInputFields([{ name: 'b', type: 'boolean', defaultValue: '' }])[0].default).toBe(false)
  })

  it('helpers', () => {
    expect(humanizeKey('customerName')).toBe('Customer name')
    expect(humanizeKey('po_number')).toBe('Po number')
    expect(inputTypeOf({ type: 'string', options: [] })).toBe('text')
  })
})

describe('validateWorkflowInputs', () => {
  const fields = deriveInputFields([
    { name: 'customer', type: 'string', required: true },
    { name: 'amount', type: 'number', defaultValue: '10' },
    { name: 'urgent', type: 'boolean' },
    { name: 'meta', type: 'object' },
    { name: 'due', type: 'string', format: 'date' },
    { name: 'at', type: 'string', format: 'datetime' },
    { name: 'email', type: 'string', format: 'email' },
    { name: 'site', type: 'string', format: 'url' },
    { name: 'region', type: 'string', format: 'select', options: 'EMEA,APAC' },
    { name: 'code', type: 'string', required: true, defaultValue: 'X1' },
  ])

  it('coerces strings from forms / the CLI to the field types', () => {
    const result = validateWorkflowInputs(fields, {
      customer: 'Acme', amount: '42.5', urgent: 'yes', meta: '{"a":[1]}', due: '2026-02-28', at: '2026-02-28T10:00:00Z',
      email: 'a@b.co', site: 'https://x.test/p', region: 'APAC',
    })
    expect(result.ok).toBe(true)
    expect(result.values).toEqual({
      customer: 'Acme', amount: 42.5, urgent: true, meta: { a: [1] }, due: '2026-02-28', at: '2026-02-28T10:00:00Z',
      email: 'a@b.co', site: 'https://x.test/p', region: 'APAC',
    })
    expect(result.warnings).toEqual([])
  })

  it('requires required inputs unless a default covers them', () => {
    const result = validateWorkflowInputs(fields, { amount: '' })
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([{ field: 'customer', message: 'Customer is required' }])
    // amount was empty: dropped so the default applies
    expect(result.values).toEqual({})
    expect(validateWorkflowInputs(fields, { customer: '   ' }).errors.map((e) => e.field)).toEqual(['customer'])
  })

  it('reports one error per invalid field', () => {
    const result = validateWorkflowInputs(fields, {
      customer: 'A', amount: 'lots', urgent: 'maybe', meta: '{x', due: '2026-02-30', at: 'soon', email: 'nope', site: 'ftp://x', region: 'MARS',
    })
    expect(result.errors.map((e) => e.field)).toEqual(['amount', 'urgent', 'meta', 'due', 'at', 'email', 'site', 'region'])
    expect(formatInputErrors(result.errors)).toContain('amount: Amount must be a number')
    expect(result.errors.find((e) => e.field === 'region')!.message).toBe('Region must be one of: EMEA, APAC')
  })

  it('passes undeclared keys through with a warning (internal _keys silently)', () => {
    const result = validateWorkflowInputs(fields, { customer: 'A', extra: 1, _version_id: 'v' })
    expect(result.ok).toBe(true)
    expect(result.values).toMatchObject({ customer: 'A', extra: 1, _version_id: 'v' })
    expect(result.warnings).toEqual(['Not declared as workflow inputs (passed through unchanged): extra'])
  })

  it('a workflow without inputs accepts anything unchanged', () => {
    const result = validateWorkflowInputs([], { anything: { deep: true }, n: '1' })
    expect(result).toEqual({ ok: true, values: { anything: { deep: true }, n: '1' }, errors: [], warnings: [] })
  })

  it('coerceValue keeps JSON values that are already parsed', () => {
    expect(coerceValue('json', { a: 1 }, null)).toEqual({ ok: true, value: { a: 1 } })
    expect(coerceValue('number', 3, null)).toEqual({ ok: true, value: 3 })
    expect(coerceValue('text', 5, null)).toEqual({ ok: true, value: '5' })
    expect(coerceValue('text', { a: 1 }, null).ok).toBe(false)
  })

  it('initialFormValues prefills defaults as control values', () => {
    expect(initialFormValues(fields)).toMatchObject({ customer: '', amount: '10', urgent: false, meta: '', code: 'X1' })
    expect(initialFormValues(deriveInputFields([{ name: 'j', type: 'object', defaultValue: '{"a":1}' }]))).toEqual({ j: '{\n  "a": 1\n}' })
  })
})
