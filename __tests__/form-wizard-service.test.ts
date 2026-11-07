/**
 * The form wizard's orchestration (lib/services/form-wizard.ts) with the
 * step services mocked: permissions (Viewer refused, Member allowed only
 * with forms.wizard), the steps run with the wizard's own context (no build
 * permissions for the person), the order of creation, rollback of
 * everything created when a later step fails, and update keeping keys.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWizardForm, updateWizardForm, wizardDeps, WIZARD_STEP_PERMISSIONS, getWizardResults } from '@/lib/services/form-wizard'
import { SYSTEM_ROLES } from '@/lib/tenant-provisioning'
import { expandPermissions } from '@/lib/permissions'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- a loose fake client */

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const APPROVER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PROJECT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

/** A chainable fake of the Supabase query builder: every query resolves to what `answer` returns for it. */
function fakeDb(answer: (q: { table: string; op: string; filters: Array<[string, unknown]>; payload?: any }) => { data: any; error?: any; count?: number }) {
  const calls: Array<{ table: string; op: string; filters: Array<[string, unknown]>; payload?: any }> = []
  const from = (table: string) => {
    const q = { table, op: 'select', filters: [] as Array<[string, unknown]>, payload: undefined as any }
    const builder: any = {}
    const chain = (name: string) => (...args: any[]) => { if (['eq', 'in', 'is'].includes(name)) q.filters.push([String(args[0]), args[1]]); return builder }
    for (const name of ['select', 'eq', 'in', 'is', 'order', 'limit', 'range', 'ilike']) builder[name] = chain(name)
    for (const op of ['insert', 'update', 'delete', 'upsert']) builder[op] = (payload?: any) => { q.op = op; q.payload = payload; return builder }
    const run = () => { calls.push({ ...q }); return Promise.resolve({ error: null, ...answer(q) }) }
    builder.single = run
    builder.maybeSingle = run
    builder.then = (ok: any, bad: any) => run().then(ok, bad)
    return builder
  }
  return { client: { from } as any, calls }
}

function ctxFor(role: string, db: any): ServiceContext {
  const perms = expandPermissions(SYSTEM_ROLES.find((r) => r.slug === role)!.permissions)
  return { db, supabase: db, tenantId: TENANT, actorId: ME, permissions: new Set(perms), authKind: 'api_key', source: 'api', keyType: 'user' }
}

const SPEC = {
  name: 'Purchase request',
  questions: [{ id: 'q1', kind: 'short_text', label: 'What do you need?', required: true }, { id: 'q2', kind: 'money', label: 'Cost' }],
  approval: { mode: 'single', stages: [{ id: 's1', name: 'Approval', assignee: { kind: 'person', user_id: APPROVER } }] },
}

let seen: Record<string, ServiceContext[]>
let args: Record<string, unknown[][]>
let order: string[]

function mockSteps(failAt?: string) {
  seen = {}
  args = {}
  order = []
  const step = <T>(name: string, value: T) => async (ctx: ServiceContext, ...rest: unknown[]) => {
    ;(seen[name] ??= []).push(ctx)
    ;(args[name] ??= []).push(rest)
    order.push(name)
    if (failAt === name) throw new Error(`${name} exploded`)
    return value
  }
  const deleteForm = vi.fn(async () => ({ deleted: true }))
  vi.spyOn(wizardDeps, 'dataTables').mockResolvedValue({
    createDataTable: step('table', { id: 'table-1', name: 'Purchase request responses', columns: [] }),
    getDataTable: step('getTable', { id: 'table-1', name: 'Purchase request responses', columns: [{ key: 'what_do_you_need', name: 'What do you need?', type: 'text' }, { key: 'old_question', name: 'Old', type: 'number' }] }),
    updateDataTable: step('updateTable', {}),
  } as any)
  vi.spyOn(wizardDeps, 'forms').mockResolvedValue({ createForm: step('form', { id: 'form-1', name: 'Purchase request' }), updateForm: step('updateForm', { id: 'form-1', name: 'Purchase request' }), deleteForm } as any)
  vi.spyOn(wizardDeps, 'workflows').mockResolvedValue({ createWorkflow: step('workflow', { workflow_id: 'wf-1' }), updateWorkflow: step('updateWorkflow', {}) } as any)
  vi.spyOn(wizardDeps, 'reports').mockResolvedValue({ importReport: async (ctx: ServiceContext) => { (seen.report ??= []).push(ctx); order.push('report'); if (failAt === 'report') throw new Error('report exploded'); return { id: `rep-${order.length}` } } } as any)
  vi.spyOn(wizardDeps, 'anonymous').mockResolvedValue({ setFormAnonymousAccess: step('anonymous', {}) } as any)
  vi.spyOn(wizardDeps, 'grants').mockResolvedValue({ setObjectPermission: async (ctx: ServiceContext) => { (seen.grant ??= []).push(ctx); order.push('grant'); return { id: `grant-${order.length}` } } } as any)
  return { deleteForm }
}

function standardDb(extra: (q: any) => any = () => undefined) {
  return fakeDb((q) => {
    const custom = extra(q)
    if (custom) return custom
    if (q.table === 'user_memberships' || q.table === 'users') return { data: [{ user_id: APPROVER, id: APPROVER }] }
    if (q.table === 'roles') return { data: [{ id: 'role-member', permissions: ['forms.submit'] }, { id: 'role-x', permissions: [] }] }
    if (q.table === 'form_wizard_projects' && q.op !== 'select') return { data: { id: PROJECT, owner_id: ME, name: 'Purchase request', status: 'created', spec: q.payload?.spec ?? {}, manifest: q.payload?.manifest ?? {}, form_id: 'form-1', created_at: 'now', updated_at: 'now' } }
    if (q.table === 'form_anonymous_access') return { data: null }
    return { data: null }
  })
}

beforeEach(() => vi.restoreAllMocks())

describe('form wizard: permissions', () => {
  it('a Viewer is refused; nothing is created', async () => {
    mockSteps()
    const { client } = standardDb()
    await expect(createWizardForm(ctxFor('viewer', client), SPEC)).rejects.toThrow(/forms\.wizard/)
    expect(order).toEqual([])
  })

  it('a Member creates it, though they hold none of the build permissions; the steps get exactly the wizard context', async () => {
    mockSteps()
    const { client } = standardDb()
    const ctx = ctxFor('member', client)
    for (const p of ['forms.edit', 'data.create', 'workflows.create', 'workflows.activate']) expect(ctx.permissions!.has(p)).toBe(false)
    const result = await createWizardForm(ctx, SPEC)
    expect(order).toEqual(['table', 'form', 'workflow', 'grant', 'report'])
    for (const p of WIZARD_STEP_PERMISSIONS) expect(seen.table[0].permissions!.has(p)).toBe(true)
    expect(seen.workflow[0].actorId).toBe(ME) // owned by the person
    expect(ctx.permissions!.has('forms.edit')).toBe(false) // the caller's own context is untouched
    expect(result.manifest).toMatchObject({ form_id: 'form-1', table_id: 'table-1', workflow_id: 'wf-1' })
    expect(result.links).toMatchObject({ form: '/fill/form-1', results: `/forms/results/${PROJECT}`, workflow_designer: '/automations/wf-1' })
  })

  it('refuses an approver who is not in the workspace before creating anything', async () => {
    mockSteps()
    const { client } = standardDb((q) => (q.table === 'user_memberships' || q.table === 'users' ? { data: [] } : undefined))
    await expect(createWizardForm(ctxFor('member', client), SPEC)).rejects.toThrow(/a person that is not in this workspace/)
    expect(order).toEqual([])
  })
})

describe('form wizard: rollback', () => {
  it('a failing step removes what was created, newest first, and says so', async () => {
    const { deleteForm } = mockSteps('report')
    const { client, calls } = standardDb()
    await expect(createWizardForm(ctxFor('member', client), SPEC)).rejects.toThrow(/Could not create the form: report exploded\. Nothing was kept\./)
    const deletes = calls.filter((c) => c.op === 'delete').map((c) => c.table)
    // grants → workflow (hard delete) → form (service) → table rows + table
    expect(deletes).toEqual(['object_permissions', 'workflows', 'custom_table_rows', 'custom_tables'])
    expect(deleteForm).toHaveBeenCalledWith(expect.anything(), 'form-1')
    expect(calls.some((c) => c.table === 'form_wizard_projects' && c.op !== 'select')).toBe(false)
  })

  it('a failing workflow step removes the form and the table', async () => {
    const { deleteForm } = mockSteps('workflow')
    const { client, calls } = standardDb()
    await expect(createWizardForm(ctxFor('member', client), SPEC)).rejects.toThrow(/workflow exploded/)
    expect(deleteForm).toHaveBeenCalledTimes(1)
    expect(calls.filter((c) => c.op === 'delete').map((c) => c.table)).toEqual(['custom_table_rows', 'custom_tables'])
  })
})

describe('form wizard: update and results access', () => {
  const stored = { ...SPEC, version: 1, template: 'blank', questions: [{ ...SPEC.questions[0], key: 'what_do_you_need' }, { ...SPEC.questions[1], key: 'cost' }] }
  const project = (owner: string) => ({ id: PROJECT, owner_id: owner, name: 'Purchase request', status: 'created', spec: stored, manifest: { form_id: 'form-1', table_id: 'table-1', workflow_id: 'wf-1', report_ids: [], reports: { responses: 'r1', status: 'r2' }, keys: ['what_do_you_need', 'cost', 'old_question'] }, form_id: 'form-1', created_at: 'x', updated_at: 'x' })

  it('keeps existing keys, appends columns, never drops the old ones; only the owner (or forms.edit) may update', async () => {
    mockSteps()
    const { client } = standardDb((q) => {
      if (q.table === 'form_wizard_projects' && q.op === 'select') return { data: project(ME) }
      if (q.table === 'workflows' && q.op === 'select') return { data: { id: 'wf-1' } }
      return undefined
    })
    const edited = { ...SPEC, questions: [{ ...SPEC.questions[0], label: 'What exactly do you need?' }, SPEC.questions[1], { id: 'q3', kind: 'short_text', label: 'Old question' }] }
    const result = await updateWizardForm(ctxFor('member', client), PROJECT, edited)
    const spec = result.project.spec as any
    expect(spec.questions.map((q: any) => q.key)).toEqual(['what_do_you_need', 'cost', 'old_question_2'])
    const columns = (args.updateTable[0][1] as any).columns.map((c: any) => c.key)
    expect(columns.slice(0, 3)).toEqual(['what_do_you_need', 'old_question', 'cost']) // kept in place, the old column stays
    expect(columns).toContain('old_question_2')
    expect(order).toEqual(['getTable', 'updateTable', 'updateForm', 'updateWorkflow', 'grant'])

    const { client: other } = standardDb((q) => (q.table === 'form_wizard_projects' && q.op === 'select' ? { data: project(APPROVER) } : undefined))
    await expect(updateWizardForm(ctxFor('member', other), PROJECT, edited)).rejects.toThrow(/not found/)
  })

  it('results: the owner and the chosen roles see them; others get not found', async () => {
    const withRole = { ...project(APPROVER), spec: { ...stored, results: { charts: true, role_ids: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'], team_ids: [] } } }
    const { client } = standardDb((q) => {
      if (q.table === 'form_wizard_projects') return { data: withRole }
      if (q.table === 'user_roles') return { data: [] }
      return undefined
    })
    await expect(getWizardResults(ctxFor('member', client), PROJECT)).rejects.toThrow(/not found/)
    const { client: allowed } = standardDb((q) => {
      if (q.table === 'form_wizard_projects') return { data: withRole }
      if (q.table === 'user_roles') return { data: [{ role_id: 'x' }] }
      if (q.table === 'custom_table_rows') return { data: [{ id: 'row-1', created_at: new Date().toISOString(), data: { what_do_you_need: 'Laptop', status: 'Approved' } }] }
      return undefined
    })
    const results = await getWizardResults(ctxFor('viewer', allowed), PROJECT)
    expect(results.summary).toMatchObject({ total: 1, approved: 1, approval_rate: 100 })
    expect(results.links).toBeNull() // not the owner: no designer links
    expect(results.can_edit).toBe(false)
  })
})
