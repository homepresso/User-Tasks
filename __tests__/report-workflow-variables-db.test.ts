/**
 * Workflow variables in reports, against a LOCAL Supabase stack: real runs
 * store their reportable variables (workflow_runs.variables, migration
 * 20261129000000) when they pause, complete and fail, and the report service
 * lists, filters, groups and aggregates them through PostgREST.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/report-workflow-variables-db.test.ts
 * The engine and the report service talk to the stack's API
 * (ENGINE_SMOKE_SUPABASE_URL / ENGINE_SMOKE_SERVICE_ROLE_KEY, defaulting to
 * the standard local stack). Rows are committed and deleted after.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'
import { executeWorkflow, resumeWorkflow } from '@/lib/workflow-engine'
import { executeReportPreview } from '@/lib/mcp/tools/reports'
import { resolveTenantReportSource } from '@/lib/report-source-registry'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = '0d5e0000-0000-4000-8000-00000000c0a1'
const WF = '0d5e0000-0000-4000-8000-00000000c0b1'
const WF_FAIL = '0d5e0000-0000-4000-8000-00000000c0b2'
// Run and task sources need their domain permission on top of reports.view (governance audit 2026-11).
const PERMS = ['reports.view', 'workflows.view', 'workflows.view_runs', 'tasks.view_all']

const userVariables = [
  { name: 'amount', type: 'number', defaultValue: '0' },
  { name: 'region', type: 'string', defaultValue: '' },
  { name: 'api_token', type: 'string', defaultValue: '' },
]
const nodes = [
  { id: 'start', type: 'manual', label: 'Start', config: {} },
  {
    id: 'approve', type: 'user_task', label: 'Approve expense',
    config: {
      task_title: 'Approve {{region}}',
      outcomes: ['Approved', 'Rejected'],
      fields: [
        { id: 'f1', key: 'approved_amount', label: 'Approved amount', type: 'number' },
        { id: 'f2', key: 'comment', label: 'Comment', type: 'text' },
      ],
    },
  },
  { id: 'flag', type: 'set_variable', label: 'Flag', config: { name: 'reviewed', expression: 'yes' } },
]
const edges = [
  { id: 'e1', source: 'start', target: 'approve' },
  { id: 'e2', source: 'approve', target: 'flag' },
]
const failNodes = [
  { id: 'start', type: 'manual', label: 'Start', config: {} },
  { id: 'boom', type: 'update_data_table', label: 'Insert row', config: { table_id: '0d5e0000-0000-4000-8000-00000000dead', operation: 'insert', apply_retention_policy: true, retention_policy_id: '0d5e0000-0000-4000-8000-00000000beef' } },
]

async function cleanup(db: Client) {
  for (const table of ['workflow_logs', 'workflow_queue', 'workflow_runs', 'task_reminders', 'task_responses', 'task_assignees', 'lifecycle_events', 'notifications', 'tasks', 'workflow_versions', 'workflows']) {
    await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [TENANT]).catch(() => undefined)
  }
  await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT])
}

describe.skipIf(!DB_URL)('workflow variables in reports (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  let supabase: SupabaseClient
  const runIds: string[] = []
  let failedRunId = ''

  beforeAll(async () => {
    await db.connect()
    await cleanup(db)
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Report vars', 'report-vars-test')`, [TENANT])
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges, user_variables)
       VALUES ($1, $2, 'Expense approval', true, 'manual', $3::jsonb, $4::jsonb, $5::jsonb),
              ($6, $2, 'Always fails', true, 'manual', $7::jsonb, '[{"id":"e1","source":"start","target":"boom"}]'::jsonb, $5::jsonb)`,
      [WF, TENANT, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify(userVariables), WF_FAIL, JSON.stringify(failNodes)],
    )
    supabase = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    const inputs = [
      { amount: 50, region: 'North' },
      { amount: 150, region: 'South' },
      { amount: 300, region: 'North' },
    ]
    for (const input of inputs) {
      const started = await executeWorkflow(WF, undefined, false, { ...input, api_token: 'sk-secret-value' }, undefined, undefined, undefined, { supabase })
      expect(started.status).toBe('waiting_for_event')
      runIds.push(String(started.run_id))
    }
    const failed = await executeWorkflow(WF_FAIL, undefined, false, { amount: 999, region: 'East' }, undefined, undefined, undefined, { supabase })
    expect(failed.status).toBe('failed')
    failedRunId = String(failed.run_id)
  }, 60_000)

  afterAll(async () => {
    await cleanup(db)
    await db.end()
  })

  it('stores the inputs on a paused run, without system or credential-like keys', async () => {
    const { rows: [run] } = await db.query('SELECT status, variables, pause_variables FROM public.workflow_runs WHERE id = $1', [runIds[0]])
    expect(run.status).toBe('waiting_for_event')
    expect(run.variables).toMatchObject({ amount: 50, region: 'North' })
    expect(run.variables).not.toHaveProperty('api_token')
    expect(run.variables).not.toHaveProperty('task_id')
    expect(run.variables).not.toHaveProperty('workflow_started_by')
    expect(run.pause_variables).toHaveProperty('api_token') // the engine's working state is unchanged
  })

  it('stores task form values and step outputs when the run completes', async () => {
    const answers = [
      { approved_amount: 40, comment: 'fine' },
      { approved_amount: 140, comment: 'trimmed' },
      { approved_amount: 280, comment: 'ok' },
    ]
    for (let i = 0; i < runIds.length; i++) {
      const { rows: [run] } = await db.query('SELECT event_id FROM public.workflow_runs WHERE id = $1', [runIds[i]])
      const resumed = await resumeWorkflow(String(run.event_id), { outcome: i === 1 ? 'Rejected' : 'Approved', task_data: answers[i] }, undefined, { supabase })
      expect(resumed.status).toBe('completed')
    }
    const { rows: [run] } = await db.query('SELECT status, variables FROM public.workflow_runs WHERE id = $1', [runIds[2]])
    expect(run.status).toBe('completed')
    expect(run.variables).toMatchObject({
      amount: 300,
      region: 'North',
      outcome: 'Approved',
      reviewed: 'yes',
      task_data: { approved_amount: 280, comment: 'ok' },
    })
  })

  it('stores the variables of a failed run', async () => {
    const { rows: [run] } = await db.query('SELECT status, variables FROM public.workflow_runs WHERE id = $1', [failedRunId])
    expect(run.status).toBe('failed')
    expect(run.variables).toMatchObject({ amount: 999, region: 'East' })
  })

  it('lists the workflow variables as typed columns of Workflow runs', async () => {
    const source = await resolveTenantReportSource(supabase, TENANT, 'workflow_runs', { workflow_id: WF })
    const byKey = Object.fromEntries((source?.columns ?? []).map((column) => [column.key, column]))
    expect(source?.label).toBe('Workflow Runs: Expense approval')
    expect(byKey['vars.amount']).toMatchObject({ type: 'number', label: 'Amount' })
    expect(byKey['vars.region']).toMatchObject({ type: 'text' })
    expect(byKey['vars.task_data.approved_amount']).toMatchObject({ type: 'number', label: 'Approved amount' })
    expect(byKey['vars.reviewed']).toBeDefined()
    expect(byKey['vars.api_token']).toBeUndefined()
    // Another workspace's workflow is not found.
    await expect(resolveTenantReportSource(supabase, '0d5e0000-0000-4000-8000-00000000ffff', 'workflow_runs', { workflow_id: WF })).rejects.toThrow(/Workflow not found/)
  })

  it('returns variable columns, filtered by number on the workflow\'s runs only', async () => {
    const preview = await executeReportPreview(supabase, TENANT, {
      data_source: 'workflow_runs',
      source_inputs: { workflow_id: WF },
      columns: ['id', 'status', 'vars.amount', 'vars.region', 'vars.task_data.approved_amount'],
      filters: [{ field: 'vars.amount', operator: 'gt', value: '100' }],
      sort: { field: 'vars.amount', direction: 'asc' },
      visualization: 'table',
    }, null, PERMS)
    expect(preview.data.map((row: any) => row['vars.amount'])).toEqual([150, 300])
    expect(preview.data.map((row: any) => row['vars.task_data.approved_amount'])).toEqual([140, 280])
    for (const row of preview.data) {
      expect(row).not.toHaveProperty('variables')
      expect(row).not.toHaveProperty('pause_variables')
    }
  })

  it('filters on text in the database and groups / sums by variables', async () => {
    const north = await executeReportPreview(supabase, TENANT, {
      data_source: 'workflow_runs',
      source_inputs: { workflow_id: WF },
      columns: ['vars.amount'],
      filters: [{ field: 'vars.region', operator: 'eq', value: 'North' }],
      visualization: 'table',
    }, null, PERMS)
    expect(north.data.map((row: any) => row['vars.amount']).sort((a: number, b: number) => a - b)).toEqual([50, 300])

    const grouped = await executeReportPreview(supabase, TENANT, {
      data_source: 'workflow_runs',
      source_inputs: { workflow_id: WF },
      columns: ['vars.region', 'SUM_vars.amount', 'AVG_vars.task_data.approved_amount'],
      group_by: ['vars.region'],
      aggregations: [{ field: 'vars.amount', fn: 'SUM' }, { field: 'vars.task_data.approved_amount', fn: 'AVG' }],
      visualization: 'bar',
    }, null, PERMS)
    const byRegion = Object.fromEntries(grouped.data.map((row: any) => [row['vars.region'], row]))
    expect(byRegion.North['SUM_vars.amount']).toBe(350)
    expect(byRegion.North['AVG_vars.task_data.approved_amount']).toBe(160)
    expect(byRegion.South['SUM_vars.amount']).toBe(150)
    expect(byRegion.East).toBeUndefined() // the failing workflow's run is another workflow's
  })

  it('reads variables across workflows without a workflow picked, and needs workflows.view', async () => {
    const all = await executeReportPreview(supabase, TENANT, {
      data_source: 'workflow_runs',
      columns: ['workflow.name', 'vars.region'],
      filters: [{ field: 'vars.region', operator: 'eq', value: 'East' }],
      visualization: 'table',
    }, null, PERMS)
    expect(all.data).toHaveLength(1)
    expect(all.data[0]['vars.region']).toBe('East')

    await expect(executeReportPreview(supabase, TENANT, {
      data_source: 'workflow_runs',
      source_inputs: { workflow_id: WF },
      columns: ['vars.amount'],
      visualization: 'table',
    }, null, ['reports.view', 'workflows.view_runs'])).rejects.toThrow(/workflows\.view'/)
  })

  it('lists and reads the form fields of the tasks a workflow created', async () => {
    const { rows: [task] } = await db.query('SELECT id FROM public.tasks WHERE tenant_id = $1 ORDER BY created_at LIMIT 1', [TENANT])
    await db.query(
      `UPDATE public.tasks SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{template_values}', '{"approved_amount": 75, "comment": "set"}'::jsonb) WHERE id = $1`,
      [task.id],
    )
    const source = await resolveTenantReportSource(supabase, TENANT, 'tasks', { workflow_id: WF })
    expect(source?.columns.find((column) => column.key === 'fields.approved_amount')).toMatchObject({ type: 'number' })
    const preview = await executeReportPreview(supabase, TENANT, {
      data_source: 'tasks',
      source_inputs: { workflow_id: WF },
      columns: ['title', 'fields.approved_amount', 'fields.comment'],
      filters: [{ field: 'fields.comment', operator: 'eq', value: 'set' }],
      visualization: 'table',
    }, null, PERMS)
    expect(preview.data).toHaveLength(1)
    expect(preview.data[0]).toMatchObject({ 'fields.approved_amount': 75, 'fields.comment': 'set' })
    expect(preview.data[0]).not.toHaveProperty('template_values')
  })
})
