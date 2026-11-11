/**
 * Timeline (lib/services/run-timeline.ts, lib/run-timeline.ts): the builder
 * from fixtures (a form-started purchase request: manager approval after a
 * reassignment and a comment, finance approval on behalf with a note via the
 * Agent, an email, a decision, a data write, completion) — order, wording,
 * grouping of automatic steps, durations, placeholder resolution with secrets
 * masked; a running run ("Now: waiting…"); a failed run; the progress tier;
 * a standalone task; permission filtering through the service; text export.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { RunTask } from '@/lib/run-tasks'
import { filterTimeline, formatGap, timelineAsText } from '@/lib/run-timeline'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

const memory = vi.hoisted(() => ({ db: null as any, runTasks: [] as any[], canView: false, grant: null as any }))
vi.mock('@/lib/services/_shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/_shared')>()
  return { ...actual, serviceRoleClient: async () => memory.db }
})
vi.mock('@/lib/services/run-tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/run-tasks')>()
  return { ...actual, loadRunTasks: async () => memory.runTasks }
})
vi.mock('@/lib/task-authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/task-authz')>()
  return { ...actual, canViewTask: async () => memory.canView, findTaskViewerGrant: async () => memory.grant }
})

import { buildRunTimeline, buildTaskTimeline, getRunTimeline, getTaskTimeline, highlightedFields, type RunTimelineInput } from '@/lib/services/run-timeline'
import { createFakeSupabase } from './helpers/fake-supabase'

const RUN = '0a000000-0000-4000-8000-0000000000a1'
const T1 = '0a000000-0000-4000-8000-0000000000b1'
const T2 = '0a000000-0000-4000-8000-0000000000b2'
const P = (id: string, name: string) => ({ id, name, avatar_url: null })
const people = new Map([
  ['james', P('james', 'James Patel')], ['maya', P('maya', 'Maya Manager')], ['priya', P('priya', 'Priya Shah')],
  ['finn', P('finn', 'Finn Finance')], ['ada', P('ada', 'Ada Admin')],
])
const at = (hm: string, s = '00.000') => `2026-11-09T${hm}:${s}Z`

function runTask(over: Partial<RunTask>): RunTask {
  return {
    id: T1, node_id: 'mgr', step_name: 'Manager approval', title: 'Approve: Laptop', status: 'completed', open: false, has_form: true, team: null,
    assignees: [{ ...P('priya', 'Priya Shah'), role: 'assignee', status: 'done' }], waiting_since: null, due_date: null,
    completed_at: at('11:30'), completed_by: P('priya', 'Priya Shah'), completed_on_behalf_of: null, outcome: 'Approve',
    can_open: true, can_act: 'none', access: 'admin', on_behalf_of: null, href: `/tasks/${T1}?tab=form`, history: [], ...over,
  }
}

const trace = [
  { type: 'node', phase: 'enter', node_id: 'trigger', node_type: 'form_submitted', node_label: 'Purchase request submitted', at: at('09:00', '00.100') },
  { type: 'edge', source: 'trigger', target: 'keep', label: null, at: at('09:00', '00.100') },
  { type: 'node', phase: 'enter', node_id: 'keep', node_type: 'set_variable', node_label: 'Token {{api_key}}', at: at('09:00', '00.200') },
  { type: 'node', phase: 'enter', node_id: 'title', node_type: 'set_title', node_label: 'Set title', at: at('09:00', '00.300') },
  { type: 'node', phase: 'enter', node_id: 'big', node_type: 'condition', node_label: 'Over NZD {{limit}}?', at: at('09:00', '00.400') },
  { type: 'edge', source: 'big', target: 'mgr', label: 'Else', at: at('09:00', '00.400') },
  { type: 'node', phase: 'enter', node_id: 'mgr', node_type: 'user_task', node_label: 'Manager approval', at: at('09:00', '01.000') },
  { type: 'node', phase: 'resume', node_id: 'mgr', node_type: 'user_task', node_label: 'Manager approval', at: at('11:30', '00.500') },
  { type: 'edge', source: 'mgr', target: 'mail', label: 'Approve', at: at('11:30', '00.500') },
  { type: 'node', phase: 'enter', node_id: 'mail', node_type: 'send_email', node_label: 'Email requester', at: at('11:30', '00.600') },
  { type: 'node', phase: 'enter', node_id: 'route', node_type: 'switch_case', node_label: 'Route by amount', at: at('11:30', '00.700') },
  { type: 'edge', source: 'route', target: 'save', label: 'Executive', at: at('11:30', '00.700') },
  { type: 'node', phase: 'enter', node_id: 'save', node_type: 'update_data_table', node_label: 'Save request', at: at('11:30', '00.800') },
  { type: 'node', phase: 'enter', node_id: 'fin', node_type: 'user_task', node_label: 'Finance approval', at: at('11:31') },
  { type: 'node', phase: 'resume', node_id: 'fin', node_type: 'user_task', node_label: 'Finance approval', at: at('15:00', '00.500') },
  { type: 'node', phase: 'enter', node_id: 'end', node_type: 'end_workflow', node_label: 'Approved', at: at('15:00', '00.600') },
]

const nodes = [
  { id: 'mail', type: 'send_email', label: 'Email requester', config: { to: '{{requester_email}}', subject: 'Approved: {{item}}' } },
  { id: 'save', type: 'update_data_table', label: 'Save request', config: { table_id: 'tbl', operation: 'insert' } },
]

function input(over: Partial<RunTimelineInput> = {}): RunTimelineInput {
  return {
    run: {
      id: RUN, workflow_id: 'wf', status: 'completed', title: 'PR-1042 · Laptop', started_at: at('09:00'), completed_at: at('15:00', '05.000'),
      started_by: 'james', started_via: 'form', form_submission_id: 'sub1',
      variables: { requester_email: 'james@example.com', item: 'Laptop', limit: 20000, api_key: 'sk-live-abcdefghijklmnopqrstuvwxyz123456', submission: { reference: 'PR-1042' } },
      execution_trace: trace, node_results: {},
    },
    workflow: { id: 'wf', name: 'Purchase request approval', version: 3 },
    nodes,
    submission: { id: 'sub1', form_id: 'form1', form_name: 'Purchase request', created_at: at('09:00'), submitted_by: 'james' },
    tasks: [
      runTask({}),
      runTask({ id: T2, node_id: 'fin', step_name: 'Finance approval', title: 'Approve PO', assignees: [{ ...P('finn', 'Finn Finance'), role: 'assignee', status: 'done' }], completed_at: at('15:00'), href: `/tasks/${T2}` }),
    ],
    taskRows: [
      { id: T1, status: 'completed', created_at: at('09:00', '02.000'), assignee_id: 'priya', available_outcomes: ['Approve', 'Decline'], metadata: { fields: [{ key: 'comment', type: 'textarea', label: 'Comment' }, { key: 'r_item', type: 'text', label: 'Item', read_only: true }], template_values: { comment: 'All good', r_item: 'Laptop' } } },
      { id: T2, status: 'completed', created_at: at('11:31', '01.000'), assignee_id: 'finn', available_outcomes: ['Approve', 'Decline'], metadata: { fields: [{ key: 'po_number', type: 'text', label: 'PO number' }, { key: 'bank_password', type: 'text', label: 'Bank password' }], template_values: { po_number: 'PO-77', bank_password: 'hunter2' } } },
    ],
    events: [
      { id: 'e1', task_id: T1, event_type: 'reassigned', actor_id: 'maya', metadata: { old_assignee: 'maya', new_assignee: 'priya', comment: 'On leave this week' }, created_at: at('09:30') },
      { id: 'e2', task_id: T1, event_type: 'comment_added', actor_id: 'priya', metadata: { source: 'user', message: 'Looks fine, checking budget' }, created_at: at('10:00') },
      { id: 'e3', task_id: T1, event_type: 'task_response', actor_id: 'priya', metadata: { outcome: 'Approve', outcome_notes: null, via: 'ui' }, created_at: at('11:30') },
      { id: 'e4', task_id: T2, event_type: 'task_response', actor_id: 'ada', metadata: { outcome: 'Approve', outcome_notes: 'Within budget', on_behalf_of: 'finn', on_behalf_note: 'Finn is away', via: 'agent' }, created_at: at('15:00') },
    ],
    people,
    names: { tables: new Map([['tbl', 'Purchase requests']]) },
    viewer: { id: 'ada', tier: 'full' },
    now: Date.parse(at('16:00')),
    ...over,
  }
}

describe('run timeline builder', () => {
  const tl = buildRunTimeline(input())

  it('orders the events and groups the routine steps', () => {
    expect(tl.events.map((e) => e.kind)).toEqual([
      'started', 'system_group', 'task_created', 'reassigned', 'comment', 'outcome', 'system', 'system', 'system', 'task_created', 'outcome', 'ended',
    ])
    const group = tl.events[1]
    expect(group.title).toBe('3 automatic steps')
    expect(group.children!.map((c) => c.title)).toEqual(['Token ••••', 'Set title', 'Decision: Over NZD 20000? → No'])
  })

  it('words each event in plain language', () => {
    const titles = tl.events.map((e) => e.title)
    expect(titles[0]).toBe('Purchase request submitted by James Patel')
    expect(tl.events[0].body).toBe('Reference PR-1042')
    expect(tl.events[0].submission).toEqual({ id: 'sub1', form_id: 'form1', form_name: 'Purchase request' })
    expect(titles[2]).toBe('Assigned to Maya Manager')
    expect(tl.events[2].step).toBe('Manager approval')
    expect(titles[3]).toBe('Reassigned from Maya Manager to Priya Shah')
    expect(tl.events[3].body).toBe('On leave this week')
    expect(titles[4]).toBe('Priya Shah commented')
    expect(tl.events[4].body).toBe('Looks fine, checking budget')
    expect(titles[5]).toBe('Approved by Priya Shah')
    expect(tl.events[5].badge).toEqual({ label: 'Approve', tone: 'success' })
    expect(tl.events[5].fields).toEqual([{ label: 'Comment', value: 'All good' }])
    expect(titles.slice(6, 9)).toEqual(['Emailed james@example.com', 'Decision: Route by amount → Executive', 'Recorded in Purchase requests'])
    expect(tl.events[6].body).toBe('“Approved: Laptop”')
    expect(titles[9]).toBe('Assigned to Finn Finance')
    const finance = tl.events[10]
    expect(finance.title).toBe('Approved by Ada Admin')
    expect(finance.on_behalf_of?.name).toBe('Finn Finance')
    expect(finance.note).toBe('Finn is away')
    expect(finance.body).toBe('Within budget')
    expect(finance.via).toBe('the Agent')
    expect(finance.fields).toEqual([{ label: 'PO number', value: 'PO-77' }, { label: 'Bank password', value: '••••' }])
    expect(tl.events[11].title).toBe('Completed — Approved')
    expect(tl.events[11].body).toBe('Took 6 h in total')
  })

  it('leaves out a form value that repeats the outcome notes', () => {
    const base = input()
    const tl2 = buildRunTimeline({ ...base, events: base.events.map((e) => e.id === 'e3' ? { ...e, metadata: { ...e.metadata, outcome_notes: 'All good' } } : e) })
    const mgr = tl2.events.find((e) => e.id === 'resp:e3')!
    expect(mgr.body).toBe('All good')
    expect(mgr.fields).toBeUndefined()
  })

  it('waits since the last reassignment on the Now line', () => {
    const base = input()
    const tl2 = buildRunTimeline({
      ...base, run: { ...base.run, status: 'waiting_for_event', completed_at: null },
      tasks: [runTask({ status: 'waiting', open: true, outcome: null, completed_at: null, completed_by: null, waiting_since: at('09:00', '02.000') })],
      events: base.events.slice(0, 2),
    })
    expect(tl2.events[tl2.events.length - 1]).toMatchObject({ kind: 'now', at: at('09:30'), title: 'Waiting for Priya Shah', body: 'For 6 h 30 m so far' })
  })

  it('puts the time since the previous human event on human events', () => {
    expect(tl.events[3].since_previous_ms).toBe(Date.parse(at('09:30')) - Date.parse(at('09:00', '02.000')))
    expect(formatGap(tl.events[3].since_previous_ms)).toBe('29 m')
    expect(formatGap(tl.events[10].since_previous_ms)).toBe('3 h 28 m')
    expect(tl.events[2].since_previous_ms).toBeUndefined()
    expect(tl.events.filter((e) => e.category === 'system').every((e) => e.since_previous_ms == null)).toBe(true)
  })

  it('summarises the run in the header', () => {
    expect(tl.header).toMatchObject({ title: 'PR-1042 · Laptop', reference: 'PR-1042', status: 'completed', status_label: 'Completed', started_by: { name: 'James Patel' }, current: 'Completed — Approved', version: 3 })
    expect(tl.header.duration_ms).toBe(6 * 3600_000 + 5000)
    expect(tl.live).toBe(false)
    expect(tl.links).toMatchObject({ process: `/automations/runs/${RUN}`, timeline: `/timeline/${RUN}` })
  })

  it('filters by chip, keeping start, end and now', () => {
    expect(filterTimeline(tl.events, 'comments').map((e) => e.kind)).toEqual(['started', 'comment', 'ended'])
    expect(filterTimeline(tl.events, 'decisions').map((e) => e.kind)).toEqual(['started', 'outcome', 'outcome', 'ended'])
    expect(filterTimeline(tl.events, 'system').map((e) => e.kind)).toEqual(['started', 'system_group', 'system', 'system', 'system', 'ended'])
  })

  it('copies as plain text', () => {
    const text = timelineAsText(tl)
    expect(text.split('\n')[0]).toBe('Purchase request approval — PR-1042 · Laptop')
    expect(text).toContain('Approved by Ada Admin (Finance approval) [Approve]')
    expect(text).toContain('Reason: Finn is away')
    expect(text).toContain('    2026-11-09 09:00  Token ••••')
    expect(text).not.toContain('sk-live')
  })
})

describe('a running run', () => {
  it('ends with "Now: waiting for …", highlighted, and is live', () => {
    const base = input()
    const tl = buildRunTimeline({
      ...base,
      run: { ...base.run, status: 'waiting_for_event', completed_at: null, execution_trace: trace.slice(0, 14) },
      tasks: [base.tasks[0], runTask({ id: T2, node_id: 'fin', step_name: 'Finance approval', status: 'waiting', open: true, outcome: null, completed_at: null, completed_by: null, waiting_since: at('11:31', '01.000'), due_date: '2026-11-12T00:00:00Z', assignees: [{ ...P('finn', 'Finn Finance'), role: 'assignee', status: 'in_progress' }], href: `/tasks/${T2}` })],
      events: base.events.slice(0, 3),
    })
    const last = tl.events[tl.events.length - 1]
    expect(last).toMatchObject({ kind: 'now', title: 'Waiting for Finn Finance', step: 'Finance approval', highlight: true, due_date: '2026-11-12T00:00:00Z' })
    expect(last.body).toBe('For 4 h 28 m so far')
    expect(tl.events.find((e) => e.task_id === T2 && e.kind === 'task_created')?.title).toBe('Waiting for Finn Finance')
    expect(tl.live).toBe(true)
    expect(tl.header.current).toBe('Waiting for Finn Finance — Finance approval')
    expect(tl.events.some((e) => e.kind === 'ended')).toBe(false)
  })
})

describe('a failed run', () => {
  const failed = (tier: 'full' | 'progress') => buildRunTimeline({
    ...input(), tasks: [], events: [], taskRows: [], viewer: { id: 'ada', tier },
    run: {
      ...input().run, status: 'failed', error: 'API call to vendor failed: 500', completed_at: at('09:00', '05.000'),
      execution_trace: [
        trace[0],
        { type: 'node', phase: 'enter', node_id: 'vendor', node_type: 'call_reference', node_label: 'Get vendor', at: at('09:00', '01.000') },
        { type: 'node', phase: 'error', node_id: 'vendor', node_type: 'call_reference', node_label: 'Get vendor', at: at('09:00', '02.000') },
      ],
      node_results: { vendor: { status: 'error', error: 'API call to vendor failed: 500' } },
    },
  })

  it('shows the error and ends "Failed: …"', () => {
    const tl = failed('full')
    expect(tl.events.map((e) => e.kind)).toEqual(['started', 'error', 'ended'])
    expect(tl.events[1]).toMatchObject({ title: 'Error in “Get vendor”', body: 'API call to vendor failed: 500', tone: 'danger' })
    expect(tl.events[2]).toMatchObject({ title: 'Failed: API call to vendor failed: 500', tone: 'danger', body: 'Took 5 s in total' })
  })

  it('hides the error text from the progress tier', () => {
    const tl = failed('progress')
    expect(tl.events[1].body).toBeNull()
    expect(tl.events[2].title).toBe('Failed')
  })

  it('marks an error the run continued past', () => {
    const tl = buildRunTimeline({ ...input(), tasks: [], events: [], run: { ...input().run, execution_trace: [trace[0], { type: 'node', phase: 'enter', node_id: 'mail', node_type: 'send_email', node_label: 'Email requester', at: at('09:00', '01.000') }, { type: 'node', phase: 'error', node_id: 'mail', node_type: 'send_email', node_label: 'Email requester', at: at('09:00', '01.500') }, { type: 'edge', source: 'mail', target: 'end', reason: 'continue_on_error', at: at('09:00', '01.600') }] } })
    expect(tl.events.find((e) => e.kind === 'error')?.title).toBe('Error in “Email requester” (continued)')
  })
})

describe('the progress tier (can follow the run, not in its run scope)', () => {
  const base = input()
  const tl = buildRunTimeline({
    ...base, viewer: { id: 'priya', tier: 'progress' },
    tasks: [base.tasks[0], { ...base.tasks[1], can_open: false, href: null, title: null, outcome: null }],
  })

  it('does not name the submitter to others, nor resolve values', () => {
    expect(tl.events[0].title).toBe('Purchase request submitted')
    expect(tl.events[0].submission).toBeNull()
    expect(tl.header.started_by).toBeNull()
    expect(tl.events.find((e) => e.node_id === 'mail')?.title).toBe('Email sent: Email requester')
    expect(tl.events[1].children!.map((c) => c.title)).toContain('Decision: Over NZD ‹limit›? → No')
    expect(tl.links.process).toBe(`/home/runs/${RUN}`)
  })

  it('shows a task it may not open without its outcome, notes or form values', () => {
    const fin = tl.events.find((e) => e.task_id === T2 && e.kind === 'outcome')!
    expect(fin.title).toBe('Completed by Ada Admin')
    expect(fin.badge).toBeNull()
    expect(fin.body).toBeNull()
    expect(fin.note).toBeNull()
    expect(fin.fields).toBeUndefined()
    // Its own task (can_open) keeps the details.
    expect(tl.events.find((e) => e.kind === 'comment')?.body).toBe('Looks fine, checking budget')
  })

  it('an invited viewer of a task sees that task\'s details', () => {
    const invited = buildRunTimeline({ ...base, viewer: { id: 'zoe', tier: 'progress', viewerTaskIds: new Set([T2]) }, tasks: base.tasks.map((t) => ({ ...t, can_open: false, href: null })) })
    const fin = invited.events.find((e) => e.task_id === T2 && e.kind === 'outcome')!
    expect(fin.badge?.label).toBe('Approve')
    expect(fin.note).toBe('Finn is away')
    expect(invited.events.some((e) => e.kind === 'comment')).toBe(false) // T1: not invited
  })

  it('shows the submitter their own submission', () => {
    const own = buildRunTimeline({ ...base, viewer: { id: 'james', tier: 'progress' } })
    expect(own.events[0].title).toBe('Purchase request submitted by James Patel')
    expect(own.events[0].submission?.id).toBe('sub1')
  })
})

describe('standalone task timeline', () => {
  const tl = buildTaskTimeline({
    task: { id: T1, title: 'Book the offsite', status: 'completed', created_at: at('08:00'), completed_at: at('12:00'), assigner_id: 'james', assignee_id: 'priya', outcome: 'Done', due_date: '2026-11-10T00:00:00Z' },
    events: [
      { id: 'a', task_id: T1, event_type: 'task_accepted', actor_id: 'priya', metadata: { comment: null }, created_at: at('08:10') },
      { id: 'b', task_id: T1, event_type: 'comment_added', actor_id: 'priya', metadata: { source: 'subtask_added', message: 'Added subtask “Book the venue”' }, created_at: at('08:20') },
      { id: 'c', task_id: T1, event_type: 'assigned', actor_id: 'priya', metadata: { action: 'viewers_invited', message: 'invited Finance (team) to view', comment: 'FYI' }, created_at: at('08:30') },
      { id: 'd', task_id: T1, event_type: 'comment_added', actor_id: 'james', metadata: { source: 'user', message: 'Thanks!' }, created_at: at('09:00') },
      { id: 'e', task_id: T1, event_type: 'attachment_added', actor_id: 'priya', metadata: { name: 'Quote', file_name: 'quote.pdf' }, created_at: at('10:00') },
      { id: 'f', task_id: T1, event_type: 'completed', actor_id: 'priya', metadata: { new_status: 'completed' }, created_at: at('12:00') },
    ],
    people,
    now: Date.parse(at('13:00')),
  })

  it('tells the task\'s own story', () => {
    expect(tl.kind).toBe('task')
    expect(tl.detail).toBe('task')
    expect(tl.events.map((e) => [e.kind, e.title])).toEqual([
      ['started', 'Created by James Patel and assigned to Priya Shah'],
      ['accepted', 'Accepted by Priya Shah'],
      ['subtask', 'Added subtask “Book the venue”'],
      ['shared', 'Priya Shah invited Finance (team) to view'],
      ['comment', 'James Patel commented'],
      ['attachment', 'Priya Shah attached “Quote”'],
      ['outcome', 'Completed by Priya Shah'],
      ['ended', 'Completed — Done'],
    ])
    expect(tl.events[6].badge?.label).toBe('Done')
    expect(tl.events[7].body).toBe('Took 4 h in total')
    expect(tl.live).toBe(false)
  })

  it('an open task ends with who has it now', () => {
    const open = buildTaskTimeline({ task: { id: T1, title: 'Book', status: 'todo', created_at: at('08:00'), assigner_id: 'james', assignee_id: 'priya' }, events: [], people, now: Date.parse(at('10:00')) })
    expect(open.events[open.events.length - 1]).toMatchObject({ kind: 'now', title: 'With Priya Shah', body: 'Open for 2 h' })
    expect(open.live).toBe(true)
  })
})

describe('highlighted fields', () => {
  it('skips read-only, people and empty fields and masks secrets', () => {
    expect(highlightedFields({ id: 'x', status: 'completed', metadata: { fields: [
      { key: 'who', type: 'user', label: 'Who' }, { key: 'ro', type: 'text', label: 'RO', read_only: true }, { key: 'empty', type: 'text', label: 'Empty' },
      { key: 'ok', type: 'checkbox', label: 'OK?' }, { key: 'api_token', type: 'text', label: 'Token' }, { key: 'pick', type: 'choice', label: 'Pick', options: [{ value: 'a', label: 'Option A' }] },
    ], template_values: { who: 'u1', ro: 'x', empty: '', ok: true, api_token: 'abc', pick: 'a' } } })).toEqual([
      { label: 'OK?', value: 'Yes' }, { label: 'Token', value: '••••' }, { label: 'Pick', value: 'Option A' },
    ])
  })
})

/* ── Service: permissions ─────────────────────────────────────────────── */

const ctx = (permissions: string[], over: Record<string, unknown> = {}) => ({
  supabase: {}, tenantId: 'T', actorId: 'zoe', permissions: new Set(permissions), authKind: 'session', source: 'ui', ...over,
}) as any

function seed(canProgress: boolean) {
  const fake = createFakeSupabase({
    workflow_runs: [{ ...input().run, tenant_id: 'T', execution_trace: trace.slice(0, 6) }],
    workflows: [{ id: 'wf', tenant_id: 'T', name: 'Purchase request approval', nodes }],
    tasks: [
      { id: T1, tenant_id: 'T', title: 'Approve: Laptop', status: 'completed', workflow_run_id: RUN, workflow_id: 'wf', workflow_step_id: 'mgr', created_at: at('09:00', '02.000'), deleted_at: null, assignee_id: 'priya' },
      { id: T2, tenant_id: 'T', title: 'Book offsite', status: 'todo', workflow_run_id: null, created_at: at('08:00'), deleted_at: null, assignee_id: 'priya', assigner_id: 'james' },
    ],
    lifecycle_events: [{ id: 'e2', tenant_id: 'T', task_id: T1, event_type: 'comment_added', actor_id: 'priya', metadata: { source: 'user', message: 'Looks fine' }, created_at: at('10:00') }],
    task_viewers: [{ id: 'v1', tenant_id: 'T', task_id: T1 }],
    users: [...people.values()].map((p) => ({ id: p.id, display_name: p.name })),
    form_submissions: [{ id: 'sub1', tenant_id: 'T', form_id: 'form1', form_name: 'Purchase request', created_at: at('09:00'), submitted_by: 'james' }], object_audit_log: [], teams: [],
  })
  fake.rpcs.can_view_run_progress = () => ({ data: canProgress })
  return fake
}

describe('getRunTimeline / getTaskTimeline permissions', () => {
  beforeEach(() => {
    memory.runTasks = [runTask({ can_open: false, href: null, title: null })]
    memory.canView = false
    memory.grant = null
  })

  it('a person who can\'t see the run gets not found', async () => {
    memory.db = seed(false).client
    await expect(getRunTimeline(ctx(['tasks.view_own']), RUN)).rejects.toMatchObject({ code: 'not_found' })
    await expect(getTaskTimeline(ctx(['tasks.view_own']), T1)).rejects.toMatchObject({ code: 'not_found' })
    await expect(getRunTimeline(ctx(['tasks.view_own']), 'not-a-uuid')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('someone who may follow the run gets the progress view', async () => {
    memory.db = seed(true).client
    const tl = await getRunTimeline(ctx(['tasks.view_own']), RUN)
    expect(tl.detail).toBe('progress')
    expect(tl.events[0].title).toBe('Purchase request submitted')
    expect(tl.events.some((e) => e.kind === 'comment')).toBe(false)
  })

  it('an invited viewer sees the task\'s comments in the run timeline', async () => {
    memory.db = seed(true).client
    memory.grant = { id: 'v1', task_id: T1 }
    const tl = await getTaskTimeline(ctx(['tasks.view_own']), T1)
    expect(tl.kind).toBe('run')
    expect(tl.focus_task_id).toBe(T1)
    expect(tl.events.find((e) => e.kind === 'comment')?.body).toBe('Looks fine')
  })

  it('a task the person can view, whose run they can\'t, shows the task\'s own history', async () => {
    memory.db = seed(false).client
    memory.canView = true
    const tl = await getTaskTimeline(ctx(['tasks.view_own']), T1)
    expect(tl).toMatchObject({ kind: 'task', detail: 'task', run_id: RUN, task_id: T1 })
    expect(tl.events.find((e) => e.kind === 'comment')?.body).toBe('Looks fine')
  })

  it('a standalone task needs canViewTask', async () => {
    memory.db = seed(false).client
    await expect(getTaskTimeline(ctx(['tasks.view_own']), T2)).rejects.toMatchObject({ code: 'not_found' })
    memory.canView = true
    const tl = await getTaskTimeline(ctx(['tasks.view_own']), T2)
    expect(tl.events[0].title).toBe('Created by James Patel and assigned to Priya Shah')
  })

  it('an API key limited to other workflows gets not found even with view_runs', async () => {
    memory.db = seed(true).client
    await expect(getRunTimeline(ctx(['workflows.view_runs'], { actorId: null, resourceScopes: { workflow_ids: ['other'], table_ids: [] } }), RUN)).rejects.toMatchObject({ code: 'not_found' })
    const tl = await getRunTimeline(ctx(['workflows.view_runs'], { actorId: null }), RUN)
    expect(tl.detail).toBe('full')
  })
})

describe('Agent get_timeline', () => {
  it('answers from the same timeline, as text, within what the person may see', async () => {
    const { timelineTool } = await import('@/lib/assistants/tools/timeline')
    memory.runTasks = [runTask({})]
    memory.db = seed(true).client
    const tool = timelineTool(ctx(['tasks.view_own']), { taskId: T1 })
    expect(tool).toMatchObject({ name: 'get_timeline', mode: 'read' })
    const out = await tool.run({}, {} as any) as any
    expect(out.result.detail).toBe('progress')
    expect(out.result.timeline).toContain('Purchase request submitted')
    expect(out.result.timeline).toContain('Looks fine')
    memory.db = seed(false).client
    const denied = await timelineTool(ctx(['tasks.view_own']), { runId: RUN }).run({}, {} as any) as any
    expect(denied).toMatchObject({ ok: false, result: { error: 'Run not found' } })
  })
})
