/**
 * User Task prefill: a task's form fields open with each field's default
 * and the step's own `field_values` map (field key → expression), resolved
 * against the run when the task is created — without changing a linked
 * reusable form. Read-only fields keep the prefilled value on submit; the
 * designer's test runner shows the prefilled values; the wiring validator
 * warns about read-only fields nothing fills.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { executeWorkflow } from '@/lib/workflow-engine'
import { mergeTaskFieldValues, normalizeTaskFields, stepFieldValues } from '@/lib/task-field-schema'
import { testTaskStartValues } from '@/lib/automations/test-run-all'
import { normalizeScaffoldWorkflow } from '@/lib/portability/normalize'
import { validateWorkflowWiring } from '@/lib/workflow-wiring'
import { createFakeSupabase } from './helpers/fake-supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- node configs / fake rows */

const TENANT = '0fb00000-0000-4000-8000-00000000000a'
const WF = '0fb00000-0000-4000-8000-0000000000a1'
const OWNER = '0fb00000-0000-4000-8000-0000000000b1'
const FORM = '0fb00000-0000-4000-8000-0000000000d1'
const HR_FORM = '0fb00000-0000-4000-8000-0000000000d2'

const HR_FIELDS = [
  { key: 'full_name', label: 'Full name', type: 'text', read_only: true },
  { key: 'department', label: 'Department', type: 'text', read_only: true, default: '{{form.department}}' },
  { key: 'start_date', label: 'Start date', type: 'date', read_only: true },
  { key: 'hourly_rate', label: 'Hourly rate', type: 'number', read_only: true },
  { key: 'approver_comment', label: 'Comment', type: 'textarea' },
]

describe('stepFieldValues', () => {
  it('resolves and coerces mapped value fields; ignores unknown keys, blanks and display fields', () => {
    const fields = normalizeTaskFields([...HR_FIELDS, { key: 'h', label: 'Heading', type: 'heading' }])
    const out = stepFieldValues(fields, { full_name: '{{n}}', hourly_rate: '42.5', approver_comment: '', nope: 'x', h: 'y' }, (v) => v.replace('{{n}}', 'Ada'))
    expect(out).toEqual({ full_name: 'Ada', hourly_rate: 42.5 })
    expect(stepFieldValues(fields, null)).toEqual({})
  })

  it('read-only prefilled values survive a submit that tries to change them', () => {
    const fields = normalizeTaskFields(HR_FIELDS)
    const { templateValues } = mergeTaskFieldValues(
      { fields, template_values: { full_name: 'Ada', approver_comment: null } },
      { full_name: 'Mallory', approver_comment: 'Fine' },
    )
    expect(templateValues).toMatchObject({ full_name: 'Ada', approver_comment: 'Fine' })
  })
})

describe('the designer test runner', () => {
  it('opens a test task with the prefilled values; read-only fields ignore stale saved values', () => {
    const fields = normalizeTaskFields(HR_FIELDS)
    expect(testTaskStartValues(fields, { full_name: 'Ada', approver_comment: null }, { full_name: '', approver_comment: 'Saved' }))
      .toEqual({ full_name: 'Ada', approver_comment: 'Saved' })
    expect(testTaskStartValues(fields, {}, { start_date: '2020-01-01' })).toEqual({})
  })
})

describe('engine: a task opens with defaults and the step\'s field_values', () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  function seed(taskConfig: Record<string, unknown>) {
    const nodes = [
      { id: 't', type: 'form_submitted', label: 'Submitted', config: { form_id: FORM, fields: [{ key: 'full_name', label: 'Name', type: 'text' }, { key: 'department', label: 'Dept', type: 'text' }, { key: 'start_date', label: 'Start', type: 'date' }] } },
      { id: 'hr', type: 'user_task', label: 'HR approval', config: { task_title: 'Approve', assignee_id: OWNER, outcomes: ['approved'], fields: HR_FIELDS, ...taskConfig } },
    ]
    const fake = createFakeSupabase({
      workflows: [{
        id: WF, tenant_id: TENANT, name: 'Prefill', is_active: true, trigger_type: 'form_submitted', run_count: 0, published_version_id: null,
        user_variables: [], created_by: OWNER, nodes, edges: [{ id: 'e', source: 't', target: 'hr' }],
      }],
      workflow_runs: [], workflow_queue: [], tasks: [], notifications: [], task_escalations: [],
    })
    fake.rpcs.record_workflow_run = () => ({})
    createClientMock.mockImplementation(() => fake.client)
    return fake
  }
  const payload = { form: { full_name: 'Ada Lovelace', department: 'Engineering', start_date: '2026-12-01' }, form_id: FORM, submitted_by: OWNER }
  const fieldValues = { full_name: '{{form.full_name}}', start_date: '{{form.start_date}}', hourly_rate: '55' }

  it('test runs: the test_user_task prompt carries the prefilled values', async () => {
    const fake = seed({ field_values: fieldValues })
    const events: any[] = []
    const result = await executeWorkflow(WF, undefined, true, payload, (e) => events.push(e), undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('waiting_for_event')
    const prompt = events.find((e) => e.data?.status === 'test_user_task')?.data
    expect(prompt.values).toMatchObject({ full_name: 'Ada Lovelace', department: 'Engineering', start_date: '2026-12-01', hourly_rate: 55, approver_comment: null })
  })

  it('real runs: the task stores them in template_values (the field default when the map has no entry)', async () => {
    const fake = seed({ field_values: fieldValues })
    const result = await executeWorkflow(WF, undefined, false, payload, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.error).toBeUndefined()
    const task = fake.tables.tasks.find((t: any) => t.title === 'Approve') as any
    expect(task.metadata.template_values).toMatchObject({ full_name: 'Ada Lovelace', department: 'Engineering', start_date: '2026-12-01', hourly_rate: 55 })
  })

  it('without field_values only the defaults fill (the rest stay blank)', async () => {
    const fake = seed({})
    await executeWorkflow(WF, undefined, false, payload, undefined, undefined, undefined, { supabase: fake.client })
    const task = fake.tables.tasks.find((t: any) => t.title === 'Approve') as any
    expect(task.metadata.template_values).toMatchObject({ full_name: null, department: 'Engineering' })
  })
})

describe('normaliser', () => {
  it('reads prefill / form_values as field_values', () => {
    const wf = normalizeScaffoldWorkflow({ trigger_type: 'manual', nodes: [{ id: 'u', type: 'user_task', config: { task_title: 'x', prefill: { full_name: '{{form.full_name}}', hourly_rate: 55 } } }], edges: [] })
    const task = wf.nodes.find((n: any) => n.type === 'user_task')
    expect(task.config.field_values).toEqual({ full_name: '{{form.full_name}}', hourly_rate: '55' })
    expect(task.config.prefill).toBeUndefined()
  })
})

describe('wiring validator', () => {
  const linkedForms = {
    [FORM]: { name: 'Temporary employee onboarding', version: 1, fields: [{ key: 'full_name', label: 'Name', type: 'text' }, { key: 'department', label: 'Dept', type: 'text' }, { key: 'start_date', label: 'Start', type: 'date' }] },
    [HR_FORM]: { name: 'HR approval', version: 1, fields: HR_FIELDS },
  }
  const graph = (taskConfig: Record<string, unknown>) => ({
    nodes: [
      { id: 't', type: 'form_submitted', label: 'Submitted', config: { form_id: FORM } },
      { id: 'hr', type: 'user_task', label: 'HR approval', config: { task_title: 'Approve', assignee_id: OWNER, form_id: HR_FORM, ...taskConfig } },
    ],
    edges: [{ source: 't', target: 'hr' }],
    linkedForms,
  })

  it('warns about read-only fields with no value source, suggesting field_values from the trigger form', () => {
    const w = validateWorkflowWiring(graph({})).filter((x) => x.kind === 'prefill')
    expect(w).toHaveLength(1)
    expect(w[0].message).toMatch(/User Task "HR approval" uses form "HR approval" whose read-only fields full_name, start_date, hourly_rate have no value source/)
    expect(JSON.parse(w[0].suggestion!.replace(/^field_values: /, ''))).toEqual({ full_name: '{{form.full_name}}', start_date: '{{form.start_date}}', hourly_rate: '{{…}}' })
  })

  it('is satisfied by field_values (and checks its expressions and keys)', () => {
    expect(validateWorkflowWiring(graph({ field_values: { full_name: '{{form.full_name}}', start_date: '{{form.start_date}}', hourly_rate: '55' } }))).toEqual([])
    const w = validateWorkflowWiring(graph({ field_values: { full_name: '{{full_name}}', start_date: '{{form.start_date}}', hourly_rate: '55', hourly_rat: '1' } }))
    expect(w.find((x) => x.reference === '{{full_name}}')?.suggestion).toBe('{{form.full_name}}')
    expect(w.find((x) => x.key === 'field_values.hourly_rat')?.suggestion).toBe('hourly_rate')
  })
})
