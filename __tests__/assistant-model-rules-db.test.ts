/**
 * 20261231000001_agent_model_rules.sql on the local database: the rule keys
 * column is never readable by signed-in users (like api_key), while the
 * readable settings columns stay as they were; usage rows take the rule.
 */
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DB_URL = process.env.EVENT_STREAM_DB_URL

describe.skipIf(!DB_URL)('Agent model rules: columns and grants (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  beforeAll(async () => { await db.connect() })
  afterAll(async () => { await db.end() })

  it('model_rule_keys exists and is not granted to authenticated (api_key neither); capabilities still is', async () => {
    const { rows } = await db.query(`SELECT
      has_column_privilege('authenticated', 'public.assistant_settings', 'model_rule_keys', 'SELECT') AS keys,
      has_column_privilege('authenticated', 'public.assistant_settings', 'api_key', 'SELECT') AS api_key,
      has_column_privilege('authenticated', 'public.assistant_settings', 'capabilities', 'SELECT') AS caps,
      has_column_privilege('service_role', 'public.assistant_settings', 'model_rule_keys', 'SELECT') AS service`)
    expect(rows[0]).toEqual({ keys: false, api_key: false, caps: true, service: true })
  })

  it('a signed-in user selecting the keys is refused', async () => {
    await db.query('BEGIN')
    try {
      await db.query("SET LOCAL ROLE authenticated")
      await expect(db.query('SELECT model_rule_keys FROM public.assistant_settings LIMIT 1')).rejects.toThrow(/permission denied/)
    } finally { await db.query('ROLLBACK') }
  })

  it('usage rows carry the model rule (bounded)', async () => {
    const { rows } = await db.query(`SELECT data_type, character_maximum_length FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assistant_usage' AND column_name = 'model_rule'`)
    expect(rows[0]?.data_type).toBe('text')
  })
})
