/**
 * "Publish as form page" against a LOCAL Supabase stack (lib/services/form-pages):
 *  - publish creates the reusable form (fields, grid, theme copied; Submit →
 *    Start workflow with every field mapped to its input → success screen)
 *    and never changes the workflow (its nodes, inputs and API starts);
 *  - submitting /f/<id> as a member queues a run of the workflow with the
 *    typed inputs, attributed to the submitter, and the success screen
 *    carries the run reference;
 *  - sync: a start form change → "start_form_changed" → one-click update (a
 *    new form version); edits on the form → "form_edited", and a sync is
 *    refused (409) unless it overwrites; the published version decides;
 *  - permissions: forms.edit + workflows.activate to publish / sync,
 *    forms.delete to unpublish;
 *  - export with dependencies → apply into another workspace: the page
 *    comes along, its workflow id remapped, still linked and in sync;
 *  - unpublish deletes the form, refused while a workflow step uses it.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/form-pages-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({ ...(await importOriginal<object>()), kickQueueProcessor: vi.fn() }))

import * as pages from '@/lib/services/form-pages'
import * as forms from '@/lib/services/forms'
import { submitForm } from '@/lib/services/form-submissions'
import { startWorkflow } from '@/lib/services/workflow-start'
import { getWorkflowFormEntries } from '@/lib/services/workflow-start-form'
import { applyConfig, exportConfig } from '@/lib/services/config'
import { runJob } from '@/lib/workflow-queue-processor'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import { FORM_PAGE_SUCCESS_TITLE } from '@/lib/forms/form-page'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `0f9a0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa)
const B = id(0xb)
// Distinct first 8 characters: each auth user gets a personal workspace slug from them.
const OWNER = '0f9a0001-0000-4000-8000-000000000001'
const ALICE = '0f9a0002-0000-4000-8000-000000000002'
const USERS = [OWNER, ALICE]
const WF = id(0x101)
const OTHER_WF = id(0x102)

const VARIABLES = [
  { id: 'v1', name: 'claim_reference', type: 'string', label: 'Claim reference', required: true },
  { id: 'v2', name: 'expected_amount', type: 'number', label: 'Expected amount' },
  { id: 'v3', name: 'submitted_on', type: 'string', label: 'Submitted on', format: 'date' },
  { id: 'v4', name: 'urgent', type: 'boolean', label: 'Urgent' },
]
const START_FORM = { layout: { rows: [{ columns: 2, cells: [{ field_key: 'claim_reference', span: 1 }, { field_key: 'expected_amount', span: 1 }] }, { columns: 2, cells: [{ field_key: 'submitted_on', span: 1 }, { field_key: 'urgent', span: 1 }] }] }, theme: { source: 'custom', overrides: { radius: 6 } } }
const NODES = [
  { id: 'trigger', type: 'webhook_received', label: 'Start', position: { x: 0, y: 0 }, config: { start_form: START_FORM } },
  { id: 'who', type: 'set_variable', label: 'Who', position: { x: 0, y: 100 }, config: { name: 'who', expression: '{{workflow_started_by}}|{{workflow_started_via}}|{{claim_reference}}' } },
]
const EDGES = [{ id: 'e1', source: 'trigger', target: 'who' }]

describe.skipIf(!DB_URL)('Publish as form page (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  let admin: SupabaseClient
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  const ALL = ['workflows.view', 'workflows.activate', 'forms.view', 'forms.edit', 'forms.delete', 'forms.submit']
  const ctx = (tenantId: string, actorId: string | null = OWNER, permissions: string[] | null = ALL): ServiceContext => ({ supabase: admin as any, tenantId, actorId, permissions: permissions ? new Set(permissions) : null, authKind: 'api_key', source: 'api' })
  const one = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0]
  let formId = ''

  async function cleanup() {
    for (const t of [A, B]) {
      for (const table of ['workflow_logs', 'workflow_queue', 'workflow_runs', 'form_submissions', 'workflow_versions', 'workflows', 'form_versions', 'forms', 'form_themes', 'object_audit_log', 'github_sync_asset_map', 'github_sync_queue', 'deletion_queue', 'lifecycle_events', 'event_stream']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
    }
    await db.query('DELETE FROM public.user_memberships WHERE user_id = ANY($1::uuid[])', [USERS]).catch(() => undefined)
    const { rows } = await db.query('SELECT DISTINCT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS]).catch(() => ({ rows: [] as any[] }))
    await db.query('DELETE FROM public.users WHERE id = ANY($1::uuid[])', [USERS]).catch(() => undefined)
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS]).catch(() => undefined)
    for (const row of rows) if (row.tenant_id !== A && row.tenant_id !== B) await db.query('DELETE FROM public.tenants WHERE id = $1', [row.tenant_id]).catch(() => undefined)
    for (const t of [A, B]) await db.query('DELETE FROM public.tenants WHERE id = $1', [t]).catch(() => undefined)
  }

  const workflowRow = () => one('SELECT nodes, user_variables, trigger_type, trigger_config, is_active, has_unpublished_changes FROM public.workflows WHERE id = $1', [WF])

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Form pages A', 'form-pages-a-test'), ($2, 'Form pages B', 'form-pages-b-test')`, [A, B])
    for (const [i, user] of USERS.entries()) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [user, `form-pages-${i}@test.local`])
      await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [user, A])
    }
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, description, is_active, trigger_type, trigger_config, nodes, edges, user_variables, created_by)
       VALUES ($1, $2, 'Expense claim', 'Claim an expense', true, 'webhook_received', '{}', $3::jsonb, $4::jsonb, $5::jsonb, $6)`,
      [WF, A, JSON.stringify(NODES), JSON.stringify(EDGES), JSON.stringify(VARIABLES), OWNER],
    )
    admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  it('needs forms.edit and workflows.activate to publish', async () => {
    await expect(pages.publishStartFormPage(ctx(A, OWNER, ['workflows.view', 'forms.view', 'forms.edit']), WF)).rejects.toMatchObject({ status: 403 })
    await expect(pages.publishStartFormPage(ctx(A, OWNER, ['workflows.view', 'forms.view', 'workflows.activate']), WF)).rejects.toMatchObject({ status: 403 })
    await expect(pages.publishStartFormPage(ctx(B), WF)).rejects.toMatchObject({ status: 404 })
    expect((await db.query('SELECT 1 FROM public.forms WHERE tenant_id = $1', [A])).rowCount).toBe(0)
  })

  it('publishes the start form as a reusable form and leaves the workflow as it was', async () => {
    const before = await workflowRow()
    const info = await pages.getStartFormPage(ctx(A), WF)
    expect(info).toMatchObject({ eligible: true, workflow_active: true, page: null, skipped: [] })

    const published = await pages.publishStartFormPage(ctx(A), WF)
    formId = published.form_id
    expect(published).toMatchObject({ form_name: 'Expense claim — start form', path: `/f/${formId}` })
    expect(await workflowRow()).toEqual(before)

    const form = await one('SELECT name, fields, layout, theme, header, buttons, version FROM public.forms WHERE id = $1 AND tenant_id = $2', [formId, A])
    expect(form.fields.map((f: any) => [f.key, f.type])).toEqual([['claim_reference', 'text'], ['expected_amount', 'number'], ['submitted_on', 'date'], ['urgent', 'boolean']])
    expect(form.fields[0].required).toBe(true)
    expect(form.layout.rows.map((r: any) => r.cells.map((c: any) => c.field_key))).toEqual([['claim_reference', 'expected_amount'], ['submitted_on', 'urgent']])
    expect(form.theme).toEqual({ source: 'custom', overrides: { radius: 6 } })
    expect(form.header).toMatchObject({ enabled: true, title: 'Expense claim', subtitle: 'Claim an expense' })
    const submit = normalizeFormButtons(form.buttons).find((b) => b.kind === 'submit')!
    expect(submit.actions![0]).toMatchObject({
      type: 'start_workflow', workflow_id: WF,
      inputs: { claim_reference: '{{claim_reference}}', expected_amount: '{{expected_amount}}', submitted_on: '{{submitted_on}}', urgent: '{{urgent}}' },
    })
    expect(submit.actions![0].start_form_page?.key).toMatch(/^[0-9a-f]{16}$/)
    expect(submit.actions![1]).toMatchObject({ type: 'success_screen', title: FORM_PAGE_SUCCESS_TITLE })

    const entries = await getWorkflowFormEntries(ctx(A), WF)
    expect(entries.start_form_page.page).toMatchObject({ form_id: formId, status: 'in_sync', version: 1 })
    // The page is listed as the start form's page, not again as "started by a form button".
    expect(entries.buttons).toEqual([])
    expect((await forms.listForms(ctx(A), {}, { limit: 50, offset: 0 })).forms.find((f) => f.id === formId)?.form_page_of).toEqual({ workflow_id: WF, workflow_name: 'Expense claim' })
    // Once only.
    await expect(pages.publishStartFormPage(ctx(A), WF)).rejects.toMatchObject({ status: 409 })
  })

  it('a submission starts the workflow with the typed inputs, as the submitter, and shows the run reference', async () => {
    const member = ctx(A, ALICE, ['forms.submit'])
    const result = await submitForm(member, formId, { values: { claim_reference: 'EXP-7', expected_amount: '42.5', submitted_on: '2026-10-28', urgent: true } })
    expect(result.runs).toHaveLength(1)
    const run = result.runs[0]
    expect(run).toMatchObject({ workflow_id: WF, status: 'queued' })
    expect(result.effects.success_screen).toEqual(expect.objectContaining({ title: FORM_PAGE_SUCCESS_TITLE, text: `Your reference: ${run.job_id!.slice(0, 8)}` }))

    const job = await one('SELECT * FROM public.workflow_queue WHERE id = $1 AND tenant_id = $2', [run.job_id, A])
    expect(job.trigger_data).toMatchObject({ claim_reference: 'EXP-7', expected_amount: 42.5, submitted_on: '2026-10-28', urgent: true, form_id: formId, form_submission_id: result.submission.id })
    expect(typeof job.trigger_data.expected_amount).toBe('number')
    expect(typeof job.trigger_data.urgent).toBe('boolean')

    await db.query(`UPDATE public.workflow_queue SET status = 'processing', locked_at = now(), locked_by = 'form-pages-test', attempts = attempts + 1 WHERE id = $1`, [job.id])
    const summary = await runJob(admin, { ...job, status: 'processing' })
    expect(summary.status).toBe('completed')
    const done = await one('SELECT result FROM public.workflow_queue WHERE id = $1', [job.id])
    const runRow = await one('SELECT node_results FROM public.workflow_runs WHERE id = $1', [done.result.run_id])
    expect(runRow.node_results.who.output.value).toBe(`${ALICE}|form|EXP-7`)
  }, 60_000)

  it('API starts with inputs keep working', async () => {
    const started = await startWorkflow(ctx(A), { workflow_id: WF, variables: { claim_reference: 'API-1', expected_amount: 3 }, async: true })
    expect(started.mode).toBe('async')
    await db.query(`UPDATE public.workflow_queue SET status = 'cancelled' WHERE tenant_id = $1 AND status = 'pending'`, [A])
  })

  it('detects a start form change and updates the page in one click (a new version)', async () => {
    await db.query('UPDATE public.workflows SET user_variables = $2::jsonb WHERE id = $1', [WF, JSON.stringify([...VARIABLES, { id: 'v5', name: 'notes', type: 'string', label: 'Notes' }])])
    expect((await pages.getStartFormPage(ctx(A), WF)).page).toMatchObject({ status: 'start_form_changed', version: 1 })
    await expect(pages.syncStartFormPage(ctx(A, OWNER, ['workflows.view', 'forms.view', 'forms.edit']), WF)).rejects.toMatchObject({ status: 403 })
    const synced = await pages.syncStartFormPage(ctx(A), WF)
    expect(synced).toMatchObject({ version: 2, version_changed: true, status: 'in_sync' })
    const form = await one('SELECT fields, buttons FROM public.forms WHERE id = $1', [formId])
    expect(form.fields.map((f: any) => f.key)).toContain('notes')
    expect(normalizeFormButtons(form.buttons)[0].actions![0].inputs).toMatchObject({ notes: '{{notes}}' })
    expect((await pages.getStartFormPage(ctx(A), WF)).page).toMatchObject({ status: 'in_sync', version: 2 })
    expect((await db.query('SELECT version FROM public.form_versions WHERE form_id = $1 ORDER BY version', [formId])).rows.map((r) => r.version)).toEqual([1, 2])
  })

  it('never overwrites edits made on the form without asking; the owner\'s header and labels survive a sync', async () => {
    const current = await forms.getForm(ctx(A), formId)
    const fields = (current.fields as any[]).map((f) => (f.key === 'claim_reference' ? { ...f, label: 'Your claim number' } : f))
    const buttons = normalizeFormButtons(current.buttons).map((b) => (b.kind === 'submit' ? { ...b, label: 'Send claim' } : b))
    await forms.updateForm(ctx(A), formId, { fields, buttons, header: { ...(current.header as any), title: 'Claims desk' } })
    expect((await pages.getStartFormPage(ctx(A), WF)).page).toMatchObject({ status: 'form_edited', version: 3 })
    await expect(pages.syncStartFormPage(ctx(A), WF)).rejects.toMatchObject({ status: 409 })
    expect((await one('SELECT version FROM public.forms WHERE id = $1', [formId])).version).toBe(3)

    const overwritten = await pages.syncStartFormPage(ctx(A), WF, { overwrite: true })
    expect(overwritten).toMatchObject({ version: 4, status: 'in_sync' })
    const form = await one('SELECT fields, buttons, header FROM public.forms WHERE id = $1', [formId])
    expect(form.fields[0].label).toBe('Claim reference')
    expect(form.header.title).toBe('Claims desk')
    expect(normalizeFormButtons(form.buttons).find((b) => b.kind === 'submit')?.label).toBe('Send claim')
  })

  it('follows the published version: draft edits do not flag the page until published', async () => {
    const { rows: [version] } = await db.query(
      `INSERT INTO public.workflow_versions (workflow_id, tenant_id, version_number, nodes, edges, user_variables, trigger_type, trigger_config, is_active)
       SELECT id, tenant_id, 1, nodes, edges, user_variables, trigger_type, trigger_config, true FROM public.workflows WHERE id = $1 RETURNING id`, [WF])
    await db.query('UPDATE public.workflows SET published_version_id = $2, user_variables = $3::jsonb WHERE id = $1', [WF, version.id, JSON.stringify(VARIABLES)])
    // The published version has `notes` (the page has it too); the draft dropped it.
    expect((await pages.getStartFormPage(ctx(A), WF)).page?.status).toBe('in_sync')
    await db.query('UPDATE public.workflows SET user_variables = (SELECT user_variables FROM public.workflow_versions WHERE id = $2) WHERE id = $1', [WF, version.id])
  })

  it('travels with the workflow: export with dependencies → apply into another workspace, still linked', async () => {
    const exported = await exportConfig(ctx(A, OWNER, null), { ids: [WF], with_dependencies: true, format: 'manifest' })
    const manifest = exported.manifest!
    expect(manifest.forms.map((f: any) => f.id)).toEqual([formId])
    const applied = await applyConfig(ctx(B, null, null), { manifest })
    expect(applied.result?.errors ?? []).toEqual([])
    const localWf = applied.id_map!.workflow[WF]
    const localForm = applied.id_map!.form[formId]
    expect(localWf).toBeTruthy()
    expect(localForm).toBeTruthy()
    const row = await one('SELECT buttons FROM public.forms WHERE id = $1 AND tenant_id = $2', [localForm, B])
    expect(normalizeFormButtons(row.buttons)[0].actions![0]).toMatchObject({ type: 'start_workflow', workflow_id: localWf })
    expect((await pages.getStartFormPage(ctx(B, null, null), localWf)).page).toMatchObject({ form_id: localForm, status: 'in_sync' })
  }, 60_000)

  it('unpublish deletes the form (refused while a step uses it), with forms.delete', async () => {
    await expect(pages.unpublishStartFormPage(ctx(A, OWNER, ['workflows.view', 'forms.view', 'forms.edit']), WF)).rejects.toMatchObject({ status: 403 })
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, trigger_type, trigger_config, nodes, edges, is_active) VALUES ($1, $2, 'Uses the page', 'manual', '{}', $3::jsonb, '[]', false)`,
      [OTHER_WF, A, JSON.stringify([{ id: 'task', type: 'user_task', label: 'Task', position: { x: 0, y: 0 }, config: { form_id: formId, fields: [] } }])],
    )
    await expect(pages.unpublishStartFormPage(ctx(A), WF)).rejects.toMatchObject({ status: 409 })
    await db.query('DELETE FROM public.workflows WHERE id = $1', [OTHER_WF])

    const before = await workflowRow()
    expect(await pages.unpublishStartFormPage(ctx(A), WF)).toEqual({ deleted: true, form_id: formId })
    expect((await db.query('SELECT 1 FROM public.forms WHERE id = $1', [formId])).rowCount).toBe(0)
    expect(await workflowRow()).toEqual(before)
    expect((await pages.getStartFormPage(ctx(A), WF))).toMatchObject({ eligible: true, page: null })
    // Its submissions go with it.
    expect((await db.query('SELECT 1 FROM public.form_submissions WHERE form_id = $1', [formId])).rowCount).toBe(0)
  })

  it('a form-triggered workflow or one without inputs gets no page', async () => {
    await db.query('UPDATE public.workflows SET user_variables = $2::jsonb, published_version_id = NULL WHERE id = $1', [WF, JSON.stringify([{ name: 'payload', type: 'object' }])])
    expect(await pages.getStartFormPage(ctx(A), WF)).toMatchObject({ eligible: false, page: null })
    await expect(pages.publishStartFormPage(ctx(A), WF)).rejects.toMatchObject({ status: 400 })
  })
})
