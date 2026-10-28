'use server'

import { headers } from 'next/headers'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { touchUserLastSeen } from '@/lib/last-seen'
import { getAuthProvider, isAuthError, type AuthRequestContext, type LoginOptions } from '@/lib/providers/auth'
import { checkInvitation, inviteTokenMatches, joinInvitedTenant } from '@/lib/providers/auth/provisioning'
import { sanitizeRedirect } from '@/lib/safe-redirect'
import { getCachedUser } from '@/lib/supabase/server'

/*
 * Sign-in, sign-up, sign-out, password reset and SSO start — all server side.
 * The browser posts here (Next.js server actions: POST-only with an Origin
 * check, so cross-site form posts are refused) and the configured
 * AuthProvider sets or clears the httpOnly session cookies on the response.
 * No tokens ever reach browser JavaScript.
 */

export type AuthActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code?: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

async function requestContext(): Promise<AuthRequestContext & { origin: string }> {
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim() || null
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https')
  const requestOrigin = h.get('origin') ?? (host ? `${proto}://${host}` : '')
  return { ip, userAgent: h.get('user-agent'), origin: (configuredAppUrl()?.trim() || requestOrigin).replace(/\/+$/, '') }
}

function fail(error: unknown, fallback: string): { ok: false; error: string; code?: string } {
  if (isAuthError(error)) return { ok: false, error: error.message, code: error.code }
  console.error('[auth]', error)
  return { ok: false, error: fallback }
}

/** Sign-in methods for the login page (names and buttons only). */
export async function getLoginOptions(): Promise<LoginOptions> {
  return (await getAuthProvider()).loginOptions()
}

export interface SignInInput {
  org: string
  email: string
  password: string
  inviteToken?: string | null
  redirect?: string | null
}

/**
 * The login page's flow, unchanged from when it ran in the browser:
 *  0. (built-in auth) the organisation's LDAP bind login, when enabled;
 *  1. sign in an existing account;
 *  2. otherwise, if the email is invited to (or already has access to) the
 *     organisation, create the account and join it with the invited role;
 *  3. otherwise explain what's wrong.
 */
export async function signInAction(input: SignInInput): Promise<AuthActionResult<{ redirect: string; step?: 'signed_in' | 'created' | 'confirm_email' }>> {
  const slug = String(input.org ?? '').trim().toLowerCase()
  const email = String(input.email ?? '').trim()
  const password = String(input.password ?? '')
  const redirect = sanitizeRedirect(input.redirect)
  if (!slug) return { ok: false, error: 'Organisation is required.' }
  if (!email || !password) return { ok: false, error: 'Email and password are required.' }

  const ctx = await requestContext()
  const provider = await getAuthProvider()

  // 0. LDAP bind login, when the organisation turned it on (built-in auth only).
  if (provider.id === 'builtin') {
    const { tryLdapLogin } = await import('@/lib/directory-sync/ldap-login')
    const ldap = await tryLdapLogin(slug, email, password, ctx).catch((error) => {
      console.error('[auth] LDAP sign-in failed:', error)
      return { status: 'not_applicable' as const }
    })
    if (ldap.status === 'signed_in') {
      await touchUserLastSeen(ldap.userId).catch(() => undefined)
      return { ok: true, redirect, step: 'signed_in' }
    }
    if (ldap.status === 'failed') return { ok: false, error: ldap.message, code: ldap.code }
  }

  // 1. Existing account.
  let signInError: unknown = null
  try {
    const user = await provider.signInWithPassword(email, password, ctx)
    await touchUserLastSeen(user.id).catch(() => undefined)
    return { ok: true, redirect, step: 'signed_in' }
  } catch (error) {
    signInError = error
    if (isAuthError(error) && ['locked', 'rate_limited', 'email_not_confirmed', 'not_supported'].includes(error.code)) {
      return fail(error, 'Sign-in failed.')
    }
    if (!isAuthError(error)) return fail(error, 'Sign-in failed. Please try again.')
  }

  // 2. Invitation (pending or accepted) or existing access?
  const check = await checkInvitation(slug, email.toLowerCase()).catch(() => null)
  if (!check?.ok) {
    return { ok: false, error: "Invalid email or password. If you're new, ask an admin to invite you first." }
  }
  if (check.existingUserId) {
    return { ok: false, error: 'Incorrect password. Please try again.', code: isAuthError(signInError) ? signInError.code : undefined }
  }

  // 3. No account yet — create one. A matching invite token proves the address.
  const inviteToken = input.inviteToken || check.inviteToken || null
  const proven = await inviteTokenMatches(input.inviteToken, email).catch(() => false)
  let created
  try {
    created = await provider.signUp({
      email,
      password,
      displayName: email.split('@')[0],
      emailConfirmed: proven,
      invited: true,
      origin: ctx.origin,
      redirectTo: `${ctx.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}&org=${encodeURIComponent(slug)}`,
      pending: { org: slug, invite: inviteToken ?? undefined, redirect },
    }, ctx)
  } catch (error) {
    return fail(error, 'Account creation failed. Please try again.')
  }

  if (!created.signedIn) {
    // Supabase without a session: a retry may still sign in (no confirmation
    // required); built-in sends a confirmation link instead.
    if (provider.id === 'supabase') {
      try {
        await provider.signInWithPassword(email, password, ctx)
      } catch {
        return { ok: false, error: 'Account created! Please sign in with your new password.' }
      }
    } else {
      return { ok: true, redirect: '/check-email', step: 'confirm_email' }
    }
  }

  // 4. Workspace setup with the now-verified session user.
  const user = await getCachedUser().catch(() => null) ?? created.user
  const joined = await joinInvitedTenant(user, slug, inviteToken).catch(() => null)
  if (!joined?.ok) {
    return { ok: false, error: 'Account created but workspace setup failed. Please try signing in.' }
  }
  await touchUserLastSeen(user.id).catch(() => undefined)
  return { ok: true, redirect, step: 'created' }
}

/** Sign in with email + password only (after the beta signup provisioned the account). */
export async function passwordSignInAction(email: string, password: string): Promise<AuthActionResult> {
  if (!EMAIL_RE.test(String(email ?? '').trim()) || !password) return { ok: false, error: 'Email and password are required.' }
  try {
    const ctx = await requestContext()
    const user = await (await getAuthProvider()).signInWithPassword(String(email).trim(), String(password), ctx)
    await touchUserLastSeen(user.id).catch(() => undefined)
    return { ok: true }
  } catch (error) {
    return fail(error, 'Sign-in failed.')
  }
}

/** Where to send the browser for an SSO sign-in (Google / Microsoft / configured IdPs). */
export async function startSsoAction(input: { provider: string; org?: string | null; redirect?: string | null }): Promise<AuthActionResult<{ url: string }>> {
  try {
    const ctx = await requestContext()
    const org = String(input.org ?? '').trim().toLowerCase() || null
    const url = await (await getAuthProvider()).startSso(String(input.provider), { redirect: sanitizeRedirect(input.redirect), org, origin: ctx.origin })
    return { ok: true, url }
  } catch (error) {
    return fail(error, 'Could not start single sign-on.')
  }
}

export async function signOutAction(options: { everywhere?: boolean } = {}): Promise<AuthActionResult> {
  try {
    await (await getAuthProvider()).signOut({ everywhere: options.everywhere === true })
    return { ok: true }
  } catch (error) {
    return fail(error, 'Sign-out failed.')
  }
}

/** Password-reset email. Never reveals whether the account exists. */
export async function requestPasswordResetAction(email: string): Promise<AuthActionResult> {
  const address = String(email ?? '').trim()
  if (!EMAIL_RE.test(address)) return { ok: false, error: 'Please enter a valid email address.' }
  try {
    const ctx = await requestContext()
    await (await getAuthProvider()).requestPasswordReset(address, { origin: ctx.origin }, ctx)
    return { ok: true }
  } catch (error) {
    return fail(error, 'Could not send the reset email. Please try again.')
  }
}

/** Set a new password: with the emailed token (built-in) or for the recovery session (Supabase). */
export async function resetPasswordAction(input: { password: string; token?: string | null }): Promise<AuthActionResult> {
  try {
    const ctx = await requestContext()
    const user = await (await getAuthProvider()).resetPassword({ password: String(input.password ?? ''), token: input.token || undefined }, ctx)
    await touchUserLastSeen(user.id).catch(() => undefined)
    return { ok: true }
  } catch (error) {
    return fail(error, 'Could not update your password.')
  }
}

/** Short-lived access token for the Supabase Realtime browser client (RLS on postgres_changes). */
export async function getRealtimeTokenAction(): Promise<{ token: string; expiresAt: number } | null> {
  try {
    return await (await getAuthProvider()).realtimeToken()
  } catch (error) {
    console.warn('[auth] realtime token unavailable:', (error as Error).message)
    return null
  }
}

/** Built-in auth: confirm the address from the emailed link, sign in, finish the invited workspace setup. */
export async function verifyEmailAction(token: string): Promise<AuthActionResult<{ redirect: string }>> {
  try {
    const ctx = await requestContext()
    const { user, pending } = await (await getAuthProvider()).verifyEmail(String(token ?? ''), ctx)
    if (pending?.org) await joinInvitedTenant(user, pending.org, pending.invite ?? null).catch(() => null)
    await touchUserLastSeen(user.id).catch(() => undefined)
    return { ok: true, redirect: sanitizeRedirect(pending?.redirect) }
  } catch (error) {
    return fail(error, 'Could not confirm your email.')
  }
}
