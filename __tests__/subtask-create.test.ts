/**
 * Rich subtasks (lib/services/tasks addSubtask / updateSubtask /
 * listSubtasks, lib/tasks/subtask-input, components/tasks/subtask-form):
 *  - who can add: anyone who can work on the task (tasks.complete + reach —
 *    assignee, collaborator, the assignee's manager, admin / tasks.view_all,
 *    the creator); viewers and people outside the task can't; closed
 *    parents refused; a depth cap
 *  - workflow tasks allowed, the workflow untouched (the subtask isn't a
 *    workflow task; the parent never auto-completes from its subtasks)
 *  - the fields: title + optional subtitle, description, estimate, due
 *    date, priority, tags — validated
 *  - parent progress follows the ticks
 *  - REST /tasks/{id}/subtasks, MCP tasks_*_subtask(s)
 *  - the quick-add form on the task page and in the lists' panel
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

vi.mock('@/app/actions/tasks', () => ({ addSubtask: vi.fn(), updateSubtask: vi.fn(), setSubtaskCompleted: vi.fn() }))
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import * as tasksService from '@/lib/services/tasks'
import { activityText, getTaskPanel, panelPermissions } from '@/lib/services/task-panel'
import { effortInputText, parseEffortInput, SUBTASK_MAX_DEPTH, validateSubtaskInput } from '@/lib/tasks/subtask-input'
import { addSubtaskEndpoint, subtaskCreateBody } from '@/lib/api-schemas/task-subtasks'
import { GET as listRoute, POST as addRoute } from '@/app/api/v1/tasks/[id]/subtasks/route'
import { PATCH as patchRoute } from '@/app/api/v1/tasks/[id]/subtasks/[subtaskId]/route'
import { createMcpServer } from '@/lib/mcp/server'
import { SubtaskForm, subtaskInputFromDraft } from '@/components/tasks/subtask-form'
import { TaskTree } from '@/components/tasks/task-tree'
import { taskSubtaskTools } from '@/lib/assistants/tools/task-subtasks'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

const ROOT = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

function seed() {
  return createMemorySupabase({
    tasks: [
      { id: 'std', tenant_id: 'tenant-a', title: 'Prepare launch', status: 'in_progress', priority: 'high', assignee_id: 'u-assignee', assigner_id: 'u-creator', parent_task_id: null, deleted_at: null, is_workflow_task: false, event_id: null, workflow_id: null, workflow_run_id: null, progress_pct: null, metadata: {} },
      { id: 'wf', tenant_id: 'tenant-a', title: 'Approve invoice', status: 'todo', priority: 'medium', assignee_id: 'u-assignee', assigner_id: null, parent_task_id: null, deleted_at: null, is_workflow_task: true, event_id: 'ev-1', workflow_id: null, workflow_run_id: null, progress_pct: null, metadata: {} },
      { id: 'closed', tenant_id: 'tenant-a', title: 'Old', status: 'completed', priority: 'low', assignee_id: 'u-assignee', assigner_id: 'u-creator', parent_task_id: null, deleted_at: null, is_workflow_task: false, event_id: null, workflow_id: null, workflow_run_id: null },
    ],
    task_assignees: [
      { tenant_id: 'tenant-a', task_id: 'std', user_id: 'u-collab' },
      { tenant_id: 'tenant-a', task_id: 'wf', user_id: 'u-collab' },
    ],
    user_memberships: [{ tenant_id: 'tenant-a', user_id: 'u-assignee', manager_user_id: 'u-manager', is_active: true }],
    users: [{ id: 'u-assignee', display_name: 'Priya' }],
    teams: [], user_teams: [], lifecycle_events: [], effort_records: [], task_attachments: [], object_permissions: [],
  })
}
type Db = ReturnType<typeof seed>
const WORKER = ['tasks.complete', 'tasks.view_own']
function ctx(db: Db, actorId: string, permissions: string[] = WORKER): ServiceContext {
  return { db: db as any, supabase: db as any, tenantId: 'tenant-a', actorId, permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}
const subtasksOf = (db: Db, parent: string) => db.tables.tasks!.filter((t: any) => t.parent_task_id === parent)

/* ── Validation ── */

describe('subtask fields', () => {
  it('title is required (trimmed, at most 500); everything else is optional', () => {
    expect(validateSubtaskInput({ title: '  ' })).toMatchObject({ ok: false, errors: { title: expect.any(String) } })
    expect(validateSubtaskInput({ title: 'x'.repeat(501) })).toMatchObject({ ok: false })
    expect(validateSubtaskInput({ title: ' Call supplier ' })).toEqual({ ok: true, values: { title: 'Call supplier' } })
  })

  it('checks lengths, the estimate range, dates, priority and tags', () => {
    const bad = validateSubtaskInput({
      title: 'x', subtitle: 's'.repeat(201), description: 'd'.repeat(20_001), estimated_effort_minutes: -5,
      due_date: 'not a date', priority: 'urgent', tags: Array.from({ length: 21 }, (_, i) => `t${i}`),
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['description', 'due_date', 'estimated_effort_minutes', 'priority', 'subtitle', 'tags'])
    expect(validateSubtaskInput({ title: 'x', estimated_effort_minutes: 1.5 }).ok).toBe(false)
    expect(validateSubtaskInput({ title: 'x', estimated_effort_minutes: 525_601 }).ok).toBe(false)
    expect(validateSubtaskInput({ title: 'x', due_date: '1999-12-31' }).ok).toBe(false)
    expect(validateSubtaskInput({ title: 'x', tags: ['y'.repeat(51)] }).ok).toBe(false)
  })

  it('normalises: blanks → null, 0 minutes → none, tags de-duplicated, HTML sanitised', () => {
    const result = validateSubtaskInput({
      title: 'x', subtitle: '  Short   summary ', description: '<p>Hi<script>alert(1)</script></p>', estimated_effort_minutes: 0,
      due_date: '2026-12-01', priority: 'low', tags: [' a', 'a', '', 'b'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.values).toMatchObject({ subtitle: 'Short summary', estimated_effort_assigner: null, due_date: '2026-12-01T00:00:00.000Z', priority: 'low', tags: ['a', 'b'] })
    expect(result.values.description).toContain('<p>Hi')
    expect(result.values.description).not.toContain('script')
    expect(validateSubtaskInput({ title: 'x', subtitle: '', description: '  ', tags: [] })).toEqual({ ok: true, values: { title: 'x', subtitle: null, description: null, tags: null } })
  })

  it('partial (edit): only the given fields; the title can be left out but not emptied', () => {
    expect(validateSubtaskInput({ subtitle: 'New' }, { partial: true })).toEqual({ ok: true, values: { subtitle: 'New' } })
    expect(validateSubtaskInput({ title: '' }, { partial: true }).ok).toBe(false)
  })

  it('the estimate box reads hours or hours and minutes', () => {
    expect(parseEffortInput('1.5')).toBe(90)
    expect(parseEffortInput('1h 30m')).toBe(90)
    expect(parseEffortInput('45m')).toBe(45)
    expect(parseEffortInput('2h')).toBe(120)
    expect(parseEffortInput('')).toBeNull()
    expect(parseEffortInput('soon')).toBeNaN()
    expect(effortInputText(90)).toBe('1.5')
    expect(effortInputText(null)).toBe('')
  })
})

/* ── Who can add ── */

describe('who can add subtasks', () => {
  let db: Db
  beforeEach(() => { db = seed() })

  it('the rule: tasks.complete + reach, open, within the depth cap', () => {
    expect(tasksService.canAddSubtask({ canComplete: true, reachable: true, closed: false })).toBe(true)
    expect(tasksService.canAddSubtask({ canComplete: false, reachable: true, closed: false })).toBe(false)
    expect(tasksService.canAddSubtask({ canComplete: true, reachable: false, closed: false })).toBe(false)
    expect(tasksService.canAddSubtask({ canComplete: true, reachable: true, closed: true })).toBe(false)
    expect(tasksService.canAddSubtask({ canComplete: true, reachable: true, closed: false, depth: SUBTASK_MAX_DEPTH })).toBe(false)
    // The lists' panel offers it on the same rule — workflow tasks included.
    expect(panelPermissions({ canComplete: true, reachable: true, closed: false, workflow: true }).can.addSubtask).toBe(true)
    expect(panelPermissions({ canComplete: false, reachable: true, closed: false, workflow: false }).can.addSubtask).toBe(false)
  })

  it.each([
    ['the assignee', 'u-assignee', WORKER],
    ['a collaborator', 'u-collab', WORKER],
    ['the assignee\'s manager (on their behalf)', 'u-manager', WORKER],
    ['the creator / assigner', 'u-creator', WORKER],
    ['an admin (tasks.view_all)', 'u-admin', [...WORKER, 'tasks.view_all']],
  ])('%s can', async (_who, actor, perms) => {
    const sub = await tasksService.addSubtask(ctx(db, actor, perms), 'std', { title: `By ${actor}` })
    expect(sub).toMatchObject({ title: `By ${actor}`, parent_task_id: 'std', assignee_id: 'u-assignee' })
    expect(subtasksOf(db, 'std').find((t: any) => t.title === `By ${actor}`)).toMatchObject({ assigner_id: actor, acceptance_status: 'accepted' })
  })

  it('a viewer (no tasks.complete) and someone outside the task cannot', async () => {
    await expect(tasksService.addSubtask(ctx(db, 'u-assignee', ['tasks.view_own']), 'std', { title: 'x' })).rejects.toThrow(/tasks\.complete/)
    await expect(tasksService.addSubtask(ctx(db, 'u-other'), 'std', { title: 'x' })).rejects.toThrow(/not found/i)
    // Seeing every task is not working on it: oversight without tasks.complete is read-only.
    await expect(tasksService.addSubtask(ctx(db, 'u-auditor', ['tasks.view_own', 'tasks.view_all']), 'std', { title: 'x' })).rejects.toThrow()
    expect(subtasksOf(db, 'std')).toHaveLength(0)
  })

  it('closed parents are refused; subtasks nest up to the depth cap', async () => {
    await expect(tasksService.addSubtask(ctx(db, 'u-assignee'), 'closed', { title: 'x' })).rejects.toThrow(/closed/)
    let parent = 'std'
    for (let level = 1; level <= SUBTASK_MAX_DEPTH; level += 1) {
      parent = (await tasksService.addSubtask(ctx(db, 'u-assignee'), parent, { title: `Level ${level}` })).id
    }
    await expect(tasksService.addSubtask(ctx(db, 'u-assignee'), parent, { title: 'Too deep' })).rejects.toThrow(/levels deep/)
    // Reaching the top task reaches its subtasks (a manager adds under a nested one).
    expect((await tasksService.listSubtasks(ctx(db, 'u-manager'), parent)).can_add).toBe(false)
  })
})

/* ── Fields, workflow tasks, progress ── */

describe('adding and editing subtasks', () => {
  let db: Db
  beforeEach(() => { db = seed() })

  it('stores every field; priority defaults to the parent\'s; logged on the parent', async () => {
    const sub = await tasksService.addSubtask(ctx(db, 'u-assignee'), 'std', {
      title: 'Draft press release', subtitle: 'One page', description: '<p><strong>Angle</strong>: speed</p>',
      estimated_effort_minutes: 90, due_date: '2026-12-01', tags: ['comms'],
    })
    expect(sub).toMatchObject({ title: 'Draft press release', subtitle: 'One page', priority: 'high', estimated_effort_minutes: 90, tags: ['comms'], sequence: 1, status: 'todo' })
    expect(sub.description).toContain('<strong>Angle</strong>')
    expect(sub.due_date).toBe('2026-12-01T00:00:00.000Z')
    const row = subtasksOf(db, 'std')[0]
    expect(row).toMatchObject({ estimated_effort_assigner: 90, subtitle: 'One page' })
    expect((await tasksService.addSubtask(ctx(db, 'u-assignee'), 'std', { title: 'Second', priority: 'low' }))).toMatchObject({ priority: 'low', sequence: 2 })
    expect(db.tables.lifecycle_events).toEqual(expect.arrayContaining([expect.objectContaining({ task_id: 'std', metadata: expect.objectContaining({ source: 'subtask_added' }) })]))
    await expect(tasksService.addSubtask(ctx(db, 'u-assignee'), 'std', { title: 'x', estimated_effort_minutes: -1 })).rejects.toThrow(/Invalid subtask/)
  })

  it('workflow tasks take subtasks, and the workflow is untouched', async () => {
    const before = JSON.stringify(db.tables.tasks!.find((t: any) => t.id === 'wf'))
    const sub = await tasksService.addSubtask(ctx(db, 'u-collab'), 'wf', { title: 'Check PO number', estimated_effort_minutes: 15 })
    const row = subtasksOf(db, 'wf')[0]
    expect(row.is_workflow_task).toBeFalsy()
    expect(row.event_id ?? null).toBeNull()
    expect(row.workflow_run_id ?? null).toBeNull()
    await tasksService.setSubtaskCompleted(ctx(db, 'u-collab'), sub.id, true, { logToTaskId: 'wf' })
    const wf = db.tables.tasks!.find((t: any) => t.id === 'wf')
    expect(JSON.stringify({ ...wf })).toBe(before)
    // No workflow queue writes, no run resumed.
    expect(db.calls.filter((c) => c.table !== 'tasks' && c.table !== 'lifecycle_events')).toEqual([])
    // The database never auto-completes a workflow task from its subtasks.
    const sql = read('supabase/migrations/20270104000000_task_subtask_fields.sql')
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_auto_complete_parent[\s\S]*NOT \(COALESCE\(NEW\.is_workflow_task, false\) AND NEW\.event_id IS NOT NULL\)/)
  })

  it('ticking subtasks updates the parent\'s progress', async () => {
    const a = await tasksService.addSubtask(ctx(db, 'u-assignee'), 'std', { title: 'A' })
    await tasksService.addSubtask(ctx(db, 'u-assignee'), 'std', { title: 'B' })
    await tasksService.setSubtaskCompleted(ctx(db, 'u-assignee'), a.id, true, { logToTaskId: 'std' })
    const panel = await getTaskPanel(ctx(db, 'u-assignee'), 'std')
    expect(panel!.subtasks).toMatchObject({ total: 2, completed: 1 })
    expect(panel!.progress).toEqual({ pct: 50, manual: null, fromSubtasks: true })
    const list = await tasksService.listSubtasks(ctx(db, 'u-assignee'), 'std')
    expect(list).toMatchObject({ total: 2, completed: 1, can_add: true })
  })

  it('progress the database keeps in step with the subtasks is not a manual override', async () => {
    const a = await tasksService.addSubtask(ctx(db, 'u-assignee'), 'std', { title: 'A' })
    await tasksService.addSubtask(ctx(db, 'u-assignee'), 'std', { title: 'B' })
    await tasksService.setSubtaskCompleted(ctx(db, 'u-assignee'), a.id, true)
    const parent = db.tables.tasks!.find((t: any) => t.id === 'std')!
    parent.progress_pct = 50 // what trg_task_progress writes
    expect((await getTaskPanel(ctx(db, 'u-assignee'), 'std'))!.progress).toEqual({ pct: 50, manual: null, fromSubtasks: true })
    parent.progress_pct = 80 // set by hand
    expect((await getTaskPanel(ctx(db, 'u-assignee'), 'std'))!.progress).toEqual({ pct: 80, manual: 80, fromSubtasks: false })
    expect(activityText({ event_type: 'comment_added', metadata: { source: 'subtask_added', message: 'Added subtask “A”' } })).toBe('Added subtask “A”')
  })

  it('the panel rows carry the subtitle and estimate', async () => {
    await tasksService.addSubtask(ctx(db, 'u-assignee'), 'std', { title: 'A', subtitle: 'Why', estimated_effort_minutes: 30 })
    const panel = await getTaskPanel(ctx(db, 'u-assignee'), 'std')
    expect(panel!.subtasks.items[0]).toMatchObject({ title: 'A', subtitle: 'Why', estimateMinutes: 30, childCount: 0 })
  })

  it('edits only the fields given (same people as adding; must be this parent\'s subtask)', async () => {
    const sub = await tasksService.addSubtask(ctx(db, 'u-assignee'), 'std', { title: 'A', subtitle: 'Old', estimated_effort_minutes: 30 })
    const edited = await tasksService.updateSubtask(ctx(db, 'u-manager'), sub.id, { subtitle: 'New', estimated_effort_minutes: 60, priority: 'critical' })
    expect(edited).toMatchObject({ title: 'A', subtitle: 'New', estimated_effort_minutes: 60, priority: 'critical' })
    await expect(tasksService.updateSubtask(ctx(db, 'u-other'), sub.id, { subtitle: 'x' })).rejects.toThrow(/not found/i)
    await expect(tasksService.updateSubtask(ctx(db, 'u-assignee'), sub.id, { subtitle: 'x' }, { parentTaskId: 'wf' })).rejects.toThrow(/not found/i)
    await expect(tasksService.updateSubtask(ctx(db, 'u-assignee'), sub.id, {})).rejects.toThrow(/No fields/)
    await expect(tasksService.updateSubtask(ctx(db, 'u-assignee'), 'std', { subtitle: 'x' })).rejects.toThrow(/not found/i)
  })
})

/* ── REST and MCP ── */

describe('REST /api/v1/tasks/{id}/subtasks', () => {
  const mockedValidate = vi.mocked(validateApiKey)
  function authAs(db: Db, actingUserId: string | null, permissions = WORKER) {
    mockedValidate.mockResolvedValue({
      success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: actingUserId ? 'user' : 'tenant', createdBy: 'u-creator', actingUserId,
      scopes: { workflow_ids: [], table_ids: [] }, permissions,
      supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
    } as ApiKeySuccessResult)
  }
  const req = (p: string, method = 'GET', body?: unknown) => new NextRequest(`https://app.test/api/v1${p}`, {
    method, headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) })

  it('the body schema carries the new fields and their limits', () => {
    expect(addSubtaskEndpoint.path).toBe('/tasks/{id}/subtasks')
    expect(subtaskCreateBody.safeParse({ title: 'x', subtitle: 'y', description: 'z', estimated_effort_minutes: 90, due_date: '2026-12-01', priority: 'low', tags: ['a'] }).success).toBe(true)
    expect(subtaskCreateBody.safeParse({ title: 'x', subtitle: 's'.repeat(201) }).success).toBe(false)
    expect(subtaskCreateBody.safeParse({ title: 'x', estimated_effort_minutes: 1.5 }).success).toBe(false)
  })

  it('POST adds (201), GET lists with can_add, PATCH edits; 400 / 404 as expected', async () => {
    const db = seed()
    authAs(db, 'u-collab')
    const created = await addRoute(req('/tasks/wf/subtasks', 'POST', { title: 'Check PO', subtitle: 'Against the contract', estimated_effort_minutes: 20 }), params({ id: 'wf' }))
    expect(created.status).toBe(201)
    const sub = (await created.json()).data.subtask
    expect(sub).toMatchObject({ title: 'Check PO', subtitle: 'Against the contract', estimated_effort_minutes: 20, parent_task_id: 'wf' })

    const list = await (await listRoute(req('/tasks/wf/subtasks'), params({ id: 'wf' }))).json()
    expect(list.data).toMatchObject({ total: 1, can_add: true })

    const patched = await patchRoute(req(`/tasks/wf/subtasks/${sub.id}`, 'PATCH', { due_date: '2026-12-24' }), params({ id: 'wf', subtaskId: sub.id }))
    expect((await patched.json()).data.subtask.due_date).toBe('2026-12-24T00:00:00.000Z')

    expect((await addRoute(req('/tasks/wf/subtasks', 'POST', { title: '' }), params({ id: 'wf' }))).status).toBe(400)
    authAs(db, 'u-other')
    expect((await addRoute(req('/tasks/wf/subtasks', 'POST', { title: 'x' }), params({ id: 'wf' }))).status).toBe(404)
    authAs(db, 'u-assignee', ['tasks.view_own'])
    expect((await addRoute(req('/tasks/wf/subtasks', 'POST', { title: 'x' }), params({ id: 'wf' }))).status).toBe(403)
  })
})

describe('MCP subtask tools', () => {
  function server(db: Db, actingUserId: string, permissions = WORKER) {
    return createMcpServer({ tenantId: 'tenant-a', supabase: db, actingUserId, keyType: 'user', permissions })
  }

  it('registers list / add / update with the new fields', () => {
    const tools = new Map(server(seed(), 'u-assignee').getRegisteredTools().map((t) => [t.name, t]))
    expect(Object.keys(tools.get('tasks_add_subtask')!.inputSchema.properties)).toEqual(
      expect.arrayContaining(['task_id', 'title', 'subtitle', 'description', 'estimated_effort_minutes', 'due_date', 'priority', 'tags']))
    expect(tools.has('tasks_update_subtask')).toBe(true)
    expect(tools.has('tasks_subtasks_list')).toBe(true)
  })

  it('adds through the same service and rules', async () => {
    const db = seed()
    const ok = await server(db, 'u-manager').callTool('tasks_add_subtask', { task_id: 'std', title: 'Book venue', subtitle: 'Max 50 people', estimated_effort_minutes: 60 })
    expect(ok.isError).toBeFalsy()
    expect(JSON.parse(ok.content[0].text)).toMatchObject({ created: true, subtask: { title: 'Book venue', subtitle: 'Max 50 people', estimated_effort_minutes: 60 } })
    expect((await server(db, 'u-other').callTool('tasks_add_subtask', { task_id: 'std', title: 'x' })).isError).toBe(true)
    expect((await server(db, 'u-assignee', ['tasks.view_own']).callTool('tasks_add_subtask', { task_id: 'std', title: 'x' })).isError).toBe(true)
  })
})

describe('the Agent\'s task_add_subtasks', () => {
  const TASK = '0b000000-0000-4000-8000-000000000001'
  function agentDb() {
    const db = seed()
    db.tables.tasks!.push({ id: TASK, tenant_id: 'tenant-a', title: 'Plan offsite', status: 'todo', priority: 'medium', assignee_id: 'u-assignee', assigner_id: null, parent_task_id: null, deleted_at: null, is_workflow_task: true, event_id: 'ev-9', workflow_id: null, workflow_run_id: null })
    return db
  }

  it('a confirmation card lists what will be added; run adds them through the service', async () => {
    const db = agentDb()
    const [tool] = taskSubtaskTools({ ctx: ctx(db, 'u-assignee'), taskId: TASK })
    expect(tool.mode).toBe('write')
    const args = { subtasks: [{ title: 'Book venue', subtitle: 'Max 50', estimated_effort_minutes: 90 }, { title: 'Send invites', due_date: '2026-12-01' }] }
    const card = await tool.confirm!(args)
    expect(card).toMatchObject({ title: 'Add 2 subtasks to “Plan offsite”', confirm_label: 'Add 2 subtasks' })
    expect(card.lines).toEqual(['Book venue — Max 50 · 1.5h', 'Send invites · due 2026-12-01'])
    const emitted: any[] = []
    await tool.run(args, { emit: (e: any) => emitted.push(e), toolCallId: 'c1' } as any)
    expect(subtasksOf(db, TASK).map((t: any) => t.title)).toEqual(['Book venue', 'Send invites'])
    expect(emitted[0]).toMatchObject({ type: 'changed', id: TASK })
  })

  it('refuses before the card for a viewer, someone outside the task, or bad fields', async () => {
    const db = agentDb()
    const args = { subtasks: [{ title: 'x' }] }
    await expect(taskSubtaskTools({ ctx: ctx(db, 'u-other'), taskId: TASK })[0].confirm!(args)).rejects.toThrow(/not found/i)
    await expect(taskSubtaskTools({ ctx: ctx(db, 'u-assignee', ['tasks.view_own']), taskId: TASK })[0].confirm!(args)).rejects.toThrow(/can't add/)
    await expect(taskSubtaskTools({ ctx: ctx(db, 'u-assignee'), taskId: TASK })[0].confirm!({ subtasks: [{ title: '' }] })).rejects.toThrow(/Subtask 1/)
  })
})

/* ── UI ── */

describe('the quick-add form', () => {
  it('title first with Enter to add, a More details disclosure, Add and Add another', () => {
    const html = renderToStaticMarkup(createElement(SubtaskForm, { parentTaskId: 'std', defaultPriority: 'high' }))
    expect(html).toContain('data-subtask-title')
    expect(html).toContain('Enter to add')
    expect(html).toContain('More details')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-subtask-add-another')
    expect(html).not.toContain('data-subtask-subtitle')
  })

  it('edit mode shows every field, filled in', () => {
    const html = renderToStaticMarkup(createElement(SubtaskForm, {
      parentTaskId: 'std', subtaskId: 's1',
      initial: { title: 'A', subtitle: 'Why', estimated_effort_minutes: 90, due_date: '2026-12-01T12:00:00Z', priority: 'low', tags: ['x', 'y'] },
    }))
    expect(html).toContain('value="Why"')
    expect(html).toContain('value="1.5"')
    expect(html).toContain('value="2026-12-01"')
    expect(html).toContain('value="x, y"')
    expect(html).toContain('data-subtask-save')
  })

  it('turns the draft into the service input (edit: only what changed)', () => {
    const draft = { title: 'A', subtitle: '', description: '', effort: '1h 15m', due: '2026-12-01', priority: 'high', tags: 'a, b' }
    expect(subtaskInputFromDraft(draft)).toEqual({ input: { title: 'A', subtitle: null, description: null, estimated_effort_minutes: 75, due_date: '2026-12-01T12:00:00.000Z', priority: 'high', tags: ['a', 'b'] } })
    expect(subtaskInputFromDraft({ ...draft, subtitle: 'New' }, draft)).toEqual({ input: { subtitle: 'New' } })
    expect(subtaskInputFromDraft({ ...draft, effort: 'soon' })).toHaveProperty('error')
  })

  it('the task page tree shows subtitle and estimate, with Add subtask / Edit for people who can', () => {
    const base = { parent_task_id: 'root', progress_pct: 0, child_count: 0, completed_child_count: 0, actual_effort: 0, assignee_id: null }
    const render = (canAdd: boolean) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TaskTree, {
      task: { id: 'root', title: 'Root', status: 'todo', parent_task_id: null, sequence: 0, progress_pct: 0, child_count: 1, completed_child_count: 0, estimated_effort_assigner: null, actual_effort: 0, assignee_id: null },
      subtasks: [{ ...base, id: 's1', title: 'Book venue', subtitle: 'Max 50 people', status: 'todo', sequence: 1, estimated_effort_assigner: 90 }],
      totalCount: 2, completedCount: 0, canAdd, canEdit: canAdd,
    })))
    const html = render(true)
    expect(html).toContain('Max 50 people')
    expect(html).toContain('1.5h')
    expect(html).toContain('data-task-tree-add')
    expect(html).toContain('data-task-tree-edit-button')
    const readOnly = render(false)
    expect(readOnly).not.toContain('data-task-tree-add')
    expect(readOnly).not.toContain('data-task-tree-edit-button')
  })

  it('the task page and the lists\' panel both use it', () => {
    expect(read('components/tasks/task-tree.tsx')).toContain('<SubtaskForm')
    expect(read('components/tasks/task-detail-panel.tsx')).toContain('<SubtaskForm')
    expect(read('app/(dashboard)/tasks/[id]/page.tsx')).toContain('canAdd={data.canAddSubtasks === true}')
  })
})
