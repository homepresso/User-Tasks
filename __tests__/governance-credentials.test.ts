/**
 * Credentials and service-role surfaces (governance audit 2026-11):
 *  - a user-context API key never exceeds its user's LIVE role permissions,
 *    shrinks when they are demoted and dies when they are gone or leave;
 *  - tenant keys honour their explicit list; legacy tenant keys stay full;
 *  - saved reports on REST / MCP: own or shared to read, own to change for
 *    user-bound credentials, sharing needs reports.share;
 *  - report sources need the domain's permission on top of reports.view.
 */
import { describe, expect, it } from 'vitest'
import { resolveKeyPermissions } from '@/lib/api-auth'
import { PERMISSION_KEYS } from '@/lib/permissions'
import { reportShareDenied, scopeReportRead, scopeReportWrite } from '@/lib/reports-access'
import { assertReportSourceAccess, reportSourcePermission } from '@/lib/mcp/tools/reports'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

function db(rolePerms: string[] | null, opts: { member?: boolean; home?: string } = {}) {
  return createMemorySupabase({
    user_roles: rolePerms ? [{ tenant_id: 't1', user_id: 'u1', role: { permissions: rolePerms } }] : [],
    user_memberships: opts.member === false ? [] : [{ id: 'm1', user_id: 'u1', tenant_id: 't1', is_active: true }],
    users: [{ id: 'u1', tenant_id: opts.home ?? 'other' }],
  }) as any
}

describe('API key permission resolution', () => {
  it("a user key's explicit list is capped by the user's live role (demotion shrinks it)", async () => {
    const key = { key_type: 'user', user_id: 'u1', tenant_id: 't1', permissions: ['workflows.view', 'team.change_roles'] }
    expect((await resolveKeyPermissions(db(['workflows.view', 'team.change_roles']), key)).sort()).toEqual(['team.change_roles', 'workflows.view'])
    expect(await resolveKeyPermissions(db(['workflows.view']), key)).toEqual(['workflows.view'])
  })

  it('a user key without a list follows the role', async () => {
    const key = { key_type: 'user', user_id: 'u1', tenant_id: 't1', permissions: null }
    expect(await resolveKeyPermissions(db(['tasks.view_own']), key)).toEqual(['tasks.view_own'])
  })

  it('a user key whose user was deleted (user_id nulled) or left the workspace has no permissions — never legacy full admin', async () => {
    expect(await resolveKeyPermissions(db(['tasks.view_own']), { key_type: 'user', user_id: null, tenant_id: 't1', permissions: null })).toEqual([])
    expect(await resolveKeyPermissions(db(['tasks.view_own'], { member: false }), { key_type: 'user', user_id: 'u1', tenant_id: 't1', permissions: null })).toEqual([])
    // Home workspace counts as membership.
    expect(await resolveKeyPermissions(db(['tasks.view_own'], { member: false, home: 't1' }), { key_type: 'user', user_id: 'u1', tenant_id: 't1', permissions: null })).toEqual(['tasks.view_own'])
  })

  it('implied permissions are added (view_runs ⊃ view_queue) and still capped', async () => {
    const key = { key_type: 'user', user_id: 'u1', tenant_id: 't1', permissions: ['workflows.view_runs'] }
    expect((await resolveKeyPermissions(db(['workflows.view_runs']), key)).sort()).toEqual(['workflows.view_queue', 'workflows.view_runs'])
  })

  it('tenant keys: the explicit list; legacy keys without one stay full (backward compatible)', async () => {
    expect(await resolveKeyPermissions(db(null), { key_type: 'tenant', tenant_id: 't1', permissions: ['data.view'] })).toEqual(['data.view'])
    expect((await resolveKeyPermissions(db(null), { key_type: 'tenant', tenant_id: 't1', permissions: null })).length).toBe(PERMISSION_KEYS.length)
  })
})

describe('saved reports on service-role surfaces', () => {
  const recorder = () => {
    const calls: string[] = []
    const q: any = { or: (f: string) => { calls.push(`or:${f}`); return q }, eq: (c: string, v: string) => { calls.push(`eq:${c}=${v}`); return q } }
    return { q, calls }
  }

  it('user-bound credentials read own or shared reports and change only their own', () => {
    const read = recorder(); scopeReportRead(read.q, 'u1')
    expect(read.calls).toEqual(['or:created_by.eq.u1,is_shared.eq.true'])
    const write = recorder(); scopeReportWrite(write.q, 'u1')
    expect(write.calls).toEqual(['eq:created_by=u1'])
  })

  it('tenant-wide credentials see the workspace (bounded by their permission list)', () => {
    const read = recorder(); scopeReportRead(read.q, null)
    const write = recorder(); scopeReportWrite(write.q, undefined)
    expect([...read.calls, ...write.calls]).toEqual([])
  })

  it('sharing needs reports.share', () => {
    expect(reportShareDenied({ is_shared: true }, ['reports.edit_own'])).toMatch(/reports\.share/)
    expect(reportShareDenied({ is_shared: true }, ['reports.edit_own', 'reports.share'])).toBeNull()
    expect(reportShareDenied({ name: 'x' }, ['reports.edit_own'])).toBeNull()
  })
})

describe('report sources', () => {
  it('each source needs its domain permission on top of reports.view', () => {
    expect(reportSourcePermission('tasks')).toBe('tasks.view_all')
    expect(reportSourcePermission('workflow_runs')).toBe('workflows.view_runs')
    expect(reportSourcePermission('api_keys')).toBe('settings.manage_api_keys')
    expect(reportSourcePermission('invitations')).toBe('team.invite')
    expect(reportSourcePermission('object_audit_log')).toBe('settings.view')
    expect(reportSourcePermission('custom_table_abc')).toBe('data.view')
    expect(reportSourcePermission('0a000000-0000-4000-8000-000000000001')).toBe('data.view')
  })

  it('a Viewer (reports.view) cannot query API keys, invitations, audit or all tasks', () => {
    for (const source of ['api_keys', 'invitations', 'object_audit_log', 'tasks', 'workflow_runs', 'integrations']) {
      expect(() => assertReportSourceAccess({ data_source: source } as any, ['reports.view']), source).toThrow(/needs the/)
    }
    expect(() => assertReportSourceAccess({ data_source: 'tasks' } as any, ['reports.view', 'tasks.view_all'])).not.toThrow()
  })
})
