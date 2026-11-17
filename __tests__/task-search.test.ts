/**
 * lib/services/task-search.ts — the one server-side search behind the app's
 * Completed / All views (tasks.search) and the embeddable task list.
 */
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => undefined), logObjectAudit: vi.fn(async () => undefined) }))
import { createMemorySupabase } from './fixtures/supabase-memory'
import type { ServiceContext } from '@/lib/services/context'
import { decodeCursor, encodeCursor, keysetClause, searchTasks, SEARCH_COUNT_CAP } from '@/lib/services/task-search'
import { runUiRead } from '@/lib/services/ui-reads'
import { doneWindow } from '@/lib/embed/task-list'

const T = '11111111-1111-4111-8111-111111111111'
const ME = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const base = { tenant_id: T, deleted_at: null, parent_task_id: null, priority: 'medium', is_workflow_task: true, acceptance_status: 'accepted', workflow_id: null, workflow_run_id: null, workflow_step_id: null, metadata: {}, assigned_team_id: null, event_id: null, due_date: null, actioned_by: null }

function seed() {
  const db = createMemorySupabase({
    tasks: [
      { ...base, id: id(1), title: 'Open one', status: 'todo', assignee_id: ME, created_at: '2026-11-01T00:00:00Z', completed_at: null },
      { ...base, id: id(2), title: 'Done by me', status: 'completed', assignee_id: ME, outcome: 'approved', created_at: '2026-10-01T00:00:00Z', completed_at: '2026-11-10T00:00:00Z' },
      // Completed by me, now assigned to someone else (reassigned after): still "completed by me".
      { ...base, id: id(3), title: 'Actioned by me', status: 'completed', assignee_id: OTHER, actioned_by: ME, outcome: 'rejected', created_at: '2026-09-01T00:00:00Z', completed_at: '2026-08-01T00:00:00Z' },
      { ...base, id: id(4), title: 'Not mine', status: 'completed', assignee_id: OTHER, created_at: '2026-09-02T00:00:00Z', completed_at: '2026-11-12T00:00:00Z' },
    ],
    user_teams: [], teams: [], users: [{ id: ME, team_id: null }], task_assignees: [], workflows: [], workflow_runs: [], workflow_versions: [], object_audit_log: [], audit_logs: [],
  }, { uuids: true }) as any
  db.rpc = async () => ({ data: [], error: null })
  db.orFilters = [] as string[]
  const from = db.from.bind(db)
  db.from = (table: string) => {
    const q = from(table)
    if (table !== 'tasks') return q
    const wrap = (api: any): any => new Proxy(api, { get(target, prop) {
      const v = target[prop]
      if (prop === 'or') return (expr: string) => { db.orFilters.push(expr); return wrap(target) }
      return typeof v === 'function' ? (...a: unknown[]) => { const r = v.apply(target, a); return r === target ? wrap(target) : r } : v
    } })
    return wrap(q)
  }
  return db
}
const ctx = (db: any, perms = ['tasks.view_own', 'tasks.complete']): ServiceContext => ({ supabase: db, tenantId: T, actorId: ME, permissions: new Set(perms), authKind: 'api_key', source: 'api' } as unknown as ServiceContext)
const input = (patch: Record<string, unknown> = {}) => ({ tab: 'mine' as const, status: 'completed' as const, sort: 'completed' as const, dir: 'desc' as const, size: 25, columns: 'id, title, status, completed_at, outcome, assignee_id', ...patch })

describe('searchTasks: completed tasks', () => {
  it('My tasks · Completed: mine and the ones I completed (actioned_by), newest completed first', async () => {
    const db = seed()
    const r = await searchTasks(ctx(db), input())
    expect(db.orFilters[0]).toContain(`actioned_by.eq.${ME}`)
    expect(r.rows.every((t) => t.status === 'completed')).toBe(true)
    expect(r.rows.map((t) => t.completed_at)).toEqual([...r.rows.map((t) => t.completed_at)].sort().reverse())
  })
  it('the completed window narrows on completed_at', async () => {
    const db = seed()
    const r = await searchTasks(ctx(db), input({ completed: doneWindow({ done: '30', doneFrom: null, doneTo: null }, new Date('2026-11-15T00:00:00Z')) }))
    expect(r.rows.map((t) => t.id)).not.toContain(id(3))
    expect(r.rows.map((t) => t.id)).toContain(id(2))
  })
  it('status any keeps open and completed; open keeps open only', async () => {
    const db = seed()
    expect((await searchTasks(ctx(db), input({ status: 'any', sort: 'created', dir: 'asc' }))).rows.map((t) => t.status)).toEqual(expect.arrayContaining(['todo', 'completed']))
    expect((await searchTasks(ctx(db), input({ status: 'open', sort: 'due', dir: 'asc' }))).rows.map((t) => t.id)).toEqual([id(1)])
  })
  it('keyset: a page of `size` plus one tells whether there is a next page; the cursor carries the sort value and id', async () => {
    const db = seed()
    const r = await searchTasks(ctx(db), input({ status: 'any', size: 2, sort: 'created', dir: 'desc' }))
    expect(r.rows).toHaveLength(2)
    expect(r.nextCursor).toBeTruthy()
    expect(decodeCursor(r.nextCursor)).toEqual({ v: String(r.rows[1].created_at), id: String(r.rows[1].id) })
    await searchTasks(ctx(db), input({ status: 'any', size: 2, sort: 'created', dir: 'desc', cursor: r.nextCursor }))
    expect(db.orFilters).toContain(keysetClause('created', 'desc', decodeCursor(r.nextCursor)!))
  })
  it('the count is capped', () => {
    expect(SEARCH_COUNT_CAP).toBe(1000)
  })
})

describe('cursor helpers', () => {
  it('round trip; refuses tampered or unsafe values', () => {
    const c = encodeCursor({ id: id(9), completed_at: '2026-11-10T00:00:00Z' }, 'completed')
    expect(decodeCursor(c)).toEqual({ v: '2026-11-10T00:00:00Z', id: id(9) })
    expect(decodeCursor('not-base64!')).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: 'a,b', id: id(1) })).toString('base64url'))).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: 'x', id: 'nope' })).toString('base64url'))).toBeNull()
  })
  it('keyset clause for NULLS LAST ordering, both directions', () => {
    expect(keysetClause('due', 'asc', { v: '2026-11-10', id: id(1) })).toBe(`due_date.gt.2026-11-10,and(due_date.eq.2026-11-10,id.gt.${id(1)}),due_date.is.null`)
    expect(keysetClause('completed', 'desc', { v: '2026-11-10', id: id(1) })).toBe(`completed_at.lt.2026-11-10,and(completed_at.eq.2026-11-10,id.gt.${id(1)}),completed_at.is.null`)
    expect(keysetClause('due', 'asc', { v: null, id: id(1) })).toBe(`and(due_date.is.null,id.gt.${id(1)})`)
  })
})

describe('tasks.search (the app read on the same service)', () => {
  it('returns one page with unread flags, total and cursor', async () => {
    const db = seed()
    const result = await runUiRead(ctx(db), { name: 'tasks.search', args: { tab: 'mine', status: 'completed', size: 1 } } as never)
    expect(result.ok).toBe(true)
    const data = (result as any).data
    expect(data.tasks).toHaveLength(1)
    expect(data.tasks[0]).toHaveProperty('unread')
    expect(data.nextCursor).toBeTruthy()
  })
  it('refuses a bad cursor shape', async () => {
    const result = await runUiRead(ctx(seed()), { name: 'tasks.search', args: { tab: 'mine', status: 'completed', cursor: 'bad cursor!' } } as never)
    expect(result.ok).toBe(false)
  })
})
