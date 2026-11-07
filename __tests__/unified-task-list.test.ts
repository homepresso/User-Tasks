/**
 * The unified task list (My tasks + the retired Task queue):
 * lib/tasks/unified-list.ts, tasks.list with `mine`, the stored filter
 * migration, the /tasks/queue redirect and the nav badge.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OPEN_TASK_STATUSES_FOR_QUEUE, QUEUED_STATUS, TASK_QUEUE_REDIRECT, displayStatus, matchesStatusFilter,
  queueActionFor, queuedFirst, storedStatusesFor, type QueueScope,
} from '@/lib/tasks/unified-list'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'
import { DEFAULT_TASK_STATUS_FILTER, withQueuedStatus } from '@/stores/app-store'
import { navBadgeCount } from '@/lib/nav-badges'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake client rows */

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const TEAM = '33333333-3333-4333-8333-333333333333'
const OTHER_TEAM = '44444444-4444-4444-8444-444444444444'
const COLLAB = '55555555-5555-4555-8555-555555555555'
const TENANT = '66666666-6666-4666-8666-666666666666'

const scope: QueueScope = { userId: ME, teamIds: new Set([TEAM]), collabPendingIds: new Set([COLLAB]) }

describe('queueActionFor / displayStatus', () => {
  it('direct assignment awaiting acceptance → accept (Queued)', () => {
    const t = { id: 'a', status: 'todo', assignee_id: ME, acceptance_status: 'pending' }
    expect(queueActionFor(t, scope)).toBe('accept')
    expect(displayStatus(t, queueActionFor(t, scope))).toBe(QUEUED_STATUS)
  })

  it('accepted, held or someone else\'s task → not queued, its own status', () => {
    for (const acceptance_status of ['accepted', 'held']) {
      const t = { id: 'b', status: 'in_progress', assignee_id: ME, acceptance_status }
      expect(queueActionFor(t, scope)).toBeNull()
      expect(displayStatus(t, null)).toBe('in_progress')
    }
    expect(queueActionFor({ id: 'c', status: 'todo', assignee_id: OTHER, acceptance_status: 'pending' }, scope)).toBeNull()
  })

  it('pending collaboration → accept; my team\'s unclaimed task → claim; another team\'s → nothing', () => {
    expect(queueActionFor({ id: COLLAB, status: 'todo', assignee_id: OTHER, acceptance_status: 'accepted' }, scope)).toBe('accept')
    expect(queueActionFor({ id: 'd', status: 'in_progress', assignee_id: null, assigned_team_id: TEAM, acceptance_status: 'accepted' }, scope)).toBe('claim')
    expect(queueActionFor({ id: 'e', status: 'todo', assignee_id: null, assigned_team_id: OTHER_TEAM }, scope)).toBeNull()
    // Claimed by a teammate: no longer queued for me.
    expect(queueActionFor({ id: 'f', status: 'todo', assignee_id: OTHER, assigned_team_id: TEAM }, scope)).toBeNull()
  })

  it('only open tasks can be queued', () => {
    for (const status of ['completed', 'cancelled', 'draft']) {
      expect(queueActionFor({ id: 'g', status, assignee_id: ME, acceptance_status: 'pending' }, scope)).toBeNull()
    }
    for (const status of OPEN_TASK_STATUSES_FOR_QUEUE) {
      expect(queueActionFor({ id: 'h', status, assignee_id: ME, acceptance_status: 'pending' }, scope)).toBe('accept')
    }
  })
})

describe('status filter over display statuses', () => {
  it('queued matches only "queued"; others their own status; empty keeps all', () => {
    expect(matchesStatusFilter('queued', ['queued'])).toBe(true)
    expect(matchesStatusFilter('queued', ['todo', 'in_progress'])).toBe(false)
    expect(matchesStatusFilter('todo', ['queued', 'todo'])).toBe(true)
    expect(matchesStatusFilter('completed', [])).toBe(true)
    expect(matchesStatusFilter('completed', undefined)).toBe(true)
  })

  it('the DB fetch widens "queued" to the open statuses', () => {
    expect(storedStatusesFor(['queued'])?.sort()).toEqual(['blocked', 'in_progress', 'todo'])
    expect(storedStatusesFor(['completed'])).toEqual(['completed'])
    expect(storedStatusesFor(['queued', 'completed'])?.sort()).toEqual(['blocked', 'completed', 'in_progress', 'todo'])
    expect(storedStatusesFor([])).toBeNull()
  })

  it('queuedFirst keeps the order within each group', () => {
    const rows = [{ id: 1, display_status: 'todo' }, { id: 2, display_status: 'queued' }, { id: 3, display_status: 'blocked' }, { id: 4, display_status: 'queued' }]
    expect(queuedFirst(rows).map((r) => r.id)).toEqual([2, 4, 1, 3])
  })
})

/* ── tasks.list with mine (recording fake client) ───────────────────── */

function fakeDb(tables: Record<string, any[]>) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = []
  const db = {
    calls,
    from(table: string) {
      const filters: Array<(row: any) => boolean> = []
      const api: any = {}
      const record = (op: string, args: unknown[]) => calls.push({ table, op, args })
      for (const op of ['select', 'order', 'limit', 'or', 'ilike', 'lt', 'lte', 'is']) {
        api[op] = (...args: unknown[]) => { record(op, args); return api }
      }
      api.eq = (field: string, value: unknown) => {
        record('eq', [field, value])
        if (!field.includes('.')) filters.push((row) => row[field] === undefined || row[field] === value)
        return api
      }
      api.in = (field: string, values: unknown[]) => { record('in', [field, values]); filters.push((row) => values.includes(row[field])); return api }
      api.maybeSingle = async () => ({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null })
      api.then = (resolve: (v: unknown) => unknown) => resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null })
      return api
    },
  }
  return db
}

function ctx(db: any): ServiceContext {
  return { db, supabase: db, tenantId: TENANT, actorId: ME, permissions: new Set(['tasks.view_own']), authKind: 'session', source: 'ui' } as ServiceContext
}

const listSeed = () => ({
  users: [{ id: ME, current_tenant_id: TENANT, team_id: null }],
  user_teams: [{ user_id: ME, team_id: TEAM }],
  task_assignees: [{ task_id: COLLAB, user_id: ME, acceptance_status: 'pending', tenant_id: TENANT }],
  tasks: [
    { id: 'mine-open', title: 'Mine', status: 'in_progress', assignee_id: ME, acceptance_status: 'accepted' },
    { id: 'mine-pending', title: 'Pending', status: 'todo', assignee_id: ME, acceptance_status: 'pending' },
    { id: 'team-unclaimed', title: 'Team', status: 'todo', assignee_id: null, assigned_team_id: TEAM, acceptance_status: 'accepted' },
    { id: COLLAB, title: 'Collab', status: 'todo', assignee_id: OTHER, acceptance_status: 'accepted' },
    { id: 'mine-done', title: 'Done', status: 'completed', assignee_id: ME, acceptance_status: 'accepted' },
  ],
})

describe('tasks.list with mine', () => {
  it('asks for my tasks, my teams\' unclaimed ones and my pending collaborations; derives Queued', async () => {
    const db = fakeDb(listSeed())
    const result: any = await runUiRead(ctx(db), { name: 'tasks.list', args: { mine: true } })
    expect(result.ok).toBe(true)
    const or = db.calls.find((c) => c.table === 'tasks' && c.op === 'or')?.args[0]
    expect(or).toBe(`assignee_id.eq.${ME},and(assignee_id.is.null,assigned_team_id.in.(${TEAM})),id.in.(${COLLAB})`)
    const byId = Object.fromEntries((result.data as any[]).map((r) => [r.id, r]))
    expect(byId['mine-open']).toMatchObject({ display_status: 'in_progress', queue_action: null })
    expect(byId['mine-pending']).toMatchObject({ display_status: 'queued', queue_action: 'accept' })
    expect(byId['team-unclaimed']).toMatchObject({ display_status: 'queued', queue_action: 'claim' })
    expect(byId[COLLAB]).toMatchObject({ display_status: 'queued', queue_action: 'accept' })
    expect(byId['mine-done']).toMatchObject({ display_status: 'completed', queue_action: null })
    // Default (due date) order: queued first.
    expect((result.data as any[]).slice(0, 3).every((r) => r.display_status === 'queued')).toBe(true)
  })

  it('status filter "queued" fetches open statuses and keeps only queued rows', async () => {
    const db = fakeDb(listSeed())
    const result: any = await runUiRead(ctx(db), { name: 'tasks.list', args: { mine: true, status: ['queued'] } })
    const statusIn = db.calls.find((c) => c.table === 'tasks' && c.op === 'in' && c.args[0] === 'status')?.args[1] as string[]
    expect([...statusIn].sort()).toEqual(['blocked', 'in_progress', 'todo'])
    expect((result.data as any[]).map((r) => r.id).sort()).toEqual([COLLAB, 'mine-pending', 'team-unclaimed'].sort())
  })

  it('the default filter (queued + open work) hides nothing open and drops completed', async () => {
    const db = fakeDb(listSeed())
    const result: any = await runUiRead(ctx(db), { name: 'tasks.list', args: { mine: true, status: [...DEFAULT_TASK_STATUS_FILTER] } })
    expect((result.data as any[]).map((r) => r.id).sort()).toEqual([COLLAB, 'mine-open', 'mine-pending', 'team-unclaimed'].sort())
  })

  it('"in progress" alone excludes queued tasks even when their stored status matches', async () => {
    const db = fakeDb(listSeed())
    const result: any = await runUiRead(ctx(db), { name: 'tasks.list', args: { mine: true, status: ['in_progress', 'todo'] } })
    expect((result.data as any[]).map((r) => r.id)).toEqual(['mine-open'])
  })
})

/* ── Stored filter migration, redirect, nav ─────────────────────────── */

describe('My tasks filter migration (app store v4)', () => {
  it('an open-work filter gains "queued"; empty / other filters are kept', () => {
    expect(withQueuedStatus({ status: ['todo', 'in_progress', 'blocked'], priority: [], sortBy: 'due_date' }))
      .toEqual({ status: ['queued', 'todo', 'in_progress', 'blocked'], priority: [], sortBy: 'due_date' })
    expect(withQueuedStatus({ status: [], priority: [] })).toEqual({ status: [], priority: [] })
    expect(withQueuedStatus({ status: ['completed'] })).toEqual({ status: ['completed'] })
    expect(withQueuedStatus({ status: ['queued', 'todo'] })).toEqual({ status: ['queued', 'todo'] })
    expect(withQueuedStatus(undefined)).toBeUndefined()
  })
})

describe('the Task queue page is retired', () => {
  const root = process.cwd()
  it('/tasks/queue redirects (temporarily) to the list filtered to Queued', () => {
    expect(TASK_QUEUE_REDIRECT).toEqual({ source: '/tasks/queue', destination: '/tasks?status=queued', permanent: false })
    expect(readFileSync(path.join(root, 'next.config.ts'), 'utf8')).toContain('TASK_QUEUE_REDIRECT')
    expect(existsSync(path.join(root, 'app/(dashboard)/tasks/queue/page.tsx'))).toBe(false)
  })

  it('the task list seeds its status filter from ?status=', () => {
    const page = readFileSync(path.join(root, 'app/(dashboard)/tasks/page.tsx'), 'utf8')
    expect(page).toContain('params.get("status")')
    expect(page).toContain('mine: true')
  })

  it('My tasks\' badge folds in the queued count', () => {
    expect(navBadgeCount({ my_tasks: 2, queue: 5, tracker: 1 }, '/tasks')).toBe(7)
    expect(navBadgeCount({ my_tasks: 2, queue: 5, tracker: 1 }, '/tasks/queue')).toBe(0)
  })
})
