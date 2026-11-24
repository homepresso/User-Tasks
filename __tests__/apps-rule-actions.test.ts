import { beforeEach, describe, expect, it, vi } from 'vitest'

const audit = vi.fn(async () => undefined)
const refRow: { value: Record<string, unknown> | null } = { value: { id: 'ref', inputs: [{ name: 'name' }], request_config: {} } }
vi.mock('@/lib/services/_shared', () => ({
  audit: (...a: unknown[]) => audit(...(a as [])),
  serviceRoleClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: refRow.value, error: null }) }) }) }) }) }),
  dbError: (e: unknown) => e,
}))
const upsertRows = vi.fn(async () => [{ row_id: '99999999-9999-4999-8999-999999999999', row: { data: { name: 'New' } } }])
const updateRow = vi.fn(async () => ({ data: { name: 'Upd' } }))
vi.mock('@/lib/services/data-tables', () => ({ getDataTable: async () => ({}), upsertRows: (...a: unknown[]) => upsertRows(...(a as [])), updateRow: (...a: unknown[]) => updateRow(...(a as [])) }))
vi.mock('@/lib/trace', () => ({ newTraceId: () => 'trace' }))

import { appActionDeps, lookupFilter, runAppRuleAction, slotValues } from '@/lib/services/app-rule-actions'
import { appRuleSchema, type AppRule } from '@/lib/apps/rules'
import type { ObjectFacts } from '@/lib/apps/governance'
import type { ServiceContext } from '@/lib/services/context'

const T = '33333333-3333-4333-8333-333333333333'
const REF = '55555555-5555-4555-8555-555555555555'
const WF = '22222222-2222-4222-8222-222222222222'

const ctx = (perms: string[]): ServiceContext => ({ supabase: {} as never, tenantId: 'tenant-a', actorId: '77777777-7777-4777-8777-777777777777', permissions: new Set(perms), authKind: 'session', source: 'ui' } as ServiceContext)

const theRule: AppRule = appRuleSchema.parse({
  id: 'r1', when: { type: 'row_click' }, then: [
    { type: 'call_reference', reference_id: REF, inputs: { name: '{{var.n}}', secret: '{{var.s}}' } },
    { type: 'table_create', table_id: T, values: { name: '{{var.n}}' } },
    { type: 'message', text: 'hi' },
    { type: 'start_workflow', workflow_id: WF, inputs: { who: '{{sys.user.id}}' } },
    { type: 'call_reference', reference_id: REF, inputs: {}, allow_viewers: true },
    { type: 'table_update', table_id: T, row_id: '{{event.row.id}}', values: { name: 'x' } },
  ],
})

let role: 'editor' | 'contributor' | 'viewer' = 'contributor'
const facts = (perms: Set<string>): ObjectFacts => ({
  can: (p) => perms.has(p), formGrants: new Set(), visibleReports: new Set(),
  exists: { form: new Set(), workflow: new Set([WF]), data_table: new Set([T]), report: new Set(), reference: new Set([REF]) },
})
const executeReference = vi.fn(async () => ({ status: 200, data: { customer: { name: 'Acme', score: 720 } } }))
const startWorkflow = vi.fn(async () => ({ mode: 'async', job_id: 'job-1' }))
let rateOk = true
const cache = new Map<string, string>()

beforeEach(() => {
  role = 'contributor'; rateOk = true; cache.clear(); audit.mockClear(); executeReference.mockClear(); upsertRows.mockClear(); startWorkflow.mockClear()
  refRow.value = { id: REF, inputs: [{ name: 'name' }], request_config: {} }
  Object.assign(appActionDeps, {
    loadRule: async (_c: ServiceContext, _a: string, page: string | null, id: string) => {
      if (id !== 'r1') throw Object.assign(new Error('That rule does not exist'), { status: 404 })
      return { db: {}, app: { id: 'app-1', name: 'CRM' }, page: page ? { id: 'page-1', title: 'Home' } : null, role, viewer: { userId: 'u', teamIds: [], roleIds: [] }, rule: theRule }
    },
    facts: async (c: ServiceContext) => facts(new Set(c.permissions ?? [])),
    executeReference, startWorkflow,
    rateLimit: async () => ({ ok: rateOk, retryAfterMs: 1000 }),
    cache: async () => ({ get: async (k: string) => cache.get(k) ?? null, set: async (k: string, v: string) => { cache.set(k, v) } }),
  })
})

const run = (c: ServiceContext, path: string, values: Record<string, string> = {}, key = 'key-12345') => runAppRuleAction(c, 'app-1', { page: 'home', rule_id: 'r1', path, values, idempotency_key: key })

describe('app rule server actions', () => {
  it('only takes declared slots; only declared reference inputs reach the call', async () => {
    expect(slotValues(theRule.then[0], { 'inputs.name': 'Acme', 'inputs.secret': 's', evil: 'x', reference_id: 'other' })).toEqual({ 'inputs.name': 'Acme', 'inputs.secret': 's' })
    const r = await run(ctx(['integrations.view', 'apps.view']), 'then.0', { 'inputs.name': 'Acme', 'inputs.secret': 'nope', reference_id: 'evil' } as never)
    expect(r).toMatchObject({ type: 'call_reference', result: { customer: { name: 'Acme' } } })
    expect(executeReference).toHaveBeenCalledWith(expect.objectContaining({ referenceId: REF, inputValues: { name: 'Acme' }, readOnly: true }))
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ objectType: 'app', action: 'execute', metadata: expect.objectContaining({ rule_id: 'r1', path: 'then.0', object_id: REF }) }))
  })

  it('refuses client actions, unknown paths and unknown rules', async () => {
    await expect(run(ctx(['data.view']), 'then.2')).rejects.toMatchObject({ code: 'not_found' })
    await expect(run(ctx(['data.view']), 'then.17')).rejects.toMatchObject({ code: 'not_found' })
    await expect(runAppRuleAction(ctx([]), 'app-1', { rule_id: 'nope', path: 'then.0', idempotency_key: 'key-12345' })).rejects.toThrow(/rule/)
    await expect(runAppRuleAction(ctx([]), 'app-1', { rule_id: 'r1', path: 'then.0', idempotency_key: 'short' })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('API reference gate: integration access, or a designer-allowed reference; write references refused', async () => {
    await expect(run(ctx(['apps.view']), 'then.0')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(run(ctx(['apps.view']), 'then.4')).resolves.toMatchObject({ type: 'call_reference' })
    refRow.value = { id: REF, inputs: [], request_config: { custom: { kind: 'http_post' } } }
    const { isWriteReference } = await import('@/lib/custom-references/types')
    if (isWriteReference(refRow.value)) await expect(run(ctx(['integrations.view']), 'then.0', {}, 'key-write1')).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('data table writes run as the viewer: viewers refused, manage_rows required, audited', async () => {
    role = 'viewer'
    await expect(run(ctx(['data.view', 'data.manage_rows']), 'then.1')).rejects.toMatchObject({ code: 'forbidden' })
    role = 'contributor'
    await expect(run(ctx(['data.view']), 'then.1')).rejects.toMatchObject({ code: 'forbidden' })
    const r = await run(ctx(['data.view', 'data.manage_rows']), 'then.1', { 'values.name': 'Acme' })
    expect(upsertRows).toHaveBeenCalledWith(expect.anything(), T, [{ data: { name: 'Acme' } }])
    expect(r.result).toMatchObject({ row_id: '99999999-9999-4999-8999-999999999999', name: 'New' })
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ objectType: 'data_table', action: 'create' }))
    await expect(run(ctx(['data.view', 'data.manage_rows']), 'then.5', { row_id: 'not-a-uuid' }, 'key-upd-1')).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('a credential table allowlist applies', async () => {
    const c = { ...ctx(['data.view', 'data.manage_rows']), resourceScopes: { table_ids: ['44444444-4444-4444-8444-444444444444'] } } as ServiceContext
    await expect(run(c, 'then.1')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('workflow starts need Start workflows and run as the viewer', async () => {
    await expect(run(ctx(['workflows.view']), 'then.3')).rejects.toMatchObject({ code: 'forbidden' })
    await run(ctx(['workflows.view', 'workflows.activate']), 'then.3', { 'inputs.who': 'u1' })
    expect(startWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workflow_id: WF, variables: expect.objectContaining({ who: 'u1', app_id: 'app-1' }) }))
  })

  it('rate limited, and a repeated idempotency key replays', async () => {
    const c = ctx(['integrations.view'])
    await run(c, 'then.0', { 'inputs.name': 'A' }, 'same-key-1')
    const again = await run(c, 'then.0', { 'inputs.name': 'A' }, 'same-key-1')
    expect(again.replayed).toBe(true)
    expect(executeReference).toHaveBeenCalledTimes(1)
    rateOk = false
    await expect(run(c, 'then.0', {}, 'other-key-1')).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('lookup filters use slot values, never templates', () => {
    const g = { match: 'all' as const, conditions: [{ column: 'status', operator: 'eq' as const, value: '{{var.x}}' }, { match: 'any' as const, conditions: [{ column: 'name', operator: 'contains' as const, value: '{{y}}' }] }] }
    const tree = lookupFilter(g, { 'filter.0': 'open', 'filter.1.0': 'Ac' }, { status: 'text', name: 'text' })
    expect(tree).toContain('open')
    expect(tree).toContain('Ac')
    expect(tree).not.toContain('{{')
  })
})
