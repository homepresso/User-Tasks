/**
 * Migration 20270130140000_task_tables_service_writes against the real
 * schema: end users (any workspace member, anon) can no longer write the task
 * tables or insert notifications through PostgREST; the service role can,
 * and a service-role write that names its user in x-usertasks-actor is
 * attributed to that user by the tasks triggers (never a header from anyone
 * else). Notifications stay readable / updatable / deletable by their owner.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/task-tables-service-writes-db.test.ts
 * Everything runs in one transaction that is rolled back (the migration too).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270130140000_task_tables_service_writes.sql'), 'utf8')

function uid(key: string): string {
  const h = createHash('md5').update(`qa-sec-task-writes:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const A = uid('tenant:A')
const MEMBER = uid('user:member')
const BOSS = uid('user:boss')
const TASK = uid('task:1')
const TASK2 = uid('task:2')
const NOTE = uid('note:1')

describe.skipIf(!DB_URL)('task tables: service-role writes only (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  type Who = { role: 'anon' | 'authenticated' | 'service_role'; sub?: string; actorHeader?: string }
  async function as<T>(who: Who, fn: () => Promise<T>): Promise<T> {
    await db.query('SAVEPOINT as_user')
    try {
      await db.query(`SET LOCAL ROLE ${who.role}`)
      await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`, [
        JSON.stringify({ role: who.role, ...(who.sub ? { sub: who.sub } : {}) }),
        JSON.stringify(who.actorHeader ? { 'x-usertasks-actor': who.actorHeader } : {}),
      ])
      return await fn()
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT as_user')
      await db.query('RESET ROLE')
    }
  }
  async function code(sql: string, params: unknown[] = []): Promise<string> {
    await db.query('SAVEPOINT probe')
    try {
      const res = await db.query(sql, params)
      return `ok:${res.rowCount}`
    } catch (e) {
      return String((e as { code?: string }).code)
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT probe')
    }
  }

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(MIGRATION)
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'qa-sec writes', 'qa-sec-task-writes')`, [A])
    for (const u of [MEMBER, BOSS]) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [u, `${u}@qa-sec.test`])
    }
    await db.query('DELETE FROM public.user_memberships WHERE user_id = ANY($1)', [[MEMBER, BOSS]])
    await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = ANY($1)', [[MEMBER, BOSS], A])
    for (const u of [MEMBER, BOSS]) await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role, is_active) VALUES ($1, $2, 'member', true)`, [u, A])
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title, assignee_id, assigner_id) VALUES ($1, $3, 'approve budget', $4, $4), ($2, $3, 'other', $4, $4)`, [TASK, TASK2, A, BOSS])
    await db.query(`INSERT INTO public.notifications (id, user_id, tenant_id, type, title) VALUES ($1, $2, $3, 'task_assigned', 'hi')`, [NOTE, MEMBER, A])
  }, 60_000)

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  it('a member can read their workspace tasks but not write any task table', async () => {
    await as({ role: 'authenticated', sub: MEMBER }, async () => {
      expect((await db.query('SELECT id FROM public.tasks WHERE id = $1', [TASK])).rowCount).toBe(1)
      expect(await code('UPDATE public.tasks SET assignee_id = $2 WHERE id = $1', [TASK, MEMBER])).toBe('42501')
      expect(await code('DELETE FROM public.tasks WHERE id = $1', [TASK])).toBe('42501')
      expect(await code(`INSERT INTO public.tasks (tenant_id, title) VALUES ($1, 'x')`, [A])).toBe('42501')
      expect(await code(`INSERT INTO public.task_assignees (tenant_id, task_id, user_id, role) VALUES ($1, $2, $3, 'collaborator')`, [A, TASK, MEMBER])).toBe('42501')
      expect(await code('INSERT INTO public.task_dependencies (tenant_id, task_id, depends_on_task_id) VALUES ($1, $2, $3)', [A, TASK, TASK2])).toBe('42501')
      expect(await code(`INSERT INTO public.task_reminders (tenant_id, task_id, offset_minutes) VALUES ($1, $2, 5)`, [A, TASK])).toBe('42501')
      expect(await code(`INSERT INTO public.task_escalations (tenant_id, task_id) VALUES ($1, $2)`, [A, TASK])).toBe('42501')
    })
    await as({ role: 'anon' }, async () => {
      expect(await code('UPDATE public.tasks SET title = title WHERE id = $1', [TASK])).toBe('42501')
    })
  })

  it('notifications: no inserts by end users; owners still mark read and dismiss', async () => {
    await as({ role: 'authenticated', sub: MEMBER }, async () => {
      expect(await code(`INSERT INTO public.notifications (user_id, tenant_id, type, title) VALUES ($1, $2, 'task_assigned', 'phish')`, [BOSS, A])).toBe('42501')
      expect(await code('UPDATE public.notifications SET is_read = true WHERE id = $1', [NOTE])).toBe('ok:1')
      expect(await code('DELETE FROM public.notifications WHERE id = $1', [NOTE])).toBe('ok:1')
    })
  })

  it('a service-role write naming its user is attributed to that user by the triggers', async () => {
    await as({ role: 'service_role', actorHeader: MEMBER }, async () => {
      await db.query(`UPDATE public.tasks SET status = 'in_progress', assignee_id = $2 WHERE id = $1`, [TASK, MEMBER])
      const { rows } = await db.query(`SELECT event_type::text, actor_id FROM public.lifecycle_events WHERE task_id = $1 ORDER BY created_at`, [TASK])
      expect(rows.map((r) => [r.event_type, r.actor_id])).toEqual(expect.arrayContaining([['started', MEMBER], ['reassigned', MEMBER]]))
      // Assigned to themselves: no "assigned to you" notification.
      expect((await db.query(`SELECT 1 FROM public.notifications WHERE task_id = $1 AND user_id = $2 AND type = 'task_assigned'`, [TASK, MEMBER])).rowCount).toBe(0)
    })
    // Without the header (workflow engine, jobs) the actor stays empty, as before.
    await as({ role: 'service_role' }, async () => {
      await db.query(`UPDATE public.tasks SET status = 'in_progress' WHERE id = $1`, [TASK2])
      const { rows } = await db.query(`SELECT actor_id FROM public.lifecycle_events WHERE task_id = $1 AND event_type = 'started'`, [TASK2])
      expect(rows[0]?.actor_id ?? null).toBeNull()
    })
  })

  it('the actor header is trusted only from the service role', async () => {
    await as({ role: 'authenticated', sub: MEMBER, actorHeader: BOSS }, async () => {
      // request_actor_id is not executable by end users; through a trigger it would read auth.uid().
      expect(await code('SELECT public.request_actor_id()')).toBe('42501')
    })
    await db.query('SAVEPOINT direct')
    await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`, [JSON.stringify({ role: 'authenticated', sub: MEMBER }), JSON.stringify({ 'x-usertasks-actor': BOSS })])
    expect((await db.query('SELECT public.request_actor_id() AS a')).rows[0].a).toBe(MEMBER)
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })])
    expect((await db.query('SELECT public.request_actor_id() AS a')).rows[0].a).toBeNull()
    await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`, [JSON.stringify({ role: 'service_role' }), JSON.stringify({ 'x-usertasks-actor': 'not-a-uuid' })])
    expect((await db.query('SELECT public.request_actor_id() AS a')).rows[0].a).toBeNull()
    await db.query('ROLLBACK TO SAVEPOINT direct')
  })
})
