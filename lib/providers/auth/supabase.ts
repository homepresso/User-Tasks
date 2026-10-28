import { getBootstrapConfig } from '@/lib/config/bootstrap'
import { getServiceDb } from '@/lib/providers/db'
import { sanitizeRedirect } from '@/lib/safe-redirect'
import { dbIdentityFor } from './db-identity'
import { AuthError, type AuthProvider, type SessionUser } from './types'

/**
 * Supabase Auth, server side. The same Supabase calls the browser used to make
 * (signInWithPassword, signUp, signInWithOAuth, resetPasswordForEmail,
 * updateUser, signOut) now run in server actions / routes through the
 * cookie-bound @supabase/ssr client, which writes the session as httpOnly
 * cookies (lib/supabase/server.ts). Sessions, refresh, email templates, rate
 * limits and SSO configuration all stay in Supabase, so behaviour is
 * unchanged apart from where the calls happen.
 */

async function authClient() {
  const { createSupabaseAuthClient } = await import('@/lib/supabase/server')
  return createSupabaseAuthClient()
}

function toSessionUser(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): SessionUser {
  return { id: user.id, ...(user.email ? { email: user.email } : {}), user_metadata: user.user_metadata ?? {} }
}

function mapError(error: { message?: string; code?: string; status?: number }): AuthError {
  const message = error.message || 'Authentication failed'
  const code = error.code ?? ''
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return new AuthError('invalid_credentials', message)
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) return new AuthError('email_not_confirmed', message)
  if (code === 'user_already_exists' || /already registered|already exists/i.test(message)) return new AuthError('user_exists', message)
  if (code === 'weak_password' || /password should/i.test(message)) return new AuthError('weak_password', message)
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error.status === 429) return new AuthError('rate_limited', message)
  if (code === 'signup_disabled') return new AuthError('signup_disabled', message)
  return new AuthError('provider_error', message)
}

/** The OAuth providers configured in Supabase that the login page offers. */
const SUPABASE_SSO: Record<string, { provider: 'google' | 'azure'; scopes?: string }> = {
  google: { provider: 'google' },
  microsoft: { provider: 'azure', scopes: 'email openid profile' },
  azure: { provider: 'azure', scopes: 'email openid profile' },
}

function callbackUrl(origin: string, params: Record<string, string | null | undefined>): string {
  const query = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&')
  return `${origin}/auth/callback${query ? `?${query}` : ''}`
}

export const supabaseAuthProvider: AuthProvider = {
  id: 'supabase',
  onPrem: false,

  async getSessionUser() {
    const { getCachedUser } = await import('@/lib/supabase/server')
    return getCachedUser()
  },

  async signInWithPassword(email, password) {
    const { data, error } = await (await authClient()).auth.signInWithPassword({ email, password })
    if (error || !data.user || !data.session) throw mapError(error ?? { message: 'Sign-in failed' })
    return toSessionUser(data.user)
  },

  async signUp(input) {
    const { data, error } = await (await authClient()).auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { full_name: input.displayName ?? input.email.split('@')[0] },
        ...(input.redirectTo ? { emailRedirectTo: input.redirectTo } : {}),
      },
    })
    if (error) throw mapError(error)
    if (!data.user) throw new AuthError('provider_error', 'Account creation failed. Please try again.')
    return { user: toSessionUser(data.user), signedIn: Boolean(data.session) }
  },

  async signOut() {
    await (await authClient()).auth.signOut()
  },

  async startSso(idpId, { redirect, org, origin }) {
    const sso = SUPABASE_SSO[idpId]
    if (!sso) throw new AuthError('not_supported', `Unknown sign-in provider "${idpId}"`)
    const { data, error } = await (await authClient()).auth.signInWithOAuth({
      provider: sso.provider,
      options: {
        ...(sso.scopes ? { scopes: sso.scopes } : {}),
        redirectTo: callbackUrl(origin, { redirect: sanitizeRedirect(redirect), org }),
        skipBrowserRedirect: true,
      },
    })
    if (error || !data.url) throw mapError(error ?? { message: 'Could not start sign-in' })
    return data.url
  },

  async handleCallback(request) {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    if (!code) throw new AuthError('invalid_token', 'Missing authorization code')
    const { data, error } = await (await authClient()).auth.exchangeCodeForSession(code)
    if (error || !data.user) throw mapError(error ?? { message: 'Sign-in failed' })
    return {
      user: toSessionUser(data.user),
      redirect: sanitizeRedirect(searchParams.get('redirect')),
      org: searchParams.get('org'),
    }
  },

  async requestPasswordReset(email, { origin }) {
    const { error } = await (await authClient()).auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl(origin, { redirect: '/reset-password' }),
    })
    if (error) throw mapError(error)
  },

  async resetPassword({ password }) {
    const client = await authClient()
    const { data, error } = await client.auth.updateUser({ password })
    if (error || !data.user) throw mapError(error ?? { message: 'Not signed in' })
    return toSessionUser(data.user)
  },

  async verifyEmail() {
    // Supabase confirms addresses itself (its link lands on /auth/callback).
    throw new AuthError('not_supported', 'Email confirmation is handled by Supabase Auth')
  },

  async loginOptions() {
    const { ssoMicrosoft } = getBootstrapConfig()
    return {
      provider: 'supabase',
      password: true,
      sso: [
        { id: 'google', name: 'Google', kind: 'google' as const },
        ...(ssoMicrosoft ? [{ id: 'microsoft', name: 'Microsoft', kind: 'microsoft' as const }] : []),
      ],
    }
  },

  async realtimeToken() {
    const { getCachedUser } = await import('@/lib/supabase/server')
    if (!(await getCachedUser())) return null
    // getSession() refreshes an expired access token (and rewrites the cookies).
    const { data: { session } } = await (await authClient()).auth.getSession()
    if (!session?.access_token) return null
    return { token: session.access_token, expiresAt: (session.expires_at ?? Math.floor(Date.now() / 1000) + 300) * 1000 }
  },

  getDbIdentity(user) {
    return dbIdentityFor(user)
  },

  admin: {
    async createUser({ email, password, emailConfirmed, metadata }) {
      const { data, error } = await getServiceDb().auth.admin.createUser({
        email,
        ...(password ? { password } : {}),
        email_confirm: emailConfirmed ?? false,
        user_metadata: metadata ?? {},
      })
      if (error || !data?.user) throw mapError(error ?? { message: 'Auth user creation failed' })
      return { id: data.user.id }
    },
    async deleteUser(userId) {
      const { error } = await getServiceDb().auth.admin.deleteUser(userId)
      if (error) throw mapError(error)
    },
    async setPassword(userId, password) {
      const { error } = await getServiceDb().auth.admin.updateUserById(userId, { password })
      if (error) throw mapError(error)
    },
    async updateEmail(userId, email) {
      const { error } = await getServiceDb().auth.admin.updateUserById(userId, { email, email_confirm: true })
      if (error) throw mapError(error)
    },
    async listIdentities(userId) {
      const { data, error } = await getServiceDb().auth.admin.getUserById(userId)
      if (error) throw mapError(error)
      return (data.user?.identities ?? []).map((identity) => ({
        provider: identity.provider,
        subject: identity.id,
        email: (identity.identity_data?.email as string | undefined) ?? null,
        lastSignInAt: identity.last_sign_in_at ?? null,
      }))
    },
  },
}
