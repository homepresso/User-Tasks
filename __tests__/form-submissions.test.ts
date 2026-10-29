/**
 * Form buttons, behaviours, headers, standalone submissions and the "Form
 * submitted" trigger:
 *  - button config schema + backward compat (no stored buttons → Submit /
 *    Cancel; defaults are not stored), header schema (new forms on, old off);
 *  - behaviour chains: message, success screen, start workflow with input
 *    mapping (system action attributed to the submitter, audited), redirect
 *    validation, double-submit idempotency;
 *  - permissions: forms.submit allowed / denied, cross-tenant, adding a
 *    start-workflow action needs workflows.activate;
 *  - the trigger fires for standalone and task-form submissions with a typed
 *    payload (button filter), and the data picker types {{form.<key>}};
 *  - data flow (2): a linked task form carries header + buttons to the task
 *    and its values come back as task_data;
 *  - portability: trigger form_id / start-workflow ids remap, header images
 *    travel as bytes, submissions never travel.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows and manifests are free-form JSON */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FORM_BUTTONS, buttonProblems, interpolateButtonText, normalizeFormButtons, planButtonEffects, resolveInputTemplate, safeRedirectUrl,
} from '@/lib/forms/buttons'
import { defaultFormHeader, headerImageSrc, isHeaderImageUrl, normalizeFormHeader, resolveHeaderText, DEFAULT_HEADER_IMAGE } from '@/lib/forms/header'
import { normalizeFormDefinition, nodeFormPatch, readNodeForm, storedButtons } from '@/lib/forms/definition'
import { definitionFrom, designerStateFrom } from '@/lib/forms/designer-state'
import { buildFormSubmittedPayload, triggerMatchesButton } from '@/lib/forms/submitted-trigger'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { buildDataTree } from '@/lib/workflow-data-picker'
import { validateNode } from '@/lib/workflow-validation'
import { createEmptyAssetIdMaps, remapKnownIds } from '@/lib/portability/id-maps'
import { scanAssetReferences } from '@/lib/portability/dependencies'
import { PLAN_SECTIONS } from '@/lib/portability/plan'
import { createMemorySupabase } from './fixtures/supabase-memory'
import type { ServiceContext } from '@/lib/services/context'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TENANT = u(1)
const OTHER = u(2)
const FORM = u(10)
const WORKFLOW = u(20)
const TRIGGERED = u(21)
const USER = u(30)

const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'amount', label: 'Amount', type: 'number' },
  { key: 'urgent', label: 'Urgent', type: 'boolean' },
]

describe('buttons: schema and backward compatibility', () => {
  it('no stored buttons → Submit + Cancel; defaults are not stored', () => {
    expect(normalizeFormButtons(null)).toEqual(DEFAULT_FORM_BUTTONS)
    expect(normalizeFormButtons([])).toEqual(DEFAULT_FORM_BUTTONS)
    expect(storedButtons(DEFAULT_FORM_BUTTONS)).toBeNull()
    const def = normalizeFormDefinition({ fields: FIELDS })
    expect(def.buttons).toBeNull()
    expect(def.header).toBeNull()
    // Existing node configs keep their shape: nothing new is written.
    const patch = nodeFormPatch(def, null)
    expect(patch.form_buttons).toBeUndefined()
    expect(patch.form_header).toBeUndefined()
  })

  it('cleans labels, kinds, styles, ids, actions; keeps one submitting button', () => {
    const buttons = normalizeFormButtons([
      { id: 'approve', label: ' Approve ', kind: 'outcome', outcome: 'Approved', actions: [{ type: 'message', text: 'Thanks {{name}}' }, { type: 'nonsense' }] },
      { id: 'approve', label: 'Reject', kind: 'outcome', style: 'danger', outcome: 'Rejected' },
      { label: 'Cancel', kind: 'cancel', hidden: true, actions: [{ type: 'start_workflow', workflow_id: WORKFLOW }, { type: 'redirect', url: '/tasks' }] },
      { label: 'Cancel 2', kind: 'cancel' },
    ])
    expect(buttons.map((b) => [b.id, b.label, b.kind, b.style, b.outcome ?? null])).toEqual([
      ['approve', 'Approve', 'outcome', 'primary', 'Approved'],
      ['outcome_2', 'Reject', 'outcome', 'danger', 'Rejected'],
      ['cancel', 'Cancel', 'cancel', 'secondary', null],
    ])
    expect(buttons[0].actions).toEqual([{ type: 'message', text: 'Thanks {{name}}' }])
    // Cancel cannot start workflows.
    expect(buttons[2].actions).toEqual([{ type: 'redirect', url: '/tasks' }])
    expect(buttons[2].hidden).toBe(true)
    expect(normalizeFormButtons([{ kind: 'cancel' }]).map((b) => b.kind)).toEqual(['submit', 'cancel'])
  })

  it('header: new forms start with one; existing forms keep none; round trip through the designer', () => {
    expect(designerStateFrom({ fields: [], layout: null, theme: { source: 'workspace' } }).header.enabled).toBe(true)
    const existing = designerStateFrom(normalizeFormDefinition({ fields: FIELDS }))
    expect(existing.header.enabled).toBe(false)
    expect(definitionFrom(existing).header).toBeNull()
    const on = definitionFrom({ ...existing, header: { ...defaultFormHeader('Expense claim'), subtitle: 'For {{task_data.name}}' } })
    expect(on.header).toEqual({ enabled: true, image: 'default', title: 'Expense claim', subtitle: 'For {{task_data.name}}', align: 'left' })
    expect(readNodeForm(nodeFormPatch(on, null)).header).toEqual(on.header)
  })

  it('header images: only uploads of this app; resolution of texts and the image', () => {
    const own = `storage://task-files/form-headers/${TENANT}/${u(5)}.png`
    expect(isHeaderImageUrl(own)).toBe(true)
    expect(isHeaderImageUrl('https://evil.example/x.png')).toBe(false)
    expect(isHeaderImageUrl('javascript:alert(1)')).toBe(false)
    expect(normalizeFormHeader({ enabled: true, image: 'upload', image_url: 'https://evil.example/x.png' })?.image).toBe('default')
    expect(normalizeFormHeader({ enabled: true, image: 'upload', image_url: own })?.image_url).toBe(own)
    expect(normalizeFormHeader({ enabled: true, title: '<b>Hi</b>' })?.title).toBe('bHi/b')
    expect(resolveHeaderText('Claim of {{task_data.name}} ({{amount}}) · {{task.title}} · {{customer_item}}', { name: 'Nancy', amount: 12, customer_item: { name: 'Alfreds' } }, { title: 'T1' })).toBe('Claim of Nancy (12) · T1 · Alfreds')
    expect(headerImageSrc({ enabled: true, image: 'default' })).toBe(DEFAULT_HEADER_IMAGE)
    expect(headerImageSrc({ enabled: true, image: 'workspace_logo' }, '/files/logos/x.png')).toBe('/files/logos/x.png')
    expect(headerImageSrc({ enabled: true, image: 'none' })).toBeNull()
  })
})

describe('behaviours', () => {
  const policy = { appOrigin: 'https://app.example.com', allowedHosts: ['partner.example.org', '*.northwind.example'] }

  it('redirects: app paths, the app origin, allow-listed hosts only', () => {
    expect(safeRedirectUrl('/tasks?x=1', policy)).toBe('/tasks?x=1')
    expect(safeRedirectUrl('//evil.example', policy)).toBeNull()
    expect(safeRedirectUrl('/\\evil.example', policy)).toBeNull()
    expect(safeRedirectUrl('https://app.example.com/f/x', policy)).toBe('https://app.example.com/f/x')
    expect(safeRedirectUrl('https://partner.example.org/thanks', policy)).toBe('https://partner.example.org/thanks')
    expect(safeRedirectUrl('https://shop.northwind.example/', policy)).toBe('https://shop.northwind.example/')
    expect(safeRedirectUrl('https://evil.example', policy)).toBeNull()
    expect(safeRedirectUrl('javascript:alert(1)', policy)).toBeNull()
    expect(safeRedirectUrl('https://user:pw@app.example.com/', policy)).toBeNull()
    const [bad] = normalizeFormButtons([{ id: 'go', kind: 'submit', label: 'Go', actions: [{ type: 'redirect', url: 'https://evil.example' }] }])
    expect(buttonProblems([bad], { policy }).go).toMatch(/app page/)
  })

  it('outcome buttons must match the step outcomes', () => {
    const buttons = normalizeFormButtons([{ id: 'ok', kind: 'outcome', label: 'OK', outcome: 'Accepted' }])
    expect(buttonProblems(buttons, { outcomes: ['Approved', 'Rejected'] }).ok).toMatch(/not one of this step's outcomes/)
    expect(buttonProblems(buttons, { outcomes: ['Accepted'] })).toEqual({})
  })

  it('chains: message → start workflow → success screen with placeholders; redirect dropped when not allowed', () => {
    const [button] = normalizeFormButtons([{
      id: 'submit', kind: 'submit', label: 'Send', actions: [
        { type: 'message', text: 'Thanks {{name}} ({{form.amount}})' },
        { type: 'start_workflow', workflow_id: WORKFLOW, inputs: { employee: '{{name}}', amount: '{{amount}}' } },
        { type: 'success_screen', title: 'Done, {{name}}', text: 'Reference {{run_reference}}', screen_button: 'link', url: '/tasks' },
        { type: 'redirect', url: 'https://evil.example' },
      ],
    }])
    const effects = planButtonEffects(button, { values: { name: 'Nancy', amount: 12 }, extras: { run_reference: 'abc123' } }, policy)
    expect(effects).toEqual({
      messages: [{ text: 'Thanks Nancy (12)', tone: 'success' }],
      success_screen: { title: 'Done, Nancy', text: 'Reference abc123', button: 'link', url: '/tasks' },
    })
    expect(resolveInputTemplate('{{amount}}', { values: { amount: 12 } })).toBe(12)
    expect(resolveInputTemplate('{{customer_item}}', { values: { customer_item: { id: 1 } } })).toEqual({ id: 1 })
    expect(resolveInputTemplate('Claim {{name}}', { values: { name: 'N' } })).toBe('Claim N')
    expect(interpolateButtonText('{{missing}}!', { values: {} })).toBe('!')
  })
})

/* ── Services with an in-memory database ────────────────────────────── */

const started: any[] = []
vi.mock('@/lib/services/workflow-start', () => ({
  startWorkflow: vi.fn(async (ctx: any, input: any, options?: any) => {
    if (input.workflow_id === u(99)) throw Object.assign(new Error('Workflow is not active'), {})
    started.push({ ctx, input, options })
    return { mode: 'async', job_id: `job-${started.length}-0000-0000`, workflow_id: input.workflow_id, published_version_id: null }
  }),
}))
const audits: any[] = []
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async (entry: any) => { audits.push(entry) }) }))
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn() }))

let db: any
let rpcCalls: Array<{ name: string; args: any }>
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => db }))

function makeDb(extra: Record<string, any[]> = {}) {
  const mem = createMemorySupabase({
    forms: [
      { id: FORM, tenant_id: TENANT, name: 'Expense claim', description: null, fields: FIELDS, layout: null, theme: { source: 'workspace' }, version: 3,
        buttons: [
          { id: 'submit', label: 'Send claim', kind: 'submit', style: 'primary', actions: [
            { type: 'start_workflow', workflow_id: WORKFLOW, workflow_name: 'Reimburse', inputs: { employee: '{{name}}', amount: '{{amount}}' } },
            { type: 'success_screen', title: 'Thanks {{name}}', text: 'Reference {{run_reference}}', screen_button: 'submit_another' },
          ] },
          { id: 'cancel', label: 'Cancel', kind: 'cancel', style: 'secondary' },
        ],
        header: { enabled: true, image: 'default', title: 'Expense claim' } },
    ],
    users: [{ id: USER, display_name: 'Nancy Davolio', email: 'nancy@northwind.example' }],
    workflows: [
      { id: TRIGGERED, tenant_id: TENANT, is_active: true, trigger_type: 'form_submitted', published_version_id: null, nodes: [{ id: 't', type: 'form_submitted', config: { form_id: FORM } }] },
      { id: u(22), tenant_id: TENANT, is_active: true, trigger_type: 'form_submitted', published_version_id: null, nodes: [{ id: 't', type: 'form_submitted', config: { form_id: FORM, button_ids: ['approve'] } }] },
      { id: u(23), tenant_id: TENANT, is_active: true, trigger_type: 'form_submitted', published_version_id: null, nodes: [{ id: 't', type: 'form_submitted', config: { form_id: u(77) } }] },
    ],
    form_submissions: [],
    user_memberships: [],
    ...extra,
  }, { uuids: true })
  rpcCalls = []
  return { ...mem, rpc: async (name: string, args: any) => { rpcCalls.push({ name, args }); return { data: args?.p_jobs?.length ?? 1, error: null } } }
}

const ctx = (over: Partial<ServiceContext> = {}): ServiceContext => ({
  supabase: db, db, tenantId: TENANT, actorId: USER, permissions: new Set(['forms.submit']), authKind: 'session', source: 'ui', ...over,
})

describe('submitForm', () => {
  beforeEach(() => { db = makeDb(); started.length = 0; audits.length = 0 })

  it('validates, stores, starts the workflow for the submitter (audited), fires the trigger, plans the success screen', async () => {
    const { submitForm } = await import('@/lib/services/form-submissions')
    const result = await submitForm(ctx(), FORM, { values: { name: 'Nancy', amount: '245.5', urgent: 'yes', extra: 'dropped' }, button_id: 'submit', idempotency_key: 'key-0000001' })
    expect(result.submission).toMatchObject({ form_id: FORM, form_version: 3, button_id: 'submit' })
    const row = db.tables.form_submissions[0]
    expect(row).toMatchObject({ tenant_id: TENANT, source: 'standalone', submitted_by: USER, values: { name: 'Nancy', amount: 245.5, urgent: true } })
    expect(row.values.extra).toBeUndefined()
    // Start workflow: a system context (no permission gate), the submitter attributed, values mapped and typed.
    expect(started).toHaveLength(1)
    expect(started[0].ctx).toMatchObject({ tenantId: TENANT, actorId: USER, permissions: null })
    expect(started[0].input).toMatchObject({ workflow_id: WORKFLOW, async: true, variables: { employee: 'Nancy', amount: 245.5, form_submission_id: row.id } })
    // The submitter (ctx.actorId) starts the run, via form — signed by startWorkflow, not a start variable.
    expect(started[0].input.variables.workflow_started_by).toBeUndefined()
    expect(started[0].options).toEqual({ via: 'form', filesVerified: true })
    expect(audits.some((a) => a.objectType === 'form' && a.action === 'execute' && /started workflow "Reimburse"/.test(a.summary))).toBe(true)
    expect(result.runs).toEqual([{ workflow_id: WORKFLOW, workflow_name: 'Reimburse', job_id: 'job-1-0000-0000', status: 'queued' }])
    expect(result.effects.success_screen).toEqual({ title: 'Thanks Nancy', text: 'Reference job-1-00', button: 'submit_another' })
    // Trigger: only the workflow on this form without a button filter (button "submit").
    const batch = rpcCalls.find((c) => c.name === 'enqueue_workflow_batch')!
    expect(batch.args.p_jobs.map((j: any) => j.workflow_id)).toEqual([TRIGGERED])
    expect(batch.args.p_jobs[0]).toMatchObject({ trigger_type: 'form_submitted', trigger_data: {
      form: { name: 'Nancy', amount: 245.5, urgent: true }, form_id: FORM, form_name: 'Expense claim', form_version: 3, form_button: 'submit',
      form_source: 'standalone', submitted_by: USER, submitted_by_name: 'Nancy Davolio', submitted_by_email: 'nancy@northwind.example', form_submission_id: row.id,
    } })
  })

  it('double submit with the same key is one submission (same result)', async () => {
    const { submitForm } = await import('@/lib/services/form-submissions')
    const first = await submitForm(ctx(), FORM, { values: { name: 'N' }, idempotency_key: 'key-0000002' })
    const second = await submitForm(ctx(), FORM, { values: { name: 'N' }, idempotency_key: 'key-0000002' })
    expect(db.tables.form_submissions).toHaveLength(1)
    expect(started).toHaveLength(1)
    expect(second.replayed).toBe(true)
    expect(second.submission.id).toBe(first.submission.id)
    expect(second.effects).toEqual(first.effects)
    await expect(submitForm(ctx({ actorId: u(31) }), FORM, { values: { name: 'N' }, idempotency_key: 'key-0000002' })).rejects.toThrow(/another submission/)
  })

  it('refuses invalid values, unknown / non-submitting buttons, no permission, other tenants', async () => {
    const { submitForm } = await import('@/lib/services/form-submissions')
    await expect(submitForm(ctx(), FORM, { values: { amount: 'x' } })).rejects.toThrow(/Name is required.*Amount must be a number|Amount must be a number.*Name is required/)
    await expect(submitForm(ctx(), FORM, { values: { name: 'N' }, button_id: 'cancel' })).rejects.toThrow(/does not submit/)
    await expect(submitForm(ctx(), FORM, { values: { name: 'N' }, button_id: 'nope' })).rejects.toThrow(/no button "nope"/)
    await expect(submitForm(ctx({ permissions: new Set(['forms.view']) }), FORM, { values: { name: 'N' } })).rejects.toThrow(/forms.submit/)
    await expect(submitForm(ctx({ tenantId: OTHER }), FORM, { values: { name: 'N' } })).rejects.toThrow(/Form not found/)
    expect(db.tables.form_submissions).toHaveLength(0)
    expect(started).toHaveLength(0)
  })

  it('a failed workflow start is reported, the submission stands', async () => {
    db.tables.forms[0].buttons[0].actions[0].workflow_id = u(99)
    const { submitForm } = await import('@/lib/services/form-submissions')
    const result = await submitForm(ctx(), FORM, { values: { name: 'N' } })
    expect(result.runs[0]).toMatchObject({ status: 'failed' })
    expect(result.effects.messages.at(-1)?.text).toMatch(/could not be started/)
    expect(db.tables.form_submissions).toHaveLength(1)
  })

  it('reads: own submissions only, everything with forms.edit', async () => {
    db = makeDb({ form_submissions: [
      { id: u(50), tenant_id: TENANT, form_id: FORM, submitted_by: USER, values: { name: 'a' }, created_at: '2026-10-01T00:00:00Z' },
      { id: u(51), tenant_id: TENANT, form_id: FORM, submitted_by: u(31), values: { name: 'b' }, created_at: '2026-10-02T00:00:00Z' },
      { id: u(52), tenant_id: OTHER, form_id: FORM, submitted_by: USER, values: { name: 'c' }, created_at: '2026-10-03T00:00:00Z' },
    ] })
    const { listFormSubmissions, getFormSubmission, formSubmissionsCsv } = await import('@/lib/services/form-submissions')
    const own = await listFormSubmissions(ctx(), { form_id: FORM }, { limit: 50, offset: 0 })
    expect(own.submissions.map((s: any) => s.id)).toEqual([u(50)])
    const all = await listFormSubmissions(ctx({ permissions: new Set(['forms.submit', 'forms.edit']) }), { form_id: FORM }, { limit: 50, offset: 0 })
    expect(all.submissions.map((s: any) => s.id).sort()).toEqual([u(50), u(51)])
    await expect(getFormSubmission(ctx(), u(51))).rejects.toThrow(/not found/)
    const csv = await formSubmissionsCsv(ctx({ permissions: new Set(['forms.submit', 'forms.edit']) }), { form_id: FORM })
    expect(csv.rows).toBe(2)
    expect(csv.csv.split('\n')[0]).toBe('submission_id,submitted_at,submitted_by,source,button,outcome,task_id,name,amount,urgent')
  })

  it('CSV cells cannot become formulas', async () => {
    db = makeDb({ form_submissions: [{ id: u(50), tenant_id: TENANT, form_id: FORM, submitted_by: USER, values: { name: '=HYPERLINK("x")' }, created_at: '2026-10-01T00:00:00Z' }] })
    const { formSubmissionsCsv } = await import('@/lib/services/form-submissions')
    const csv = await formSubmissionsCsv(ctx(), { form_id: FORM })
    expect(csv.csv).toContain(`"'=HYPERLINK(""x"")"`)
  })
})

describe('task forms and the trigger (data flow 2)', () => {
  beforeEach(() => { db = makeDb(); started.length = 0 })

  it('a linked task form completion is a submission (source task) and fires the trigger with the outcome', async () => {
    const { recordTaskFormSubmission } = await import('@/lib/services/form-submissions')
    const task = { id: u(60), metadata: { form_ref: { form_id: FORM, name: 'Expense claim', version: 3 }, fields: FIELDS } }
    const result = await recordTaskFormSubmission(db, { tenantId: TENANT, task, userId: USER, outcome: 'Approved', values: { name: 'Nancy', amount: 10, urgent: false }, buttonId: 'approve' })
    expect(result?.submission_id).toBeTruthy()
    expect(db.tables.form_submissions[0]).toMatchObject({ source: 'task', task_id: u(60), outcome: 'Approved', button_id: 'approve' })
    const batch = rpcCalls.find((c) => c.name === 'enqueue_workflow_batch')!
    // Both the any-button trigger and the one filtered to "approve" fire.
    expect(batch.args.p_jobs.map((j: any) => j.workflow_id).sort()).toEqual([TRIGGERED, u(22)].sort())
    expect(batch.args.p_jobs[0].trigger_data).toMatchObject({ form: { name: 'Nancy', amount: 10, urgent: false }, form_source: 'task', task_id: u(60), form_outcome: 'Approved' })
  })

  it('a task whose form is not linked records nothing', async () => {
    const { recordTaskFormSubmission } = await import('@/lib/services/form-submissions')
    expect(await recordTaskFormSubmission(db, { tenantId: TENANT, task: { id: u(61), metadata: { fields: FIELDS } }, userId: USER, outcome: 'Done', values: {} })).toBeNull()
    expect(db.tables.form_submissions).toHaveLength(0)
  })

  it('the runtime form of a linked step carries its header and buttons (to the task metadata)', async () => {
    const { resolveRuntimeForm } = await import('@/lib/services/forms')
    const runtime = await resolveRuntimeForm(db, TENANT, { form_id: FORM, fields: [] })
    expect(runtime.header).toMatchObject({ enabled: true, title: 'Expense claim' })
    expect(runtime.buttons?.map((b) => b.id)).toEqual(['submit', 'cancel'])
    expect(runtime.fields.map((f) => f.key)).toEqual(['name', 'amount', 'urgent'])
  })
})

describe('trigger payload, filter, data picker (data flow 1)', () => {
  it('typed payload; lookups carry their item', () => {
    const fields = normalizeTaskFields([...FIELDS, { key: 'customer', label: 'Customer', type: 'lookup', lookup: { source: 'table', table_id: u(70), search_columns: ['n'], display_columns: ['n'] } }])
    const payload = buildFormSubmittedPayload({
      form: { id: FORM, name: 'Expense claim', version: 2 }, fields,
      values: { name: 'N', amount: 1.5, urgent: true, customer: u(71), customer_item: { n: 'Alfreds' }, secret: 'x' },
      submission: { id: u(80), created_at: '2026-10-28T00:00:00Z', source: 'api' }, submitter: { id: USER, name: 'Nancy' },
    })
    expect(payload.form).toEqual({ name: 'N', amount: 1.5, urgent: true, customer: u(71), customer_item: { n: 'Alfreds' } })
    expect(payload).toMatchObject({ form_source: 'api', submitted_by_name: 'Nancy', form_version: 2 })
    expect(triggerMatchesButton({ button_ids: ['Approved'] }, { button_id: 'x', outcome: 'approved' })).toBe(true)
    expect(triggerMatchesButton({ button_ids: ['submit'] }, { button_id: 'cancel' })).toBe(false)
    expect(triggerMatchesButton({}, { button_id: 'anything' })).toBe(true)
  })

  it('the data picker offers {{form.<key>}} typed, with lookup items and the submission variables', () => {
    const groups = buildDataTree({
      nodes: [
        { id: 't', type: 'form_submitted', label: 'Claim submitted', config: { form_id: FORM, form_name: 'Expense claim', fields: FIELDS } },
        { id: 'log', type: 'log', label: 'Log', config: {} },
      ] as any,
      edges: [{ source: 't', target: 'log' }] as any,
      currentNodeId: 'log',
    })
    const group = groups.find((g) => g.label === 'Form submitted › Expense claim')!
    expect(group.kind).toBe('form')
    expect(groups[0]).toBe(group)
    expect(group.roots.slice(0, 3).map((r) => [r.path, r.label])).toEqual([['form.name', 'Name'], ['form.amount', 'Amount'], ['form.urgent', 'Urgent']])
    const form = group.roots.find((r) => r.path === 'form')!
    expect(form.schema?.fields?.map((f) => [f.name, f.type])).toEqual([['name', 'string'], ['amount', 'number'], ['urgent', 'boolean']])
    expect(group.roots.map((r) => r.path)).toEqual(expect.arrayContaining(['submitted_by_name', 'submitted_at', 'form_button', 'form_submission_id']))
  })

  it('validation flags a trigger without a form', () => {
    expect(validateNode({ id: 't', type: 'form_submitted', label: 'x', config: {}, position: { x: 0, y: 0 } } as any)).toEqual(['Choose the form whose submissions start this workflow'])
    expect(validateNode({ id: 't', type: 'form_submitted', label: 'x', config: { form_id: FORM }, position: { x: 0, y: 0 } } as any)).toEqual([])
  })
})

describe('portability', () => {
  it('trigger form_id and a button\'s workflow are dependencies and remap', () => {
    const workflow = { id: u(90), nodes: [{ id: 't', type: 'form_submitted', config: { form_id: FORM, button_ids: ['submit'] } }] }
    const form = { id: FORM, buttons: [{ id: 'submit', kind: 'submit', actions: [{ type: 'start_workflow', workflow_id: WORKFLOW }] }] }
    expect(scanAssetReferences(workflow).refs).toEqual([{ type: 'form', id: FORM, path: ['nodes', 0, 'config', 'form_id'] }])
    expect(scanAssetReferences(form).refs).toEqual([{ type: 'workflow', id: WORKFLOW, path: ['buttons', 0, 'actions', 0, 'workflow_id'] }])
    const maps = createEmptyAssetIdMaps()
    maps.form[FORM] = u(11)
    maps.workflow[WORKFLOW] = u(24)
    expect((remapKnownIds(workflow, maps).nodes[0].config as any).form_id).toBe(u(11))
    expect((remapKnownIds(form, maps).buttons[0].actions[0] as any).workflow_id).toBe(u(24))
  })

  it('submissions never travel (no export / plan section)', () => {
    expect(PLAN_SECTIONS.map((s) => s.section)).not.toContain('form_submissions')
  })

  it('header images travel as bytes and come back as an upload in the importing workspace', async () => {
    const stored = new Map<string, { bytes: Uint8Array; contentType: string }>()
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    stored.set(`task-files/form-headers/${TENANT}/${u(5)}.png`, { bytes: png, contentType: 'image/png' })
    vi.doMock('@/lib/providers/storage', () => ({
      getStorageProvider: async () => ({
        id: 'local',
        get: async (bucket: string, key: string) => {
          const hit = stored.get(`${bucket}/${key}`)
          return hit ? { body: new Response(hit.bytes as unknown as BodyInit).body, contentType: hit.contentType, size: hit.bytes.byteLength } : null
        },
        put: async (bucket: string, key: string, body: Uint8Array, opts: any) => { stored.set(`${bucket}/${key}`, { bytes: body, contentType: opts.contentType }) },
        publicUrl: (bucket: string, key: string) => `/files/${bucket}/${key}`,
      }),
    }))
    vi.resetModules()
    const { embedFormHeaderImages, restoreFormHeaderImage } = await import('@/lib/portability/forms')
    const [exported] = await embedFormHeaderImages([{ id: FORM, header: { enabled: true, image: 'upload', image_url: `storage://task-files/form-headers/${TENANT}/${u(5)}.png` } }])
    expect(exported.header.image_url).toBeUndefined()
    expect(exported.header.image_data).toEqual({ content_type: 'image/png', data_base64: Buffer.from(png).toString('base64') })
    const restored = await restoreFormHeaderImage({ ...ctx(), tenantId: OTHER, permissions: new Set(['forms.edit']) }, exported)
    expect(restored.header.image_data).toBeUndefined()
    expect(restored.header.image_url).toMatch(new RegExp(`form-headers/${OTHER}/[0-9a-f-]+\\.png$`))
    // A foreign address without bytes falls back to the default mark.
    const foreign = await restoreFormHeaderImage({ ...ctx(), tenantId: OTHER }, { header: { enabled: true, image: 'upload', image_url: `storage://task-files/form-headers/${TENANT}/${u(5)}.png` } })
    expect(foreign.header.image).toBe('default')
    vi.doUnmock('@/lib/providers/storage')
  })
})

describe('designing forms', () => {
  beforeEach(() => { db = makeDb() })

  it('adding a start-workflow action needs workflows.activate and a workflow in this workspace', async () => {
    const forms = await import('@/lib/services/forms')
    const editor = (perms: string[]) => ctx({ permissions: new Set(perms) })
    const buttons = [{ id: 'submit', kind: 'submit', label: 'Go', actions: [{ type: 'start_workflow', workflow_id: TRIGGERED }] }]
    await expect(forms.createForm(editor(['forms.edit']), { name: 'F', fields: FIELDS, buttons })).rejects.toThrow(/workflows.activate/)
    const created = await forms.createForm(editor(['forms.edit', 'workflows.activate']), { name: 'F', fields: FIELDS, buttons })
    expect(created.buttons).toHaveLength(1)
    await expect(forms.createForm(editor(['forms.edit', 'workflows.activate']), { name: 'G', fields: FIELDS, buttons: [{ ...buttons[0], actions: [{ type: 'start_workflow', workflow_id: u(98) }] }] })).rejects.toThrow(/not in this workspace/)
    // Unchanged start actions don't need it again (e.g. renaming a button).
    const updated = await forms.updateForm(editor(['forms.edit']), created.id, { buttons: [{ ...buttons[0], label: 'Send' }] })
    expect(updated.version).toBe(2)
  })

  it('a header image from another workspace is refused', async () => {
    const forms = await import('@/lib/services/forms')
    await expect(forms.createForm(ctx({ permissions: new Set(['forms.edit']) }), { name: 'F', fields: FIELDS, header: { enabled: true, image: 'upload', image_url: `storage://task-files/form-headers/${OTHER}/${u(5)}.png` } }))
      .rejects.toThrow(/upload in this workspace/)
  })
})
