/**
 * SQL-level verification of the event_stream triggers
 * (supabase/migrations/20261024000000_event_stream.sql).
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/event-stream-db.test.ts
 * Every test runs inside a transaction that is rolled back, so the database
 * is left untouched.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL

const TENANT = '0e000000-0000-4000-8000-000000000001'
const USER = '0e000000-0000-4000-8000-000000000002'
const WORKFLOW = '0e000000-0000-4000-8000-000000000003'
const TASK = '0e000000-0000-4000-8000-000000000004'
const POLICY = '0e000000-0000-4000-8000-000000000005'
const TRACE = '0e000000-0000-4000-8000-000000000006'

/** Planted in every sensitive source column; must never reach event_stream. */
const SECRET = 'SENTINEL_SECRET_d41d8cd9'

type EventRow = {
  id: string
  tenant_id: string
  type: string
  category: string
  severity: string
  message: string
  source_table: string
  source_id: string | null
  trace_id: string | null
  run_id: string | null
  workflow_id: string | null
  task_id: string | null
  actor_id: string | null
  attributes: Record<string, unknown>
}

const FORBIDDEN_KEYS = new Set([
  'request_body', 'response_body', 'request_headers', 'response_headers', 'headers', 'body',
  'input_message', 'output_response', 'tool_calls', 'context', 'outputs', 'paused_context', 'usage',
  'payload', 'diff', 'metadata', 'details', 'trigger_data', 'result', 'node_results', 'pause_variables',
  'execution_trace', 'progress', 'scope', 'url', 'target_url', 'token', 'secret', 'password', 'authorization',
])

function forbiddenKeysIn(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenKeysIn(v, `${path}[${i}]`))
  return Object.entries(value).flatMap(([k, v]) => [
    ...(FORBIDDEN_KEYS.has(k) ? [`${path}.${k}`] : []),
    ...forbiddenKeysIn(v, `${path}.${k}`),
  ])
}

describe.skipIf(!DB_URL)('event_stream triggers (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  const warnings: string[] = []

  beforeAll(async () => {
    await db.connect()
    db.on('notice', (n) => { if (n.severity === 'WARNING') warnings.push(n.message ?? '') })
  })
  afterAll(async () => { await db.end() })

  beforeEach(async () => {
    warnings.length = 0
    await db.query('BEGIN')
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Event Stream Test', 'event-stream-test')`, [TENANT])
    await db.query(
      `INSERT INTO auth.users (id, email, instance_id, aud, role)
       VALUES ($1, 'event-stream@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
      [USER],
    )
    await db.query(`INSERT INTO public.workflows (id, tenant_id, name) VALUES ($1, $2, 'Onboarding')`, [WORKFLOW, TENANT])
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title) VALUES ($1, $2, 'Review contract')`, [TASK, TENANT])
    await db.query(`DELETE FROM public.event_stream WHERE tenant_id = $1`, [TENANT])
  })
  afterEach(async () => { await db.query('ROLLBACK') })

  async function events(sourceTable?: string): Promise<EventRow[]> {
    const { rows } = await db.query(
      `SELECT * FROM public.event_stream WHERE tenant_id = $1 ${sourceTable ? 'AND source_table = $2' : ''} ORDER BY id`,
      sourceTable ? [TENANT, sourceTable] : [TENANT],
    )
    return rows as EventRow[]
  }

  function expectClean(rows: EventRow[]) {
    for (const row of rows) {
      expect(forbiddenKeysIn(row.attributes), `${row.type} attributes`).toEqual([])
      expect(JSON.stringify(row)).not.toContain(SECRET)
      expect(row.message.length).toBeGreaterThan(0)
    }
  }

  async function insertRun(extra: Record<string, unknown> = {}): Promise<string> {
    const cols = { workflow_id: WORKFLOW, tenant_id: TENANT, task_id: TASK, title: 'Onboard Ada', trace_id: TRACE,
      node_results: { secret: SECRET }, pause_variables: { password: SECRET }, ...extra }
    const keys = Object.keys(cols)
    const { rows } = await db.query(
      `INSERT INTO public.workflow_runs (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(cols).map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v)),
    )
    return rows[0].id
  }

  it('workflow_runs: emits start/terminal transitions and SLA events, nothing for non-status updates', async () => {
    const runId = await insertRun()
    let rows = await events('workflow_runs')
    expect(rows.map((r) => r.type)).toEqual(['workflow.run.started'])
    expect(rows[0]).toMatchObject({ category: 'workflow', severity: 'info', run_id: runId, workflow_id: WORKFLOW, task_id: TASK, trace_id: TRACE })
    expect(rows[0].message).toBe('Onboard Ada started')
    expect(rows[0].attributes.workflow_name).toBe('Onboarding')

    // Untitled runs fall back to the workflow name.
    await insertRun({ title: null })
    expect((await events('workflow_runs')).at(-1)?.message).toBe('Onboarding started')
    await db.query(`DELETE FROM public.event_stream WHERE tenant_id = $1 AND id > $2`, [TENANT, rows[0].id])

    // Non-status updates (node results, title, same status) emit nothing.
    await db.query(`UPDATE public.workflow_runs SET node_results = '{"a":1}', title = 'Renamed', status = 'running' WHERE id = $1`, [runId])
    expect(await events('workflow_runs')).toHaveLength(1)

    await db.query(`UPDATE public.workflow_runs SET sla_status = 'warning' WHERE id = $1`, [runId])
    await db.query(`UPDATE public.workflow_runs SET sla_status = 'breached', sla_label = 'Same day' WHERE id = $1`, [runId])
    await db.query(`UPDATE public.workflow_runs SET status = 'paused' WHERE id = $1`, [runId])
    await db.query(`UPDATE public.workflow_runs SET status = 'running' WHERE id = $1`, [runId])
    await db.query(
      `UPDATE public.workflow_runs SET status = 'completed', completed_at = started_at + interval '1500 ms' WHERE id = $1`,
      [runId],
    )
    rows = await events('workflow_runs')
    expect(rows.map((r) => [r.type, r.severity])).toEqual([
      ['workflow.run.started', 'info'],
      ['workflow.run.sla_warning', 'warn'],
      ['workflow.run.sla_breached', 'error'],
      ['workflow.run.paused', 'info'],
      ['workflow.run.resumed', 'info'],
      ['workflow.run.completed', 'info'],
    ])
    expect(rows[2].message).toBe('Renamed breached its SLA (Same day)')
    expect(rows[5].attributes).toMatchObject({ status: 'completed', previous_status: 'running', duration_ms: 1500 })
    expectClean(rows)
  })

  it('workflow_runs: failed and manually cancelled runs', async () => {
    const failed = await insertRun()
    await db.query(`UPDATE public.workflow_runs SET status = 'failed', error = 'HTTP 500 from CRM', completed_at = now() WHERE id = $1`, [failed])
    const cancelled = await insertRun()
    await db.query(`UPDATE public.workflow_runs SET status = 'failed', error = 'Manually cancelled', completed_at = now() WHERE id = $1`, [cancelled])
    const rows = (await events('workflow_runs')).filter((r) => !r.type.endsWith('started'))
    expect(rows.map((r) => [r.type, r.severity])).toEqual([['workflow.run.failed', 'error'], ['workflow.run.cancelled', 'warn']])
    expect(rows[0].message).toBe('Onboard Ada failed: HTTP 500 from CRM')
    expect(rows[0].attributes.error).toBe('HTTP 500 from CRM')
  })

  it('workflow_logs: one event per row from a batch insert, severity from level, no metadata', async () => {
    const runId = await insertRun()
    await db.query(
      `INSERT INTO public.workflow_logs (run_id, workflow_id, tenant_id, node_id, node_type, node_label, level, message, metadata, duration_ms)
       VALUES ($1, $2, $3, 'n1', 'http_request', 'Call CRM', 'info', 'Request sent', $4, 12),
              ($1, $2, $3, 'n2', 'condition', NULL, 'warn', 'Branch fell through', $4, NULL),
              ($1, $2, $3, 'n3', 'email', 'Notify', 'error', 'SMTP refused', $4, 3)`,
      [runId, WORKFLOW, TENANT, JSON.stringify({ body: SECRET })],
    )
    const rows = await events('workflow_logs')
    expect(rows.map((r) => [r.type, r.severity, r.message])).toEqual([
      ['workflow.step.log', 'info', 'Call CRM: Request sent'],
      ['workflow.step.log', 'warn', 'Branch fell through'],
      ['workflow.step.log', 'error', 'Notify: SMTP refused'],
    ])
    expect(rows[0]).toMatchObject({ run_id: runId, workflow_id: WORKFLOW, category: 'workflow' })
    expect(rows[0].attributes).toEqual({ node_id: 'n1', node_type: 'http_request', node_label: 'Call CRM', level: 'info', duration_ms: 12 })
    expectClean(rows)
  })

  it('workflow_logs: tenant setting include_step_logs=false suppresses step events', async () => {
    await db.query(`UPDATE public.tenants SET settings = '{"event_stream":{"include_step_logs":false}}' WHERE id = $1`, [TENANT])
    await db.query(
      `INSERT INTO public.workflow_logs (workflow_id, tenant_id, level, message) VALUES ($1, $2, 'info', 'hidden')`,
      [WORKFLOW, TENANT],
    )
    expect(await events('workflow_logs')).toHaveLength(0)
  })

  it('workflow_queue: only failed/dead transitions emit', async () => {
    const { rows: [job] } = await db.query(
      `INSERT INTO public.workflow_queue (workflow_id, tenant_id, task_id, trigger_type, trigger_data, trace_id)
       VALUES ($1, $2, $3, 'task_created', $4, $5) RETURNING id`,
      [WORKFLOW, TENANT, TASK, JSON.stringify({ token: SECRET }), TRACE],
    )
    await db.query(`UPDATE public.workflow_queue SET status = 'processing', attempts = 1 WHERE id = $1`, [job.id])
    await db.query(`UPDATE public.workflow_queue SET locked_by = 'w2' WHERE id = $1`, [job.id])
    expect(await events('workflow_queue')).toHaveLength(0)
    await db.query(`UPDATE public.workflow_queue SET status = 'failed', error = 'timeout', next_retry_at = now() WHERE id = $1`, [job.id])
    await db.query(`UPDATE public.workflow_queue SET attempts = 3 WHERE id = $1`, [job.id])
    await db.query(`UPDATE public.workflow_queue SET status = 'dead' WHERE id = $1`, [job.id])
    const rows = await events('workflow_queue')
    expect(rows.map((r) => [r.type, r.severity])).toEqual([['workflow.queue.failed', 'warn'], ['workflow.queue.dead', 'error']])
    expect(rows[0]).toMatchObject({ workflow_id: WORKFLOW, task_id: TASK, trace_id: TRACE })
    expectClean(rows)
  })

  it('dead_letter_events: host only, no payload or URL path', async () => {
    await db.query(
      `INSERT INTO public.dead_letter_events (tenant_id, task_id, event_type, payload, target_url, error_message, attempts)
       VALUES ($1, $2, 'task.completed', $3, $4, 'HTTP 410', 5)`,
      [TENANT, TASK, JSON.stringify({ secret: SECRET }), `https://hooks.example.com/services/T0/B0/${SECRET}?sig=${SECRET}`],
    )
    const rows = await events('dead_letter_events')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'integration.webhook.dead_letter', category: 'integration', severity: 'error', task_id: TASK })
    expect(rows[0].attributes).toEqual({ event_type: 'task.completed', host: 'hooks.example.com', attempts: 5, error: 'HTTP 410' })
    expectClean(rows)
  })

  it('integration_call_logs: method/host/path/status only, no headers or bodies', async () => {
    const runId = await insertRun()
    await db.query(
      `INSERT INTO public.integration_call_logs (tenant_id, caller_type, caller_id, caller_node_id, trace_id, method, url,
         request_headers, request_body, response_status, response_headers, response_body, duration_ms)
       VALUES ($1, 'workflow_node', $2, 'n1', $3, 'post', $4, $5, $5, 502, $5, $5, 87)`,
      [TENANT, runId, TRACE,
        `https://user:${SECRET}@api.example.com/v1/customers/0e000000-0000-4000-8000-0000000000aa/hooks/abcdefghijklmnopqrstuvwxyz0123?api_key=${SECRET}`,
        JSON.stringify({ authorization: SECRET })],
    )
    const rows = await events('integration_call_logs')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'integration.call', severity: 'error', trace_id: TRACE, run_id: runId })
    expect(rows[0].attributes).toMatchObject({
      method: 'POST', host: 'api.example.com',
      path: '/v1/customers/0e000000-0000-4000-8000-0000000000aa/hooks/:redacted',
      status: 502, duration_ms: 87, caller_type: 'workflow_node', caller_node_id: 'n1',
    })
    expect(rows[0].message).toBe('POST api.example.com/v1/customers/0e000000-0000-4000-8000-0000000000aa/hooks/:redacted → 502 in 87ms')
    expectClean(rows)
  })

  it('agent_runs: status transitions only, never prompts/outputs/tool payloads', async () => {
    const { rows: [run] } = await db.query(
      `INSERT INTO public.agent_runs (tenant_id, input_message, context, tool_calls, outputs, model, actor_id, trace_id, caller_type)
       VALUES ($1, $2, $3, $3, $3, 'claude-test', $4, $5, 'manual_test') RETURNING id`,
      [TENANT, SECRET, JSON.stringify([{ input: SECRET }]), USER, TRACE],
    )
    await db.query(`UPDATE public.agent_runs SET iterations = 2, total_tokens = 10 WHERE id = $1`, [run.id])
    expect(await events('agent_runs')).toHaveLength(1)
    await db.query(
      `UPDATE public.agent_runs SET status = 'completed', output_response = $2, total_tokens = 1200, input_tokens = 1000,
         output_tokens = 200, duration_ms = 4200, completed_at = now() WHERE id = $1`,
      [run.id, SECRET],
    )
    const rows = await events('agent_runs')
    expect(rows.map((r) => [r.type, r.category])).toEqual([['agent.run.running', 'agent'], ['agent.run.completed', 'agent']])
    expect(rows[1].message).toBe('Agent run completed using claude-test (1200 tokens, 4200ms)')
    expect(rows[1]).toMatchObject({ actor_id: USER, trace_id: TRACE })
    expectClean(rows)
  })

  it('object_audit_log: changed field names only; OAuth/API-key rows become security events', async () => {
    await db.query(
      `INSERT INTO public.object_audit_log (tenant_id, actor_id, object_type, object_id, action, summary, diff, metadata)
       VALUES ($1, $2, 'workflow', $3, 'update', 'Updated workflow "Onboarding"', $4, $5)`,
      [TENANT, USER, WORKFLOW, JSON.stringify({ name: { before: SECRET, after: SECRET }, nodes: { before: [], after: [SECRET] } }), JSON.stringify({ ip: SECRET })],
    )
    await db.query(
      `INSERT INTO public.object_audit_log (tenant_id, actor_id, object_type, object_id, action, summary, metadata)
       VALUES ($1, $2, 'oauth_client', 'usertasks-cli', 'grant', 'Issued OAuth tokens', $3),
              ($1, NULL, 'api_key', 'key-1', 'auth_failed', 'Invalid API key presented', $4)`,
      [TENANT, USER,
        JSON.stringify({ event: 'token_issued', client_id: 'usertasks-cli', grant_type: 'refresh_token', scopes: ['tasks:read'], token: SECRET }),
        JSON.stringify({ event: 'auth_failed', key_prefix: 'ut_abcde', reason: 'invalid_secret', secret: SECRET })],
    )
    const rows = await events('object_audit_log')
    expect(rows.map((r) => [r.type, r.category, r.severity])).toEqual([
      ['audit.workflow.update', 'audit', 'info'],
      ['security.oauth.token_issued', 'security', 'info'],
      ['security.api_key.auth_failed', 'security', 'warn'],
    ])
    expect(rows[0].attributes).toEqual({ object_type: 'workflow', object_id: WORKFLOW, action: 'update', changed_fields: ['name', 'nodes'] })
    expect(rows[0].message).toBe('Updated workflow "Onboarding"')
    expect(rows[1].attributes).toMatchObject({ client_id: 'usertasks-cli', grant_type: 'refresh_token', scopes: ['tasks:read'] })
    expect(rows[2].attributes).toMatchObject({ key_prefix: 'ut_abcde', reason: 'invalid_secret' })
    expectClean(rows)
  })

  it('permission_audit_log: security.permission.*', async () => {
    await db.query(
      `INSERT INTO public.permission_audit_log (tenant_id, actor_id, action, target_user_id, details)
       VALUES ($1, $2, 'user_role_bulk_assigned', NULL, $3)`,
      [TENANT, USER, JSON.stringify({ role_name: 'Approvers', count: 3, user_ids: [SECRET] })],
    )
    const rows = await events('permission_audit_log')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'security.permission.user_role_bulk_assigned', category: 'security', actor_id: USER })
    expect(rows[0].message).toBe('User Role Bulk Assigned (Approvers)')
    expect(rows[0].attributes).toMatchObject({ role_name: 'Approvers', count: 3 })
    expectClean(rows)
  })

  it('retention execution + review events', async () => {
    await db.query(`INSERT INTO public.retention_policies (id, tenant_id, name, policy_mode) VALUES ($1, $2, 'Forever', 'keep_forever')`, [POLICY, TENANT])
    await db.query(
      `INSERT INTO public.retention_execution_events (tenant_id, retention_policy_id, action_type, target_type, target_id, executed_at, asset_name, result_status, metadata)
       VALUES ($1, $2, 'purge', 'data_table', $3, now(), 'Old invoices', 'completed', $4),
              ($1, $2, 'purge', 'data_row', $3, now(), NULL, 'failed', $4)`,
      [TENANT, POLICY, TASK, JSON.stringify({ secret: SECRET })],
    )
    const { rows: [review] } = await db.query(
      `INSERT INTO public.retention_review_events (tenant_id, retention_policy_id, target_type, target_id, review_date, asset_name)
       VALUES ($1, $2, 'data_row', $3, current_date, 'Contract row') RETURNING id`,
      [TENANT, POLICY, TASK],
    )
    await db.query(`UPDATE public.retention_review_events SET admin_tasks_created_at = now() WHERE id = $1`, [review.id])
    await db.query(`UPDATE public.retention_review_events SET status = 'dismissed' WHERE id = $1`, [review.id])
    const rows = (await events()).filter((r) => r.source_table.startsWith('retention_'))
    expect(rows.map((r) => [r.type, r.severity])).toEqual([
      ['system.retention.purged', 'info'],
      ['system.retention.purge_failed', 'error'],
      ['system.retention.review_opened', 'info'],
      ['system.retention.review_dismissed', 'info'],
    ])
    expect(rows[0].message).toBe('Retention policy purged data table "Old invoices"')
    expectClean(rows)
  })

  it('deletion_queue: completed / failed only', async () => {
    const { rows: [job] } = await db.query(
      `INSERT INTO public.deletion_queue (tenant_id, created_by, target_type, target_id, payload)
       VALUES ($1, $2, 'workflow', $3, $4) RETURNING id`,
      [TENANT, USER, WORKFLOW, JSON.stringify({ secret: SECRET })],
    )
    await db.query(`UPDATE public.deletion_queue SET status = 'processing', attempts = 1 WHERE id = $1`, [job.id])
    expect(await events('deletion_queue')).toHaveLength(0)
    await db.query(`UPDATE public.deletion_queue SET status = 'failed', error = 'storage unavailable' WHERE id = $1`, [job.id])
    await db.query(`UPDATE public.deletion_queue SET status = 'completed', completed_at = now() WHERE id = $1`, [job.id])
    const rows = await events('deletion_queue')
    expect(rows.map((r) => [r.type, r.severity])).toEqual([['system.deletion.failed', 'error'], ['system.deletion.completed', 'info']])
    expect(rows[0].actor_id).toBe(USER)
    expectClean(rows)
  })

  it('github_sync_runs / directory_sync_runs: terminal statuses only', async () => {
    const { rows: [gh] } = await db.query(
      `INSERT INTO public.github_sync_runs (tenant_id, kind, progress, scope) VALUES ($1, 'commit', $2, $2) RETURNING id`,
      [TENANT, JSON.stringify({ secret: SECRET })],
    )
    const { rows: [dir] } = await db.query(
      `INSERT INTO public.directory_sync_runs (tenant_id, provider, progress) VALUES ($1, 'entra', $2) RETURNING id`,
      [TENANT, JSON.stringify({ secret: SECRET })],
    )
    await db.query(`UPDATE public.github_sync_runs SET status = 'running', started_at = now() WHERE id = $1`, [gh.id])
    await db.query(`UPDATE public.directory_sync_runs SET status = 'running', started_at = now() WHERE id = $1`, [dir.id])
    expect((await events()).filter((r) => r.type.startsWith('system.sync'))).toHaveLength(0)
    await db.query(`UPDATE public.github_sync_runs SET status = 'completed', files_changed = 4, commit_sha = 'abc123', completed_at = now() WHERE id = $1`, [gh.id])
    await db.query(
      `UPDATE public.directory_sync_runs SET status = 'failed', error = 'token expired', stats = $2, completed_at = now() WHERE id = $1`,
      [dir.id, JSON.stringify({ users_created: 2, note: SECRET })],
    )
    const rows = (await events()).filter((r) => r.type.startsWith('system.sync'))
    expect(rows.map((r) => [r.type, r.severity, r.message])).toEqual([
      ['system.sync.github.completed', 'info', 'GitHub sync (commit) completed, 4 files changed'],
      ['system.sync.directory.failed', 'error', 'Entra directory sync failed: token expired'],
    ])
    expect(rows[1].attributes.stats).toEqual({ users_created: 2 })
    expectClean(rows)
  })

  it('lifecycle_events: task.* with allow-listed metadata', async () => {
    await db.query(
      `INSERT INTO public.lifecycle_events (tenant_id, task_id, event_type, actor_id, metadata)
       VALUES ($1, $2, 'completed', $3, $4)`,
      [TENANT, TASK, USER, JSON.stringify({ old_status: 'in_progress', new_status: 'completed', comment: SECRET })],
    )
    const rows = await events('lifecycle_events')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'task.completed', category: 'task', task_id: TASK, actor_id: USER })
    expect(rows[0].message).toBe('Task completed (in_progress → completed)')
    expectClean(rows)
  })

  it('a failing emit never fails the source write', async () => {
    // Make every event_stream insert fail for this transaction only.
    await db.query(`ALTER TABLE public.event_stream ADD CONSTRAINT event_stream_force_fail CHECK (false) NOT VALID`)
    const runId = await insertRun()
    await db.query(`INSERT INTO public.workflow_logs (run_id, workflow_id, tenant_id, level, message) VALUES ($1, $2, $3, 'info', 'still logged')`, [runId, WORKFLOW, TENANT])
    await db.query(`UPDATE public.workflow_runs SET status = 'completed', completed_at = now() WHERE id = $1`, [runId])
    await db.query(`INSERT INTO public.object_audit_log (tenant_id, object_type, object_id, action) VALUES ($1, 'workflow', $2, 'update')`, [TENANT, WORKFLOW])
    await db.query(`INSERT INTO public.lifecycle_events (tenant_id, task_id, event_type) VALUES ($1, $2, 'created')`, [TENANT, TASK])

    const { rows: [run] } = await db.query(`SELECT status FROM public.workflow_runs WHERE id = $1`, [runId])
    expect(run.status).toBe('completed')
    const { rows: [logs] } = await db.query(`SELECT count(*)::int AS n FROM public.workflow_logs WHERE run_id = $1`, [runId])
    expect(logs.n).toBe(1)
    expect(await events()).toHaveLength(0)
    expect(warnings.some((w) => w.startsWith('app_events.tg_workflow_runs failed'))).toBe(true)
    expect(warnings.some((w) => w.startsWith('app_events.tg_workflow_logs failed'))).toBe(true)
  })

  it('event_stream is not reachable by anon/authenticated', async () => {
    const { rows: [p] } = await db.query(`
      SELECT has_table_privilege('anon', 'public.event_stream', 'SELECT') AS anon_select,
             has_table_privilege('authenticated', 'public.event_stream', 'SELECT') AS auth_select,
             has_table_privilege('authenticated', 'public.event_stream', 'INSERT') AS auth_insert,
             has_table_privilege('service_role', 'public.event_stream', 'SELECT') AS service_select,
             has_function_privilege('authenticated', 'public.purge_event_stream(uuid, timestamptz, integer)', 'EXECUTE') AS auth_purge,
             has_function_privilege('service_role', 'public.purge_event_stream(uuid, timestamptz, integer)', 'EXECUTE') AS service_purge,
             has_function_privilege('authenticated', 'app_events.emit(uuid, text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, jsonb, timestamptz)', 'EXECUTE') AS auth_emit,
             (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_stream'::regclass) AS rls`)
    expect(p).toEqual({
      anon_select: false, auth_select: false, auth_insert: false, service_select: true,
      auth_purge: false, service_purge: true, auth_emit: false, rls: true,
    })
  })

  it('purge_event_stream deletes expired rows in bounded batches', async () => {
    await db.query(
      `INSERT INTO public.event_stream (tenant_id, occurred_at, type, category, message, source_table)
       SELECT $1, now() - interval '100 hours' + (g || ' seconds')::interval, 'test.old', 'system', 'old', 'test'
       FROM generate_series(1, 5) g`,
      [TENANT],
    )
    await db.query(
      `INSERT INTO public.event_stream (tenant_id, type, category, message, source_table) VALUES ($1, 'test.new', 'system', 'new', 'test')`,
      [TENANT],
    )
    const purge = async () => (await db.query(`SELECT public.purge_event_stream($1, now() - interval '72 hours', 2) AS n`, [TENANT])).rows[0].n
    expect(await purge()).toBe(2)
    expect(await purge()).toBe(2)
    expect(await purge()).toBe(1)
    expect(await purge()).toBe(0)
    expect((await events()).map((r) => r.type)).toEqual(['test.new'])
  })
})
