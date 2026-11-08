/**
 * Call Reference step inputs (lib/workflow-node-handlers callReferenceInputValue):
 * a blank optional input stays empty — the input's own name is never sent
 * as its value (`?page_size=page_size`).
 */
import { describe, expect, it } from 'vitest'
import { callReferenceInputValue } from '@/lib/workflow-node-handlers'

const ctx = (variables: Record<string, unknown> = {}) => ({ variables }) as any

describe('callReferenceInputValue', () => {
  it('a blank optional input with no default and no same-named variable is empty, not its name', () => {
    expect(callReferenceInputValue({ name: 'page_size' }, undefined, ctx())).toBeUndefined()
    expect(callReferenceInputValue({ name: 'page_size' }, '', ctx())).toBeUndefined()
    expect(callReferenceInputValue({ name: 'page_size' }, '   ', ctx())).toBeUndefined()
    expect(callReferenceInputValue({ name: 'customer id' }, undefined, ctx())).toBeUndefined()
  })

  it('falls back to the default value', () => {
    expect(callReferenceInputValue({ name: 'limit', default_value: 25 }, '', ctx())).toBe(25)
  })

  it('a mapping is resolved', () => {
    expect(callReferenceInputValue({ name: 'email' }, '{{form.email}}', ctx({ form: { email: 'a@b.c' } }))).toBe('a@b.c')
    // A mapping that resolves empty stays empty (no default substitution here; the executor applies defaults).
    expect(callReferenceInputValue({ name: 'email' }, '{{missing}}', ctx())).toBe('')
  })

  it('an unmapped input reads the same-named run variable', () => {
    expect(callReferenceInputValue({ name: 'customer_id' }, undefined, ctx({ customer_id: 'C-1' }))).toBe('C-1')
    expect(callReferenceInputValue({ name: 'customer_id', default_value: 'D' }, undefined, ctx({ customer_id: '' }))).toBe('D')
  })

  it('static inputs keep their value', () => {
    expect(callReferenceInputValue({ name: 'v', source: 'static', default_value: '2' }, undefined, ctx({ v: 'x' }))).toBe('2')
  })
})
