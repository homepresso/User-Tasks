/**
 * "Map to data event" end to end against a LOCAL Supabase stack (real
 * PostgREST, the real services, the real workflow engine), for BOTH paths:
 *
 * A form with a repeating section (order lines) and an editable Data table
 * grid (parts — rows the person adds) is mapped to three data tables
 * (Orders ← the form, Order lines ← each section item, Order parts ← each
 * added grid row), every child row linked to the parent row's id.
 *
 *  - Write directly: planDataEventRule (the wizard's / MCP's compile) → the
 *    After submit (server_steps) rule and variables saved on the form →
 *    submitForm: once the submission is stored, the parent row is written,
 *    its id kept in the rule's variable, each item / grid row written once
 *    with that id. A submission the SERVER refuses (invalid values, one
 *    response per person) writes nothing; a replay writes nothing again;
 *    the task-form path (runButtonActions) and anonymous visitors (only
 *    steps allowed for them) are covered too.
 *  - Send to a workflow: createDataEventWorkflow (draft, never active) →
 *    published + activated in the test (workflows.activate) → submitForm →
 *    the Form submitted job → runJob (the queue worker) → the same rows.
 *
 * Runs only when EVENT_STREAM_DB_URL is set (any stack with main's
 * migrations), e.g. against the shared QA stack:
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:58322/postgres \
 *   LOCKDOWN_SUPABASE_URL=http://127.0.0.1:58321 LOCKDOWN_SERVICE_ROLE_KEY=… \
 *   npx vitest run __tests__/form-data-event-e2e-db.test.ts
 * Creates and removes its own tenant only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows and rule actions are free-form JSON */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({ ...(await importOriginal<object>()), kickQueueProcessor: vi.fn() }))

import { createDataTable } from '@/lib/services/data-tables'
import { createForm, updateForm, getForm } from '@/lib/services/forms'
import { runButtonActions, submitForm } from '@/lib/services/form-submissions'
import { createDataEventWorkflow, getDataEventOptions, getDataEventStatus, planDataEventRule, planDataEventWorkflow } from '@/lib/services/form-data-event'
import { publishWorkflow, setWorkflowActive } from '@/lib/services/workflows'
import { runJob } from '@/lib/workflow-queue-processor'
import { autoMap, suggestParentLink, type DataEventPlan, type DataEventStep, type DataEventTarget } from '@/lib/forms/data-event'
import { normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import type { ServiceContext } from '@/lib/services/context'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = '0de7a000-0000-4000-8000-0000000000a1'
const OWNER = '0de7a001-0000-4000-8000-000000000001'
const PERMS = [
  'forms.view', 'forms.edit', 'forms.submit', 'data.view', 'data.create', 'data.manage_rows',
  'workflows.view', 'workflows.create', 'workflows.edit', 'workflows.activate', 'integrations.view', 'integrations.test',
]

describe.skipIf(!DB_URL)('Map to data event end to end (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  let admin: SupabaseClient
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  const ctx = (): ServiceContext => ({ supabase: admin as any, tenantId: TENANT, actorId: OWNER, permissions: new Set(PERMS), authKind: 'api_key', source: 'api' })
  const tables: Record<string, string> = {}

  async function cleanup() {
    for (const table of ['form_anonymous_access', 'form_files', 'form_wizard_projects', 'form_table_change_runs', 'workflow_logs', 'workflow_queue', 'workflow_runs', 'form_submissions', 'workflow_versions', 'workflows', 'form_versions', 'forms', 'custom_table_rows', 'custom_tables', 'object_audit_log', 'lifecycle_events', 'event_stream', 'github_sync_queue', 'github_sync_asset_map']) {
      await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [TENANT]).catch(() => undefined)
    }
    await db.query('DELETE FROM public.user_memberships WHERE user_id = $1', [OWNER]).catch(() => undefined)
    const { rows } = await db.query('SELECT DISTINCT tenant_id FROM public.users WHERE id = $1', [OWNER]).catch(() => ({ rows: [] as any[] }))
    await db.query('DELETE FROM public.users WHERE id = $1', [OWNER]).catch(() => undefined)
    await db.query('DELETE FROM auth.users WHERE id = $1', [OWNER]).catch(() => undefined)
    for (const row of rows) if (row.tenant_id !== TENANT) await db.query('DELETE FROM public.tenants WHERE id = $1', [row.tenant_id]).catch(() => undefined)
    await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT]).catch(() => undefined)
  }

  const rowsOf = async (tableId: string) => (await db.query('SELECT id, data FROM public.custom_table_rows WHERE tenant_id = $1 AND table_id = $2 ORDER BY created_at, id', [TENANT, tableId])).rows as Array<{ id: string; data: Record<string, any> }>

  /** The form: a customer, a total, order lines (a repeating section) and parts (an editable Data table people add rows to). */
  const fields = () => normalizeTaskFields([
    { key: 'customer', label: 'Customer', type: 'text', required: true },
    { key: 'total', label: 'Total', type: 'currency', currency: 'USD' },
    { key: 'lines', label: 'Order lines', type: 'repeating_section', repeating_section: { fields: [{ key: 'sku', label: 'SKU', type: 'text', required: true }, { key: 'qty', label: 'Quantity', type: 'number' }] } },
    {
      key: 'parts', label: 'Parts', type: 'data_table',
      data_table: {
        source: 'table', table_id: tables.catalog, mode: 'edit', key_column: 'row_id', allow_add: true,
        columns: [{ key: 'part_no', label: 'Part no', type: 'text', required: true }, { key: 'qty', label: 'Qty', type: 'number' }],
      },
    },
  ] as any) as TaskFieldDef[]
  const layout = () => ({ rows: ['customer', 'total', 'lines', 'parts'].map((k) => ({ columns: 1, cells: [{ field_key: k, span: 1 }] })) })

  /** What the wizard builds: the targets it lists, the parent step first, children auto-mapped and linked to it. */
  async function wizardPlan(destination: 'direct' | 'workflow', formId: string): Promise<DataEventPlan> {
    const options = await getDataEventOptions(ctx(), { form_id: formId })
    const status = await getDataEventStatus(ctx(), formId)
    expect(status.has_data_event).toBe(false)
    expect(status.sources.map((s) => [s.key, s.kind])).toEqual([['', 'form'], ['lines', 'repeating_section'], ['parts', 'grid']])
    const target = (id: string) => options.tables.find((t) => t.id === id) as DataEventTarget
    const field = (key: string) => status.sources.find((s) => s.key === key)!.fields
    const step = (id: string, t: DataEventTarget, source: string): DataEventStep => ({ id, target: { kind: 'table', id: t.id, name: t.name }, source, map: {} })
    const parent = step('step_1', target(tables.orders), '')
    parent.map = autoMap(field(''), target(tables.orders).columns)
    const child = (id: string, t: DataEventTarget, source: string) => {
      const s = step(id, t, source)
      s.map = suggestParentLink(s, parent, options.tables)
      s.map = autoMap(field(source), t.columns, s.map)
      return s
    }
    return { destination, steps: [parent, child('step_2', target(tables.lines), 'lines'), child('step_3', target(tables.parts), 'parts')] }
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'QA map to data event', 'qa-mde-e2e')`, [TENANT])
    await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, 'qa-mde-e2e@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [OWNER])
    await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, [OWNER, TENANT])
    admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const make = async (name: string, columns: any[]) => String((await createDataTable(ctx(), { name, columns }) as any).id)
    tables.catalog = await make('Part catalog', [{ key: 'part_no', name: 'Part no', type: 'text' }, { key: 'qty', name: 'Qty', type: 'number' }])
    tables.orders = await make('Orders', [{ key: 'customer', name: 'Customer', type: 'text', required: true }, { key: 'total', name: 'Total', type: 'number' }])
    tables.lines = await make('Order lines', [{ key: 'parent_row_id', name: 'Parent row', type: 'text' }, { key: 'sku', name: 'SKU', type: 'text' }, { key: 'qty', name: 'Quantity', type: 'number' }])
    tables.parts = await make('Order parts', [{ key: 'parent_row_id', name: 'Parent row', type: 'text' }, { key: 'part_no', name: 'Part no', type: 'text' }, { key: 'qty', name: 'Qty', type: 'number' }])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  const SUBMITTED = {
    customer: 'Contoso', total: '120.50',
    lines: [{ sku: 'A-1', qty: 2 }, { sku: 'B-2', qty: 5 }],
    parts: { added: [{ part_no: 'P-10', qty: 1 }, { part_no: 'P-20', qty: 4 }, { part_no: 'P-30', qty: 3 }], updated: [], deleted: [] },
  }

  function expectLinkedRows(order: { id: string; data: Record<string, any> }, lines: Array<{ data: Record<string, any> }>, parts: Array<{ data: Record<string, any> }>) {
    expect(order.data).toMatchObject({ customer: 'Contoso', total: 120.5 })
    expect(lines.map((r) => [r.data.parent_row_id, r.data.sku, Number(r.data.qty)])).toEqual([[order.id, 'A-1', 2], [order.id, 'B-2', 5]])
    expect(parts.map((r) => [r.data.parent_row_id, r.data.part_no, Number(r.data.qty)])).toEqual([[order.id, 'P-10', 1], [order.id, 'P-20', 4], [order.id, 'P-30', 3]])
  }

  const clearRows = async () => { for (const t of [tables.orders, tables.lines, tables.parts]) await db.query('DELETE FROM public.custom_table_rows WHERE tenant_id = $1 AND table_id = $2', [TENANT, t]) }
  const rowCounts = async () => Promise.all([tables.orders, tables.lines, tables.parts].map(async (t) => (await rowsOf(t)).length))

  /** A form mapped with Write directly (the wizard's plan, compiled by the service, saved on the form). */
  async function directForm(name: string, tweak: (rule: any) => any = (r) => r) {
    const form = await createForm(ctx(), { name, fields: fields(), layout: layout() } as any) as any
    const compiled = await planDataEventRule(ctx(), { form_id: form.id, plan: await wizardPlan('direct', form.id) })
    expect(compiled.problems.filter((p) => p.severity === 'error')).toEqual([])
    const rule = tweak(compiled.rule)
    await updateForm(ctx(), form.id, { layout: { ...layout(), rules: [rule], variables: compiled.variables } } as any)
    return { form, rule, variables: compiled.variables }
  }

  it('Write directly: once the submission is accepted, the parent row, then its id on every section item and added grid row', async () => {
    await clearRows()
    const { form, rule, variables } = await directForm('QA order (direct)')
    expect(rule).toMatchObject({ event: 'after_submit', server_steps: true })
    expect(rule.then.map((a: any) => [a.type, a.each_item ?? null])).toEqual([['table_create', null], ['table_create', 'lines'], ['table_create', 'parts']])
    expect(variables.map((v) => v.name)).toEqual(['order_id'])
    const saved = await getForm(ctx(), form.id) as any
    expect(saved.layout.rules).toEqual([rule])
    expect((await getDataEventStatus(ctx(), form.id)).has_data_event).toBe(true)

    const result = await submitForm(ctx(), form.id, { values: SUBMITTED })
    const [order] = await rowsOf(tables.orders)
    expectLinkedRows(order, await rowsOf(tables.lines), await rowsOf(tables.parts))
    // What ran is recorded on the submission.
    const stored = (await db.query('SELECT result FROM public.form_submissions WHERE id = $1', [result.submission.id])).rows[0]
    expect(stored.result.rule_steps).toEqual([{ rule_id: rule.id, rule_name: rule.name, written: 6 }])
    expect(result.effects.messages.some((m: any) => /could not write/.test(m.text))).toBe(false)
    // A replayed submission (same idempotency key) writes nothing again.
    const key = `qa-mde-replay-${Date.now()}`
    await submitForm(ctx(), form.id, { values: SUBMITTED, idempotency_key: key })
    const afterFirst = await rowCounts()
    await submitForm(ctx(), form.id, { values: SUBMITTED, idempotency_key: key })
    expect(await rowCounts()).toEqual(afterFirst)
  }, 120_000)

  it('Write directly: a submission the SERVER refuses writes no rows (invalid values; one response per person)', async () => {
    await clearRows()
    const { form } = await directForm('QA order (refused)')
    // Server validation refuses it (a required field empty): no rows.
    await expect(submitForm(ctx(), form.id, { values: { ...SUBMITTED, customer: '' } })).rejects.toMatchObject({ status: 400 })
    expect(await rowCounts()).toEqual([0, 0, 0])
    // "One response per person": the first is accepted and writes; the second is refused by the server and writes nothing.
    await db.query(`INSERT INTO public.form_wizard_projects (tenant_id, owner_id, name, status, spec, form_id) VALUES ($1, $2, 'QA one response', 'created', $3, $4)`,
      [TENANT, OWNER, JSON.stringify({ audience: { multiple_responses: false } }), form.id])
    await submitForm(ctx(), form.id, { values: SUBMITTED })
    expect(await rowCounts()).toEqual([1, 2, 3])
    await expect(submitForm(ctx(), form.id, { values: { ...SUBMITTED, customer: 'Second try' } })).rejects.toMatchObject({ status: 403 })
    expect(await rowCounts()).toEqual([1, 2, 3])
    expect((await rowsOf(tables.orders)).map((r) => r.data.customer)).toEqual(['Contoso'])
  }, 120_000)

  it('Write directly: a task form runs the same writes after the task is completed (the task path\'s runButtonActions)', async () => {
    await clearRows()
    const { form, rule } = await directForm('QA order (task)')
    const saved = await getForm(ctx(), form.id) as any
    // As app/actions/task-queue.ts (and the Agent's completion) call it: the values as stored on the task, no submission row.
    const { coerceTaskFieldValues } = await import('@/lib/task-field-schema')
    const stored = { ...coerceTaskFieldValues(fields(), SUBMITTED), parts: SUBMITTED.parts }
    const out = await runButtonActions(ctx(), admin as any, {
      button: { id: 'submit', label: 'Submit', kind: 'submit' } as any, values: stored, form: { id: form.id, name: form.name },
      submissionId: null, taskId: '0de7a000-0000-4000-8000-0000000000f1', fields: fields(), layout: saved.layout,
    })
    expect(out.rule_steps).toEqual([{ rule_id: rule.id, rule_name: rule.name, written: 6 }])
    const [order] = await rowsOf(tables.orders)
    expectLinkedRows(order, await rowsOf(tables.lines), await rowsOf(tables.parts))
    // A form without such rules: nothing runs (existing behaviour).
    const plain = await runButtonActions(ctx(), admin as any, { button: { id: 'submit', label: 'Submit', kind: 'submit' } as any, values: stored, form: { id: form.id, name: form.name }, submissionId: null, taskId: null, fields: fields(), layout: layout() })
    expect(plain.rule_steps).toEqual([])
  }, 120_000)

  it('Write directly on a public (anonymous) form: only steps the author allowed for anonymous visitors run', async () => {
    await clearRows()
    const anon = await import('@/lib/services/anonymous-forms')
    anon.anonymousDeps.serviceClient = async () => admin as any
    const staff = { ...ctx(), permissions: new Set([...PERMS, 'settings.edit', 'settings.view']) }
    await anon.setAnonymousWorkspaceSettings(staff, { enabled: true })
    const submitAnon = async (formId: string) => {
      const access = await anon.setFormAnonymousAccess(staff, formId, { enabled: true, settings: { min_fill_seconds: 0 } })
      return anon.submitAnonymousForm(access.token!, { values: SUBMITTED, ticket: anon.issueTicket(formId, Date.now() - 5_000) }, { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 qa-mde' })
    }
    // Not allowed for anonymous visitors: the submission is stored, nothing is written.
    const closed = await directForm('QA order (public, closed)')
    const r1 = await submitAnon(closed.form.id)
    expect(r1.submission.id).toBeTruthy()
    expect(await rowCounts()).toEqual([0, 0, 0])
    // Allowed (and opened) by the author: written for the visitor.
    const open = await directForm('QA order (public, open)', (r) => ({ ...r, then: r.then.map((a: any) => ({ ...a, allow_anonymous: true, open_access: true })) }))
    const r2 = await submitAnon(open.form.id)
    const [order] = await rowsOf(tables.orders)
    expect((await rowsOf(tables.lines)).map((r) => [r.data.parent_row_id, r.data.sku])).toEqual([[order.id, 'A-1'], [order.id, 'B-2']])
    // The grid is not taken from a visitor (its table has no "Allow anonymous read" — existing anonymous rules), so no parts rows.
    expect(await rowsOf(tables.parts)).toEqual([])
    expect((await db.query('SELECT result FROM public.form_submissions WHERE id = $1', [r2.submission.id])).rows[0].result.rule_steps[0]).toMatchObject({ written: 3 })
  }, 120_000)

  it('Send to a workflow: the draft workflow, once published and activated, writes the same linked rows', async () => {
    await clearRows()
    const form = await createForm(ctx(), { name: 'QA order (workflow)', fields: fields(), layout: layout() } as any) as any
    const plan = await wizardPlan('workflow', form.id)
    const preview = await planDataEventWorkflow(ctx(), { form_id: form.id, plan })
    expect(preview.errors).toEqual([])
    expect(preview.warnings).toEqual([])
    expect(preview.workflow.outline.map((l) => `${'  '.repeat(l.depth)}${l.text}`)).toEqual([
      'When "QA order (workflow)" is submitted',
      'Add a row to Orders (2 columns)',
      'For each item of Order lines',
      '  Add a row to Order lines (3 columns)',
      'For each row added to Parts',
      '  Add a row to Order parts (3 columns)',
      'End',
    ])
    const created = await createDataEventWorkflow(ctx(), { form_id: form.id, plan })
    expect(created.workflow.is_active).toBe(false)
    const draft = (await db.query('SELECT is_active, trigger_type, nodes, edges FROM public.workflows WHERE id = $1', [created.workflow.id])).rows[0]
    expect(draft).toMatchObject({ is_active: false, trigger_type: 'form_submitted' })
    // A draft does not run.
    const before = await submitForm(ctx(), form.id, { values: SUBMITTED })
    expect((await db.query('SELECT count(*)::int AS n FROM public.workflow_queue WHERE tenant_id = $1 AND workflow_id = $2', [TENANT, created.workflow.id])).rows[0].n).toBe(0)
    expect(before.submission.id).toBeTruthy()
    // The form's data event is now the workflow.
    expect((await getDataEventStatus(ctx(), form.id)).events.map((e) => e.kind)).toEqual(['workflow'])

    await publishWorkflow(ctx(), created.workflow.id)
    await setWorkflowActive(ctx(), created.workflow.id, true)
    const result = await submitForm(ctx(), form.id, { values: SUBMITTED })
    const jobs = (await db.query('SELECT * FROM public.workflow_queue WHERE tenant_id = $1 AND workflow_id = $2', [TENANT, created.workflow.id])).rows
    expect(jobs).toHaveLength(1)
    expect(jobs[0].trigger_data.form_submission_id).toBe(result.submission.id)
    await db.query(`UPDATE public.workflow_queue SET status = 'processing', locked_at = now(), locked_by = 'mde-e2e', attempts = attempts + 1 WHERE id = $1`, [jobs[0].id])
    const summary = await runJob(admin, { ...jobs[0], status: 'processing' })
    expect(summary.status).toBe('completed')
    const orders = await rowsOf(tables.orders)
    expect(orders).toHaveLength(1)
    expectLinkedRows(orders[0], await rowsOf(tables.lines), await rowsOf(tables.parts))
  }, 120_000)
})
