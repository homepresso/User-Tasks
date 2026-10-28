/**
 * Task effort + task UI mutations (lib/services/task-effort, lib/services/tasks)
 * and their session adapters: the writes the task views used to make from the
 * browser. Covers permission denied/allowed, tenant isolation, validation and
 * the effort/lifecycle rows they write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const session = vi.hoisted(() => ({ db: null as any, user: { id: 'user-1' } as { id: string } | null }))
vi.mock('@/lib/providers/db/session', () => ({
  getSessionDb: async () => session.db,
  getSessionDbWithUser: async () => ({ supabase: session.db, user: session.user }),
}))
vi.mock('@/lib/permissions-server', () => ({ getUserPermissions: async () => new Set(['tasks.complete']) }))

import type { ServiceContext } from '@/lib/services/context'
import { fromSession } from '@/lib/services/context'
import { fromSessionForTask } from '@/lib/actions/task-context'
import * as effort from '@/lib/services/task-effort'
import * as tasks from '@/lib/services/tasks'
import { createMemorySupabase } from './fixtures/supabase-memory'

function seed() {
  return createMemorySupabase({
    tasks: [
      { id: 'task-a', tenant_id: 'tenant-a', title: 'Root', status: 'todo', actual_effort: 30, metadata: { keep: true }, deleted_at: null, is_workflow_task: false, event_id: null },
      { id: 'sub-a', tenant_id: 'tenant-a', title: 'Child', status: 'todo', parent_task_id: 'task-a', deleted_at: null },
      { id: 'wf-task', tenant_id: 'tenant-a', title: 'Step', status: 'todo', deleted_at: null, is_workflow_task: true, event_id: 'evt-1' },
      { id: 'gone', tenant_id: 'tenant-a', title: 'Deleted', status: 'todo', deleted_at: '2026-01-01T00:00:00Z' },
      { id: 'task-b', tenant_id: 'tenant-b', title: 'Foreign', status: 'todo', actual_effort: 0, deleted_at: null },
    ],
    effort_records: [],
    lifecycle_events: [],
  })
}
type Db = ReturnType<typeof seed>

function ctx(db: Db, permissions: string[] = ['tasks.complete'], extra: Partial<ServiceContext> = {}): ServiceContext {
  return {
    db: db as any, supabase: db as any, tenantId: 'tenant-a', actorId: 'user-1',
    permissions: new Set(permissions), authKind: 'session', source: 'ui', ...extra,
  }
}

function row(memory: Db, id: string) {
  const found = memory.tables.tasks!.find((t: any) => t.id === id)
  if (!found) throw new Error(`no task ${id}`)
  return found
}

let db: Db
beforeEach(() => { db = seed() })

describe('task effort service', () => {
  it('logs manual effort: actual record, actual_effort total and a timeline event', async () => {
    const result = await effort.logManualEffort(ctx(db), 'task-a', { hours: 1.5, minutes: 10, notes: '', logDate: '2026-10-20', entryAt: '2026-10-20T09:00:00.000Z' })
    expect(result).toEqual({ minutes: 100, actual_effort: 130 })
    expect(db.tables.effort_records).toEqual([expect.objectContaining({
      tenant_id: 'tenant-a', task_id: 'task-a', user_id: 'user-1', record_type: 'actual', minutes: 100,
      notes: 'Manual: 1.5h 10m', created_at: '2026-10-20T09:00:00.000Z',
    })])
    expect(row(db, 'task-a').actual_effort).toBe(130)
    expect(db.tables.lifecycle_events).toEqual([expect.objectContaining({
      tenant_id: 'tenant-a', task_id: 'task-a', event_type: 'started', actor_id: 'user-1',
      metadata: { source: 'effort_log', minutes: 100, hours: '1.7', notes: null, log_date: '2026-10-20' },
    })])
  })

  it('logs a stopped timer with minutes rounded up and the formatted duration', async () => {
    const result = await effort.logTimerEntry(ctx(db), 'task-a', { elapsedSeconds: 3725, startedAt: '2026-10-20T08:00:00Z' })
    expect(result.minutes).toBe(63)
    expect(db.tables.effort_records[0]!).toMatchObject({ record_type: 'timer_entry', minutes: 63, notes: 'Timer: 1:02:05', timer_start: '2026-10-20T08:00:00.000Z' })
    expect(db.tables.lifecycle_events[0]!.metadata).toEqual({ source: 'timer_entry', minutes: 63, hours: '1.1', duration: '1:02:05' })
  })

  it('assignee estimates also keep an assignee_estimate record; assigner estimates do not', async () => {
    await effort.setEffortEstimate(ctx(db), 'task-a', 'assigner', 120)
    await effort.setEffortEstimate(ctx(db), 'task-a', 'assignee', 90)
    const task = row(db, 'task-a')
    expect(task).toMatchObject({ estimated_effort_assigner: 120, estimated_effort_assignee: 90 })
    expect(db.tables.effort_records).toEqual([expect.objectContaining({ record_type: 'assignee_estimate', minutes: 90, user_id: 'user-1' })])
    expect(db.tables.lifecycle_events.map((e: any) => e.metadata.source)).toEqual(['assigner_estimate', 'assignee_estimate'])
  })

  it('remaining effort merges into the stored metadata', async () => {
    await effort.setRemainingEffort(ctx(db), 'task-a', 45)
    expect(row(db, 'task-a').metadata).toMatchObject({ keep: true, remaining_effort_minutes: 45, remaining_effort_updated_by: 'user-1' })
    await effort.setRemainingEffort(ctx(db), 'task-a', null)
    expect(row(db, 'task-a').metadata.remaining_effort_minutes).toBeNull()
  })

  it('saves the inline work plan in one write', async () => {
    await effort.saveWorkPlan(ctx(db), 'task-a', { estimatedEffortAssigner: 60, estimatedEffortAssignee: null, remainingEffortMinutes: 20, estimatedCompletion: '2026-11-01T10:00:00Z' })
    expect(row(db, 'task-a')).toMatchObject({
      estimated_effort_assigner: 60, estimated_effort_assignee: null, estimated_completion: '2026-11-01T10:00:00.000Z',
      metadata: expect.objectContaining({ keep: true, remaining_effort_minutes: 20 }),
    })
    expect(db.tables.lifecycle_events[0]!.metadata.source).toBe('inline_work_plan')
  })

  it('denies without tasks.complete and writes nothing', async () => {
    await expect(effort.logManualEffort(ctx(db, ['tasks.view_own']), 'task-a', { minutes: 5 })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(effort.setEffortEstimate(ctx(db, []), 'task-a', 'assigner', 5)).rejects.toMatchObject({ code: 'forbidden' })
    expect(db.calls.filter((c) => c.op !== 'select')).toEqual([])
  })

  it('cannot reach another tenant\'s task or a deleted one', async () => {
    await expect(effort.logTimerEntry(ctx(db), 'task-b', { elapsedSeconds: 60 })).rejects.toMatchObject({ code: 'not_found' })
    await expect(effort.logManualEffort(ctx(db), 'gone', { minutes: 5 })).rejects.toMatchObject({ code: 'not_found' })
    expect(row(db, 'task-b').actual_effort).toBe(0)
  })

  it('validates minutes, timestamps and timer length', async () => {
    await expect(effort.logManualEffort(ctx(db), 'task-a', { hours: 0, minutes: 0 })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(effort.logManualEffort(ctx(db), 'task-a', { minutes: -5 })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(effort.logManualEffort(ctx(db), 'task-a', { minutes: 5, entryAt: 'not a date' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(effort.logTimerEntry(ctx(db), 'task-a', { elapsedSeconds: 0 })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(effort.setEffortEstimate(ctx(db), 'task-a', 'assigner', 1.5)).rejects.toMatchObject({ code: 'validation_error' })
    await expect(effort.setEffortEstimate(ctx(db), 'task-a', 'other' as any, 5)).rejects.toMatchObject({ code: 'validation_error' })
  })
})

describe('task UI mutations', () => {
  it('completes a standard task with outcome, notes and a completed event', async () => {
    await tasks.completeStandardTask(ctx(db), 'task-a', { outcome: 'approved', notes: 'ok' })
    expect(row(db, 'task-a')).toMatchObject({ status: 'completed', outcome: 'approved', outcome_notes: 'ok' })
    expect(db.tables.lifecycle_events[0]!).toMatchObject({ event_type: 'completed', metadata: { outcome: 'approved', notes: 'ok' } })
  })

  it('refuses workflow tasks (they complete through their workflow step)', async () => {
    await expect(tasks.completeStandardTask(ctx(db), 'wf-task', { outcome: 'completed' })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('reopens a task and clears its outcome', async () => {
    await tasks.completeStandardTask(ctx(db), 'task-a', { outcome: 'done' })
    await tasks.reopenTask(ctx(db), 'task-a')
    expect(row(db, 'task-a')).toMatchObject({ status: 'todo', outcome: null, outcome_notes: null })
  })

  it('toggles a subtask and logs it on the root task when asked', async () => {
    await tasks.setSubtaskCompleted(ctx(db), 'sub-a', true, { logToTaskId: 'task-a' })
    const sub = row(db, 'sub-a')
    expect(sub.status).toBe('completed')
    expect(sub.completed_at).toEqual(expect.any(String))
    expect(db.tables.lifecycle_events[0]!).toMatchObject({ task_id: 'task-a', event_type: 'completed', metadata: { subtask_id: 'sub-a', subtask_title: 'Child', source: 'subtask_toggle' } })
    await tasks.setSubtaskCompleted(ctx(db), 'sub-a', false)
    expect(row(db, 'sub-a')).toMatchObject({ status: 'todo', completed_at: null })
    expect(db.tables.lifecycle_events).toHaveLength(1)
  })

  it('posts comments; empty ones are refused', async () => {
    await tasks.addTaskComment(ctx(db), 'task-a', '  hello  ')
    expect(db.tables.lifecycle_events[0]!).toMatchObject({ event_type: 'comment_added', actor_id: 'user-1', metadata: { message: 'hello', source: 'user' } })
    await expect(tasks.addTaskComment(ctx(db), 'task-a', '   ')).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('denies without tasks.complete and isolates tenants', async () => {
    await expect(tasks.reopenTask(ctx(db, []), 'task-a')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(tasks.addTaskComment(ctx(db, []), 'task-a', 'x')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(tasks.completeStandardTask(ctx(db), 'task-b', { outcome: 'done' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(tasks.setSubtaskCompleted(ctx(db), 'sub-a', true, { logToTaskId: 'task-b' })).rejects.toMatchObject({ code: 'not_found' })
    expect(row(db, 'task-b').status).toBe('todo')
  })
})

describe('session contexts for a task\'s workspace', () => {
  function sessionDb(memberOf: string[], perms: Record<string, string[]>) {
    const memory = seed() as any
    memory.rpc = vi.fn(async (name: string, args?: any) => {
      if (name === 'get_user_tenant_ids') return { data: memberOf, error: null }
      if (name === 'get_user_permissions') return { data: perms[args?.p_tenant_id] ?? [], error: null }
      return { data: null, error: { message: `unexpected rpc ${name}` } }
    })
    return memory
  }

  it('acts in the task\'s tenant with the permissions held there', async () => {
    session.db = sessionDb(['tenant-a', 'tenant-b'], { 'tenant-b': ['tasks.complete', 'tasks.view_all'] })
    session.user = { id: 'user-1' }
    const c = await fromSessionForTask('task-b')
    expect(c).toMatchObject({ tenantId: 'tenant-b', actorId: 'user-1', authKind: 'session', source: 'ui' })
    expect([...(c.permissions ?? [])]).toEqual(['tasks.complete', 'tasks.view_all'])
    expect(session.db.rpc).toHaveBeenCalledWith('get_user_permissions', { p_tenant_id: 'tenant-b' })
  })

  it('refuses a workspace the user is not a member of', async () => {
    session.db = sessionDb(['tenant-a'], {})
    session.user = { id: 'user-1' }
    await expect(fromSession({ tenantId: 'tenant-b' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(fromSessionForTask('task-b')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses unknown tasks and signed-out users', async () => {
    session.db = sessionDb(['tenant-a'], {})
    await expect(fromSessionForTask('missing')).rejects.toMatchObject({ code: 'not_found' })
    session.user = null
    await expect(fromSession({ tenantId: 'tenant-a' })).rejects.toMatchObject({ code: 'unauthorized' })
  })
})
