import { describe, expect, it } from 'vitest'
import {
  backHref, completionScreenText, completionTone, DEFAULT_TASK_COMPLETION, listText, nextVariables, NO_NEXT_STEP, normalizeTaskCompletedOverride,
  parseTaskCompletionSettings, pickNextTask, renderCompletionTemplate, resolveTaskCompletion, runViewHref, taskCompletedOverride,
  taskCompletionFromTenantSettings, taskCompletionInputProblem, withTaskCompletedOverride,
  type TaskNextStep,
} from '@/lib/tasks/completion-screen'
import { classifyOutcome } from '@/lib/home/activity'
import { compactLayoutForSave, normalizeFormLayout } from '@/lib/forms/layout'
import { setPageMode } from '@/lib/forms/pages'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { designerStateFrom, definitionFrom } from '@/lib/forms/designer-state'
import { normalizeFormAssetLikeImport } from '@/lib/portability/forms'
import { formVariableScope } from '@/lib/forms/variable-catalog'
import { templateProblems } from '@/lib/variable-picker'
import { COMPLETION_VARIABLES } from '@/lib/tasks/completion-screen'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */

const assigned: TaskNextStep = {
  state: 'assigned', run_id: 'r1', process: { name: 'Invoice approval' }, run_view: 'progress',
  steps: [{ name: 'Finance review', assignees: ['Priya Shah'], team: 'Finance' }],
}
const values = { task_title: 'Invoice #1042', outcome: 'Approved', user_name: 'Alex Morgan', next: assigned, available_outcomes: ['Approved', 'Rejected'] }

describe('templates', () => {
  it('fills the placeholders', () => {
    expect(renderCompletionTemplate('{{outcome}}: {{task.title}}', values)).toBe('Approved: Invoice #1042')
    expect(renderCompletionTemplate('Now with {{next.assignee}} at {{next.step}}', values)).toBe('Now with Finance (Priya Shah) at Finance review')
    expect(renderCompletionTemplate('{{ user.name }} · {{process.name}}', values)).toBe('Alex Morgan · Invoice approval')
    expect(renderCompletionTemplate('{{outcome}}', { outcome: 'need_more_information' })).toBe('Need more information')
  })

  it('empty or unknown placeholders render empty and leave no dangling separators', () => {
    expect(renderCompletionTemplate('{{outcome}}: {{task.title}}', { outcome: 'Approved' })).toBe('Approved')
    expect(renderCompletionTemplate('Thanks, {{user.name}}. Your response is recorded.', {})).toBe('Thanks. Your response is recorded.')
    expect(renderCompletionTemplate('Now with {{next.step}} ({{next.assignee}})', { next: { ...assigned, steps: [{ name: 'Review', assignees: [], team: null }] } })).toBe('Now with Review')
    expect(renderCompletionTemplate('{{secret.value}} done', values)).toBe('done')
    expect(renderCompletionTemplate('', values)).toBe('')
  })

  it('who it is with: people, team (people), team alone, several steps', () => {
    expect(nextVariables(assigned)).toEqual({ step: 'Finance review', assignee: 'Finance (Priya Shah)' })
    expect(nextVariables({ ...assigned, steps: [{ name: 'A', assignees: ['Ann', 'Bo'], team: null }, { name: 'B', assignees: [], team: 'Legal' }] }))
      .toEqual({ step: 'A and B', assignee: 'Ann and Bo and Legal' })
    expect(nextVariables(null)).toEqual({ step: '', assignee: '' })
    expect(listText(['a', 'b', 'c', 'a'])).toBe('a, b and c')
  })

  it('the picker scope lists the screen placeholders and flags others', () => {
    const scope = formVariableScope({ fields: [], layout: null }, { kind: 'task_completed' }, COMPLETION_VARIABLES)
    expect(scope.items.map((i) => i.path)).toEqual(COMPLETION_VARIABLES.map((v) => v.name))
    expect(templateProblems('{{outcome}}: {{task.title}} {{next.assignee}} {{user.name}}', scope)).toEqual([])
    expect(templateProblems('{{amount}}', scope).map((p) => p.path)).toEqual(['amount'])
  })
})

describe('the screen text', () => {
  it('approve: success, "Now with …", default buttons', () => {
    const text = completionScreenText(DEFAULT_TASK_COMPLETION, values)
    expect(text).toMatchObject({
      kind: 'approve', tone: 'success', heading: 'Approved: Invoice #1042', subheading: 'Thanks, Alex Morgan. Your response is recorded.',
      outcome: 'Approved', next_line: 'Now with Finance (Priya Shah)', next_pending: false,
      back_label: 'Back to my tasks', next_task_label: 'Next task', view_flow_label: 'Process view',
    })
  })

  it('reject / send back: warning; other choices: neutral; completions: success', () => {
    expect(completionScreenText(DEFAULT_TASK_COMPLETION, { ...values, outcome: 'Rejected' }).tone).toBe('warning')
    expect(completionScreenText(DEFAULT_TASK_COMPLETION, { ...values, outcome: 'Send back' }).tone).toBe('warning')
    expect(completionScreenText(DEFAULT_TASK_COMPLETION, { ...values, outcome: 'Escalate' }).tone).toBe('neutral')
    expect(completionScreenText(DEFAULT_TASK_COMPLETION, { ...values, outcome: 'completed', available_outcomes: [] }).tone).toBe('success')
    expect(completionTone('other')).toBe('neutral')
  })

  it('what happens next: complete, waiting, processing, unknown, stopped, none; no one on an assigned step reads as waiting', () => {
    const line = (next: TaskNextStep) => completionScreenText(DEFAULT_TASK_COMPLETION, { ...values, next }).next_line
    expect(line({ ...assigned, state: 'complete', steps: [] })).toBe('Process complete')
    expect(line({ ...assigned, state: 'waiting', steps: [{ name: 'Payment run', assignees: [], team: null }] })).toBe('Waiting on Payment run')
    expect(line({ ...assigned, state: 'processing', steps: [] })).toBe('Processing…')
    expect(completionScreenText(DEFAULT_TASK_COMPLETION, { ...values, next: { ...assigned, state: 'processing', steps: [] } }).next_pending).toBe(true)
    expect(line({ ...NO_NEXT_STEP, state: 'unknown' })).toBe('The process continues')
    expect(line({ ...assigned, state: 'stopped', steps: [] })).toBe('The process has stopped')
    expect(line(NO_NEXT_STEP)).toBeNull()
    expect(line({ ...assigned, steps: [{ name: 'Unclaimed', assignees: [], team: null }] })).toBe('Waiting on Unclaimed')
  })

  it('a template that renders empty falls back to the default; back label follows the target', () => {
    const settings = { ...DEFAULT_TASK_COMPLETION, heading: '{{next.step}}', back_target: 'home' as const }
    const text = completionScreenText(settings, { ...values, next: NO_NEXT_STEP })
    expect(text.heading).toBe('Approved: Invoice #1042')
    expect(text.back_label).toBe('Back to Home')
    expect(backHref('home')).toBe('/home')
    expect(backHref('tasks')).toBe('/tasks')
  })

  it('Process view opens the run view the person may see', () => {
    expect(runViewHref(assigned)).toBe('/home/runs/r1')
    expect(runViewHref({ ...assigned, run_view: 'full' })).toBe('/automations/runs/r1')
    expect(runViewHref({ ...assigned, run_view: null })).toBeNull()
    expect(runViewHref(NO_NEXT_STEP)).toBeNull()
  })
})

describe('outcome kinds (TypeScript twin of home_outcome_kind)', () => {
  it('maps like the SQL', () => {
    const two = ['a', 'b']
    expect(classifyOutcome('Approve', two)).toBe('approve')
    expect(classifyOutcome('Not approved', two)).toBe('reject')
    expect(classifyOutcome('Disapprove', two)).toBe('reject')
    expect(classifyOutcome('no', two)).toBe('reject')
    expect(classifyOutcome('Request changes', two)).toBe('return')
    expect(classifyOutcome('sent_back', two)).toBe('return')
    expect(classifyOutcome('Done', two)).toBe('completion')
    expect(classifyOutcome('', two)).toBe('completion')
    expect(classifyOutcome('Escalate', two)).toBe('other')
    expect(classifyOutcome('Records gathered', ['Records gathered'])).toBe('completion')
  })
})

describe('settings model and per-form override', () => {
  it('parses stored settings: defaults, bad values ignored, blank texts keep the default (back label may be blank)', () => {
    expect(parseTaskCompletionSettings(null)).toEqual(DEFAULT_TASK_COMPLETION)
    expect(parseTaskCompletionSettings({ enabled: 'no', heading: '  ', back_target: 'x', next_task_label: 'Next one', back_label: '' }))
      .toEqual({ ...DEFAULT_TASK_COMPLETION, next_task_label: 'Next one' })
    expect(parseTaskCompletionSettings({ heading: 'x'.repeat(500) }).heading).toHaveLength(300)
    expect(taskCompletionFromTenantSettings({ tasks: { completion_screen: { enabled: false } } }).enabled).toBe(false)
    expect(taskCompletionFromTenantSettings({ forms: {} })).toEqual(DEFAULT_TASK_COMPLETION)
  })

  it('checks partial updates', () => {
    expect(taskCompletionInputProblem({ heading: 'ok', enabled: true })).toBeNull()
    expect(taskCompletionInputProblem({ enabled: 'yes' })).toMatch(/enabled/)
    expect(taskCompletionInputProblem({ back_label: 'x'.repeat(61) })).toMatch(/60/)
    expect(taskCompletionInputProblem({ back_target: 'away' })).toMatch(/back_target/)
  })

  it('the override keeps only what it sets; blank inherits', () => {
    expect(normalizeTaskCompletedOverride({ heading: '  ', enabled: 'x' })).toBeNull()
    expect(normalizeTaskCompletedOverride({ heading: 'Done!', show_back: false, back_target: 'home', outcomes: { Reject: { heading: 'Sent back', subheading: '' }, Empty: {} } }))
      .toEqual({ heading: 'Done!', show_back: false, back_target: 'home', outcomes: { Reject: { heading: 'Sent back' } } })
  })

  it('inheritance: workspace → form override → per-outcome wording', () => {
    const workspace = { ...DEFAULT_TASK_COMPLETION, heading: 'WS: {{task.title}}', back_target: 'home' as const }
    const override = { subheading: 'Form sub', show_view_flow: false, outcomes: { reject: { heading: 'Sent back: {{task.title}}' } } }
    const approve = resolveTaskCompletion(workspace, override, 'Approve')
    expect(approve).toMatchObject({ heading: 'WS: {{task.title}}', subheading: 'Form sub', show_view_flow: false, back_target: 'home', enabled: true })
    expect(resolveTaskCompletion(workspace, override, 'Reject').heading).toBe('Sent back: {{task.title}}')
    expect(resolveTaskCompletion(workspace, null, 'Reject')).toEqual(workspace)
    expect(resolveTaskCompletion({ ...workspace, enabled: false }, { enabled: true }).enabled).toBe(true)
    expect(resolveTaskCompletion(workspace, { enabled: false }).enabled).toBe(false)
  })
})

describe('Next task selection', () => {
  it('takes the first task in Home order that is not the current one', () => {
    const tasks = [{ id: 'current' }, { id: 'a' }, { id: 'b' }]
    expect(pickNextTask(tasks, 'current')).toEqual({ id: 'a' })
    expect(pickNextTask(tasks, 'a')).toEqual({ id: 'current' })
    expect(pickNextTask([{ id: 'current' }], 'current')).toBeNull()
    expect(pickNextTask([], 'x')).toBeNull()
  })
})

describe('layout.task_completed travels with the form', () => {
  const fields = [{ key: 'amount', label: 'Amount', type: 'number' }]
  const keys = ['amount']
  const rows = [{ columns: 1, cells: [{ field_key: 'amount', span: 1 }] }]
  const override = { heading: 'Thanks: {{task.title}}', back_target: 'home', outcomes: { Reject: { heading: 'Sent back' } } }

  it('setter and reader', () => {
    const layout = withTaskCompletedOverride({ rows } as any, override as any)
    expect(taskCompletedOverride(layout)).toEqual(override)
    expect('task_completed' in withTaskCompletedOverride(layout, null)).toBe(false)
    expect(taskCompletedOverride({ rows })).toBeNull()
  })

  it('normalise, compact for save (a trivial grid is kept for it), page mode, designer round trip', () => {
    const layout = normalizeFormLayout({ rows, task_completed: override }, keys)!
    expect(layout.task_completed).toEqual(override)
    expect(compactLayoutForSave(normalizeFormLayout({ rows }, keys)!, keys)).toBeNull()
    expect(compactLayoutForSave(layout, keys)!.task_completed).toEqual(override)
    expect(setPageMode(setPageMode(layout, 'steps'), 'single').task_completed).toEqual(override)
    const def = normalizeFormDefinition({ fields, layout: { rows, task_completed: override } } as any)
    expect(definitionFrom(designerStateFrom(def)).layout?.task_completed).toEqual(override)
  })

  it('portability: export / import keeps it; old forms get no key', () => {
    const a = normalizeFormAssetLikeImport({ id: 'f1', name: 'Approve', fields, layout: { rows, task_completed: override } })
    expect(a.layout.task_completed).toEqual(override)
    expect(normalizeFormAssetLikeImport(JSON.parse(JSON.stringify(a))).layout).toEqual(a.layout)
    expect(normalizeFormAssetLikeImport({ id: 'f2', name: 'x', fields, layout: { rows } }).layout).toBeNull()
  })
})
