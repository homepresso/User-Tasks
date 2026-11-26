/**
 * The hand-run rollback of 20270130140000_task_tables_service_writes
 * (supabase/rollback/20270130140000_task_tables_service_writes.down.sql)
 * against the real schema: inside one rolled-back transaction it applies
 * 140000, then the down script (twice: idempotent), and checks that the
 * grants and the notifications_insert policy are back to their pre-140000
 * state (baseline GRANT ALL for anon and authenticated, no column-level
 * grants, the 20261027000000_rls_initplan policy), and that
 * request_actor_id() and the trigger bodies are left in place.
 * The full caller × table semantics are compared with the pre-140000 RLS
 * snapshot by rls-semantics-db (RLS_SEMANTICS_PRE_SQL, see docs/migrations.md).
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g. against the local stack
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/task-tables-rollback-db.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const UP = readFileSync(join(process.cwd(), 'supabase/migrations/20270130140000_task_tables_service_writes.sql'), 'utf8')
const DOWN = readFileSync(join(process.cwd(), 'supabase/rollback/20270130140000_task_tables_service_writes.down.sql'), 'utf8')
const TASK_TABLES = ['tasks', 'task_assignees', 'task_dependencies', 'task_reminders', 'task_escalations']
const TABLES = [...TASK_TABLES, 'notifications']

describe.skipIf(!DB_URL)('rollback of 20270130140000 (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  /** The role's privilege letters in the table's ACL ('' when it has none). */
  async function acl(table: string, role: string): Promise<string> {
    const { rows } = await db.query(
      `SELECT coalesce((SELECT split_part(split_part(a, '=', 2), '/', 1)
                          FROM unnest(relacl::text[]) a WHERE a LIKE $2 || '=%'), '') AS p
         FROM pg_class WHERE oid = ('public.' || $1)::regclass`,
      [table, role],
    )
    return rows[0].p
  }
  async function columnGrants(table: string): Promise<number> {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = ('public.' || $1)::regclass AND attnum > 0 AND attacl IS NOT NULL`,
      [table],
    )
    return rows[0].n
  }

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(`SET LOCAL lock_timeout = '15s'`)
    await db.query(UP)
  }, 60_000)

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  it('140000 applied: end users hold no write grant, no notifications_insert policy', async () => {
    for (const r of ['anon', 'authenticated']) {
      for (const t of TASK_TABLES) expect(await acl(t, r), `${r} ${t}`).toBe('rxtm')
      expect(await acl('notifications', r), r).toBe('rwdxtm')
    }
    const { rowCount } = await db.query(`SELECT 1 FROM pg_policy WHERE polrelid = 'public.notifications'::regclass AND polname = 'notifications_insert'`)
    expect(rowCount).toBe(0)
  })

  it('the down script restores the baseline grants and the original policy, idempotently', async () => {
    await db.query(DOWN)
    await db.query(DOWN)
    // Baseline: GRANT ALL ON TABLE … TO anon, authenticated (as tag_definitions still has).
    expect(await acl('tag_definitions', 'authenticated')).toBe('arwdDxtm')
    expect(await acl('tag_definitions', 'anon')).toBe('arwdDxtm')
    for (const t of TABLES) {
      expect(await acl(t, 'authenticated'), t).toBe('arwdDxtm')
      expect(await columnGrants(t), t).toBe(0)
      // anon gets its baseline grants back too (RLS still refuses its writes).
      expect(await acl(t, 'anon'), t).toBe('arwdDxtm')
    }
    const { rows } = await db.query(
      `SELECT polcmd, polpermissive, polroles::oid[] AS roles, pg_get_expr(polwithcheck, polrelid) AS check
         FROM pg_policy WHERE polrelid = 'public.notifications'::regclass AND polname = 'notifications_insert'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ polcmd: 'a', polpermissive: true, roles: [0] })
    expect(rows[0].check).toBe('((( SELECT auth.uid() AS uid) IS NOT NULL) AND (tenant_id = ( SELECT get_current_tenant_id() AS get_current_tenant_id)))')
  })

  it('request_actor_id() and the trigger bodies stay', async () => {
    const { rows } = await db.query(
      `SELECT to_regprocedure('public.request_actor_id()') IS NOT NULL AS fn,
              position('request_actor_id' IN pg_get_functiondef('public.fn_log_lifecycle_event()'::regprocedure)) > 0 AS lifecycle,
              position('request_actor_id' IN pg_get_functiondef('public.fn_notify_on_task_change()'::regprocedure)) > 0 AS notify`,
    )
    expect(rows[0]).toEqual({ fn: true, lifecycle: true, notify: true })
  })

  it('authenticated holds INSERT / UPDATE / DELETE on the task tables again (the old code path)', async () => {
    for (const t of TASK_TABLES) {
      const { rows: [p] } = await db.query(
        `SELECT has_table_privilege('authenticated', 'public.' || $1, 'INSERT') AS i,
                has_table_privilege('authenticated', 'public.' || $1, 'UPDATE') AS u,
                has_table_privilege('authenticated', 'public.' || $1, 'DELETE') AS d`,
        [t],
      )
      expect(p, t).toEqual({ i: true, u: true, d: true })
    }
  })
})
