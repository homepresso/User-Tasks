/**
 * SQL-level checks for supabase/migrations/20261024000004_enqueue_workflow_tenant_check.sql
 * and 20261118000000_manager_tasks.sql (enqueue_workflow, reassign_task and
 * escalate_task are service-role only; the task trigger still queues):
 * enqueue_workflow (and reassign_task / escalate_task / get_task_tree /
 * check_object_permission) refuse other tenants' rows for end-user callers,
 * while the task trigger and service_role paths keep working.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/enqueue-workflow-db.test.ts
 * End users are simulated the way PostgREST does it: SET ROLE + request.jwt.claims.
 * Every test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL

const TENANT_A = '0d000000-0000-4000-8000-00000000000a'
const TENANT_B = '0d000000-0000-4000-8000-00000000000b'
const USER = '0d000000-0000-4000-8000-000000000001'
const WF_A = '0d000000-0000-4000-8000-0000000000a1'
const WF_B = '0d000000-0000-4000-8000-0000000000b1'
const TASK_A = '0d000000-0000-4000-8000-0000000000a2'
const TASK_B = '0d000000-0000-4000-8000-0000000000b2'

const ENQUEUE = 'public.enqueue_workflow(uuid, uuid, uuid, text, jsonb, integer, integer)'

describe.skipIf(!DB_URL)('enqueue_workflow tenant checks (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  beforeAll(async () => { await db.connect() })
  afterAll(async () => { await db.end() })

  beforeEach(async () => {
    await db.query('BEGIN')
    await db.query(
      `INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Enqueue A', 'enqueue-a'), ($2, 'Enqueue B', 'enqueue-b')`,
      [TENANT_A, TENANT_B],
    )
    await db.query(
      `INSERT INTO auth.users (id, email, instance_id, aud, role)
       VALUES ($1, 'enqueue@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
      [USER],
    )
    // Member of A only; A is the current tenant.
    await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member')`, [USER, TENANT_A])
    await db.query(`UPDATE public.users SET current_tenant_id = $2 WHERE id = $1`, [USER, TENANT_A])
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type)
       VALUES ($1, $2, 'A on create', true, 'task_created'), ($3, $4, 'B on create', true, 'task_created')`,
      [WF_A, TENANT_A, WF_B, TENANT_B],
    )
    await db.query(
      `INSERT INTO public.tasks (id, tenant_id, title) VALUES ($1, $2, 'A task'), ($3, $4, 'B task')`,
      [TASK_A, TENANT_A, TASK_B, TENANT_B],
    )
    await db.query(`DELETE FROM public.workflow_queue WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B])
  })
  afterEach(async () => { await db.query('ROLLBACK') })

  /** Run `sql` as a PostgREST-style caller inside a savepoint; returns rows or the error. */
  async function as(role: 'anon' | 'authenticated' | 'service_role', sql: string, params: unknown[] = []) {
    await db.query('SAVEPOINT caller')
    try {
      await db.query(`SET LOCAL ROLE ${role}`)
      const claims = role === 'authenticated' ? { sub: USER, role } : { role }
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
      const { rows } = await db.query(sql, params)
      await db.query('RELEASE SAVEPOINT caller')
      return { rows, error: null as null | { code?: string; message: string } }
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT caller')
      const err = e as { code?: string; message: string }
      return { rows: [], error: { code: err.code, message: err.message } }
    } finally {
      await db.query(`RESET ROLE`)
      await db.query(`SELECT set_config('request.jwt.claims', '', true)`)
    }
  }

  const enqueue = (workflow: string, tenant: string, task: string | null = null) =>
    `SELECT public.enqueue_workflow('${workflow}', '${tenant}', ${task ? `'${task}'` : 'NULL'}, 'api', '{}'::jsonb, 0, 0) AS job`

  async function queued(tenant: string): Promise<number> {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.workflow_queue WHERE tenant_id = $1`, [tenant])
    return rows[0].n
  }

  it('grants: only service_role can execute', async () => {
    const { rows } = await db.query(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
              has_function_privilege('service_role', $1, 'EXECUTE') AS svc,
              has_function_privilege('anon', 'public.reassign_task(uuid, uuid, text)', 'EXECUTE') AS anon_reassign,
              has_function_privilege('anon', 'public.escalate_task(uuid, uuid, text)', 'EXECUTE') AS anon_escalate`,
      [ENQUEUE],
    )
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: true, anon_reassign: false, anon_escalate: false })
    const { rows: more } = await db.query(
      `SELECT has_function_privilege('authenticated', 'public.enqueue_workflow_batch(uuid, jsonb)', 'EXECUTE') AS batch,
              has_function_privilege('authenticated', 'public.reassign_task(uuid, uuid, text)', 'EXECUTE') AS reassign,
              has_function_privilege('authenticated', 'public.escalate_task(uuid, uuid, text)', 'EXECUTE') AS escalate,
              has_function_privilege('service_role', 'public.enqueue_workflow_batch(uuid, jsonb)', 'EXECUTE') AS svc_batch`,
    )
    expect(more[0]).toEqual({ batch: false, reassign: false, escalate: false, svc_batch: true })

    const res = await as('anon', enqueue(WF_A, TENANT_A))
    expect(res.error?.code).toBe('42501')
    expect(await queued(TENANT_A)).toBe(0)
  })

  it('authenticated: a direct rpc call is denied, even for the own tenant', async () => {
    const own = await as('authenticated', enqueue(WF_A, TENANT_A, TASK_A))
    expect(own.error?.code).toBe('42501')
    const other = await as('authenticated', enqueue(WF_B, TENANT_B))
    expect(other.error?.code).toBe('42501')
    const batch = await as('authenticated', `SELECT public.enqueue_workflow_batch('${TENANT_A}', '[{"workflow_id":"${WF_A}"}]'::jsonb)`)
    expect(batch.error?.code).toBe('42501')
    expect(await queued(TENANT_A)).toBe(0)
    expect(await queued(TENANT_B)).toBe(0)
  })

  it('service_role: any tenant, but workflow and task must still belong to it', async () => {
    const ok = await as('service_role', enqueue(WF_B, TENANT_B, TASK_B))
    expect(ok.error).toBeNull()
    expect(await queued(TENANT_B)).toBe(1)

    const mismatch = await as('service_role', enqueue(WF_A, TENANT_B))
    expect(mismatch.error?.message).toContain('workflow_not_found')
    const foreignTask = await as('service_role', enqueue(WF_B, TENANT_B, TASK_A))
    expect(foreignTask.error?.message).toContain('task_not_found')
  })

  it('task trigger: a signed-in user creating a task enqueues the matching workflow', async () => {
    const res = await as('authenticated', `INSERT INTO public.tasks (tenant_id, title) VALUES ('${TENANT_A}', 'Via trigger') RETURNING id`)
    expect(res.error).toBeNull()
    const { rows } = await db.query(
      `SELECT workflow_id, task_id, trigger_type FROM public.workflow_queue WHERE tenant_id = $1`,
      [TENANT_A],
    )
    expect(rows).toEqual([{ workflow_id: WF_A, task_id: res.rows[0].id, trigger_type: 'task_created' }])
  })

  it('task trigger: a cross-tenant write by a SECURITY DEFINER path still enqueues', async () => {
    // Owner-context insert (as a definer function would) while the JWT is a
    // non-member of B: the trigger path is trusted.
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USER, role: 'authenticated' })])
    await db.query(`INSERT INTO public.tasks (tenant_id, title) VALUES ($1, 'Sent to B')`, [TENANT_B])
    await db.query(`SELECT set_config('request.jwt.claims', '', true)`)
    expect(await queued(TENANT_B)).toBe(1)
  })

  it('reassign_task / escalate_task: not callable by signed-in users; service role keeps the tenant check', async () => {
    expect((await as('authenticated', `SELECT public.reassign_task('${TASK_A}', '${USER}', NULL)`)).error?.code).toBe('42501')
    expect((await as('authenticated', `SELECT public.escalate_task('${TASK_A}', '${USER}', 'help')`)).error?.code).toBe('42501')
    const { rows: a } = await db.query(`SELECT assignee_id FROM public.tasks WHERE id = $1`, [TASK_A])
    expect(a[0].assignee_id).toBeNull()
    expect((await as('service_role', `SELECT public.reassign_task('${TASK_A}', '${USER}', NULL)`)).error).toBeNull()
  })

  it('get_task_tree: only tasks the caller may see', async () => {
    const own = await as('authenticated', `SELECT public.get_task_tree('${TASK_A}') AS tree`)
    expect(own.rows[0].tree.task.id).toBe(TASK_A)
    const other = await as('authenticated', `SELECT public.get_task_tree('${TASK_B}') AS tree`)
    expect(other.rows[0].tree.task).toBeNull()
    const anon = await as('anon', `SELECT public.get_task_tree('${TASK_A}') AS tree`)
    expect(anon.rows[0].tree.task).toBeNull()
    const svc = await as('service_role', `SELECT public.get_task_tree('${TASK_B}') AS tree`)
    expect(svc.rows[0].tree.task.id).toBe(TASK_B)

    // Assignee from another tenant can still open the task they were given.
    await db.query(`UPDATE public.tasks SET assignee_id = $1 WHERE id = $2`, [USER, TASK_B])
    const assigned = await as('authenticated', `SELECT public.get_task_tree('${TASK_B}') AS tree`)
    expect(assigned.rows[0].tree.task.id).toBe(TASK_B)
  })

  it('check_object_permission: rejects anything but a known permission name', async () => {
    const ok = await as('authenticated', `SELECT public.check_object_permission('workflow', '${WF_A}', 'view') AS allowed`)
    expect(ok.rows[0].allowed).toBe(true)
    const injected = await as(
      'anon',
      `SELECT public.check_object_permission('workflow', '${WF_A}', 'view = true OR (SELECT true) OR can_view') AS allowed`,
    )
    expect(injected.error?.code).toBe('22023')
  })
})
