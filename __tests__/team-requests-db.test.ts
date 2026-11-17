/**
 * public.team_requests / team_request_events (migration
 * 20270116120000_team_requests.sql) are service role only: anon and
 * authenticated callers can't read, insert, update or delete a row (42501:
 * no grants at all), while the service role can.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/team-requests-db.test.ts
 * The migration is applied inside one transaction that is rolled back, so
 * the database is left as it was.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const MIGRATION = readFileSync('supabase/migrations/20270116120000_team_requests.sql', 'utf8')
const ROW = '33333333-3333-4333-8333-333333333333'

describe.skipIf(!DB_URL)('team_requests access (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(MIGRATION)
    await db.query(`INSERT INTO public.team_requests (id, kind, title, email) VALUES ($1, 'contact', 'Hello', 'jordan@northwind.example')`, [ROW])
    await db.query(`INSERT INTO public.team_request_events (request_id, to_status) VALUES ($1, 'handled')`, [ROW])
  })

  afterAll(async () => {
    await db.query('ROLLBACK')
    await db.end()
  })

  async function as(role: 'anon' | 'authenticated' | 'service_role', sql: string, params: unknown[] = []): Promise<string> {
    await db.query('SAVEPOINT probe')
    try {
      await db.query(`SET LOCAL ROLE ${role}`)
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role, sub: role === 'authenticated' ? '44444444-4444-4444-8444-444444444444' : undefined })])
      const res = await db.query(sql, params)
      return `ok:${res.rowCount}`
    } catch (e) {
      return `err:${(e as { code?: string }).code}`
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT probe')
    }
  }

  it('RLS is on and anon / authenticated have no grants', async () => {
    const { rows } = await db.query(`
      SELECT c.relname, c.relrowsecurity,
             has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
             has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authed,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
        FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('team_requests', 'team_request_events') ORDER BY 1`)
    expect(rows).toEqual([
      { relname: 'team_request_events', relrowsecurity: true, anon: false, authed: false, policies: '0' },
      { relname: 'team_requests', relrowsecurity: true, anon: false, authed: false, policies: '0' },
    ])
  })

  for (const role of ['anon', 'authenticated'] as const) {
    it(`${role} is denied every statement`, async () => {
      expect(await as(role, 'SELECT * FROM public.team_requests')).toBe('err:42501')
      expect(await as(role, `INSERT INTO public.team_requests (kind, title) VALUES ('contact', 'x')`)).toBe('err:42501')
      expect(await as(role, `UPDATE public.team_requests SET status = 'spam' WHERE id = $1`, [ROW])).toBe('err:42501')
      expect(await as(role, 'DELETE FROM public.team_requests WHERE id = $1', [ROW])).toBe('err:42501')
      expect(await as(role, 'SELECT * FROM public.team_request_events')).toBe('err:42501')
      expect(await as(role, `INSERT INTO public.team_request_events (request_id) VALUES ($1)`, [ROW])).toBe('err:42501')
    })
  }

  it('the service role reads and writes', async () => {
    expect(await as('service_role', 'SELECT * FROM public.team_requests WHERE id = $1', [ROW])).toBe('ok:1')
    expect(await as('service_role', `UPDATE public.team_requests SET status = 'handled' WHERE id = $1`, [ROW])).toBe('ok:1')
    expect(await as('service_role', `INSERT INTO public.team_request_events (request_id, to_status) VALUES ($1, 'new')`, [ROW])).toBe('ok:1')
  })

  it('constraints: kind and status are checked', async () => {
    expect(await as('service_role', `INSERT INTO public.team_requests (kind, title) VALUES ('sales', 'x')`)).toBe('err:23514')
    expect(await as('service_role', `UPDATE public.team_requests SET status = 'closed' WHERE id = $1`, [ROW])).toBe('err:23514')
  })
})
