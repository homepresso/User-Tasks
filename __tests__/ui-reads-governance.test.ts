/**
 * Governance dashboard reads (providers phase 4): settings page, permission
 * pickers and overview, retention-policy picker, asset dependency scans.
 */
import { describe, expect, it, vi } from 'vitest'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

function ctx(db: any, permissions: string[]): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}

const db = () => createMemorySupabase({
  roles: [
    { id: 'ro2', name: 'Viewer', slug: 'viewer', tenant_id: 'tenant-a', is_system: false },
    { id: 'ro1', name: 'Admin', slug: 'admin', tenant_id: 'tenant-a', is_system: true },
    { id: 'ro3', name: 'Elsewhere', slug: 'x', tenant_id: 'tenant-b', is_system: false },
  ],
  teams: [
    { id: 'te1', name: 'Ops', tenant_id: 'tenant-a' },
    { id: 'te2', name: 'Other', tenant_id: 'tenant-b' },
  ],
  users: [
    { id: 'user-1', display_name: 'Bea', email: 'b@x', tenant_id: 'tenant-a', deleted_at: null },
    { id: 'user-2', display_name: 'Al', email: 'a@x', tenant_id: 'tenant-a', deleted_at: null },
    { id: 'user-3', display_name: 'Gone', email: 'g@x', tenant_id: 'tenant-a', deleted_at: '2026-01-01' },
  ],
  user_roles: [{ id: 'ur1', user_id: 'user-2', role_id: 'ro1', tenant_id: 'tenant-a' }],
  permission_audit_log: [{ id: 'al1', action: 'grant', actor_id: 'user-1', tenant_id: 'tenant-a', created_at: '2026-10-01' }],
  workflows: [
    { id: 'wf1', name: 'Uses ref', tenant_id: 'tenant-a', nodes: [{ config: { referenceId: 'ref1' } }] },
    { id: 'wf2', name: 'Uses table', tenant_id: 'tenant-a', nodes: [{ config: { table_id: 'tb1' } }, { type: 'start' }] },
    { id: 'wf3', name: 'Nothing', tenant_id: 'tenant-a', nodes: null },
  ],
  custom_tables: [{ id: 'tb1', name: 'Claims', tenant_id: 'tenant-a' }],
  custom_table_rows: [
    { id: 'row1', table_id: 'tb1' }, { id: 'row2', table_id: 'tb1' }, { id: 'row3', table_id: 'tb9' },
  ],
  agents: [{ id: 'ag1', name: 'Helper', tenant_id: 'tenant-a' }],
  integrations: [{ id: 'in1', name: 'CRM', tenant_id: 'tenant-a' }, { id: 'in2', name: 'Far', tenant_id: 'tenant-b' }],
  integration_references: [
    { id: 'ref1', name: 'Get', integration_id: 'in1' },
    { id: 'ref2', name: 'Post', integration_id: 'in2' },
  ],
  object_permissions: [
    { id: 'op1', object_type: 'workflow', object_id: 'wf1', role_id: 'ro1' },
    { id: 'op2', object_type: 'workflow', object_id: 'wf1', role_id: 'ro2' },
    { id: 'op3', object_type: 'agent', object_id: 'ag1', role_id: 'ro1' },
  ],
  retention_policies: [
    { id: 'rp2', name: 'Rows only', applies_to: ['data_rows'], tenant_id: 'tenant-a' },
    { id: 'rp1', name: 'Tables and roles', applies_to: ['data_tables', 'roles'], tenant_id: 'tenant-a' },
    { id: 'rp3', name: 'Unscoped', applies_to: null, tenant_id: 'tenant-a' },
  ],
})

const read = (perms: string[], name: string, args?: unknown, memory = db()) => runUiRead(ctx(memory, perms), { name, args })

describe('governance reads: permissions', () => {
  it.each([
    ['governance.settingsPage', { tenantId: 'tenant-a' }, ['team.change_roles'], ['settings.view']],
    ['governance.permissionObjects', { tenantId: 'tenant-a' }, ['team.change_roles'], ['workflows.view']],
    ['governance.restrictedObjects', undefined, ['team.change_roles'], ['workflows.view']],
    ['governance.retentionPolicies', { scope: 'roles' }, ['data.view'], ['tasks.view_own']],
    ['governance.retentionPolicies', { scope: 'roles' }, ['team.change_roles'], ['tasks.view_own']],
    ['governance.integrationDependencies', { integrationId: 'in1' }, ['integrations.view'], ['data.view']],
    ['governance.referenceDependencies', { referenceId: 'ref1' }, ['integrations.view'], ['data.view']],
    ['governance.tableDependencies', { tableId: 'tb1' }, ['data.view'], ['integrations.view']],
  ])('%s is gated', async (name, args, allowed, denied) => {
    expect(await read(allowed, name, args)).toMatchObject({ ok: true })
    const memory = db()
    const from = vi.spyOn(memory, 'from')
    expect(await read(denied, name, args, memory)).toMatchObject({ ok: false, status: 403 })
    expect(from).not.toHaveBeenCalled()
  })

  it('grantee pickers are open to every signed-in user (designers embed them; RLS is the boundary)', async () => {
    for (const name of ['governance.roleOptions', 'governance.teamOptions', 'governance.userOptions']) {
      expect(await read([], name, { tenantId: 'tenant-a' })).toMatchObject({ ok: true })
    }
  })

  it('validates arguments', async () => {
    const all = ['team.change_roles', 'data.view', 'integrations.view']
    expect(await read(all, 'governance.roleOptions', {})).toMatchObject({ ok: false, status: 400 })
    expect(await read(all, 'governance.roleOptions', { tenantId: '' })).toMatchObject({ ok: false, status: 400 })
    expect(await read(all, 'governance.retentionPolicies', { scope: 'tasks' })).toMatchObject({ ok: false, status: 400 })
    expect(await read(all, 'governance.tableDependencies', { tableId: 'x'.repeat(201) })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('governance reads: data', () => {
  it('pickers return the given tenant’s rows, ordered, without deleted users', async () => {
    expect((await read([], 'governance.roleOptions', { tenantId: 'tenant-a' }) as any).data.map((r: any) => r.id)).toEqual(['ro1', 'ro2'])
    expect((await read([], 'governance.teamOptions', { tenantId: 'tenant-a' }) as any).data.map((r: any) => r.id)).toEqual(['te1'])
    expect((await read([], 'governance.userOptions', { tenantId: 'tenant-a' }) as any).data.map((r: any) => r.id)).toEqual(['user-2', 'user-1'])
  })

  it('settings page loads roles, users with assignments and the audit log with actors', async () => {
    const { data } = await read(['team.change_roles'], 'governance.settingsPage', { tenantId: 'tenant-a' }) as any
    expect(data.roles.map((r: any) => r.id)).toEqual(['ro1', 'ro2'])
    expect(data.users.find((u: any) => u.id === 'user-2').assignments).toMatchObject([{ id: 'ur1' }])
    expect(data.auditLog).toMatchObject([{ id: 'al1', actor: { id: 'user-1', display_name: 'Bea' } }])
  })

  it('permission overview lists the tenant’s objects with links, and restricted objects once each', async () => {
    const { data } = await read(['team.change_roles'], 'governance.permissionObjects', { tenantId: 'tenant-a' }) as any
    expect(data).toContainEqual({ type: 'integration', id: 'in1', name: 'CRM', href: '/integrations/in1' })
    expect(data).toContainEqual({ type: 'agent', id: 'ag1', name: 'Helper', href: '/agents/ag1' })
    expect(data.some((o: any) => o.id === 'in2')).toBe(false)
    expect((await read(['team.change_roles'], 'governance.restrictedObjects') as any).data).toEqual([
      { object_type: 'workflow', object_id: 'wf1' },
      { object_type: 'agent', object_id: 'ag1' },
    ])
  })

  it('retention policies are filtered to the scope server-side', async () => {
    expect((await read(['data.view'], 'governance.retentionPolicies', { scope: 'roles' }) as any).data.map((p: any) => p.id)).toEqual(['rp1'])
    expect((await read(['data.view'], 'governance.retentionPolicies', { scope: 'data_rows' }) as any).data.map((p: any) => p.id)).toEqual(['rp2'])
  })

  it('dependency scans return names and counts, not workflow nodes', async () => {
    const integration = (await read(['integrations.view'], 'governance.integrationDependencies', { integrationId: 'in1' }) as any).data
    expect(integration).toMatchObject({ references: [{ id: 'ref1', name: 'Get' }], workflows: [{ id: 'wf1', name: 'Uses ref' }] })
    expect(JSON.stringify(integration)).not.toContain('nodes')
    expect((await read(['integrations.view'], 'governance.integrationDependencies', { integrationId: 'in9' }) as any).data)
      .toMatchObject({ references: [], workflows: [] })
    expect((await read(['integrations.view'], 'governance.referenceDependencies', { referenceId: 'ref1' }) as any).data.workflows)
      .toEqual([{ id: 'wf1', name: 'Uses ref' }])
    expect((await read(['data.view'], 'governance.tableDependencies', { tableId: 'tb1' }) as any).data)
      .toMatchObject({ submissions: 2, workflows: [{ id: 'wf2', name: 'Uses table' }] })
  })
})
