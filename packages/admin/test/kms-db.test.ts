/**
 * `usertasks-admin kms …` and `switch kms` end to end on a scratch, plain
 * PostgreSQL database (the repository migrations applied by the runner),
 * with real secrets in every registered column:
 *
 *   enc:v1 install → kms rotate (env) → kms rewrap → a fresh "app process"
 *   loads the keys and reads every secret → switch kms --to vault_transit
 *   (KMS_TEST_VAULT_ADDR) or aws_kms (KMS_TEST_AWS_ENDPOINT) → rotate +
 *   rewrap under the new KMS → prune → rollback → everything still reads.
 *
 * Every line the CLI printed is checked for key material (data keys,
 * ENCRYPTION_KEY, the Vault token). Runs only with MIGRATION_TEST_ADMIN_URL.
 */
import crypto, { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadMigrations } from '../src/db/migrations'
import { migrate } from '../src/db/runner'
import { run, type CliIO } from '../src/cli'
import { encodeSetting, upsertSettingRow } from '../src/instance'
import { clearDataKeys, decryptSecret, encryptSecret, installEncryptionKey } from '@/lib/secret-crypto'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import { bootstrapKms, stopKmsRefresh } from '@/lib/providers/kms/bootstrap'
import { sqlDataKeys, unwrapDataKey, resolverFor } from '@/lib/providers/kms/keyring'
import { createEnvKmsProvider } from '@/lib/providers/kms/env'
import { createVaultTransitKmsProvider } from '@/lib/providers/kms/vault-transit'
import { invalidateInstanceSettingsCache } from '@/lib/config/instance-settings'

const ADMIN_URL = process.env.MIGRATION_TEST_ADMIN_URL
const VAULT_ADDR = process.env.KMS_TEST_VAULT_ADDR
const VAULT_TOKEN = process.env.KMS_TEST_VAULT_TOKEN ?? 'ut-root'
const AWS_ENDPOINT = process.env.KMS_TEST_AWS_ENDPOINT
const REPO_MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations')
const KEY = crypto.randomBytes(32).toString('base64')

describe.skipIf(!ADMIN_URL)('usertasks-admin kms (plain PostgreSQL)', () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  const name = `ut_kms_${randomUUID().slice(0, 8)}`
  let url: string
  let db: pg.Client
  const printed: string[] = []
  const backups = mkdtempSync(path.join(tmpdir(), 'ut-kms-'))
  const envBackup = { ...process.env }
  const transitKey = `ut-${randomUUID().slice(0, 8)}`
  const plain: Record<string, unknown> = {}

  const io = (): CliIO => ({ out: (l) => printed.push(l), err: (l) => printed.push(l), env: { ...process.env, DATABASE_URL: url, BACKUP_DIR: backups } })
  const cli = (...argv: string[]) => run(argv, io())
  const lastJson = () => JSON.parse(printed.splice(-1)[0])

  /** A fresh "app process": forget the keys, load them the way startup does, read every secret. */
  async function appReadsEverything(): Promise<void> {
    clearDataKeys()
    stopKmsRefresh()
    invalidateInstanceSettingsCache()
    await bootstrapKms({ source: sqlDataKeys(db), refresh: false, log: (m) => printed.push(m) })
    const settings = (await db.query(`SELECT key, value FROM public.instance_settings WHERE secret ORDER BY key`)).rows
    expect(Object.fromEntries(settings.map((r) => [r.key, JSON.parse(decryptSecret(r.value))]))).toMatchObject({ 'email.smtp_password': 'smtp-pw' })
    const integration = (await db.query('SELECT config FROM public.integrations LIMIT 1')).rows[0]
    expect(decryptSensitiveFields(integration.config)).toEqual(plain.integration)
    const connector = (await db.query('SELECT credentials FROM public.tenant_connectors LIMIT 1')).rows[0]
    expect(decryptSensitiveFields(connector.credentials)).toEqual(plain.connector)
    const destination = (await db.query('SELECT credentials FROM public.log_destinations LIMIT 1')).rows[0]
    expect(decryptSensitiveFields(destination.credentials)).toEqual(plain.destination)
    const signing = (await db.query('SELECT private_key_encrypted FROM public.package_signing_keys LIMIT 1')).rows[0]
    expect(decryptSecret(signing.private_key_encrypted)).toBe(plain.signing)
  }

  async function status() {
    printed.length = 0
    expect(await cli('kms', 'status', '--json')).toBe(0)
    return lastJson() as { provider: string; keys: Array<{ id: number; provider: string; values: number; active: boolean }>; ciphertext: Record<string, Record<string, number>> }
  }

  const totals = (ciphertext: Record<string, Record<string, number>>) => {
    const out: Record<string, number> = {}
    for (const counts of Object.values(ciphertext)) for (const [k, n] of Object.entries(counts)) out[k] = (out[k] ?? 0) + n
    return out
  }

  beforeAll(async () => {
    await admin.connect()
    const { rows } = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin'`)
    if (rows.length) throw new Error('MIGRATION_TEST_ADMIN_URL must point at plain PostgreSQL, not a Supabase stack')
    await admin.query(`CREATE DATABASE ${name}`)
    const u = new URL(ADMIN_URL!)
    u.pathname = `/${name}`
    url = u.toString()
    db = new pg.Client({ connectionString: url })
    await db.connect()
    await migrate(db, loadMigrations(REPO_MIGRATIONS))
    for (const k of Object.keys(process.env)) if (/^(KMS_|VAULT_|AWS_KMS_|CACHE_|DB_PROVIDER|SECRETS_PROVIDER)/.test(k)) delete process.env[k]
    process.env.ENCRYPTION_KEY = KEY
    installEncryptionKey(KEY)
    // The "app process" (bootstrapKms, the settings loader) reads this database too.
    process.env.DB_PROVIDER = 'postgres'
    process.env.DATABASE_URL = url

    // Secrets in every registered column, all enc:v1 (an install from before the KMS existed).
    await upsertSettingRow(db, encodeSetting('email.smtp_password', 'smtp-pw', true))
    const { rows: [tenant] } = await db.query(`INSERT INTO public.tenants (name, slug) VALUES ('KMS test', $1) RETURNING id`, [name])
    plain.integration = { base_url: 'https://api.example', auth_config: { type: 'bearer', token: 'int-token' } }
    await db.query(`INSERT INTO public.integrations (tenant_id, name, type, config) VALUES ($1, 'api', 'rest', $2)`, [tenant.id, { base_url: 'https://api.example', auth_config: { type: 'bearer', token: encryptSecret('int-token') } }])
    plain.connector = { username: 'svc', password: 'conn-pw' }
    await db.query(`INSERT INTO public.tenant_connectors (tenant_id, connector_key, credentials) VALUES ($1, 'ldap', $2)`, [tenant.id, { username: 'svc', password: encryptSecret('conn-pw') }])
    plain.destination = { token: 'hec-token', headers: { 'X-Key': 'hdr' } }
    await db.query(`INSERT INTO public.log_destinations (tenant_id, name, type, config, credentials) VALUES ($1, 'splunk', 'splunk_hec', '{"url":"https://splunk"}', $2)`, [tenant.id, { token: encryptSecret('hec-token'), headers: { 'X-Key': encryptSecret('hdr') } }])
    plain.signing = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEI…\n-----END PRIVATE KEY-----'
    await db.query(`INSERT INTO public.package_signing_keys (public_key, private_key_encrypted, fingerprint) VALUES ('pub', $1, 'fp')`, [encryptSecret(plain.signing as string)])
  }, 180_000)

  afterAll(async () => {
    stopKmsRefresh()
    clearDataKeys()
    process.env = envBackup
    await db?.end().catch(() => undefined)
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined)
    await admin.end()
    rmSync(backups, { recursive: true, force: true })
  })

  it('status of an install without data keys: everything is enc:v1', async () => {
    const s = await status()
    expect(s.keys).toEqual([])
    expect(totals(s.ciphertext)).toEqual({ 'enc:v1': 6 })
    await appReadsEverything()
  })

  it('rotate (env) refuses without --yes, then creates #1; rewrap moves every value to it', async () => {
    expect(await cli('kms', 'rotate')).toBe(2)
    expect(await cli('kms', 'rotate', '--activate-in', '0', '--yes')).toBe(0)
    expect(printed.join('\n')).toMatch(/Created data key #1 \(env\)/)
    expect(await cli('kms', 'rewrap', '--dry-run')).toBe(0)
    expect(totals((await status()).ciphertext)).toEqual({ 'enc:v1': 6 })
    expect(await cli('kms', 'rewrap', '--yes', '--batch', '1')).toBe(0)
    const s = await status()
    expect(totals(s.ciphertext)).toEqual({ 'enc:v2#1': 6 })
    expect(s.keys).toMatchObject([{ id: 1, provider: 'env', active: true, values: 6 }])
    await appReadsEverything()
  })

  it('rotate with an unreachable KMS fails and creates nothing', async () => {
    process.env.KMS_PROVIDER = 'vault_transit'
    process.env.VAULT_ADDR = 'http://127.0.0.1:9'
    process.env.VAULT_TOKEN = 'x'
    process.env.VAULT_TRANSIT_KEY = 'k'
    try {
      expect(await cli('kms', 'rotate', '--yes')).toBe(1)
      expect(printed.join('\n')).toMatch(/Vault unreachable at http:\/\/127\.0\.0\.1:9/)
    } finally {
      for (const k of ['KMS_PROVIDER', 'VAULT_ADDR', 'VAULT_TOKEN', 'VAULT_TRANSIT_KEY']) delete process.env[k]
    }
    expect((await status()).keys.map((k) => k.id)).toEqual([1])
  })

  const target = VAULT_ADDR ? 'vault_transit' : AWS_ENDPOINT ? 'aws_kms' : null

  it.skipIf(!target)('switch kms moves the data keys to another KMS; rotate + rewrap + prune there; rollback brings them back', async () => {
    let set: string[]
    if (target === 'vault_transit') {
      await fetch(`${VAULT_ADDR}/v1/sys/mounts/transit`, { method: 'POST', headers: { 'X-Vault-Token': VAULT_TOKEN }, body: JSON.stringify({ type: 'transit' }) })
      await fetch(`${VAULT_ADDR}/v1/transit/keys/${transitKey}`, { method: 'POST', headers: { 'X-Vault-Token': VAULT_TOKEN }, body: '{}' })
      set = ['--set', `vault_addr=${VAULT_ADDR}`, '--set', `vault_transit_key=${transitKey}`, '--secret', `vault_token=${VAULT_TOKEN}`]
    } else {
      const { KMSClient, CreateKeyCommand } = await import('@aws-sdk/client-kms')
      process.env.AWS_ACCESS_KEY_ID ??= 'test'
      process.env.AWS_SECRET_ACCESS_KEY ??= 'test'
      const client = new KMSClient({ endpoint: AWS_ENDPOINT, region: 'eu-west-2' })
      const { KeyMetadata } = await client.send(new CreateKeyCommand({}))
      set = ['--set', `aws_kms_key_id=${KeyMetadata!.Arn}`, '--set', 'aws_region=eu-west-2', '--set', `aws_endpoint=${AWS_ENDPOINT}`]
    }
    printed.length = 0
    expect(await cli('switch', 'kms', '--to', target!, ...set, '--dry-run')).toBe(0)
    expect((await status()).keys[0].provider).toBe('env')
    expect(await cli('switch', 'kms', '--to', target!, ...set, '--yes')).toBe(0)
    const switchId = /rollback (\S+) --yes/.exec(printed.join('\n'))![1]
    let s = await status()
    expect(s.keys).toMatchObject([{ id: 1, provider: target }])
    // The KMS's own credential is stored with the bootstrap key, never a data key.
    const { rows: tokenRows } = await db.query(`SELECT value #>> '{}' AS v FROM public.instance_settings WHERE key LIKE 'kms.%' AND secret`)
    for (const r of tokenRows) expect(r.v).toMatch(/^enc:v1:/)
    await appReadsEverything()

    expect(await cli('kms', 'rotate', '--activate-in', '0', '--yes')).toBe(0)
    expect(await cli('kms', 'rewrap', '--yes')).toBe(0)
    s = await status()
    expect(totals(s.ciphertext)).toEqual({ ...(tokenRows.length ? { 'enc:v1': tokenRows.length } : {}), 'enc:v2#2': 6 })
    expect(await cli('kms', 'prune', '--yes')).toBe(0)
    expect((await status()).keys.map((k) => k.id)).toEqual([2])
    await appReadsEverything()

    printed.length = 0
    expect(await cli('rollback', switchId, '--yes')).toBe(0)
    s = await status()
    expect(s.provider).toBe('env')
    expect(s.keys).toMatchObject([{ id: 2, provider: 'env' }])
    await appReadsEverything()
  })

  it('never prints key material', async () => {
    const text = printed.join('\n')
    const keys: Buffer[] = [Buffer.from(KEY, 'base64')]
    for (const row of await sqlDataKeys(db).list()) if (row.provider === 'env') keys.push(await unwrapDataKey(row, resolverFor(createEnvKmsProvider())))
    for (const key of keys) for (const form of [key.toString('base64'), key.toString('hex')]) expect(text).not.toContain(form)
    expect(text).not.toContain(KEY)
    if (VAULT_ADDR) expect(text).not.toContain(VAULT_TOKEN)
    void createVaultTransitKmsProvider
  })
})
