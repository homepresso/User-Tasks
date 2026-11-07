/**
 * Submission metadata ({{submission.*}}, lib/forms/submission-meta.ts):
 *  - one reserved object, built from the server's values on every source
 *    (form page, Run dialog, API, task form, designer test, start form);
 *  - a forged `submission` from the client is dropped and replaced;
 *  - stored views (list / get / CSV) carry it; the data picker lists it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSubmissionMeta, stripSubmissionMeta, submissionMetaFromRow, submissionReference, submissionSurface, urlParamsOf, withSubmissionMeta,
} from '@/lib/forms/submission-meta'
import { buildFormSubmittedPayload } from '@/lib/forms/submitted-trigger'
import { buildDataTree, schemaForPath } from '@/lib/workflow-data-picker'
import { createMemorySupabase } from './fixtures/supabase-memory'
import type { ServiceContext } from '@/lib/services/context'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TENANT = u(1)
const FORM = u(10)
const WORKFLOW = u(20)
const TRIGGERED = u(21)
const USER = u(30)
const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'amount', label: 'Amount', type: 'number' },
]
const LAYOUT = {
  rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }, { columns: 1, cells: [{ field_key: 'amount', span: 1 }] }],
  params: [
    { name: 'campaign', type: 'text', source: 'url' },
    { name: 'region', type: 'text', source: 'context' },
  ],
}
const FORGED = { id: 'forged', submitted_by: { id: u(99), name: 'Mallory', email: 'm@evil.example' }, source: 'task' }

describe('the metadata object (pure)', () => {
  it('reference, surface, URL params', () => {
    expect(submissionReference(u(80))).toBe(u(80).slice(0, 8))
    expect(submissionReference('test-abc')).toBe('test')
    expect(submissionReference(null)).toBeNull()
    expect(submissionReference('not-a-uuid')).toBeNull()
    expect(submissionSurface('standalone')).toBe('page')
    expect(submissionSurface('standalone', 'run_dialog')).toBe('run_dialog')
    expect(submissionSurface('api', 'run_dialog')).toBe('api')
    expect(submissionSurface('task')).toBe('task')
    expect(submissionSurface('anonymous')).toBe('anonymous')
    expect(submissionSurface('anonymous', 'run_dialog')).toBe('anonymous')
    // Only parameters declared with source url.
    expect(urlParamsOf(LAYOUT, { campaign: 'spring', region: 'NZ' })).toEqual({ campaign: 'spring' })
    expect(urlParamsOf(null, { campaign: 'x' })).toEqual({})
  })

  it('a client value is dropped and replaced, never merged', () => {
    const meta = buildSubmissionMeta({ id: u(80), submitted_at: '2026-11-04T00:00:00Z', submitter: { id: USER, name: 'Nancy' }, form: { id: FORM, name: 'Claim', version: 3 }, source: 'page' })
    const out = withSubmissionMeta({ name: 'N', submission: FORGED }, meta)
    expect(out.submission).toEqual(meta)
    expect(out.submission.submitted_by).toEqual({ id: USER, name: 'Nancy', email: null })
    expect(stripSubmissionMeta({ a: 1, submission: FORGED })).toEqual({ a: 1 })
  })

  it('anonymous: submitted_by is always { id: null, name: "Anonymous", email: null }, whatever was passed', () => {
    const meta = buildSubmissionMeta({ id: u(81), submitted_at: '2026-11-04T00:00:00Z', submitter: { id: u(99), name: 'Mallory', email: 'm@evil.example' }, form: { id: FORM, name: 'Claim', version: 3 }, source: 'anonymous' })
    expect(meta.submitted_by).toEqual({ id: null, name: 'Anonymous', email: null })
    expect(meta.source).toBe('anonymous')
    const fromRow = submissionMetaFromRow({ id: u(81), created_at: '2026-11-04T00:00:00Z', submitted_by: null, form_id: FORM, form_name: 'Claim', form_version: 3, source: 'anonymous' }, null)
    expect(fromRow).toMatchObject({ source: 'anonymous', submitted_by: { id: null, name: 'Anonymous', email: null } })
  })

  it('a stored row → its metadata (URL parameters are not stored)', () => {
    const meta = submissionMetaFromRow({ id: u(80), created_at: '2026-11-04T00:00:00Z', submitted_by: USER, form_id: FORM, form_name: 'Claim', form_version: 3, source: 'standalone', button_id: 'submit', result: { surface: 'run_dialog' } }, { name: 'Nancy', email: 'n@x' })
    expect(meta).toEqual({
      id: u(80), reference: u(80).slice(0, 8), submitted_at: '2026-11-04T00:00:00Z',
      submitted_by: { id: USER, name: 'Nancy', email: 'n@x' }, form: { id: FORM, name: 'Claim', version: 3 },
      source: 'run_dialog', button: 'submit', outcome: null, task_id: null, url_params: {},
    })
  })

  it('the trigger payload carries it beside the flat variables; fields stay under form.*', () => {
    const payload = buildFormSubmittedPayload({
      form: { id: FORM, name: 'Claim', version: 2 }, fields: FIELDS as any,
      values: { name: 'N', amount: 1, submission: FORGED },
      submission: { id: u(80), created_at: '2026-11-04T00:00:00Z', source: 'api' }, submitter: { id: USER, name: 'Nancy', email: 'n@x' },
    })
    expect(payload.form).toEqual({ name: 'N', amount: 1 })
    expect(payload.submission).toMatchObject({ id: u(80), source: 'api', submitted_by: { id: USER, name: 'Nancy', email: 'n@x' }, form: { id: FORM, name: 'Claim', version: 2 } })
  })
})

/* ── Services with an in-memory database ────────────────────────────── */

const started: any[] = []
vi.mock('@/lib/services/workflow-start', () => ({
  startWorkflow: vi.fn(async (ctx: any, input: any, options?: any) => {
    started.push({ ctx, input, options })
    return { mode: 'async', job_id: `job-${started.length}-0000-0000`, workflow_id: input.workflow_id, published_version_id: null }
  }),
}))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn() }))

let db: any
let rpcCalls: Array<{ name: string; args: any }>
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => db }))

function makeDb() {
  const mem = createMemorySupabase({
    forms: [{
      id: FORM, tenant_id: TENANT, name: 'Expense claim', description: null, fields: FIELDS, layout: LAYOUT, theme: { source: 'workspace' }, version: 3,
      buttons: [{ id: 'submit', label: 'Send', kind: 'submit', style: 'primary', actions: [{ type: 'start_workflow', workflow_id: WORKFLOW, workflow_name: 'Reimburse', inputs: { employee: '{{name}}' } }] }],
      header: null,
    }],
    users: [
      { id: USER, display_name: 'Nancy Davolio', email: 'nancy@northwind.example' },
      { id: u(99), display_name: 'Mallory', email: 'm@evil.example' },
    ],
    workflows: [{ id: TRIGGERED, tenant_id: TENANT, is_active: true, trigger_type: 'form_submitted', published_version_id: null, nodes: [{ id: 't', type: 'form_submitted', config: { form_id: FORM } }] }],
    form_submissions: [],
    user_memberships: [],
  }, { uuids: true })
  rpcCalls = []
  return { ...mem, rpc: async (name: string, args: any) => { rpcCalls.push({ name, args }); return { data: args?.p_jobs?.length ?? 1, error: null } } }
}

const ctx = (over: Partial<ServiceContext> = {}): ServiceContext => ({
  supabase: db, db, tenantId: TENANT, actorId: USER, permissions: new Set(['forms.submit', 'forms.edit']), authKind: 'session', source: 'ui', ...over,
})

const triggerData = () => rpcCalls.find((c) => c.name === 'enqueue_workflow_batch')!.args.p_jobs[0].trigger_data

describe('every source sets it on the server', () => {
  beforeEach(() => { db = makeDb(); started.length = 0 })

  it('form page: trigger + button start get the server\'s metadata; a forged one is ignored', async () => {
    const { submitForm } = await import('@/lib/services/form-submissions')
    const result = await submitForm(ctx(), FORM, {
      values: { name: 'Nancy', amount: '12', submission: FORGED, submitted_by: u(99) } as any,
      params: { campaign: 'spring', region: 'NZ' },
    }, { source: 'standalone' })
    const row = db.tables.form_submissions[0]
    expect(row.values.submission).toBeUndefined()
    expect(result.submission.reference).toBe(row.id.slice(0, 8))
    const meta = triggerData().submission
    expect(meta).toEqual({
      id: row.id, reference: row.id.slice(0, 8), submitted_at: row.created_at,
      submitted_by: { id: USER, name: 'Nancy Davolio', email: 'nancy@northwind.example' },
      form: { id: FORM, name: 'Expense claim', version: 3 },
      source: 'page', button: 'submit', outcome: null, task_id: null, url_params: { campaign: 'spring' },
    })
    expect(triggerData().form.submission).toBeUndefined()
    // The button's Start workflow carries the same object (startWorkflow sets it on the run).
    expect(started[0].options.submission).toEqual(meta)
    expect(started[0].input.variables.submission).toBeUndefined()
  })

  it('Run dialog: stored as standalone, marked run_dialog by the server', async () => {
    const { submitForm, getFormSubmission } = await import('@/lib/services/form-submissions')
    await submitForm(ctx(), FORM, { values: { name: 'Nancy' } }, { source: 'standalone', surface: 'run_dialog' })
    const row = db.tables.form_submissions[0]
    expect(row.source).toBe('standalone')
    expect(row.result.surface).toBe('run_dialog')
    expect(triggerData().submission.source).toBe('run_dialog')
    expect((await getFormSubmission(ctx(), row.id)).submission.source).toBe('run_dialog')
  })

  it('API: source api, the caller as submitter', async () => {
    const { submitForm } = await import('@/lib/services/form-submissions')
    await submitForm(ctx({ source: 'api' } as any), FORM, { values: { name: 'Nancy' } }, { source: 'api' })
    expect(triggerData().submission).toMatchObject({ source: 'api', submitted_by: { id: USER } })
  })

  it('task form: source task with the task id and outcome', async () => {
    const { recordTaskFormSubmission } = await import('@/lib/services/form-submissions')
    const task = { id: u(60), metadata: { form_ref: { form_id: FORM, name: 'Expense claim', version: 3 }, fields: FIELDS } }
    await recordTaskFormSubmission(db, { tenantId: TENANT, task, userId: USER, outcome: 'Approved', values: { name: 'Nancy', submission: FORGED }, buttonId: 'approve' })
    expect(triggerData().submission).toMatchObject({ source: 'task', task_id: u(60), outcome: 'Approved', submitted_by: { id: USER, name: 'Nancy Davolio' }, form: { version: 3 } })
  })

  it('designer test: source test, reference "test", nothing stored', async () => {
    const { planTestSubmission } = await import('@/lib/services/form-submissions')
    const { payload } = await planTestSubmission(ctx(), FORM, { values: { name: 'Nancy' }, params: { campaign: 'x' } })
    expect(payload.submission).toMatchObject({ source: 'test', reference: 'test', submitted_by: { id: USER }, url_params: { campaign: 'x' } })
    expect(db.tables.form_submissions).toHaveLength(0)
  })

  it('anonymous (public form link): source anonymous, submitted_by Anonymous, set by the server; unticked steps skipped', async () => {
    const { submitForm, listFormSubmissions, getFormSubmission, formSubmissionsCsv } = await import('@/lib/services/form-submissions')
    const anon = ctx({
      actorId: null, permissions: new Set(['forms.submit']), authKind: 'anonymous', source: 'anonymous',
      anonymous: { formId: FORM, ipHash: '0123456789abcdef', uploadSession: null, uploads: { enabled: false, maxBytes: 0, maxFiles: 0 } },
    })
    // Not from a public link: an anonymous context can't submit as anything else, and a session can't claim 'anonymous'.
    await expect(submitForm(anon, FORM, { values: { name: 'X' } }, { source: 'standalone' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(submitForm(ctx(), FORM, { values: { name: 'X' } }, { source: 'anonymous' })).rejects.toMatchObject({ code: 'forbidden' })
    await submitForm(anon, FORM, { values: { name: 'Visitor', submission: FORGED, submitted_by: u(99) } as any }, { source: 'anonymous', anonymousMeta: { ip_hash: '0123456789abcdef', user_agent: 'UA' } })
    const row = db.tables.form_submissions[0]
    expect(row).toMatchObject({ source: 'anonymous', submitted_by: null, anonymous_meta: { ip_hash: '0123456789abcdef', user_agent: 'UA' } })
    const meta = triggerData().submission
    expect(meta).toMatchObject({ source: 'anonymous', submitted_by: { id: null, name: 'Anonymous', email: null }, form: { id: FORM, version: 3 } })
    expect(triggerData().submitted_by_name).toBe('Anonymous')
    // The bar button's Start workflow is not ticked "Allow for anonymous": skipped.
    expect(started).toHaveLength(0)
    const staff = ctx()
    const { submissions } = await listFormSubmissions(staff, { form_id: FORM }, { limit: 50, offset: 0 })
    expect(submissions[0]).toMatchObject({ submitted_by_name: 'Anonymous', submission: { source: 'anonymous', submitted_by: { name: 'Anonymous' } } })
    expect((await getFormSubmission(staff, row.id)).submitted_by_name).toBe('Anonymous')
    const csv = await formSubmissionsCsv(staff, { form_id: FORM })
    expect(csv.csv.split('\n')[1]).toContain(',Anonymous,')
    expect(csv.csv.split('\n')[1]).toContain(',anonymous,anonymous,')
  })

  it('views: list, get and CSV carry the metadata', async () => {
    const { submitForm, listFormSubmissions, formSubmissionsCsv } = await import('@/lib/services/form-submissions')
    await submitForm(ctx(), FORM, { values: { name: 'Nancy' } })
    const { submissions } = await listFormSubmissions(ctx(), { form_id: FORM }, { limit: 50, offset: 0 })
    expect(submissions[0].submission).toMatchObject({ source: 'page', submitted_by: { name: 'Nancy Davolio', email: 'nancy@northwind.example' }, form: { version: 3 } })
    const csv = await formSubmissionsCsv(ctx(), { form_id: FORM })
    const [header, line] = csv.csv.split('\n')
    expect(header.split(',').slice(0, 9)).toEqual(['submission_id', 'reference', 'submitted_at', 'submitted_by', 'submitted_by_email', 'submitted_by_id', 'form_version', 'source', 'submission_source'])
    expect(line).toContain('nancy@northwind.example')
    expect(line).toContain(',standalone,page,')
  })
})

describe('the data picker', () => {
  it('lists submission.* typed under the Form submitted group', () => {
    const groups = buildDataTree({
      nodes: [
        { id: 't', type: 'form_submitted', label: 'Claim', config: { form_id: FORM, form_name: 'Expense claim', fields: FIELDS } },
        { id: 'log', type: 'log', label: 'Log', config: {} },
      ] as any,
      edges: [{ source: 't', target: 'log' }] as any,
      currentNodeId: 'log',
    })
    const group = groups.find((g) => g.label === 'Form submitted › Expense claim')!
    const root = group.roots.find((r) => r.path === 'submission')!
    expect(root.label).toBe('Submission details')
    expect(root.schema?.fields?.map((f) => f.name)).toEqual(['id', 'reference', 'submitted_at', 'submitted_by', 'form', 'source', 'button', 'outcome', 'task_id', 'url_params'])
    const roots = groups.flatMap((g) => g.roots)
    expect(schemaForPath('submission.submitted_by.name', roots)?.type).toBe('string')
    expect(schemaForPath('submission.form.version', roots)?.type).toBe('number')
  })

  it('a start form lists it with the workflow inputs; a User Task lists completed_by / completed_at', () => {
    const groups = buildDataTree({
      nodes: [
        { id: 's', type: 'manual', label: 'Start', config: { start_form: { layout: null } } },
        { id: 'ut', type: 'user_task', label: 'Approve', config: {} },
        { id: 'log', type: 'log', label: 'Log', config: {} },
      ] as any,
      edges: [{ source: 's', target: 'ut' }, { source: 'ut', target: 'log' }] as any,
      currentNodeId: 'log',
      workflowVariables: [{ name: 'employee', type: 'string' }] as any,
    })
    const start = groups.find((g) => g.id === 'workflow-variables')!
    expect(start.roots.map((r) => r.path)).toEqual(['employee', 'submission'])
    const task = groups.find((g) => g.id === 'step:ut')!
    expect(task.roots.map((r) => r.path)).toEqual(expect.arrayContaining(['completed_by', 'completed_by_name', 'completed_by_email', 'completed_at']))
  })
})
