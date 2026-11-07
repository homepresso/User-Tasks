/**
 * Services and actions that replace the browser's remaining RPCs and the
 * notification writes (providers phase 2c): notifications, activity reads,
 * workflow report analytics and the session access +
 * workspace switch actions. Allowed/denied and user/tenant isolation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const session = vi.hoisted(() => ({ db: null as any, user: { id: 'user-1' } as { id: string } | null }))
vi.mock('@/lib/providers/db/session', () => ({
  getSessionDb: async () => session.db,
  getSessionDbWithUser: async () => ({ supabase: session.db, user: session.user }),
}))

import type { ServiceContext } from '@/lib/services/context'
import * as notifications from '@/lib/services/notifications'
import * as activity from '@/lib/services/activity'
import * as analytics from '@/lib/services/report-analytics'
import { getMyAccess, switchWorkspace } from '@/app/actions/session'
import { createMemorySupabase } from './fixtures/supabase-memory'

function withRpc(memory: any, handlers: Record<string, (args: any) => unknown>) {
  memory.rpc = vi.fn(async (name: string, args?: any) => {
    const handler = handlers[name]
    if (!handler) return { data: null, error: { message: `unexpected rpc ${name}` } }
    const out = handler(args)
    return out instanceof Error ? { data: null, error: { message: out.message } } : { data: out, error: null }
  })
  return memory
}

function ctx(db: any, permissions: string[], extra: Partial<ServiceContext> = {}): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'session', source: 'ui', ...extra }
}

describe('notifications', () => {
  let db: any
  beforeEach(() => {
    db = createMemorySupabase({
      notifications: [
        { id: 'n1', user_id: 'user-1', is_read: false, created_at: '2026-10-01' },
        { id: 'n2', user_id: 'user-1', is_read: false, created_at: '2026-10-03' },
        { id: 'n3', user_id: 'user-2', is_read: false, created_at: '2026-10-02' },
      ],
    })
  })

  it('lists only the caller\'s notifications, newest first', async () => {
    expect((await notifications.listNotifications(ctx(db, []))).map((n) => n.id)).toEqual(['n2', 'n1'])
  })

  it('marks read / unread only the caller\'s own notifications', async () => {
    expect(await notifications.setNotificationsRead(ctx(db, []), ['n1', 'n3'], true)).toEqual({ updated: 1 })
    expect(db.tables.notifications.map((n: any) => n.is_read)).toEqual([true, false, false])
    await notifications.setNotificationsRead(ctx(db, []), ['n1'], false)
    expect(db.tables.notifications[0].is_read).toBe(false)
  })

  it('marks all of the caller\'s unread notifications read', async () => {
    expect(await notifications.markAllNotificationsRead(ctx(db, []))).toEqual({ updated: 2 })
    expect(db.tables.notifications.find((n: any) => n.id === 'n3').is_read).toBe(false)
  })

  it('deletes only the caller\'s notifications and needs a user', async () => {
    expect(await notifications.deleteNotifications(ctx(db, []), ['n1', 'n3'])).toEqual({ deleted: 1, ids: ['n1'] })
    expect(db.tables.notifications.map((n: any) => n.id)).toEqual(['n2', 'n3'])
    await expect(notifications.listNotifications(ctx(db, [], { actorId: null }))).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('activity reads', () => {
  const db = createMemorySupabase({
    lifecycle_events: [
      { id: 'e1', task_id: 'task-a', tenant_id: 'tenant-a', created_at: '1' },
      { id: 'e2', task_id: 'task-a', tenant_id: 'tenant-b', created_at: '2' },
    ],
    object_audit_log: [
      { id: 'a1', tenant_id: 'tenant-a', object_type: 'workflow', action: 'create', created_at: '1' },
      { id: 'a2', tenant_id: 'tenant-a', object_type: 'report', action: 'update', created_at: '2' },
      { id: 'a3', tenant_id: 'tenant-b', object_type: 'workflow', action: 'create', created_at: '3' },
    ],
  })

  it('task events: tenant-scoped, needs a task view permission', async () => {
    expect((await activity.listTaskEvents(ctx(db, ['tasks.view_own']), 'task-a')).map((e) => e.id)).toEqual(['e1'])
    await expect(activity.listTaskEvents(ctx(db, []), 'task-a')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('audit feed: settings.view, tenant-scoped, filters and exact total', async () => {
    const all = await activity.listAuditActivity(ctx(db, ['settings.view']))
    expect(all).toMatchObject({ total: 2 })
    expect(all.rows.map((r) => r.id)).toEqual(['a2', 'a1'])
    expect((await activity.listAuditActivity(ctx(db, ['settings.view']), { objectType: 'workflow' })).rows.map((r) => r.id)).toEqual(['a1'])
    await expect(activity.listAuditActivity(ctx(db, ['tasks.view_own']))).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('report analytics', () => {
  it('passes the same arguments the views sent, under workflows.view_runs', async () => {
    const db = withRpc(createMemorySupabase(), {
      workflow_run_daily_stats: () => [{ workflow_id: 'w1', day: '2026-10-01', runs: 2 }],
      workflow_run_duration_stats: () => [],
      workflow_run_summaries: () => [{ id: 'r1' }],
      workflow_node_visit_stats: () => [{ workflow_id: 'w1', node_id: 'n1', visits: 3 }],
    })
    const c = ctx(db, ['workflows.view_runs'])
    expect(await analytics.runDailyStats(c, { since: '2026-05-01T00:00:00.000Z' })).toHaveLength(1)
    expect(db.rpc).toHaveBeenLastCalledWith('workflow_run_daily_stats', { p_since: '2026-05-01T00:00:00.000Z' })
    await analytics.runDurationStats(c, { since: '2026-05-01T00:00:00Z', workflowIds: ['w1'] })
    expect(db.rpc).toHaveBeenLastCalledWith('workflow_run_duration_stats', { p_since: '2026-05-01T00:00:00.000Z', p_workflow_ids: ['w1'] })
    await analytics.runSummaries(c, { workflowIds: ['w1'], limit: 2000 })
    expect(db.rpc).toHaveBeenLastCalledWith('workflow_run_summaries', { p_workflow_ids: ['w1'], p_limit: 2000 })
    await analytics.nodeVisitStats(c, { workflowIds: ['w1', 'w2'], since: '2026-05-01T00:00:00Z', limit: 99999 })
    expect(db.rpc).toHaveBeenLastCalledWith('workflow_node_visit_stats', { p_workflow_ids: ['w1', 'w2'], p_since: '2026-05-01T00:00:00.000Z', p_limit: 5000 })
  })

  it('denies without workflows.view_runs (reports.view alone is not enough: workspace-wide run analytics) and validates input', async () => {
    const db = withRpc(createMemorySupabase(), {})
    await expect(analytics.runDailyStats(ctx(db, ['workflows.view']), { since: '2026-05-01' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(analytics.runDailyStats(ctx(db, ['reports.view']), { since: '2026-05-01' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(analytics.runDailyStats(ctx(db, ['workflows.view_runs']), { since: 'yesterday' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(analytics.runSummaries(ctx(db, ['workflows.view_runs']), { workflowIds: 'w1' as any })).rejects.toMatchObject({ code: 'validation_error' })
    expect(db.rpc).not.toHaveBeenCalled()
  })
})

describe('session actions', () => {
  it('getMyAccess returns the role and permission keys from the database functions', async () => {
    session.user = { id: 'user-1' }
    session.db = withRpc(createMemorySupabase(), { get_user_role_in_tenant: () => 'admin', get_user_permissions: () => ['tasks.view_own'] })
    expect(await getMyAccess()).toEqual({ ok: true, data: { role: 'admin', permissions: ['tasks.view_own'] } })
    session.db = withRpc(createMemorySupabase(), { get_user_role_in_tenant: () => new Error('boom'), get_user_permissions: () => new Error('boom') })
    expect(await getMyAccess()).toEqual({ ok: true, data: { role: null, permissions: [] } })
  })

  it('switchWorkspace reports the membership refusal and needs a session', async () => {
    session.user = { id: 'user-1' }
    session.db = withRpc(createMemorySupabase(), { switch_tenant: (args) => args.p_tenant_id === 'tenant-x' ? new Error('Not a member of this tenant') : null })
    expect(await switchWorkspace('tenant-a')).toEqual({ ok: true, data: null })
    expect(await switchWorkspace(null)).toEqual({ ok: true, data: null })
    expect(await switchWorkspace('tenant-x')).toEqual({ ok: false, error: 'Not a member of this tenant' })
    session.user = null
    expect(await getMyAccess()).toEqual({ ok: false, error: 'Not authenticated' })
  })
})
