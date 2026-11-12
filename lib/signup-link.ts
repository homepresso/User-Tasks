import { sanitizeRedirect } from '@/lib/safe-redirect'

/**
 * Self-signup ↔ sign-in links that keep the page the visitor was heading to
 * (e.g. a CLI's `/api/oauth/authorize?...`). Every `redirect` goes through
 * sanitizeRedirect: same-origin paths only, never `//host`, `\`, a scheme or
 * a control character. Pure, so client and server components share it.
 */

/** The `redirect` value when it is safe, else null. */
export function safeReturnPath(raw: string | string[] | null | undefined): string | null {
  return sanitizeRedirect(typeof raw === 'string' ? raw : null, '') || null
}

function withRedirect(path: string, raw: string | string[] | null | undefined): string {
  const back = safeReturnPath(raw)
  return back ? `${path}?redirect=${encodeURIComponent(back)}` : path
}

/** Login page → "Create a free workspace" (cloud edition only; the caller checks). */
export function signupHref(raw: string | string[] | null | undefined): string {
  return withRedirect('/start', raw)
}

/** Sign-up page → "Sign in". */
export function loginHref(raw: string | string[] | null | undefined): string {
  return withRedirect('/login', raw)
}

/**
 * Where a new user lands after sign-up: the safe `redirect`, else the known
 * `next` destination, else /tasks.
 */
export const SIGNUP_NEXT: Record<string, string> = { infopath: '/automations/forms?import=infopath' }

export function postSignupDestination(redirect: string | null | undefined, next: string | null | undefined): string {
  return safeReturnPath(redirect) ?? ((next && Object.hasOwn(SIGNUP_NEXT, next) && SIGNUP_NEXT[next]) || '/tasks')
}

export type SignupOutcome =
  | { kind: 'error'; error: string }
  /** Signed in: go here (full navigation, so the new session cookie is sent). */
  | { kind: 'signed_in'; href: string }
  /** Workspace created but the sign-in failed: the login page, keeping `redirect`. */
  | { kind: 'sign_in'; href: string }

/**
 * The /start form's submit flow: create the workspace (betaSignup), sign in
 * server side (the action's response sets the httpOnly session cookies), then
 * pick where to go. The two server actions are passed in so this stays pure.
 */
export async function completeBetaSignup<F extends { email: string; password: string }>(
  form: F,
  target: { redirect?: string | null; next?: string | null },
  actions: {
    signup: (form: F) => Promise<{ ok: boolean; error?: string }>
    signIn: (email: string, password: string) => Promise<{ ok: boolean }>
    /** Called between the two steps (progress UI). */
    onProvisioned?: () => void
  },
): Promise<SignupOutcome> {
  const result = await actions.signup(form)
  if (!result.ok) return { kind: 'error', error: result.error ?? 'Something went wrong — please try again.' }
  actions.onProvisioned?.()
  const signedIn = await actions.signIn(form.email.trim(), form.password)
  if (!signedIn.ok) return { kind: 'sign_in', href: loginHref(target.redirect) }
  return { kind: 'signed_in', href: postSignupDestination(target.redirect, target.next) }
}
