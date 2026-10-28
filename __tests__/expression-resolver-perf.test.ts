/**
 * Perf phase 1 resolveExpression contracts: early return without "{{",
 * single evaluation of a whole-string function (non-deterministic functions
 * return the value that was computed), no per-call copy of the variables,
 * case-insensitive lookup via a key map, and a template cache that never
 * leaks values between contexts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveExpression } from '@/lib/expression-resolver'

afterEach(() => { vi.restoreAllMocks() })

describe('resolveExpression fast paths', () => {
  it('returns strings without "{{" untouched and without reading variables', () => {
    const variables = new Proxy({} as Record<string, unknown>, {
      get: () => { throw new Error('variables must not be read') },
      has: () => { throw new Error('variables must not be read') },
      ownKeys: () => { throw new Error('variables must not be enumerated') },
    })
    expect(resolveExpression('Plain text, {single} braces', { variables })).toBe('Plain text, {single} braces')
  })

  it('does not copy the variables to build the function scope', () => {
    let enumerations = 0
    const variables = new Proxy({ name: 'ada' } as Record<string, unknown>, {
      ownKeys: (target) => { enumerations++; return Reflect.ownKeys(target) },
    })
    expect(resolveExpression('{{=UPPER(name)}}', { variables })).toBe('ADA')
    expect(enumerations).toBe(0)
  })
})

describe('whole-string functions are evaluated once', () => {
  it('returns the GUID that was generated (one call)', () => {
    const spy = vi.spyOn(crypto, 'randomUUID')
    const value = resolveExpression('{{=GUID()}}', { variables: {} })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(value).toBe(spy.mock.results[0].value)
  })

  it('reads each argument variable once, like the mixed-string form', () => {
    const reads = (expr: string) => {
      let n = 0
      const variables: Record<string, unknown> = {}
      Object.defineProperty(variables, 'probe', { enumerable: true, get: () => { n++; return 'abc' } })
      const value = resolveExpression(expr, { variables })
      return { n, value }
    }
    const whole = reads('{{=UPPER(probe)}}')
    const mixed = reads('x {{=UPPER(probe)}}')
    expect(whole.value).toBe('ABC')
    expect(mixed.value).toBe('x ABC')
    expect(whole.n).toBe(mixed.n)
  })

  it('still returns raw typed values for a whole-string function', () => {
    expect(resolveExpression('{{=COUNT(items)}}', { variables: { items: [1, 2, 3] } })).toBe(3)
    expect(resolveExpression('{{=ADD(1, 2)}}', { variables: {} })).toBe(3)
  })
})

describe('scope and lookup semantics are unchanged', () => {
  it('exposes the task to functions, with a variable named task winning', () => {
    const task = { title: 'Invoice', items: [1, 2] }
    expect(resolveExpression('{{=COUNT(task.items)}}', { variables: {}, task })).toBe(2)
    expect(resolveExpression('{{=COUNT(task.items)}}', { variables: { task: { items: [1] } }, task })).toBe(1)
  })

  it('resolves variable names case-insensitively, first match wins', () => {
    const variables = { CustomerName: 'Ada', customername: 'second' }
    expect(resolveExpression('{{CUSTOMERNAME}}', { variables })).toBe('Ada')
    expect(resolveExpression('Hi {{customerNAME}}', { variables })).toBe('Hi Ada')
  })

  it('sees variables added between calls (no stale key map)', () => {
    const variables: Record<string, unknown> = {}
    expect(resolveExpression('{{NewVar}}', { variables })).toBe('')
    variables.newvar = 'now set'
    expect(resolveExpression('{{NewVar}}', { variables })).toBe('now set')
    delete variables.newvar
    variables.NEWVAR = 'renamed'
    expect(resolveExpression('{{NewVar}}', { variables })).toBe('renamed')
  })

  it('reuses parsed templates without leaking values between contexts', () => {
    const tpl = 'Order {{id}}: {{=UPPER(status)}}'
    expect(resolveExpression(tpl, { variables: { id: 1, status: 'open' } })).toBe('Order 1: OPEN')
    expect(resolveExpression(tpl, { variables: { id: 2, status: 'closed' } })).toBe('Order 2: CLOSED')
  })

  it('keeps working past the template cache size', () => {
    for (let i = 0; i < 1500; i++) {
      expect(resolveExpression(`v{{n}}-${i}`, { variables: { n: i } })).toBe(`v${i}-${i}`)
    }
    expect(resolveExpression('v{{n}}-0', { variables: { n: 'again' } })).toBe('vagain-0')
  })
})
