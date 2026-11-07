/**
 * Custom reference writes against a LOCAL Postgres (a scratch schema that is
 * dropped afterwards — never the app's own tables): dry runs always roll
 * back, the max-affected cap rolls back, real writes commit, upsert uses
 * ON CONFLICT, Execute calls an introspected function.
 *
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/custom-reference-writes-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { normalizeCustomConfig } from '@/lib/custom-references/normalize'
import { runCustomReference } from '@/lib/custom-references/run'
import { executeDatabaseReference } from '@/lib/db-reference'

/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const SCHEMA = `crw_scratch_${process.pid}`

describe.skipIf(!DB_URL)('custom reference writes on local Postgres', () => {
  const db = new Client({ connectionString: DB_URL })
  let integrationConfig: any

  beforeAll(async () => {
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    await db.connect()
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`)
    await db.query(`CREATE TABLE ${SCHEMA}.orders (id integer PRIMARY KEY, status text NOT NULL, note text)`)
    await db.query(`INSERT INTO ${SCHEMA}.orders VALUES (1, 'new', null), (2, 'new', null), (3, 'shipped', null)`)
    await db.query(`CREATE FUNCTION ${SCHEMA}.count_status(p_status text) RETURNS TABLE(n bigint) LANGUAGE sql AS $$ SELECT count(*) FROM ${SCHEMA}.orders WHERE status = p_status $$`)
    const url = new URL(DB_URL!)
    integrationConfig = { db_config: { db_type: 'postgres', host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), username: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl: false } }
  })
  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await db.end()
    const { closeDbPools } = await import('@/lib/db-connector')
    await closeDbPools()
  })

  const source = { type: 'table', schema: SCHEMA, table: 'orders', columns: [{ name: 'id', type: 'integer' }, { name: 'status', type: 'text' }, { name: 'note', type: 'text' }] }
  const statusOf = async (id: number) => (await db.query(`SELECT status FROM ${SCHEMA}.orders WHERE id = $1`, [id])).rows[0]?.status

  /** The executor's database path for a compiled write (what lib/reference-executor does). */
  const runSource = async (sourceRef: any, values: any, extra: any) => {
    const r = await executeDatabaseReference({
      integrationConfig, method: 'POST', pathTemplate: sourceRef.request_config.path_template, bodyTemplate: sourceRef.request_config.body_template,
      inputs: sourceRef.inputs, values, resultShape: 'rows', ...(extra?.dbWrite ? { write: extra.dbWrite } : {}),
    })
    return { status: r.status, data: r.data }
  }
  const run = (custom: any, inputValues: any, writeMode?: 'run' | 'dry_run') =>
    runCustomReference({ ref: { id: 'r', name: 'test', request_config: { origin: 'custom', custom: normalizeCustomConfig(custom) } }, integrationConfig, inputValues, loadSettings: async () => ({}), runSource, writeMode })

  const updateStatus = (extra: any = {}) => ({
    kind: 'update', source, columns: [{ path: 'id' }, { path: 'status' }],
    inputs: [{ name: 'order_id', type: 'integer' }, { name: 'status', type: 'string' }, { name: 'from', type: 'string' }],
    write: { set: [{ column: 'status', value: '{{input.status}}' }], key: [{ column: 'id', value: '{{input.order_id}}' }], returning: true, ...extra },
  })

  it('a dry run always rolls back and reports the SQL, its parameters and the would-be affected rows', async () => {
    const result: any = await run(updateStatus(), { order_id: 1, status: 'packed' }, 'dry_run')
    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({ dry_run: true, rolled_back: true, affected_rows: 1, max_affected_rows: 1, would_exceed: false, record: { id: 1, status: 'packed' } })
    expect(result.data.sql).toBe(`UPDATE "${SCHEMA}"."orders" SET "status" = $1 WHERE "id" = $2 RETURNING "id", "status"`)
    expect(result.data.params).toEqual(['packed', 1])
    expect(await statusOf(1)).toBe('new')
    // Over the cap in a dry run: reported, still rolled back.
    const wide: any = await run({ ...updateStatus(), write: { set: [{ column: 'status', value: 'x' }] }, filter: { op: 'and', conditions: [{ field: 'status', operator: 'eq', value: '{{input.from}}' }] } }, { from: 'new' }, 'dry_run')
    expect(wide.data).toMatchObject({ affected_rows: 2, would_exceed: true, rolled_back: true })
    expect((await db.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.orders WHERE status = 'new'`)).rows[0].n).toBe(2)
  })

  it('more affected rows than the cap rolls the transaction back (409); within the cap it commits', async () => {
    const custom = { ...updateStatus(), write: { set: [{ column: 'status', value: 'bulk' }] }, filter: { op: 'and', conditions: [{ field: 'status', operator: 'eq', value: '{{input.from}}' }] } }
    const over: any = await run(custom, { from: 'new' })
    expect(over).toMatchObject({ status: 409, data: { affected_rows: 2, max_affected_rows: 1, rolled_back: true } })
    expect(await statusOf(1)).toBe('new')
    expect(await statusOf(2)).toBe('new')
    const within: any = await run({ ...custom, write: { ...custom.write, max_affected: 2 } }, { from: 'new' })
    expect(within).toMatchObject({ status: 200, data: { affected_rows: 2 } })
    expect(await statusOf(1)).toBe('bulk')
    await db.query(`UPDATE ${SCHEMA}.orders SET status = 'new' WHERE id IN (1, 2)`)
  })

  it('a real key-based update commits; a hostile value is stored as data', async () => {
    const hostile = "x'); DROP TABLE orders; --"
    const result: any = await run(updateStatus(), { order_id: 3, status: hostile })
    expect(result).toMatchObject({ status: 200, data: { status: 200, affected_rows: 1, id: 3, record: { id: 3, status: hostile } } })
    expect(await statusOf(3)).toBe(hostile)
    expect((await run(updateStatus(), { order_id: 999, status: 'x' })).status).toBe(404)
  })

  it('upsert inserts, then updates on conflict; delete by key', async () => {
    const upsert = { kind: 'upsert', source, columns: [], inputs: [{ name: 'order_id', type: 'integer' }, { name: 'status', type: 'string' }], write: { set: [{ column: 'status', value: '{{input.status}}' }], key: [{ column: 'id', value: '{{input.order_id}}' }] } }
    expect((await run(upsert, { order_id: 50, status: 'new' })).data).toMatchObject({ affected_rows: 1 })
    expect((await run(upsert, { order_id: 50, status: 'paid' })).data).toMatchObject({ affected_rows: 1 })
    expect(await statusOf(50)).toBe('paid')
    const del = { kind: 'delete', source, columns: [], inputs: [{ name: 'order_id', type: 'integer' }], write: { key: [{ column: 'id', value: '{{input.order_id}}' }] } }
    expect((await run(del, { order_id: 50 }, 'dry_run')).data).toMatchObject({ affected_rows: 1, rolled_back: true })
    expect(await statusOf(50)).toBe('paid')
    expect((await run(del, { order_id: 50 })).data).toMatchObject({ affected_rows: 1 })
    expect(await statusOf(50)).toBeUndefined()
  })

  it('Execute calls an introspected function with bound parameters', async () => {
    const exec = { kind: 'execute', source: { type: 'table' }, columns: [], inputs: [{ name: 'status', type: 'string' }], write: { procedure: { schema: SCHEMA, name: 'count_status', routine_type: 'function', params: [{ name: 'p_status', value: '{{input.status}}' }] } } }
    const result: any = await run(exec, { status: 'new' })
    expect(result.data.rows).toEqual([{ n: '2' }])
    expect(result.data.record).toEqual({ n: '2' })
  })
})
