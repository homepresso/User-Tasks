import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Quick actions on the task lists (Home My tasks, /tasks): which actions show
 * for which task and person (lib/tasks/quick-actions.ts — the server rules),
 * the panel's render, form validation, the server actions each action calls,
 * and the lists' Refresh button.
 */

const taskQueue = vi.hoisted(() => ({
  completeWorkflowTask: vi.fn(),
  respondToTask: vi.fn(async () => ({ success: true })),
  rerouteTask: vi.fn(),
  inviteToTask: vi.fn(),
}))
const tasksActions = vi.hoisted(() => ({ completeTaskWithOutcome: vi.fn() }))
vi.mock('@/app/actions/task-queue', () => taskQueue)
vi.mock('@/app/actions/tasks', () => tasksActions)
vi.mock('@/app/actions/home', () => ({ claimTask: vi.fn() }))

import { taskQuickActions, formRequirement, hasQuickActions, redirectSettings, type QuickActionsFacts, type QuickActionsTaskRow } from '@/lib/tasks/quick-actions'
import { TaskQuickActionsPanel, quickActionsQueryKey, quickFormError, runQuickAction, processViewHref, parseEmails } from '@/components/tasks/task-quick-actions'
import { refreshQueryKeys, refreshedLabel } from '@/components/tasks/list-refresh-button'
import { PermissionsProvider } from '@/lib/permissions-context'

const ME = 'user-me'

function task(over: Partial<QuickActionsTaskRow> = {}): QuickActionsTaskRow {
  return {
    id: 'task-1', title: 'Approve invoice', status: 'in_progress', assignee_id: ME, assignment_mode: 'individual',
    acceptance_status: 'accepted', allow_reassign: true, allow_escalate: true, available_outcomes: ['approved', 'rejected'],
    is_workflow_task: true, event_id: 'evt-1', workflow_run_id: 'run-1', metadata: {}, ...over,
  }
}
function facts(over: Partial<QuickActionsFacts> = {}): QuickActionsFacts {
  return { actorId: ME, canComplete: true, canViewRuns: false, mode: 'assignee', collaborator: null, participantCount: 1, manager: { id: 'boss', name: 'Priya Nair' }, ...over }
}

describe('which quick actions show', () => {
  it('a workflow task I own: its outcomes, redirect, escalate (manager first), Process view', () => {
    const info = taskQuickActions(task(), facts())
    expect(info.completeVia).toBe('quick')
    expect(info.outcomes).toEqual(['approved', 'rejected'])
    expect(info.redirect).toEqual({ mode: 'single', limit: null, allowEmail: false })
    expect(info.canEscalate).toBe(true)
    expect(info.escalateTo).toEqual({ id: 'boss', name: 'Priya Nair' })
    expect(info.processHref).toBe('/home/runs/run-1')
    expect(taskQuickActions(task(), facts({ canViewRuns: true })).processHref).toBe('/automations/runs/run-1')
    expect(info.invite).toBeNull() // single-person task
    expect(info.formHref).toBe('/tasks/task-1?tab=form')
  })

  it('a manual task: Mark complete (completed), no Process view', () => {
    const info = taskQuickActions(task({ is_workflow_task: false, event_id: null, workflow_run_id: null, available_outcomes: null }), facts({ mode: null }))
    expect(info.workflow).toBe(false)
    expect(info.completeVia).toBe('quick')
    expect(info.outcomes).toEqual(['completed'])
    expect(info.processHref).toBeNull()
  })

  it('allow_reassign false hides Redirect and Invite; allow_escalate false hides Escalate', () => {
    expect(taskQuickActions(task({ allow_reassign: false }), facts()).redirect).toBeNull()
    expect(taskQuickActions(task({ allow_reassign: null, metadata: { task_actions: { redirect_assignment_mode: 'many' } } }), facts()).invite).toBeNull()
    expect(taskQuickActions(task({ allow_escalate: false }), facts()).canEscalate).toBe(false)
    // allow_escalate unset = allowed (rerouteTask refuses only false)
    expect(taskQuickActions(task({ allow_escalate: null }), facts()).canEscalate).toBe(true)
  })

  it('redirect settings: many people, cap and email invite; Invite someone with the room left', () => {
    const metadata = { task_actions: { redirect_assignment_mode: 'many', redirect_recipient_limit_mode: 'capped', redirect_recipient_limit: 3, allow_invite_on_redirect: true } }
    expect(redirectSettings(metadata)).toEqual({ mode: 'many', limit: 3, allowEmail: true })
    const info = taskQuickActions(task({ metadata }), facts({ participantCount: 2 }))
    expect(info.redirect).toEqual({ mode: 'many', limit: 3, allowEmail: true })
    expect(info.invite).toEqual({ remaining: 1, allowEmail: true })
    expect(taskQuickActions(task({ metadata }), facts({ participantCount: 3 })).invite).toBeNull() // full
  })

  it('a queued task (waiting for my acceptance): no outcomes yet, Hold offered', () => {
    const info = taskQuickActions(task({ acceptance_status: 'pending' }), facts())
    expect(info.completeVia).toBe('none')
    expect(info.completeNote).toMatch(/Accept/)
    expect(info.canHold).toBe(true)
    expect(info.canResume).toBe(false)
    expect(taskQuickActions(task({ acceptance_status: 'held' }), facts()).canResume).toBe(true)
  })

  it('a collaborative task: membership and acceptance come from my task_assignees row', () => {
    const t = task({ assignment_mode: 'collaborative', assignee_id: 'someone-else' })
    expect(taskQuickActions(t, facts({ collaborator: null })).redirect).toBeNull()
    const mine = taskQuickActions(t, facts({ collaborator: { acceptance_status: 'pending' } }))
    expect(mine.redirect).not.toBeNull()
    expect(mine.canHold).toBe(true)
  })

  it('a task whose form must be filled: Open form to complete', () => {
    const metadata = { fields: [{ key: 'amount', label: 'Amount', type: 'number', required: true }] }
    const info = taskQuickActions(task({ metadata }), facts())
    expect(info.completeVia).toBe('form')
    expect(info.outcomes).toEqual([])
    expect(info.completeNote).toMatch(/Amount/)
    // Filled in already: quick outcomes again.
    expect(taskQuickActions(task({ metadata: { ...metadata, template_values: { amount: 12 } } }), facts()).completeVia).toBe('quick')
    // A form button bar or an external form completes on the task page.
    expect(formRequirement({ form_buttons: [{ id: 'submit', label: 'Submit', kind: 'submit', style: 'primary' }] })).toMatch(/buttons/)
    expect(formRequirement({ form_url: 'https://forms.example.com/x' })).toMatch(/external/)
    expect(formRequirement({})).toBeNull()
  })

  it('a manager acting on behalf completes on the task page (it asks for their reason); others see nothing', () => {
    const behalf = taskQuickActions(task({ assignee_id: 'report' }), facts({ mode: 'on_behalf' }))
    expect(behalf.completeVia).toBe('task')
    expect(behalf.redirect).toBeNull() // redirect / escalate are the assignee's
    expect(behalf.canEscalate).toBe(false)
    const none = taskQuickActions(task({ assignee_id: 'other' }), facts({ mode: 'none' }))
    expect(hasQuickActions(none)).toBe(false)
  })

  it('without tasks.complete, or on a closed task, nothing is offered', () => {
    expect(hasQuickActions(taskQuickActions(task(), facts({ canComplete: false })))).toBe(false)
    const closed = taskQuickActions(task({ status: 'completed' }), facts())
    expect(closed.closed).toBe(true)
    expect(hasQuickActions(closed)).toBe(false)
    expect(closed.processHref).toBe('/home/runs/run-1') // Process view stays
  })
})

describe('the panel', () => {
  function render(info: ReturnType<typeof taskQuickActions>, props: Record<string, unknown> = {}, perms: string[] = ['tasks.complete']) {
    const client = new QueryClient()
    client.setQueryData(quickActionsQueryKey(info.taskId), info)
    return renderToStaticMarkup(
      createElement(PermissionsProvider, { permissions: perms, userId: ME, children: null },
        createElement(QueryClientProvider, { client }, createElement(TaskQuickActionsPanel, { taskId: info.taskId, title: info.title, ...props }))),
    )
  }

  it('shows the outcomes, comment, Redirect / Escalate and the Open task / Process view links', () => {
    const html = render(taskQuickActions(task(), facts()))
    expect(html).toContain('data-quick-outcome="approved"')
    expect(html).toContain('data-quick-outcome="rejected"')
    expect(html).toContain('Approved')
    expect(html).toContain('data-quick-action="redirect"')
    expect(html).toContain('data-quick-action="escalate"')
    expect(html).not.toContain('data-quick-action="invite"')
    expect(html).toContain('href="/tasks/task-1"')
    expect(html).toContain('href="/home/runs/run-1"')
    expect(html).toContain('Process view')
  })

  it('hides what the flags refuse', () => {
    const html = render(taskQuickActions(task({ allow_reassign: false, allow_escalate: false }), facts()))
    expect(html).not.toContain('data-quick-action="redirect"')
    expect(html).not.toContain('data-quick-action="escalate"')
  })

  it('a form-required task links to its form instead of one-click outcomes', () => {
    const html = render(taskQuickActions(task({ metadata: { fields: [{ key: 'a', label: 'Amount', type: 'text', required: true }] } }), facts()))
    expect(html).toContain('data-quick-open-form')
    expect(html).toContain('Open form to complete')
    expect(html).toContain('href="/tasks/task-1?tab=form"')
    expect(html).not.toContain('data-quick-outcome=')
  })

  it('a manual task offers Mark complete', () => {
    const html = render(taskQuickActions(task({ is_workflow_task: false, event_id: null, workflow_run_id: null, available_outcomes: ['completed'] }), facts()))
    expect(html).toContain('Mark complete')
    expect(html).not.toContain('Process view')
  })

  it('a queued task keeps Accept / Decline (Claim for a team task) inside', () => {
    const queued = render(taskQuickActions(task({ acceptance_status: 'pending' }), facts()), { queueAction: 'accept' })
    expect(queued).toContain('data-queue-action="accept"')
    expect(queued).toContain('data-queue-action="decline"')
    expect(queued).toContain('data-quick-action="hold"')
    const claim = render(taskQuickActions(task({ assignee_id: null }), facts()), { queueAction: 'claim' })
    expect(claim).toContain('data-queue-action="claim"')
    expect(claim).not.toContain('data-quick-outcome=')
  })
})

describe('form validation', () => {
  it('a hold needs a reason (the server requires one)', () => {
    expect(quickFormError({ mode: 'hold', comment: '  ', chosen: 0, limit: null })).toMatch(/reason/)
    expect(quickFormError({ mode: 'hold', comment: 'Waiting on supplier', chosen: 0, limit: null })).toBeNull()
  })
  it('redirect / escalate / invite need someone, within the cap', () => {
    expect(quickFormError({ mode: 'escalate', comment: '', chosen: 0, limit: null })).toMatch(/escalate/)
    expect(quickFormError({ mode: 'redirect', comment: '', chosen: 0, limit: null })).toMatch(/Choose someone/)
    expect(quickFormError({ mode: 'invite', comment: '', chosen: 3, limit: 2 })).toMatch(/up to 2/)
    expect(quickFormError({ mode: 'redirect', comment: '', chosen: 1, limit: null })).toBeNull()
  })
  it('emails split on lines, commas and semicolons', () => {
    expect(parseEmails('a@x.com\nb@x.com, c@x.com; ')).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
  })
})

describe('the server actions each quick action calls', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('a workflow outcome → completeWorkflowTask with the comment; multi-response says it is waiting', async () => {
    taskQueue.completeWorkflowTask.mockResolvedValueOnce({ success: true, status: 'completed', workflowResumed: true })
    const done = await runQuickAction({ kind: 'outcome', taskId: 't', title: 'Invoice', workflow: true, outcome: 'approved', comment: ' ok ' })
    expect(taskQueue.completeWorkflowTask).toHaveBeenCalledWith('t', 'approved', 'ok')
    expect(done).toEqual({ done: true, tone: 'success', text: '“Invoice”: Approved.' })

    taskQueue.completeWorkflowTask.mockResolvedValueOnce({ success: true, status: 'waiting', responses: 1, needed: 3 })
    const waiting = await runQuickAction({ kind: 'outcome', taskId: 't', title: 'Invoice', workflow: true, outcome: 'approved' })
    expect(waiting.tone).toBe('info')
    expect(waiting.text).toContain('1 of 3')

    taskQueue.completeWorkflowTask.mockResolvedValueOnce({ success: false, status: 'error', error: 'Not yours' })
    await expect(runQuickAction({ kind: 'outcome', taskId: 't', title: 'x', workflow: true, outcome: 'approved' })).rejects.toThrow('Not yours')

    taskQueue.completeWorkflowTask.mockResolvedValueOnce({ success: false, status: 'invalid', errors: { a: 'Required' } })
    expect((await runQuickAction({ kind: 'outcome', taskId: 't', title: 'x', workflow: true, outcome: 'approved' })).done).toBe(false)
  })

  it('a manual task → completeTaskWithOutcome', async () => {
    tasksActions.completeTaskWithOutcome.mockResolvedValueOnce({ ok: true, data: { status: 'completed', outcome: 'completed' } })
    const r = await runQuickAction({ kind: 'outcome', taskId: 't', title: 'Order chairs', workflow: false, outcome: 'completed' })
    expect(tasksActions.completeTaskWithOutcome).toHaveBeenCalledWith('t', 'completed', null)
    expect(r.text).toBe('Completed “Order chairs”.')
    expect(taskQueue.completeWorkflowTask).not.toHaveBeenCalled()
  })

  it('hold / resume → respondToTask; a hold without a reason never reaches the server', async () => {
    await expect(runQuickAction({ kind: 'hold', taskId: 't', title: 'x', comment: ' ' })).rejects.toThrow(/reason/)
    expect(taskQueue.respondToTask).not.toHaveBeenCalled()
    await runQuickAction({ kind: 'hold', taskId: 't', title: 'x', comment: 'Supplier' })
    expect(taskQueue.respondToTask).toHaveBeenCalledWith('t', 'held', 'Supplier')
    await runQuickAction({ kind: 'resume', taskId: 't', title: 'x' })
    expect(taskQueue.respondToTask).toHaveBeenLastCalledWith('t', 'accepted')
  })

  it('redirect → rerouteTask("redirect") (one person, many, or email + invite)', async () => {
    taskQueue.rerouteTask.mockResolvedValueOnce({ success: true, redirected: true, targetUserName: 'Priya Nair' })
    const one = await runQuickAction({ kind: 'redirect', taskId: 't', many: false, personId: 'u2', comment: 'yours' })
    expect(taskQueue.rerouteTask).toHaveBeenCalledWith('t', 'redirect', { targetUserId: 'u2', comment: 'yours' })
    expect(one.text).toBe('Redirected to Priya Nair.')

    taskQueue.rerouteTask.mockResolvedValueOnce({ success: true, redirected: true, targetUserNames: ['A', 'B'] })
    const many = await runQuickAction({ kind: 'redirect', taskId: 't', many: true, userIds: ['a', 'b'] })
    expect(taskQueue.rerouteTask).toHaveBeenLastCalledWith('t', 'redirect', { targetUserIds: ['a', 'b'], comment: undefined })
    expect(many.text).toBe('Redirected to A, B.')

    taskQueue.rerouteTask.mockResolvedValueOnce({ success: true, invited: true, redirected: false, message: 'Invitation sent.' })
    const invited = await runQuickAction({ kind: 'redirect', taskId: 't', many: false, emails: ['new@x.com'] })
    expect(taskQueue.rerouteTask).toHaveBeenLastCalledWith('t', 'redirect', { targetEmail: 'new@x.com', inviteIfNeeded: true, comment: undefined })
    expect(invited).toEqual({ done: true, tone: 'info', text: 'Invitation sent.' })
  })

  it('escalate → rerouteTask("escalate") to the chosen person', async () => {
    taskQueue.rerouteTask.mockResolvedValueOnce({ success: true, redirected: true, targetUserName: null })
    const r = await runQuickAction({ kind: 'escalate', taskId: 't', personId: 'boss', personName: 'Priya Nair', comment: 'stuck' })
    expect(taskQueue.rerouteTask).toHaveBeenCalledWith('t', 'escalate', { targetUserId: 'boss', comment: 'stuck' })
    expect(r.text).toBe('Escalated to Priya Nair.')
  })

  it('invite someone → inviteToTask', async () => {
    taskQueue.inviteToTask.mockResolvedValueOnce({ success: true, addedNames: ['Sam'], invitations: [], message: 'Added Sam to the task.' })
    const r = await runQuickAction({ kind: 'invite', taskId: 't', userIds: ['sam'], comment: 'help' })
    expect(taskQueue.inviteToTask).toHaveBeenCalledWith('t', { userIds: ['sam'], comment: 'help' })
    expect(r).toEqual({ done: true, tone: 'success', text: 'Added Sam to the task.' })
  })

  it('Process view links the full run with workflows.view_runs, else the progress view', () => {
    expect(processViewHref('r1', true)).toBe('/automations/runs/r1')
    expect(processViewHref('r1', false)).toBe('/home/runs/r1')
  })
})

describe('list Refresh', () => {
  it('refetches the list keys and the nav counts', async () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    await refreshQueryKeys(client, [['tasks'], ['subtasks']])
    expect(spy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)).toEqual([['tasks'], ['subtasks'], ['nav-counts']])
  })
  it('says when the list was refreshed', () => {
    const now = Date.parse('2026-11-06T10:00:00Z')
    expect(refreshedLabel(now - 5_000, now)).toBe('Updated just now')
    expect(refreshedLabel(now - 5 * 60_000, now)).toBe('Updated 5 min ago')
  })
})
