/**
 * Audit trail integrity against a LOCAL Supabase stack (migration
 * 20270130090000_audit_actor_integrity): a signed-in member can still append
 * to object_audit_log / permission_audit_log / lifecycle_events (the app
 * writes them with the caller's session), but cannot put another person's
 * id in actor_id, and cannot update, delete or truncate the history. The
 * service role keeps writing whatever actor it is given (workers,
 * instance-admin on-behalf actions).
 *
 * End users are simulated the way PostgREST does it (SET ROLE +
 * request.jwt.claims); everything runs in one transaction that is rolled back.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/audit-actor-integrity-db.test.ts
 */
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { dbCapabilities, setRoleSql } from './helpers/db-capabilities'

const DB_URL = process.env.EVENT_STREAM_DB_URL
// service_role without BYPASSRLS (managed PostgreSQL): the app runs it as the schema owner.
const caps = await dbCapabilities()
const uid = (key: string) => {
  const h = createHash('md5').update(`audit-actor-integrity:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const T = uid('tenant')
const OWNER = uid('user:owner')
const VIEWER = uid('user:viewer')
const TASK = uid('task')

describe.skipIf(!DB_URL)('audit trail integrity (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })

  const as = async <R>(sub: string, fn: () => Promise<R>): Promise<R> => {
    await db.query('SAVEPOINT caller')
    await db.query('SET LOCAL ROLE authenticated')
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aud: 'authenticated' })])
    try { return await fn() } finally { await db.query('ROLLBACK TO SAVEPOINT caller') }
  }
  const denied = async (sql: string, params: unknown[] = []) => {
    await db.query('SAVEPOINT stmt')
    try {
      await db.query(sql, params)
      await db.query('RELEASE SAVEPOINT stmt')
      return false
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT stmt')
      return /permission denied/.test((e as Error).message)
    }
  }

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'aai', 'aai-${T.slice(0, 8)}')`, [T])
    for (const u of [OWNER, VIEWER]) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [u, `${u}@aai.test`])
      await db.query('DELETE FROM public.user_memberships WHERE user_id = $1', [u])
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [u, T])
      await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role, is_active) VALUES ($1, $2, 'member', true)`, [u, T])
    }
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title) VALUES ($1, $2, 'aai task')`, [TASK, T])
  })

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => undefined)
    await db.end()
  })

  it('object_audit_log: a member writing in the owner\'s name gets their own id', async () => {
    const actor = await as(VIEWER, async () => {
      const { rows } = await db.query(
        `INSERT INTO public.object_audit_log (tenant_id, actor_id, object_type, object_id, action, summary)
         VALUES ($1, $2, 'api_key', 'k1', 'delete', 'forged') RETURNING actor_id`, [T, OWNER])
      return rows[0].actor_id
    })
    expect(actor).toBe(VIEWER)
  })

  it('object_audit_log: a null actor from a session becomes the caller', async () => {
    const actor = await as(VIEWER, async () => {
      const { rows } = await db.query(
        `INSERT INTO public.object_audit_log (tenant_id, actor_id, object_type, object_id, action) VALUES ($1, NULL, 'task', 't1', 'update') RETURNING actor_id`, [T])
      return rows[0].actor_id
    })
    expect(actor).toBe(VIEWER)
  })

  it('permission_audit_log and lifecycle_events: same rule', async () => {
    const [perm, life] = await as(VIEWER, async () => {
      const p = await db.query(
        `INSERT INTO public.permission_audit_log (tenant_id, actor_id, action, target_user_id) VALUES ($1, $2, 'role_assigned', $3) RETURNING actor_id`, [T, OWNER, VIEWER])
      const l = await db.query(
        `INSERT INTO public.lifecycle_events (tenant_id, task_id, actor_id, event_type) VALUES ($1, $2, $3, 'created') RETURNING actor_id`, [T, TASK, OWNER])
      return [p.rows[0].actor_id, l.rows[0].actor_id]
    })
    expect(perm).toBe(VIEWER)
    expect(life).toBe(VIEWER)
  })

  it('the service role keeps the actor it is given (workers, on-behalf actions)', async () => {
    await db.query('SAVEPOINT svc')
    await db.query(setRoleSql('service_role', caps))
    const { rows } = await db.query(
      `INSERT INTO public.object_audit_log (tenant_id, actor_id, object_type, object_id, action) VALUES ($1, $2, 'workflow_run', 'r1', 'resume') RETURNING actor_id`, [T, OWNER])
    await db.query('ROLLBACK TO SAVEPOINT svc')
    expect(rows[0].actor_id).toBe(OWNER)
  })

  it('session roles cannot update, delete or truncate the history', async () => {
    await db.query(`INSERT INTO public.object_audit_log (tenant_id, actor_id, object_type, object_id, action) VALUES ($1, $2, 'role', 'r', 'grant')`, [T, OWNER])
    await as(OWNER, async () => {
      for (const table of ['object_audit_log', 'permission_audit_log', 'lifecycle_events']) {
        expect(await denied(`UPDATE public.${table} SET created_at = now() WHERE tenant_id = $1`, [T])).toBe(true)
        expect(await denied(`DELETE FROM public.${table} WHERE tenant_id = $1`, [T])).toBe(true)
        expect(await denied(`TRUNCATE public.${table}`)).toBe(true)
      }
    })
  })
})
