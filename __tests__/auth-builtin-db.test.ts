/**
 * Built-in auth (AUTH_PROVIDER=builtin) against the local stack's database:
 * sign-up for an invited email, confirmation and reset links through the
 * console email provider, password sign-in, lockout, sessions (rolling,
 * revocation, reuse after sign-out), cookie flags, the idempotent
 * provisioning shared with the Supabase trigger, and RLS through the session
 * database client under both db providers (pg-query claims, and a minted
 * HS256 JWT for PostgREST).
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/auth-builtin-db.test.ts
 * The service client uses the stack's API (http://127.0.0.1:54321, demo keys).
 * Rows it creates are removed afterwards.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { dataApiProvider, dbCapabilities } from './helpers/db-capabilities'
import { cookieWrites, jar, requestHeaders, resetRequest } from './helpers/next-headers-mock'

vi.mock('next/headers', () => import('./helpers/next-headers-mock'))

const DB_URL = process.env.EVENT_STREAM_DB_URL
// The stack's PostgREST on a Supabase database; pg-query on plain Postgres.
const DATA_API = dataApiProvider(await dbCapabilities())
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET_LOCAL ?? 'super-secret-jwt-token-with-at-least-32-characters-long'

const RUN = randomUUID().slice(0, 8)
const SLUG = `auth-builtin-${RUN}`
const emailFor = (name: string) => `${name}-${RUN}@auth-builtin.test`

const ENV_KEYS = [
  'AUTH_PROVIDER', 'DB_PROVIDER', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET',
  'EMAIL_PROVIDER', 'EMAIL_CONSOLE_DIR', 'APP_URL', 'AUTH_LOCKOUT_THRESHOLD', 'AUTH_ALLOW_SIGNUP',
] as const
const saved: Record<string, string | undefined> = {}

/** Decoded text of the newest console email to `to`. */
function latestEmail(dir: string, to: string): string {
  const files = readdirSync(dir).filter((f) => f.endsWith('.eml')).sort()
  for (const file of files.reverse()) {
    const raw = readFileSync(path.join(dir, file), 'utf8')
    if (!raw.includes(to)) continue
    // Bodies are base64 blocks (lib/providers/email/mime); decode each.
    const blocks = raw.match(/(?:^[A-Za-z0-9+/=]{8,}\r?$\n?)+/gm) ?? []
    return [raw, ...blocks.map((b) => Buffer.from(b.replace(/\s+/g, ''), 'base64').toString('utf8'))].join('\n')
  }
  throw new Error(`no email to ${to}`)
}

function linkToken(text: string, pathName: string): string {
  const m = new RegExp(`${pathName.replace(/[/-]/g, '\\$&')}\\?token=([A-Za-z0-9_%-]+)`).exec(text)
  if (!m) throw new Error(`no ${pathName} link`)
  return decodeURIComponent(m[1])
}

function sessionCookie(): string | undefined {
  return jar.get('__Host-ut_session') ?? jar.get('ut_session')
}

describe.skipIf(!DB_URL)('built-in auth (local stack)', () => {
  const pg = new Client({ connectionString: DB_URL })
  let mailDir = ''
  let tenantId = ''
  let inviterId = ''
  const createdUsers: string[] = []
  let auth: typeof import('@/lib/providers/auth')
  let provider: import('@/lib/providers/auth').AuthProvider

  beforeAll(async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    mailDir = mkdtempSync(path.join(tmpdir(), 'ut-auth-mail-'))
    Object.assign(process.env, {
      AUTH_PROVIDER: 'builtin',
      DB_PROVIDER: DATA_API,
      DATABASE_URL: DB_URL,
      ...(DATA_API === 'supabase'
        ? { SUPABASE_URL: API_URL, SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_JWT_SECRET: JWT_SECRET }
        : {}),
      EMAIL_PROVIDER: 'console',
      EMAIL_CONSOLE_DIR: mailDir,
      APP_URL: 'https://app.test',
      AUTH_LOCKOUT_THRESHOLD: '3',
    })
    delete process.env.AUTH_ALLOW_SIGNUP
    await pg.connect()
    const { rows: inviter } = await pg.query<{ id: string }>('SELECT id FROM public.users ORDER BY created_at LIMIT 1')
    inviterId = inviter[0]?.id
    if (!inviterId) {
      // A fresh database (plain Postgres): provision an inviter the app's way.
      inviterId = randomUUID()
      createdUsers.push(inviterId)
      await pg.query('SELECT public.provision_auth_user($1, $2, NULL, $3)', [inviterId, emailFor('inviter'), 'email'])
    }
    const { rows } = await pg.query<{ id: string }>(`INSERT INTO public.tenants (name, slug) VALUES ($1, $2) RETURNING id`, [`Auth ${RUN}`, SLUG])
    tenantId = rows[0].id
    auth = await import('@/lib/providers/auth')
    provider = auth.resolveAuthProvider('builtin')
  }, 60_000)

  afterAll(async () => {
    if (pg) {
      const ids = createdUsers
      if (ids.length) {
        await pg.query(`DELETE FROM public.user_roles WHERE user_id = ANY($1)`, [ids])
        await pg.query(`DELETE FROM public.user_memberships WHERE user_id = ANY($1)`, [ids])
        await pg.query(`DELETE FROM public.users WHERE id = ANY($1)`, [ids])
        await pg.query(`DELETE FROM public.tenants WHERE slug = ANY($1)`, [ids.map((id) => `personal-${id.slice(0, 8)}`)])
      }
      await pg.query(`DELETE FROM public.invitations WHERE tenant_id = $1`, [tenantId]).catch(() => undefined)
      await pg.query(`DELETE FROM public.user_roles WHERE tenant_id = $1`, [tenantId]).catch(() => undefined)
      await pg.query(`DELETE FROM public.user_memberships WHERE tenant_id = $1`, [tenantId]).catch(() => undefined)
      await pg.query(`DELETE FROM public.roles WHERE tenant_id = $1`, [tenantId]).catch(() => undefined)
      await pg.query(`DELETE FROM public.workspace_themes WHERE tenant_id = $1`, [tenantId]).catch(() => undefined)
      await pg.query(`DELETE FROM public.tenants WHERE id = $1`, [tenantId]).catch(() => undefined)
      await pg.end()
    }
    const { closeAuthDb } = await import('@/lib/providers/auth/builtin/db')
    await closeAuthDb()
    rmSync(mailDir, { recursive: true, force: true })
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }, 60_000)

  beforeEach(() => resetRequest())

  async function invite(email: string, role = 'member'): Promise<string> {
    const { rows } = await pg.query<{ token: string }>(
      `INSERT INTO public.invitations (tenant_id, email, role, invited_by) VALUES ($1, $2, $3, $4) RETURNING token`,
      [tenantId, email, role, inviterId],
    )
    return rows[0].token
  }

  async function newConfirmedUser(name: string, password = 'correct-horse-1'): Promise<{ id: string; email: string }> {
    const email = emailFor(name)
    const { id } = await provider.admin.createUser({ email, password, emailConfirmed: true })
    createdUsers.push(id)
    return { id, email }
  }

  it('sign-up is invitation-only by default', async () => {
    await expect(provider.signUp({ email: emailFor('stranger'), password: 'whatever-123' })).rejects.toMatchObject({ code: 'signup_disabled' })
  })

  it('invited sign-up → confirmation email → confirm (single use) → signed in with secure cookie flags', async () => {
    const email = emailFor('invitee')
    await invite(email)
    const result = await provider.signUp({ email, password: 'invitee-pass-1', invited: true, origin: 'https://evil.example', pending: { org: SLUG } })
    createdUsers.push(result.user.id)
    expect(result.signedIn).toBe(false)
    expect(sessionCookie()).toBeUndefined()

    // Personal workspace + profile from onUserCreated (same as the Supabase trigger).
    const { rows: profile } = await pg.query('SELECT email, tenant_id FROM public.users WHERE id = $1', [result.user.id])
    expect(profile[0].email).toBe(email)

    // Sign-in before confirming is refused.
    await expect(provider.signInWithPassword(email, 'invitee-pass-1')).rejects.toMatchObject({ code: 'email_not_confirmed' })

    // The link uses APP_URL, never the request's origin (host-header poisoning).
    const mail = latestEmail(mailDir, email)
    expect(mail).toContain('https://app.test/confirm-email?token=')
    expect(mail).not.toContain('evil.example')
    const token = linkToken(mail, '/confirm-email')

    const confirmed = await provider.verifyEmail(token)
    expect(confirmed.user.id).toBe(result.user.id)
    expect(confirmed.pending).toEqual({ org: SLUG })
    const write = cookieWrites.find((w) => w.name === '__Host-ut_session' && w.value)
    expect(write?.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    expect(Number(write?.options.maxAge)).toBeGreaterThan(0)
    expect(await provider.getSessionUser()).toMatchObject({ id: result.user.id, email })

    // Token reuse.
    await expect(provider.verifyEmail(token)).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('password sign-in: success, generic failure for wrong password and unknown email', async () => {
    const { id, email } = await newConfirmedUser('signin')
    const user = await provider.signInWithPassword(email.toUpperCase(), 'correct-horse-1')
    expect(user.id).toBe(id)
    expect(sessionCookie()).toBeTruthy()

    resetRequest()
    const wrong = await provider.signInWithPassword(email, 'nope-nope-1').catch((e) => e)
    const unknown = await provider.signInWithPassword(emailFor('nobody'), 'nope-nope-1').catch((e) => e)
    expect(wrong).toMatchObject({ code: 'invalid_credentials', message: 'Invalid login credentials' })
    expect(unknown).toMatchObject({ code: 'invalid_credentials', message: 'Invalid login credentials' })
    expect(sessionCookie()).toBeUndefined()
  })

  it('locks the account after repeated failures, even for the right password', async () => {
    const { id, email } = await newConfirmedUser('lockout')
    await expect(provider.signInWithPassword(email, 'bad-1')).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(provider.signInWithPassword(email, 'bad-2')).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(provider.signInWithPassword(email, 'bad-3')).rejects.toMatchObject({ code: 'locked' })
    await expect(provider.signInWithPassword(email, 'correct-horse-1')).rejects.toMatchObject({ code: 'locked' })
    // Lock lapses → the right password works and the counter resets.
    await pg.query(`UPDATE app_auth.credentials SET locked_until = now() - interval '1 second' WHERE user_id = $1`, [id])
    await expect(provider.signInWithPassword(email, 'correct-horse-1')).resolves.toMatchObject({ id })
    const { rows } = await pg.query('SELECT failed_attempts, locked_until FROM app_auth.credentials WHERE user_id = $1', [id])
    expect(rows[0]).toMatchObject({ failed_attempts: 0, locked_until: null })
  })

  it('sessions: only a hash is stored; sign-out revokes and a replayed cookie is refused; idle and absolute expiry apply', async () => {
    const { id, email } = await newConfirmedUser('sessions')
    await provider.signInWithPassword(email, 'correct-horse-1')
    const token = sessionCookie()!
    const { rows } = await pg.query<{ token_hash: string }>('SELECT token_hash FROM app_auth.sessions WHERE user_id = $1 AND revoked_at IS NULL', [id])
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).not.toContain(token)
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)

    await provider.signOut()
    expect(sessionCookie()).toBeUndefined()
    // The attacker kept a copy of the cookie.
    jar.set('__Host-ut_session', token)
    expect(await provider.getSessionUser()).toBeNull()

    resetRequest()
    await provider.signInWithPassword(email, 'correct-horse-1')
    const live = sessionCookie()!
    await pg.query(`UPDATE app_auth.sessions SET idle_expires_at = now() - interval '1 second' WHERE user_id = $1 AND revoked_at IS NULL`, [id])
    expect(await provider.getSessionUser()).toBeNull()
    resetRequest()
    jar.set('__Host-ut_session', live)
    await pg.query(`UPDATE app_auth.sessions SET idle_expires_at = now() + interval '1 hour', expires_at = now() - interval '1 second' WHERE user_id = $1`, [id])
    expect(await provider.getSessionUser()).toBeNull()
  })

  it('password reset: no email for unknown accounts; token works once; every session is revoked; old password stops working', async () => {
    const { id, email } = await newConfirmedUser('reset')
    // Two existing sessions (two browsers).
    await provider.signInWithPassword(email, 'correct-horse-1')
    const browserA = sessionCookie()!
    resetRequest()
    await provider.signInWithPassword(email, 'correct-horse-1')

    const unknown = emailFor('ghost')
    await expect(provider.requestPasswordReset(unknown, { origin: 'https://app.test' })).resolves.toBeUndefined()
    expect(() => latestEmail(mailDir, unknown)).toThrow(/no email/)

    await provider.requestPasswordReset(email, { origin: 'https://attacker.example' })
    const mail = latestEmail(mailDir, email)
    expect(mail).toContain('https://app.test/reset-password?token=')
    const token = linkToken(mail, '/reset-password')

    await expect(provider.resetPassword({ token, password: 'short' })).rejects.toMatchObject({ code: 'weak_password' })
    resetRequest()
    const user = await provider.resetPassword({ token, password: 'brand-new-pass-2' })
    expect(user.id).toBe(id)
    expect(sessionCookie()).toBeTruthy()
    await expect(provider.resetPassword({ token, password: 'another-pass-3' })).rejects.toMatchObject({ code: 'invalid_token' })

    const { rows } = await pg.query<{ live: number }>(`SELECT count(*)::int AS live FROM app_auth.sessions WHERE user_id = $1 AND revoked_at IS NULL`, [id])
    expect(rows[0].live).toBe(1) // only the one the reset just started
    resetRequest()
    jar.set('__Host-ut_session', browserA)
    expect(await provider.getSessionUser()).toBeNull()

    resetRequest()
    await expect(provider.signInWithPassword(email, 'correct-horse-1')).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(provider.signInWithPassword(email, 'brand-new-pass-2')).resolves.toMatchObject({ id })
  })

  it('expired reset tokens are refused', async () => {
    const { email } = await newConfirmedUser('expired')
    await provider.requestPasswordReset(email, { origin: 'https://app.test' })
    const token = linkToken(latestEmail(mailDir, email), '/reset-password')
    await pg.query(`UPDATE app_auth.tokens SET expires_at = now() - interval '1 second' WHERE kind = 'password_reset' AND used_at IS NULL`)
    await expect(provider.resetPassword({ token, password: 'brand-new-pass-2' })).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('admin: duplicate email refused; setPassword revokes sessions; deleteUser removes profile and credentials', async () => {
    const { id, email } = await newConfirmedUser('admin')
    await expect(provider.admin.createUser({ email: email.toUpperCase(), password: 'x-123456' })).rejects.toMatchObject({ code: 'user_exists' })
    await provider.signInWithPassword(email, 'correct-horse-1')
    await provider.admin.setPassword(id, 'set-by-admin-9')
    expect(await provider.getSessionUser()).toBeNull()
    await provider.admin.deleteUser(id)
    const { rows } = await pg.query('SELECT (SELECT count(*) FROM public.users WHERE id = $1)::int AS users, (SELECT count(*) FROM app_auth.credentials WHERE user_id = $1)::int AS creds', [id])
    expect(rows[0]).toEqual({ users: 0, creds: 0 })
  })

  it('provisioning is idempotent and shared with the Supabase trigger (no double-create)', async () => {
    const id = randomUUID()
    createdUsers.push(id)
    const email = emailFor('trigger')
    // Supabase path: the auth.users trigger provisions…
    await pg.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [id, email])
    // …and the app path afterwards is a no-op.
    const { rows } = await pg.query<{ created: boolean }>('SELECT public.provision_auth_user($1, $2, NULL, $3) AS created', [id, email, 'email'])
    expect(rows[0].created).toBe(false)
    const { rows: counts } = await pg.query(
      `SELECT (SELECT count(*) FROM public.users WHERE id = $1)::int AS users,
              (SELECT count(*) FROM public.user_memberships WHERE user_id = $1)::int AS memberships`,
      [id],
    )
    expect(counts[0]).toEqual({ users: 1, memberships: 1 })
    // Deleting the Supabase auth user still removes the profile (trigger replaces the old FK cascade).
    await pg.query('DELETE FROM auth.users WHERE id = $1', [id])
    const { rows: after } = await pg.query('SELECT count(*)::int AS n FROM public.users WHERE id = $1', [id])
    expect(after[0].n).toBe(0)
  })

  it('the API roles cannot reach app_auth', async () => {
    for (const role of ['anon', 'authenticated']) {
      await pg.query('BEGIN')
      await pg.query(`SET LOCAL ROLE ${role}`)
      const error = await pg.query('SELECT * FROM app_auth.credentials LIMIT 1').catch((e) => e)
      await pg.query('ROLLBACK')
      expect(error?.code).toBe('42501')
    }
  })

  // The supabase variant needs the stack's PostgREST in front of this database.
  describe.each(DATA_API === 'supabase' ? ['supabase', 'postgres'] as const : ['postgres'] as const)('RLS through the session client (DB_PROVIDER=%s)', (dbProvider) => {
    it('a built-in session sees its own workspace and nothing of another', async () => {
      process.env.DB_PROVIDER = dbProvider
      try {
        const member = await newConfirmedUser(`rls-${dbProvider}`)
        const { grantTenantRole } = await import('@/lib/providers/auth/provisioning')
        expect(await grantTenantRole(member.id, SLUG, 'member', { setHome: true })).toBe(true)
        const outsider = await newConfirmedUser(`rls-out-${dbProvider}`)

        const { createClient, getCachedUser } = await import('@/lib/supabase/server')
        resetRequest()
        await provider.signInWithPassword(member.email, 'correct-horse-1')
        expect((await getCachedUser())?.id).toBe(member.id)
        const db = await createClient()
        const { data: tenants, error } = await db.from('tenants').select('id, slug').eq('id', tenantId)
        expect(error).toBeNull()
        expect(tenants).toEqual([{ id: tenantId, slug: SLUG }])
        const { data: others } = await db.from('users').select('id').eq('id', outsider.id)
        expect(others).toEqual([])
        const { data: me } = await db.rpc('get_user_role_in_tenant' as never)
        expect(me).toBe('member')

        // Signed out: anonymous, RLS hides the tenant.
        resetRequest()
        const anon = await createClient()
        const { data: none } = await anon.from('tenants').select('id').eq('id', tenantId)
        expect(none ?? []).toEqual([])
      } finally {
        process.env.DB_PROVIDER = 'supabase'
        if (dbProvider === 'postgres') {
          const { closePostgresDb } = await import('@/lib/providers/db/postgres')
          await closePostgresDb()
        }
      }
    }, 30_000)
  })

  it('records the request IP and user agent on the session', async () => {
    const { id, email } = await newConfirmedUser('ctx')
    requestHeaders.set('user-agent', 'vitest')
    await provider.signInWithPassword(email, 'correct-horse-1', { ip: '203.0.113.9', userAgent: 'vitest' })
    const { rows } = await pg.query('SELECT ip, user_agent, method FROM app_auth.sessions WHERE user_id = $1', [id])
    expect(rows[0]).toEqual({ ip: '203.0.113.9', user_agent: 'vitest', method: 'password' })
  })
})
