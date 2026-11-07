/**
 * Process view task links render (components/automations/run-task-links):
 * the form icon only for tasks the viewer may open (with its tooltip /
 * aria-label), "Waiting for …" otherwise, people with statuses, the header
 * chip, the step history (outcome, on behalf, comment), and both surfaces
 * wiring them: the full run view's ProcessViewer (canvas adornments + User
 * Tasks list) and Home's RunProgressView.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RunTask } from '@/lib/run-tasks'
import { RunStepBadge, RunTaskHistory, RunTaskOpenLink, RunTaskPeople, RunTaskSteps, RunWaitingChip, openTaskLabel } from '@/components/automations/run-task-links'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))

const person = (id: string, name: string) => ({ id, name, avatar_url: null })
function task(over: Partial<RunTask> = {}): RunTask {
  return {
    id: 'tk1', node_id: 'approve', step_name: 'Approve invoice', title: 'Approve INV-7', status: 'waiting', open: true, has_form: true, team: null,
    assignees: [{ ...person('alice', 'Alice Ng'), role: 'assignee', status: 'in_progress' }],
    waiting_since: '2026-11-01T04:00:00Z', due_date: null, completed_at: null, completed_by: null, completed_on_behalf_of: null, outcome: null,
    can_open: true, can_act: 'assignee', access: 'assignee', on_behalf_of: null, href: '/tasks/tk1?tab=form', history: [],
    ...over,
  }
}
const html = (el: any) => renderToStaticMarkup(el)

describe('open-task icon', () => {
  it('links to the task (form tab) with tooltip text as aria-label', () => {
    const out = html(createElement(RunTaskOpenLink, { task: task() }))
    expect(out).toContain('href="/tasks/tk1?tab=form"')
    expect(out).toContain('aria-label="Open task — Approve INV-7 · assigned to Alice Ng"')
    expect(out).toContain('data-can-act="assignee"')
  })

  it('mentions acting on behalf for managers', () => {
    const t = task({ can_act: 'on_behalf', access: 'manager', on_behalf_of: person('alice', 'Alice Ng') })
    expect(openTaskLabel(t)).toBe('Open task — Approve INV-7 · assigned to Alice Ng · you can act on behalf of Alice Ng')
  })

  it('no link for someone who may not open it: "Waiting for …" instead', () => {
    const out = html(createElement(RunTaskOpenLink, { task: task({ can_open: false, can_act: 'none', access: null, href: null, title: null }) }))
    expect(out).not.toContain('href=')
    expect(out).toContain('Waiting for Alice Ng')
  })

  it('nothing for a closed task', () => {
    expect(html(createElement(RunTaskOpenLink, { task: task({ open: false, status: 'completed' }) }))).toBe('')
  })
})

describe('people, chip, history', () => {
  it('collapses many assignees to "Name +N"; team or Unassigned when nobody', () => {
    const many = task({ assignees: [
      { ...person('p', 'Priya Nair'), role: 'collaborator', status: 'done' },
      { ...person('t', 'Tom Lee'), role: 'collaborator', status: 'queued' },
      { ...person('a', 'Ana Ruiz'), role: 'candidate', status: 'queued' },
    ] })
    expect(html(createElement(RunTaskPeople, { task: many }))).toContain('Priya Nair +2')
    expect(html(createElement(RunTaskPeople, { task: task({ assignees: [], team: 'Payments' }) }))).toContain('Payments')
    expect(html(createElement(RunTaskPeople, { task: task({ assignees: [] }) }))).toContain('Unassigned')
    expect(html(createElement(RunTaskPeople, { task: task() }))).toContain('In progress')
  })

  it('header chip: "Waiting at: step · who" with the icon', () => {
    const out = html(createElement(RunWaitingChip, { tasks: [task(), task({ id: 'tk2', open: false, status: 'completed' })] }))
    expect(out).toContain('Waiting at: <span class="font-medium">Approve invoice</span> · Alice Ng')
    expect(out.match(/data-open-task=/g)).toHaveLength(1)
    expect(html(createElement(RunWaitingChip, { tasks: [task({ open: false, status: 'completed' })] }))).toBe('')
  })

  it('history: who, on behalf of whom, outcome badge, comment, redirects', () => {
    const t = task({ open: false, status: 'completed', history: [
      { kind: 'response', at: '2026-11-01T03:00:00Z', actor: person('mia', 'Mia Park'), on_behalf_of: person('ana', 'Ana Ruiz'), outcome: 'approved', comment: 'Ana is on leave', from: [], to: [] },
      { kind: 'redirected', at: '2026-11-01T02:00:00Z', actor: person('tom', 'Tom Lee'), on_behalf_of: null, outcome: null, comment: 'Vendor owner', from: ['Tom Lee'], to: ['Priya Nair'], },
    ] })
    const out = html(createElement(RunTaskHistory, { task: t }))
    expect(out).toContain('Mia Park')
    expect(out).toContain('on behalf of Ana Ruiz')
    expect(out).toContain('data-tone="success"')
    expect(out).toContain('Approved')
    expect(out).toContain('Ana is on leave')
    expect(out).toContain('Redirected')
    expect(out).toContain('Priya Nair')
  })

  it('redacted history (no outcome): "responded" with who', () => {
    const t = task({ open: false, status: 'completed', can_open: false, history: [
      { kind: 'response', at: '2026-11-01T03:00:00Z', actor: person('ben', 'Ben Ode'), on_behalf_of: null, outcome: null, comment: null, from: [], to: [] },
    ] })
    const out = html(createElement(RunTaskHistory, { task: t }))
    expect(out).toContain('Ben Ode')
    expect(out).toContain('responded')
    expect(out).not.toContain('data-history-comment')
  })

  it('step list and canvas badge', () => {
    const tasks = [task({ id: 'done', node_id: 'review', step_name: 'Review', open: false, status: 'completed', completed_by: person('ben', 'Ben Ode') }), task()]
    const list = html(createElement(RunTaskSteps, { tasks }))
    expect(list).toContain('Review')
    expect(list).toContain('Completed')
    expect(list).toContain('Waiting')
    expect(list).toContain('href="/tasks/tk1?tab=form"')
    expect(html(createElement(RunStepBadge, { tasks: [tasks[0]] }))).toContain('Ben Ode')
    expect(html(createElement(RunStepBadge, { tasks: [tasks[1]] }))).toContain('data-open-task="tk1"')
  })
})

describe('both Process view surfaces render the links', () => {
  it('full run view: ProcessViewer draws the canvas badges and the User Tasks list', async () => {
    const { ProcessViewer } = await import('@/components/automations/process-viewer')
    const workflow = { id: 'wf1', nodes: [{ id: 'approve', type: 'user_task', label: 'Approve invoice', position: { x: 0, y: 100 }, config: {} }], edges: [] }
    const run = { id: 'r1', status: 'waiting_for_event', paused_node_id: 'approve', node_results: {}, execution_trace: [], started_at: '2026-11-01T00:00:00Z' }
    const client = new QueryClient()
    const out = html(createElement(QueryClientProvider, { client }, createElement(ProcessViewer, { workflow, run, logs: [], tasks: [task()] })))
    expect(out).toContain('User Tasks')
    expect(out).toContain('data-node-adornment="approve"')
    expect(out).toContain('href="/tasks/tk1?tab=form"')
  })

  it('Home run progress: chip and steps carry the icon', async () => {
    const { RunProgressView } = await import('@/components/home/run-progress-view')
    const client = new QueryClient()
    client.setQueryData(['home', 'runProgress', 'r1'], {
      run: { id: 'r1', status: 'waiting', status_label: 'Waiting', started_at: null, completed_at: null, updated_at: null },
      process: { name: 'Invoice approval' },
      flow: { nodes: [], edges: [], sections: [], overlay: { nodes: {}, edges: {} } },
      stages: [{ node_id: 'approve', name: 'Approve invoice', assignees: [{ id: 'alice', name: 'Alice Ng' }], team: null, since: null, due_date: null }],
      steps: [], submission: null, following: false, can_view_full: false,
      tasks: [task()],
    })
    const out = html(createElement(QueryClientProvider, { client }, createElement(RunProgressView, { runId: 'r1' })))
    expect(out).toContain('data-waiting-chip')
    expect(out.match(/href="\/tasks\/tk1\?tab=form"/g)!.length).toBeGreaterThanOrEqual(2)
  })
})
