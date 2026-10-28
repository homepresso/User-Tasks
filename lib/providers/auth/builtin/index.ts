import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { getProviderConfig } from '@/lib/config'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import type { ProviderId } from '@/lib/config/schema'
import { rateLimit as countHit } from '@/lib/rate-limit'
import { authCookieOptions, SESSION_COOKIE_NAMES, sessionCookieName, ssoFlowCookieName } from '../cookies'
import { dbIdentityFor, mintSupabaseAccessToken } from '../db-identity'
import { authSettings, type AuthSettings } from '../options'
import { onUserCreated } from '../provisioning'
import { getSsoProvider, getSsoProviders, ssoDisplay } from '../sso/config'
import { startOidc } from '../sso/oidc'
import { startSaml } from '../sso/saml'
import { AuthError, type AuthProvider, type AuthRequestContext, type SessionUser, type SignUpInput } from '../types'
import { authDb } from './db'
import { sendConfirmationEmail, sendPasswordResetEmail } from './emails'
import { checkPasswordPolicy, hashPassword, verifyPassword } from './passwords'
import {
  confirmEmail,
  consumeToken,
  createSession,
  findCredentialByEmail,
  findCredentialById,
  findSession,
  insertCredential,
  issueToken,
  listIdentities,
  purgeExpired,
  recordFailedLogin,
  recordSuccessfulLogin,
  revokeSession,
  revokeUserSessions,
  setPasswordHash,
  touchSession,
  updateCredentialEmail,
} from './store'

/**
 * Built-in auth: accounts, bcrypt hashes and sessions in Postgres
 * (app_auth, ./store), session cookie set server-side (HttpOnly, SameSite=Lax,
 * Secure, `__Host-` on https), account emails through the EmailProvider.
 *
 *  - builtin: email + password (sign-up for invited emails, or anyone with
 *    allow_signup), confirmation and reset links, plus configured SSO IdPs.
 *  - oidc / saml: the same sessions, SSO-only (password routes refuse).
 *
 * Sessions: opaque 256-bit token, SHA-256 in the database, rolling idle
 * expiry (session_idle_hours) capped by an absolute one (session_max_days);
 * revoked on sign-out, and all of a user's sessions on a password change or
 * reset. Brute force: per-IP and per-email rate limits plus an account
 * lockout after lockout_threshold wrong passwords.
 */

const TOUCH_INTERVAL_MS = 5 * 60_000
const CONFIRMATION_TTL_MS = 24 * 3600_000
const RESET_TTL_MS = 3600_000
const LOGIN_WINDOW_MS = 15 * 60_000

async function settings(): Promise<AuthSettings> {
  return authSettings((await getProviderConfig('auth')).options)
}

/** Links in emails use the configured origin (APP_URL), not the request's Host header. */
function linkOrigin(requestOrigin: string): string {
  return (configuredAppUrl()?.trim() || requestOrigin).replace(/\/+$/, '')
}

async function cookieStore() {
  return cookies()
}

async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookieStore()
  const name = sessionCookieName()
  for (const other of SESSION_COOKIE_NAMES) if (other !== name) store.delete(other)
  store.set(name, token, authCookieOptions((expiresAt.getTime() - Date.now()) / 1000))
}

async function clearSessionCookie(): Promise<void> {
  const store = await cookieStore()
  for (const name of SESSION_COOKIE_NAMES) {
    try {
      store.set(name, '', { ...authCookieOptions(0), secure: name.startsWith('__Host-') || authCookieOptions().secure })
    } catch {
      // Server Component render: cookies are read-only there.
    }
  }
}

async function sessionToken(): Promise<string | null> {
  const store = await cookieStore()
  for (const name of SESSION_COOKIE_NAMES) {
    const value = store.get(name)?.value
    if (value) return value
  }
  return null
}

/** This request's session (deduped per request), sliding its idle expiry. */
const currentSession = cache(async (): Promise<{ user: SessionUser; sessionId: string; token: string } | null> => {
  const token = await sessionToken()
  if (!token) return null
  const row = await findSession(token)
  if (!row) return null
  if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
    const { sessionIdleMs } = await settings()
    await touchSession(row.id, sessionIdleMs).catch(() => undefined)
  }
  return { user: { id: row.user_id, email: row.email }, sessionId: row.id, token }
})

async function startSession(userId: string, method: string, ctx: AuthRequestContext | undefined): Promise<void> {
  const s = await settings()
  const session = await createSession({ userId, method, idleMs: s.sessionIdleMs, maxMs: s.sessionMaxMs, ip: ctx?.ip, userAgent: ctx?.userAgent })
  await setSessionCookie(session.token, session.expiresAt)
  // Opportunistic housekeeping (~1 in 50 sign-ins).
  if (Math.random() < 0.02) void purgeExpired().catch(() => undefined)
}

/** Sign `userId` in with a fresh session (SSO callbacks, email confirmation). */
export async function startBuiltinSession(userId: string, method: string, ctx?: AuthRequestContext): Promise<void> {
  await startSession(userId, method, ctx)
}

async function rateLimit(key: string, max: number): Promise<void> {
  const result = await countHit(key, { max, windowMs: LOGIN_WINDOW_MS })
  if (!result.ok) {
    throw new AuthError('rate_limited', `Too many attempts. Try again in ${Math.max(1, Math.ceil(result.retryAfterMs / 60_000))} minute(s).`)
  }
}

function requirePasswordMode(id: ProviderId<'auth'>): void {
  if (id !== 'builtin') throw new AuthError('not_supported', 'Password sign-in is disabled: sign in with your organisation’s single sign-on.')
}

export function createBuiltinAuthProvider(id: Exclude<ProviderId<'auth'>, 'supabase'>): AuthProvider {
  return {
    id,
    onPrem: true,

    async getSessionUser() {
      return (await currentSession())?.user ?? null
    },

    async signInWithPassword(rawEmail, password, ctx) {
      requirePasswordMode(id)
      const email = rawEmail.trim().toLowerCase()
      if (ctx?.ip) await rateLimit(`auth:login:ip:${ctx.ip}`, 50)
      await rateLimit(`auth:login:email:${email}`, 20)
      const s = await settings()
      const credential = await findCredentialByEmail(email)
      if (credential?.locked_until && new Date(credential.locked_until).getTime() > Date.now()) {
        throw new AuthError('locked', 'Too many failed attempts. This account is locked for a few minutes.')
      }
      const ok = await verifyPassword(password, credential?.password_hash)
      if (!credential || !ok) {
        if (credential) {
          const lockedUntil = await recordFailedLogin(credential.user_id, s.lockoutThreshold, s.lockoutMs)
          if (lockedUntil) throw new AuthError('locked', 'Too many failed attempts. This account is locked for a few minutes.')
        }
        throw new AuthError('invalid_credentials', 'Invalid login credentials')
      }
      if (!credential.email_confirmed_at && s.requireEmailConfirmation) {
        throw new AuthError('email_not_confirmed', 'Email not confirmed')
      }
      await recordSuccessfulLogin(credential.user_id)
      await startSession(credential.user_id, 'password', ctx)
      return { id: credential.user_id, email: credential.email }
    },

    async signUp(input, ctx) {
      requirePasswordMode(id)
      const s = await settings()
      if (!s.allowSignup && !input.invited) throw new AuthError('signup_disabled', 'Sign-up is by invitation only.')
      if (ctx?.ip) await rateLimit(`auth:signup:ip:${ctx.ip}`, 20)
      checkPasswordPolicy(input.password, s.passwordMinLength)
      const email = input.email.trim().toLowerCase()
      if (await findCredentialByEmail(email)) throw new AuthError('user_exists', 'User already registered')

      const confirmed = Boolean(input.emailConfirmed) || !s.requireEmailConfirmation
      const userId = randomUUID()
      const passwordHash = await hashPassword(input.password)
      const displayName = input.displayName ?? email.split('@')[0]
      const db = authDb()
      try {
        await db.transaction(async (tx) => {
          await onUserCreated(tx, { id: userId, email, displayName })
          await insertCredential({ userId, email, passwordHash, emailConfirmed: confirmed, metadata: { full_name: displayName } }, tx)
        })
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new AuthError('user_exists', 'User already registered')
        throw error
      }
      const user: SessionUser = { id: userId, email, user_metadata: { full_name: displayName } }
      if (confirmed) {
        await startSession(userId, 'password', ctx)
        return { user, signedIn: true }
      }
      const origin = linkOrigin(input.origin ?? '')
      const token = await issueToken({ userId, kind: 'email_confirmation', ttlMs: CONFIRMATION_TTL_MS, data: input.pending ?? {} })
      await sendConfirmationEmail(email, origin, token)
      return { user, signedIn: false }
    },

    async signOut(options) {
      const session = await currentSession()
      const token = session?.token ?? (await sessionToken())
      if (options?.everywhere && session) await revokeUserSessions(session.user.id)
      else if (token) await revokeSession(token)
      await clearSessionCookie()
    },

    async startSso(idpId, { redirect, org, origin }) {
      const idp = await getSsoProvider(idpId)
      if (!idp) throw new AuthError('not_supported', `Unknown sign-in provider "${idpId}"`)
      const base = linkOrigin(origin)
      if (idp.type === 'oidc') {
        const { url, binding } = await startOidc(idp, { origin: base, redirect, org })
        ;(await cookieStore()).set(ssoFlowCookieName(), binding, authCookieOptions(600))
        return url
      }
      return startSaml(idp, { origin: base, redirect, org })
    },

    async handleCallback() {
      throw new AuthError('not_supported', 'Use the SSO callback routes (/auth/sso/<id>/callback, /auth/saml/<id>/acs)')
    },

    async requestPasswordReset(rawEmail, { origin }, ctx) {
      requirePasswordMode(id)
      const email = rawEmail.trim().toLowerCase()
      if (ctx?.ip) await rateLimit(`auth:reset:ip:${ctx.ip}`, 20)
      await rateLimit(`auth:reset:email:${email}`, 5)
      const credential = await findCredentialByEmail(email)
      // Same response either way: the page never says whether the account exists.
      if (!credential) return
      const token = await issueToken({ userId: credential.user_id, kind: 'password_reset', ttlMs: RESET_TTL_MS })
      await sendPasswordResetEmail(credential.email, linkOrigin(origin), token)
    },

    async resetPassword({ token, password }, ctx) {
      requirePasswordMode(id)
      if (!token) throw new AuthError('invalid_token', 'This reset link is invalid or has expired.')
      const s = await settings()
      checkPasswordPolicy(password, s.passwordMinLength)
      const used = await consumeToken(token, 'password_reset')
      if (!used) throw new AuthError('invalid_token', 'This reset link is invalid or has expired.')
      const credential = await findCredentialById(used.userId)
      if (!credential) throw new AuthError('invalid_token', 'This reset link is invalid or has expired.')
      await setPasswordHash(used.userId, await hashPassword(password))
      // The link proves the address; every existing session ends.
      await confirmEmail(used.userId)
      await revokeUserSessions(used.userId)
      await startSession(used.userId, 'password_reset', ctx)
      return { id: used.userId, email: credential.email }
    },

    async verifyEmail(token, ctx) {
      const used = await consumeToken(token, 'email_confirmation')
      if (!used) throw new AuthError('invalid_token', 'This confirmation link is invalid or has expired.')
      const credential = await findCredentialById(used.userId)
      if (!credential) throw new AuthError('invalid_token', 'This confirmation link is invalid or has expired.')
      await confirmEmail(used.userId)
      await startSession(used.userId, 'email_confirmation', ctx)
      return { user: { id: used.userId, email: credential.email }, pending: used.data as SignUpInput['pending'] }
    },

    async loginOptions() {
      const idps = await getSsoProviders()
      return {
        provider: id,
        password: id === 'builtin',
        sso: idps.map((idp) => ({ id: idp.id, ...ssoDisplay(idp) })),
      }
    },

    async realtimeToken() {
      const session = await currentSession()
      if (!session) return null
      // Short-lived: the browser holds it, and it outlives a sign-out until it expires.
      return mintSupabaseAccessToken(dbIdentityFor(session.user, session.sessionId), { ttlSeconds: 900 })
    },

    getDbIdentity(user) {
      return dbIdentityFor(user)
    },

    admin: {
      async createUser({ email: rawEmail, password, emailConfirmed, metadata, id: requestedId }) {
        const email = rawEmail.trim().toLowerCase()
        if (await findCredentialByEmail(email)) throw new AuthError('user_exists', 'User already registered')
        const userId = requestedId ?? randomUUID()
        const passwordHash = password ? await hashPassword(password) : null
        const displayName = (metadata?.display_name ?? metadata?.full_name ?? null) as string | null
        try {
          await authDb().transaction(async (tx) => {
            await onUserCreated(tx, { id: userId, email, displayName })
            await insertCredential({ userId, email, passwordHash, emailConfirmed: Boolean(emailConfirmed), metadata: metadata ?? {} }, tx)
          })
        } catch (error) {
          if ((error as { code?: string }).code === '23505') throw new AuthError('user_exists', 'User already registered')
          throw error
        }
        return { id: userId }
      },
      async deleteUser(userId) {
        // What deleting a Supabase auth user does: the profile goes too
        // (credentials, sessions and identities cascade from it).
        await authDb().transaction(async (tx) => {
          await tx.query('DELETE FROM public.user_roles WHERE user_id = $1', [userId])
          await tx.query('DELETE FROM public.users WHERE id = $1', [userId])
          await tx.query('DELETE FROM app_auth.credentials WHERE user_id = $1', [userId])
        })
      },
      async setPassword(userId, password) {
        checkPasswordPolicy(password, (await settings()).passwordMinLength)
        await setPasswordHash(userId, await hashPassword(password))
        await revokeUserSessions(userId)
      },
      async updateEmail(userId, email) {
        await updateCredentialEmail(userId, email.toLowerCase())
      },
      async listIdentities(userId) {
        return (await listIdentities(userId)).map((row) => ({
          provider: row.provider,
          subject: row.subject,
          email: row.email,
          lastSignInAt: row.last_sign_in_at ? new Date(row.last_sign_in_at).toISOString() : null,
        }))
      },
    },
  }
}
