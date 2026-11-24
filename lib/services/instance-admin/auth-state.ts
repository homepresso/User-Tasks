import { appUrlOrLocalhost } from '@/lib/config/bootstrap'
import { activeAuthProviderId, getAuthProvider } from '@/lib/providers/auth'
import { clearLockout, credentialStates, lockedCredentialIds, revokeUserSessions } from '@/lib/providers/auth/builtin/store'
import { resetRateLimit } from '@/lib/rate-limit'
import { instanceDb } from './access'

/**
 * Account sign-in state across auth providers, for instance admins. What
 * "locked" means here (see docs/instance-admin.md):
 *
 *  - built-in auth (builtin / oidc / saml): `app_auth.credentials.locked_until`
 *    after `lockout_threshold` failed passwords (default 10 → 15 minutes),
 *    plus the per-email sign-in throttle (`auth:login:email:<email>`, 20 per
 *    15 minutes). Unlock clears both.
 *  - Supabase Auth: a ban (`auth.users.banned_until`, set in the Supabase
 *    dashboard or API — UserTasks itself never bans). Unlock lifts it.
 *    Supabase's own sign-in rate limits are per IP and not per account.
 *
 * Never: passwords, tokens, impersonation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped RPC rows */

export type AuthKind = 'supabase' | 'builtin'

export interface AccountState {
  user_id: string
  locked: boolean
  locked_until: string | null
  failed_attempts: number | null
  banned_until: string | null
  email_confirmed: boolean | null
  last_sign_in_at: string | null
  open_sessions: number | null
  /** 'on' (a verified factor), 'off', or null (the provider has no MFA). */
  mfa: 'on' | 'off' | null
  sign_in_methods: string[]
}

export async function authKind(): Promise<AuthKind> {
  const id = await activeAuthProviderId()
  return id === 'supabase' ? 'supabase' : 'builtin'
}

const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const future = (v: string | null) => Boolean(v && new Date(v).getTime() > Date.now())

/** Sign-in state of up to 500 accounts (missing accounts are left out). */
export async function accountStates(userIds: readonly string[]): Promise<Map<string, AccountState>> {
  const out = new Map<string, AccountState>()
  const ids = [...new Set(userIds)].slice(0, 500)
  if (!ids.length) return out
  try {
    if ((await authKind()) === 'builtin') {
      for (const r of await credentialStates(ids)) {
        const lockedUntil = iso(r.locked_until)
        out.set(r.user_id, {
          user_id: r.user_id, locked: future(lockedUntil), locked_until: future(lockedUntil) ? lockedUntil : null,
          failed_attempts: Number(r.failed_attempts ?? 0), banned_until: null, email_confirmed: r.email_confirmed_at !== null,
          last_sign_in_at: iso(r.last_sign_in_at), open_sessions: Number(r.open_sessions ?? 0), mfa: null,
          sign_in_methods: r.has_password ? ['password'] : [],
        })
      }
      return out
    }
    const { data, error } = await (instanceDb() as any).rpc('instance_admin_auth_state', { p_user_ids: ids })
    if (error) return out
    for (const r of (data ?? []) as any[]) {
      const banned = iso(r.banned_until)
      out.set(r.user_id, {
        user_id: r.user_id, locked: future(banned), locked_until: null, failed_attempts: null,
        banned_until: future(banned) ? banned : null, email_confirmed: r.email_confirmed_at !== null,
        last_sign_in_at: iso(r.last_sign_in_at), open_sessions: Number(r.open_sessions ?? 0),
        mfa: Number(r.mfa_factors ?? 0) > 0 ? 'on' : 'off',
        sign_in_methods: Array.isArray(r.providers) ? r.providers.map(String).slice(0, 10) : [],
      })
    }
  } catch {
    // No auth store reachable (e.g. built-in auth without DATABASE_URL): state unknown.
  }
  return out
}

/** Clear a lockout / ban. Returns whether anything was locked. */
export async function unlockAccount(userId: string, email: string): Promise<{ changed: boolean; kind: AuthKind; cleared: string[] }> {
  const kind = await authKind()
  const cleared: string[] = []
  if (kind === 'builtin') {
    if (await clearLockout(userId)) cleared.push('failed sign-in lockout')
  } else {
    const before = (await accountStates([userId])).get(userId)
    if (before?.banned_until) {
      const { error } = await (instanceDb() as any).auth.admin.updateUserById(userId, { ban_duration: 'none' })
      if (error) throw new Error(`Could not lift the suspension: ${error.message}`)
      cleared.push('suspension (ban)')
    }
  }
  // The per-email sign-in throttle (built-in auth) — harmless elsewhere.
  await resetRateLimit(`auth:login:email:${email.trim().toLowerCase()}`)
  await resetRateLimit(`auth:reset:email:${email.trim().toLowerCase()}`)
  return { changed: cleared.length > 0, kind, cleared }
}

/** End every session of the account. Returns how many were ended (null: unknown). */
export async function revokeSessions(userId: string): Promise<number | null> {
  if ((await authKind()) === 'builtin') return revokeUserSessions(userId)
  const { data, error } = await (instanceDb() as any).rpc('instance_admin_revoke_sessions', { p_user_id: userId })
  if (error) throw new Error(/function|does not exist/i.test(error.message ?? '') ? 'Sign out everywhere needs migration 20270129090000_instance_admin.sql' : error.message)
  return typeof data === 'number' ? data : Number(data ?? 0)
}

/** Send the normal password-reset email (the person sets a new password themselves). */
export async function sendPasswordReset(email: string): Promise<void> {
  const provider = await getAuthProvider()
  await provider.requestPasswordReset(email, { origin: appUrlOrLocalhost() })
}

/** Accounts locked / suspended right now (at most `limit`). */
export async function lockedAccounts(limit = 500): Promise<Array<{ user_id: string; until: string | null }>> {
  try {
    if ((await authKind()) === 'builtin') {
      return (await lockedCredentialIds(limit)).map((r) => ({ user_id: r.user_id, until: iso(r.locked_until) }))
    }
    const { data, error } = await (instanceDb() as any).rpc('instance_admin_locked_users', { p_limit: limit })
    if (error) return []
    return ((data ?? []) as any[]).map((r) => ({ user_id: String(r.user_id), until: iso(r.banned_until) }))
  } catch {
    return []
  }
}
