/**
 * Task analytics summary against the real schema and RLS (migration
 * 20270131100000_report_task_summary, applied inside this test's transaction
 * and rolled back). Workspace A holds 1,500 top-level tasks, more than
 * PostgREST max_rows (1,000) that used to cut the report's lists; workspace B
 * holds tasks too. User `a` reads reports.tasks through a pg-query client
 * bound to their identity (maxRows 1000, as the dashboard): the summary must
 * equal summarizeTasks over ALL of A's tasks and never count B's.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/report-task-summary-db.test.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, type Pool } from 'pg'
import { createPgQuery } from '@user-tasks/pg-query'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'
import { summarizeTasks } from '@/lib/reports/task-summary'
import { collapseEffortRecords } from '@/lib/services/ui-reads/reports'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270131100000_report_task_summary.sql'), 'utf8')

function uid(key: string): string {
  const h = createHash('md5').update(`task-summary-db:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const TENANT = { A: uid('tenant:A'), B: uid('tenant:B') }
const USER = { A: uid('user:a'), B: uid('user:b') }

/** One connection inside the test's transaction; pg-query's BEGIN/COMMIT become a savepoint. */
function savepointPool(client: Client): Pool {
  let chain: Promise<unknown> = Promise.resolve()
  let statements: Promise<unknown> = Promise.resolve()
  const query = (text: any, values?: any) => {
    const next = statements.then(() => client.query(text, values))
    statements = next.catch(() => {})
    return next
  }
  return {
    query,
    async connect() {
      let release!: () => void
      const turn = chain.then(() => undefined)
      chain = turn.then(() => new Promise<void>((r) => { release = r }))
      await turn
      return {
        query(text: any, values?: any) {
          if (typeof text === 'string' && /^BEGIN\b/.test(text)) return query('SAVEPOINT pgq')
          if (text === 'COMMIT' || text === 'ROLLBACK') return query('ROLLBACK TO SAVEPOINT pgq; RELEASE SAVEPOINT pgq')
          return query(text, values)
        },
        release: () => release(),
      }
    },
  } as unknown as Pool
}

describe.skipIf(!DB_URL)('task analytics summary (local DB, RLS, beyond max_rows)', () => {
  const db = new Client({ connectionString: DB_URL })
  let ctx: ServiceContext

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(MIGRATION)
    for (const k of ['A', 'B'] as const) {
      await db.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)', [TENANT[k], `sum ${k}`, `task-summary-db-${k.toLowerCase()}`])
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [USER[k], `sum-${k.toLowerCase()}@iso.test`])
      await db.query('DELETE FROM public.user_memberships WHERE user_id = $1', [USER[k]])
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [USER[k], TENANT[k]])
      await db.query('INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home) VALUES ($1, $2, $3, true)', [USER[k], TENANT[k], 'owner'])
    }
    // 1,500 top-level tasks in A (varied status, priority, age, due dates), 40 subtasks, 2 deleted; 300 in B.
    const seed = (tenant: string, user: string, n: number) => db.query(`
      INSERT INTO public.tasks (tenant_id, title, status, priority, assignee_id, created_at, completed_at, due_date)
      SELECT $1, 'sum ' || g,
        (array['todo','in_progress','blocked','completed','completed','cancelled'])[1 + g % 6]::task_status,
        (array['critical','high','medium','low','none'])[1 + g % 5]::task_priority,
        CASE WHEN g % 4 = 0 THEN NULL ELSE $2::uuid END,
        now() - ((g % 200) || ' days')::interval - ((g % 13) || ' hours')::interval,
        CASE WHEN g % 6 IN (3, 4) THEN now() - ((g % 100) || ' days')::interval + ((g % 7) || ' hours')::interval END,
        CASE WHEN g % 3 = 0 THEN now() - ((g % 30) || ' days')::interval - interval '1 hour' END
      FROM generate_series(1, $3::int) g`, [tenant, user, n])
    await seed(TENANT.A, USER.A, 1500)
    await seed(TENANT.B, USER.B, 300)
    const parent = (await db.query(`SELECT id FROM public.tasks WHERE tenant_id = $1 LIMIT 1`, [TENANT.A])).rows[0].id
    await db.query(`INSERT INTO public.tasks (tenant_id, parent_task_id, title, status, due_date, completed_at)
      SELECT $1, $2, 'sub ' || g, (array['todo','completed'])[1 + g % 2]::task_status, now() - interval '5 days', CASE WHEN g % 2 = 1 THEN now() - interval '2 days' END
      FROM generate_series(1, 40) g`, [TENANT.A, parent])
    // Effort: 1,200 tasks of A with records (estimate, actual / timer, some with only one side), 50 in B.
    const effort = (tenant: string, user: string, n: number) => db.query(`
      INSERT INTO public.effort_records (tenant_id, task_id, user_id, record_type, minutes)
      SELECT t.tenant_id, t.id, $2, r.kind::effort_record_type, 10 + (row_number() over ()) % 50
      FROM (SELECT id, tenant_id, row_number() over (order by title) rn FROM public.tasks WHERE tenant_id = $1 LIMIT $3) t
      CROSS JOIN LATERAL (VALUES ('assigner_estimate'), ('actual'), ('timer_entry'), ('assignee_estimate')) r(kind)
      WHERE NOT (t.rn % 7 = 0 AND r.kind = 'assigner_estimate') AND NOT (t.rn % 5 = 0 AND r.kind IN ('actual', 'timer_entry'))`, [tenant, user, n])
    await effort(TENANT.A, USER.A, 1200)
    await effort(TENANT.B, USER.B, 50)
    await db.query(`UPDATE public.tasks SET deleted_at = now() WHERE id IN (SELECT id FROM public.tasks WHERE tenant_id = $1 AND parent_task_id IS NULL ORDER BY title LIMIT 2)`, [TENANT.A])

    const pgq = createPgQuery({ pool: savepointPool(db), maxRows: 1000 })
    const client = pgq.client({ role: 'authenticated', claims: { sub: USER.A, role: 'authenticated', aud: 'authenticated' } })
    ctx = { db: client as any, supabase: client as any, tenantId: TENANT.A, actorId: USER.A, permissions: null, authKind: 'session', source: 'ui' }
  }, 120_000)

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  const expected = async (since: Date | null, now: Date) => {
    const q = async (sql: string, args: unknown[] = []) => (await db.query(sql, [TENANT.A, ...args])).rows
    const topLevel = await q(`SELECT status::text, priority::text, assignee_id, created_at::text AS created_at, completed_at::text AS completed_at FROM public.tasks WHERE tenant_id = $1 AND deleted_at IS NULL AND parent_task_id IS NULL`)
    const completedRecent = await q(`SELECT completed_at::text AS completed_at FROM public.tasks WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'completed' AND completed_at >= $2::timestamptz - interval '84 days'`, [now.toISOString()])
    const overdue = await q(`SELECT due_date::text AS due_date FROM public.tasks WHERE tenant_id = $1 AND deleted_at IS NULL AND status IN ('todo','in_progress','blocked') AND due_date < $2`, [now.toISOString()])
    return summarizeTasks({ topLevel, completedRecent, overdue }, since, now)
  }

  for (const days of [0, 30]) {
    it(`counts every task of the workspace (not the first 1,000) and none of another's — ${days ? `${days} days` : 'all time'}`, async () => {
      const since = days ? new Date(Date.now() - days * 86_400_000) : null
      const res = await runUiRead(ctx, { name: 'reports.tasks', args: { since: since?.toISOString() ?? null } })
      if (!res.ok) throw new Error(JSON.stringify(res))
      const summary = (res.data as any).summary
      const want = await expected(since, new Date())
      if (!days) expect(summary.total).toBe(1498)
      expect({ ...summary, avg_completion_ms: null }).toEqual({ ...want, avg_completion_ms: null })
      expect(summary.avg_completion_ms).toBeCloseTo(want.avg_completion_ms!, -3)
    })
  }

  it('effort scatter: every task\'s estimated vs actual minutes (from 4,000+ records, not the first 1,000), this workspace only', async () => {
    const res = await runUiRead(ctx, { name: 'reports.tasks', args: {} })
    if (!res.ok) throw new Error(JSON.stringify(res))
    const got = (res.data as any).effortRecords as Array<{ task_id: string; minutes: number; record_type: string }>
    const { rows } = await db.query(`SELECT task_id::text, minutes, record_type::text FROM public.effort_records WHERE tenant_id = $1`, [TENANT.A])
    const want = collapseEffortRecords(rows as any)
    const key = (r: any) => `${r.task_id}:${r.record_type}`
    expect(got.length).toBeGreaterThan(1000)
    expect([...got].sort((a, b) => key(a).localeCompare(key(b)))).toEqual([...want].sort((a, b) => key(a).localeCompare(key(b))))
  })

  it('gives anon no EXECUTE', async () => {
    const { rows } = await db.query(`SELECT has_function_privilege('anon', 'public.report_task_summary(timestamptz, timestamptz)', 'EXECUTE') AS anon`)
    expect(rows[0].anon).toBe(false)
  })
})
