/**
 * Task views review (docs/changes/task-views-review.md): the four task lists
 * (Task tracker, My team, My tasks, Home My tasks) share column sorting
 * (lib/tasks/list-sort), the default status rule — open statuses, closed
 * ones behind "Show completed" (lib/tasks/status-filter) — and one detail
 * panel (components/tasks/task-detail-panel.tsx, read: tasks.panel) whose
 * edit controls follow the server's rules. Adding a subtask is new
 * (lib/services/tasks addSubtask).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const tasksActions = vi.hoisted(() => ({ updateTaskField: vi.fn(), setSubtaskCompleted: vi.fn(), addSubtask: vi.fn(), completeTaskWithOutcome: vi.fn() }))
vi.mock('@/app/actions/tasks', () => tasksActions)
vi.mock('@/app/actions/task-effort', () => ({ logManualEffort: vi.fn() }))

import {
  ariaSortFor, formatSortParam, nextSort, parseSortParam, readStoredSort, rowProgress, sortRows, storeSort, taskSortValue,
} from '@/lib/tasks/list-sort'
import {
  DEFAULT_STATUS_FILTER, explicitStatusList, explicitStatusView, isStatusFiltered, matchesStatus, parseStatusFilter,
  readStoredStatusFilter, statusesFor, storeStatusFilter,
} from '@/lib/tasks/status-filter'
import { getTaskPanel, panelPermissions, type TaskPanelData } from '@/lib/services/task-panel'
import * as tasksService from '@/lib/services/tasks'
import { TaskDetailPanel, formatMinutes, taskPanelQueryKey } from '@/components/tasks/task-detail-panel'
import { PermissionsProvider } from '@/lib/permissions-context'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

const ROOT = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

describe('column sorting', () => {
  it('a header click cycles ascending → descending → none; another column starts ascending', () => {
    expect(nextSort(null, 'due')).toEqual({ key: 'due', dir: 'asc' })
    expect(nextSort({ key: 'due', dir: 'asc' }, 'due')).toEqual({ key: 'due', dir: 'desc' })
    expect(nextSort({ key: 'due', dir: 'desc' }, 'due')).toBeNull()
    expect(nextSort({ key: 'due', dir: 'desc' }, 'title')).toEqual({ key: 'title', dir: 'asc' })
  })

  it('aria-sort follows the state', () => {
    expect(ariaSortFor({ key: 'due', dir: 'asc' }, 'due')).toBe('ascending')
    expect(ariaSortFor({ key: 'due', dir: 'desc' }, 'due')).toBe('descending')
    expect(ariaSortFor({ key: 'due', dir: 'desc' }, 'title')).toBe('none')
    expect(ariaSortFor(null, 'due')).toBe('none')
  })

  const rows = [
    { id: 'a', title: 'beta', priority: 'low', status: 'todo', due_date: null },
    { id: 'b', title: 'Alpha', priority: 'critical', status: 'blocked', due_date: '2026-11-10' },
    { id: 'c', title: 'gamma 10', priority: 'high', status: 'completed', due_date: '2026-11-08' },
    { id: 'd', title: 'gamma 9', priority: 'high', status: 'in_progress', due_date: '2026-11-09' },
  ]
  const ids = (list: Array<{ id: string }>) => list.map((r) => r.id)

  it('sorts by meaning: priority critical → low, status open work first, text case-insensitive and numeric', () => {
    expect(ids(sortRows(rows, { key: 'priority', dir: 'asc' }))).toEqual(['b', 'c', 'd', 'a'])
    expect(ids(sortRows(rows, { key: 'priority', dir: 'desc' }))).toEqual(['a', 'c', 'd', 'b']) // stable among equals
    expect(ids(sortRows(rows, { key: 'status', dir: 'asc' }))).toEqual(['b', 'd', 'a', 'c'])
    expect(ids(sortRows(rows, { key: 'title', dir: 'asc' }))).toEqual(['b', 'a', 'd', 'c'])
  })

  it('empty values (no due date) go last in both directions; no sort keeps the order', () => {
    expect(ids(sortRows(rows, { key: 'due', dir: 'asc' }))).toEqual(['c', 'd', 'b', 'a'])
    expect(ids(sortRows(rows, { key: 'due', dir: 'desc' }))).toEqual(['b', 'd', 'c', 'a'])
    expect(ids(sortRows(rows, null))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reads every list row shape (tracker, My team, My tasks, Home)', () => {
    expect(taskSortValue({ assignee: { display_name: 'Priya' } }, 'assignee')).toBe('Priya')
    expect(taskSortValue({ status: 'todo', display_status: 'queued' }, 'status')).toBe(0)
    expect(taskSortValue({ status: 'todo', action: 'accept' }, 'status')).toBe(0)
    expect(rowProgress({ subtask_count: 4, completed_subtask_count: 1 })).toBe(25)
    expect(rowProgress({ child_count: 2, completed_child_count: 2 })).toBe(100)
    expect(rowProgress({ progress_pct: 40 })).toBe(40)
    expect(rowProgress({ status: 'completed' })).toBe(100)
  })

  it('sorting happens before paging, so page 2 continues the sort', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), title: `T${String(29 - i).padStart(2, '0')}` }))
    const page2 = sortRows(many, { key: 'title', dir: 'asc' }).slice(25, 50)
    expect(page2.map((r) => r.title)).toEqual(['T25', 'T26', 'T27', 'T28', 'T29'])
  })

  it('URL form and per-user persistence (storage off is harmless)', () => {
    expect(parseSortParam('-due', ['due', 'title'])).toEqual({ key: 'due', dir: 'desc' })
    expect(parseSortParam('bogus', ['due'])).toBeNull()
    expect(formatSortParam({ key: 'title', dir: 'asc' })).toBe('title')
    // No window (storage unavailable): nothing remembered, nothing thrown.
    expect(readStoredSort('tracker', 'u1', ['due'])).toBeUndefined()
    expect(() => storeSort('tracker', 'u1', { key: 'due', dir: 'asc' })).not.toThrow()
  })
})

describe('with a browser storage', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('remembers the sort per user and per list', () => {
    storeSort('tracker', 'u1', { key: 'due', dir: 'desc' })
    expect(readStoredSort('tracker', 'u1', ['due'])).toEqual({ key: 'due', dir: 'desc' })
    expect(readStoredSort('tracker', 'u2', ['due'])).toBeUndefined()
    expect(readStoredSort('team', 'u1', ['due'])).toBeUndefined()
    storeSort('tracker', 'u1', null)
    expect(readStoredSort('tracker', 'u1', ['due'])).toBeNull() // cleared on purpose
  })

  it('remembers Show completed per user and per list', () => {
    storeStatusFilter('tracker', 'u1', { selected: ['blocked'], showCompleted: true })
    expect(readStoredStatusFilter('tracker', 'u1')).toEqual({ selected: ['blocked'], showCompleted: true })
    expect(readStoredStatusFilter('tracker', 'u2')).toBeNull()
    store.set('usertasks:status-filter:tracker:u3', '{not json')
    expect(readStoredStatusFilter('tracker', 'u3')).toBeNull()
  })
})

describe('the default status rule', () => {
  const OPEN = ['draft', 'todo', 'in_progress', 'blocked']

  it('by default every open status — completed and cancelled hidden', () => {
    expect(statusesFor(DEFAULT_STATUS_FILTER, OPEN)).toEqual(OPEN)
    expect(matchesStatus('completed', DEFAULT_STATUS_FILTER, OPEN)).toBe(false)
    expect(matchesStatus('cancelled', DEFAULT_STATUS_FILTER, OPEN)).toBe(false)
    expect(matchesStatus('blocked', DEFAULT_STATUS_FILTER, OPEN)).toBe(true)
    expect(isStatusFiltered(DEFAULT_STATUS_FILTER)).toBe(false)
  })

  it('Show completed brings the closed ones back; the menu narrows the open ones', () => {
    expect(statusesFor({ selected: [], showCompleted: true }, OPEN)).toBeNull() // everything
    expect(statusesFor({ selected: ['blocked'], showCompleted: false }, OPEN)).toEqual(['blocked'])
    expect(statusesFor({ selected: ['blocked'], showCompleted: true }, OPEN)).toEqual(['blocked', 'completed', 'cancelled'])
    expect(isStatusFiltered({ selected: [], showCompleted: true })).toBe(true)
  })

  it('a stored filter never carries closed statuses in the menu', () => {
    expect(parseStatusFilter({ selected: ['completed', 'todo'], showCompleted: 'yes' })).toEqual({ selected: ['todo'], showCompleted: false })
    expect(parseStatusFilter(null)).toBeNull()
  })

  it('My tasks keeps its stored status list (Queued + open by default) in step with the same controls', () => {
    const open = ['queued', 'todo', 'in_progress', 'blocked']
    expect(explicitStatusView(open, open)).toEqual({ selected: [], showCompleted: false })
    expect(explicitStatusView([], open)).toEqual({ selected: [], showCompleted: true })
    expect(explicitStatusView(['queued', 'completed'], open)).toEqual({ selected: ['queued'], showCompleted: true })
    expect(explicitStatusList([], false, open)).toEqual(open)
    expect(explicitStatusList([], true, open)).toEqual([])
    expect(explicitStatusList(['todo'], true, open)).toEqual(['todo', 'completed', 'cancelled'])
  })

  it('the old Following "Hide completed" is gone — one Show completed control on every list', () => {
    const tracker = read('app/(dashboard)/tasks/assigned/page.tsx')
    expect(tracker).not.toContain('data-hide-completed')
    expect(tracker).toContain('hideCompleted: !statusFilter.showCompleted')
    for (const file of ['app/(dashboard)/tasks/assigned/page.tsx', 'app/(dashboard)/tasks/team/page.tsx', 'app/(dashboard)/tasks/page.tsx']) {
      expect(read(file), file).toContain('<StatusFilterControls')
    }
    expect(read('components/home/home-tabs.tsx')).toContain('data-show-completed')
  })
})

describe('the detail panel permissions', () => {
  it('edits need tasks.complete on a task the person can reach; status not on workflow tasks; closed tasks keep effort / ticks only', () => {
    expect(panelPermissions({ canComplete: true, reachable: true, closed: false, workflow: false }).can)
      .toEqual({ progress: true, status: true, effort: true, subtasks: true, addSubtask: true })
    expect(panelPermissions({ canComplete: true, reachable: true, closed: false, workflow: true }).can.status).toBe(false)
    expect(panelPermissions({ canComplete: true, reachable: true, closed: true, workflow: false }).can)
      .toEqual({ progress: false, status: false, effort: true, subtasks: true, addSubtask: false })
    const viewer = panelPermissions({ canComplete: false, reachable: true, closed: false, workflow: false })
    expect(Object.values(viewer.can).some(Boolean)).toBe(false)
    expect(viewer.readOnlyReason).toMatch(/view this task but not update/)
    expect(panelPermissions({ canComplete: true, reachable: false, closed: false, workflow: false }).can.progress).toBe(false)
  })

  it('formats effort', () => {
    expect(formatMinutes(0)).toBe('0h')
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(90)).toBe('1.5h')
    expect(formatMinutes(120)).toBe('2h')
  })
})

function panelData(over: Partial<TaskPanelData> = {}): TaskPanelData {
  return {
    id: 'task-1', title: 'Review contract', subtitle: null, status: 'in_progress', priority: 'high', due_date: '2026-11-20T00:00:00Z',
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-05T00:00:00Z', description: 'Check clause 4', workflow: false, closed: false,
    assignee: { id: 'u2', name: 'Priya Nair' }, requester: { id: 'u1', name: 'Andy' }, team: null,
    progress: { pct: 50, manual: null, fromSubtasks: true },
    effort: { loggedMinutes: 150, estimateMinutes: 240, entries: [{ id: 'e1', minutes: 90, notes: 'Drafting', at: '2026-11-04T00:00:00Z', by: 'Priya Nair' }] },
    subtasks: { items: [{ id: 's1', title: 'Read draft', subtitle: 'Clauses 1–6', status: 'completed', priority: 'high', due_date: null, assignee: 'Priya Nair', estimateMinutes: 90, childCount: 0 }, { id: 's2', title: 'Send notes', subtitle: null, status: 'todo', priority: 'high', due_date: null, assignee: null, estimateMinutes: null, childCount: 0 }], total: 2, completed: 1 },
    latest: { kind: 'comment', text: 'Looks good so far', by: 'Andy', at: '2026-11-05T00:00:00Z' },
    attachments: 3,
    links: { task: '/tasks/task-1', form: '/tasks/task-1?tab=form', process: '/home/runs/run-1' },
    can: { progress: true, status: true, effort: true, subtasks: true, addSubtask: true },
    readOnlyReason: null,
    ...over,
  }
}

function renderPanel(data: TaskPanelData | null, props: Record<string, unknown> = {}) {
  const client = new QueryClient()
  client.setQueryData(taskPanelQueryKey('task-1'), data)
  return renderToStaticMarkup(
    createElement(PermissionsProvider, { permissions: ['tasks.complete'], userId: 'u1', children: null },
      createElement(QueryClientProvider, { client }, createElement(TaskDetailPanel, { taskId: 'task-1', title: 'Review contract', ...props }))),
  )
}

describe('the detail panel', () => {
  it('shows the summary, progress, effort (logged vs estimate), subtasks, latest comment and the links', () => {
    const html = renderPanel(panelData())
    expect(html).toContain('data-task-panel-summary')
    expect(html).toContain('Priya Nair')
    expect(html).toContain('Andy')
    expect(html).toContain('2.5h</strong> logged')
    expect(html).toContain('of 4h estimate')
    expect(html).toContain('data-task-panel-subtask="s1"')
    expect(html).toContain('1/2 done')
    expect(html).toContain('Looks good so far')
    expect(html).toContain('href="/tasks/task-1"')
    expect(html).toContain('href="/tasks/task-1?tab=form"')
    expect(html).toContain('href="/home/runs/run-1"')
    expect(html).toContain('3 attachments')
    expect(html).not.toMatch(/work plan/i)
  })

  it('offers the edit controls the server allows', () => {
    const html = renderPanel(panelData())
    expect(html).toContain('data-task-panel-status')
    expect(html).toContain('data-task-panel-progress-input')
    expect(html).toContain('data-log-effort')
    expect(html).toContain('data-task-panel-subtask-toggle="s2"')
    expect(html).toContain('data-task-panel-add-subtask')
  })

  it('reads only when the person may not change the task', () => {
    const html = renderPanel(panelData({
      can: { progress: false, status: false, effort: false, subtasks: false, addSubtask: false },
      readOnlyReason: 'Your role can view this task but not update it.',
    }))
    expect(html).not.toContain('data-task-panel-status')
    expect(html).not.toContain('data-task-panel-progress-input')
    expect(html).not.toContain('data-log-effort')
    expect(html).not.toContain('data-task-panel-subtask-toggle')
    expect(html).not.toContain('data-task-panel-add-subtask')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('data-task-panel-readonly')
  })

  it('a workflow task: progress yes, status no (it follows its step)', () => {
    const html = renderPanel(panelData({ workflow: true, can: { progress: true, status: false, effort: true, subtasks: true, addSubtask: true } }))
    expect(html).not.toContain('data-task-panel-status')
    expect(html).toContain('data-task-panel-progress-input')
  })

  it('a task the person cannot reach: no details', () => {
    expect(renderPanel(null)).toContain('data-task-panel-unavailable')
  })

  it('compact (Home) keeps the essentials', () => {
    const html = renderPanel(panelData(), { compact: true })
    expect(html).toContain('data-task-panel-progress')
    expect(html).toContain('data-task-panel-subtasks')
    expect(html).not.toContain('data-task-panel-effort-entries')
  })

  it('its controls call the existing server actions (and the new addSubtask)', () => {
    const src = read('components/tasks/task-detail-panel.tsx')
    expect(src).toContain('updateTaskField(data.id, "status", value)')
    expect(src).toContain('updateTaskField(data.id, "progress_pct", pct)')
    expect(src).toContain('setSubtaskCompleted(sub.id, done, data.id)')
    expect(src).toContain('<SubtaskForm parentTaskId={data.id} defaultPriority={data.priority} compact')
    expect(read('components/tasks/subtask-form.tsx')).toContain('actions.addSubtask(parentTaskId, built.input)')
    expect(src).toContain('<ManualEffortEntry taskId={data.id}')
  })
})

describe('every task list uses the shared pieces', () => {
  const surfaces: Record<string, string> = {
    'Task tracker': 'components/tasks/assigned-task-row.tsx',
    'My team': 'components/tasks/team-task-row.tsx',
    'My tasks': 'app/(dashboard)/tasks/page.tsx',
    'Home My tasks': 'components/home/home-tabs.tsx',
  }
  it.each(Object.entries(surfaces))('%s renders the detail panel and the quick actions', (_name, file) => {
    const src = read(file)
    expect(src).toContain('<TaskDetailPanel')
    expect(src).toContain('<TaskQuickActions')
    expect(src).not.toContain('InlineTaskWorkPlan')
  })
  it.each([
    ['Task tracker', 'app/(dashboard)/tasks/assigned/page.tsx', '<SortableTH'],
    ['My team', 'app/(dashboard)/tasks/team/page.tsx', '<SortableTH'],
    ['My tasks', 'app/(dashboard)/tasks/page.tsx', '<SortableTH'],
    ['Home My tasks', 'components/home/home-tabs.tsx', 'SortButton'],
  ])('%s has sortable headers', (_name, file, marker) => {
    expect(read(file)).toContain(marker)
  })
})

/* ── Services ── */

function seed() {
  return createMemorySupabase({
    tasks: [
      { id: 'mine', tenant_id: 'tenant-a', title: 'Mine', status: 'in_progress', priority: 'high', assignee_id: 'user-1', assigner_id: 'boss', deleted_at: null, is_workflow_task: false, event_id: null, actual_effort: 90, estimated_effort_assignee: 120, progress_pct: null, metadata: {} },
      { id: 'mine-sub', tenant_id: 'tenant-a', title: 'Child', status: 'completed', parent_task_id: 'mine', sequence: 1, deleted_at: null },
      { id: 'done', tenant_id: 'tenant-a', title: 'Done', status: 'completed', assignee_id: 'user-1', deleted_at: null },
      { id: 'others', tenant_id: 'tenant-a', title: 'Not mine', status: 'todo', assignee_id: 'user-2', assigner_id: 'user-3', deleted_at: null, is_workflow_task: false, event_id: null },
    ],
    users: [{ id: 'user-1', display_name: 'Me' }, { id: 'boss', display_name: 'The Boss' }],
    teams: [], effort_records: [], lifecycle_events: [], task_attachments: [], task_assignees: [], user_teams: [], user_memberships: [],
  })
}
type Db = ReturnType<typeof seed>
function ctx(db: Db, permissions: string[] = ['tasks.complete', 'tasks.view_own']): ServiceContext {
  return { db: db as any, supabase: db as any, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}

describe('addSubtask', () => {
  let db: Db
  beforeEach(() => { db = seed() })

  it('adds a subtask to my task: parent assignee and priority, next in order, accepted, logged on the parent', async () => {
    const result = await tasksService.addSubtask(ctx(db), 'mine', { title: '  Call supplier ' })
    expect(result.title).toBe('Call supplier')
    const created = db.tables.tasks!.find((t: any) => t.title === 'Call supplier')
    expect(created).toMatchObject({ tenant_id: 'tenant-a', parent_task_id: 'mine', status: 'todo', priority: 'high', assignee_id: 'user-1', assigner_id: 'user-1', acceptance_status: 'accepted', sequence: 2 })
    expect(db.tables.lifecycle_events).toEqual([expect.objectContaining({ task_id: 'mine', event_type: 'comment_added', metadata: expect.objectContaining({ source: 'subtask_added' }) })])
  })

  it('refuses without a title, on a closed task, without tasks.complete, or on a task out of reach', async () => {
    await expect(tasksService.addSubtask(ctx(db), 'mine', { title: '  ' })).rejects.toThrow(/title/)
    await expect(tasksService.addSubtask(ctx(db), 'done', { title: 'x' })).rejects.toThrow(/closed/)
    await expect(tasksService.addSubtask(ctx(db, ['tasks.view_own']), 'mine', { title: 'x' })).rejects.toThrow()
    await expect(tasksService.addSubtask(ctx(db), 'others', { title: 'x' })).rejects.toThrow(/not found/i)
    expect(db.tables.tasks!.length).toBe(4)
  })

  it('the action builds the task\'s own context (permission + reach checked in the service)', () => {
    const src = read('app/actions/tasks.ts')
    expect(src).toMatch(/export async function addSubtask[\s\S]*?tasksService\.addSubtask\(await fromSessionForTask\(parentTaskId\)/)
  })
})

describe('the panel read', () => {
  it('my task: effort logged vs estimate, subtasks, what I may change', async () => {
    const panel = await getTaskPanel(ctx(seed()), 'mine')
    expect(panel).not.toBeNull()
    expect(panel!.effort).toMatchObject({ loggedMinutes: 90, estimateMinutes: 120 })
    expect(panel!.subtasks).toMatchObject({ total: 1, completed: 1 })
    expect(panel!.progress).toEqual({ pct: 100, manual: null, fromSubtasks: true })
    expect(panel!.can).toEqual({ progress: true, status: true, effort: true, subtasks: true, addSubtask: true })
  })

  it('read-only without tasks.complete; nothing for a task out of reach', async () => {
    const viewer = await getTaskPanel(ctx(seed(), ['tasks.view_own']), 'mine')
    expect(Object.values(viewer!.can).some(Boolean)).toBe(false)
    expect(await getTaskPanel(ctx(seed()), 'others')).toBeNull()
  })
})
