/**
 * Settings dashboard reads (providers phase 4): settings pages, Team and
 * Extensibility pages, and the shared people pickers.
 */
import { describe, expect, it, vi } from 'vitest'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

function ctx(db: any, permissions: string[] | null, actorId: string | null = 'user-1'): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId, permissions: permissions && new Set(permissions), authKind: 'session', source: 'ui' }
}

const db = () => createMemorySupabase({
  tenants: [{ id: 'tenant-a', slug: 'acme', branding: { logo_url: 'https://x/logo.png' } }],
  api_keys: [
    { id: 'k1', name: 'Old', is_revoked: false, created_at: '2026-01-01' },
    { id: 'k2', name: 'Revoked', is_revoked: true, created_at: '2026-02-01' },
    { id: 'k3', name: 'New', is_revoked: false, created_at: '2026-03-01' },
  ],
  mcp_servers: [{ id: 'm1', created_at: '2026-01-01' }],
  invitations: [
    { id: 'i1', email: 'a@x', accepted_at: null, created_at: '2026-01-01' },
    { id: 'i2', email: 'b@x', accepted_at: '2026-01-02', created_at: '2026-01-02' },
    { id: 'i3', email: 'c@x', accepted_at: null, created_at: '2026-01-03' },
  ],
  dead_letter_events: Array.from({ length: 55 }, (_, i) => ({ id: `d${i}`, created_at: `2026-01-${String(i % 28 + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z` })),
  teams: [{ id: 'te2', name: 'Zeta' }, { id: 'te1', name: 'Alpha' }],
  custom_workflow_activities: [{ id: 'a1', updated_at: '2026-01-01' }, { id: 'a2', updated_at: '2026-02-01' }],
  user_memberships: [
    { id: 'mb1', user_id: 'user-1', tenant_id: 'tenant-a', is_active: true, is_home: false },
    { id: 'mb2', user_id: 'user-1', tenant_id: 'tenant-b', is_active: true, is_home: true },
    { id: 'mb3', user_id: 'user-1', tenant_id: 'tenant-c', is_active: false, is_home: false },
    { id: 'mb4', user_id: 'user-2', tenant_id: 'tenant-a', is_active: true, is_home: true },
  ],
  user_teams: [
    { id: 'ut1', team_id: 'te1', user_id: 'user-1' },
    { id: 'ut2', team_id: 'te2', user_id: 'user-2' },
  ],
  users: [
    { id: 'user-1', display_name: 'Bea', deleted_at: null },
    { id: 'user-2', display_name: 'Al', deleted_at: null },
    { id: 'user-3', display_name: 'Gone', deleted_at: '2026-01-01' },
  ],
})

const read = (perms: string[] | null, name: string, args?: unknown, memory = db(), actorId?: string | null) =>
  runUiRead(ctx(memory, perms, actorId), { name, args })

describe('settings reads: permissions', () => {
  it.each([
    ['settings.apiKeysPage', undefined, ['settings.manage_api_keys'], ['settings.view']],
    ['settings.invitations', undefined, ['team.invite'], ['team.view_members']],
    ['settings.mcp', { tenantId: 'tenant-a' }, ['settings.view'], ['settings.manage_api_keys']],
    ['settings.deadLetters', undefined, ['settings.manage_webhooks'], ['settings.view']],
    ['settings.teams', undefined, ['team.view_members'], ['team.invite']],
    ['settings.workflowActivities', undefined, ['extensibility.view'], ['workflows.view']],
  ])('%s is gated', async (name, args, allowed, denied) => {
    expect(await read(allowed, name, args)).toMatchObject({ ok: true })
    const memory = db()
    const from = vi.spyOn(memory, 'from')
    expect(await read(denied, name, args, memory)).toMatchObject({ ok: false, status: 403 })
    expect(from).not.toHaveBeenCalled()
  })

  it('extensibility keeps the page’s compatibility path (settings.edit + integrations.view + workflows.view)', async () => {
    expect(await read(['settings.edit', 'integrations.view', 'workflows.view'], 'settings.workflowActivities')).toMatchObject({ ok: true })
    const memory = db()
    const from = vi.spyOn(memory, 'from')
    expect(await read(['settings.edit'], 'settings.workflowActivities', undefined, memory)).toMatchObject({ ok: false, status: 403 })
    expect(from).not.toHaveBeenCalled()
    expect(await read(null, 'settings.workflowActivities')).toMatchObject({ ok: true })
  })

  it('branding and the people pickers are open to every signed-in user', async () => {
    expect(await read([], 'settings.branding', { tenantId: 'tenant-a' })).toMatchObject({ ok: true })
    expect(await read([], 'settings.memberships')).toMatchObject({ ok: true })
    expect(await read([], 'settings.teamMembers', { teamId: 'te1' })).toMatchObject({ ok: true })
    expect(await read([], 'settings.tenantUsers')).toMatchObject({ ok: true })
  })

  it('validates arguments', async () => {
    expect(await read([], 'settings.branding', {})).toMatchObject({ ok: false, status: 400 })
    expect(await read(['settings.view'], 'settings.mcp', { tenantId: 7 })).toMatchObject({ ok: false, status: 400 })
    expect(await read([], 'settings.teamMembers', { teamId: '' })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('settings reads: data', () => {
  it('branding returns only the logo url', async () => {
    expect((await read([], 'settings.branding', { tenantId: 'tenant-a' }) as any).data).toEqual({ logoUrl: 'https://x/logo.png' })
    expect((await read([], 'settings.branding', { tenantId: 'tenant-z' }) as any).data).toEqual({ logoUrl: null })
  })

  it('MCP settings: newest unrevoked keys, tenant slug, servers', async () => {
    const { data } = await read(['settings.view'], 'settings.mcp', { tenantId: 'tenant-a' }) as any
    expect(data.apiKeys.map((k: any) => k.id)).toEqual(['k3', 'k1'])
    expect(data.tenantSlug).toBe('acme')
    expect(data.mcpServers).toMatchObject([{ id: 'm1' }])
  })

  it('api keys page returns every list the key editor needs', async () => {
    const { data } = await read(['settings.manage_api_keys'], 'settings.apiKeysPage') as any
    expect(data.apiKeys.map((k: any) => k.id)).toEqual(['k3', 'k2', 'k1'])
    expect(Object.keys(data).sort()).toEqual(['apiKeys', 'tables', 'users', 'webhooks', 'workflowSources', 'workflows'])
  })

  it('pending invitations only, newest first; dead letters capped at 50; teams by name', async () => {
    expect((await read(['team.invite'], 'settings.invitations') as any).data.map((i: any) => i.id)).toEqual(['i3', 'i1'])
    expect((await read(['settings.manage_webhooks'], 'settings.deadLetters') as any).data).toHaveLength(50)
    expect((await read(['team.view_members'], 'settings.teams') as any).data.map((t: any) => t.id)).toEqual(['te1', 'te2'])
    expect((await read(['extensibility.view'], 'settings.workflowActivities') as any).data.map((a: any) => a.id)).toEqual(['a2', 'a1'])
  })

  it('memberships are the signed-in user’s own active ones (ctx.actorId), home first', async () => {
    expect((await read([], 'settings.memberships') as any).data.map((m: any) => m.id)).toEqual(['mb2', 'mb1'])
    expect((await read([], 'settings.memberships', undefined, db(), 'user-2') as any).data.map((m: any) => m.id)).toEqual(['mb4'])
    expect((await read([], 'settings.memberships', undefined, db(), null) as any).data).toEqual([])
  })

  it('team members are filtered by team; tenant users exclude deleted ones', async () => {
    expect((await read([], 'settings.teamMembers', { teamId: 'te1' }) as any).data.map((m: any) => m.id)).toEqual(['ut1'])
    expect((await read([], 'settings.tenantUsers') as any).data.map((u: any) => u.id)).toEqual(['user-2', 'user-1'])
  })
})
