/**
 * Agent run records against a LOCAL Supabase stack (migration
 * 20261124000000): agent_runs, agent_eval_runs and agent_queue are readable
 * with agents.view, or — without it — only the rows the caller acted for /
 * started; never another workspace's. Plus the migration's data rewrite (an
 * agent without data_access → legacy "all tables") and the usage function.
 *
 * End users are simulated the way PostgREST does it (SET ROLE +
 * request.jwt.claims); everything runs in one transaction that is rolled back.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/agent-run-visibility-db.test.ts
 */
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const uid = (key: string) => {
  const h = createHash('md5').update(`agent-run-visibility:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const A = uid('tenant:A')
const B = uid('tenant:B')
const VIEWER = uid('user:viewer') // A, role with agents.view
const MEMBER = uid('user:member') // A, no agents.view
const ACTOR = uid('user:actor')   // A, no agents.view, a run acted for them
const OUTSIDER = uid('user:outsider') // B, agents.view in B
const AGENT_A = uid('agent:A')
const AGENT_B = uid('agent:B')
const RUN = { acted: uid('run:acted'), started: uid('run:started'), other: uid('run:other'), b: uid('run:b') }

describe.skipIf(!DB_URL)('agent run visibility (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })

  const as = async <T>(sub: string, fn: () => Promise<T>): Promise<T> => {
    await db.query('SAVEPOINT caller')
    await db.query('SET LOCAL ROLE authenticated')
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aud: 'authenticated' })])
    try { return await fn() } finally { await db.query('ROLLBACK TO SAVEPOINT caller') }
  }
  const ids = async (sql: string) => (await db.query(sql)).rows.map((r) => r.id).sort()

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    for (const [id, slug] of [[A, 'arv-a'], [B, 'arv-b']]) await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $2)`, [id, slug])
    const users: Array<[string, string]> = [[VIEWER, A], [MEMBER, A], [ACTOR, A], [OUTSIDER, B]]
    for (const [u] of users) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [u, `${u}@arv.test`])
    }
    await db.query('DELETE FROM public.user_memberships WHERE user_id = ANY($1)', [users.map((u) => u[0])])
    for (const [u, t] of users) {
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [u, t])
      await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role, is_active) VALUES ($1, $2, 'member', true)`, [u, t])
    }
    const viewRoleA = uid('role:view:A')
    const viewRoleB = uid('role:view:B')
    const plainRoleA = uid('role:plain:A')
    await db.query(`INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $2, 'Agent viewers', 'arv-view', ARRAY['agents.view']), ($3, $4, 'Agent viewers', 'arv-view', ARRAY['agents.view']), ($5, $2, 'Members', 'arv-plain', ARRAY['tasks.view_own','workflows.view'])`, [viewRoleA, A, viewRoleB, B, plainRoleA])
    await db.query(`INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3), ($1, $4, $5), ($1, $6, $5), ($7, $8, $9)`, [A, VIEWER, viewRoleA, MEMBER, plainRoleA, ACTOR, B, OUTSIDER, viewRoleB])
    await db.query(`INSERT INTO public.agents (id, tenant_id, name, output_config) VALUES ($1, $2, 'Visible agent', '{"variables":[]}'), ($3, $4, 'B agent', '{"variables":[],"data_access":{"mode":"selected","table_ids":["t1"]}}')`, [AGENT_A, A, AGENT_B, B])
    const run = `INSERT INTO public.agent_runs (id, tenant_id, agent_id, actor_id, initiated_by, status, total_tokens, cost_amount, cost_currency, cost_status, started_at) VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9, now())`
    await db.query(run, [RUN.acted, A, AGENT_A, ACTOR, null, 100, 0.25, 'USD', 'priced'])
    await db.query(run, [RUN.started, A, AGENT_A, null, MEMBER, 50, null, null, 'unknown'])
    await db.query(run, [RUN.other, A, AGENT_A, VIEWER, VIEWER, 10, 0.5, 'USD', 'priced'])
    await db.query(run, [RUN.b, B, AGENT_B, OUTSIDER, OUTSIDER, 999, 9, 'USD', 'priced'])
    await db.query(`INSERT INTO public.agent_eval_runs (id, tenant_id, agent_id, created_by) VALUES ($1, $2, $3, $4), ($5, $2, $3, $6)`, [uid('eval:viewer'), A, AGENT_A, VIEWER, uid('eval:member'), MEMBER])
    await db.query(`INSERT INTO public.agent_queue (id, tenant_id, agent_id, input_message, status, created_by) VALUES ($1, $2, $3, 'x', 'completed', $4), ($5, $2, $3, 'y', 'completed', $6)`, [uid('job:viewer'), A, AGENT_A, VIEWER, uid('job:member'), MEMBER])
  }, 60_000)

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => undefined)
    await db.end()
  })

  it('agents.view reads every run of its workspace, never another workspace\'s', async () => {
    expect(await as(VIEWER, () => ids(`SELECT id FROM public.agent_runs WHERE tenant_id IN ('${A}', '${B}')`))).toEqual([RUN.acted, RUN.started, RUN.other].sort())
    expect(await as(OUTSIDER, () => ids(`SELECT id FROM public.agent_runs WHERE tenant_id IN ('${A}', '${B}')`))).toEqual([RUN.b])
  })

  it('without agents.view: only the runs the caller acted for or started', async () => {
    expect(await as(ACTOR, () => ids(`SELECT id FROM public.agent_runs WHERE tenant_id = '${A}'`))).toEqual([RUN.acted])
    expect(await as(MEMBER, () => ids(`SELECT id FROM public.agent_runs WHERE tenant_id = '${A}'`))).toEqual([RUN.started])
    // The step trace / tool calls are columns of those rows: the same rule.
    expect(await as(MEMBER, async () => (await db.query(`SELECT count(*)::int AS n FROM public.agent_runs WHERE id = $1`, [RUN.other])).rows[0].n)).toBe(0)
  })

  it('eval runs and queue jobs: agents.view, or the caller\'s own', async () => {
    expect(await as(VIEWER, () => ids(`SELECT id FROM public.agent_eval_runs WHERE tenant_id = '${A}'`))).toHaveLength(2)
    expect(await as(MEMBER, () => ids(`SELECT id FROM public.agent_eval_runs WHERE tenant_id = '${A}'`))).toEqual([uid('eval:member')])
    expect(await as(ACTOR, () => ids(`SELECT id FROM public.agent_eval_runs WHERE tenant_id = '${A}'`))).toEqual([])
    expect(await as(MEMBER, () => ids(`SELECT id FROM public.agent_queue WHERE tenant_id = '${A}'`))).toEqual([uid('job:member')])
    expect(await as(VIEWER, () => ids(`SELECT id FROM public.agent_queue WHERE tenant_id = '${A}'`))).toHaveLength(2)
    expect(await as(OUTSIDER, () => ids(`SELECT id FROM public.agent_queue WHERE tenant_id = '${A}'`))).toEqual([])
  })

  it('end users still cannot write runs, and agent_usage_totals is service-role only', async () => {
    await expect(as(VIEWER, () => db.query(`UPDATE public.agent_runs SET status = 'failed' WHERE id = $1`, [RUN.other]))).rejects.toMatchObject({ code: '42501' })
    await expect(as(VIEWER, () => db.query(`SELECT public.agent_usage_totals($1, NULL, now() - interval '1 day')`, [A]))).rejects.toMatchObject({ code: '42501' })
    const totals = (await db.query(`SELECT public.agent_usage_totals($1, NULL, now() - interval '1 day') AS t`, [A])).rows[0].t
    expect(totals).toEqual({ runs: 3, tokens: 160, unpriced_runs: 1, cost: { USD: 0.75 } })
    const agentOnly = (await db.query(`SELECT public.agent_usage_totals($1, $2, now() - interval '1 day') AS t`, [B, AGENT_B])).rows[0].t
    expect(agentOnly).toMatchObject({ runs: 1, tokens: 999, cost: { USD: 9 } })
  })

  it('the migration\'s data rewrite keeps existing access (absent → legacy all; selected → read/insert/update grants)', async () => {
    // Re-run the rewrite statements on the fixture agents (idempotent: rows with grants are skipped).
    const sql = (await import('node:fs')).readFileSync('supabase/migrations/20261124000000_agents_decisions.sql', 'utf8')
    const section = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION pg_temp.legacy_data_access'), sql.indexOf('UPDATE public.agent_versions'))
    await db.query(section)
    const { rows } = await db.query(`SELECT id, output_config->'data_access' AS da FROM public.agents WHERE id = ANY($1)`, [[AGENT_A, AGENT_B]])
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.da]))
    expect(byId[AGENT_A]).toEqual({ mode: 'all', grants: [], legacy: true, table_ids: [] })
    expect(byId[AGENT_B]).toEqual({ mode: 'selected', legacy: true, table_ids: ['t1'], grants: [{ table_id: 't1', read: true, insert: true, update: true, delete: false }] })
    await db.query(section)
    expect((await db.query(`SELECT output_config->'data_access' AS da FROM public.agents WHERE id = $1`, [AGENT_B])).rows[0].da).toEqual(byId[AGENT_B])
  })
})
