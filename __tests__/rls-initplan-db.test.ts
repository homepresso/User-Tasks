/**
 * SQL-level checks for supabase/migrations/20261027000000_rls_initplan.sql:
 * policies call auth/tenant helpers only as initplans, SECURITY DEFINER
 * functions pin search_path, and create_task_with_subtasks only assigns users
 * of the caller's tenant. (Row-level semantics: rls-semantics-db.test.ts.)
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/rls-initplan-db.test.ts
 * Every test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL

const TENANT_A = '0e000000-0000-4000-8000-00000000000a'
const TENANT_B = '0e000000-0000-4000-8000-00000000000b'
const USER = '0e000001-0000-4000-8000-000000000001'
const MATE = '0e000002-0000-4000-8000-000000000002' // member of A via user_memberships
const OUTSIDER = '0e000003-0000-4000-8000-000000000003' // home B only

describe.skipIf(!DB_URL)('RLS initplan policies and SECURITY DEFINER hygiene (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  beforeAll(async () => { await db.connect() })
  afterAll(async () => { await db.end() })

  beforeEach(async () => {
    await db.query('BEGIN')
    await db.query(
      `INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Initplan A', 'initplan-a'), ($2, 'Initplan B', 'initplan-b')`,
      [TENANT_A, TENANT_B],
    )
    for (const [id, home] of [[USER, TENANT_A], [MATE, TENANT_B], [OUTSIDER, TENANT_B]]) {
      await db.query(
        `INSERT INTO auth.users (id, email, instance_id, aud, role)
         VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [id, `${id}@initplan.test`],
      )
      await db.query(`DELETE FROM public.user_memberships WHERE user_id = $1`, [id])
      await db.query(`UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1`, [id, home])
    }
    await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member')`, [MATE, TENANT_A])
  })
  afterEach(async () => { await db.query('ROLLBACK') })

  /** Run `sql` as USER (authenticated) inside a savepoint; returns rows or the error. */
  async function asUser(sql: string, params: unknown[] = []) {
    await db.query('SAVEPOINT caller')
    try {
      await db.query('SET LOCAL ROLE authenticated')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USER, role: 'authenticated' })])
      const { rows } = await db.query(sql, params)
      await db.query('RELEASE SAVEPOINT caller')
      return { rows, error: null as null | { code?: string; message: string } }
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT caller')
      const err = e as { code?: string; message: string }
      return { rows: [], error: { code: err.code, message: err.message } }
    } finally {
      await db.query('RESET ROLE')
    }
  }

  const createTask = (assignee: string | null, subtasks: unknown[] = []) =>
    asUser(`SELECT public.create_task_with_subtasks('T', NULL, 'medium', NULL, $1, NULL, $2::jsonb) AS tree`, [assignee, JSON.stringify(subtasks)])

  async function taskCount(): Promise<number> {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.tasks WHERE tenant_id = $1`, [TENANT_A])
    return rows[0].n
  }

  it('policies call auth/tenant helpers only as initplans', async () => {
    const { rows } = await db.query(`
      SELECT tablename || '.' || policyname AS policy
        FROM pg_policies
       WHERE schemaname = 'public'
         AND regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
               '\\(\\s*SELECT\\s+(auth\\.(uid|role|jwt)|get_current_tenant_id|get_user_tenant_ids|rls_member_tenant_ids|rls_visible_tenant_ids)\\(\\)', '', 'g')
             ~ '(auth\\.(uid|role|jwt)|get_current_tenant_id|get_user_tenant_ids|rls_member_tenant_ids|rls_visible_tenant_ids)\\(\\)'`)
    expect(rows.map((r) => r.policy)).toEqual([])
  })

  it('workflow_logs INSERT is limited to member tenants (was WITH CHECK (true))', async () => {
    const { rows } = await db.query(`SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflow_logs' AND policyname = 'wl_insert'`)
    expect(rows[0].with_check).toContain('rls_member_tenant_ids')
  })

  it('every SECURITY DEFINER function in public pins search_path', async () => {
    const { rows } = await db.query(`
      SELECT p.oid::regprocedure::text AS fn FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
         AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')`)
    expect(rows.map((r) => r.fn)).toEqual([])
  })

  it('create_task_with_subtasks: self, home-tenant and member assignees allowed', async () => {
    const self = await createTask(null)
    expect(self.error).toBeNull()
    const mate = await createTask(MATE, [{ title: 'sub', assignee_id: USER }])
    expect(mate.error).toBeNull()
    expect(await taskCount()).toBe(3)
  })

  it('create_task_with_subtasks: assignees outside the tenant are rejected', async () => {
    const task = await createTask(OUTSIDER)
    expect(task.error?.code).toBe('42501')
    expect(task.error?.message).toContain('assignee_not_in_tenant')
    const sub = await createTask(null, [{ title: 'sub', assignee_id: OUTSIDER }])
    expect(sub.error?.message).toContain('assignee_not_in_tenant')
    // Inactive membership does not count.
    await db.query(`UPDATE public.user_memberships SET is_active = false WHERE user_id = $1`, [MATE])
    const inactive = await createTask(MATE)
    expect(inactive.error?.message).toContain('assignee_not_in_tenant')
    expect(await taskCount()).toBe(0)
  })
})
