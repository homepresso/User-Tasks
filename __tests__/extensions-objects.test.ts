/**
 * Extension object management (lib/extensions/objects-host.ts): an extension
 * lists and manages ONLY the workflows on its own triggers and the forms
 * bound to its form targets; managed tags touch only the extension's prefix;
 * ctx.users.current; ctx.elevate (full permissions, same person, reason in
 * the audit log); designer "Back to …" links accept app paths only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))

import { defineExtension, defineServerExtension } from '@user-tasks/extension-sdk'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { createExtensionContext } from '@/lib/extensions/host'
import { mergeManagedTags } from '@/lib/extensions/objects-host'
import { returnToFrom } from '@/lib/navigation/return-to'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = '0e000000-0000-4000-8000-0000000b0001'
const OTHER = '0e000000-0000-4000-8000-0000000b0002'
const USER = '0e000000-0000-4000-8000-0000000b0101'
const W1 = '0e000000-0000-4000-8000-0000000b0201'
const W2 = '0e000000-0000-4000-8000-0000000b0202'
const W3 = '0e000000-0000-4000-8000-0000000b0203'
const F1 = '0e000000-0000-4000-8000-0000000b0301'
const F2 = '0e000000-0000-4000-8000-0000000b0302'

const manifest = {
  manifest_version: 1, id: 'acme', name: 'Acme', version: '1.0.0', publisher: { id: 'acme', name: 'Acme' },
  engines: { usertasks: '>=0.1.0 <2.0.0', extension_sdk: '^1.0.0' },
  licence: { tier: 'free' }, deployments: ['cloud', 'self_hosted'],
  contributes: { triggers: [{ key: 'changed', label: 'Changed', description: 'x', config: [], variables: [] }] },
}

function seed() {
  db.current = createMemorySupabase({
    workflows: [
      { id: W1, tenant_id: TENANT, name: 'Mine', trigger_type: 'ext.acme.changed', nodes: [{ id: 'trigger', type: 'ext.acme.changed', config: { list: 'L1' } }], is_active: true, published_version_id: 'v1', has_unpublished_changes: false, run_count: 4, last_run_at: '2026-11-14T10:00:00Z', tags: ['finance', 'acme: old'], updated_at: '2026-11-14T09:00:00Z' },
      { id: W2, tenant_id: TENANT, name: 'Plain', trigger_type: 'manual', nodes: [], is_active: true, tags: [], updated_at: '2026-11-14T09:00:00Z' },
      { id: W3, tenant_id: OTHER, name: 'Elsewhere', trigger_type: 'ext.acme.changed', nodes: [], is_active: false, tags: [], updated_at: '2026-11-14T09:00:00Z' },
    ],
    forms: [
      { id: F1, tenant_id: TENANT, name: 'Bound', version: 1, layout: { rows: [], data_target: { extension: 'acme', key: 't', config: {} } }, tags: [] },
      { id: F2, tenant_id: TENANT, name: 'Other', version: 1, layout: { rows: [] }, tags: [] },
    ],
    object_audit_log: [{ id: 'a1', tenant_id: TENANT, actor_id: USER, object_type: 'workflow', object_id: W1, action: 'update', created_at: '2026-11-14T09:00:00Z' }],
    workflow_queue: [
      { id: 'q1', tenant_id: TENANT, workflow_id: W1, trigger_type: 'ext.acme.changed', trigger_data: { event: 'updated', list_id: 'L1', item_id: 7 }, status: 'completed', result: { status: 'completed', run_id: '0e000000-0000-4000-8000-0000000b0401' }, created_at: '2026-11-14T10:00:00Z' },
      { id: 'q2', tenant_id: TENANT, workflow_id: W1, trigger_type: 'ext.acme.changed', trigger_data: { event: 'created', list_id: 'L1', item_id: 8 }, status: 'completed', result: {}, created_at: '2026-11-14T10:01:00Z' },
      { id: 'q3', tenant_id: TENANT, workflow_id: W2, trigger_type: 'manual', trigger_data: { list_id: 'L1', item_id: 7 }, status: 'pending', result: null, created_at: '2026-11-14T10:02:00Z' },
      { id: 'q4', tenant_id: TENANT, workflow_id: W1, trigger_type: 'ext.acme.changed', trigger_data: { event: 'deleted', list_id: 'L1', item_id: 7 }, status: 'pending', result: null, created_at: '2026-11-14T10:03:00Z' },
    ],
    workflow_runs: [{ id: '0e000000-0000-4000-8000-0000000b0401', tenant_id: TENANT, workflow_id: W1, status: 'completed', started_at: '2026-11-14T10:00:01Z', completed_at: '2026-11-14T10:00:05Z' }],
    users: [{ id: USER, email: 'ana@contoso.local', display_name: 'Ana B', deleted_at: null }],
    user_memberships: [{ user_id: USER, tenant_id: TENANT, is_active: true }],
  }, { uuids: true }) as any
  return db.current
}

describe('extension object management', () => {
  beforeEach(() => registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [defineServerExtension({ id: 'acme', triggers: { changed: { matches: () => true } } })] }))
  afterEach(() => resetExtensionsForTest())

  it('lists only workflows on its own triggers in this workspace, with status, runs and last editor', async () => {
    seed()
    const ctx = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: USER, permissions: ['workflows.view'] })
    const list = await ctx.workflows.list()
    expect(list.map((w) => w.id)).toEqual([W1])
    expect(list[0]).toMatchObject({ status: 'active', runCount: 4, updatedBy: 'Ana B', config: { list: 'L1' }, path: `/automations/${W1}` })
    expect(await createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: USER, permissions: [] }).workflows.list()).toEqual([])
  })

  it('lists the runs of its own triggers for one record (newest first), with the run link', async () => {
    seed()
    const ctx = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: USER, permissions: ['workflows.view'] })
    const runs = await ctx.workflows.runs({ match: { list_id: 'L1', item_id: 7 } })
    expect(runs.map((r) => [r.event, r.status, r.path])).toEqual([['deleted', 'pending', null], ['updated', 'completed', '/automations/runs/0e000000-0000-4000-8000-0000000b0401']])
    expect(runs[1]).toMatchObject({ workflowName: 'Mine', completedAt: '2026-11-14T10:00:05Z' })
    expect(await createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: USER, permissions: [] }).workflows.runs({ match: { item_id: 7 } })).toEqual([])
    expect(await ctx.workflows.runs({ match: {} })).toEqual([])
  })

  it('refuses to manage other workflows and forms (404), and keeps people\'s own tags', async () => {
    const mem = seed()
    const ctx = createExtensionContext({ extensionId: 'acme', tenantId: TENANT })
    await expect(ctx.workflows.setTags(W2, ['acme: x'], { prefix: 'acme:' })).rejects.toMatchObject({ status: 404 })
    await expect(ctx.workflows.delete(W3)).rejects.toMatchObject({ status: 404 })
    await expect(ctx.forms.setTags(F2, ['acme: x'], { prefix: 'acme:' })).rejects.toMatchObject({ status: 404 })
    await ctx.workflows.setTags(W1, ['acme: expense claims', 'not-mine'], { prefix: 'acme:' })
    expect(mem.tables.workflows.find((w: any) => w.id === W1).tags).toEqual(['finance', 'acme: expense claims'])
    await ctx.forms.setTags(F1, ['ACME: Requests'], { prefix: 'acme:' })
    expect(mem.tables.forms.find((f: any) => f.id === F1).tags).toEqual(['acme: requests'])
    expect(mergeManagedTags(['a'], ['acme: ' + 'x'.repeat(60)], 'acme:')[1]).toHaveLength(40)
    expect(() => mergeManagedTags([], ['x'], '')).toThrow(/prefix/)
  })

  it('grantDesign: an Edit grant for the person on one of its own objects, only elevated (or team.change_roles), honoured by design access', async () => {
    const mem = seed()
    mem.tables.object_permissions = []
    mem.tables.object_audit_log = []
    const plain = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: USER, permissions: ['workflows.view'] })
    await expect(plain.workflows.grantDesign(W1)).rejects.toMatchObject({ status: 403 })
    const up = plain.elevate('via SharePoint permission (Manage Lists on Requests)')
    await expect(up.workflows.grantDesign(W2)).rejects.toMatchObject({ status: 404 })
    await expect(up.forms.grantDesign(F2)).rejects.toMatchObject({ status: 404 })
    expect(await up.workflows.grantDesign(W1)).toEqual({ granted: true })
    expect(await up.workflows.grantDesign(W1)).toEqual({ granted: false })
    expect(await up.forms.grantDesign(F1)).toEqual({ granted: true })
    expect(mem.tables.object_permissions.map((g: any) => [g.object_type, g.object_id, g.user_id, g.can_view, g.can_edit, g.can_delete])).toEqual([
      ['workflow', W1, USER, true, true, false], ['form', F1, USER, true, true, false],
    ])
    expect(mem.tables.object_audit_log.filter((a: any) => a.action === 'grant')).toHaveLength(2)
    const { canDesignObject } = await import('@/lib/services/design-access')
    const session = { supabase: mem, db: mem, tenantId: TENANT, actorId: USER, permissions: new Set(['workflows.view']), authKind: 'session', source: 'ui' } as any
    expect(await canDesignObject(session, 'workflow', W1)).toBe(true)
    expect(await canDesignObject(session, 'workflow', W2)).toBe(false)
    expect(await canDesignObject(session, 'form', F1)).toBe(true)
  })

  it('users.current and elevate (same person, all permissions, reason audited)', async () => {
    const mem = seed()
    mem.tables.object_audit_log = []
    const ctx = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: USER, permissions: ['workflows.view'] })
    expect(await ctx.users.current()).toEqual({ id: USER, email: 'ana@contoso.local', name: 'Ana B' })
    expect(ctx.can('workflows.delete')).toBe(false)
    const up = ctx.elevate('via SharePoint permission (Manage Lists on Requests)')
    expect(up.actorId).toBe(USER)
    expect(up.can('workflows.delete')).toBe(true)
    await up.audit({ action: 'create', summary: 'Set up Requests' })
    expect(mem.tables.object_audit_log[0]).toMatchObject({ actor_id: USER, summary: 'Set up Requests (via SharePoint permission (Manage Lists on Requests))' })
    expect(() => ctx.elevate('')).toThrow(/reason/)
    expect(() => createExtensionContext({ extensionId: 'acme', tenantId: TENANT }).elevate('x')).toThrow(/person/)
  })
})

describe('designer return links', () => {
  const get = (q: Record<string, string>) => (name: string) => q[name]
  it('accepts app paths only', () => {
    expect(returnToFrom(get({ return_to: '/embed/x/sharepoint/launch?k=1', return_label: 'Expense  Claims' }))).toEqual({ href: '/embed/x/sharepoint/launch?k=1', label: 'Back to Expense Claims' })
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '']) expect(returnToFrom(get({ return_to: bad }))).toBeNull()
    expect(returnToFrom(get({ return_to: '/automations' }))?.label).toBe('Back')
  })
})
