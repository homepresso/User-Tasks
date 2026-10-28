import { describe, expect, it, vi } from 'vitest'

const azureGetToken = vi.fn(async () => ({ token: 'entra-token', expiresOnTimestamp: Date.now() + 3_600_000 }))
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class { getToken = azureGetToken },
}))
const googleGetAccessToken = vi.fn(async () => 'gcp-token')
const googleAuthOptions: unknown[] = []
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    constructor(options: unknown) { googleAuthOptions.push(options) }
    getAccessToken = googleGetAccessToken
  },
}))

import { AZURE_PG_SCOPE, cachedTokenSource, databaseAuthMode, pgConnectionConfig } from '@/lib/providers/db/pg-auth'

describe('DATABASE_AUTH', () => {
  it('defaults to passwords and accepts the documented aliases', () => {
    expect(databaseAuthMode({})).toBe('password')
    expect(databaseAuthMode({ DATABASE_AUTH: 'password' })).toBe('password')
    expect(databaseAuthMode({ DATABASE_AUTH: 'Azure' })).toBe('azure')
    expect(databaseAuthMode({ DATABASE_AUTH: 'entra' })).toBe('azure')
    expect(databaseAuthMode({ DATABASE_AUTH: 'gcp' })).toBe('gcp')
    expect(databaseAuthMode({ DATABASE_AUTH: 'cloudsql_iam' })).toBe('gcp')
    expect(() => databaseAuthMode({ DATABASE_AUTH: 'kerberos' })).toThrow(/password, azure, gcp or aws/)
  })

  it('password mode passes the URL through unchanged', () => {
    const url = 'postgresql://app:secret@db.example.com:5432/usertasks?sslmode=verify-full'
    expect(pgConnectionConfig(url, { max: 4 }, {})).toEqual({ max: 4, connectionString: url })
  })

  it('azure mode: the Entra token for Azure Database for PostgreSQL is the password', async () => {
    const config = pgConnectionConfig('postgresql://app-identity@srv.postgres.database.azure.com:5432/usertasks?sslmode=require', { max: 4 }, { DATABASE_AUTH: 'azure' })
    expect(config).toMatchObject({ max: 4, user: 'app-identity', host: 'srv.postgres.database.azure.com', port: 5432, database: 'usertasks' })
    expect(config.ssl).toBeTruthy()
    expect(config).not.toHaveProperty('connectionString')
    expect(typeof config.password).toBe('function')
    expect(await (config.password as () => Promise<string>)()).toBe('entra-token')
    expect(azureGetToken).toHaveBeenCalledWith(AZURE_PG_SCOPE)
    // Cached across connections.
    await (config.password as () => Promise<string>)()
    expect(azureGetToken).toHaveBeenCalledTimes(1)
  })

  it('gcp mode: an IAM access token (sqlservice.login scope) is the password', async () => {
    const config = pgConnectionConfig('postgresql://svc@10.0.0.5/usertasks', {}, { DATABASE_AUTH: 'gcp' })
    expect(config).toMatchObject({ user: 'svc', host: '10.0.0.5', database: 'usertasks' })
    expect(await (config.password as () => Promise<string>)()).toBe('gcp-token')
    expect(googleAuthOptions[0]).toEqual({ scopes: ['https://www.googleapis.com/auth/sqlservice.login'] })
  })
})

describe('cachedTokenSource', () => {
  it('reuses a token until five minutes before expiry and shares concurrent fetches', async () => {
    let now = 1_000_000
    let n = 0
    const fetchToken = vi.fn(async () => ({ token: `t${++n}`, expiresAt: now + 60 * 60_000 }))
    const get = cachedTokenSource(fetchToken, () => now)
    expect(await Promise.all([get(), get()])).toEqual(['t1', 't1'])
    expect(fetchToken).toHaveBeenCalledTimes(1)
    now += 54 * 60_000
    expect(await get()).toBe('t1')
    now += 2 * 60_000 // inside the 5-minute margin
    expect(await get()).toBe('t2')
  })

  it('a failed fetch is not cached', async () => {
    const fetchToken = vi.fn()
      .mockRejectedValueOnce(new Error('IMDS unavailable'))
      .mockResolvedValueOnce({ token: 'ok', expiresAt: Date.now() + 3_600_000 })
    const get = cachedTokenSource(fetchToken)
    await expect(get()).rejects.toThrow('IMDS unavailable')
    expect(await get()).toBe('ok')
  })
})

describe.skipIf(!process.env.EVENT_STREAM_DB_URL)('token password against a real server', () => {
  it('node-postgres authenticates with the callback, not the URL (local DB)', async () => {
    const url = new URL(process.env.EVENT_STREAM_DB_URL!)
    const secret = decodeURIComponent(url.password)
    url.password = ''
    // The "token" the cloud would issue is the role's password here.
    googleGetAccessToken.mockResolvedValueOnce(secret)
    vi.resetModules()
    const fresh = await import('@/lib/providers/db/pg-auth')
    const { Client } = await import('pg')
    const client = new Client(fresh.pgConnectionConfig(url.toString(), { application_name: 'pg-auth-test' }, { DATABASE_AUTH: 'gcp' }))
    await client.connect()
    try {
      const { rows } = await client.query('SELECT current_user AS who')
      expect(rows[0].who).toBe(decodeURIComponent(url.username))
      expect(googleGetAccessToken).toHaveBeenCalled()
    } finally {
      await client.end()
    }
  })
})

describe.skipIf(!process.env.EVENT_STREAM_DB_URL)('Entra and Cloud SQL IAM tokens against a real server (fake token providers)', () => {
  for (const mode of ['azure', 'gcp'] as const) {
    it(`${mode}: the provider's token is the password, and a renewed token is used for new connections`, { timeout: 20_000 }, async () => {
      const { randomUUID } = await import('node:crypto')
      const { Client, Pool } = await import('pg')
      const admin = new Client({ connectionString: process.env.EVENT_STREAM_DB_URL })
      await admin.connect()
      const role = `ut_${mode}_${randomUUID().slice(0, 8)}`
      let generation = 1
      const tokenFor = (g: number) => `${mode}-token-${role}-${g}`
      await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${tokenFor(1)}'`)
      // Azure reports its expiry; the Google path re-asks every 30 minutes.
      let now = Date.now()
      azureGetToken.mockImplementation(async () => ({ token: tokenFor(generation), expiresOnTimestamp: now + 60 * 60_000 }))
      googleGetAccessToken.mockImplementation(async () => tokenFor(generation))
      vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
      vi.resetModules()
      const fresh = await import('@/lib/providers/db/pg-auth')
      const url = new URL(process.env.EVENT_STREAM_DB_URL!)
      url.username = role
      url.password = ''
      const pool = new Pool(fresh.pgConnectionConfig(url.toString(), { max: 2 }, { DATABASE_AUTH: mode }))
      try {
        const held = await pool.connect()
        expect((await held.query('SELECT current_user AS who')).rows[0].who).toBe(role)
        // An hour later the cached token is stale; the database only accepts the renewed one.
        now += 61 * 60_000
        vi.setSystemTime(now)
        generation = 2
        await admin.query(`ALTER ROLE ${role} PASSWORD '${tokenFor(2)}'`)
        const second = await pool.connect()
        expect((await second.query('SELECT 1 AS ok')).rows[0].ok).toBe(1)
        expect((await held.query('SELECT 2 AS ok')).rows[0].ok).toBe(2)
        held.release()
        second.release()
      } finally {
        vi.useRealTimers()
        await pool.end()
        await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined)
        await admin.end()
      }
    })
  }
})
