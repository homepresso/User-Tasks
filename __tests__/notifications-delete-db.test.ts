/**
 * RLS checks for supabase/migrations/20261103200000_notification_and_queue_delete.sql:
 * a signed-in user can delete their own notifications in workspaces they are
 * an active member of — not another user's, not in a workspace they left, and
 * never as anon. workflow_queue stays without a DELETE policy (queue jobs are
 * deleted by the deleteQueueJob server action).
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/notifications-delete-db.test.ts
 * Every test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL

const TENANT_A = '0f000000-0000-4000-8000-00000000000a'
const TENANT_B = '0f000000-0000-4000-8000-00000000000b'
const TENANT_C = '0f000000-0000-4000-8000-00000000000c'
const USER = '0f000001-0000-4000-8000-000000000001' // home A, member of B, left C
const OTHER = '0f000002-0000-4000-8000-000000000002' // home A

const N = {
  ownA: '0f000010-0000-4000-8000-0000000000a1',
  ownB: '0f000010-0000-4000-8000-0000000000b1',
  ownC: '0f000010-0000-4000-8000-0000000000c1',
  otherA: '0f000010-0000-4000-8000-0000000000a2',
}

describe.skipIf(!DB_URL)('notifications DELETE policy (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  beforeAll(async () => { await db.connect() })
  afterAll(async () => { await db.end() })

  beforeEach(async () => {
    await db.query('BEGIN')
    await db.query(
      `INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Notif A', 'notif-del-a'), ($2, 'Notif B', 'notif-del-b'), ($3, 'Notif C', 'notif-del-c')`,
      [TENANT_A, TENANT_B, TENANT_C],
    )
    for (const id of [USER, OTHER]) {
      await db.query(
        `INSERT INTO auth.users (id, email, instance_id, aud, role)
         VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [id, `${id}@notif-delete.test`],
      )
      await db.query(`DELETE FROM public.user_memberships WHERE user_id = $1`, [id])
      await db.query(`UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1`, [id, TENANT_A])
    }
    await db.query(
      `INSERT INTO public.user_memberships (user_id, tenant_id, role, is_active) VALUES ($1, $2, 'member', true), ($1, $3, 'member', false)`,
      [USER, TENANT_B, TENANT_C],
    )
    await db.query(
      `INSERT INTO public.notifications (id, user_id, tenant_id, type, title) VALUES
         ($1, $5, $7, 'task_assigned', 'own A'),
         ($2, $5, $8, 'task_assigned', 'own B'),
         ($3, $5, $9, 'task_assigned', 'own C'),
         ($4, $6, $7, 'task_assigned', 'other A')`,
      [N.ownA, N.ownB, N.ownC, N.otherA, USER, OTHER, TENANT_A, TENANT_B, TENANT_C],
    )
  })
  afterEach(async () => { await db.query('ROLLBACK') })

  /** Run `sql` as `sub` (or anon) inside a savepoint; returns rows or the error. */
  async function as(sub: string | null, sql: string, params: unknown[] = []) {
    await db.query('SAVEPOINT caller')
    try {
      await db.query(sub ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role: 'authenticated' } : { role: 'anon' })])
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

  const del = (sub: string | null, id: string) => as(sub, `DELETE FROM public.notifications WHERE id = $1 RETURNING id`, [id])
  async function exists(id: string): Promise<boolean> {
    const { rows } = await db.query(`SELECT 1 FROM public.notifications WHERE id = $1`, [id])
    return rows.length === 1
  }

  it('lets a user delete their own notification in their current workspace', async () => {
    const res = await del(USER, N.ownA)
    expect(res.error).toBeNull()
    expect(res.rows).toEqual([{ id: N.ownA }])
    expect(await exists(N.ownA)).toBe(false)
  })

  it('lets a user delete their own notification in another workspace they are a member of', async () => {
    const res = await del(USER, N.ownB)
    expect(res.rows).toEqual([{ id: N.ownB }])
    expect(await exists(N.ownB)).toBe(false)
  })

  it("does not let a user delete another user's notification, even in the same workspace", async () => {
    const res = await del(USER, N.otherA)
    expect(res.error).toBeNull()
    expect(res.rows).toEqual([])
    expect(await exists(N.otherA)).toBe(true)
  })

  it('does not delete a notification in a workspace the user is no longer a member of', async () => {
    const res = await del(USER, N.ownC)
    expect(res.rows).toEqual([])
    expect(await exists(N.ownC)).toBe(true)
  })

  it('a bulk delete only removes the caller-owned, member-workspace rows', async () => {
    const res = await as(USER, `DELETE FROM public.notifications WHERE id = ANY($1::uuid[]) RETURNING id`, [Object.values(N)])
    expect(res.rows.map((r) => r.id).sort()).toEqual([N.ownA, N.ownB].sort())
    expect(await exists(N.ownC)).toBe(true)
    expect(await exists(N.otherA)).toBe(true)
  })

  it('anon deletes nothing', async () => {
    const res = await as(null, `DELETE FROM public.notifications RETURNING id`)
    expect(res.rows).toEqual([])
    for (const id of Object.values(N)) expect(await exists(id)).toBe(true)
  })

  it('workflow_queue still has no DELETE policy (deletes go through the server action)', async () => {
    const { rows } = await db.query(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflow_queue' AND cmd IN ('DELETE', 'ALL')`,
    )
    expect(rows).toEqual([])
    const { rows: notif } = await db.query(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND cmd = 'DELETE'`,
    )
    expect(notif).toEqual([{ policyname: 'notifications_delete' }])
  })
})
