/**
 * Designer test runs left waiting after the Test runner closed
 * (lib/workflow-test-runs.ts): only test runs (`workflow_started_via` =
 * test) are cancelled — never a production run — scoped by tenant /
 * workflow / starter / age; their open tasks are cancelled too; the daily
 * cleanup cancels test runs paused for more than 24h.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */
import { describe, expect, it } from 'vitest'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { cancelStaleTestRuns, cancelWaitingTestRuns, isDesignerTestRun, TEST_RUN_CLOSED_ERROR } from '@/lib/workflow-test-runs'

const HOUR = 3_600_000
const NOW = new Date('2026-10-28T12:00:00Z')
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString()
const testVars = (by: string) => ({ workflow_started_via: 'test', workflow_started_by: by })

function seed() {
  return createMemorySupabase({
    workflow_runs: [
      { id: 'test-mine', tenant_id: 'ta', workflow_id: 'wf', status: 'waiting_for_event', event_id: 'ev1', paused_at: ago(1), pause_variables: testVars('me') },
      { id: 'test-other-user', tenant_id: 'ta', workflow_id: 'wf', status: 'waiting_for_event', event_id: 'ev2', paused_at: ago(1), pause_variables: testVars('you') },
      { id: 'test-other-wf', tenant_id: 'ta', workflow_id: 'wf2', status: 'paused', event_id: 'ev3', paused_at: ago(30), pause_variables: testVars('me') },
      { id: 'test-other-tenant', tenant_id: 'tb', workflow_id: 'wf', status: 'waiting_for_event', event_id: 'ev4', paused_at: ago(30), pause_variables: testVars('me') },
      { id: 'prod', tenant_id: 'ta', workflow_id: 'wf', status: 'waiting_for_event', event_id: 'ev5', paused_at: ago(48), pause_variables: { workflow_started_via: 'ui', workflow_started_by: 'me' } },
      { id: 'test-done', tenant_id: 'ta', workflow_id: 'wf', status: 'completed', event_id: null, paused_at: null, pause_variables: null },
    ],
    tasks: [
      { id: 'task-of-test', tenant_id: 'ta', event_id: 'ev1', status: 'todo' },
      { id: 'task-of-test-done', tenant_id: 'ta', event_id: 'ev1', status: 'completed' },
      { id: 'task-of-prod', tenant_id: 'ta', event_id: 'ev5', status: 'todo' },
    ],
  })
}

describe('cancelling waiting designer test runs', () => {
  it('recognises test runs by their engine-owned pause variables', () => {
    expect(isDesignerTestRun({ pause_variables: testVars('me') })).toBe(true)
    expect(isDesignerTestRun({ pause_variables: { workflow_started_via: 'ui' } })).toBe(false)
    expect(isDesignerTestRun({ pause_variables: null })).toBe(false)
    expect(isDesignerTestRun(null)).toBe(false)
  })

  it('cancels only the caller\'s own waiting test runs of the workflow, and their open tasks', async () => {
    const db = seed()
    const res = await cancelWaitingTestRuns(db as any, { tenantId: 'ta', workflowId: 'wf', startedBy: 'me' })
    expect(res).toEqual({ runs: ['test-mine'], tasks: ['task-of-test'] })
    const runs = Object.fromEntries(db.tables.workflow_runs.map((r: any) => [r.id, r]))
    expect(runs['test-mine']).toMatchObject({ status: 'failed', error: TEST_RUN_CLOSED_ERROR, event_id: null, pause_variables: null, paused_at: null })
    for (const id of ['test-other-user', 'test-other-wf', 'test-other-tenant', 'prod']) expect(runs[id].status).not.toBe('failed')
    const tasks = Object.fromEntries(db.tables.tasks.map((t: any) => [t.id, t.status]))
    expect(tasks).toEqual({ 'task-of-test': 'cancelled', 'task-of-test-done': 'completed', 'task-of-prod': 'todo' })
  })

  it('housekeeping: test runs paused for more than 24h, any tenant — never production runs', async () => {
    const db = seed()
    const res = await cancelStaleTestRuns(db as any, NOW)
    expect(res.runs.sort()).toEqual(['test-other-tenant', 'test-other-wf'])
    const prod = db.tables.workflow_runs.find((r: any) => r.id === 'prod')
    expect(prod).toMatchObject({ status: 'waiting_for_event', event_id: 'ev5' })
    expect(db.tables.tasks.find((t: any) => t.id === 'task-of-prod')?.status).toBe('todo')
  })
})
