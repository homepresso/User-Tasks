/**
 * Migration 20270130121500_security_membership_and_definer_fixes against the
 * real schema and RLS:
 *  - a member deactivated in their HOME workspace (SSO / directory users are
 *    provisioned straight into the organisation) loses tenant RLS access:
 *    get_current_tenant_id() / get_user_tenant_ids() no longer return it;
 *    legacy accounts with no membership row for their home are unchanged;
 *  - add_task_dependency refuses anon (no EXECUTE) and callers without a
 *    workspace (the NULL comparison used to wave them through).
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/security-membership-db.test.ts
 * Everything runs in one transaction that is rolled back (the migration too).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270130121500_security_membership_and_definer_fixes.sql'), 'utf8')

function uid(key: string): string {
  const h = createHash('md5').update(`qa-sec-membership:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const A = uid('tenant:A')
const B = uid('tenant:B')
const USERS = {
  active: { home: A, membership: true as boolean | null },
  deactivated: { home: A, membership: false as boolean | null },
  legacy: { home: A, membership: null as boolean | null },
  other: { home: B, membership: true as boolean | null },
}
type UserKey = keyof typeof USERS
const U = Object.fromEntries(Object.keys(USERS).map((k) => [k, uid(`user:${k}`)])) as Record<UserKey, string>
const GHOST = uid('user:ghost')
const T1 = uid('task:1')
const T2 = uid('task:2')

describe.skipIf(!DB_URL)('membership deactivation + add_task_dependency (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  async function as(sub: string | null, fn: () => Promise<void>) {
    await db.query('SAVEPOINT as_user')
    try {
      await db.query(`SET LOCAL ROLE ${sub ? 'authenticated' : 'anon'}`)
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role: 'authenticated' } : { role: 'anon' })])
      await fn()
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT as_user')
      await db.query('RESET ROLE')
    }
  }
  async function code(sql: string, params: unknown[] = []): Promise<string> {
    await db.query('SAVEPOINT probe')
    try {
      await db.query(sql, params)
      return 'ok'
    } catch (e) {
      return (e as { code?: string; message?: string }).code === 'P0001' ? (e as Error).message : String((e as { code?: string }).code)
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT probe')
    }
  }

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(MIGRATION)
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'qa-sec A', 'qa-sec-membership-a'), ($2, 'qa-sec B', 'qa-sec-membership-b')`, [A, B])
    for (const u of [...Object.values(U), GHOST]) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [u, `${u}@qa-sec.test`])
    }
    await db.query('DELETE FROM public.user_memberships WHERE user_id = ANY($1)', [[...Object.values(U), GHOST]])
    await db.query('DELETE FROM public.users WHERE id = $1', [GHOST])
    for (const [k, user] of Object.entries(USERS) as Array<[UserKey, (typeof USERS)[UserKey]]>) {
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [U[k], user.home])
      if (user.membership !== null) {
        await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role, is_active) VALUES ($1, $2, 'member', $3)`, [U[k], user.home, user.membership])
      }
    }
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title) VALUES ($1, $3, 'qa-sec t1'), ($2, $3, 'qa-sec t2')`, [T1, T2, A])
    // 20270130140000 revokes end-user writes on tasks altogether (refused
    // before RLS is consulted). These tests are about the RLS tenant
    // predicate, so give the grant back inside this rolled-back transaction
    // to keep exercising the UPDATE / DELETE / INSERT policies themselves.
    await db.query('GRANT INSERT, UPDATE, DELETE ON public.tasks TO authenticated')
  }, 60_000)

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  it('a member deactivated in their home workspace loses tenant RLS access', async () => {
    await as(U.deactivated, async () => {
      const { rows: [r] } = await db.query('SELECT public.get_current_tenant_id() AS cur, ARRAY(SELECT public.get_user_tenant_ids()) AS ids')
      expect(r.cur).toBeNull()
      expect(r.ids).not.toContain(A)
      expect((await db.query('SELECT id FROM public.tasks WHERE id = ANY($1)', [[T1, T2]])).rowCount).toBe(0)
      expect((await db.query(`UPDATE public.tasks SET title = 'x' WHERE id = $1`, [T1])).rowCount).toBe(0)
      expect((await db.query('DELETE FROM public.tasks WHERE id = $1', [T1])).rowCount).toBe(0)
      expect(await code(`INSERT INTO public.tasks (tenant_id, title) VALUES ($1, 'x')`, [A])).toBe('42501')
    })
  })

  it('active members and legacy home users (no membership row) keep access; other tenants see nothing', async () => {
    for (const k of ['active', 'legacy'] as const) {
      await as(U[k], async () => {
        const { rows: [r] } = await db.query('SELECT public.get_current_tenant_id() AS cur')
        expect(r.cur).toBe(A)
        expect((await db.query('SELECT id FROM public.tasks WHERE id = ANY($1)', [[T1, T2]])).rowCount).toBe(2)
        expect((await db.query(`UPDATE public.tasks SET title = 'x' WHERE id = $1`, [T1])).rowCount).toBe(1)
      })
    }
    await as(U.other, async () => {
      expect((await db.query('SELECT id FROM public.tasks WHERE id = ANY($1)', [[T1, T2]])).rowCount).toBe(0)
    })
  })

  it('add_task_dependency refuses anon, callers without a workspace and other tenants', async () => {
    await as(null, async () => {
      expect(await code('SELECT public.add_task_dependency($1, $2)', [T1, T2])).toBe('42501')
    })
    await as(GHOST, async () => {
      expect(await code('SELECT public.add_task_dependency($1, $2)', [T1, T2])).toBe('task_not_found')
    })
    await as(U.other, async () => {
      expect(await code('SELECT public.add_task_dependency($1, $2)', [T1, T2])).toBe('task_not_found')
    })
    await as(U.deactivated, async () => {
      expect(await code('SELECT public.add_task_dependency($1, $2)', [T1, T2])).toBe('task_not_found')
    })
    await as(U.active, async () => {
      expect(await code('SELECT public.add_task_dependency($1, $2)', [T1, T2])).toBe('ok')
    })
  })

  it('signed-in-only definer RPCs are not executable by anon', async () => {
    const { rows } = await db.query(`
      SELECT p.proname FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname = ANY($1) AND has_function_privilege('anon', p.oid, 'EXECUTE')`,
    [['add_task_dependency', 'create_task_with_subtasks', 'get_task_tree', 'check_object_permission', 'get_user_role_in_tenant', 'mark_notifications_read', 'mark_all_notifications_read', 'switch_tenant']])
    expect(rows).toEqual([])
  })
})
