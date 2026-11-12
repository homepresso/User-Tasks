'use server'

import { headers } from 'next/headers'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { writeAudit } from '@/lib/audit-log'
import { touchUserLastSeen } from '@/lib/last-seen'
import { getAuthProvider } from '@/lib/providers/auth'
import { getServiceDb } from '@/lib/providers/db'
import { rateLimit } from '@/lib/rate-limit'
import { provisionTenant } from '@/lib/tenant-provisioning'
import { setupDb, setupNeeded } from '@/lib/setup/server'
import { runSetup, SETUP_RATE_LIMIT, type SetupInput, type SetupResult } from '@/lib/setup/run'

/**
 * First-run setup (self-hosted, /setup): creates the first workspace and its
 * owner, then signs them in through the auth provider (the same server-side
 * sign-in the login page uses: httpOnly cookies on this response). The flow
 * and its guards are in lib/setup/run.ts.
 */
export async function completeFirstRunSetup(input: SetupInput): Promise<SetupResult> {
  if (!(await setupNeeded({ fresh: true }))) {
    return { ok: false, done: true, error: 'This install already has an admin account. Sign in instead.' }
  }
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim() || null
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https')
  const origin = (configuredAppUrl()?.trim() || h.get('origin') || (host ? `${proto}://${host}` : '')).replace(/\/+$/, '')
  const ctx = { ip, userAgent: h.get('user-agent'), origin }
  const auth = await getAuthProvider()
  const service = getServiceDb()

  return runSetup({
    org: String(input?.org ?? ''),
    slug: String(input?.slug ?? ''),
    fullName: String(input?.fullName ?? ''),
    email: String(input?.email ?? ''),
    password: String(input?.password ?? ''),
    confirmPassword: String(input?.confirmPassword ?? ''),
    code: String(input?.code ?? ''),
  }, {
    db: setupDb(),
    ip,
    rateLimit: (key) => rateLimit(key, SETUP_RATE_LIMIT),
    provision: (data) => provisionTenant(service, data, auth.admin),
    signIn: async (email, password) => {
      try {
        const user = await auth.signInWithPassword(email, password, ctx)
        await touchUserLastSeen(user.id).catch(() => undefined)
        return true
      } catch (error) {
        console.error('[setup] sign-in after setup failed:', (error as Error).message)
        return false
      }
    },
    audit: async ({ tenantId, userId, slug, email }) => {
      await writeAudit({
        supabase: service,
        tenantId,
        actorId: userId,
        objectType: 'workspace',
        objectId: tenantId,
        action: 'create',
        summary: `First-run setup: created workspace "${slug}" and its owner ${email}`,
        metadata: { source: 'setup', ip, user_agent: h.get('user-agent') },
      })
      console.log(`[setup] first-run setup complete: workspace ${slug}, owner ${email}${ip ? ` (from ${ip})` : ''}`)
    },
  })
}
