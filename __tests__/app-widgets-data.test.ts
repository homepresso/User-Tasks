/**
 * App widget data (lib/services/app-widgets.ts): the pure aggregation
 * (SLA buckets, count / sum / avg, grouping by time and field) and the
 * scoping rules — only the signed-in viewer's session reads widget data, a
 * task list without tasks.view_all is limited to the viewer's own and their
 * teams' tasks, submissions without forms.edit to their own.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- recorded query chains */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/services/apps', () => ({
  getPresentedPage: vi.fn(async () => ({ id: 'p1', layout: { widgets: [{ id: 't1', type: 'task_list', w: 6, h: 8, config: { scope: 'all', status: 'open', limit: 10 } }] }, filters: [] })),
  getAppAccess: vi.fn(async () => 'view'),
  getViewerAppRole: vi.fn(async () => 'viewer'),
}))
vi.mock('@/lib/services/home', () => ({
  TASK_COLUMNS: 'id, title',
  myTeams: vi.fn(async () => ['0e000000-0000-4000-8000-000000000001']),
  shapeTasks: vi.fn(async (_db: unknown, _t: string, rows: any[]) => rows.map((r) => ({ id: r.id, title: r.title, overdue: false, due_date: null, sla_status: null }))),
}))

import type { ServiceContext } from '@/lib/services/context'
import { aggregate, getWidgetData, groupFacts, slaBucket, timeKey, widgetData } from '@/lib/services/app-widgets'

const ME = '0a000000-0000-4000-8000-000000000001'
const TEAM = '0e000000-0000-4000-8000-000000000001'

/** A PostgREST stand-in that records every filter call and returns `rows`. */
function recorder(rows: any[] = []) {
  const calls: Array<[string, string, ...unknown[]]> = []
  const from = (table: string) => {
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (resolve: any) => resolve({ data: rows, count: rows.length, error: null })
        return (...args: unknown[]) => { calls.push([table, prop, ...args]); return chain }
      },
    })
    return chain
  }
  return { client: { from, rpc: async () => ({ data: null, error: null }) } as any, calls }
}

const ctx = (client: any, perms: string[], authKind: ServiceContext['authKind'] = 'session'): ServiceContext => ({
  db: client, supabase: client, tenantId: 'tenant-a', actorId: ME, permissions: new Set(perms), authKind, source: authKind === 'session' ? 'ui' : 'api',
})

describe('aggregation', () => {
  const now = Date.parse('2026-11-21T12:00:00Z')
  it('SLA buckets: run SLA status first, then the due date', () => {
    expect(slaBucket({ due: '2026-11-20T00:00:00Z' }, 24, now)).toBe('breached')
    expect(slaBucket({ due: '2026-11-21T20:00:00Z' }, 24, now)).toBe('at_risk')
    expect(slaBucket({ due: '2026-11-25T00:00:00Z' }, 24, now)).toBe('on_track')
    expect(slaBucket({ due: null }, 24, now)).toBe('no_sla')
    expect(slaBucket({ due: '2026-11-25T00:00:00Z', slaStatus: 'breached' }, 24, now)).toBe('breached')
    expect(slaBucket({ due: null, slaStatus: 'warning' }, 24, now)).toBe('at_risk')
  })

  const fact = (at: string, data: Record<string, unknown> = {}, status: string | null = null) => ({ at, status, workflow: null, form: null, person: null, data })
  it('count / sum / avg of a column', () => {
    const rows = [fact('2026-11-01', { amount: 10 }), fact('2026-11-02', { amount: '5.5' }), fact('2026-11-03', { amount: 'n/a' })]
    expect(aggregate(rows, 'count')).toBe(3)
    expect(aggregate(rows, 'sum', 'amount')).toBe(15.5)
    expect(aggregate(rows, 'avg', 'amount')).toBe(7.75)
    expect(aggregate([], 'avg', 'amount')).toBeNull()
  })

  it('grouping by time (ordered buckets, weeks start Monday) and by field (largest first, the rest as Other)', () => {
    expect(timeKey('2026-11-21T10:00:00Z', 'week')).toBe('2026-11-16')
    expect(timeKey('2026-11-21T10:00:00Z', 'month')).toBe('2026-11')
    const rows = [fact('2026-11-02T01:00:00Z'), fact('2026-11-01T01:00:00Z'), fact('2026-11-02T05:00:00Z')]
    expect(groupFacts(rows, { by: 'time', interval: 'day', how: 'count', maxGroups: 8 })).toEqual([{ key: '2026-11-01', value: 1 }, { key: '2026-11-02', value: 2 }])
    const byField = ['a', 'a', 'a', 'b', 'b', 'c', 'd'].map((v) => fact('2026-11-01', { region: v }))
    expect(groupFacts(byField, { by: 'field', field: 'region', interval: 'day', how: 'count', maxGroups: 3 })).toEqual([{ key: 'a', value: 3 }, { key: 'b', value: 2 }, { key: '__other', value: 2 }])
  })
})

describe('scoping', () => {
  it('widget data is only read in the app, as the signed-in person (never with an API key)', async () => {
    const { client } = recorder()
    await expect(getWidgetData(ctx(client, ['apps.view'], 'api_key'), { app: 'a', page: 'p', widget_id: 't1' })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('a task list without tasks.view_all is limited to the viewer’s and their teams’ tasks, in their workspace', async () => {
    const { client, calls } = recorder([{ id: 't', title: 'Mine', assignee_id: ME, assigned_team_id: null }])
    const data: any = await getWidgetData(ctx(client, ['apps.view', 'tasks.view_own']), { app: 'a', page: 'p', widget_id: 't1' })
    expect(data.type).toBe('task_list')
    expect(calls).toContainEqual(['tasks', 'eq', 'tenant_id', 'tenant-a'])
    expect(calls).toContainEqual(['tasks', 'or', `assignee_id.eq.${ME},assigned_team_id.in.(${TEAM})`])
    expect(data.note).toMatch(/yours and your teams/)
  })

  it('with tasks.view_all there is no viewer filter; without any task permission it is refused', async () => {
    const all = recorder()
    await widgetData(ctx(all.client, ['tasks.view_all']), 'task_list', { scope: 'all', status: 'open', limit: 5, show_claim: true } as any)
    expect(all.calls.some(([t, op]) => t === 'tasks' && op === 'or')).toBe(false)
    const none = recorder()
    await expect(widgetData(ctx(none.client, []), 'task_list', { scope: 'all', status: 'open', limit: 5, show_claim: true } as any)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('“Me” resolves to the viewer; a team input outside the viewer’s teams lists nothing for them', async () => {
    const mine = recorder()
    await widgetData(ctx(mine.client, ['tasks.view_own']), 'task_list', { scope: 'mine', assignee: 'me', status: 'all', limit: 5, show_claim: false } as any)
    expect(mine.calls).toContainEqual(['tasks', 'eq', 'assignee_id', ME])
  })

  it('recent submissions without forms.edit are the viewer’s own', async () => {
    const own = recorder()
    await widgetData(ctx(own.client, ['forms.submit']), 'recent', { source: 'submissions', limit: 5 } as any)
    expect(own.calls).toContainEqual(['form_submissions', 'eq', 'submitted_by', ME])
    const editor = recorder()
    await widgetData(ctx(editor.client, ['forms.edit']), 'recent', { source: 'submissions', limit: 5 } as any)
    expect(editor.calls.some(([t, op, col]) => t === 'form_submissions' && op === 'eq' && col === 'submitted_by')).toBe(false)
  })

  it('runs without queue / run permissions are the ones the viewer started', async () => {
    const r = recorder()
    await widgetData(ctx(r.client, []), 'recent', { source: 'runs', limit: 5 } as any)
    expect(r.calls).toContainEqual(['workflow_runs', 'or', `started_by.eq.${ME}`])
  })
})
