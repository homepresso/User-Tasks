'use server'

import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/cron-auth'
import { isCloud } from '@/lib/deployment'
import { provisionTenant } from '@/lib/tenant-provisioning'
import { getAuthProvider } from '@/lib/providers/auth'
import { rateLimit } from '@/lib/rate-limit'

/**
 * Public beta signup (cloud edition only) — rate-limits, filters bots, then
 * provisions a brand-new isolated tenant via provisionTenant.
 */

export interface BetaSignupInput {
  fullName: string
  email: string
  password: string
  company: string
  companySize?: string
  useCase?: string
  /** honeypot — bots fill it, humans never see it */
  website?: string
}

export interface BetaSignupResult {
  ok: boolean
  error?: string
  slug?: string
}

// ── IP rate limit (shared across replicas with a shared cache store) ──
const RATE_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const RATE_MAX = 5

async function rateLimited(ip: string): Promise<boolean> {
  return !(await rateLimit(`beta-signup:${ip}`, { max: RATE_MAX, windowMs: RATE_WINDOW_MS })).ok
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function betaSignup(input: BetaSignupInput): Promise<BetaSignupResult> {
  if (!isCloud()) return { ok: false, error: 'Self-signup is disabled on this deployment' }

  // Honeypot: pretend success so bots move on.
  if (input.website) return { ok: true }

  const fullName = String(input.fullName ?? '').trim().slice(0, 120)
  const email = String(input.email ?? '').trim().toLowerCase().slice(0, 254)
  const password = String(input.password ?? '')
  const company = String(input.company ?? '').trim().slice(0, 120)

  if (!fullName || !company) return { ok: false, error: 'Please fill in your name and company.' }
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Please enter a valid email address.' }
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' }

  const hdrs = await headers()
  const ip = (hdrs.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  if (await rateLimited(ip)) return { ok: false, error: 'Too many signups from this network — please try again later.' }

  const result = await provisionTenant(createServiceClient(), {
    fullName,
    email,
    password,
    company,
    onboardingCompleted: true,
    userMetadata: { beta_signup: true },
    settings: {
      beta_signup: {
        company_size: input.companySize ?? null,
        use_case: String(input.useCase ?? '').slice(0, 2000) || null,
        source: 'beta-landing',
        signed_up_at: new Date().toISOString(),
      },
    },
  }, (await getAuthProvider()).admin)
  if (result.ok) return { ok: true, slug: result.slug }
  if (result.reason === 'user_exists') {
    return { ok: false, error: 'An account with this email already exists — try signing in instead.' }
  }
  if (result.reason === 'auth_failed') {
    console.error('[beta-signup] auth user creation failed:', result.error)
    return { ok: false, error: 'Could not create your account. Please try again.' }
  }
  console.error('[beta-signup] provisioning failed:', result.error)
  return { ok: false, error: 'Could not set up your workspace. Please try again.' }
}
