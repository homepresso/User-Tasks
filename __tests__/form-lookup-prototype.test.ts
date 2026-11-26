/**
 * Form lookup items copy configured display fields into `fields` by path. A
 * path such as `__proto__.hasOwnProperty` must never reach Object.prototype
 * (a process-wide, every-tenant denial of service).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { isLookupPath, toLookupItem } from '@/lib/forms/lookup'

describe('lookup paths and prototype pollution', () => {
  afterEach(() => {
    delete (Object.prototype as any).polluted
  })

  it('rejects forbidden segments as lookup paths', () => {
    for (const p of ['__proto__', '__proto__.x', 'a.constructor.prototype', 'prototype']) expect(isLookupPath(p)).toBe(false)
    expect(isLookupPath('address.city')).toBe(true)
  })

  it('toLookupItem never writes to Object.prototype', () => {
    const config = { source: 'reference', value_field: 'id', display_fields: ['__proto__.polluted', 'constructor.prototype.polluted', 'name'] } as any
    const item = toLookupItem(config, { id: '1', name: 'One', polluted: 'x', __proto__: { polluted: 'y' } })
    expect(({} as any).polluted).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call({ a: 1 }, 'a')).toBe(true)
    expect(item?.value).toBe('1')
  })
})
