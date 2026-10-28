/**
 * pg-query conformance: every case runs through the local Supabase stack's
 * real PostgREST and through pg-query with the same role and JWT claims, and
 * the full postgrest-js result ({ data, error, count, status, statusText})
 * plus, for writes, the resulting rows must be identical.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run packages/pg-query/test/conformance
 * Fixture rows are committed (PostgREST uses its own connections) and removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { DB_URL, runBoth, setup, teardown, type Case, type Sides, type Who } from './harness'
import { READ_CASES } from './corpus-read'
import { RPC_CASES } from './corpus-rpc'
import { WRITE_CASES } from './corpus-write'

const DEFAULT_AS: Who[] = ['service', 'alice']

function expand(cases: Case[]) {
  return cases.flatMap((c) => (c.as ?? DEFAULT_AS).map((who) => [`${c.name} [${who}]`, c, who] as const))
}

/** PostgREST (the reference side) only fronts a Supabase database; plain Postgres skips. */
async function servedByPostgrest(url: string | undefined): Promise<boolean> {
  if (!url) return false
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  try {
    const { rows } = await db.query(`SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin'`)
    return rows.length > 0
  } finally {
    await db.end()
  }
}
const HAS_POSTGREST = await servedByPostgrest(DB_URL)

describe.skipIf(!HAS_POSTGREST)('pg-query conformance with PostgREST (local stack)', () => {
  let s: Sides
  beforeAll(async () => {
    s = await setup()
  }, 60_000)
  afterAll(async () => {
    await teardown(s)
  })

  it('has a representative corpus', () => {
    const queries = READ_CASES.length + RPC_CASES.length + WRITE_CASES.length
    expect(queries).toBeGreaterThanOrEqual(150)
  })

  for (const [group, cases] of [['read', READ_CASES], ['rpc', RPC_CASES], ['write', WRITE_CASES]] as const) {
    describe(group, () => {
      for (const [name, c, who] of expand(cases)) {
        it(name, async () => {
          const r = await runBoth(s, c, who)
          expect(r.pgq).toEqual(r.rest)
          if (c.after) expect(r.pgqAfter).toEqual(r.restAfter)
        })
      }
    })
  }
})
