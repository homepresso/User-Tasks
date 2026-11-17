/**
 * The embeddable task list's server pieces (lib/services/embed-tasks.ts and
 * home.unclaimTask) against the in-memory client: who sees which tasks per
 * view, the row actions, and giving a claimed team task back.
 */
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => undefined), logObjectAudit: vi.fn(async () => undefined) }))
import { createMemorySupabase } from './fixtures/supabase-memory'
import type { ServiceContext } from '@/lib/services/context'
import { listEmbedTab, listEmbedTasks, trackerScopes } from '@/lib/services/embed-tasks'
import { claimTask, unclaimTask } from '@/lib/services/home'
import { parseTaskListOptions } from '@/lib/embed/task-list'

const T = '11111111-1111-4111-8111-111111111111'
const ME = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const TEAM = '44444444-4444-4444-8444-444444444444'
const WF = '55555555-5555-4555-8555-555555555555'
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const base = { tenant_id: T, deleted_at: null, parent_task_id: null, priority: 'medium', created_at: '2026-11-01T00:00:00Z', is_workflow_task: true, acceptance_status: 'accepted', workflow_id: WF, workflow_run_id: null, workflow_step_id: null, metadata: {} }

function seed() {
  const db = createMemorySupabase({
    tasks: [
      { ...base, id: id(1), title: 'Mine approval', status: 'todo', assignee_id: ME, assigned_team_id: null, event_id: 'ev1', available_outcomes: ['approved', 'rejected'], due_date: '2020-01-01T00:00:00Z' },
      { ...base, id: id(2), title: 'Team pool', status: 'todo', assignee_id: null, assigned_team_id: TEAM, event_id: 'ev2', available_outcomes: ['approved'], acceptance_status: 'pending', due_date: null },
      { ...base, id: id(3), title: 'Someone else', status: 'todo', assignee_id: OTHER, assigned_team_id: null, event_id: 'ev3', due_date: null },
      { ...base, id: id(4), title: 'Mine done', status: 'completed', assignee_id: ME, assigned_team_id: null, event_id: 'ev4', outcome: 'approved', completed_at: '2026-11-02T00:00:00Z', due_date: null },
      { ...base, id: id(5), title: 'Mine with form', status: 'todo', assignee_id: ME, assigned_team_id: null, event_id: 'ev5', metadata: { fields: [{ key: 'tag', label: 'Tag', type: 'text', required: true }] }, due_date: null },
    ],
    user_teams: [{ user_id: ME, team_id: TEAM, team: { tenant_id: T }, 'team.tenant_id': T }],
    teams: [{ id: TEAM, tenant_id: T, name: 'Parts team' }],
    users: [{ id: ME, team_id: null }],
    task_assignees: [], workflow_runs: [], workflows: [{ id: WF, tenant_id: T, name: 'Approvals', tags: ['sharepoint: requests'] }], workflow_versions: [],
    object_audit_log: [], audit_logs: [],
  }, { uuids: true }) as any
  db.rpc = async () => ({ data: [], error: null })
  // The memory client ignores or(): record the visibility filter the service sends (PostgREST syntax).
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
function ctx(db: any, perms = ['tasks.view_own', 'tasks.complete']): ServiceContext {
  return { supabase: db, tenantId: T, actorId: ME, permissions: new Set(perms), authKind: 'api_key', source: 'api' } as unknown as ServiceContext
}
const titles = (r: { tasks: Array<{ title: string }> }) => r.tasks.map((t) => t.title).sort()

describe('listEmbedTasks', () => {
  it('row actions: outcome buttons only when there is nothing to fill in; overdue flagged', async () => {
    const r = await listEmbedTasks(ctx(seed()), parseTaskListOptions({}))
    const approval = r.tasks.find((t) => t.title === 'Mine approval')!
    expect(approval.actions).toEqual(['outcome', 'open'])
    expect(approval.outcomes).toEqual(['approved', 'rejected'])
    expect(approval.overdue).toBe(true)
    expect(r.tasks.find((t) => t.title === 'Mine with form')!.actions).toEqual(['open'])
    expect(r.tasks.find((t) => t.title === 'Team pool')!.actions).toEqual(['claim', 'open'])
    expect(r.tasks.find((t) => t.title === 'Someone else')!.actions).toEqual(['open'])
  })
  it('visibility per view (the filter sent to the database)', async () => {
    const db = seed()
    await listEmbedTasks(ctx(db), parseTaskListOptions({}))
    expect(db.orFilters.pop()).toBe(`assignee_id.eq.${ME},actioned_by.eq.${ME}`)
    await listEmbedTasks(ctx(db), parseTaskListOptions({ view: 'groups' }))
    expect(db.orFilters.pop()).toBe(`and(assignee_id.eq.${ME},assigned_team_id.not.is.null),and(assignee_id.is.null,assigned_team_id.in.(${TEAM}))`)
    await listEmbedTasks(ctx(db), parseTaskListOptions({ view: 'all' }))
    expect(db.orFilters.pop()).toBe(`assignee_id.eq.${ME},actioned_by.eq.${ME},and(assignee_id.eq.${ME},assigned_team_id.not.is.null),and(assignee_id.is.null,assigned_team_id.in.(${TEAM}))`)
    // tasks.view_all: "All" is the whole workspace (no visibility filter).
    const n = db.orFilters.length
    await listEmbedTasks(ctx(db, ['tasks.view_own', 'tasks.view_all']), parseTaskListOptions({ view: 'all' }))
    expect(db.orFilters.length).toBe(n)
  })
  it('status and scopes: completed, workflow=none, tag, search, overdue', async () => {
    const db = seed()
    expect(titles(await listEmbedTasks(ctx(db), parseTaskListOptions({ status: 'completed' })))).toEqual(['Mine done'])
    expect(titles(await listEmbedTasks(ctx(db), parseTaskListOptions({ workflow: 'none' })))).toEqual([])
    // Search: title, id, workflow name, requester — one or() on the server.
    db.orFilters.length = 0
    await listEmbedTasks(ctx(db), parseTaskListOptions({ q: 'approval' }))
    expect(db.orFilters.some((f: string) => f.startsWith('title.ilike.%approval%'))).toBe(true)
    db.orFilters.length = 0
    await listEmbedTasks(ctx(db), parseTaskListOptions({ q: 'Approvals' }))
    expect(db.orFilters.some((f: string) => f.includes(`workflow_id.in.(${WF})`))).toBe(true)
    db.orFilters.length = 0
    await listEmbedTasks(ctx(db), parseTaskListOptions({ q: id(3) }))
    expect(db.orFilters.some((f: string) => f.includes(`id.eq.${id(3)}`))).toBe(true)
    expect(titles(await listEmbedTasks(ctx(db), parseTaskListOptions({ wf: WF, priority: 'medium' })))).toContain('Mine approval')
    expect((await listEmbedTasks(ctx(db), parseTaskListOptions({ tag: 'sharepoint: requests' }))).total).toBe(4)
    expect(titles(await listEmbedTasks(ctx(db), parseTaskListOptions({ tag: 'nothing' })))).toEqual([])
    expect(titles(await listEmbedTasks(ctx(db), parseTaskListOptions({ due: 'overdue' })))).toEqual(['Mine approval'])
  })
  it('sort, page size and the capped count', async () => {
    const db = seed()
    const byTitle = await listEmbedTasks(ctx(db), parseTaskListOptions({ sort: 'title', dir: 'desc', status: 'any' }))
    expect(byTitle.tasks.map((t) => t.title)).toEqual([...byTitle.tasks.map((t) => t.title)].sort().reverse())
    const page = await listEmbedTasks(ctx(db), parseTaskListOptions({ size: '2', status: 'any' }))
    expect(page.tasks).toHaveLength(2)
    expect(page.total).toBe(5)
    expect(page.capped).toBe(false)
    // More than COUNT_CAP: "1,000+".
    for (let i = 0; i < 1001; i++) db.tables.tasks.push({ ...base, id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: `Bulk ${i}`, status: 'todo', assignee_id: ME, assigned_team_id: null, event_id: null, due_date: null })
    const big = await listEmbedTasks(ctx(db), parseTaskListOptions({ size: '10' }))
    expect(big.capped).toBe(true)
    expect(big.total).toBe(1000)
    expect(big.tasks).toHaveLength(10)
  })
  it('row richness: progress, subtasks, unread (the app\'s task_unread_ids rule)', async () => {
    const db = seed()
    db.tables.tasks.find((t: any) => t.id === id(1)).progress_pct = 40
    Object.assign(db.tables.tasks.find((t: any) => t.id === id(1)), { child_count: 5, completed_child_count: 2 })
    db.rpc = async (name: string) => ({ data: name === 'task_unread_ids' ? [id(1)] : [], error: null })
    const r = await listEmbedTasks(ctx(db), parseTaskListOptions({}))
    const t = r.tasks.find((x) => x.id === id(1))!
    expect(t).toMatchObject({ progress_pct: 40, subtasks: { total: 5, done: 2 }, unread: true })
    expect(r.tasks.find((x) => x.id === id(5))!.unread).toBe(false)
    // Unread only.
    expect((await listEmbedTasks(ctx(db), parseTaskListOptions({ unread: '1' }))).tasks.map((x) => x.id)).toEqual([id(1)])
  })
  it('tabs: Following lists the followed set; Task tracker offers only the scopes the person has', async () => {
    const db = seed()
    db.rpc = async (name: string) => ({ data: name === 'list_followed_tasks' ? [{ task_id: id(3), status: 'todo', followed_at: '2026-11-01T00:00:00Z' }] : [], error: null })
    const following = await listEmbedTab(ctx(db), parseTaskListOptions({ tab: 'following' }))
    expect(following.tasks.map((t) => t.title)).toEqual(['Someone else'])
    expect(following.tasks[0].actions).toEqual(['open'])
    expect(await trackerScopes(ctx(db))).toEqual([])
    const none = await listEmbedTab(ctx(db), parseTaskListOptions({ tab: 'tracker' }))
    expect(none).toMatchObject({ tasks: [], scopes: [], scope: null })
    expect(await trackerScopes(ctx(db, ['tasks.view_own', 'tasks.view_all']))).toEqual(['all', 'assigned_by_me', 'team'])
    const all = await listEmbedTab(ctx(db, ['tasks.view_own', 'tasks.view_all']), parseTaskListOptions({ tab: 'tracker', status: 'any' }))
    expect(all.scope).toBe('all')
    expect(titles(all)).toContain('Someone else')
    // A manager-style view of someone else's task: Open only (acting stays the app's rule).
    expect(all.tasks.find((t) => t.title === 'Someone else')!.actions).toEqual(['open'])
  })
  it('needs tasks.view_own', async () => {
    await expect(listEmbedTasks(ctx(seed(), []), parseTaskListOptions({}))).rejects.toMatchObject({ status: 403 })
  })
})

describe('unclaimTask', () => {
  it('gives a team task I claimed back to the team; refuses others', async () => {
    const db = seed()
    expect(await claimTask(ctx(db), id(2))).toEqual({ claimed: true, task_id: id(2) })
    expect(db.tables.tasks.find((t: any) => t.id === id(2))).toMatchObject({ assignee_id: ME, status: 'in_progress' })
    expect(await unclaimTask(ctx(db), id(2))).toEqual({ unclaimed: true, task_id: id(2) })
    expect(db.tables.tasks.find((t: any) => t.id === id(2))).toMatchObject({ assignee_id: null, status: 'todo', acceptance_status: 'pending' })
    // Not a team task / not mine / closed.
    await expect(unclaimTask(ctx(db), id(1))).rejects.toMatchObject({ status: 400 })
    db.tables.tasks.find((t: any) => t.id === id(2)).assignee_id = OTHER
    await expect(unclaimTask(ctx(db), id(2))).rejects.toMatchObject({ status: 403 })
    await expect(unclaimTask(ctx(db, ['tasks.view_own']), id(2))).rejects.toMatchObject({ status: 403 })
    await expect(unclaimTask(ctx(db), 'not-a-uuid')).rejects.toMatchObject({ status: 404 })
  })
})
