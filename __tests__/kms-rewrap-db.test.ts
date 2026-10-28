import crypto from 'node:crypto'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { clearDataKeys, decryptSecret, encryptSecret, installDataKeys, installEncryptionKey } from '@/lib/secret-crypto'
import { ciphertextInventory, rewrapSecrets, SECRET_COLUMNS, type SecretColumn } from '@/lib/providers/kms/rewrap'

/**
 * `kms rewrap` against real PostgreSQL (EVENT_STREAM_DB_URL): a scratch
 * schema with one column of each kind (nested jsonb, text, settings-like
 * with bootstrap rows skipped) and its own progress table, so nothing
 * outside it is touched. Covers batching, a failure mid-way (the batches
 * before it committed, the cursor consistent with the data, the rest
 * untouched), resuming, an undecryptable row, re-running as a no-op, the
 * single-run lock and that every value still decrypts to what it was.
 */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const KEY = Buffer.alloc(32, 3).toString('base64')

describe.skipIf(!DB_URL)('kms rewrap (local DB, scratch schema)', () => {
  const schema = `kms_rw_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
  const db = new pg.Client({ connectionString: DB_URL })
  const other = new pg.Client({ connectionString: DB_URL })
  const k1 = crypto.randomBytes(32)
  const k2 = crypto.randomBytes(32)
  const plain = new Map<string, unknown>()
  let columns: SecretColumn[]
  const runsTable = `${schema}.rewrap_runs`

  beforeAll(async () => {
    await db.connect()
    await other.connect()
    installEncryptionKey(KEY)
    installDataKeys([{ id: 1, key: k1, activatesAt: 0 }, { id: 2, key: k2, activatesAt: 0 }])
    await db.query(`CREATE SCHEMA ${schema}`)
    await db.query(`CREATE TABLE ${schema}.docs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), doc jsonb NOT NULL)`)
    await db.query(`CREATE TABLE ${schema}.keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), secret text NOT NULL)`)
    await db.query(`CREATE TABLE ${schema}.settings (key text PRIMARY KEY, value jsonb NOT NULL, secret boolean NOT NULL)`)
    await db.query(`CREATE TABLE ${runsTable} (LIKE app_kms.rewrap_runs INCLUDING ALL)`)
    columns = [
      { table: `${schema}.docs`, key: 'id', keyType: 'uuid', column: 'doc', kind: 'jsonb' },
      { table: `${schema}.keys`, key: 'id', keyType: 'uuid', column: 'secret', kind: 'text' },
      { table: `${schema}.settings`, key: 'key', keyType: 'text', column: 'value', kind: 'jsonb', where: 'secret', skip: (k) => k.startsWith('kms.') },
    ]
    // 10 docs mixing enc:v1, data key #1 and plaintext, nested; 7 text secrets; settings incl. a bootstrap row.
    for (let i = 0; i < 10; i++) {
      const doc = { name: `d${i}`, auth: { password: `pw-${i}`, headers: [{ value: `h-${i}` }] }, plain: 'not secret' }
      const stored = { ...doc, auth: { password: encryptSecret(doc.auth.password, i % 2 ? { keyId: 1 } : { bootstrap: true }), headers: [{ value: encryptSecret(doc.auth.headers[0].value, { keyId: 1 }) }] } }
      const { rows } = await db.query(`INSERT INTO ${schema}.docs (doc) VALUES ($1) RETURNING id`, [stored])
      plain.set(`doc:${rows[0].id}`, doc)
    }
    for (let i = 0; i < 7; i++) {
      const { rows } = await db.query(`INSERT INTO ${schema}.keys (secret) VALUES ($1) RETURNING id`, [encryptSecret(`pem-${i}`, { bootstrap: true })])
      plain.set(`key:${rows[0].id}`, `pem-${i}`)
    }
    await db.query(`INSERT INTO ${schema}.settings VALUES ('email.smtp_password', $1, true), ('kms.vault_token', $2, true), ('storage.bucket', '"files"', false)`, [
      JSON.stringify(encryptSecret(JSON.stringify('smtp-pw'), { bootstrap: true })), JSON.stringify(encryptSecret(JSON.stringify('vault-token'), { bootstrap: true })),
    ])
  })

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined)
    await db.end()
    await other.end()
    clearDataKeys()
  })
  afterEach(() => installEncryptionKey(KEY))

  async function readAll() {
    const docs = (await db.query(`SELECT id, doc FROM ${schema}.docs`)).rows
    const keys = (await db.query(`SELECT id, secret FROM ${schema}.keys`)).rows
    const settings = (await db.query(`SELECT key, value FROM ${schema}.settings WHERE secret`)).rows
    return { docs, keys, settings }
  }

  function decryptDoc(doc: { auth: { password: string; headers: Array<{ value: string }> } } & Record<string, unknown>) {
    return { ...doc, auth: { password: decryptSecret(doc.auth.password), headers: [{ value: decryptSecret(doc.auth.headers[0].value) }] } }
  }

  it('counts ciphertext per key', async () => {
    const inventory = await ciphertextInventory(db, columns)
    expect(inventory[`${schema}.docs.doc`]).toEqual({ 'enc:v1': 5, 'enc:v2#1': 15 })
    expect(inventory[`${schema}.keys.secret`]).toEqual({ 'enc:v1': 7 })
    expect(inventory[`${schema}.settings.value`]).toEqual({ 'enc:v1': 2 })
  })

  it('a failure mid-way keeps every committed batch, the cursor and the untouched rest consistent; resuming finishes', async () => {
    const lines: string[] = []
    const failed = await rewrapSecrets(db, {
      target: 2, batchSize: 3, columns, runsTable, log: (l) => lines.push(l),
      onBatch: (column, batch) => { if (column === `${schema}.docs.doc` && batch === 3) throw new Error('KMS unavailable (simulated)') },
    })
    expect(failed.status).toBe('failed')
    expect(failed.error).toMatch(/KMS unavailable/)
    const p = failed.progress[`${schema}.docs.doc`]
    expect(p).toMatchObject({ scanned: 6, done: false })
    // Exactly the first two batches (ordered by id) were re-encrypted; the third rolled back.
    const docs = (await db.query(`SELECT id::text, doc FROM ${schema}.docs ORDER BY id`)).rows
    const before = docs.filter((r) => r.id <= p.cursor!)
    const after = docs.filter((r) => r.id > p.cursor!)
    expect(before).toHaveLength(6)
    for (const r of before) expect(JSON.stringify(r.doc)).not.toMatch(/enc:v1:|enc:v2:1:/)
    for (const r of after) expect(JSON.stringify(r.doc)).toMatch(/enc:v1:|enc:v2:1:/)
    // The run row agrees with the data.
    const { rows: [run] } = await db.query(`SELECT status, progress, error FROM ${runsTable} WHERE id = $1`, [failed.runId])
    expect(run.status).toBe('failed')
    expect(run.progress[`${schema}.docs.doc`].cursor).toBe(p.cursor)
    // Everything still decrypts — old and new keys side by side.
    for (const r of docs) expect(decryptDoc(r.doc)).toEqual(plain.get(`doc:${r.id}`))

    const resumed = await rewrapSecrets(db, { target: 2, batchSize: 3, columns, runsTable, log: (l) => lines.push(l) })
    expect(resumed).toMatchObject({ status: 'completed', resumed: true, runId: failed.runId })
    expect(lines.join('\n')).toMatch(/Resuming rewrap/)
    const inventory = await ciphertextInventory(db, columns)
    expect(inventory[`${schema}.docs.doc`]).toEqual({ 'enc:v2#2': 20 })
    expect(inventory[`${schema}.keys.secret`]).toEqual({ 'enc:v2#2': 7 })
    // The KMS credential stays on the bootstrap key; the SMTP password moves.
    expect(inventory[`${schema}.settings.value`]).toEqual({ 'enc:v1': 1, 'enc:v2#2': 1 })
    const all = await readAll()
    for (const r of all.docs) expect(decryptDoc(r.doc)).toEqual(plain.get(`doc:${r.id}`))
    for (const r of all.keys) expect(decryptSecret(r.secret)).toBe(plain.get(`key:${r.id}`))
    expect(Object.fromEntries(all.settings.map((r) => [r.key, JSON.parse(decryptSecret(r.value))]))).toEqual({ 'email.smtp_password': 'smtp-pw', 'kms.vault_token': 'vault-token' })
  })

  it('re-running is a no-op; --restart rescans without changing anything', async () => {
    const snapshot = JSON.stringify(await readAll())
    const again = await rewrapSecrets(db, { target: 2, batchSize: 4, columns, runsTable, restart: true })
    expect(again.status).toBe('completed')
    expect(Object.values(again.progress).reduce((n, p) => n + p.rewrapped, 0)).toBe(0)
    expect(JSON.stringify(await readAll())).toBe(snapshot)
  })

  it('an undecryptable value stops the run naming the row, never a value; a dry run changes nothing', async () => {
    const { rows: [bad] } = await db.query(`INSERT INTO ${schema}.keys (secret) VALUES ($1) RETURNING id::text`, [encryptSecret('lost', { keyId: 1 }).replace('enc:v2:1:', 'enc:v2:9:')])
    const dry = await rewrapSecrets(db, { target: 2, columns, runsTable, dryRun: true, restart: true })
    expect(dry.status).toBe('failed')
    expect(dry.error).toContain(`keys.secret row ${bad.id}`)
    expect(dry.error).toMatch(/data key 9 is not loaded/)
    expect(dry.error).not.toContain('lost')
    await db.query(`DELETE FROM ${schema}.keys WHERE id = $1`, [bad.id])
  })

  it('enc:v1 values need ENCRYPTION_KEY', async () => {
    await db.query(`INSERT INTO ${schema}.keys (secret) VALUES ($1)`, [encryptSecret('legacy', { bootstrap: true })])
    installEncryptionKey(Buffer.alloc(32, 4).toString('base64'))
    const result = await rewrapSecrets(db, { target: 2, columns, runsTable, restart: true })
    expect(result.status).toBe('failed')
    installEncryptionKey(KEY)
    expect((await rewrapSecrets(db, { target: 2, columns, runsTable })).status).toBe('completed')
  })

  it('only one rewrap runs at a time', async () => {
    await other.query('SELECT pg_advisory_lock(hashtext($1))', [`usertasks:kms-rewrap:${runsTable}`])
    try {
      await expect(rewrapSecrets(db, { target: 2, columns, runsTable })).rejects.toThrow(/another kms rewrap is running/)
    } finally {
      await other.query('SELECT pg_advisory_unlock(hashtext($1))', [`usertasks:kms-rewrap:${runsTable}`])
    }
  })

  it('the registry covers every column the app encrypts', () => {
    expect(SECRET_COLUMNS.map((c) => `${c.table}.${c.column}`)).toEqual([
      'public.instance_settings.value', 'public.integrations.config', 'public.tenant_connectors.config', 'public.tenant_connectors.credentials',
      'public.log_destinations.credentials', 'public.oauth_connect_states.payload', 'public.package_signing_keys.private_key_encrypted',
    ])
  })
})
