/**
 * Seed the LOCAL Supabase stack with a bench tenant and realistic volume:
 * ~50k tasks (with task_assignees), 100k workflow_runs, 1M workflow_logs
 * (and the event_stream rows their triggers write), 50k historical queue
 * jobs, data tables, a decision table, an integration + reference pointing at
 * the local echo server, the bench workflows and a tenant API key. A second
 * "noise" tenant gets 20k tasks / 20k runs so RLS has something to filter.
 *
 *   npx tsx scripts/bench/seed.ts [--reset] [--scale 0.1] [--echo-port 4599]
 *
 * Refuses to run unless the database and API URLs are localhost/127.0.0.1.
 * Idempotent: bulk data is only inserted when the bench tenant has none;
 * workflows, the decision table, the integration and the API key are
 * re-applied every time. --reset deletes the bench tenants first.
 */
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Client } from 'pg'
import { benchEnv, hasState, parseArgs, readState, writeState, type BenchState } from './lib/env'
import { ensureBenchWorkflows } from './lib/workflows'

const TENANT = '0be0c000-0000-4000-8000-000000000001'
const NOISE_TENANT = '0be0c000-0000-4000-8000-000000000002'
// The first 8 hex chars differ per user: the auth trigger names each personal
// workspace 'personal-<first 8 chars of the id>'.
const userId = (n: number) => `0be0d0${String(n).padStart(2, '0')}-0000-4000-8000-000000000000`
const ORDERS_TABLE = '0be0e000-0000-4000-8000-000000000001'
const EVENTS_TABLE = '0be0e000-0000-4000-8000-000000000002'
const DECISION_TABLE = '0be0f000-0000-4000-8000-000000000001'
const INTEGRATION = '0be0a000-0000-4000-8000-000000000001'
const REFERENCE = '0be0a000-0000-4000-8000-000000000002'
const busyWorkflowId = (n: number) => `0be00000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`

const BENCH_USERS = 20 // 01 = owner, 02 = the member the RLS plans run as
const NOISE_USERS = 5

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now()
  process.stdout.write(`  ${label} … `)
  const result = await fn()
  console.log(`${((Date.now() - started) / 1000).toFixed(1)} s`)
  return result
}

async function reset(db: Client) {
  // Big tables first (explicit deletes are much faster than the cascade).
  for (const table of ['workflow_logs', 'event_stream', 'workflow_queue', 'workflow_runs', 'task_assignees', 'tasks', 'custom_table_rows', 'api_keys']) {
    await timed(`delete ${table}`, () => db.query(`DELETE FROM public.${table} WHERE tenant_id = ANY($1)`, [[TENANT, NOISE_TENANT]]))
  }
  await timed('delete tenants + users', async () => {
    // Bench users (matched by their email domain) and the personal workspaces
    // the auth trigger created for them; users go first (they reference tenants).
    const users = `SELECT id FROM auth.users WHERE email LIKE '%@perf-bench.local'`
    const { rows } = await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM public.user_memberships WHERE user_id IN (${users}) AND is_home`)
    await db.query(`DELETE FROM public.users WHERE id IN (${users})`)
    await db.query(`DELETE FROM auth.users WHERE id IN (${users})`)
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1)', [[TENANT, NOISE_TENANT, ...rows.map((r) => r.tenant_id)]])
  })
}

async function ensureTenantsAndUsers(db: Client) {
  await db.query(
    `INSERT INTO public.tenants (id, name, slug, plan) VALUES ($1, 'Perf Bench', 'perf-bench', 'business_team'), ($2, 'Perf Bench Noise', 'perf-bench-noise', 'business_team')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT, NOISE_TENANT],
  )
  const total = BENCH_USERS + NOISE_USERS
  for (let n = 1; n <= total; n++) {
    const id = userId(n)
    const tenant = n <= BENCH_USERS ? TENANT : NOISE_TENANT
    const role = n === 1 || n === BENCH_USERS + 1 ? 'owner' : 'member'
    const email = `bench-${String(n).padStart(2, '0')}@perf-bench.local`
    // The auth trigger creates public.users + a personal workspace, like a real sign-up.
    await db.query(
      `INSERT INTO auth.users (id, email, instance_id, aud, role, raw_user_meta_data, email_confirmed_at)
       VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', jsonb_build_object('full_name', $3::text), now())
       ON CONFLICT (id) DO NOTHING`,
      [id, email, `Bench User ${n}`],
    )
    await db.query(`UPDATE public.users SET tenant_id = $2, current_tenant_id = $2, role = $3::user_role WHERE id = $1`, [id, tenant, role])
    await db.query(
      `INSERT INTO public.user_memberships (user_id, tenant_id, role, is_active)
       SELECT $1, $2, $3::user_role, true WHERE NOT EXISTS (SELECT 1 FROM public.user_memberships WHERE user_id = $1 AND tenant_id = $2)`,
      [id, tenant, role],
    )
    await db.query(
      `INSERT INTO public.user_roles (tenant_id, user_id, role_id)
       SELECT $2, $1, r.id FROM public.roles r WHERE r.tenant_id = $2 AND r.slug = $3 AND r.is_system
       ON CONFLICT DO NOTHING`,
      [id, tenant, role],
    )
  }
}

async function seedBulk(db: Client, scale: number) {
  const benchUsers = [...Array(BENCH_USERS)].map((_, i) => userId(i + 1))
  const noiseUsers = [...Array(NOISE_USERS)].map((_, i) => userId(BENCH_USERS + i + 1))
  const n = (x: number) => Math.max(1, Math.round(x * scale))

  // Workflows the historical runs belong to.
  await timed('busy workflows (20)', async () => {
    for (let i = 1; i <= 20; i++) {
      await db.query(
        `INSERT INTO public.workflows (id, tenant_id, name, trigger_type, nodes, edges, is_active, created_by, run_count)
         VALUES ($1, $2, $3, 'webhook_received', '[{"id":"t","type":"webhook_received","label":"Webhook","position":{"x":0,"y":0},"config":{}}]', '[]', false, $4, 0)
         ON CONFLICT (id) DO NOTHING`,
        [busyWorkflowId(i), TENANT, `Bench busy ${i}`, benchUsers[0]],
      )
    }
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, trigger_type, nodes, edges, is_active)
       VALUES ('0be00000-0000-4000-8000-000000000399', $1, 'Noise workflow', 'webhook_received', '[]', '[]', false) ON CONFLICT (id) DO NOTHING`,
      [NOISE_TENANT],
    )
  })

  const insertTasks = (tenant: string, users: string[], count: number) => db.query(
    `INSERT INTO public.tasks (tenant_id, title, description, status, priority, assignee_id, assigner_id, due_date, created_at, updated_at,
                               acceptance_status, metadata, tags, is_workflow_task)
     SELECT $1,
            'Task ' || g || ' ' || (ARRAY['invoice','onboarding','review','approval','incident','renewal'])[1 + g % 6] || ' ' || left(md5(g::text), 8),
            'Generated by the perf bench seed (' || g || ')',
            (ARRAY['todo','in_progress','blocked','completed','cancelled']::public.task_status[])[1 + g % 5],
            (ARRAY['critical','high','medium','low','none']::public.task_priority[])[1 + (g / 7) % 5],
            ($2::uuid[])[1 + g % array_length($2::uuid[], 1)],
            ($2::uuid[])[1],
            now() + ((g % 60) - 30) * interval '1 day',
            now() - (g % 180) * interval '1 day' - (g % 1440) * interval '1 minute',
            now() - (g % 180) * interval '1 day',
            CASE WHEN g % 50 = 0 THEN 'pending' ELSE 'accepted' END,
            jsonb_build_object('source', 'bench', 'n', g),
            ARRAY['bench'],
            g % 4 = 0
     FROM generate_series(1, $3::int) g`,
    [tenant, users, count],
  )
  await timed(`tasks (${n(50_000)} + ${n(20_000)} noise)`, async () => {
    await insertTasks(TENANT, benchUsers, n(50_000))
    await insertTasks(NOISE_TENANT, noiseUsers, n(20_000))
  })
  await timed('task_assignees', () => db.query(
    `INSERT INTO public.task_assignees (tenant_id, task_id, user_id, role, acceptance_status)
     SELECT tenant_id, id, assignee_id, 'assignee', 'accepted' FROM public.tasks WHERE tenant_id = ANY($1) AND assignee_id IS NOT NULL
     UNION ALL
     SELECT t.tenant_id, t.id, ($2::uuid[])[1 + abs(hashtext(t.id::text)) % array_length($2::uuid[], 1)], 'collaborator', 'accepted'
       FROM public.tasks t WHERE t.tenant_id = $3 AND abs(hashtext(t.id::text || 'c')) % 5 = 0
     ON CONFLICT (task_id, user_id) DO NOTHING`,
    [[TENANT, NOISE_TENANT], benchUsers, TENANT],
  ))

  const insertRuns = (tenant: string, workflows: string[], count: number) => db.query(
    `INSERT INTO public.workflow_runs (workflow_id, tenant_id, task_id, status, started_at, completed_at, node_results, execution_trace, error, trace_id)
     SELECT ($2::uuid[])[1 + g % array_length($2::uuid[], 1)], $1, NULL,
            CASE WHEN g % 20 = 0 THEN 'failed' WHEN g % 33 = 0 THEN 'paused' ELSE 'completed' END,
            now() - (g % 90) * interval '1 day' - (g % 86400) * interval '1 second',
            now() - (g % 90) * interval '1 day' - (g % 86400) * interval '1 second' + (50 + g % 4000) * interval '1 millisecond',
            jsonb_build_object('t', jsonb_build_object('status', 'completed', 'duration_ms', g % 40),
                               'n1', jsonb_build_object('status', 'completed', 'duration_ms', g % 90, 'output', jsonb_build_object('value', md5(g::text)))),
            jsonb_build_array(jsonb_build_object('node_id', 't', 'kind', 'start'), jsonb_build_object('node_id', 'n1', 'kind', 'default')),
            CASE WHEN g % 20 = 0 THEN 'Bench failure ' || g END,
            gen_random_uuid()
     FROM generate_series(1, $3::int) g`,
    [tenant, workflows, count],
  )
  await timed(`workflow_runs (${n(100_000)} + ${n(20_000)} noise)`, async () => {
    await insertRuns(TENANT, [...Array(20)].map((_, i) => busyWorkflowId(i + 1)), n(100_000))
    await insertRuns(NOISE_TENANT, ['0be00000-0000-4000-8000-000000000399'], n(20_000))
  })
  // Link ~30% of the bench runs to a task (task_id lookups / reports).
  await db.query(
    `WITH r AS (SELECT id, row_number() OVER () AS rn FROM public.workflow_runs WHERE tenant_id = $1),
          t AS (SELECT id, row_number() OVER () AS rn FROM public.tasks WHERE tenant_id = $1)
     UPDATE public.workflow_runs w SET task_id = t.id FROM r JOIN t ON t.rn = r.rn WHERE w.id = r.id AND r.rn % 3 = 0`,
    [TENANT],
  )

  // 10 logs per bench run → ~1M rows, inserted in chunks (the statement-level
  // event_stream trigger copies each chunk into event_stream).
  const { rows: [{ count: runCount }] } = await db.query<{ count: string }>('SELECT count(*) FROM public.workflow_runs WHERE tenant_id = $1', [TENANT])
  const chunk = 10_000
  await timed(`workflow_logs (${Number(runCount) * 10})`, async () => {
    for (let offset = 0; offset < Number(runCount); offset += chunk) {
      await db.query(
        `INSERT INTO public.workflow_logs (run_id, workflow_id, tenant_id, node_id, node_type, node_label, level, message, metadata, duration_ms, created_at)
         SELECT r.id, r.workflow_id, r.tenant_id, 'n' || k,
                (ARRAY['set_variable','math','http_request','condition','log'])[1 + k % 5], 'Step ' || k,
                CASE WHEN k = 10 AND r.status = 'failed' THEN 'error' ELSE 'info' END,
                'Step ' || k || ' finished', jsonb_build_object('k', k), k * 3, r.started_at + k * interval '10 milliseconds'
         FROM (SELECT id, workflow_id, tenant_id, status, started_at FROM public.workflow_runs WHERE tenant_id = $1 ORDER BY id LIMIT $2 OFFSET $3) r
         CROSS JOIN generate_series(1, 10) k`,
        [TENANT, chunk, offset],
      )
    }
  })

  // Queue history: completed rows keep their full result today (never purged).
  await timed(`workflow_queue history (${n(50_000)})`, () => db.query(
    `INSERT INTO public.workflow_queue (workflow_id, tenant_id, trigger_type, trigger_data, priority, status, attempts, max_attempts,
                                       scheduled_for, started_at, completed_at, result, error, created_at)
     SELECT ($2::uuid[])[1 + g % 20], $1, 'webhook_received', jsonb_build_object('n', g), 0,
            CASE WHEN g % 25 = 0 THEN 'dead' ELSE 'completed' END, CASE WHEN g % 25 = 0 THEN 3 ELSE 1 END, 3,
            now() - (g % 30) * interval '1 day', now() - (g % 30) * interval '1 day', now() - (g % 30) * interval '1 day' + interval '1 second',
            jsonb_build_object('status', 'completed', 'node_results', jsonb_build_object('n1', jsonb_build_object('output', repeat(md5(g::text), 16)))),
            CASE WHEN g % 25 = 0 THEN 'Bench dead job' END,
            now() - (g % 30) * interval '1 day'
     FROM generate_series(1, $3::int) g`,
    [TENANT, [...Array(20)].map((_, i) => busyWorkflowId(i + 1)), n(50_000)],
  ))

  await timed(`data table rows (${n(5_000)})`, () => db.query(
    `INSERT INTO public.custom_table_rows (table_id, tenant_id, data, created_by)
     SELECT $1, $2, jsonb_build_object('id', g, 'customer', 'Customer ' || (g % 300), 'total', (g * 37) % 5000, 'status', (ARRAY['open','paid','void'])[1 + g % 3]), $3
     FROM generate_series(1, $4::int) g`,
    [ORDERS_TABLE, TENANT, benchUsers[0], n(5_000)],
  ))
}

async function ensureAssets(db: Client, ownerId: string, echoPort: number) {
  await db.query(
    `INSERT INTO public.custom_tables (id, tenant_id, name, slug, columns, created_by) VALUES
       ($1, $3, 'Bench orders', 'bench_orders', '[{"key":"id","label":"ID","type":"number"},{"key":"customer","label":"Customer","type":"text"},{"key":"total","label":"Total","type":"number"},{"key":"status","label":"Status","type":"text"}]', $4),
       ($2, $3, 'Bench events', 'bench_events', '[{"key":"name","label":"Name","type":"text"},{"key":"amount","label":"Amount","type":"number"},{"key":"status","label":"Status","type":"text"}]', $4)
     ON CONFLICT (id) DO NOTHING`,
    [ORDERS_TABLE, EVENTS_TABLE, TENANT, ownerId],
  )

  // 20 rules: 10 amount bands × web/store; the last band has no upper bound.
  const rules = []
  for (let band = 0; band < 10; band++) {
    for (const channel of ['web', 'store']) {
      const conditions = [
        { id: `c${band}${channel}a`, inputKey: 'amount', operator: 'greater_than_or_equal', value: String(band * 100) },
        ...(band < 9 ? [{ id: `c${band}${channel}b`, inputKey: 'amount', operator: 'less_than', value: String((band + 1) * 100) }] : []),
        { id: `c${band}${channel}c`, inputKey: 'channel', operator: 'equals', value: channel },
      ]
      rules.push({ id: `r${band}-${channel}`, label: `Band ${band} ${channel}`, enabled: true, conditions, outputs: { discount: band * (channel === 'web' ? 2 : 1), approver: band > 6 ? 'manager' : 'auto' } })
    }
  }
  await db.query(
    `INSERT INTO public.decision_tables (id, tenant_id, name, inputs, outputs, rules, created_by)
     VALUES ($1, $2, 'Bench discount rules', $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET inputs = EXCLUDED.inputs, outputs = EXCLUDED.outputs, rules = EXCLUDED.rules`,
    [
      DECISION_TABLE, TENANT,
      JSON.stringify([{ id: 'amount', key: 'amount', label: 'Amount', type: 'number' }, { id: 'channel', key: 'channel', label: 'Channel', type: 'text' }]),
      JSON.stringify([{ id: 'discount', key: 'discount', label: 'Discount', type: 'number' }, { id: 'approver', key: 'approver', label: 'Approver', type: 'text' }]),
      JSON.stringify(rules), ownerId,
    ],
  )

  await db.query(
    `INSERT INTO public.integrations (id, tenant_id, name, type, config, created_by)
     VALUES ($1, $2, 'Bench echo', 'rest_api', $3, $4)
     ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config`,
    [INTEGRATION, TENANT, JSON.stringify({ base_url: `http://127.0.0.1:${echoPort}`, auth_type: 'none', auth_config: {} }), ownerId],
  )
  await db.query(
    `INSERT INTO public.integration_references (id, integration_id, tenant_id, name, inputs, outputs, request_config)
     VALUES ($1, $2, $3, 'Echo GET', $4, '[]', $5)
     ON CONFLICT (id) DO UPDATE SET inputs = EXCLUDED.inputs, request_config = EXCLUDED.request_config`,
    [REFERENCE, INTEGRATION, TENANT, JSON.stringify([{ name: 'q', location: 'query', type: 'string' }]), JSON.stringify({ method: 'GET', path_template: '/echo' })],
  )
}

/** A fresh tenant-wide key (legacy full-admin permissions); older bench keys are revoked. */
async function createApiKey(db: Client, ownerId: string): Promise<string> {
  const token = 'ut_' + randomBytes(24).toString('hex')
  await db.query(`UPDATE public.api_keys SET is_revoked = true WHERE tenant_id = $1 AND name = 'perf bench'`, [TENANT])
  await db.query(
    `INSERT INTO public.api_keys (tenant_id, name, key_prefix, key_hash, key_type, created_by) VALUES ($1, 'perf bench', $2, $3, 'tenant', $4)`,
    [TENANT, token.slice(0, 8), await bcrypt.hash(token, 10), ownerId],
  )
  return token
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = benchEnv()
  const scale = args.scale ? Number(args.scale) : 1
  const echoPort = args['echo-port'] ? Number(args['echo-port']) : 4599
  if (!(scale > 0)) throw new Error('--scale must be > 0')

  const db = new Client({ connectionString: env.dbUrl })
  await db.connect()
  try {
    console.log(`Seeding ${env.dbUrl.replace(/:[^:@/]+@/, ':***@')} (scale ${scale})`)
    if (args.reset) await reset(db)
    await timed('tenants + users', () => ensureTenantsAndUsers(db))
    const ownerId = userId(1)
    await timed('tables, decision table, integration', () => ensureAssets(db, ownerId, echoPort))
    const workflows = await timed('bench workflows', () => ensureBenchWorkflows(db, TENANT, ownerId, { eventsTableId: EVENTS_TABLE, decisionTableId: DECISION_TABLE, referenceId: REFERENCE }))

    const { rows: [{ count }] } = await db.query<{ count: string }>('SELECT count(*) FROM public.tasks WHERE tenant_id = $1', [TENANT])
    if (Number(count) === 0) {
      await seedBulk(db, scale)
      await timed('ANALYZE', () => db.query('ANALYZE'))
    } else {
      console.log(`  bulk data present (${count} tasks) — skipped (use --reset to reseed)`)
    }

    const apiKey = await createApiKey(db, ownerId)
    const counts: Record<string, number> = {}
    for (const table of ['tasks', 'task_assignees', 'workflow_runs', 'workflow_logs', 'event_stream', 'workflow_queue', 'custom_table_rows']) {
      const { rows } = await db.query<{ count: string }>(`SELECT count(*) FROM public.${table} WHERE tenant_id = $1`, [TENANT])
      counts[table] = Number(rows[0].count)
    }
    const { rows: [sample] } = await db.query<{ id: string }>(
      `SELECT id FROM public.workflow_runs WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT 1`, [busyWorkflowId(1)],
    )
    const previous = hasState() ? readState() : null
    const state: BenchState = {
      tenantId: TENANT,
      noiseTenantId: NOISE_TENANT,
      ownerId,
      memberId: userId(2),
      userIds: [...Array(BENCH_USERS)].map((_, i) => userId(i + 1)),
      apiKey,
      workflowIds: Object.fromEntries(workflows.map((w) => [w.key, w.id])),
      versionIds: Object.fromEntries(workflows.map((w) => [w.key, w.versionId])),
      ordersTableId: ORDERS_TABLE,
      eventsTableId: EVENTS_TABLE,
      decisionTableId: DECISION_TABLE,
      integrationId: INTEGRATION,
      referenceId: REFERENCE,
      echoPort,
      sampleRunId: sample?.id ?? '',
      busyWorkflowId: busyWorkflowId(1),
      seededAt: Number(count) === 0 ? new Date().toISOString() : previous?.seededAt ?? new Date().toISOString(),
      counts,
    }
    writeState(state)
    console.log('Counts (bench tenant):', counts)
    console.log('State written to scripts/bench/.state.json (gitignored; holds the API key).')
  } finally {
    await db.end()
  }
}

main().catch((error) => {
  console.error(`seed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
