import { describe, expect, it } from 'vitest'
import { buildDataTree } from '@/lib/workflow-data-picker'
import { validateWorkflowWiring } from '@/lib/workflow-wiring'
import { applyTaskCompletionOutputs, downstreamTaskData, isSecretField, saveToVariableMap, suggestedSaveTargets, variablesFromTask } from '@/lib/forms/task-outputs'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { resolveExpressionValues } from '@/lib/expression-resolver'
import { USER_TASK_PER_STEP_VARIABLES } from '@/lib/workflow-system-variables'

const FIELDS = [
  { key: 'amount', label: 'Approved amount', type: 'currency' },
  { key: 'comments', label: 'Comments', type: 'textarea' },
  { key: 'approved', label: 'Approved', type: 'boolean' },
  { key: 'lines', label: 'Lines', type: 'repeating_section', repeating_section: { fields: [{ key: 'item', label: 'Item', type: 'text' }, { key: 'cost', label: 'Cost', type: 'number' }], layout: { rows: [] } } },
  { key: 'vendor_password', label: 'Vendor password', type: 'text' },
  { key: 'api_token', label: 'Token (allowed)', type: 'text', expose_downstream: true },
  { key: 'ref_token', label: 'Reference token', type: 'text' },
]
const nodes = [
  { id: 'trig', type: 'manual_trigger', label: 'Start', config: {} },
  { id: 'task', type: 'user_task', label: 'Manager approval', config: { fields: FIELDS, outcomes: ['Approve', 'Reject'], save_to_variables: { amount: 'approved_amount', vendor_password: 'pw' } } },
  { id: 'mail', type: 'send_email', label: 'Notify', config: { subject: 'Approved {{task_data.amount}}', body: '{{manager_approval_task_data.comments}} {{task_data.removed_field}}' } },
]
const edges = [{ id: 'e1', source: 'trig', target: 'task' }, { id: 'e2', source: 'task', target: 'mail' }]

describe('a task\'s form fields downstream', () => {
  const groups = buildDataTree({ nodes, edges, currentNodeId: 'mail', workflowVariables: [{ name: 'approved_amount', type: 'number' }] })
  const form = groups.find((g) => g.id === 'form:task')!
  const step = groups.find((g) => g.id === 'step:task')!
  it('every field is a typed output under the task step, with label and type; collections loop', () => {
    expect(form.label).toBe('Manager approval › Form')
    const by = (p: string) => form.roots.find((r) => r.path === p)
    expect(by('task_data.amount')).toMatchObject({ label: 'Approved amount', schema: { type: 'number' } })
    expect(by('task_data.approved')?.schema?.type).toBe('boolean')
    expect(by('task_data.lines')?.schema).toMatchObject({ type: 'array', items: { type: 'object' } })
    expect(step.roots.map((r) => r.path)).toEqual(expect.arrayContaining(['outcome', 'manager_approval_outcome', 'outcome_notes', 'completed_by', 'completed_at', 'manager_approval_task_data', 'manager_approval_responses']))
  })
  it('secret fields stay out unless the field allows it; saved variables are listed, typed', () => {
    expect(form.roots.some((r) => r.path === 'task_data.vendor_password')).toBe(false)
    expect(form.roots.some((r) => r.path === 'task_data.api_token')).toBe(true)
    // Common keys such as a reference token are not secrets (existing workflows read them).
    expect(form.roots.some((r) => r.path === 'task_data.ref_token')).toBe(true)
    expect(step.roots.find((r) => r.path === 'approved_amount')).toMatchObject({ schema: { type: 'number' } })
    expect(step.roots.some((r) => r.path === 'pw')).toBe(false)
    expect(isSecretField({ key: 'vendor_password' })).toBe(true)
    expect(normalizeTaskFields([{ key: 'api_token', label: 'T', type: 'text', expose_downstream: true }])[0].expose_downstream).toBe(true)
  })
  it('follows the form: a field removed later is a wiring warning on the step that uses it', () => {
    const warnings = validateWorkflowWiring({ nodes: nodes as never, edges, onlyNodeIds: ['mail'] })
    expect(warnings.some((w) => /removed_field/.test(w.message))).toBe(true)
    expect(warnings.some((w) => /task_data\.amount\b/.test(w.message))).toBe(false)
    const renamed = nodes.map((n) => (n.id === 'task' ? { ...n, config: { ...n.config, fields: FIELDS.map((f) => (f.key === 'amount' ? { ...f, key: 'total' } : f)) } } : n))
    expect(validateWorkflowWiring({ nodes: renamed as never, edges, onlyNodeIds: ['mail'] }).some((w) => /amount/.test(w.message))).toBe(true)
  })
})

describe('on completion (the engine\'s resume)', () => {
  it('stores the values as the step\'s outputs without secrets, saves mapped variables, and later steps resolve them', () => {
    const vars: Record<string, unknown> = {
      approved_amount: 100,
      task_data: { amount: 950, comments: 'OK', approved: true, vendor_password: 'hunter2', vendor_password_label: 'x', api_token: 'allowed', lines: [{ item: 'Desk', cost: 950 }] },
      outcome: 'Approve', responses: [{ user_id: 'u1', outcome: 'Approve', outcome_notes: 'fine', responded_at: '2026-11-16T00:00:00Z' }],
    }
    applyTaskCompletionOutputs(vars, nodes[1], normalizeTaskFields)
    for (const key of USER_TASK_PER_STEP_VARIABLES) if (vars[key] !== undefined) vars[`manager_approval_${key}`] = vars[key]
    expect(vars.task_data).not.toHaveProperty('vendor_password')
    expect(vars.task_data).not.toHaveProperty('vendor_password_label')
    expect(vars.approved_amount).toBe(950)
    expect(vars).not.toHaveProperty('pw')
    expect(resolveExpressionValues('Approved {{manager_approval_task_data.amount}} by {{manager_approval_responses.0.user_id}}: {{approved_amount}}', vars)).toBe('Approved 950 by u1: 950')
    expect(resolveExpressionValues('{{task_data.vendor_password}}', vars) ?? '').toBe('')
  })
})

describe('Save to workflow variable', () => {
  const fields = normalizeTaskFields(FIELDS)
  it('keeps valid mappings for the form\'s fields only (no reserved, secret or unknown names)', () => {
    expect(saveToVariableMap({ amount: 'approved_amount', comments: 'task_data', nope: 'x', approved: 'bad name', vendor_password: 'pw', api_token: 'token_copy' }, fields)).toEqual({ amount: 'approved_amount', api_token: 'token_copy' })
    expect(saveToVariableMap({ amount: 'client_secret' }, fields)).toEqual({})
    expect(variablesFromTask({ amount: 'approved_amount' }, fields, { amount: 5 })).toEqual({ approved_amount: 5 })
    expect(variablesFromTask({ amount: 'approved_amount' }, fields, {})).toEqual({})
  })
  it('is offered by default for a field prefilled from a workflow variable', () => {
    const prefilled = [{ key: 'amount', label: 'Amount', type: 'currency' as const, default: '{{approved_amount}}' }, { key: 'title', label: 'Title', type: 'text' as const, default: '{{after.Title}}' }, { key: 'other', label: 'O', type: 'text' as const }]
    expect(suggestedSaveTargets(prefilled, ['approved_amount', 'after'])).toEqual({ amount: 'approved_amount' })
    expect(suggestedSaveTargets(prefilled, ['budget'], { other: '{{budget}}' })).toEqual({ other: 'budget' })
  })
})

describe('multi-assignee tasks', () => {
  it('values are the task\'s (one set, the last response); every response is a list', () => {
    expect(downstreamTaskData([{ key: 'a' }], { a: 1 })).toEqual({ a: 1 })
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'mail' })
    const responses = groups.find((g) => g.id === 'step:task')!.roots.find((r) => r.path === 'manager_approval_responses')!
    expect(responses.schema).toMatchObject({ type: 'array', items: { type: 'object', fields: expect.arrayContaining([expect.objectContaining({ name: 'outcome' })]) } })
  })
})
