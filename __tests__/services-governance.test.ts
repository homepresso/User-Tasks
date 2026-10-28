import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ success: true, id: 'email-1' })) }))

import { writeAudit } from '@/lib/audit-log'
import { sendEmail } from '@/lib/email'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import type { ServiceContext } from '@/lib/services/context'
import * as roles from '@/lib/services/roles'
import * as teams from '@/lib/services/teams'
import * as invitations from '@/lib/services/invitations'
import { listAuditLog } from '@/lib/services/audit-log'
import { createMemorySupabase } from './fixtures/supabase-memory'

const ALL = ['team.view_members', 'team.invite', 'team.remove', 'team.change_roles', 'settings.view']
const page = { limit: 50, offset: 0 }

function context(supabase: ReturnType<typeof createMemorySupabase>, permissions: string[] = ALL, extra: Partial<ServiceContext> = {}): ServiceContext {
  return {
    supabase: supabase as unknown as ServiceContext['supabase'],
    tenantId: 'tenant-a',
    actorId: 'user-1',
    permissions: new Set(permissions),
    authKind: 'api_key',
    source: 'api',
    ...extra,
  }
}

function seed() {
  return createMemorySupabase({
    roles: [
      { id: 'role-owner', tenant_id: 'tenant-a', name: 'Owner', slug: 'owner', permissions: ['tasks.view_all'], is_system: true },
      { id: 'role-custom', tenant_id: 'tenant-a', name: 'Approver', slug: 'approver', permissions: ['tasks.complete'], is_system: false },
      { id: 'role-b', tenant_id: 'tenant-b', name: 'Foreign', slug: 'foreign', permissions: [], is_system: false },
    ],
    users: [
      { id: 'user-1', tenant_id: 'tenant-a', display_name: 'Ada', email: 'ada@a.test', role: 'admin', deleted_at: null },
      { id: 'user-2', tenant_id: 'tenant-a', display_name: 'Bob', email: 'bob@a.test', role: 'member', deleted_at: null },
      { id: 'user-b', tenant_id: 'tenant-b', display_name: 'Eve', email: 'eve@b.test', role: 'admin', deleted_at: null },
    ],
    user_roles: [{ id: 'ur-1', tenant_id: 'tenant-a', user_id: 'user-2', role_id: 'role-custom' }],
    teams: [
      { id: 'team-a', tenant_id: 'tenant-a', name: 'Ops', description: null, parent_id: null },
      { id: 'team-b', tenant_id: 'tenant-b', name: 'Foreign team', description: null, parent_id: null },
    ],
    user_teams: [{ id: 'ut-1', team_id: 'team-a', user_id: 'user-2', role: 'member' }],
    invitations: [
      { id: 'inv-a', tenant_id: 'tenant-a', email: 'new@a.test', role: 'member', invited_by: 'user-1', token: 'secret-token', accepted_at: null, expires_at: '2999-01-01T00:00:00Z', created_at: '2026-01-01' },
      { id: 'inv-b', tenant_id: 'tenant-b', email: 'x@b.test', role: 'member', invited_by: 'user-b', token: 'other', accepted_at: null, expires_at: '2999-01-01T00:00:00Z', created_at: '2026-01-01' },
    ],
    tenants: [{ id: 'tenant-a', name: 'Acme', slug: 'acme' }],
    object_audit_log: [
      { id: 'ev-1', tenant_id: 'tenant-a', object_type: 'role', object_id: 'role-custom', action: 'update', actor_id: 'user-1', created_at: '2026-03-01T00:00:00Z' },
      { id: 'ev-2', tenant_id: 'tenant-a', object_type: 'workflow', object_id: 'wf-1', action: 'create', actor_id: 'user-2', created_at: '2026-01-01T00:00:00Z' },
      { id: 'ev-3', tenant_id: 'tenant-b', object_type: 'role', object_id: 'role-b', action: 'update', actor_id: 'user-b', created_at: '2026-03-01T00:00:00Z' },
    ],
  })
}

beforeEach(() => {
  vi.mocked(writeAudit).mockClear()
  vi.mocked(recordAssetChange).mockClear()
  vi.mocked(sendEmail).mockClear()
})

describe('governance services: permissions', () => {
  it.each([
    ['listRoles', 'team.view_members', (ctx: ServiceContext) => roles.listRoles(ctx)],
    ['createRole', 'team.change_roles', (ctx: ServiceContext) => roles.createRole(ctx, { name: 'X' })],
    ['updateRole', 'team.change_roles', (ctx: ServiceContext) => roles.updateRole(ctx, 'role-custom', { name: 'Y' })],
    ['deleteRole', 'team.change_roles', (ctx: ServiceContext) => roles.deleteRole(ctx, 'role-custom')],
    ['assignRole', 'team.change_roles', (ctx: ServiceContext) => roles.assignRole(ctx, 'user-1', 'role-custom')],
    ['removeUserRole', 'team.change_roles', (ctx: ServiceContext) => roles.removeUserRole(ctx, 'user-2', 'role-custom')],
    ['listUsers', 'team.view_members', (ctx: ServiceContext) => roles.listUsers(ctx, {}, page)],
    ['listTeams', 'team.view_members', (ctx: ServiceContext) => teams.listTeams(ctx)],
    ['createTeam', 'team.invite', (ctx: ServiceContext) => teams.createTeam(ctx, { name: 'T' })],
    ['deleteTeam', 'team.remove', (ctx: ServiceContext) => teams.deleteTeam(ctx, 'team-a')],
    ['addTeamMember', 'team.invite', (ctx: ServiceContext) => teams.addTeamMember(ctx, 'team-a', 'user-1')],
    ['removeTeamMember', 'team.remove', (ctx: ServiceContext) => teams.removeTeamMember(ctx, 'team-a', 'user-2')],
    ['listInvitations', 'team.invite', (ctx: ServiceContext) => invitations.listInvitations(ctx, {}, page)],
    ['sendInvitation', 'team.invite', (ctx: ServiceContext) => invitations.sendInvitation(ctx, { email: 'z@a.test' })],
    ['revokeInvitation', 'team.invite', (ctx: ServiceContext) => invitations.revokeInvitation(ctx, 'inv-a')],
    ['resendInvitation', 'team.invite', (ctx: ServiceContext) => invitations.resendInvitation(ctx, 'inv-a')],
    ['listAuditLog', 'settings.view', (ctx: ServiceContext) => listAuditLog(ctx, {}, page)],
  ])('%s needs %s and touches nothing without it', async (_name, permission, call) => {
    const supabase = seed()
    await expect(call(context(supabase, ALL.filter((p) => p !== permission)))).rejects.toMatchObject({ status: 403 })
    expect(supabase.calls).toEqual([])
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('roles', () => {
  it('lists only the tenant roles, system first', async () => {
    const { roles: rows } = await roles.listRoles(context(seed()))
    expect(rows.map((r) => r.id)).toEqual(['role-owner', 'role-custom'])
  })

  it('creates a custom role with known permissions only, audited and synced', async () => {
    const supabase = seed()
    const role = await roles.createRole(context(supabase), { name: ' Reviewer ', permissions: ['tasks.view_all', 'bogus.perm', 'tasks.view_all'] })
    expect(role).toMatchObject({ name: 'Reviewer', slug: 'reviewer', is_system: false, permissions: ['tasks.view_all'] })
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'role', action: 'create' }))
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'role', assetId: role.id }))
    expect(supabase.tables.permission_audit_log).toHaveLength(1)
  })

  it('protects system roles: no rename, no delete; permissions stay editable', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    await expect(roles.updateRole(ctx, 'role-owner', { name: 'Boss' })).rejects.toMatchObject({ status: 400 })
    await expect(roles.deleteRole(ctx, 'role-owner')).rejects.toMatchObject({ status: 409 })
    const updated = await roles.updateRole(ctx, 'role-owner', { name: 'Owner', permissions: ['tasks.view_all', 'workflows.view'] })
    expect(updated.permissions).toEqual(['tasks.view_all', 'workflows.view'])
    expect(supabase.tables.roles.find((r) => r.id === 'role-owner')?.name).toBe('Owner')
  })

  it('deleting a custom role removes its assignments', async () => {
    const supabase = seed()
    await roles.deleteRole(context(supabase), 'role-custom')
    expect(supabase.tables.roles.map((r) => r.id)).not.toContain('role-custom')
    expect(supabase.tables.user_roles).toEqual([])
  })

  it('cannot reach another tenant role or user', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    await expect(roles.getRole(ctx, 'role-b')).rejects.toMatchObject({ status: 404 })
    await expect(roles.deleteRole(ctx, 'role-b')).rejects.toMatchObject({ status: 404 })
    await expect(roles.assignRole(ctx, 'user-1', 'role-b')).rejects.toMatchObject({ status: 404 })
    await expect(roles.assignRole(ctx, 'user-b', 'role-custom')).rejects.toMatchObject({ status: 404 })
    expect(supabase.tables.user_roles).toHaveLength(1)
  })

  it('assignment is idempotent and removal reports whether anything changed', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    expect(await roles.assignRole(ctx, 'user-1', 'role-custom')).toMatchObject({ already_assigned: false })
    expect(await roles.assignRole(ctx, 'user-1', 'role-custom')).toMatchObject({ already_assigned: true })
    expect(supabase.tables.user_roles).toHaveLength(2)
    expect(await roles.removeUserRole(ctx, 'user-1', 'role-custom')).toMatchObject({ removed: true })
    expect(await roles.removeUserRole(ctx, 'user-1', 'role-custom')).toMatchObject({ removed: false })
  })

  it('lists tenant users with roles and teams', async () => {
    const { users, total } = await roles.listUsers(context(seed()), { include_roles: true, include_teams: true }, page)
    expect(total).toBe(2)
    const bob = users.find((u) => (u as { id?: string }).id === 'user-2')!
    expect(bob.roles).toEqual([{ id: 'role-custom' }]) // the memory client does not embed
    expect(bob.teams).toEqual([expect.objectContaining({ id: 'team-a', member_role: 'member' })])
  })
})

describe('teams', () => {
  it('creates, renames and deletes a team (with its memberships)', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const team = await teams.createTeam(ctx, { name: 'Support', parent_id: 'team-a' })
    await teams.updateTeam(ctx, team.id, { name: 'Support EU' })
    expect(supabase.tables.teams.find((t) => t.id === team.id)?.name).toBe('Support EU')
    await teams.deleteTeam(ctx, 'team-a')
    expect(supabase.tables.user_teams).toEqual([])
  })

  it('rejects a foreign parent and foreign teams/users', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    await expect(teams.createTeam(ctx, { name: 'X', parent_id: 'team-b' })).rejects.toMatchObject({ status: 400 })
    await expect(teams.deleteTeam(ctx, 'team-b')).rejects.toMatchObject({ status: 404 })
    await expect(teams.addTeamMember(ctx, 'team-b', 'user-1')).rejects.toMatchObject({ status: 404 })
    await expect(teams.addTeamMember(ctx, 'team-a', 'user-b')).rejects.toMatchObject({ status: 404 })
    expect(supabase.tables.user_teams).toHaveLength(1)
  })

  it('member add is idempotent; get returns members', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    expect(await teams.addTeamMember(ctx, 'team-a', 'user-1')).toMatchObject({ already_member: false })
    expect(await teams.addTeamMember(ctx, 'team-a', 'user-1')).toMatchObject({ already_member: true })
    const team = await teams.getTeam(ctx, 'team-a')
    expect(team.members.map((m: { id: string }) => m.id).sort()).toEqual(['user-1', 'user-2'])
  })
})

describe('invitations', () => {
  it('never returns the acceptance token', async () => {
    const { invitations: rows } = await invitations.listInvitations(context(seed()), {}, page)
    expect(rows.map((r) => r.id)).toEqual(['inv-a'])
    expect(JSON.stringify(rows)).not.toContain('secret-token')
    expect(rows[0].status).toBe('pending')
  })

  it('sends: validates, stores a token, emails it (mocked) and does not return it', async () => {
    const supabase = seed()
    const result = await invitations.sendInvitation(context(supabase), { email: ' New.Person@A.test ', role: 'manager' })
    expect(result.email_sent).toBe(true)
    const stored = supabase.tables.invitations.find((i) => i.email === 'new.person@a.test')!
    expect(stored).toMatchObject({ tenant_id: 'tenant-a', role: 'manager', invited_by: 'user-1' })
    expect(JSON.stringify(result)).not.toContain(stored.token)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(sendEmail).mock.calls[0][0].body)).toContain(`/invite/${stored.token}`)
  })

  it('rejects bad input, existing members, duplicates and unattributable callers', async () => {
    const ctx = context(seed())
    await expect(invitations.sendInvitation(ctx, { email: 'nope' })).rejects.toMatchObject({ status: 400 })
    await expect(invitations.sendInvitation(ctx, { email: 'a@a.test', role: 'superuser' })).rejects.toMatchObject({ status: 400 })
    await expect(invitations.sendInvitation(ctx, { email: 'bob@a.test' })).rejects.toMatchObject({ status: 409 })
    await expect(invitations.sendInvitation(ctx, { email: 'new@a.test' })).rejects.toMatchObject({ status: 409 })
    await expect(invitations.sendInvitation(context(seed(), ALL, { actorId: null, credentialOwnerId: null }), { email: 'q@a.test' }))
      .rejects.toMatchObject({ status: 400 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('tenant keys attribute invitations to the key creator', async () => {
    const supabase = seed()
    await invitations.sendInvitation(context(supabase, ALL, { actorId: null, credentialOwnerId: 'user-1' }), { email: 'k@a.test' })
    expect(supabase.tables.invitations.find((i) => i.email === 'k@a.test')?.invited_by).toBe('user-1')
  })

  it('resend rotates the token; revoke deletes; other tenants are invisible', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    await invitations.resendInvitation(ctx, 'inv-a')
    expect(supabase.tables.invitations.find((i) => i.id === 'inv-a')?.token).not.toBe('secret-token')
    expect(sendEmail).toHaveBeenCalledTimes(1)
    await expect(invitations.revokeInvitation(ctx, 'inv-b')).rejects.toMatchObject({ status: 404 })
    await invitations.revokeInvitation(ctx, 'inv-a')
    expect(supabase.tables.invitations.map((i) => i.id)).toEqual(['inv-b'])
  })
})

describe('audit log', () => {
  it('filters by tenant, type and time range', async () => {
    const ctx = context(seed())
    expect((await listAuditLog(ctx, {}, page)).events.map((e) => e.id)).toEqual(['ev-1', 'ev-2'])
    expect((await listAuditLog(ctx, { object_type: 'workflow' }, page)).events.map((e) => e.id)).toEqual(['ev-2'])
    expect((await listAuditLog(ctx, { from: '2026-02-01T00:00:00Z' }, page)).events.map((e) => e.id)).toEqual(['ev-1'])
    await expect(listAuditLog(ctx, { to: 'yesterday' }, page)).rejects.toMatchObject({ status: 400 })
  })
})
