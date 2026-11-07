import { describe, expect, it } from 'vitest'
import {
  inferRunVariableType,
  isRunVariableColumnKey,
  readRunVariable,
  reportableRunVariables,
  RUN_VARIABLES_LIMITS,
  runVariableLeaves,
} from '@/lib/workflow-run-variables'

describe('reportableRunVariables', () => {
  it('keeps inputs, task form values, form values and step outputs with their types', () => {
    const stored = reportableRunVariables({
      amount: 1250.5,
      region: 'North',
      approved: true,
      tags: ['a', 'b'],
      score: 7,
      task_data: { amount: 900, comment: 'ok', receipts_count: 2, vendor_item: { name: 'Acme', id: 'v1' } },
      form: { email: 'a@example.com', start: '2026-10-01' },
    })
    expect(stored).toEqual({
      amount: 1250.5,
      region: 'North',
      approved: true,
      tags: ['a', 'b'],
      score: 7,
      task_data: { amount: 900, comment: 'ok', receipts_count: 2, vendor_item: { name: 'Acme', id: 'v1' } },
      form: { email: 'a@example.com', start: '2026-10-01' },
    })
  })

  it('drops system, internal and credential-like keys and secret-looking values', () => {
    const stored = reportableRunVariables({
      task_id: 't', tenant_id: 'x', workflow_id: 'w', workflow_name: 'n', workflow_started_at: 'now', trigger_type: 'manual',
      workflow_started_by: 'u', workflow_started_via: 'ui', workflow_owner_id: 'o', workflow_initiator_user_id: 'u',
      workflow_sla_status: 'on_track', event_id: 'e', last_error: 'boom',
      _workflow_inputs: ['amount'], __parallel: { rev: 1 },
      api_token: 'abc', password: 'p', client_secret: 's', api_key: 'k',
      encrypted: 'enc:v1:abcdef', bearer: 'Bearer abcdefghijkl',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl',
      nested: { password: 'p', fine: 1 },
      amount: 3,
    })
    expect(stored).toEqual({ nested: { fine: 1 }, amount: 3 })
  })

  it('drops file bytes, storage references and lists of objects (keeping their counts)', () => {
    const stored = reportableRunVariables({
      receipts: [{ name: 'a.pdf', storage_ref: 's3://x' }],
      receipts_count: 1,
      photo: 'data:image/png;base64,iVBORw0KGgo=',
      blob: 'A'.repeat(400),
      doc: { name: 'x.pdf', storage_ref: 'ref', content_base64: 'abc', size: 10 },
    })
    expect(stored).toEqual({ receipts_count: 1, doc: { name: 'x.pdf', size: 10 } })
  })

  it('caps strings, lists, depth and total size', () => {
    const stored = reportableRunVariables({
      long: 'some words '.repeat(200),
      list: Array.from({ length: 100 }, (_, i) => i),
      deep: { a: { b: { c: { d: 1 } }, keep: 2 } },
    })!
    expect((stored.long as string).length).toBe(RUN_VARIABLES_LIMITS.maxStringLength)
    expect((stored.long as string).endsWith('…')).toBe(true)
    expect((stored.list as number[]).length).toBe(RUN_VARIABLES_LIMITS.maxArrayItems)
    expect(stored.deep).toEqual({ a: { keep: 2 } })

    const many: Record<string, unknown> = {}
    for (let i = 0; i < 2000; i++) many[`v${i}`] = 'a value '.repeat(12)
    const capped = reportableRunVariables(many)!
    expect(new TextEncoder().encode(JSON.stringify(capped)).length).toBeLessThanOrEqual(RUN_VARIABLES_LIMITS.maxBytes)
    expect(Object.keys(capped).length).toBeLessThanOrEqual(RUN_VARIABLES_LIMITS.maxLeaves)
  })

  it('writes scalars and form values before other objects, and skips oversized objects', () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < 40; i++) big[`k${i}`] = 'z'.repeat(400)
    const stored = reportableRunVariables({ api_response: big, task_data: { amount: 5 }, amount: 1 })!
    expect(Object.keys(stored)).toEqual(['amount', 'task_data'])
  })

  it("drops steps' resume tokens (<step>_event_id), keeping the step's other outputs", () => {
    const stored = reportableRunVariables({ amount: 1, approve_event_id: 'evt_1', approve_task_id: 't1', nested: { review_event_id: 'evt_2', ok: true } })
    expect(stored).toEqual({ amount: 1, approve_task_id: 't1', nested: { ok: true } })
  })

  it('returns null when nothing is reportable', () => {
    expect(reportableRunVariables({ task_id: 'x', _internal: 1 })).toBeNull()
    expect(reportableRunVariables(null)).toBeNull()
  })
})

describe('run variable reading helpers', () => {
  it('recognises variable column keys', () => {
    expect(isRunVariableColumnKey('vars.amount')).toBe(true)
    expect(isRunVariableColumnKey('vars.task_data.vendor_item.name')).toBe(true)
    expect(isRunVariableColumnKey('vars.a.b.c.d')).toBe(false) // deeper than stored
    expect(isRunVariableColumnKey('vars.task_data.amount')).toBe(true)
    expect(isRunVariableColumnKey('vars.bad-key')).toBe(false)
    expect(isRunVariableColumnKey('vars.')).toBe(false)
    expect(isRunVariableColumnKey('status')).toBe(false)
  })

  it('reads paths and lists leaves', () => {
    const vars = { amount: 1, task_data: { comment: 'x', item: { name: 'A' } }, tags: ['a'] }
    expect(readRunVariable(vars, 'task_data.item.name')).toBe('A')
    expect(readRunVariable(vars, 'missing.x')).toBeUndefined()
    expect(runVariableLeaves(vars)).toEqual([
      ['amount', 1],
      ['task_data.comment', 'x'],
      ['task_data.item.name', 'A'],
      ['tags', ['a']],
    ])
  })

  it('infers types from stored values', () => {
    expect(inferRunVariableType([1, 2.5, null])).toBe('number')
    expect(inferRunVariableType([true, false])).toBe('boolean')
    expect(inferRunVariableType(['2026-10-01', '2026-10-30T10:00:00Z'])).toBe('date')
    expect(inferRunVariableType(['1', 2])).toBe('text')
    expect(inferRunVariableType([])).toBe('text')
  })
})
