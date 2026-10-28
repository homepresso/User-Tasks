import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * DATABASE_AUTH=aws (RDS / Aurora / RDS Proxy IAM database auth): the fake
 * signer below stands in for @aws-sdk/rds-signer; the real-server test uses
 * a temporary login role whose password the "IAM token" is, rotated as
 * tokens are reissued.
 */

const signerConfigs: Array<Record<string, unknown>> = []
let issue: () => string = () => 'rds-token'
const getAuthToken = vi.fn(async () => issue())
vi.mock('@aws-sdk/rds-signer', () => ({
  Signer: class {
    constructor(config: Record<string, unknown>) { signerConfigs.push(config) }
    getAuthToken = getAuthToken
  },
}))
vi.mock('@aws-sdk/credential-providers', () => ({
  fromNodeProviderChain: () => async () => ({ accessKeyId: 'AKIDTEST', secretAccessKey: 'never-logged-secret' }),
}))

import {
  cachedTokenSource,
  databaseAuthMode,
  databaseCaFile,
  describeDatabaseAuth,
  pgConnectionConfig,
  rdsRegionFromHost,
  rdsTarget,
  RDS_TOKEN_LIFETIME_MS,
  resetTokenCallbacks,
} from '@/lib/providers/db/pg-auth'

const RDS_URL = 'postgresql://app_iam@acme.cluster-abc123.eu-west-1.rds.amazonaws.com:5432/usertasks'

beforeEach(() => {
  resetTokenCallbacks()
  signerConfigs.length = 0
  getAuthToken.mockClear()
  issue = () => 'rds-token'
})
afterEach(() => vi.useRealTimers())

describe('DATABASE_AUTH=aws', () => {
  it('accepts aws and its aliases', () => {
    for (const value of ['aws', 'AWS', 'rds', 'rds_iam', 'aws_iam']) expect(databaseAuthMode({ DATABASE_AUTH: value })).toBe('aws')
    expect(() => databaseAuthMode({ DATABASE_AUTH: 'kerberos' })).toThrow(/password, azure, gcp or aws/)
  })

  it('reads the region from RDS, Aurora and RDS Proxy host names', () => {
    expect(rdsRegionFromHost('acme.cluster-abc123.eu-west-1.rds.amazonaws.com')).toBe('eu-west-1')
    expect(rdsRegionFromHost('acme-proxy.proxy-abc123.us-gov-west-1.rds.amazonaws.com')).toBe('us-gov-west-1')
    expect(rdsRegionFromHost('db.abc.cn-north-1.rds.amazonaws.com.cn')).toBe('cn-north-1')
    expect(rdsRegionFromHost('10.0.0.5')).toBeUndefined()
    expect(rdsTarget({ host: '10.0.0.5', port: 6432, user: 'app' }, { AWS_REGION: 'ap-southeast-2' })).toEqual({ hostname: '10.0.0.5', port: 6432, username: 'app', region: 'ap-southeast-2' })
    expect(rdsTarget({ host: 'acme.cluster-abc123.eu-west-1.rds.amazonaws.com', user: 'app' }, { DATABASE_AWS_REGION: 'eu-central-1' }).region).toBe('eu-central-1')
    expect(() => rdsTarget({ host: '10.0.0.5', user: 'app' }, {})).toThrow(/DATABASE_AWS_REGION/)
    expect(() => rdsTarget({ host: 'h', user: '' }, { AWS_REGION: 'eu-west-1' })).toThrow(/database user/)
    expect(() => rdsTarget({ host: '/var/run/postgresql', user: 'app' }, { AWS_REGION: 'eu-west-1' })).toThrow(/TCP host/)
  })

  it('signs for the URL host, port and user; the token is the password; TLS on', async () => {
    const config = pgConnectionConfig(RDS_URL, { max: 4 }, { DATABASE_AUTH: 'aws' })
    expect(config).toMatchObject({ max: 4, user: 'app_iam', host: 'acme.cluster-abc123.eu-west-1.rds.amazonaws.com', port: 5432, database: 'usertasks' })
    expect(config).not.toHaveProperty('connectionString')
    expect(config.ssl).toBeTruthy()
    expect((config.ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized).not.toBe(false)
    expect(await (config.password as () => Promise<string>)()).toBe('rds-token')
    expect(signerConfigs[0]).toMatchObject({ hostname: 'acme.cluster-abc123.eu-west-1.rds.amazonaws.com', port: 5432, username: 'app_iam', region: 'eu-west-1' })
    // The signer gets the instance credential chain, not static keys.
    expect(typeof signerConfigs[0].credentials).toBe('function')
  })

  it('one token cache per endpoint and user (instance endpoint vs RDS Proxy)', async () => {
    let n = 0
    issue = () => `token-${++n}`
    const instance = pgConnectionConfig(RDS_URL, {}, { DATABASE_AUTH: 'aws' })
    const proxy = pgConnectionConfig('postgresql://app_iam@acme-proxy.proxy-abc123.eu-west-1.rds.amazonaws.com/usertasks', {}, { DATABASE_AUTH: 'aws' })
    const again = pgConnectionConfig(RDS_URL, {}, { DATABASE_AUTH: 'aws' })
    expect(await (instance.password as () => Promise<string>)()).toBe('token-1')
    expect(await (proxy.password as () => Promise<string>)()).toBe('token-2')
    expect(await (again.password as () => Promise<string>)()).toBe('token-1')
    expect(signerConfigs.map((c) => c.hostname)).toEqual(['acme.cluster-abc123.eu-west-1.rds.amazonaws.com', 'acme-proxy.proxy-abc123.eu-west-1.rds.amazonaws.com'])
  })

  it('sslmode=disable is respected (local simulation); sslmode=no-verify stays unverified', () => {
    expect(pgConnectionConfig(`${RDS_URL}?sslmode=disable`, {}, { DATABASE_AUTH: 'aws' }).ssl).toBe(false)
    expect(pgConnectionConfig(`${RDS_URL}?sslmode=no-verify`, {}, { DATABASE_AUTH: 'aws' }).ssl).toMatchObject({ rejectUnauthorized: false })
  })

  it('verifies against DATABASE_SSL_CA_FILE, or the shipped RDS bundle', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rds-ca-'))
    const file = path.join(dir, 'ca.pem')
    writeFileSync(file, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n')
    const config = pgConnectionConfig(RDS_URL, {}, { DATABASE_AUTH: 'aws', DATABASE_SSL_CA_FILE: file })
    expect((config.ssl as { ca?: string }).ca).toContain('TEST')
    // The repository ships deploy/aws/rds-global-bundle.pem (the image copies it to certs/).
    expect(databaseCaFile('aws', {})).toMatch(/rds-global-bundle\.pem$/)
    expect(databaseCaFile('password', {})).toBeNull()
    expect(() => pgConnectionConfig(RDS_URL, {}, { DATABASE_AUTH: 'aws', DATABASE_SSL_CA_FILE: path.join(dir, 'missing.pem') })).toThrow(/cannot be read/)
  })

  it('password mode is unchanged unless DATABASE_SSL_CA_FILE is set', () => {
    const url = 'postgresql://app:secret@db.example.com:5432/usertasks?sslmode=verify-full'
    expect(pgConnectionConfig(url, {}, {})).toEqual({ connectionString: url })
    const dir = mkdtempSync(path.join(tmpdir(), 'pg-ca-'))
    writeFileSync(path.join(dir, 'ca.pem'), 'PEM')
    const config = pgConnectionConfig(url, {}, { DATABASE_SSL_CA_FILE: path.join(dir, 'ca.pem') })
    expect(config).toMatchObject({ user: 'app', password: 'secret', ssl: { ca: 'PEM' } })
  })

  it('describes the mode without secrets', () => {
    const text = describeDatabaseAuth(RDS_URL, { DATABASE_AUTH: 'aws' })
    expect(text).toMatch(/RDS IAM token for app_iam@acme\.cluster-abc123\.eu-west-1\.rds\.amazonaws\.com:5432 in eu-west-1/)
    expect(text).toMatch(/TLS verified with rds-global-bundle\.pem/)
    expect(text).not.toContain('never-logged-secret')
    expect(describeDatabaseAuth('postgresql://u:pw@h/d', {})).toBe('password')
  })
})

describe('RDS token refresh timing', () => {
  it('a 15-minute token is reused for 10 minutes, then reissued before it expires', async () => {
    let now = 1_000_000
    let n = 0
    const fetchToken = vi.fn(async () => ({ token: `t${++n}`, expiresAt: now + RDS_TOKEN_LIFETIME_MS }))
    const get = cachedTokenSource(fetchToken, () => now)
    expect(await get()).toBe('t1')
    now += 9 * 60_000 + 59_000
    expect(await get()).toBe('t1')
    now += 2_000 // 10 min 1 s: inside the 5-minute margin of the 15-minute token
    expect(await get()).toBe('t2')
    expect(fetchToken).toHaveBeenCalledTimes(2)
  })

  it('a signer failure is not cached and carries no credentials', async () => {
    getAuthToken.mockRejectedValueOnce(new Error('Could not load credentials from any providers'))
    const config = pgConnectionConfig(RDS_URL, {}, { DATABASE_AUTH: 'aws' })
    const password = config.password as () => Promise<string>
    const error = await password().catch((e: Error) => e)
    expect(String(error)).toMatch(/Could not load credentials/)
    expect(String(error)).not.toContain('never-logged-secret')
    expect(await password()).toBe('rds-token')
  })
})

describe.skipIf(!process.env.EVENT_STREAM_DB_URL)('IAM token simulation against a real server', () => {
  it('new connections use reissued tokens; open ones survive the old token being revoked', { timeout: 20_000 }, async () => {
    const { Client, Pool } = await import('pg')
    const admin = new Client({ connectionString: process.env.EVENT_STREAM_DB_URL })
    await admin.connect()
    const role = `ut_iam_${randomUUID().slice(0, 8)}`
    let generation = 0
    const tokenFor = (g: number) => `iam-token-${role}-${g}`
    // The "RDS" accepts exactly the current token, like an rds_iam role does.
    const rotate = async () => {
      generation += 1
      await admin.query(`ALTER ROLE ${role} PASSWORD '${tokenFor(generation)}'`)
      return tokenFor(generation)
    }
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'unused'`)
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    let pool: InstanceType<typeof Pool> | null = null
    try {
      issue = () => tokenFor(generation)
      await rotate()
      const url = new URL(process.env.EVENT_STREAM_DB_URL!)
      url.username = role
      url.password = ''
      url.searchParams.set('sslmode', 'disable')
      pool = new Pool(pgConnectionConfig(url.toString(), { max: 2, application_name: 'pg-auth-aws-test' }, { DATABASE_AUTH: 'aws', DATABASE_AWS_REGION: 'eu-west-1' }))
      const held = await pool.connect()
      expect((await held.query('SELECT current_user AS who')).rows[0].who).toBe(role)
      expect(getAuthToken).toHaveBeenCalledTimes(1)

      // 11 minutes later the cached token is due for renewal; the server now only takes the new one.
      vi.setSystemTime(Date.now() + 11 * 60_000)
      await rotate()
      const fresh = await pool.connect()
      expect((await fresh.query('SELECT 1 AS ok')).rows[0].ok).toBe(1)
      expect(getAuthToken).toHaveBeenCalledTimes(2)
      // The connection opened with the old token keeps working.
      expect((await held.query('SELECT 2 AS ok')).rows[0].ok).toBe(2)
      held.release()
      fresh.release()
    } finally {
      await pool?.end()
      await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined)
      await admin.end()
    }
  })
})
