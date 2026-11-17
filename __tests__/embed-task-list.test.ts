import { describe, expect, it } from 'vitest'
import { countLabel, dueWindow, localDueRange, dueBefore, outcomeAsksComment, outcomeButtonLabel, parseTaskListOptions, TASK_LIST_DEFAULTS, taskListQuery, taskRowActions, type TaskRowFacts } from '@/lib/embed/task-list'
import { appPartResizeMessage, hostResizeMessages, isTaskEventMessage, resizeDisabled, senderIdFrom, taskEventMessage } from '@/lib/embed/host-messages'
import { parseEmbedFormOptions, safeRedirectUrl } from '@/lib/embed/form-options'
import { taskNeedsForm } from '@/lib/services/embed-tasks'

const W1 = '11111111-1111-4111-8111-111111111111'
const W2 = '22222222-2222-4222-8222-222222222222'

describe('parseTaskListOptions', () => {
  it('defaults', () => {
    expect(parseTaskListOptions({})).toEqual(TASK_LIST_DEFAULTS)
  })
  it('reads and bounds every option', () => {
    const o = parseTaskListOptions(new URLSearchParams(`view=groups&status=completed&due=soon&soon_days=999&q=%20invoice%20&page=3&size=500&compact=1&filters=0&workflow=${W1},{${W2.toUpperCase()}},nope&tag=SharePoint:%20Expense%20Claims&scope_label=Expense%20claims&title=My%20approvals&open=tab`))
    expect(o).toMatchObject({ view: 'groups', status: 'completed', due: 'soon', soonDays: 60, q: 'invoice', page: 3, size: 50, compact: true, filters: false, workflowIds: [W1, W2], tag: 'sharepoint: expense claims', scopeLabel: 'Expense claims', title: 'My approvals', open: 'tab' })
  })
  it('unknown values fall back; completed hidden forces open', () => {
    expect(parseTaskListOptions({ view: 'everyone', status: 'completed', completed: '0', due: 'later', size: 'x' })).toMatchObject({ view: 'mine', status: 'open', allowCompleted: false, due: 'any', size: 10 })
  })
  it('workflow=none matches nothing; empty means no scope', () => {
    expect(parseTaskListOptions({ workflow: 'none' }).workflowIds).toEqual([])
    expect(parseTaskListOptions({ workflow: '' }).workflowIds).toBeNull()
    expect(parseTaskListOptions({ workflow: 'garbage' }).workflowIds).toEqual([])
  })
  it('round-trips through taskListQuery and keeps host parameters', () => {
    const o = parseTaskListOptions({ view: 'all', due: 'overdue', workflow: W1, q: 'x', compact: 'true' })
    const q = taskListQuery(o, { SenderId: 'abc', ut_org: 'acme' })
    expect(parseTaskListOptions(new URLSearchParams(q))).toEqual(o)
    expect(new URLSearchParams(q).get('SenderId')).toBe('abc')
    expect(taskListQuery(TASK_LIST_DEFAULTS)).toBe('')
    expect(new URLSearchParams(taskListQuery({ ...TASK_LIST_DEFAULTS, workflowIds: [] })).get('workflow')).toBe('none')
  })
  it('strips control characters from text options', () => {
    expect(parseTaskListOptions({ q: 'a\u0000b\nc' }).q).toBe('a b c')
  })
})

describe('tabs, tracker scope, filters, sort', () => {
  it('tabs: offered ones only; the default is the first offered', () => {
    expect(parseTaskListOptions({})).toMatchObject({ tab: 'mine', tabs: ['mine', 'following', 'tracker'] })
    expect(parseTaskListOptions({ tabs: 'tracker,following', tab: 'mine' })).toMatchObject({ tabs: ['following', 'tracker'], tab: 'following' })
    expect(parseTaskListOptions({ tabs: 'nothing' })).toMatchObject({ tabs: ['mine'], tab: 'mine' })
    expect(parseTaskListOptions({ tab: 'tracker', scope: 'reports' })).toMatchObject({ tab: 'tracker', scope: 'reports' })
    expect(parseTaskListOptions({ scope: 'everyone' }).scope).toBeNull()
  })
  it('filters and sort round-trip through the frame URL', () => {
    const o = parseTaskListOptions({ tab: 'tracker', scope: 'team', priority: 'high,bogus,critical', assignee: W1, wf: W2, sort: 'updated', dir: 'desc', due: 'custom', due_from: '2026-11-01T00:00:00Z', due_to: '2026-11-08T00:00:00Z', unread: '1', team: W1, status: 'any', size: '25' })
    expect(o).toMatchObject({ priority: ['high', 'critical'], assignee: W1, wf: W2, sort: 'updated', dir: 'desc', due: 'custom', unread: true, team: W1, status: 'any', size: 25 })
    expect(parseTaskListOptions(new URLSearchParams(taskListQuery(o)))).toEqual(o)
    // "newest" (earlier URLs) = created, descending.
    expect(parseTaskListOptions({ sort: 'newest' })).toMatchObject({ sort: 'created', dir: 'desc' })
  })
  it('due windows', () => {
    const now = new Date('2026-11-15T10:00:00Z')
    expect(dueWindow({ due: 'overdue', soonDays: 3, dueFrom: null, dueTo: null }, now)).toEqual({ from: null, to: '2026-11-15T10:00:00.000Z' })
    expect(dueWindow({ due: 'week', soonDays: 3, dueFrom: '2026-11-09T00:00:00.000Z', dueTo: '2026-11-16T00:00:00.000Z' }, now)).toEqual({ from: '2026-11-09T00:00:00.000Z', to: '2026-11-16T00:00:00.000Z' })
    expect(dueWindow({ due: 'any', soonDays: 3, dueFrom: null, dueTo: null }, now)).toBeNull()
    const today = localDueRange('today', now)
    expect(new Date(today.dueTo).getTime() - new Date(today.dueFrom).getTime()).toBe(86_400_000)
    const week = localDueRange('week', now)
    expect(new Date(week.dueFrom).getDay()).toBe(1)
  })
  it('count label', () => {
    expect(countLabel(42, false)).toBe('42')
    expect(countLabel(1000, true)).toBe('1,000+')
  })
})

describe('dueBefore', () => {
  const now = new Date('2026-11-15T10:00:00Z')
  it('windows', () => {
    expect(dueBefore({ due: 'any', soonDays: 3 }, now)).toBeNull()
    expect(dueBefore({ due: 'overdue', soonDays: 3 }, now)).toBe('2026-11-15T10:00:00.000Z')
    expect(dueBefore({ due: 'soon', soonDays: 3 }, now)).toBe('2026-11-18T10:00:00.000Z')
  })
})

describe('taskRowActions', () => {
  const me = 'me'
  const base: TaskRowFacts = { status: 'in_progress', assignee_id: me, assigned_team_id: null, acceptance_status: 'accepted', is_workflow_task: true, event_id: 'ev', available_outcomes: ['approved', 'rejected'], needsForm: false, queueAction: null }
  it('my approval task: outcome buttons', () => {
    expect(taskRowActions(base, me)).toEqual({ actions: ['outcome', 'open'], outcomes: ['approved', 'rejected'] })
  })
  it('no outcomes listed → Complete', () => {
    expect(taskRowActions({ ...base, available_outcomes: [] }, me).outcomes).toEqual(['completed'])
  })
  it('a form to fill → Open only', () => {
    expect(taskRowActions({ ...base, needsForm: true }, me)).toEqual({ actions: ['open'], outcomes: [] })
  })
  it('queued: accept / decline, or claim', () => {
    expect(taskRowActions({ ...base, acceptance_status: 'pending', queueAction: 'accept' }, me).actions).toEqual(['accept', 'decline', 'open'])
    expect(taskRowActions({ ...base, assignee_id: null, assigned_team_id: 't', queueAction: 'claim' }, me).actions).toEqual(['claim', 'open'])
  })
  it('a team task I claimed: unclaim plus outcomes; not for AAD group tasks', () => {
    expect(taskRowActions({ ...base, assigned_team_id: 't' }, me).actions).toEqual(['unclaim', 'outcome', 'open'])
    expect(taskRowActions({ ...base, assigned_team_id: 't', assignment_type: 'aad_group' }, me).actions).toEqual(['outcome', 'open'])
  })
  it('someone else\'s task, standard tasks and closed tasks → Open', () => {
    expect(taskRowActions({ ...base, assignee_id: 'other' }, me).actions).toEqual(['open'])
    expect(taskRowActions({ ...base, is_workflow_task: false, event_id: null }, me).actions).toEqual(['open'])
    expect(taskRowActions({ ...base, status: 'completed' }, me)).toEqual({ actions: ['open'], outcomes: [] })
  })
  it('every outcome goes in the Actions menu (12 here)', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `outcome_${i + 1}`)
    expect(taskRowActions({ ...base, available_outcomes: twelve }, me).outcomes).toEqual(twelve)
  })
})

describe('outcome labels', () => {
  it('friendly', () => {
    expect(outcomeButtonLabel('approved')).toBe('Approve')
    expect(outcomeButtonLabel('send_back')).toBe('Send back')
    expect(outcomeAsksComment('rejected')).toBe(true)
    expect(outcomeAsksComment('approved')).toBe(false)
  })
})

describe('taskNeedsForm', () => {
  it('required value fields or a button bar need the form', () => {
    expect(taskNeedsForm(undefined, undefined)).toBe(false)
    expect(taskNeedsForm([{ key: 'note', label: 'Note', type: 'text' }], null)).toBe(false)
    expect(taskNeedsForm([{ key: 'note', label: 'Note', type: 'text', required: true }], null)).toBe(true)
    expect(taskNeedsForm([], [{ id: 'submit', label: 'Submit', kind: 'submit', style: 'primary' }])).toBe(true)
  })
})

describe('host messages', () => {
  it('sender id from the frame URL, sanitised', () => {
    expect(senderIdFrom('?SPHostUrl=x&SenderId=ABC_12-3')).toBe('ABC_12-3')
    expect(senderIdFrom('SenderId=<script>')).toBeNull()
    expect(senderIdFrom(new URLSearchParams(''))).toBeNull()
  })
  it('the classic add-in part resize message', () => {
    expect(appPartResizeMessage('S1', 412.2)).toBe('<message senderId=S1>resize(100%,413px)</message>')
    expect(appPartResizeMessage('S1', 300, 640)).toBe('<message senderId=S1>resize(640px,300px)</message>')
    expect(appPartResizeMessage('S1', 300, 'calc(1)')).toBe('<message senderId=S1>resize(100%,300px)</message>')
  })
  it('a height change: usertasks:resize, plus the add-in message with a SenderId; none with resize=0', () => {
    expect(hostResizeMessages(200, { pathname: '/embed/tasks', search: '' })).toEqual([{ type: 'usertasks:resize', height: 200, path: '/embed/tasks' }])
    expect(hostResizeMessages(200, { pathname: '/embed/tasks', search: '?SenderId=S9' })).toEqual([{ type: 'usertasks:resize', height: 200, path: '/embed/tasks' }, '<message senderId=S9>resize(100%,200px)</message>'])
    expect(hostResizeMessages(200, { pathname: '/embed/f/x', search: '?resize=0&SenderId=S9' })).toEqual([])
    expect(resizeDisabled('resize=fixed')).toBe(true)
  })
  it('task events', () => {
    expect(isTaskEventMessage(taskEventMessage('completed', 't1'))).toBe(true)
    expect(isTaskEventMessage({ type: 'usertasks:task', event: 'deleted' })).toBe(false)
  })
})

describe('embedded form options', () => {
  it('defaults to what the form does', () => {
    expect(parseEmbedFormOptions({})).toEqual({ after: 'form', doneText: null, redirectUrl: null, hideTitle: false })
  })
  it('message / reset / redirect / hide title', () => {
    expect(parseEmbedFormOptions({ after: 'message', done_text: 'Thanks!' })).toMatchObject({ after: 'message', doneText: 'Thanks!' })
    expect(parseEmbedFormOptions({ after: 'reset' }).after).toBe('reset')
    expect(parseEmbedFormOptions({ after: 'redirect', redirect_url: 'https://intranet.example.com/done' })).toMatchObject({ after: 'redirect', redirectUrl: 'https://intranet.example.com/done' })
    expect(parseEmbedFormOptions({ hide_title: '1' }).hideTitle).toBe(true)
  })
  it('redirect needs a safe absolute http(s) URL', () => {
    expect(parseEmbedFormOptions({ after: 'redirect', redirect_url: 'javascript:alert(1)' }).after).toBe('form')
    expect(safeRedirectUrl('https://u:p@example.com/')).toBeNull()
    expect(safeRedirectUrl('/relative')).toBeNull()
    expect(safeRedirectUrl('http://sharepoint/sites/a/Pages/Thanks.aspx')).toBe('http://sharepoint/sites/a/Pages/Thanks.aspx')
  })
})

describe('floatingBottom (EmbedFrame: open menus count towards the frame height)', () => {
  it('the lowest open popper plus a margin; closed (zero-height) ones ignored', async () => {
    const { floatingBottom } = await import('@/components/forms/embed-frame')
    const el = (bottom: number, height = 100) => ({ getBoundingClientRect: () => ({ bottom, height }) })
    const doc = (els: unknown[], scrollY = 0) => ({ querySelectorAll: () => els, defaultView: { scrollY } }) as unknown as Document
    expect(floatingBottom(doc([]))).toBe(0)
    expect(floatingBottom(doc([el(300), el(520)]))).toBe(532)
    expect(floatingBottom(doc([el(900, 0)]))).toBe(0)
    expect(floatingBottom(doc([el(400)], 50))).toBe(462)
  })
})
