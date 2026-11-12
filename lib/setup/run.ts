import type { ProvisionTenantInput, ProvisionTenantResult } from '@/lib/tenant-provisioning'
import { toUrlSlug } from '@/lib/utils/slug'
import { checkSetupCode, claimSetup, completeSetup, isInstanceEmpty, markSetupDone, releaseSetup, type SetupDb } from './state'

/**
 * The /setup form's server side, with its dependencies passed in (the server
 * action wires the real ones; tests pass fakes). Order matters:
 *   1. rate limit (every attempt counts, per client IP),
 *   2. validate the fields,
 *   3. still needed? (fresh read, not the cache),
 *   4. the setup code (constant time),
 *   5. the one-time claim (instance_settings primary key), then re-check
 *      "still empty" while holding it — two simultaneous submissions can't
 *      both get here,
 *   6. provisionTenant (the same as `npm run bootstrap`),
 *   7. expire the code, record the claim as completed, audit, sign in.
 */

export interface SetupInput {
  org: string
  slug: string
  fullName: string
  email: string
  password: string
  confirmPassword: string
  code: string
}

export type SetupField = 'org' | 'slug' | 'fullName' | 'email' | 'password' | 'confirmPassword' | 'code'

export type SetupResult =
  | { ok: true; slug: string; signedIn: boolean; redirect: string }
  | { ok: false; error: string; field?: SetupField; done?: boolean }

export interface SetupDeps {
  db: SetupDb
  provision: (input: ProvisionTenantInput) => Promise<ProvisionTenantResult>
  rateLimit: (key: string) => Promise<{ ok: boolean; retryAfterMs?: number }>
  signIn: (email: string, password: string) => Promise<boolean>
  audit: (info: { tenantId: string; userId: string; slug: string; email: string }) => Promise<void>
  ip: string | null
  env?: Record<string, string | undefined>
}

export const SETUP_RATE_LIMIT = { max: 5, windowMs: 15 * 60_000 }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_BYTES = 72

/** The slug the form suggests for an organisation name (editable). */
export function suggestSlug(org: string): string {
  return toUrlSlug(org, 50).replace(/-+$/, '')
}

/** Field validation (pure). */
export function validateSetupInput(input: SetupInput): { error: string; field: SetupField } | null {
  const org = String(input.org ?? '').trim()
  const slug = String(input.slug ?? '').trim()
  if (!org) return { field: 'org', error: 'Enter your organisation name.' }
  if (org.length > 120) return { field: 'org', error: 'Keep the organisation name under 120 characters.' }
  if (!SLUG_RE.test(slug)) return { field: 'slug', error: 'Use 1–50 lowercase letters, numbers and dashes for the sign-in name (no dash at the start or end).' }
  if (!String(input.fullName ?? '').trim()) return { field: 'fullName', error: 'Enter your name.' }
  if (String(input.fullName).trim().length > 120) return { field: 'fullName', error: 'Keep your name under 120 characters.' }
  if (!EMAIL_RE.test(String(input.email ?? '').trim())) return { field: 'email', error: 'Enter a valid email address.' }
  const password = String(input.password ?? '')
  if (password.length < MIN_PASSWORD_LENGTH) return { field: 'password', error: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.` }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) return { field: 'password', error: `Passwords can be at most ${MAX_PASSWORD_BYTES} bytes.` }
  if (password !== String(input.confirmPassword ?? '')) return { field: 'confirmPassword', error: "The passwords don't match." }
  if (!String(input.code ?? '').trim()) return { field: 'code', error: 'Enter the setup code from the server log.' }
  return null
}

const DONE: SetupResult = { ok: false, done: true, error: 'This install already has an admin account. Sign in instead.' }

export async function runSetup(input: SetupInput, deps: SetupDeps): Promise<SetupResult> {
  const limited = await deps.rateLimit(`setup:${deps.ip ?? 'unknown'}`)
  if (!limited.ok) {
    const minutes = Math.max(1, Math.ceil((limited.retryAfterMs ?? SETUP_RATE_LIMIT.windowMs) / 60_000))
    return { ok: false, field: 'code', error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` }
  }

  const invalid = validateSetupInput(input)
  if (invalid) return { ok: false, ...invalid }

  let empty: boolean
  try {
    empty = await isInstanceEmpty(deps.db)
  } catch (error) {
    console.error('[setup] database check failed:', (error as Error).message)
    return { ok: false, error: "Can't reach the database. Check the server log, then try again." }
  }
  if (!empty) { markSetupDone(); return DONE }

  if (!(await checkSetupCode(deps.db, input.code, deps.env))) {
    return { ok: false, field: 'code', error: "That setup code isn't right. Copy it from the server log (it looks like ABCD-EFGH-JKLM), or run \"usertasks-admin setup-code\" for a new one." }
  }

  const claimId = await claimSetup(deps.db).catch((error: Error) => {
    console.error('[setup] claim failed:', error.message)
    return undefined
  })
  if (claimId === undefined) return { ok: false, error: "Couldn't start setup: the instance_settings table isn't reachable. Apply the database migrations (usertasks-admin db migrate) and try again." }
  if (claimId === null) return { ok: false, error: 'Setup is already running from another window. Wait a moment, then sign in.' }

  // Holding the claim: nobody else can be provisioning. Re-check.
  if (!(await isInstanceEmpty(deps.db).catch(() => false))) {
    await releaseSetup(deps.db)
    markSetupDone()
    return DONE
  }

  const email = input.email.trim().toLowerCase()
  const slug = input.slug.trim()
  const result = await deps.provision({
    fullName: input.fullName.trim(),
    email,
    password: input.password,
    company: input.org.trim(),
    slug,
    onboardingCompleted: false,
    userMetadata: { bootstrap: true, setup_screen: true },
    settings: { bootstrap: { source: 'setup-screen', created_at: new Date().toISOString() } },
  })
  if (!result.ok) {
    await releaseSetup(deps.db)
    console.error(`[setup] provisioning failed (${result.reason}): ${result.error}`)
    if (result.reason === 'slug_taken') return { ok: false, field: 'slug', error: 'That sign-in name is taken. Choose another.' }
    if (result.reason === 'user_exists') return { ok: false, field: 'email', error: 'An account with this email already exists. Sign in instead, or use another email.' }
    if (result.reason === 'auth_failed') return { ok: false, field: 'password', error: result.error || 'Could not create the account.' }
    return { ok: false, error: 'Could not create the workspace. Check the server log, then try again.' }
  }

  await completeSetup(deps.db, { claimId, tenantId: result.tenantId, userId: result.userId })
  await deps.audit({ tenantId: result.tenantId, userId: result.userId, slug: result.slug, email }).catch(() => undefined)
  const signedIn = await deps.signIn(email, input.password).catch(() => false)
  return { ok: true, slug: result.slug, signedIn, redirect: signedIn ? '/onboarding' : `/login?org=${encodeURIComponent(result.slug)}` }
}
