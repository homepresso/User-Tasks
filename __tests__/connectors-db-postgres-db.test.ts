/**
 * PostgreSQL connector against a real database (the local stack). Skipped
 * unless EVENT_STREAM_DB_URL is set (as the other *-db tests). Works in a
 * throwaway schema that is dropped afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { runConnectorTemplate } from './helpers/connector-contract'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const d = DB_URL ? describe : describe.skip

const url = DB_URL ? new URL(DB_URL) : null
const SCHEMA = `connaudit_${Date.now().toString(36)}`
const CONFIG = url ? { host: url.hostname, port: url.port || '5432', database: url.pathname.slice(1) || 'postgres', ssl: 'disable' } : {}
const CREDS = url ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } : {}

d('postgres connector (real database)', () => {
  let admin: Client
  const savedEgress = process.env.ALLOW_PRIVATE_EGRESS

  beforeAll(async () => {
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    admin = new Client({ connectionString: DB_URL })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${SCHEMA}`)
    await admin.query(`CREATE TABLE ${SCHEMA}.customers (id serial PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'active')`)
    await admin.query(`CREATE SEQUENCE ${SCHEMA}.seq`)
    await admin.query(`INSERT INTO ${SCHEMA}.customers (name, status) SELECT 'c' || g, CASE WHEN g % 2 = 0 THEN 'active' ELSE 'closed' END FROM generate_series(1, 10) g`)
  })

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await admin.end()
    const { closeDbPools } = await import('@/lib/db-connector')
    await closeDbPools()
    if (savedEgress === undefined) delete process.env.ALLOW_PRIVATE_EGRESS
    else process.env.ALLOW_PRIVATE_EGRESS = savedEgress
  })

  const run = (template: string, inputs: Record<string, any>) =>
    runConnectorTemplate({ connector: 'postgres', template, config: CONFIG, credentials: CREDS, inputs })

  it('list_records / get_record', async () => {
    const list = await run('list_records', { table: `${SCHEMA}.customers`, columns: 'id, name', where_clause: "WHERE status = 'active'", order_by: 'id DESC', limit: 2, offset: 1 })
    expect(list.result.data).toEqual([{ id: 8, name: 'c8' }, { id: 6, name: 'c6' }])
    const get = await run('get_record', { table: `${SCHEMA}.customers`, pk_column: 'id', pk_value: '3' })
    expect(get.result.data).toMatchObject({ id: 3, name: 'c3' })
  })

  it('a hostile pk_value is just a value', async () => {
    const evil = `1"],"sql":"DELETE FROM ${SCHEMA}.customers RETURNING *","params":["`
    await expect(run('get_record', { table: `${SCHEMA}.customers`, pk_column: 'name', pk_value: evil })).resolves.toMatchObject({ result: { data: null } })
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.customers`)
    expect(rows[0].n).toBe(10)
  })

  it('insert / update / delete with bound params', async () => {
    const ins = await run('insert_record', { table: `${SCHEMA}.customers`, columns: 'name, status', values: '$1, $2', params: JSON.stringify(["O'Brien \"x\"", 'new']) })
    expect(ins.result.data).toMatchObject({ affected_rows: 1, rows: [{ name: 'O\'Brien "x"', status: 'new' }] })
    const id = ins.result.data.rows[0].id
    const upd = await run('update_record', { table: `${SCHEMA}.customers`, set_clause: 'status = $1', where_clause: 'id = $2', params: JSON.stringify(['vip', id]) })
    expect(upd.result.data).toMatchObject({ affected_rows: 1 })
    const del = await run('delete_record', { table: `${SCHEMA}.customers`, where_clause: 'id = $1', params: JSON.stringify([id]) })
    expect(del.result.data).toMatchObject({ affected_rows: 1, rows: [{ id, status: 'vip' }] })
  })

  it('multi-line SQL with quoted identifiers; Execute SQL runs scripts', async () => {
    const q = await run('query', { sql: `SELECT "name"\nFROM ${SCHEMA}."customers"\nWHERE id = $1`, params: '[4]' })
    expect(q.result.data).toEqual({ name: 'c4' })
    await run('execute', { sql: `CREATE TABLE ${SCHEMA}.t2 (x int); INSERT INTO ${SCHEMA}.t2 VALUES (1), (2)` })
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.t2`)
    expect(rows[0].n).toBe(2)
  })

  it('read templates run read-only (a crafted condition cannot write)', async () => {
    await expect(run('list_records', { table: `${SCHEMA}.customers`, where_clause: `WHERE nextval('${SCHEMA}.seq') > 0` })).rejects.toThrow(/read-only transaction/)
  })

  it('stacked statements are refused outside the author\'s own SQL', async () => {
    const { executeQuery, parseDbConfig } = await import('@/lib/db-connector')
    const { getConnectorDefinition } = await import('@/lib/connectors/registry')
    const cfg = parseDbConfig(getConnectorDefinition('postgres')!.buildIntegrationConfig(CONFIG, CREDS))!
    await expect(executeQuery(cfg, `SELECT 1; DELETE FROM ${SCHEMA}.customers`, [])).rejects.toThrow(/multiple commands/)
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.customers`)
    expect(rows[0].n).toBe(10)
  })

  it('row cap, timeout, pool identity and idle-connection errors', async () => {
    const { executeQuery, parseDbConfig } = await import('@/lib/db-connector')
    const { getConnectorDefinition } = await import('@/lib/connectors/registry')
    const cfg = parseDbConfig(getConnectorDefinition('postgres')!.buildIntegrationConfig(CONFIG, CREDS))!

    const capped = await executeQuery(cfg, 'SELECT g FROM generate_series(1, 50) g', [], { maxRows: 7 })
    expect(capped.rows).toHaveLength(7)
    expect(capped.truncated).toBe(true)
    const exact = await executeQuery(cfg, 'SELECT g FROM generate_series(1, 7) g', [], { maxRows: 7 })
    expect(exact.truncated).toBeUndefined()

    await expect(executeQuery(cfg, 'SELECT pg_sleep(3)', [], { timeoutMs: 300 })).rejects.toThrow(/timeout/i)
    await expect(executeQuery(cfg, 'SELECT 1 AS ok', [])).resolves.toMatchObject({ rows: [{ ok: 1 }] })

    // A wrong password never borrows the warm pool.
    await expect(executeQuery({ ...cfg, password: 'wrong-fake-password' }, 'SELECT 1', [])).rejects.toThrow(/password authentication failed/)

    // An idle pooled connection killed by the server is an 'error' on the pool: logged, not a crash.
    const pid = (await executeQuery(cfg, 'SELECT pg_backend_pid() AS pid', [])).rows[0].pid
    await admin.query('SELECT pg_terminate_backend($1)', [pid])
    await new Promise((r) => setTimeout(r, 200))
    await expect(executeQuery(cfg, 'SELECT 2 AS ok', [])).resolves.toMatchObject({ rows: [{ ok: 2 }] })
  })
})
