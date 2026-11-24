'use server'

import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { changeEmailProviderAs, saveProviderSettingsAs, setUiSwitchingAs } from '@/lib/admin/infrastructure-settings'
import { appSettingsDeps } from '@/lib/admin/settings-deps'
import { isFreeSettingsChange } from '@/lib/infrastructure/addon'
import { callInfrastructureAction } from '@/lib/infrastructure/dispatch'
import type { InfrastructureActionResult } from '@/lib/extensions/sdk'

/*
 * Settings → Infrastructure. Every action re-checks instance-admin access —
 * the page being visible is not enough. Server actions are POST-only and
 * Next.js rejects cross-origin calls (Origin must match the host), so they
 * can't be triggered from another site.
 *
 * Free here (core): email / sign-in settings, the email transport between
 * SMTP, Resend and log-only, the cloud lock, the egress allowlist. Every
 * other change goes through infrastructureAction() to the Infrastructure
 * add-on, which core refuses itself when the add-on is missing or not
 * licensed (lib/infrastructure/provider) — never only hidden in the UI.
 */

/**
 * Whether the signed-in user is an instance admin (Settings shows the
 * Infrastructure link). The page checks again itself; this only drives the
 * link's visibility.
 */
export async function canViewInfrastructureAction(): Promise<boolean> {
  try {
    const { user } = await getSessionDbWithUser()
    return await viewerCanSeeInfrastructure(user)
  } catch {
    return false
  }
}

async function viewer() {
  const { user } = await getSessionDbWithUser()
  return user ? { id: user.id, email: user.email ?? null } : null
}

/**
 * The Infrastructure add-on's server actions (its pages call them by name):
 * instance admins only, and only while the add-on is installed and licensed
 * (an expired licence keeps working for 24 hours, then changes stop). The
 * running providers are never affected by this check.
 */
export async function infrastructureAction(name: string, input?: unknown): Promise<InfrastructureActionResult> {
  return callInfrastructureAction(await viewer(), String(name), input)
}

/** Edit the current provider's settings: free for email and sign-in; other areas go to the add-on (refused without it). */
export async function saveProviderSettings(input: unknown) {
  const area = (input as { area?: unknown } | null)?.area
  if (typeof area === 'string' && area !== 'email' && area !== 'auth') return infrastructureAction('saveSettings', input)
  if (area === 'email') {
    const { getConfig } = await import('@/lib/config')
    const provider = (await getConfig()).providers.email.id
    if (!isFreeSettingsChange('email', provider)) return infrastructureAction('saveSettings', input)
  }
  return saveProviderSettingsAs(await viewer(), input, appSettingsDeps)
}

/** Change the email transport (SMTP, Resend, log-only: free). */
export async function changeEmailProvider(input: unknown) {
  return changeEmailProviderAs(await viewer(), input, appSettingsDeps)
}

/** Cloud edition: unlock (or lock again) provider changes from this page (typed confirmation; recorded in the switch log). */
export async function setUiSwitching(input: unknown) {
  return setUiSwitchingAs(await viewer(), input, appSettingsDeps)
}

/**
 * "Allow <host>" after a test was refused by the egress guard: add the
 * suggested entry to the private network allowlist
 * (instance.egress_private_allow, the same setting as `usertasks-admin
 * egress allow-private`). Instance admins only, rate limited; the entry is
 * validated like the CLI's (hostname, *.domain or CIDR).
 */
export async function allowPrivateHost(entry: unknown): Promise<{ ok: true; entries: string[] } | { ok: false; error: string }> {
  const user = await viewer()
  if (!user || !(await viewerCanSeeInfrastructure(user))) return { ok: false, error: 'Only instance administrators can change network access.' }
  const { rateLimit } = await import('@/lib/rate-limit')
  if (!(await rateLimit(`infra:egress-allow:${user.id}`, { max: 10, windowMs: 60_000 })).ok) return { ok: false, error: 'Too many requests: wait a minute and try again.' }
  const { getDeploymentMode } = await import('@/lib/deployment')
  if (getDeploymentMode() === 'cloud') return { ok: false, error: 'Private networks cannot be reached from the cloud edition.' }
  const { getInstanceSetting, setInstanceSetting } = await import('@/lib/config/instance-settings')
  const { EGRESS_PRIVATE_ALLOW_SETTING, withAllowEntry } = await import('@/lib/install/egress-server')
  const text = String(entry ?? '').trim()
  if (!text || text.length > 255 || /metadata|^169\.254\.169\.254/i.test(text)) return { ok: false, error: 'That entry cannot be allowed.' }
  try {
    const entries = withAllowEntry(await getInstanceSetting(EGRESS_PRIVATE_ALLOW_SETTING), text)
    await setInstanceSetting(EGRESS_PRIVATE_ALLOW_SETTING, entries, { updatedBy: user.id })
    console.info(`[infrastructure] ${user.email ?? user.id} allowed private egress to ${text}`)
    return { ok: true, entries }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
