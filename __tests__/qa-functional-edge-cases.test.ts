import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateTaskFieldValues, coerceTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import { __testing } from '@/lib/workflow-engine'
import { evaluateDecisionTable } from '@/lib/decision-table-engine'

// The shared executor resolves provider hosts through the egress guard.
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))

/**
 * Edge cases found by the 2026-11-24 functional QA pass (findings-functional.md).
 */

describe('date fields refuse calendar days that do not exist', () => {
  const fields: TaskFieldDef[] = [
    { key: 'd', label: 'Due', type: 'date' },
    { key: 'dt', label: 'At', type: 'datetime' },
  ]
  it.each(['2027-02-29', '2027-02-30', '2027-04-31', '2027-06-31T09:00:00Z'])('refuses %s (Date would roll it into the next month)', (value) => {
    const key = value.includes('T') ? 'dt' : 'd'
    expect(validateTaskFieldValues(fields, { [key]: value })[key]).toMatch(/must be a date/)
  })
  it.each(['2028-02-29', '2027-12-31', '2027-01-01T23:59:59Z', '2027-03-01 10:00:00+1300'])('accepts %s', (value) => {
    const key = value.includes('T') || value.includes(' ') ? 'dt' : 'd'
    expect(validateTaskFieldValues(fields, { [key]: value })).toEqual({})
  })
  it('still accepts years below 100 written with four digits', () => {
    expect(validateTaskFieldValues(fields, { d: '0050-02-28' })).toEqual({})
  })
})

describe('text, number and choice edge values', () => {
  const fields: TaskFieldDef[] = [
    { key: 't', label: 'T', type: 'text', max_length: 5 },
    { key: 'n', label: 'N', type: 'number', min: 0, max: 10 },
    { key: 'big', label: 'Big', type: 'text' },
  ]
  it('counts CJK text by characters within max_length', () => {
    expect(validateTaskFieldValues(fields, { t: '日本語テキ' })).toEqual({})
  })
  it('refuses Infinity / non-numeric numbers and enforces bounds on huge values', () => {
    expect(validateTaskFieldValues(fields, { n: 'Infinity' }).n).toMatch(/must be a number/)
    expect(validateTaskFieldValues(fields, { n: '1e308' }).n).toMatch(/at most 10/)
  })
  it('caps unbounded text at 50,000 characters', () => {
    expect(validateTaskFieldValues(fields, { big: 'x'.repeat(50_000) })).toEqual({})
    expect(validateTaskFieldValues(fields, { big: 'x'.repeat(50_001) }).big).toMatch(/too long/)
  })
})

describe('Server Event: the callback contract survives a custom payload', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  type Ctx = Parameters<typeof __testing.executeNode>[3]
  type Node = Parameters<typeof __testing.executeNode>[0]

  it('sends the new wait\'s event_id even when the template sets "event_id": "{{event_id}}"', async () => {
    const reference = {
      id: 'ref-1', tenant_id: 'tenant-1', name: 'Notify', inputs: [], outputs: [],
      request_config: { method: 'POST', path_template: '/events' },
      integration: { id: 'int-1', tenant_id: 'tenant-1', name: 'Ext', config: { base_url: 'https://ext.example.com', auth_type: 'none' } },
    }
    const chain: Record<string, unknown> = { select: () => chain, eq: () => chain, single: async () => ({ data: structuredClone(reference), error: null }), maybeSingle: async () => ({ data: structuredClone(reference), error: null }) }
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body ?? '{}'))); return new Response('{}', { status: 200 }) }))
    const ctx = {
      supabase: { from: () => chain }, tenantId: 'tenant-1',
      // A previous Server Event left its id in the variables.
      variables: { event_id: 'evt_previous', order: 'SO-1' } as Record<string, unknown>,
      liveBindings: {}, nodeResults: {}, executedNodes: new Set<string>(), executionTrace: [], logs: [],
    } as unknown as Ctx
    const node = { id: 'n-se', type: 'server_event', label: 'Wait for ERP', position: { x: 0, y: 0 }, config: {
      event_name: 'erp_done', outbound_action: 'api_reference', reference_id: 'ref-1',
      payload_mode: 'custom', custom_payload: '{"event_id": "{{event_id}}", "order": "{{order}}"}',
    } } as unknown as Node
    let paused: { eventId?: string } | null = null
    try { await __testing.executeNode(node, [node], [], ctx) } catch (e) { paused = e as { eventId?: string } }
    expect(paused?.eventId).toBeTruthy()
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ event_id: paused!.eventId, event_name: 'erp_done', order: 'SO-1' })
    expect((bodies[0] as Record<string, unknown>).event_id).not.toBe('evt_previous')
  })
})

describe('decision tables: text inputs are not read as dates', () => {
  const inputs = [{ id: 'a', key: 'k', label: 'K', type: 'text' as const }]
  const table = (operator: string, value: string) => [{ id: 'r', label: 'R', conditions: [{ id: 'c', inputKey: 'k', operator, value }], outputs: { hit: true } }]
  it.each([['Tier 1', 'Plan 1'], ['EU 1', 'US 1'], ['Contractor 5', 'Employee 5'], ['Zone 3', 'Zone 03']])('%s does not equal %s', (left, right) => {
    expect(evaluateDecisionTable(inputs, table('equals', right), { k: left }).matched).toBe(false)
    expect(evaluateDecisionTable(inputs, table('not_equals', right), { k: left }).matched).toBe(true)
  })
  it('still compares ISO dates in a text column as dates, and numbers as numbers', () => {
    expect(evaluateDecisionTable(inputs, table('greater_than', '2027-01-01'), { k: '2027-03-01T09:00:00Z' }).matched).toBe(true)
    expect(evaluateDecisionTable(inputs, table('equals', '2027-01-01'), { k: '2027-01-01T00:00:00Z' }).matched).toBe(true)
    expect(evaluateDecisionTable(inputs, table('greater_than', '9'), { k: '10' }).matched).toBe(true)
  })
  it('a date column still parses the values it is given', () => {
    const dates = [{ id: 'a', key: 'k', label: 'K', type: 'date' as const }]
    expect(evaluateDecisionTable(dates, table('less_than', '2027-06-01'), { k: '2027-05-31' }).matched).toBe(true)
  })
})

describe('gallery verify steps never send reserved field keys', () => {
  it('no gallery.json verify_mocks task uses a reserved key (it would be dropped and a required field left empty)', async () => {
    const { readdirSync, readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { RESERVED_FIELD_KEYS } = await import('@/lib/task-field-schema')
    const root = join(process.cwd(), 'gallery', 'packages')
    const bad: string[] = []
    for (const slug of readdirSync(root)) {
      const file = join(root, slug, 'gallery.json')
      if (!existsSync(file)) continue
      const meta = JSON.parse(readFileSync(file, 'utf8'))
      for (const [i, step] of (meta.verify_mocks?.tasks ?? []).entries()) {
        for (const key of Object.keys(step.values ?? {})) if (RESERVED_FIELD_KEYS.has(key.toLowerCase())) bad.push(`${slug} task ${i + 1}: ${key}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('numbers: ambiguous or non-decimal text is refused, thousands separators accepted', () => {
  const fields: TaskFieldDef[] = [{ key: 'n', label: 'N', type: 'number' }]
  it.each(['1,5', '0x10', '1_000', '12,34,567', 'Infinity', '1,00'])('refuses %s', (n) => {
    expect(validateTaskFieldValues(fields, { n }).n).toMatch(/must be a number/)
    expect(coerceTaskFieldValues(fields, { n }).n).toBeNull()
  })
  it.each([['1,000', 1000], ['1,234,567.5', 1234567.5], ['-2.5', -2.5], ['1e3', 1000], ['.5', 0.5], [' 7 ', 7]])('accepts %s as %d', (n, expected) => {
    expect(validateTaskFieldValues(fields, { n })).toEqual({})
    expect(coerceTaskFieldValues(fields, { n }).n).toBe(expected)
  })
})

describe('choices compare after NFC normalisation', () => {
  const fields: TaskFieldDef[] = [
    { key: 'c', label: 'C', type: 'choice', options: ['Zürich', 'Ä'] },
    { key: 'm', label: 'M', type: 'multi_choice', options: ['Zürich', 'Ä'] },
  ]
  it('accepts a decomposed value and stores the option as written', () => {
    const decomposed = 'Zu\u0308rich'
    expect(validateTaskFieldValues(fields, { c: decomposed, m: [decomposed, 'A\u0308'] })).toEqual({})
    expect(coerceTaskFieldValues(fields, { c: decomposed, m: [decomposed, 'A\u0308'] })).toEqual({ c: 'Zürich', m: ['Zürich', 'Ä'] })
  })
  it('still refuses a value that is not an option', () => {
    expect(validateTaskFieldValues(fields, { c: 'Zurich' }).c).toMatch(/must be one of/)
  })
})

describe('date-times without a timezone are UTC', () => {
  const fields: TaskFieldDef[] = [{ key: 'dt', label: 'DT', type: 'datetime' }]
  it.each([['2027-01-01T10:00', '2027-01-01T10:00:00.000Z'], ['2027-01-01 10:00:00', '2027-01-01T10:00:00.000Z'], ['2027-01-01T10:00:00+13:00', '2026-12-31T21:00:00.000Z']])('%s → %s', (input, expected) => {
    expect(coerceTaskFieldValues(fields, { dt: input }).dt).toBe(expected)
  })
})

describe('Branch by Condition orders values like form rules (dates as dates, empty is not 0)', () => {
  type Ctx = Parameters<typeof __testing.evaluateRule>[3]
  const ctx = (variables: Record<string, unknown>) => ({ variables, liveBindings: {}, nodeResults: {}, executedNodes: new Set(), executionTrace: [], logs: [] }) as unknown as Ctx
  const rule = (op: string, value: string, variables: Record<string, unknown>) => __testing.evaluateRule('{{x}}', op, value, ctx(variables))
  it('compares ISO dates and date-times as dates', () => {
    expect(rule('gt', '2027-01-01', { x: '2027-05-01' })).toBe(true)
    expect(rule('lt', '2027-01-01', { x: '2027-05-01' })).toBe(false)
    expect(rule('gte', '2027-05-01', { x: '2027-05-01T00:00:00Z' })).toBe(true)
    expect(rule('less_than', '2027-05-01T12:00:00Z', { x: '2027-05-01T09:30:00Z' })).toBe(true)
  })
  it('an empty or missing value never satisfies greater / less than', () => {
    for (const x of ['', null, undefined, '   ']) {
      expect(rule('lt', '1000', { x })).toBe(false)
      expect(rule('gte', '0', { x })).toBe(false)
    }
  })
  it('numbers still compare as numbers (not as text)', () => {
    expect(rule('gt', '9', { x: 10 })).toBe(true)
    expect(rule('gt', '9', { x: '10' })).toBe(true)
    expect(rule('lte', '-1.5', { x: -2 })).toBe(true)
  })
  it('other text compares case-insensitively', () => {
    expect(rule('gt', 'apple', { x: 'Banana' })).toBe(true)
  })
  it('event-wait / shared evaluateOperator uses the same ordering, including field-to-field', async () => {
    const { evaluateOperator } = await import('@/lib/conditions')
    expect(evaluateOperator('gt', '2027-05-01', '2027-01-01')).toBe(true)
    expect(evaluateOperator('lt', '', '5')).toBe(false)
    expect(evaluateOperator('gt_field', '2027-05-01', undefined, { compareValue: '2027-01-01' })).toBe(true)
  })
})

describe('Server Event legacy outbound path', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  type Ctx = Parameters<typeof __testing.executeNode>[3]
  type Node = Parameters<typeof __testing.executeNode>[0]
  const run = async (node: Node, from: (table: string) => unknown, variables: Record<string, unknown> = {}) => {
    const ctx = { supabase: { from }, tenantId: 'tenant-1', variables, liveBindings: {}, nodeResults: {}, executedNodes: new Set<string>(), executionTrace: [], logs: [] } as unknown as Ctx
    try { await __testing.executeNode(node, [node], [], ctx); return null } catch (e) { return e as Error & { eventId?: string } }
  }
  const refChain = (reference: unknown) => { const chain: Record<string, unknown> = { select: () => chain, eq: () => chain, single: async () => ({ data: structuredClone(reference), error: null }), maybeSingle: async () => ({ data: structuredClone(reference), error: null }) }; return chain }

  it('encodes every {{var}} in the path and sends the integration\'s basic auth', async () => {
    const reference = {
      id: 'ref-1', tenant_id: 'tenant-1', name: 'Notify', inputs: [], outputs: [],
      request_config: { method: 'POST', path_template: '/orders/{{order}}/events/{{order}}' },
      integration: { id: 'int-1', tenant_id: 'tenant-1', name: 'Ext', config: { base_url: 'https://ext.example.com', auth_type: 'basic', auth_config: { username: 'svc', password: 'p@ss' } } },
    }
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => { calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()) }); return new Response('{}', { status: 200 }) }))
    const node = { id: 'n', type: 'server_event', label: 'Wait', position: { x: 0, y: 0 }, config: { event_name: 'done', outbound_action: 'api_reference', reference_id: 'ref-1', send_variables: ['order'] } } as unknown as Node
    const paused = await run(node, () => refChain(reference), { order: 'SO 1/2?x' })
    expect(paused?.eventId).toBeTruthy()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://ext.example.com/orders/SO%201%2F2%3Fx/events/SO%201%2F2%3Fx')
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from('svc:p@ss').toString('base64')}`)
  })

  it('data-table outbound refuses a table outside the workspace and surfaces an insert error', async () => {
    const node = { id: 'n', type: 'server_event', label: 'Wait', position: { x: 0, y: 0 }, config: { event_name: 'done', outbound_action: 'data_table', data_table_id: 'tbl-1' } } as unknown as Node
    const chain = (data: unknown, insertError: unknown = null) => { const c: Record<string, unknown> = { select: () => c, eq: () => c, maybeSingle: async () => ({ data, error: null }), insert: () => c, single: async () => ({ data: insertError ? null : { id: 'row-1' }, error: insertError }) }; return c }
    expect((await run(node, () => chain(null)))?.message).toMatch(/data table not found/)
    expect((await run(node, () => chain({ id: 'tbl-1' }, { message: 'violates check' })))?.message).toMatch(/could not write the event row: violates check/)
  })
})
