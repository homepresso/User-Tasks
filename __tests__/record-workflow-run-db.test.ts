/**
 * SQL-level checks for supabase/migrations/20261025000000_record_workflow_run.sql:
 * record_workflow_run increments run_count atomically and is service_role only.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/record-workflow-run-db.test.ts
 * Every test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { dbCapabilities, setRoleSql } from './helpers/db-capabilities'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()

const TENANT = '0f000000-0000-4000-8000-00000000000a'
const WF = '0f000000-0000-4000-8000-0000000000a1'

describe.skipIf(!DB_URL)('record_workflow_run (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  beforeAll(async () => { await db.connect() })
  afterAll(async () => { await db.end() })

  beforeEach(async () => {
    await db.query('BEGIN')
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Run stats', 'run-stats')`, [TENANT])
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, run_count)
       VALUES ($1, $2, 'Stats', true, 'manual', 41)`,
      [WF, TENANT],
    )
  })
  afterEach(async () => { await db.query('ROLLBACK') })

  it('increments run_count and stamps last_run_at for service_role', async () => {
    await db.query('SAVEPOINT s')
    await db.query(setRoleSql('service_role', CAPS))
    await db.query('SELECT public.record_workflow_run($1)', [WF])
    await db.query('SELECT public.record_workflow_run($1)', [WF])
    await db.query('RESET ROLE')
    const { rows } = await db.query('SELECT run_count, last_run_at FROM public.workflows WHERE id = $1', [WF])
    expect(rows[0].run_count).toBe(43)
    expect(rows[0].last_run_at).not.toBeNull()
  })

  it('is not executable by anon or authenticated', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.query('SAVEPOINT s')
      await db.query(setRoleSql(role, CAPS))
      await expect(db.query('SELECT public.record_workflow_run($1)', [WF]), role).rejects.toThrow(/permission denied/)
      await db.query('ROLLBACK TO SAVEPOINT s')
    }
    const { rows } = await db.query('SELECT run_count FROM public.workflows WHERE id = $1', [WF])
    expect(rows[0].run_count).toBe(41)
  })
})
