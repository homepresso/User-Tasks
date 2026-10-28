import { describe, it, expect } from 'vitest'
import {
  normalizeTaskFields,
  validateTaskFieldValues,
  coerceTaskFieldValues,
  defaultTaskFieldValues,
  mergeTaskFieldValues,
  type TaskFieldDef,
} from '@/lib/task-field-schema'

const FIELDS: TaskFieldDef[] = [
  { key: 'amount', label: 'Amount', type: 'number', required: true },
  { key: 'reason', label: 'Reason', type: 'text' },
  { key: 'urgent', label: 'Urgent', type: 'boolean' },
  { key: 'category', label: 'Category', type: 'choice', options: ['A', 'B'] },
  { key: 'due', label: 'Due', type: 'date' },
]

describe('normalizeTaskFields', () => {
  it('returns [] for non-arrays', () => {
    expect(normalizeTaskFields(undefined)).toEqual([])
    expect(normalizeTaskFields({})).toEqual([])
    expect(normalizeTaskFields('x')).toEqual([])
  })

  it('derives the key from the label when empty', () => {
    expect(normalizeTaskFields([{ label: 'Cost Centre #', type: 'text' }])).toEqual([
      { key: 'cost_centre', label: 'Cost Centre #', type: 'text' },
    ])
  })

  it('slugs explicit keys and uses the key as label fallback', () => {
    expect(normalizeTaskFields([{ key: 'My Key' }])).toEqual([{ key: 'my_key', label: 'my_key', type: 'text' }])
  })

  it('drops entries without key/label, non-objects and duplicates', () => {
    const result = normalizeTaskFields([
      null,
      'amount',
      { label: '' },
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'amount', label: 'Amount again', type: 'text' },
    ])
    expect(result.map((f) => f.key)).toEqual(['amount'])
    expect(result[0].type).toBe('number')
  })

  it('falls back to text for unknown types', () => {
    expect(normalizeTaskFields([{ key: 'x', type: 'rich_text' }])[0].type).toBe('text')
  })

  it('trims and dedupes choice options; keeps required/placeholder/default', () => {
    const [field] = normalizeTaskFields([
      { key: 'c', label: 'C', type: 'choice', options: [' A', 'B', 'A', '', null], required: true, placeholder: 'Pick', default: 'A' },
    ])
    expect(field).toEqual({ key: 'c', label: 'C', type: 'choice', options: ['A', 'B'], required: true, placeholder: 'Pick', default: 'A' })
  })

  it('omits options for non-choice fields and empty defaults', () => {
    const [field] = normalizeTaskFields([{ key: 'n', type: 'number', options: ['x'], default: '' }])
    expect(field).toEqual({ key: 'n', label: 'n', type: 'number' })
  })
})

describe('validateTaskFieldValues', () => {
  it('passes valid values', () => {
    expect(validateTaskFieldValues(FIELDS, { amount: '12.5', urgent: true, category: 'B', due: '2026-10-15' })).toEqual({})
    expect(validateTaskFieldValues(FIELDS, { amount: 3, due: '2026-10-15T10:00:00Z' })).toEqual({})
  })

  it('flags missing required fields', () => {
    expect(validateTaskFieldValues(FIELDS, {})).toEqual({ amount: 'Amount is required' })
    expect(validateTaskFieldValues(FIELDS, { amount: '  ' })).toEqual({ amount: 'Amount is required' })
  })

  it('flags bad numbers, choices and dates', () => {
    const errors = validateTaskFieldValues(FIELDS, { amount: 'abc', category: 'C', due: '15/10/2026' })
    expect(Object.keys(errors).sort()).toEqual(['amount', 'category', 'due'])
    expect(errors.category).toContain('A, B')
  })

  it('flags invalid booleans and requires required booleans to be true', () => {
    expect(validateTaskFieldValues(FIELDS, { amount: 1, urgent: 'maybe' })).toEqual({ urgent: 'Urgent must be true or false' })
    const required: TaskFieldDef[] = [{ key: 'agree', label: 'Agree', type: 'boolean', required: true }]
    expect(validateTaskFieldValues(required, { agree: false })).toEqual({ agree: 'Agree is required' })
    expect(validateTaskFieldValues(required, { agree: 'yes' })).toEqual({})
  })

  it('partial mode only checks provided keys and skips required', () => {
    expect(validateTaskFieldValues(FIELDS, { reason: 'x' }, { partial: true })).toEqual({})
    expect(validateTaskFieldValues(FIELDS, { amount: 'abc' }, { partial: true })).toEqual({ amount: 'Amount must be a number' })
  })
})

describe('coerceTaskFieldValues', () => {
  it('coerces types and ignores undeclared keys', () => {
    expect(coerceTaskFieldValues(FIELDS, {
      amount: '12.5', reason: '', urgent: 'true', category: 'A', due: '2026-10-15', extra: 'x',
    })).toEqual({ amount: 12.5, reason: null, urgent: true, category: 'A', due: '2026-10-15' })
  })

  it('only returns keys that were provided', () => {
    expect(coerceTaskFieldValues(FIELDS, { reason: 'hi' })).toEqual({ reason: 'hi' })
  })

  it('treats a blank boolean as false', () => {
    expect(coerceTaskFieldValues(FIELDS, { urgent: '' })).toEqual({ urgent: false })
  })
})

describe('defaultTaskFieldValues', () => {
  it('seeds defaults (resolved) and blanks', () => {
    const fields = normalizeTaskFields([
      { key: 'amount', type: 'number', default: '{{amt}}' },
      { key: 'urgent', type: 'boolean' },
      { key: 'note', type: 'text' },
    ])
    expect(defaultTaskFieldValues(fields, (v) => (v === '{{amt}}' ? '42' : v))).toEqual({ amount: 42, urgent: false, note: null })
  })
})

describe('mergeTaskFieldValues', () => {
  const metadata = { fields: FIELDS, template_values: { amount: 5, legacy: 'kept' } }

  it('merges coerced values over existing template_values', () => {
    const { errors, templateValues } = mergeTaskFieldValues(metadata, { reason: 'ok', unknown: 'dropped' })
    expect(errors).toEqual({})
    expect(templateValues).toEqual({ amount: 5, legacy: 'kept', reason: 'ok' })
  })

  it('counts previously saved values toward required fields on completion', () => {
    expect(mergeTaskFieldValues(metadata, {}).errors).toEqual({})
    expect(mergeTaskFieldValues({ fields: FIELDS }, {}).errors).toEqual({ amount: 'Amount is required' })
  })

  it('partial merge skips required checks', () => {
    expect(mergeTaskFieldValues({ fields: FIELDS }, { reason: 'draft' }, { partial: true }).errors).toEqual({})
  })

  it('is a no-op for tasks without fields', () => {
    expect(mergeTaskFieldValues({ template_values: { a: 1 } }, { a: 2 })).toEqual({ errors: {}, templateValues: { a: 1 } })
    expect(mergeTaskFieldValues(null, undefined)).toEqual({ errors: {}, templateValues: {} })
  })
})
