/**
 * Workflow wiring validation (lib/workflow-wiring.ts): references that will
 * be blank at run time and config keys the engine ignores — warnings with
 * suggestions, never errors.
 */
import { describe, expect, it } from 'vitest'
import { closestMatch, scanExpression, validateWorkflowWiring, type WiringWarning } from '@/lib/workflow-wiring'
import { assignWizardKeys, buildFormFields, buildWorkflow } from '@/lib/forms/wizard/build'
import { WizardSpecSchema } from '@/lib/forms/wizard/spec'
import { WIZARD_TEMPLATE_ORDER, specFromTemplate } from '@/lib/forms/wizard/templates'
import { validateWorkflow } from '@/lib/workflow-validation'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures are JSON */

const FORM_ID = '44444444-4444-4444-8444-444444444444'
const HR_FORM = '77777777-7777-4777-8777-777777777777'
const IT_FORM = '88888888-8888-4888-8888-888888888888'

const ONBOARDING_FIELDS = [
  { key: 'full_name', label: 'Full name', type: 'text' },
  { key: 'department', label: 'Department', type: 'text' },
  { key: 'start_date', label: 'Start date', type: 'date' },
  { key: 'end_date', label: 'End date', type: 'date' },
  { key: 'manager_email', label: 'Manager email', type: 'email' },
]
const LINKED_FORMS = {
  [FORM_ID]: { name: 'Temporary employee onboarding', version: 1, fields: ONBOARDING_FIELDS },
  [HR_FORM]: { name: 'HR approval', version: 1, fields: [{ key: 'approver_comment', label: 'Comment', type: 'textarea' }] },
  [IT_FORM]: { name: 'IT setup', version: 1, fields: [{ key: 'account_username', label: 'Username', type: 'text' }, { key: 'it_notes', label: 'Notes', type: 'textarea' }] },
}

/** What the in-app Agent built for "Temporary employee onboarding" (miswired). */
function onboarding() {
  const nodes = [
    { id: 'trigger', type: 'form_submitted', label: 'Onboarding submitted', config: { form_id: FORM_ID } },
    { id: 'title', type: 'set_title', label: 'Set title', config: { title: 'Onboarding: {{full_name}} ({{department}})' } },
    { id: 'insert', type: 'update_data_table', label: 'Add temp', config: { table_id: 't1', operation: 'insert', column_values: { name: '{{full_name}}', department: '{{department}}', start: '{{start_date}}' }, output_var: 'temp_row_id' } },
    { id: 'hr', type: 'user_task', label: 'HR approval', config: { task_title: 'Approve {{full_name}}', form_id: HR_FORM, outcomes: ['approved', 'rework', 'rejected'], assignee_id: '{{hr_approver}}' } },
    { id: 'approved', type: 'update_data_table', label: 'Mark approved', config: { table_id: 't1', operation: 'update', row_id: '{{temp_row_id}}', column_values: { status: 'Approved', comment: '{{approver_comment}}' } } },
    { id: 'mail', type: 'send_email', label: 'Tell manager', config: { to: '{{manager_email}}', subject: 'Approved: {{full_name}}', body: 'HR said: {{approver_comment}}' } },
    { id: 'wait', type: 'pause_until', label: 'Wait for start', config: { date: '{{start_date}}' } },
    { id: 'due', type: 'date_math', label: 'Leaving date', config: { date: '{{end_date}}', unit: 'days', amount: -1, operation: 'add', output_var: 'offboard_date' } },
    { id: 'it', type: 'user_task', label: 'IT setup', config: { task_title: 'Accounts for {{full_name}} until {{offboard_date}}', form_id: IT_FORM, outcomes: ['done'], assignee_id: '{{hr_approver}}' } },
    { id: 'saveit', type: 'update_data_table', label: 'Save account', config: { table_id: 't1', operation: 'update', row_id: '{{temp_row_id}}', column_values: { username: '{{account_username}}', notes: '{{it_notes}}' } } },
    { id: 'done', type: 'send_email', label: 'Welcome', config: { to: '{{manager_email}}', subject: 'Ready', body: 'Login {{account_username}}' } },
  ]
  const order = nodes.map((n) => n.id)
  const edges = order.slice(1).map((id, i) => ({ id: `e${i}`, source: order[i], target: id, ...(order[i] === 'hr' ? { label: 'approved' } : {}) }))
  return { nodes, edges, workflowVariables: [{ name: 'hr_approver', type: 'string' }], linkedForms: LINKED_FORMS }
}

const byRef = (warnings: WiringWarning[], node: string, ref: string) => warnings.find((w) => w.node_id === node && w.reference === ref)

describe('the miswired onboarding workflow', () => {
  const warnings = validateWorkflowWiring(onboarding())

  it('flags bare form fields with the form.<key> path', () => {
    expect(byRef(warnings, 'title', '{{full_name}}')?.suggestion).toBe('{{form.full_name}}')
    expect(byRef(warnings, 'title', '{{department}}')?.suggestion).toBe('{{form.department}}')
    expect(byRef(warnings, 'insert', '{{start_date}}')?.suggestion).toBe('{{form.start_date}}')
    expect(byRef(warnings, 'mail', '{{manager_email}}')?.suggestion).toBe('{{form.manager_email}}')
    expect(byRef(warnings, 'wait', '{{start_date}}')?.suggestion).toBe('{{form.start_date}}')
    expect(byRef(warnings, 'insert', '{{start_date}}')?.key).toBe('column_values.start')
  })

  it('flags output_var on a Data insert', () => {
    const w = warnings.find((x) => x.node_id === 'insert' && x.kind === 'config_key')
    expect(w).toMatchObject({ key: 'output_var', suggestion: 'output_row_id_var' })
    // The engine reads the alias, so {{temp_row_id}} itself is not reported.
    expect(byRef(warnings, 'approved', '{{temp_row_id}}')).toBeUndefined()
  })

  it('flags bare User Task form values with the task path', () => {
    // Two User Tasks upstream: the per-task path (task_data is the latest task's).
    expect(byRef(warnings, 'saveit', '{{account_username}}')?.suggestion).toBe('{{it_setup_task_data.account_username}}')
    expect(byRef(warnings, 'saveit', '{{it_notes}}')?.suggestion).toBe('{{it_setup_task_data.it_notes}}')
    // One User Task upstream: task_data.
    expect(byRef(warnings, 'approved', '{{approver_comment}}')?.suggestion).toBe('{{task_data.approver_comment}}')
    expect(byRef(warnings, 'mail', '{{approver_comment}}')?.suggestion).toBe('{{task_data.approver_comment}}')
  })

  it('knows workflow variables and step outputs', () => {
    expect(byRef(warnings, 'hr', '{{hr_approver}}')).toBeUndefined()
    expect(byRef(warnings, 'it', '{{offboard_date}}')).toBeUndefined()
  })

  it('is warnings only: the designer validation still passes', () => {
    const { nodes } = onboarding()
    expect(validateWorkflow(nodes as any, 'form_submitted').valid).toBe(true)
  })

  it('reports nothing once fixed', () => {
    const wf = onboarding()
    const fixed = JSON.parse(JSON.stringify(wf).replace(/\{\{(full_name|department|start_date|end_date|manager_email)\}\}/g, '{{form.$1}}')
      .replace('{{approver_comment}}', '{{task_data.approver_comment}}').replace('{{approver_comment}}', '{{hr_approval_task_data.approver_comment}}')
      .replace(/\{\{(account_username|it_notes)\}\}/g, '{{task_data.$1}}')
      .replace('"output_var":"temp_row_id"', '"output_row_id_var":"temp_row_id"'))
    expect(validateWorkflowWiring(fixed)).toEqual([])
  })

  it('reports form fields the form does not have, and task_data keys no task has', () => {
    const wf = onboarding()
    wf.nodes[1].config.title = '{{form.ful_name}} {{task_data.approver_comment}}'
    const w = validateWorkflowWiring(wf)
    expect(byRef(w, 'title', '{{form.ful_name}}')?.suggestion).toBe('{{form.full_name}}')
    expect(byRef(w, 'title', '{{task_data.approver_comment}}')?.message).toMatch(/no User Task/)
  })

  it('suggests the closest variable for a typo', () => {
    const wf = onboarding()
    wf.nodes[8].config.task_title = 'Until {{ofboard_date}}'
    expect(byRef(validateWorkflowWiring(wf), 'it', '{{ofboard_date}}')?.suggestion).toBe('{{offboard_date}}')
  })

  it('checks only the given steps (the designer\'s selected node)', () => {
    const w = validateWorkflowWiring({ ...onboarding(), onlyNodeIds: ['wait'] })
    expect(w.map((x) => x.reference)).toEqual(['{{start_date}}'])
  })

  it('looks the form up from linked forms once, or from the cached fields', () => {
    const wf = onboarding()
    const cached = { ...wf, linkedForms: null, nodes: wf.nodes.map((n) => n.id === 'trigger' ? { ...n, config: { ...n.config, fields: ONBOARDING_FIELDS } } : n) }
    expect(byRef(validateWorkflowWiring(cached), 'title', '{{full_name}}')?.suggestion).toBe('{{form.full_name}}')
  })
})

describe('wizard-built workflows', () => {
  it('have no wiring warnings', () => {
    for (const t of WIZARD_TEMPLATE_ORDER) {
      const spec = assignWizardKeys(WizardSpecSchema.parse(specFromTemplate(t).spec))
      const wf = buildWorkflow(spec, { formId: FORM_ID, formName: 'Wizard form', tableId: 't1', tableName: 'Responses' })
      const warnings = validateWorkflowWiring({ nodes: wf.nodes, edges: wf.edges, linkedForms: { [FORM_ID]: { fields: buildFormFields(spec), version: 1, name: 'Wizard form' } } })
      expect(warnings, t).toEqual([])
    }
  })

  it('have no wiring warnings with every approval mode', () => {
    const U1 = '11111111-1111-4111-8111-111111111111'
    const T1 = '33333333-3333-4333-8333-333333333333'
    const approvals = [
      { mode: 'single', stages: [{ id: 's1', name: 'Approval', assignee: { kind: 'person', user_id: U1 } }] },
      { mode: 'manager', notify_requester: false, stages: [{ id: 's1', name: 'Manager approval', assignee: { kind: 'manager', fallback_user_id: U1 }, outcomes: ['approve', 'decline', 'changes'] }] },
      { mode: 'team', stages: [{ id: 's1', name: 'Triage', assignee: { kind: 'team', team_id: T1 } }] },
      { mode: 'multi', stages: [
        { id: 's1', name: 'Review', assignee: { kind: 'team', team_id: T1 }, outcomes: ['approve', 'changes'] },
        { id: 's2', name: 'Approve', assignee: { kind: 'person', user_id: U1 }, outcomes: ['approve', 'decline'] },
      ] },
    ]
    for (const approval of approvals) {
      const spec = assignWizardKeys(WizardSpecSchema.parse({
        name: 'Purchase request',
        questions: [
          { id: 'q1', kind: 'short_text', label: 'What do you need?', required: true },
          { id: 'q2', kind: 'money', label: 'Cost', currency: 'NZD' },
          { id: 'q3', kind: 'choice', label: 'Category', options: ['Hardware', 'Software'] },
        ],
        approval,
      }))
      const wf = buildWorkflow(spec, { formId: FORM_ID, formName: 'Purchase request', tableId: 't1', tableName: 'Responses' })
      const warnings = validateWorkflowWiring({ nodes: wf.nodes, edges: wf.edges, linkedForms: { [FORM_ID]: { fields: buildFormFields(spec), version: 1, name: 'Purchase request' } } })
      expect(warnings, approval.mode).toEqual([])
    }
  })
})

const formWorkflow = (steps: any[], edges?: any[]) => {
  const nodes = [{ id: 'trigger', type: 'form_submitted', label: 'Submitted', config: { form_id: FORM_ID } }, ...steps]
  return {
    nodes,
    edges: edges ?? nodes.slice(1).map((n, i) => ({ source: nodes[i].id, target: n.id })),
    linkedForms: LINKED_FORMS,
  }
}

describe('formula expressions', () => {
  it('reads braced and bare references inside {{= … }}', () => {
    const scan = scanExpression('Hi {{=UPPER(full_name)}} {{=CONCAT({{form.department}}, " ", "full_name")}} {{x}}')
    expect(scan.references.map((r) => `${r.bare ? 'bare:' : ''}${r.path}`)).toEqual(['bare:full_name', 'form.department', 'x'])
  })

  it('flags bare form fields in formulas, not quoted text or function names', () => {
    const w = validateWorkflowWiring(formWorkflow([
      { id: 'a', type: 'set_variable', label: 'Name', config: { name: 'upper', expression: '{{=UPPER(full_name)}} {{=IF(form.department == "IT", "yes", "no")}} {{=CONCAT("full_name", {{form.nope}})}}' } },
    ]))
    expect(w.find((x) => x.reference === 'full_name')?.suggestion).toBe('{{form.full_name}}')
    expect(w.find((x) => x.reference === 'form.department')).toBeUndefined()
    expect(w.find((x) => x.reference === '{{form.nope}}')).toBeDefined()
    expect(w).toHaveLength(2)
  })

  it('leaves unknown bare formula words alone (they are literal text)', () => {
    expect(validateWorkflowWiring(formWorkflow([
      { id: 'a', type: 'log', label: 'Log', config: { message: '{{=IF(form.department == "IT", Yes, No)}}' } },
    ]))).toEqual([])
  })

  it('flags {{ spaced }} references the engine does not read', () => {
    const w = validateWorkflowWiring(formWorkflow([{ id: 'a', type: 'log', label: 'Log', config: { message: 'Hi {{ form.full_name }}' } }]))
    expect(w).toEqual([expect.objectContaining({ kind: 'syntax', suggestion: '{{form.full_name}}' })])
  })
})

describe('loops', () => {
  it('knows the item / index variables inside the body', () => {
    const w = validateWorkflowWiring(formWorkflow([
      { id: 'list', type: 'set_variable', label: 'List', config: { name: 'people', expression: '[{"name":"a"}]' } },
      { id: 'loop', type: 'loop', label: 'Each', config: { items: '{{people}}', item_var: 'person', index_var: 'n' } },
      { id: 'body', type: 'log', label: 'Body', config: { message: '{{person.name}} #{{n}} {{form.full_name}}' } },
      { id: 'bad', type: 'log', label: 'Bad', config: { message: '{{persn.name}}' } },
    ], [
      { source: 'trigger', target: 'list' }, { source: 'list', target: 'loop' },
      { source: 'loop', target: 'body', label: 'Each Item' }, { source: 'body', target: 'bad' },
    ]))
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ node_id: 'bad', reference: '{{persn.name}}', suggestion: '{{person.name}}' })
  })

  it('knows Loop N Times counters', () => {
    expect(validateWorkflowWiring(formWorkflow([
      { id: 'loop', type: 'loop_n_times', label: 'Times', config: { count: 3, index_var: 'k' } },
      { id: 'body', type: 'log', label: 'Body', config: { message: '{{k}} of {{k_total}}' } },
    ]))).toEqual([])
  })
})

describe('Set Variable', () => {
  it('knows every assignment of a multi-assignment node', () => {
    const w = validateWorkflowWiring(formWorkflow([
      { id: 'vars', type: 'set_variable', label: 'Vars', config: { assignments: [{ name: 'first', expression: '{{form.full_name}}' }, { name: 'dept', expression: '{{form.department}}' }] } },
      { id: 'use', type: 'log', label: 'Use', config: { message: '{{first}} {{dept}} {{depts}}' } },
    ]))
    expect(w).toEqual([expect.objectContaining({ reference: '{{depts}}', suggestion: '{{dept}}' })])
  })

  it('a variable set downstream is not available upstream', () => {
    const w = validateWorkflowWiring(formWorkflow([
      { id: 'use', type: 'log', label: 'Use', config: { message: '{{later}}' } },
      { id: 'vars', type: 'set_variable', label: 'Vars', config: { name: 'later', expression: '1' } },
    ]))
    expect(w.map((x) => x.reference)).toEqual(['{{later}}'])
  })
})

describe('open-ended run variables', () => {
  it('a webhook workflow only gets confident corrections', () => {
    const w = validateWorkflowWiring({
      nodes: [
        { id: 't', type: 'webhook_received', label: 'Webhook', config: {} },
        { id: 'task', type: 'user_task', label: 'Review', config: { task_title: '{{anything}}', assignee_id: 'u1', fields: [{ key: 'comment', label: 'Comment', type: 'text' }] } },
        { id: 'log', type: 'log', label: 'Log', config: { message: '{{payload_value}} {{comment}}' } },
      ],
      edges: [{ source: 't', target: 'task' }, { source: 'task', target: 'log' }],
    })
    expect(w.map((x) => [x.reference, x.suggestion])).toEqual([['{{comment}}', '{{task_data.comment}}']])
  })

  it('a step with unknown outputs upstream silences plain unknowns', () => {
    expect(validateWorkflowWiring(formWorkflow([
      { id: 'sub', type: 'call_sub_workflow', label: 'Sub', config: { sub_workflow_id: 'x' } },
      { id: 'log', type: 'log', label: 'Log', config: { message: '{{returned_value}}' } },
    ]))).toEqual([])
  })
})

describe('config keys', () => {
  it('flags assignee_mode on a User Task with the real key', () => {
    const w = validateWorkflowWiring(formWorkflow([{ id: 'task', type: 'user_task', label: 'Task', config: { task_title: 'x', assignee_mode: 'specific', assignee_id: 'u1' } }]))
    expect(w).toEqual([expect.objectContaining({ kind: 'config_key', key: 'assignee_mode', suggestion: 'assignment_type' })])
    expect(w[0].message).toMatch(/assignee_variable/)
  })

  it('flags typos of known keys and unknown data filter operators', () => {
    const w = validateWorkflowWiring(formWorkflow([
      { id: 'q', type: 'update_data_table', label: 'Query', config: { table_id: 't', operation: 'list', filters: [{ column: 'a', operator: 'equals', value: '1' }, { column: 'b', operator: 'resembles', value: '2' }], output_rows_vars: 'rows' } },
    ]))
    expect(w.find((x) => x.key === 'output_rows_vars')?.suggestion).toBe('output_rows_var')
    expect(w.find((x) => x.key === 'filters[0].operator')?.suggestion).toBe('eq')
    expect(w.find((x) => x.key === 'filters[1].operator')?.message).toMatch(/ignored/)
  })

  it('suggests output_rows_var for output_var on a list', () => {
    const w = validateWorkflowWiring(formWorkflow([{ id: 'q', type: 'update_data_table', label: 'Query', config: { table_id: 't', operation: 'list', output_var: 'rows' } }]))
    expect(w[0]).toMatchObject({ key: 'output_var', suggestion: 'output_rows_var' })
  })
})

describe('closestMatch', () => {
  it('matches typos case-insensitively and refuses distant words', () => {
    expect(closestMatch('fullname', ['full_name', 'department'])).toBe('full_name')
    expect(closestMatch('xyz', ['full_name'])).toBeNull()
  })
})

describe('performance', () => {
  it('validates a 600-step workflow quickly', () => {
    const steps: any[] = []
    for (let i = 0; i < 600; i++) {
      steps.push(i % 3 === 0
        ? { id: `s${i}`, type: 'set_variable', label: `Set ${i}`, config: { name: `v${i}`, expression: `{{form.full_name}} {{v${Math.max(0, i - 3)}}}` } }
        : { id: `s${i}`, type: 'log', label: `Log ${i}`, config: { message: `{{v${i - (i % 3)}}} {{form.department}} {{=CONCAT(form.full_name, "x")}}` } })
    }
    const started = performance.now()
    const w = validateWorkflowWiring(formWorkflow(steps))
    expect(performance.now() - started).toBeLessThan(3000)
    expect(w).toEqual([])
  })
})
