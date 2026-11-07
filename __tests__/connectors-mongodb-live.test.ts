/**
 * MongoDB connector against a real server. Skipped unless MONGO_TEST_URL is
 * set (credentials in the URL are moved out of it the way the connector does):
 *
 *   docker run -d --rm --name mongo-test -p 127.0.0.1:27117:27017 \
 *     -e MONGO_INITDB_ROOT_USERNAME=app -e MONGO_INITDB_ROOT_PASSWORD=fake-mongo-password mongo:7
 *   MONGO_TEST_URL='mongodb://app:fake-mongo-password@localhost:27117/?authSource=admin&directConnection=true' npx vitest run __tests__/connectors-mongodb-live.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runConnectorTemplate } from './helpers/connector-contract'

const RAW = process.env.MONGO_TEST_URL
const d = RAW ? describe : describe.skip
const DB = `connaudit_${Date.now().toString(36)}`

d('mongodb connector (real server)', () => {
  const saved = process.env.ALLOW_PRIVATE_EGRESS
  beforeAll(() => { process.env.ALLOW_PRIVATE_EGRESS = 'true' })
  afterAll(async () => {
    const { getConnectorDefinition } = await import('@/lib/connectors/registry')
    const { parseDbConfig, closeDbPools } = await import('@/lib/db-connector')
    const cfg = parseDbConfig(getConnectorDefinition('mongodb')!.buildIntegrationConfig({ connection_string: RAW, database: DB }, {}))!
    const { MongoClient } = await import('mongodb')
    const client = new MongoClient(RAW!)
    await client.connect()
    await client.db(cfg.database).dropDatabase()
    await client.close()
    await closeDbPools()
    if (saved === undefined) delete process.env.ALLOW_PRIVATE_EGRESS
    else process.env.ALLOW_PRIVATE_EGRESS = saved
  })

  // Credentials pasted into the connection string (legacy) — moved to auth_config by buildIntegrationConfig.
  const run = (template: string, inputs: Record<string, any>) =>
    runConnectorTemplate({ connector: 'mongodb', template, config: { connection_string: RAW, database: DB }, credentials: { username: '', password: '' }, inputs }).then((r) => r.result)

  it('insert, find, update, aggregate, count, delete', async () => {
    expect((await run('insert_many', { collection: 'orders', documents: '[{"sku":"A","qty":1,"status":"open"},{"sku":"B","qty":5,"status":"open"},{"sku":"C","qty":2,"status":"void"}]' })).data).toMatchObject({ insertedCount: 3 })
    const found = await run('find', { collection: 'orders', filter: '{"status": "open"}', projection: '{"_id": 0, "sku": 1}', sort: '{"sku": 1}', limit: 10, skip: 0 })
    expect(found.data.documents).toEqual([{ sku: 'A' }, { sku: 'B' }])
    expect((await run('update_many', { collection: 'orders', filter: '{"status": "open"}', update: '{"$inc": {"qty": 1}}' })).data).toMatchObject({ modifiedCount: 2 })
    const agg = await run('aggregate', { collection: 'orders', pipeline: '[{"$group": {"_id": "$status", "n": {"$sum": "$qty"}}}, {"$sort": {"_id": 1}}]' })
    expect(agg.data.documents).toEqual([{ _id: 'open', n: 8 }, { _id: 'void', n: 2 }])
    await expect(run('aggregate', { collection: 'orders', pipeline: '[{"$out": "copy"}]' })).rejects.toThrow(/\$out/)
    await expect(run('find', { collection: 'orders', filter: '{"$where": "true"}' })).rejects.toThrow(/\$where/)
    await expect(run('delete_many', { collection: 'orders', filter: '{}' })).rejects.toThrow(/empty filter/)
    expect((await run('count', { collection: 'orders', filter: '' })).data).toEqual({ count: 3 })
    expect((await run('delete_many', { collection: 'orders', filter: '{"status": "void"}' })).data).toMatchObject({ deletedCount: 1 })
    expect((await run('list_collections', {})).data.collections.map((c: any) => c.name)).toEqual(['orders'])
  }, 30_000)

  it('the egress guard applies to resolved addresses', async () => {
    const { closeDbPools } = await import('@/lib/db-connector')
    await closeDbPools()
    delete process.env.ALLOW_PRIVATE_EGRESS
    try {
      await expect(run('count', { collection: 'orders', filter: '' })).rejects.toThrow(/not allowed/)
    } finally {
      process.env.ALLOW_PRIVATE_EGRESS = 'true'
    }
  }, 30_000)
})
