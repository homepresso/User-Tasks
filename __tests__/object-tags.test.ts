/**
 * Tags on objects (lib/services/object-tags.ts — the row "Tags…" quick
 * action, bulk add / remove and POST /api/v1/tags/apply): merging keeps the
 * existing spelling and never duplicates; every write goes through the
 * object type's own service (its edit permission); a caller without the
 * type's edit permission is refused before anything is read; brand-new tags
 * need tags.manage when the workspace turned allow_new off; bulk changes
 * report per-object failures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
const services = vi.hoisted(() => ({
  updateForm: vi.fn(async (_ctx: any, _id: string, input: any) => ({ id: _id, ...input })),
  updateAgent: vi.fn(async () => ({})),
  updateTask: vi.fn(async () => ({})),
  requireDesignAccess: vi.fn(async () => {}),
}))
vi.mock('@/lib/services/forms', () => ({ updateForm: services.updateForm }))
vi.mock('@/lib/services/agents', () => ({ updateAgent: services.updateAgent }))
vi.mock('@/lib/services/tasks', () => ({ updateTask: services.updateTask }))
vi.mock('@/lib/services/design-access', () => ({ requireDesignAccess: services.requireDesignAccess }))

import type { ServiceContext } from '@/lib/services/context'
import { applyObjectTags, mergeTags } from '@/lib/services/object-tags'
import { createMemorySupabase } from './fixtures/supabase-memory'

function seed(settings: Record<string, unknown> = {}) {
  const db = createMemorySupabase({
    tag_styles: [{ id: 's1', tenant_id: 'tenant-a', name: 'Finance', name_key: 'finance', color: 'green', description: null, updated_at: null }],
    tenants: [{ id: 'tenant-a', settings }],
    forms: [
      { id: 'f1', tenant_id: 'tenant-a', name: 'Expense claim', tags: ['travel'] },
      { id: 'f2', tenant_id: 'tenant-a', name: 'Leave', tags: ['finance', 'hr'] },
      { id: 'fb', tenant_id: 'tenant-b', name: 'Other workspace', tags: [] },
    ],
    workflows: [{ id: 'w1', tenant_id: 'tenant-a', name: 'Approval', tags: null }],
    agents: [{ id: 'a1', tenant_id: 'tenant-a', name: 'Helper', tags: [] }],
  }) as any
  db.rpc = vi.fn(async () => ({ data: [{ name_key: 'hr', name: 'HR', object_type: 'forms', uses: 1 }, { name_key: 'travel', name: 'travel', object_type: 'forms', uses: 1 }], error: null }))
  return db
}

function ctx(db: any, permissions: string[]): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api' }
}

let db: any
beforeEach(() => {
  db = seed()
  for (const fn of Object.values(services)) fn.mockClear()
})

describe('mergeTags', () => {
  it('adds without duplicates (any case), keeps the existing spelling, removes in any case', () => {
    const known = new Map([['finance', 'Finance'], ['hr', 'HR']])
    expect(mergeTags(['travel', 'hr'], ['FINANCE', ' Hr ', 'new one'], [], known)).toEqual(['travel', 'hr', 'Finance', 'new one'])
    expect(mergeTags(['Travel', 'HR'], [], ['travel'], known)).toEqual(['HR'])
    expect(mergeTags(['a'], ['b'], ['B'])).toEqual(['a'])
  })
})

describe('applyObjectTags', () => {
  it('saves through the type\'s own service with the existing spelling', async () => {
    const result = await applyObjectTags(ctx(db, ['forms.edit', 'forms.view']), { type: 'forms', ids: ['f1'], add: ['finance'] })
    expect(services.updateForm).toHaveBeenCalledWith(expect.anything(), 'f1', { tags: ['travel', 'Finance'] })
    expect(result.updated).toEqual([{ id: 'f1', tags: ['travel', 'Finance'] }])
  })

  it('refuses a caller without the type\'s edit permission before reading anything', async () => {
    await expect(applyObjectTags(ctx(db, ['forms.view']), { type: 'forms', ids: ['f1'], add: ['x'] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(applyObjectTags(ctx(db, ['forms.edit']), { type: 'agents', ids: ['a1'], add: ['x'] })).rejects.toMatchObject({ code: 'forbidden' })
    expect(services.updateForm).not.toHaveBeenCalled()
    expect(services.updateAgent).not.toHaveBeenCalled()
  })

  it('never touches another workspace\'s object', async () => {
    await expect(applyObjectTags(ctx(db, ['forms.edit']), { type: 'forms', ids: ['fb'], add: ['x'] })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('validates type, ids and changes', async () => {
    await expect(applyObjectTags(ctx(db, ['forms.edit']), { type: 'retention_policies', ids: ['f1'], add: ['x'] })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(applyObjectTags(ctx(db, ['forms.edit']), { type: 'forms', ids: [], add: ['x'] })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(applyObjectTags(ctx(db, ['forms.edit']), { type: 'forms', ids: ['f1'] })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(applyObjectTags(ctx(db, ['forms.edit']), { type: 'forms', ids: ['f1', 'f2'], set: ['a'] })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(applyObjectTags(ctx(db, ['forms.edit']), { type: 'forms', ids: ['f1'], add: ['x'.repeat(61)] })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('bulk add / remove reports unchanged and failed objects and saves the rest', async () => {
    const add = await applyObjectTags(ctx(db, ['forms.edit']), { type: 'forms', ids: ['f1', 'f2', 'missing'], add: ['HR'] })
    expect(add.updated).toEqual([{ id: 'f1', tags: ['travel', 'HR'] }])
    expect(add.unchanged).toEqual(['f2'])
    expect(add.failed.map((f) => f.id)).toEqual(['missing'])
    const remove = await applyObjectTags(ctx(db, ['forms.edit']), { type: 'forms', ids: ['f1', 'f2'], remove: ['FINANCE'] })
    expect(remove.updated).toEqual([{ id: 'f2', tags: ['hr'] }])
    expect(remove.unchanged).toEqual(['f1'])
  })

  it('workflows: design access, tags only (no unpublished-changes flag)', async () => {
    await applyObjectTags(ctx(db, ['workflows.edit']), { type: 'workflows', ids: ['w1'], set: ['ops'] })
    expect(services.requireDesignAccess).toHaveBeenCalledWith(expect.anything(), 'workflow', 'w1')
    const update = db.calls.find((c: any) => c.table === 'workflows' && c.op === 'update')
    expect(update.payload).toEqual({ tags: ['ops'] })
  })

  it('brand-new tags need tags.manage when the workspace turned allow_new off; existing ones don\'t', async () => {
    db = seed({ tags: { allow_new: false } })
    await expect(applyObjectTags(ctx(db, ['forms.edit', 'forms.view']), { type: 'forms', ids: ['f1'], add: ['brand new'] })).rejects.toMatchObject({ code: 'forbidden' })
    await applyObjectTags(ctx(db, ['forms.edit', 'forms.view']), { type: 'forms', ids: ['f1'], add: ['hr'] })
    expect(services.updateForm).toHaveBeenLastCalledWith(expect.anything(), 'f1', { tags: ['travel', 'HR'] })
    await applyObjectTags(ctx(db, ['forms.edit', 'forms.view', 'tags.manage']), { type: 'forms', ids: ['f1'], add: ['brand new'] })
    expect(services.updateForm).toHaveBeenCalledTimes(2)
  })
})
