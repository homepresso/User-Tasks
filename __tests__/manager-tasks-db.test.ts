/**
 * SQL-level checks for supabase/migrations/20261118000000_manager_tasks.sql:
 *  - end-user callers cannot complete a workflow task (status / outcome /
 *    actioned_* / form values) or write task_responses; the service role
 *    and nested trigger writes can; standard tasks are unaffected;
 *  - reporting lines: manager must be an active member, no self, no loops,
 *    a departing member stops managing;
 *  - tasks.complete_any is seeded for Owner only;
 *  - on-behalf lifecycle events reach the event stream with their fields;
 *  - the tasks trigger still queues task_* workflows for signed-in users.
 *
 * Runs only against a LOCAL Supabase stack (EVENT_STREAM_DB_URL). Every test
 * runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL

const TENANT = '0e000000-0000-4000-8000-00000000000a'
const OTHER = '0e000000-0000-4000-8000-00000000000b'
const ALICE = '0e0a11ce-0000-4000-8000-000000000001'
const MIA = '0e0b1a00-0000-4000-8000-000000000002'
const CARL = '0e0ca410-0000-4000-8000-000000000003'
const OUTSIDER = '0e0d0750-0000-4000-8000-000000000004'
const WF = '0e000000-0000-4000-8000-0000000000a1'
const TASK = '0e000000-0000-4000-8000-0000000000a2'
const STD = '0e000000-0000-4000-8000-0000000000a3'

describe.skipIf(!DB_URL)('manager tasks migration (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  beforeAll(async () => { await db.connect() })
  afterAll(async () => { await db.end() })

  beforeEach(async () => {
    await db.query('BEGIN')
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Mgr A', 'mgr-a'), ($2, 'Mgr B', 'mgr-b')`, [TENANT, OTHER])
    for (const [id, email] of [[ALICE, 'alice'], [MIA, 'mia'], [CARL, 'carl'], [OUTSIDER, 'outsider']]) {
      await db.query(
        `INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [id, `${email}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@mgr.test`],
      )
    }
    await db.query(
      `INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $4, 'member'), ($2, $4, 'member'), ($3, $4, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`,
      [ALICE, MIA, CARL, TENANT],
    )
    await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [OUTSIDER, OTHER])
    await db.query(`UPDATE public.users SET current_tenant_id = $2 WHERE id IN ($1, $3)`, [ALICE, TENANT, MIA])
    await db.query(`INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type) VALUES ($1, $2, 'On complete', true, 'task_completed')`, [WF, TENANT])
    await db.query(
      `INSERT INTO public.tasks (id, tenant_id, title, assignee_id, is_workflow_task, event_id) VALUES ($1, $3, 'Workflow task', $4, true, 'evt-mgr'), ($2, $3, 'Standard task', $4, false, NULL)`,
      [TASK, STD, TENANT, ALICE],
    )
    await db.query(`DELETE FROM public.workflow_queue WHERE tenant_id = $1`, [TENANT])
  })
  afterEach(async () => { await db.query('ROLLBACK') })

  async function as(role: 'authenticated' | 'service_role', user: string | null, sql: string, params: unknown[] = []) {
    await db.query('SAVEPOINT caller')
    try {
      await db.query(`SET LOCAL ROLE ${role}`)
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(user ? { sub: user, role } : { role })])
      const { rows } = await db.query(sql, params)
      await db.query('RELEASE SAVEPOINT caller')
      return { rows, error: null as null | { code?: string; message: string } }
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT caller')
      const err = e as { code?: string; message: string }
      return { rows: [], error: { code: err.code, message: err.message } }
    } finally {
      await db.query('RESET ROLE')
      await db.query(`SELECT set_config('request.jwt.claims', '', true)`)
    }
  }

  it('a signed-in user (even the assignee) cannot complete a workflow task directly', async () => {
    for (const sql of [
      `UPDATE public.tasks SET status = 'completed' WHERE id = '${TASK}'`,
      `UPDATE public.tasks SET outcome = 'approved' WHERE id = '${TASK}'`,
      `UPDATE public.tasks SET actioned_by = '${ALICE}' WHERE id = '${TASK}'`,
      `UPDATE public.tasks SET actioned_on_behalf_of = '${ALICE}' WHERE id = '${TASK}'`,
      `UPDATE public.tasks SET metadata = jsonb_build_object('template_values', jsonb_build_object('amount', 1)) WHERE id = '${TASK}'`,
    ]) {
      const res = await as('authenticated', ALICE, sql)
      expect(res.error?.code, sql).toBe('42501')
      expect(res.error?.message).toContain('workflow_task_completion')
    }
    const insert = await as('authenticated', ALICE, `INSERT INTO public.task_responses (task_id, tenant_id, user_id, outcome) VALUES ('${TASK}', '${TENANT}', '${ALICE}', 'approved')`)
    expect(insert.error?.code).toBe('42501')
    // Allowed: other fields, cancelling, and standard tasks.
    expect((await as('authenticated', ALICE, `UPDATE public.tasks SET priority = 'high' WHERE id = '${TASK}'`)).error).toBeNull()
    expect((await as('authenticated', ALICE, `UPDATE public.tasks SET status = 'completed', outcome = 'done' WHERE id = '${STD}'`)).error).toBeNull()
    const { rows } = await db.query(`SELECT trigger_type, task_id FROM public.workflow_queue WHERE tenant_id = $1`, [TENANT])
    // The standard task's completion still queued the task_completed workflow (definer trigger).
    expect(rows).toEqual([{ trigger_type: 'task_completed', task_id: STD }])
  })

  it('the service role completes it (the app, after the assignee check) and records on-behalf', async () => {
    const res = await as('service_role', null,
      `UPDATE public.tasks SET status = 'completed', outcome = 'approved', actioned_by = '${MIA}', actioned_on_behalf_of = '${ALICE}', actioned_at = now() WHERE id = '${TASK}'`)
    expect(res.error).toBeNull()
    expect((await as('service_role', null, `INSERT INTO public.task_responses (task_id, tenant_id, user_id, outcome, actioned_by) VALUES ('${TASK}', '${TENANT}', '${ALICE}', 'approved', '${MIA}')`)).error).toBeNull()
    const { rows } = await db.query(`SELECT actioned_by, actioned_on_behalf_of FROM public.tasks WHERE id = $1`, [TASK])
    expect(rows[0]).toEqual({ actioned_by: MIA, actioned_on_behalf_of: ALICE })
  })

  it('on-behalf lifecycle events reach the event stream with on_behalf_of / acted_as / note', async () => {
    await db.query(
      `INSERT INTO public.lifecycle_events (tenant_id, task_id, event_type, actor_id, metadata)
       VALUES ($1, $2, 'task_response', $3, jsonb_build_object('outcome', 'approved', 'via', 'ui', 'on_behalf_of', $4::text, 'on_behalf_note', 'On leave', 'acted_as', 'on_behalf'))`,
      [TENANT, TASK, MIA, ALICE],
    )
    const { rows } = await db.query(`SELECT type, actor_id, message, attributes FROM public.event_stream WHERE tenant_id = $1 AND task_id = $2 AND type = 'task.task_response'`, [TENANT, TASK])
    expect(rows).toHaveLength(1)
    expect(rows[0].actor_id).toBe(MIA)
    expect(rows[0].message).toContain('on behalf of the assignee')
    expect(rows[0].attributes).toMatchObject({ event_type: 'task_response', on_behalf_of: ALICE, acted_as: 'on_behalf', on_behalf_note: 'On leave', outcome: 'approved', via: 'ui' })
  })

  it('reporting lines: members only, no self, no loops; departing managers are cleared', async () => {
    const set = (user: string, manager: string | null) => db.query('SAVEPOINT s').then(() =>
      db.query(`UPDATE public.user_memberships SET manager_user_id = $3 WHERE tenant_id = $1 AND user_id = $2`, [TENANT, user, manager])
        .then(() => db.query('RELEASE SAVEPOINT s').then(() => null))
        .catch(async (e) => { await db.query('ROLLBACK TO SAVEPOINT s'); return e as { message: string } }))
    expect(await set(ALICE, MIA)).toBeNull()
    expect(await set(MIA, CARL)).toBeNull()
    expect((await set(CARL, ALICE))?.message).toContain('manager_cycle')
    expect((await set(ALICE, ALICE))?.message).toMatch(/manager_cycle|manager_not_self/)
    expect((await set(ALICE, OUTSIDER))?.message).toContain('manager_not_member')
    await db.query(`UPDATE public.user_memberships SET is_active = false WHERE tenant_id = $1 AND user_id = $2`, [TENANT, MIA])
    const { rows } = await db.query(`SELECT manager_user_id FROM public.user_memberships WHERE tenant_id = $1 AND user_id = $2`, [TENANT, ALICE])
    expect(rows[0].manager_user_id).toBeNull()
  })

  it('members read their workspace\'s reporting lines; nobody writes them through PostgREST', async () => {
    await db.query(`UPDATE public.user_memberships SET manager_user_id = $3 WHERE tenant_id = $1 AND user_id = $2`, [TENANT, ALICE, MIA])
    const read = await as('authenticated', MIA, `SELECT user_id, manager_user_id FROM public.user_memberships WHERE tenant_id = '${TENANT}' AND manager_user_id = '${MIA}'`)
    expect(read.rows).toEqual([{ user_id: ALICE, manager_user_id: MIA }])
    const write = await as('authenticated', ALICE, `UPDATE public.user_memberships SET manager_user_id = NULL WHERE tenant_id = '${TENANT}' AND user_id = '${ALICE}' RETURNING id`)
    expect(write.rows).toEqual([]) // no UPDATE policy: nothing changes
    const { rows } = await db.query(`SELECT manager_user_id FROM public.user_memberships WHERE tenant_id = $1 AND user_id = $2`, [TENANT, ALICE])
    expect(rows[0].manager_user_id).toBe(MIA)
  })

  it('tasks.complete_any: Owner only', async () => {
    await db.query(`DELETE FROM public.roles WHERE tenant_id = $1`, [TENANT])
    await db.query(`SELECT public.seed_tenant_roles($1)`, [TENANT])
    const { rows } = await db.query(`SELECT slug, 'tasks.complete_any' = ANY (permissions) AS has FROM public.roles WHERE tenant_id = $1 ORDER BY slug`, [TENANT])
    expect(Object.fromEntries(rows.map((r) => [r.slug, r.has]))).toEqual({ admin: false, manager: false, member: false, owner: true, viewer: false })
  })
})
