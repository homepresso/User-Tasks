/**
 * Permission scoping of the widget rollup reads (lib/services/app-widget-rollups.ts):
 * a viewer limited to some workflows never gets counts of the others (the
 * workflow filter is applied before summing, in the RPC arguments); a scope
 * that includes runs the person is merely involved in falls back to the
 * live path; Real time mode never touches the rollups; task scope is passed
 * as user + teams.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const scope = vi.hoisted(() => ({ value: { kind: 'all' } as any })) // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock('@/lib/services/run-visibility', () => ({ resolveRunScope: async () => scope.value, runScopeFilter: () => null }))
vi.mock('@/lib/services/query-settings-loader', () => ({}))
vi.mock('@/lib/services/home', () => ({ myTeams: async () => ['5f2504e0-4f89-41d3-9a0c-0305e82c3301'], shapeTasks: async () => [], TASK_COLUMNS: 'id' }))

import { rollupFacts, withWidgetDataSource } from '@/lib/services/app-widget-rollups'
import { setRollupCacheStoreForTests } from '@/lib/report-rollups/cache'
import { resetRollupAvailability } from '@/lib/services/report-rollups'
import type { ServiceContext } from '@/lib/services/context'

const ME = '1f2504e0-4f89-41d3-9a0c-0305e82c3301'
const A = '2f2504e0-4f89-41d3-9a0c-0305e82c3301'
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const C = '4f2504e0-4f89-41d3-9a0c-0305e82c3301'

/** Rollup rows of three workflows; the fake RPC filters by p_workflow_ids like the SQL does. */
const ROWS: Record<string, number> = { [A]: 3, [B]: 5, [C]: 7 }
function makeCtx(perms: string[]) {
  const calls: Array<{ fn: string; args: any }> = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  const supabase = {
    rpc: async (fn: string, args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      calls.push({ fn, args })
      if (fn === 'report_rollup_tenant_freshness') return { data: { installed: true, done: true, dirty_ranges: 0 }, error: null }
      if (fn === 'report_rollup_run_days') {
        const ids: string[] | null = args.p_workflow_ids
        const cols = ['workflow_id', 'day', 'runs', 'st_completed']
        const rows = Object.entries(ROWS).filter(([w]) => !ids || ids.includes(w)).map(([w, n]) => [w, '2026-11-20', n, n])
        return { data: { ok: true, cols, rows }, error: null }
      }
      if (fn === 'report_rollup_task_days') return { data: { ok: true, cols: ['day', 'workflow_id', 'assignee_id', 'cr_total', 'cr_todo'], rows: [['2026-11-20', null, null, 2, 2]] }, error: null }
      return { data: null, error: { message: 'unexpected', code: 'XX000' } }
    },
  }
  const ctx = { supabase, tenantId: 't-scope', actorId: ME, permissions: new Set(perms), authKind: 'session', source: 'ui' } as unknown as ServiceContext
  return { ctx, calls }
}
const ds = (mode: 'auto' | 'rollup' | 'live') => ({ service: 'app_widgets' as const, mode, level: 'workspace' as const, cacheTtlMs: 0 })
const range = { from: new Date('2026-11-01T00:00:00Z'), to: null }
const total = (rows: Array<{ n?: number }>) => rows.reduce((a, r) => a + (r.n ?? 1), 0)

describe('widget rollup scoping', () => {
  beforeEach(() => {
    resetRollupAvailability()
    setRollupCacheStoreForTests(null)
    scope.value = { kind: 'all' }
  })

  it('view_runs: every workflow', async () => {
    const { ctx } = makeCtx(['workflows.view_runs'])
    const r = await rollupFacts(withWidgetDataSource(ctx, ds('auto')), 'runs', {}, range, ['workflow'])
    expect(total(r!.rows)).toBe(15)
  })

  it('view_queue with granted workflows only: other workflows never counted, filtered before summing', async () => {
    scope.value = { kind: 'scoped', userId: ME, workflowIds: [A], runIds: [] }
    const { ctx, calls } = makeCtx(['workflows.view_queue'])
    const r = await rollupFacts(withWidgetDataSource(ctx, ds('rollup')), 'runs', {}, range, ['workflow'])
    expect(total(r!.rows)).toBe(3)
    expect(new Set(r!.rows.map((f) => f.workflow))).toEqual(new Set([A]))
    expect(calls.find((c) => c.fn === 'report_rollup_run_days')!.args.p_workflow_ids).toEqual([A])
    // Asking for a workflow outside the grant returns nothing (no RPC at all).
    const before = calls.length
    const other = await rollupFacts(withWidgetDataSource(ctx, ds('rollup')), 'runs', { workflow_id: B }, range, ['workflow'])
    expect(other).toEqual({ rows: [], truncated: false })
    expect(calls.slice(before).some((c) => c.fn === 'report_rollup_run_days')).toBe(false)
  })

  it('a scope with involved runs (per run, not per workflow) falls back to the live path', async () => {
    scope.value = { kind: 'scoped', userId: ME, workflowIds: [A], runIds: ['9f2504e0-4f89-41d3-9a0c-0305e82c3301'] }
    const { ctx } = makeCtx(['workflows.view_queue'])
    expect(await rollupFacts(withWidgetDataSource(ctx, ds('rollup')), 'runs', {}, range, ['workflow'])).toBeNull()
  })

  it('own runs only (no queue permission) and person filters fall back to the live path', async () => {
    const { ctx } = makeCtx([])
    expect(await rollupFacts(withWidgetDataSource(ctx, ds('rollup')), 'runs', {}, range, [])).toBeNull()
    const { ctx: admin } = makeCtx(['workflows.view_runs'])
    expect(await rollupFacts(withWidgetDataSource(admin, ds('rollup')), 'runs', { person: 'me' }, range, [])).toBeNull()
    expect(await rollupFacts(withWidgetDataSource(admin, ds('rollup')), 'runs', {}, range, ['assignee'])).toBeNull()
  })

  it('Real time mode never reads the rollups', async () => {
    const { ctx, calls } = makeCtx(['workflows.view_runs'])
    expect(await rollupFacts(withWidgetDataSource(ctx, ds('live')), 'runs', {}, range, [])).toBeNull()
    expect(calls).toEqual([])
  })

  it('tasks: a viewer without view_all is scoped to themselves and their teams', async () => {
    const { ctx, calls } = makeCtx(['tasks.view_own'])
    const r = await rollupFacts(withWidgetDataSource(ctx, ds('rollup')), 'tasks', {}, range, ['status'])
    expect(total(r!.rows)).toBe(2)
    const args = calls.find((c) => c.fn === 'report_rollup_task_days')!.args
    expect(args.p_scope_user).toBe(ME)
    expect(args.p_scope_teams).toEqual(['5f2504e0-4f89-41d3-9a0c-0305e82c3301'])
    const { ctx: all, calls: allCalls } = makeCtx(['tasks.view_all'])
    await rollupFacts(withWidgetDataSource(all, ds('rollup')), 'tasks', {}, range, [])
    expect(allCalls.find((c) => c.fn === 'report_rollup_task_days')!.args.p_scope_user).toBeNull()
  })

  it('submissions need forms.edit (own-only viewers read live)', async () => {
    const { ctx } = makeCtx(['forms.view'])
    expect(await rollupFacts(withWidgetDataSource(ctx, ds('rollup')), 'submissions', {}, range, [])).toBeNull()
  })
})
