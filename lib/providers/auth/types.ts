import type { ProviderId } from '@/lib/config/schema'

/**
 * AuthProvider contract (server only). Every login, logout, password reset,
 * SSO round trip and session lookup goes through the configured provider;
 * the browser never talks to an auth service directly (it posts to server
 * actions and routes, which set httpOnly cookies).
 *
 *  - supabase (default)  Supabase Auth via @supabase/ssr, server side.
 *  - builtin             users, bcrypt hashes and sessions in Postgres
 *                        (schema app_auth), plus any OIDC / SAML IdPs from
 *                        AUTH_SSO_PROVIDERS.
 *  - oidc / saml         built-in sessions with SSO-only sign-in (password
 *                        login and sign-up disabled), IdPs of that type.
 */

/** The signed-in user as call sites see it (a subset of Supabase's User). */
export interface SessionUser {
  id: string
  /** Absent when the provider has no email for the user. */
  email?: string
  user_metadata?: Record<string, unknown>
}

/** Identity for the database (RLS): role + JWT claims, as PostgREST derives them. */
export interface DbIdentity {
  role: 'authenticated'
  claims: Record<string, unknown> & { sub: string; role: 'authenticated' }
}

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'locked'
  | 'rate_limited'
  | 'user_exists'
  | 'weak_password'
  | 'invalid_token'
  | 'not_supported'
  | 'signup_disabled'
  | 'sso_failed'
  | 'not_authenticated'
  | 'provider_error'

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError || (error instanceof Error && error.name === 'AuthError' && 'code' in error)
}

/** Request facts the provider records / rate-limits on. */
export interface AuthRequestContext {
  ip?: string | null
  userAgent?: string | null
}

export interface SignUpInput {
  email: string
  password: string
  displayName?: string
  /** Skip the confirmation email (the caller already proved the address, e.g. a matching invite token). */
  emailConfirmed?: boolean
  /** Where the confirmation link lands (Supabase: emailRedirectTo). */
  redirectTo?: string
  /** Request origin (built-in links use APP_URL when it is set). */
  origin?: string
  /** The address has an invitation (built-in sign-up is invitation-only unless allow_signup). */
  invited?: boolean
  /** Built-in: org / invite carried through the confirmation link. */
  pending?: { org?: string; invite?: string; redirect?: string }
}

export interface SignUpResult {
  user: SessionUser
  /** True when the user is signed in now (no confirmation pending). */
  signedIn: boolean
}

export interface CreateUserInput {
  email: string
  password?: string
  emailConfirmed?: boolean
  metadata?: Record<string, unknown>
  /** Built-in: keep this id (migration, directory sync linking). */
  id?: string
}

export interface LinkedIdentity {
  provider: string
  subject: string
  email: string | null
  lastSignInAt: string | null
}

/** Account administration (service context, no session). */
export interface AuthAdmin {
  createUser(input: CreateUserInput): Promise<{ id: string }>
  deleteUser(userId: string): Promise<void>
  setPassword(userId: string, password: string): Promise<void>
  updateEmail(userId: string, email: string): Promise<void>
  listIdentities(userId: string): Promise<LinkedIdentity[]>
}

/** A sign-in button on the login page. Names only — never client ids or secrets. */
export interface SsoOption {
  id: string
  name: string
  kind: 'google' | 'microsoft' | 'oidc' | 'saml'
}

export interface LoginOptions {
  provider: ProviderId<'auth'>
  password: boolean
  sso: SsoOption[]
}

export interface CallbackResult {
  user: SessionUser
  redirect: string
  org: string | null
}

export interface AuthProvider {
  readonly id: ProviderId<'auth'>
  /** Runs fully on-premises / air-gapped (plan: provider catalogue). */
  readonly onPrem: boolean

  /** The signed-in user for this request (cookies), verified, or null. */
  getSessionUser(): Promise<SessionUser | null>
  /** Sign in with email + password; sets the session cookie. */
  signInWithPassword(email: string, password: string, ctx?: AuthRequestContext): Promise<SessionUser>
  /** Create an account with a password. Signs in unless confirmation is pending. */
  signUp(input: SignUpInput, ctx?: AuthRequestContext): Promise<SignUpResult>
  /** End this session (or every session of the user); clears the cookie. */
  signOut(options?: { everywhere?: boolean }): Promise<void>
  /** URL to send the browser to for an SSO sign-in. */
  startSso(idpId: string, options: { redirect: string; org: string | null; origin: string }): Promise<string>
  /** Finish a redirect-based sign-in (Supabase OAuth / recovery code). */
  handleCallback(request: Request): Promise<CallbackResult>
  /** Send a password-reset email. Never reveals whether the account exists. */
  requestPasswordReset(email: string, options: { origin: string }, ctx?: AuthRequestContext): Promise<void>
  /** Set a new password: with a reset token (built-in) or for the current session (Supabase recovery). Signs in. */
  resetPassword(input: { token?: string; password: string }, ctx?: AuthRequestContext): Promise<SessionUser>
  /** Confirm an email address from the confirmation link; signs in. */
  verifyEmail(token: string, ctx?: AuthRequestContext): Promise<{ user: SessionUser; pending: SignUpInput['pending'] }>
  /** Sign-in methods for the login page. */
  loginOptions(): Promise<LoginOptions>
  /** Short-lived token for a browser Supabase Realtime connection (RLS), or null. */
  realtimeToken(): Promise<{ token: string; expiresAt: number } | null>
  /** Claims the database sees for this user (auth.uid() = sub). */
  getDbIdentity(user: SessionUser): DbIdentity
  readonly admin: AuthAdmin
}
