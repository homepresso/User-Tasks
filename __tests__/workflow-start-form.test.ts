/**
 * The form a workflow starts from (Test runner, Run dialog, form links):
 *  - which form the test / run panel draws: Form submitted trigger → the
 *    linked form; start_form → the start form; a first User Task or plain
 *    variables → none (the existing behaviour);
 *  - start-form values over the test case's variable strings, the plain
 *    "Show as fields" text, form page URLs;
 *  - a TEST submission: the payload a real submission's trigger gets (typed
 *    values, lookups' `_item`, submitted_by = tester, form_button,
 *    form_version, form_source = test), the same validation (per-field
 *    errors), the trigger's button filter — and no side effects (no
 *    form_submissions row → no form.submitted event, no trigger enqueued,
 *    no button "Start workflow" run), with what the button would do logged;
 *  - POST /api/workflows/execute-stream with form_submission: the run gets
 *    the server-built payload (client variables ignored), the would-logs
 *    come first, 422 with fields on invalid values;
 *  - the forms that start a workflow (trigger + buttons) with page paths.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fieldText, formPagePath, formPageUrl, parseFieldText, startFormKind, startFormValues, startFormVariable, valueChips,
  type WorkflowStartForm,
} from '@/lib/forms/workflow-start-form'
import { createMemorySupabase } from './fixtures/supabase-memory'
import type { ServiceContext } from '@/lib/services/context'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TENANT = u(1)
const FORM = u(10)
const WORKFLOW = u(20)
const FOLLOW_UP = u(21)
const OTHER_TRIGGERED = u(22)
const START_WF = u(23)
const USER = u(30)

const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'amount', label: 'Amount', type: 'number' },
  { key: 'urgent', label: 'Urgent', type: 'boolean' },
  { key: 'customer', label: 'Customer', type: 'lookup', lookup: { source: 'table', table_id: u(70), search_columns: ['name'], display_columns: ['name'], value_column: 'id' } },
]

describe('which form the test / run panel draws', () => {
  it('Form submitted → form; start_form → start form; user task first / plain variables → none', () => {
    expect(startFormKind([{ id: 't', type: 'form_submitted', config: { form_id: FORM } }, { id: 'a', type: 'send_email', config: {} }])).toBe('form')
    expect(startFormKind([{ id: 't', type: 'form_submitted', config: {} }])).toBeNull()
    expect(startFormKind([{ id: 't', type: 'webhook_received', config: { start_form: { layout: { rows: [] } } } }])).toBe('start_form')
    // A first User Task is not a start form: the run pauses there (inline task form).
    expect(startFormKind([{ id: 't', type: 'task_created', config: {} }, { id: 'u', type: 'user_task', config: { form_id: FORM } }])).toBeNull()
    expect(startFormKind([{ id: 't', type: 'webhook_received', config: {} }])).toBeNull()
    expect(startFormKind(null)).toBeNull()
  })

  it('start-form values over the case strings (keyed by variable name); plain text; page URLs', () => {
    const spec: Extract<WorkflowStartForm, { kind: 'start_form' }> = {
      kind: 'start_form', layout: null, theme_overrides: null, name_by_key: { customer_name: 'customerName', rush: 'rush' },
      fields: [{ key: 'customer_name', label: 'Customer', type: 'text' }, { key: 'rush', label: 'Rush', type: 'boolean' }] as any,
    }
    expect(startFormValues(spec, { customerName: 'Alfreds', rush: 'true' })).toEqual({ customer_name: 'Alfreds', rush: true })
    expect(startFormVariable(spec, 'customer_name', 'Ana')).toEqual({ name: 'customerName', value: 'Ana' })
    expect(startFormVariable(spec, 'rush', false)).toEqual({ name: 'rush', value: 'false' })
    expect(fieldText({ id: 1 })).toBe('{"id":1}')
    expect(parseFieldText('[1,2]')).toEqual([1, 2])
    expect(parseFieldText('12')).toBe('12')
    expect(formPagePath(FORM)).toBe(`/f/${FORM}`)
    expect(formPageUrl('https://app.example.com/', FORM)).toBe(`https://app.example.com/f/${FORM}`)
    expect(valueChips({ a: 1, b: '', c: true, d: 4 }, ['a', 'b', 'c', 'd'])).toEqual({ chips: ['a=1', 'b=""', 'c=true'], more: 1 })
  })
})

/* ── Services with an in-memory database ────────────────────────────── */

const started: any[] = []
vi.mock('@/lib/services/workflow-start', () => ({
  startWorkflow: vi.fn(async (_ctx: any, input: any) => { started.push(input); return { mode: 'async', job_id: 'job-1', workflow_id: input.workflow_id, published_version_id: null } }),
}))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
const kicks: number[] = []
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn(() => { kicks.push(1) }) }))
const lookupCalls: any[] = []
vi.mock('@/lib/services/form-lookup', async (orig) => ({
  ...(await orig() as object),
  resolveLookupSelections: vi.fn(async (_db: any, _tenant: string, _fields: any, values: Record<string, unknown>, options: any) => {
    lookupCalls.push(options)
    if (values.customer === 'bad') return { errors: { customer: 'Customer: choose one of the suggestions' }, items: {} }
    return { errors: {}, items: values.customer ? { customer_item: { id: values.customer, name: 'Alfreds Futterkiste' } } : {} }
  }),
}))
vi.mock('@/lib/workflow-engine', () => ({
  executeWorkflow: vi.fn(async () => ({ status: 'completed', node_results: {}, run_id: 'run-test' })),
  resumeWorkflow: vi.fn(async () => ({ status: 'completed', node_results: {} })),
}))

let db: any
let rpcCalls: any[]
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => db }))
vi.mock('@/lib/services/context', async (orig) => ({ ...(await orig() as object), fromSession: vi.fn(async () => ctx()) }))

function makeDb() {
  const mem = createMemorySupabase({
    forms: [
      { id: FORM, tenant_id: TENANT, name: 'Expense claim', description: null, fields: FIELDS, layout: null, theme: { source: 'workspace' }, version: 4,
        buttons: [
          { id: 'submit', label: 'Send claim', kind: 'submit', style: 'primary', actions: [
            { type: 'start_workflow', workflow_id: FOLLOW_UP, workflow_name: 'Reimburse', inputs: { employee: '{{name}}', amount: '{{amount}}' } },
            { type: 'message', text: 'Thanks {{name}}' },
            { type: 'success_screen', title: 'Claim sent', text: 'Reference {{run_reference}}' },
            { type: 'redirect', url: 'https://evil.example.com' },
          ] },
          { id: 'urgent_btn', label: 'Send as urgent', kind: 'submit', style: 'secondary' },
          { id: 'cancel', label: 'Cancel', kind: 'cancel', style: 'secondary' },
        ],
        header: { enabled: true, image: 'none', title: 'Expense claim' } },
      { id: u(11), tenant_id: TENANT, name: 'Quick request', fields: [{ key: 'x', label: 'X', type: 'text' }], layout: null, theme: { source: 'workspace' }, version: 1,
        buttons: [{ id: 'go', label: 'Go', kind: 'submit', style: 'primary', actions: [{ type: 'start_workflow', workflow_id: WORKFLOW, workflow_name: 'Claims' }] }] },
    ],
    users: [{ id: USER, display_name: 'Nancy Davolio', email: 'nancy@northwind.example' }],
    workflows: [
      { id: WORKFLOW, tenant_id: TENANT, name: 'Claims', is_active: true, trigger_type: 'form_submitted', published_version_id: null, user_variables: [],
        nodes: [{ id: 't', type: 'form_submitted', config: { form_id: FORM, button_ids: ['submit'] } }] },
      { id: OTHER_TRIGGERED, tenant_id: TENANT, name: 'Other', is_active: true, trigger_type: 'form_submitted', published_version_id: null, user_variables: [],
        nodes: [{ id: 't', type: 'form_submitted', config: { form_id: FORM } }] },
      { id: START_WF, tenant_id: TENANT, name: 'Orders', is_active: true, trigger_type: 'webhook_received', published_version_id: null,
        user_variables: [{ name: 'customerName', type: 'string', required: true }, { name: 'rush', type: 'boolean' }],
        nodes: [{ id: 't', type: 'webhook_received', config: { start_form: { layout: { rows: [{ columns: 2, cells: [{ field_key: 'customerName', span: 1 }, { field_key: 'rush', span: 1 }] }] } } } }] },
    ],
    form_submissions: [],
    user_memberships: [],
  }, { uuids: true })
  rpcCalls = []
  return { ...mem, rpc: async (name: string, args: any) => { rpcCalls.push({ name, args }); return { data: 1, error: null } } }
}

function ctx(over: Partial<ServiceContext> = {}): ServiceContext {
  return { supabase: db, db, tenantId: TENANT, actorId: USER, permissions: new Set(['forms.submit', 'forms.view', 'workflows.view', 'workflows.edit']), authKind: 'session', source: 'ui', ...over }
}

beforeEach(() => { db = makeDb(); started.length = 0; kicks.length = 0; lookupCalls.length = 0 })

const VALID = { name: 'Nancy', amount: '245.5', urgent: 'yes', customer: 'ALFKI', extra: 'dropped' }

describe('a test submission of the trigger form', () => {
  it('builds the payload a real submission would (typed values, _item, tester, button, version, source test)', async () => {
    const { prepareTestFormRun } = await import('@/lib/services/workflow-start-form')
    const { variables, logs } = await prepareTestFormRun(ctx(), WORKFLOW, { values: VALID, button_id: 'submit' })
    expect(variables).toMatchObject({
      form: { name: 'Nancy', amount: 245.5, urgent: true, customer: 'ALFKI', customer_item: { id: 'ALFKI', name: 'Alfreds Futterkiste' } },
      form_id: FORM, form_name: 'Expense claim', form_version: 4, form_button: 'submit', form_outcome: null, form_source: 'test',
      submitted_by: USER, submitted_by_name: 'Nancy Davolio', submitted_by_email: 'nancy@northwind.example',
    })
    expect((variables.form as any).extra).toBeUndefined()
    expect(String(variables.form_submission_id)).toMatch(/^test-/)
    expect(Number.isNaN(Date.parse(String(variables.submitted_at)))).toBe(false)
    // Lookups were re-checked like a real submission (scoped to this form + the tester).
    expect(lookupCalls[0]).toMatchObject({ strict: true, taskId: `form:${FORM}:${USER}` })
    // What the button would do, in order; the disallowed redirect is flagged.
    const messages = logs.map((l) => l.message)
    expect(messages[0]).toMatch(/Test submission of "Expense claim" with "Send claim": nothing is stored/)
    expect(messages).toContain('Would start workflow "Reimburse" (not started in a test)')
    expect(logs.find((l) => /Reimburse/.test(l.message))!.metadata).toEqual({ workflow_id: FOLLOW_UP, inputs: { employee: 'Nancy', amount: 245.5 } })
    expect(messages).toContain('Would show the message "Thanks Nancy"')
    expect(messages).toContain('Would show the success screen "Claim sent": Reference (test run)')
    expect(logs.find((l) => /redirect/.test(l.message))).toMatchObject({ level: 'warn' })
  })

  it('has no side effects: no submission row (so no form.submitted event), no trigger fired, no button workflow started', async () => {
    const { prepareTestFormRun } = await import('@/lib/services/workflow-start-form')
    await prepareTestFormRun(ctx(), WORKFLOW, { values: VALID, button_id: 'submit' })
    expect(db.tables.form_submissions).toHaveLength(0)
    expect(db.calls.filter((c: any) => c.op !== 'select')).toEqual([])
    expect(rpcCalls).toEqual([])
    expect(kicks).toEqual([])
    expect(started).toEqual([])
  })

  it('validates like a real submission (per-field errors), honours the trigger\'s button filter and forms.submit', async () => {
    const { prepareTestFormRun } = await import('@/lib/services/workflow-start-form')
    const invalid = await prepareTestFormRun(ctx(), WORKFLOW, { values: { amount: 'x' } }).catch((e) => e)
    expect(invalid.code).toBe('validation_error')
    expect(Object.keys(invalid.details.fields).sort()).toEqual(['amount', 'name'])
    const badLookup = await prepareTestFormRun(ctx(), WORKFLOW, { values: { name: 'N', customer: 'bad' } }).catch((e) => e)
    expect(badLookup.details.fields).toEqual({ customer: 'Customer: choose one of the suggestions' })
    await expect(prepareTestFormRun(ctx(), WORKFLOW, { values: VALID, button_id: 'urgent_btn' })).rejects.toThrow(/would not start this workflow/)
    await expect(prepareTestFormRun(ctx(), WORKFLOW, { values: VALID, button_id: 'cancel' })).rejects.toThrow(/does not submit/)
    await expect(prepareTestFormRun(ctx({ permissions: new Set(['workflows.edit']) }), WORKFLOW, { values: VALID })).rejects.toThrow(/forms.submit/)
    await expect(prepareTestFormRun(ctx(), START_WF, { values: {} })).rejects.toThrow(/does not start from a form/)
    expect(db.tables.form_submissions).toHaveLength(0)
  })
})

describe('the start form of a workflow', () => {
  it('Form submitted → the form as its page draws it (buttons, header, filter); start form → grid over the variables', async () => {
    const { getWorkflowStartForm } = await import('@/lib/services/workflow-start-form')
    const form = await getWorkflowStartForm(ctx(), WORKFLOW, { draft: true })
    expect(form.kind).toBe('form')
    if (form.kind !== 'form') return
    expect(form.form).toMatchObject({ id: FORM, name: 'Expense claim', version: 4, header: { enabled: true, title: 'Expense claim' } })
    expect(form.form.buttons.map((b) => b.id)).toEqual(['submit', 'urgent_btn', 'cancel'])
    expect(form.button_ids).toEqual(['submit'])

    const start = await getWorkflowStartForm(ctx(), START_WF, { draft: false })
    expect(start.kind).toBe('start_form')
    if (start.kind === 'start_form') {
      // Field keys map back to the variable names (camelCase kept).
      expect(start.fields.map((f) => [start.name_by_key[f.key], f.type, f.required ?? false])).toEqual([['customerName', 'text', true], ['rush', 'boolean', false]])
      expect(start.layout?.rows[0]).toMatchObject({ columns: 2 })
    }
    // Without forms.submit the plain fields are used.
    expect(await getWorkflowStartForm(ctx({ permissions: new Set(['workflows.edit', 'workflows.view']) }), WORKFLOW, { draft: true })).toMatchObject({ kind: 'none' })
    // The Test runner needs workflows.edit.
    await expect(getWorkflowStartForm(ctx({ permissions: new Set(['workflows.view', 'forms.submit']) }), WORKFLOW, { draft: true })).rejects.toThrow(/workflows.edit/)
  })

  it('lists the forms that start a workflow (trigger + button actions) with page paths', async () => {
    const { getWorkflowFormEntries } = await import('@/lib/services/workflow-start-form')
    const entries = await getWorkflowFormEntries(ctx(), WORKFLOW)
    expect(entries.trigger).toEqual({ form_id: FORM, form_name: 'Expense claim', path: `/f/${FORM}`, exists: true, button_ids: ['submit'] })
    expect(entries.buttons).toEqual([{ form_id: u(11), form_name: 'Quick request', button_label: 'Go', path: `/f/${u(11)}` }])
    expect(entries.start_form).toBe(false)
    expect((await getWorkflowFormEntries(ctx(), START_WF))).toMatchObject({ trigger: null, buttons: [], start_form: true })
  })
})

describe('POST /api/workflows/execute-stream with form_submission', () => {
  function req(body: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NextRequest } = require('next/server')
    return new NextRequest('http://localhost/api/workflows/execute-stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  }

  it('runs the test with the server-built payload (client variables ignored), the would-logs first', async () => {
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    vi.mocked(executeWorkflow).mockClear()
    const { POST } = await import('@/app/api/workflows/execute-stream/route')
    const res = await POST(req({ workflow_id: WORKFLOW, variables: { submitted_by: 'someone-else', form_source: 'standalone' }, form_submission: { values: VALID, button_id: 'submit' } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    const call = vi.mocked(executeWorkflow).mock.calls[0] as any[]
    expect(call[2]).toBe(true)
    expect(call[3]).toMatchObject({ form_source: 'test', submitted_by: USER, form_button: 'submit', form: { amount: 245.5 } })
    expect(body.events[0]).toMatchObject({ type: 'log', data: { level: 'info', message: expect.stringMatching(/^Test submission/) } })
    expect(body.events.some((e: any) => /Would start workflow "Reimburse"/.test(e.data?.message))).toBe(true)
    expect(db.tables.form_submissions).toHaveLength(0)
    expect(rpcCalls).toEqual([])
  })

  it('a paused run streams ONE "Workflow paused" log and ONE done event (with the run id)', async () => {
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    vi.mocked(executeWorkflow).mockImplementationOnce(async (_id: any, _t: any, _test: any, _vars: any, onEvent: any) => {
      onEvent?.({ type: 'log', data: { level: 'info', message: 'Workflow paused — waiting for server event ev-1' } })
      onEvent?.({ type: 'done', data: { status: 'waiting_for_event', event_id: 'ev-1', paused_node_id: 'ut' } })
      return { status: 'waiting_for_event', node_results: {}, event_id: 'ev-1', paused_node_id: 'ut', run_id: 'run-1' } as any
    })
    const { NextRequest } = require('next/server')
    const { POST } = await import('@/app/api/workflows/execute-stream/route')
    const sse = await POST(new NextRequest('http://localhost/api/workflows/execute-stream', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ workflow_id: WORKFLOW, form_submission: { values: VALID, button_id: 'submit' } }) }))
    const events = (await sse.text()).split('\n\n').filter(Boolean).map((chunk) => JSON.parse(chunk.replace(/^data: /, '')))
    expect(events.filter((e) => /Workflow paused/.test(e.data?.message ?? ''))).toHaveLength(1)
    const done = events.filter((e) => e.type === 'done')
    expect(done).toHaveLength(1)
    expect(done[0].data).toMatchObject({ status: 'waiting_for_event', event_id: 'ev-1', paused_node_id: 'ut', run_id: 'run-1' })
    // The JSON fallback: no engine `done` among the events (the client treats `result` as the done).
    vi.mocked(executeWorkflow).mockImplementationOnce(async (_id: any, _t: any, _test: any, _vars: any, onEvent: any) => {
      onEvent?.({ type: 'done', data: { status: 'waiting_for_event', event_id: 'ev-2' } })
      return { status: 'waiting_for_event', node_results: {}, event_id: 'ev-2', run_id: 'run-2' } as any
    })
    const json = await (await POST(req({ workflow_id: WORKFLOW, form_submission: { values: VALID, button_id: 'submit' } }))).json()
    expect(json.events.filter((e: any) => e.type === 'done')).toEqual([])
    expect(json.result).toMatchObject({ status: 'waiting_for_event', event_id: 'ev-2', run_id: 'run-2' })
  })

  it('422 with per-field errors on invalid values (nothing runs)', async () => {
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    vi.mocked(executeWorkflow).mockClear()
    const { POST } = await import('@/app/api/workflows/execute-stream/route')
    const res = await POST(req({ workflow_id: WORKFLOW, form_submission: { values: { amount: 'x' } } }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(Object.keys(body.fields).sort()).toEqual(['amount', 'name'])
    expect(executeWorkflow).not.toHaveBeenCalled()
  })
})

describe('POST /api/workflows/execute-stream never starts a form-start test before the form is submitted', () => {
  function req(body: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NextRequest } = require('next/server')
    return new NextRequest('http://localhost/api/workflows/execute-stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  }

  it('a "Form submitted" workflow started without a form submission: 422 "needs form input", nothing runs', async () => {
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    vi.mocked(executeWorkflow).mockClear()
    const { POST } = await import('@/app/api/workflows/execute-stream/route')
    for (const body of [{ workflow_id: WORKFLOW }, { workflow_id: WORKFLOW, variables: { form: { name: 'Nancy' } } }, { workflow_id: WORKFLOW, form_submission: 'yes' }]) {
      const res = await POST(req(body))
      expect(res.status).toBe(422)
      expect(await res.json()).toMatchObject({ needs_form_input: true, error: expect.stringMatching(/submit/i) })
    }
    expect(executeWorkflow).not.toHaveBeenCalled()
  })

  it('a start-form workflow: its values are checked like the form (required fields), nothing runs on errors', async () => {
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    vi.mocked(executeWorkflow).mockClear()
    const { POST } = await import('@/app/api/workflows/execute-stream/route')
    const bad = await POST(req({ workflow_id: START_WF, variables: { customerName: '', rush: false } }))
    expect(bad.status).toBe(422)
    const body = await bad.json()
    expect(Object.keys(body.fields)).toHaveLength(1)
    expect(Object.values(body.fields)[0]).toMatch(/required/i)
    expect(executeWorkflow).not.toHaveBeenCalled()
    const missing = await POST(req({ workflow_id: START_WF }))
    expect(missing.status).toBe(422)
    expect(executeWorkflow).not.toHaveBeenCalled()

    const ok = await POST(req({ workflow_id: START_WF, variables: { customerName: 'ALFKI', rush: true } }))
    expect(ok.status).toBe(200)
    const call = vi.mocked(executeWorkflow).mock.calls[0] as any[]
    expect(call[2]).toBe(true)
    expect(call[3]).toMatchObject({ customerName: 'ALFKI', rush: true })
  })
})
