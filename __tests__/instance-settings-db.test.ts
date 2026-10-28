/**
 * 20261104000000_instance_settings.sql against a LOCAL Supabase stack:
 *  - anon and authenticated (any signed-in member) can't read or write
 *    instance_settings — directly in SQL or through the REST API;
 *  - the service role can, and the service (lib/config/instance-settings)
 *    round-trips plain and encrypted values through the real REST API;
 *  - a secret row must hold lib/secret-crypto ciphertext (CHECK constraint),
 *    and keys outside the known namespaces are refused.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/instance-settings-db.test.ts
 * API: LOCKDOWN_SUPABASE_URL / LOCKDOWN_ANON_KEY / LOCKDOWN_SERVICE_ROLE_KEY,
 * defaulting to the standard local stack and its public demo keys.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY = process.env.LOCKDOWN_ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const KEYS = ['email.instance_settings_test', 'email.instance_settings_secret_test', 'providers.email']

describe.skipIf(!DB_URL)('instance_settings (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const prevEnv = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    enc: process.env.ENCRYPTION_KEY,
  }
  let prevProvider: unknown

  beforeAll(async () => {
    await db.connect()
    const { rows } = await db.query(`SELECT value FROM public.instance_settings WHERE key = 'providers.email'`)
    prevProvider = rows[0]?.value
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
    vi.resetModules()
  })

  afterAll(async () => {
    await db.query('DELETE FROM public.instance_settings WHERE key = ANY($1)', [KEYS])
    if (prevProvider !== undefined) {
      await db.query(`INSERT INTO public.instance_settings (key, value) VALUES ('providers.email', $1)`, [JSON.stringify(prevProvider)])
    }
    await db.end()
    for (const [name, value] of [['NEXT_PUBLIC_SUPABASE_URL', prevEnv.url], ['SUPABASE_SERVICE_ROLE_KEY', prevEnv.key], ['ENCRYPTION_KEY', prevEnv.enc]] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  async function asRole(role: 'anon' | 'authenticated', sql: string, params: unknown[] = []): Promise<string> {
    await db.query('BEGIN')
    try {
      await db.query(`SET LOCAL ROLE ${role}`)
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(role === 'anon' ? { role } : { sub: '00000000-0000-4000-8000-0000000000aa', role, aud: 'authenticated' }),
      ])
      const res = await db.query(sql, params)
      return `ok:${res.rowCount}`
    } catch (e) {
      return `err:${(e as { code?: string }).code}`
    } finally {
      await db.query('ROLLBACK')
    }
  }

  it('denies anon and authenticated in SQL (no grants)', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      expect(await asRole(role, 'SELECT * FROM public.instance_settings')).toBe('err:42501')
      expect(await asRole(role, `INSERT INTO public.instance_settings (key, value) VALUES ('email.instance_settings_test', '"x"')`)).toBe('err:42501')
      expect(await asRole(role, `UPDATE public.instance_settings SET value = '"x"'`)).toBe('err:42501')
      expect(await asRole(role, 'DELETE FROM public.instance_settings')).toBe('err:42501')
    }
  })

  it('denies the anon REST client and allows the service role', async () => {
    const anon = createClient(API_URL, ANON_KEY, opts)
    const { error: readError } = await anon.from('instance_settings').select('key')
    expect(readError?.code).toBe('42501')
    const { error: writeError } = await anon.from('instance_settings').insert({ key: 'email.instance_settings_test', value: 'x' })
    expect(writeError?.code).toBe('42501')

    const service = createClient(API_URL, SERVICE_KEY, opts)
    const { error } = await service.from('instance_settings').select('key').limit(1)
    expect(error).toBeNull()
  })

  it('refuses plaintext secrets and unknown keys at the database', async () => {
    await expect(db.query(`INSERT INTO public.instance_settings (key, value, secret) VALUES ('email.instance_settings_secret_test', '"plain"', true)`))
      .rejects.toMatchObject({ code: '23514' })
    await expect(db.query(`INSERT INTO public.instance_settings (key, value) VALUES ('supabase.url', '"x"')`))
      .rejects.toMatchObject({ code: '23514' })
  })

  it('the service round-trips plain and encrypted values through REST; getConfig sees them', async () => {
    const svc = await import('@/lib/config/instance-settings')
    await svc.setInstanceSetting('email.instance_settings_test', { a: 1 })
    await svc.setInstanceSetting('email.instance_settings_secret_test', 'smtp-password', { secret: true })
    await svc.setInstanceSetting('providers.email', 'console')

    const { rows } = await db.query(`SELECT value, secret FROM public.instance_settings WHERE key = 'email.instance_settings_secret_test'`)
    expect(rows[0].secret).toBe(true)
    expect(rows[0].value).toMatch(/^enc:v1:/)
    expect(JSON.stringify(rows[0])).not.toContain('smtp-password')

    svc.invalidateInstanceSettingsCache()
    expect(await svc.getInstanceSetting('email.instance_settings_test')).toEqual({ a: 1 })
    expect(await svc.getInstanceSetting('email.instance_settings_secret_test')).toBe('smtp-password')

    const { getProviderConfig } = await import('@/lib/config')
    const email = await getProviderConfig('email')
    expect(email).toMatchObject({ id: 'console', source: 'settings' })
    expect(email.options).toMatchObject({ instance_settings_test: { a: 1 }, instance_settings_secret_test: 'smtp-password' })

    const listed = await svc.listInstanceSettings()
    expect(listed.find((s) => s.key === 'email.instance_settings_secret_test')?.value).toBe('********')
    await svc.deleteInstanceSetting('providers.email')
  })
})
