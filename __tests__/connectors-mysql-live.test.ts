/**
 * MySQL connector against a real server. Skipped unless MYSQL_TEST_URL is set:
 *
 *   docker run -d --rm --name mysql-test -p 127.0.0.1:33306:3306 \
 *     -e MYSQL_ROOT_PASSWORD=fake-mysql-password -e MYSQL_DATABASE=shop mysql:8.4
 *   MYSQL_TEST_URL=mysql://root:fake-mysql-password@127.0.0.1:33306/shop npx vitest run __tests__/connectors-mysql-live.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runConnectorTemplate } from './helpers/connector-contract'

const RAW = process.env.MYSQL_TEST_URL
const d = RAW ? describe : describe.skip
const u = RAW ? new URL(RAW) : null
// The test container has no TLS certificate signed by a public CA.
const CONFIG = u ? { host: u.hostname, port: u.port || '3306', database: u.pathname.slice(1), ssl: 'skip-verify' } : {}
const CREDS = u ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } : {}
const T = `connaudit_${Date.now().toString(36)}`

d('mysql connector (real server)', () => {
  const saved = process.env.ALLOW_PRIVATE_EGRESS
  const run = (template: string, inputs: Record<string, any>) =>
    runConnectorTemplate({ connector: 'mysql', template, config: CONFIG, credentials: CREDS, inputs }).then((r) => r.result)

  beforeAll(async () => {
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    await run('execute', { sql: `CREATE TABLE ${T} (id INT AUTO_INCREMENT PRIMARY KEY, sku VARCHAR(20), qty INT)` })
    await run('execute', { sql: `CREATE PROCEDURE ${T}_p(IN q INT) SELECT sku FROM ${T} WHERE qty >= q ORDER BY sku` })
  }, 60_000)
  afterAll(async () => {
    await run('execute', { sql: `DROP PROCEDURE IF EXISTS ${T}_p` }).catch(() => {})
    await run('execute', { sql: `DROP TABLE IF EXISTS ${T}` }).catch(() => {})
    const { closeDbPools } = await import('@/lib/db-connector')
    await closeDbPools()
    if (saved === undefined) delete process.env.ALLOW_PRIVATE_EGRESS
    else process.env.ALLOW_PRIVATE_EGRESS = saved
  })

  it('templates round-trip', async () => {
    expect((await run('insert_record', { table: T, columns: 'sku, qty', values: '?, ?', params: '["A\\"1", 2]' })).data).toMatchObject({ affected_rows: 1 })
    await run('insert_record', { table: T, columns: 'sku, qty', values: '?, ?', params: '["B", 5]' })
    expect((await run('list_records', { table: T, columns: 'sku, qty', order_by: 'sku', limit: 10, offset: 0 })).data).toEqual([{ sku: 'A"1', qty: 2 }, { sku: 'B', qty: 5 }])
    expect((await run('get_record', { table: T, pk_column: 'sku', pk_value: 'B' })).data).toMatchObject({ sku: 'B', qty: 5 })
    expect((await run('update_record', { table: T, set_clause: 'qty = ?', where_clause: 'sku = ?', params: '[7, "B"]' })).data).toMatchObject({ affected_rows: 1 })
    expect((await run('call_procedure', { procedure_name: `${T}_p`, args: '?', params: '[3]' })).data).toEqual([{ sku: 'B' }])
    const tables = (await run('list_tables', {})).data
    expect(tables.map((t: any) => t.TABLE_NAME)).toContain(T)
    expect((await run('delete_record', { table: T, where_clause: 'qty > ?', params: '[0]' })).data).toMatchObject({ affected_rows: 2 })
  }, 60_000)

  it('read-only transactions refuse writes', async () => {
    const { executeQuery, parseDbConfig } = await import('@/lib/db-connector')
    const { getConnectorDefinition } = await import('@/lib/connectors/registry')
    const cfg = parseDbConfig(getConnectorDefinition('mysql')!.buildIntegrationConfig(CONFIG, CREDS))!
    await expect(executeQuery(cfg, `INSERT INTO ${T} (sku, qty) VALUES ('x', 1)`, [], { readOnly: true })).rejects.toThrow(/READ ONLY/i)
    await expect(executeQuery(cfg, `SELECT COUNT(*) AS n FROM ${T} WHERE sku = 'x'`, [])).resolves.toMatchObject({ rows: [{ n: 0 }] })
  }, 30_000)

  it('row cap', async () => {
    const { executeQuery, parseDbConfig } = await import('@/lib/db-connector')
    const { getConnectorDefinition } = await import('@/lib/connectors/registry')
    const cfg = parseDbConfig(getConnectorDefinition('mysql')!.buildIntegrationConfig(CONFIG, CREDS))!
    const r = await executeQuery(cfg, 'WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 40) SELECT n FROM s', [], { maxRows: 5 })
    expect(r.rows).toHaveLength(5)
    expect(r.truncated).toBe(true)
  }, 30_000)
})
