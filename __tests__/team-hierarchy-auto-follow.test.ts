/**
 * Two task-tracker additions (docs/changes/task-views-review.md):
 *  - "Group by reporting line" on My team and the tracker's Team members tab
 *    (lib/services/team-hierarchy.ts, lib/tasks/hierarchy.ts,
 *    components/tasks/team-hierarchy.tsx): the viewer's reporting subtree with
 *    own + rolled-up counts, each person's tasks read only when they open.
 *  - Auto-follow what I act on (lib/services/task-actions autoFollowActedRun)
 *    and the Following tab listing the open tasks of followed runs
 *    (lib/services/task-follows viaRuns), each task once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

vi.mock('@/app/actions/tasks', () => ({ updateTaskField: vi.fn(), setSubtaskCompleted: vi.fn(), addSubtask: vi.fn() }))
vi.mock('@/app/actions/task-queue', () => ({ reassignReportTask: vi.fn() }))

import { expansionStorageKey, pathTo, readExpanded, rollupCounts, storeExpanded, type TeamHierarchy as TeamHierarchyData } from '@/lib/tasks/hierarchy'
import { getTeamHierarchy } from '@/lib/services/team-hierarchy'
import { listReportTasks } from '@/lib/services/manager-tasks'
import { autoFollowActedRun } from '@/lib/services/task-actions'
import { listFollowedTasks, countFollowedTasks } from '@/lib/services/task-follows'
import { buildReportingIndex } from '@/lib/reporting-lines'
import { TeamHierarchy } from '@/components/tasks/team-hierarchy'
import { PermissionsProvider } from '@/lib/permissions-context'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

const ROOT = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const PAST = '2020-01-01T00:00:00Z'
const FUTURE = '2099-01-01T00:00:00Z'

/* CEO → VP A (→ Dir A1 → Eng), VP B; Outsider reports to nobody. */
function org() {
  const people = [
    ['ceo', null, 'Chief Executive'], ['vpa', 'ceo', 'VP Sales'], ['vpb', 'ceo', 'VP Ops'],
    ['dira', 'vpa', 'Director'], ['eng', 'dira', 'Engineer'], ['out', null, 'Contractor'],
  ] as const
  return createMemorySupabase({
    user_memberships: people.map(([id, manager, title]) => ({ tenant_id: 'tenant-a', user_id: id, manager_user_id: manager, job_title: title, is_active: true })),
    users: people.map(([id]) => ({ id, display_name: id.toUpperCase(), email: `${id}@x.test`, deleted_at: null })),
    tasks: [
      { id: 't1', tenant_id: 'tenant-a', title: 'Close Q4 deal', status: 'todo', assignee_id: 'vpa', due_date: PAST, acceptance_status: 'accepted', deleted_at: null },
      { id: 't2', tenant_id: 'tenant-a', title: 'Hire SDR', status: 'in_progress', assignee_id: 'dira', due_date: FUTURE, acceptance_status: 'pending', deleted_at: null },
      { id: 't3', tenant_id: 'tenant-a', title: 'Fix login bug', status: 'blocked', assignee_id: 'eng', due_date: PAST, acceptance_status: 'accepted', deleted_at: null },
      { id: 't4', tenant_id: 'tenant-a', title: 'Old work', status: 'completed', assignee_id: 'eng', due_date: PAST, deleted_at: null },
      { id: 't5', tenant_id: 'tenant-a', title: 'Vendor review', status: 'todo', assignee_id: 'vpb', due_date: null, acceptance_status: 'accepted', deleted_at: null },
      { id: 't6', tenant_id: 'tenant-a', title: 'Outside work', status: 'todo', assignee_id: 'out', due_date: null, deleted_at: null },
    ],
    workflow_runs: [], task_escalations: [], workflows: [],
  })
}
function ctx(db: any, actorId: string, permissions: string[] = ['tasks.view_own']): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId, permissions: new Set(permissions), authKind: 'api_key', source: 'api' } as ServiceContext
}

describe('reporting-line tree (pure)', () => {
  it('rolls counts up over everyone below', () => {
    const index = buildReportingIndex([{ user_id: 'b', manager_user_id: 'a' }, { user_id: 'c', manager_user_id: 'b' }, { user_id: 'd', manager_user_id: 'a' }])
    const own = new Map([['a', { open: 1, overdue: 0, queued: 0 }], ['b', { open: 2, overdue: 1, queued: 0 }], ['c', { open: 3, overdue: 1, queued: 1 }]])
    const r = rollupCounts(index, ['a', 'b', 'c', 'd'], own)
    expect(r.get('c')).toEqual({ open: 3, overdue: 1, queued: 1 })
    expect(r.get('b')).toEqual({ open: 5, overdue: 2, queued: 1 })
    expect(r.get('a')).toEqual({ open: 6, overdue: 2, queued: 1 })
    expect(r.get('d')).toEqual({ open: 0, overdue: 0, queued: 0 })
  })

  it('a cycle in the data does not loop', () => {
    const index = { reportsOf: new Map([['a', ['b']], ['b', ['a']]]) }
    expect(() => rollupCounts(index, ['a', 'b'], new Map())).not.toThrow()
  })

  it('the path to a match runs from the top down', () => {
    const nodes = { vpa: { manager_user_id: 'ceo' }, dira: { manager_user_id: 'vpa' }, eng: { manager_user_id: 'dira' } }
    expect(pathTo(nodes, 'eng')).toEqual(['vpa', 'dira', 'eng'])
  })

  it('remembers open people per user (storage off is harmless)', () => {
    expect(readExpanded('team', 'u1')).toEqual([])
    expect(() => storeExpanded('team', 'u1', ['a'])).not.toThrow()
    const store = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } })
    try {
      storeExpanded('team', 'u1', new Set(['vpa', 'dira']))
      expect(readExpanded('team', 'u1')).toEqual(['vpa', 'dira'])
      expect(readExpanded('team', 'u2')).toEqual([])
      expect(expansionStorageKey('tracker', 'u1')).toBe('usertasks:team-tree:tracker:u1')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('getTeamHierarchy', () => {
  it('the CEO sees their VPs first, with own and rolled-up open / overdue / queued counts', async () => {
    const h = await getTeamHierarchy(ctx(org(), 'ceo'))
    expect(h.root).toEqual({ id: 'ceo', name: 'CEO' })
    expect(h.top).toEqual(['vpa', 'vpb'])
    expect(Object.keys(h.nodes).sort()).toEqual(['dira', 'eng', 'vpa', 'vpb'])
    expect(h.nodes.vpa).toMatchObject({ depth: 1, reports: ['dira'], job_title: 'VP Sales', own: { open: 1, overdue: 1, queued: 0 }, rollup: { open: 3, overdue: 2, queued: 1 } })
    expect(h.nodes.dira).toMatchObject({ depth: 2, own: { open: 1, overdue: 0, queued: 1 }, rollup: { open: 2, overdue: 1, queued: 1 } })
    expect(h.nodes.eng.own).toEqual({ open: 1, overdue: 1, queued: 0 }) // the completed task isn't counted
    expect(h.nodes.out).toBeUndefined()
    expect(h.rootOptions).toBeNull()
  })

  it('search marks people by name / title and by their open task titles', async () => {
    const h = await getTeamHierarchy(ctx(org(), 'ceo'), { search: 'login' })
    expect(Object.values(h.nodes).filter((n) => n.match).map((n) => n.id)).toEqual(['eng'])
    const byTitle = await getTeamHierarchy(ctx(org(), 'ceo'), { search: 'director' })
    expect(Object.values(byTitle.nodes).filter((n) => n.match).map((n) => n.id)).toEqual(['dira'])
  })

  it('only the viewer\'s own subtree: someone below them may be the root, others need View all tasks', async () => {
    const vpView = await getTeamHierarchy(ctx(org(), 'ceo'), { root: 'vpa' })
    expect(vpView.top).toEqual(['dira'])
    await expect(getTeamHierarchy(ctx(org(), 'vpa'), { root: 'vpb' })).rejects.toThrow(/reporting line/)
    await expect(getTeamHierarchy(ctx(org(), 'vpa'), { root: 'ceo' })).rejects.toThrow(/reporting line/)
    const admin = await getTeamHierarchy(ctx(org(), 'out', ['tasks.view_all']), { root: 'vpa' })
    expect(admin.top).toEqual(['dira'])
    expect(admin.rootOptions?.map((p) => p.id)).toEqual(['ceo', 'dira', 'vpa'])
  })

  it('needs a user and task viewing', async () => {
    await expect(getTeamHierarchy(ctx(org(), null as any))).rejects.toThrow(/user/)
    await expect(getTeamHierarchy(ctx(org(), 'ceo', []))).rejects.toThrow()
  })

  it('a person\'s own tasks load for their node (tasks.reports with root + person), within the viewer\'s subtree only', async () => {
    const own = await listReportTasks(ctx(org(), 'ceo'), { indirect: true, person: 'eng' })
    expect(own.tasks.map((t) => t.id)).toEqual(['t3'])
    const viaVp = await listReportTasks(ctx(org(), 'ceo'), { indirect: true, root_user_id: 'vpa', person: 'dira' })
    expect(viaVp.tasks.map((t) => t.id)).toEqual(['t2'])
    await expect(listReportTasks(ctx(org(), 'vpb'), { indirect: true, root_user_id: 'vpa', person: 'dira' })).rejects.toThrow(/reporting line/)
    const withClosed = await listReportTasks(ctx(org(), 'ceo'), { indirect: true, person: 'eng', include_closed: true })
    expect(withClosed.tasks.map((t) => t.id).sort()).toEqual(['t3', 't4'])
    expect(withClosed.reports.find((w) => w.user.id === 'eng')?.open).toBe(1) // workload stays open-only
  })
})

describe('the tree view', () => {
  function data(over: Partial<TeamHierarchyData> = {}): TeamHierarchyData {
    const node = (id: string, manager: string | null, depth: number, reports: string[], own: number, roll: number, match = false) => ({
      id, name: id.toUpperCase(), email: null, avatar_url: null, job_title: `${id} title`, manager_user_id: manager, depth, reports,
      own: { open: own, overdue: 0, queued: 0 }, rollup: { open: roll, overdue: 0, queued: 0 }, match,
    })
    return {
      root: { id: 'ceo', name: 'CEO' }, top: ['vpa', 'vpb'], rootOptions: null, truncated: false,
      nodes: { vpa: node('vpa', 'ceo', 1, ['dira'], 1, 3), vpb: node('vpb', 'ceo', 1, [], 2, 2), dira: node('dira', 'vpa', 2, ['eng'], 1, 2), eng: node('eng', 'dira', 3, [], 1, 1, true) },
      ...over,
    }
  }
  function render(search?: string, personTasks: Record<string, any[]> = {}) {
    const client = new QueryClient()
    const filters = { status: ['todo'], includeClosed: false, priority: [], search }
    client.setQueryData(['team-tasks', 'hierarchy', { root: null, search: search?.trim() || undefined }], data())
    for (const [person, tasks] of Object.entries(personTasks)) {
      const args = { indirect: true, person, root: null, status: filters.status, includeClosed: false, priority: filters.priority, search: search?.trim() || undefined }
      client.setQueryData(['team-tasks', 'person', args], { tasks, reports: [], truncated: false })
    }
    return renderToStaticMarkup(createElement(PermissionsProvider, { permissions: ['tasks.view_own'], userId: 'ceo', children: null },
      createElement(QueryClientProvider, { client }, createElement(TeamHierarchy, { list: 'team', filters, readOnly: false }))))
  }

  it('starts collapsed: level 1 only, each with its counts and a closed disclosure', () => {
    const html = render()
    expect(html).toContain('data-team-node="vpa"')
    expect(html).toContain('data-team-node="vpb"')
    expect(html).not.toContain('data-team-node="dira"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-team-rollup-open="true"'.replace('="true"', '')) // the rolled-up count shows for managers
    expect(html).toContain('data-team-expand-all')
    expect(html).toContain('data-team-collapse-all')
    expect(html).not.toContain('data-team-node-tasks') // nothing read for closed people
  })

  it('a search opens the path to each match and marks it; open people show their own tasks', () => {
    const task = { id: 'task-eng', title: 'Fix login bug', status: 'blocked', priority: 'high', due_date: null, created_at: PAST, updated_at: PAST, assignee_id: 'eng', assignee: { id: 'eng', display_name: 'ENG', email: null }, is_workflow_task: false, workflow_id: null, workflow_name: null, event_id: null, available_outcomes: null, acceptance_status: null, allow_reassign: false, is_overdue: false, sla_breached: false, depth: 3, progress_pct: null, child_count: 0, completed_child_count: 0, workflow_run_id: null }
    const html = render('login', { vpa: [], dira: [], eng: [task] })
    expect(html).toContain('data-team-node="dira"')
    expect(html).toContain('data-team-node="eng"')
    expect(html).toContain('data-team-node-match')
    expect(html).toContain('data-team-node-tasks="eng"')
    expect(html).toContain('data-team-task="task-eng"')
    expect(html).toContain('data-team-node-no-tasks') // VP A has none of their own
    expect(html).not.toContain('data-team-node-tasks="vpb"')
  })

  it('is the default layout on My team and the tracker\'s Team members tab, the flat list still there', () => {
    const team = read('app/(dashboard)/tasks/team/page.tsx')
    expect(team).toContain('usePersistedChoice<Layout>("team-layout", LAYOUTS, "tree")')
    expect(team).toContain('<TeamHierarchy list="team"')
    expect(team).toContain('{ value: "flat", text: "None" }')
    const tracker = read('app/(dashboard)/tasks/assigned/page.tsx')
    expect(tracker).toContain("usePersistedChoice<GroupBy>('tracker-team-groupby', TEAM_GROUP_BYS, 'reporting')")
    expect(tracker).toContain('<TeamHierarchy list="tracker"')
  })
})

/* ── Auto-follow and the Following tab ── */

function followDb(prefs: Record<string, unknown> = {}) {
  const db: any = createMemorySupabase({
    users: [{ id: 'me', preferences: prefs, current_tenant_id: 'tenant-a' }],
    workflow_runs: [{ id: 'run-1', tenant_id: 'tenant-a', event_id: 'evt-1', workflow_id: W, status: 'waiting_for_event' }],
    workflows: [{ id: W, name: 'Purchase request' }],
    run_followers: [],
  })
  db.visibleRuns = new Set(['run-1'])
  db.rpc = async (name: string, args: any) => {
    if (name === 'can_view_run_progress') return { data: db.visibleRuns.has(args.p_run_id), error: null }
    return { data: null, error: { message: `no ${name}` } }
  }
  return db
}

describe('auto-follow what I act on', () => {
  it('completing a workflow task follows its run', async () => {
    const db = followDb()
    expect(await autoFollowActedRun(db, { tenant_id: 'tenant-a', workflow_run_id: 'run-1' }, 'me', 'ui')).toBe('run-1')
    expect(db.tables.run_followers).toEqual([expect.objectContaining({ tenant_id: 'tenant-a', user_id: 'me', run_id: 'run-1', source: 'auto' })])
  })

  it('finds the run from the event when the task has no run id', async () => {
    const db = followDb()
    expect(await autoFollowActedRun(db, { tenant_id: 'tenant-a', event_id: 'evt-1' }, 'me', 'api')).toBe('run-1')
  })

  it('not when the person opted out, has no user, is an agent, or can\'t see the run', async () => {
    expect(await autoFollowActedRun(followDb({ auto_follow_acted_runs: false }), { tenant_id: 'tenant-a', workflow_run_id: 'run-1' }, 'me', 'ui')).toBeNull()
    expect(await autoFollowActedRun(followDb(), { tenant_id: 'tenant-a', workflow_run_id: 'run-1' }, null, 'api')).toBeNull()
    expect(await autoFollowActedRun(followDb(), { tenant_id: 'tenant-a', workflow_run_id: 'run-1' }, 'me', 'agent')).toBeNull()
    const hidden = followDb()
    hidden.visibleRuns = new Set()
    expect(await autoFollowActedRun(hidden, { tenant_id: 'tenant-a', workflow_run_id: 'run-1' }, 'me', 'ui')).toBeNull()
    expect(hidden.tables.run_followers).toEqual([])
  })

  it('never fails the action', async () => {
    const db = followDb()
    db.rpc = async () => { throw new Error('boom') }
    await expect(autoFollowActedRun(db, { tenant_id: 'tenant-a', workflow_run_id: 'run-1' }, 'me', 'ui')).resolves.toBeNull()
  })

  it('runs on every completion and response path (UI, REST, MCP through the service)', () => {
    const src = read('lib/services/task-actions.ts')
    expect(src).toContain('await autoFollowActedRun(db, task, ctx.actorId, options.via)')
    expect(src).toContain('if (isWorkflowTask(task)) await autoFollowActedRun(db, task, ctx.actorId, input.via)')
  })

  it('the preference is on Settings → Preferences and on the Following tab', () => {
    expect(read('components/settings/preferences-form.tsx')).toContain('name="auto_follow_acted_runs"')
    expect(read('app/(dashboard)/tasks/assigned/page.tsx')).toContain('<FollowPreferenceSwitch name="auto_follow_acted_runs" />')
  })
})

const W = '00000000-0000-4000-8000-0000000000ff'
const D = '00000000-0000-4000-8000-000000000001'
const N = '00000000-0000-4000-8000-000000000002'

describe('Following: tasks of the runs I follow', () => {
  let db: any
  beforeEach(() => {
    db = createMemorySupabase({
      users: [{ id: 'me', current_tenant_id: 'tenant-a' }],
      tasks: [
        { id: D, tenant_id: 'tenant-a', title: 'Followed directly', status: 'todo', workflow_run_id: 'run-1', due_date: null, deleted_at: null },
        { id: N, tenant_id: 'tenant-a', title: 'Finance approval', status: 'todo', workflow_run_id: 'run-1', due_date: null, deleted_at: null },
      ],
      workflows: [{ id: W, name: 'Purchase request' }],
      task_assignees: [], lifecycle_events: [], user_teams: [], teams: [],
    })
    db.rpc = async (name: string, args: any) => {
      if (name === 'list_followed_tasks') return { data: [{ task_id: D, tenant_id: 'tenant-a', status: 'todo', followed_at: PAST }], error: null }
      // The database re-checks run visibility; here: both tasks of run-1 (the direct one too).
      if (name === 'list_followed_run_tasks') {
        expect(args.p_user_id).toBe('me')
        return { data: [
          { task_id: D, tenant_id: 'tenant-a', run_id: 'run-1', status: 'todo', run_status: 'waiting_for_event', workflow_id: W, followed_at: FUTURE },
          { task_id: N, tenant_id: 'tenant-a', run_id: 'run-1', status: 'todo', run_status: 'waiting_for_event', workflow_id: W, followed_at: FUTURE },
        ], error: null }
      }
      return { data: null, error: { message: 'unknown' } }
    }
  })
  const fctx = (): ServiceContext => ({ db, supabase: db, tenantId: 'tenant-a', actorId: 'me', permissions: new Set(['tasks.view_own']), authKind: 'api_key', source: 'api' } as ServiceContext)

  it('lists them labelled with their run, and a task followed both ways once', async () => {
    const rows = await listFollowedTasks(fctx(), { viaRuns: true, status: ['todo', 'in_progress'] })
    expect(rows.map((r) => r.id).sort()).toEqual([D, N])
    expect(rows.find((r) => r.id === D)!.followed_via_run).toBeNull()
    expect(rows.find((r) => r.id === N)!.followed_via_run).toEqual({ run_id: 'run-1', workflow_name: 'Purchase request', run_status: 'waiting_for_event' })
    expect(await countFollowedTasks(fctx(), { viaRuns: true })).toEqual({ total: 2, open: 2 })
  })

  it('the API list is unchanged (no viaRuns), and without the migration the run tasks just aren\'t there', async () => {
    expect((await listFollowedTasks(fctx(), {})).map((r) => r.id)).toEqual([D])
    const original = db.rpc
    db.rpc = async (name: string, args: any) => (name === 'list_followed_run_tasks' ? { data: null, error: { message: 'function does not exist' } } : original(name, args))
    expect((await listFollowedTasks(fctx(), { viaRuns: true })).map((r) => r.id)).toEqual([D])
  })

  it('the migration checks run visibility and drops finished runs unless closed are included', () => {
    const sql = read('supabase/migrations/20261228000000_followed_run_tasks.sql')
    expect(sql).toContain('public.can_view_run_progress(r.id, p_user_id)')
    expect(sql).toContain("IF p_user_id IS NULL OR (v_caller IS NOT NULL AND v_caller <> p_user_id) THEN RETURN; END IF;")
    expect(sql).toMatch(/p_include_closed OR \(\s*t\.status::text NOT IN \('completed', 'cancelled'\)/)
  })
})

afterEach(() => { vi.unstubAllGlobals() })
