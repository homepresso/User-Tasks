'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { applySwitchAs, saveProviderSettingsAs } from '@/lib/admin/infrastructure-switching'
import { appSwitchDeps } from '@/lib/admin/switch/app-runner'
import { appUrlOrLocalhost, configuredAppUrl } from '@/lib/config/bootstrap'
import { markStepAs, removeIdpAs, saveEmailAs, saveIdpAs, sendTestEmailAs, testIdpAs, type WizardDeps } from '@/lib/setup/wizard-server'
import { checkAddress, parseInviteList, type AddressCheck } from '@/lib/setup/wizard-model'

/*
 * The setup wizard (/settings/setup). Instance admins only, re-checked in
 * every action (lib/setup/wizard-server.ts), on top of the page's own
 * check. Server actions are POST-only and Next.js refuses cross-origin
 * calls (the Origin must match the host), which is the CSRF protection the
 * rest of Settings relies on too. Provider changes reuse Settings →
 * Infrastructure's engine (switch log, backups, rollback, the UI switching
 * gate); tests are rate limited and egress-guarded.
 */

async function viewer() {
  const { user } = await getSessionDbWithUser()
  return user ? { id: user.id, email: user.email ?? null } : null
}

const deps: WizardDeps = {
  canView: viewerCanSeeInfrastructure,
  rateLimit: async (key, max) => {
    const { rateLimit } = await import('@/lib/rate-limit')
    return (await rateLimit(key, { max, windowMs: 60_000 })).ok
  },
  readSetting: async (key) => (await import('@/lib/config/instance-settings')).getInstanceSetting(key),
  writeSetting: async (key, value, updatedBy) => {
    const { setInstanceSetting } = await import('@/lib/config/instance-settings')
    await setInstanceSetting(key, value, { updatedBy })
  },
  config: async () => (await import('@/lib/config')).getConfig(),
  checkHosts: async (hosts) => (await import('@/lib/install/egress-server')).checkHostsAllowed(hosts),
  checkIdp: async (idp, origin) => (await import('@/lib/providers/auth/sso/check')).checkSsoProvider(idp, origin, fetch),
  sendTestEmail: async (to) => {
    const [{ getConfig }, { runDoctor }] = await Promise.all([import('@/lib/config'), import('@/lib/admin/doctor')])
    const report = await runDoctor({ config: await getConfig(), areas: ['email'], emailTo: to, timeoutMs: 20_000 })
    return report.checks.map((c) => ({ name: c.name, status: c.status, detail: c.detail }))
  },
  saveSettings: (user, input) => saveProviderSettingsAs(user, input, appSwitchDeps),
  applySwitch: (user, input) => applySwitchAs(user, input, appSwitchDeps),
  appUrl: () => appUrlOrLocalhost().replace(/\/+$/, ''),
}

function done<T extends { ok: boolean }>(result: T): T {
  if (result.ok) revalidatePath('/settings/setup')
  return result
}

export async function setupWizardStep(step: string, status: 'done' | 'skipped') {
  return done(await markStepAs(await viewer(), step, status, deps))
}

export async function setupWizardTestIdp(input: unknown) {
  return testIdpAs(await viewer(), input, deps)
}

export async function setupWizardSaveIdp(input: unknown) {
  return done(await saveIdpAs(await viewer(), input, deps))
}

export async function setupWizardRemoveIdp(id: string) {
  return done(await removeIdpAs(await viewer(), id, deps))
}

export async function setupWizardSaveEmail(input: unknown) {
  return done(await saveEmailAs(await viewer(), input, deps))
}

export async function setupWizardSendTestEmail(to: string) {
  return sendTestEmailAs(await viewer(), to, deps)
}

/** The address people should open vs. APP_URL (no outbound request). */
export async function setupWizardAddressCheck(): Promise<{ ok: true; check: AddressCheck } | { ok: false; error: string }> {
  const user = await viewer()
  if (!user || !(await viewerCanSeeInfrastructure(user))) return { ok: false, error: 'Only instance administrators can use the setup wizard.' }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https')
  return { ok: true, check: checkAddress(configuredAppUrl() ?? null, host ? `${proto}://${host}` : null) }
}

/** Organisation details (the same service as the first-run onboarding page; needs settings.edit, which the owner holds). */
export async function setupWizardOrganisation(input: { name: string; slug: string; contactName?: string; contactEmail?: string }): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const user = await viewer()
  if (!user || !(await viewerCanSeeInfrastructure(user))) return { ok: false, error: 'Only instance administrators can use the setup wizard.' }
  const [{ fromSession, isServiceError }, { completeOnboarding }] = await Promise.all([import('@/lib/services/context'), import('@/lib/services/tenant-settings')])
  try {
    const result = await completeOnboarding(await fromSession(), {
      name: String(input?.name ?? ''), slug: String(input?.slug ?? ''),
      contact_name: input?.contactName?.trim() || null, contact_email: input?.contactEmail?.trim() || null,
    })
    await markStepAs(user, 'organisation', 'done', deps)
    revalidatePath('/settings/setup')
    return { ok: true, slug: result.slug }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    console.error('[setup-wizard] organisation:', error)
    return { ok: false, error: 'Could not save the organisation. Try again.' }
  }
}

export interface InviteOutcome {
  email: string
  ok: boolean
  emailSent?: boolean
  error?: string
}

/** Invite people to the organisation (the invitations service: team.invite, which the owner holds). */
export async function setupWizardInvite(input: { emails: string; role?: string }): Promise<{ ok: true; results: InviteOutcome[]; invalid: string[] } | { ok: false; error: string }> {
  const user = await viewer()
  if (!user || !(await viewerCanSeeInfrastructure(user))) return { ok: false, error: 'Only instance administrators can use the setup wizard.' }
  const { emails, invalid } = parseInviteList(String(input?.emails ?? ''))
  if (!emails.length) return { ok: false, error: invalid.length ? `Not an email address: ${invalid.join(', ')}` : 'Enter at least one email address.' }
  if (emails.length > 50) return { ok: false, error: 'Up to 50 at a time: invite the rest from Team → Invite.' }
  const [{ fromSession, isServiceError }, { sendInvitation }] = await Promise.all([import('@/lib/services/context'), import('@/lib/services/invitations')])
  const ctx = await fromSession()
  const role = input?.role === 'admin' || input?.role === 'viewer' ? input.role : 'member'
  const results: InviteOutcome[] = []
  for (const email of emails) {
    try {
      const res = await sendInvitation(ctx, { email, role })
      results.push({ email, ok: true, emailSent: res.email_sent, ...(res.email_sent ? {} : { error: 'email_error' in res ? String(res.email_error) : 'The email could not be sent' }) })
    } catch (error) {
      results.push({ email, ok: false, error: isServiceError(error) ? error.message : 'Could not invite' })
    }
  }
  revalidatePath('/settings/setup')
  return { ok: true, results, invalid }
}
