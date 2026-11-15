'use server'

import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import {
  applySwitchAs,
  cancelSwitchAs,
  checkSecretRefAs,
  loadWizardAs,
  previewSwitchAs,
  recentSwitchesAs,
  retrySwitchAs,
  rollbackSwitchAs,
  saveProviderSettingsAs,
  setUiSwitchingAs,
  switchRecordAs,
} from '@/lib/admin/infrastructure-switching'
import { appSwitchDeps } from '@/lib/admin/switch/app-runner'

/*
 * Settings → Infrastructure. Every action re-checks instance-admin access
 * (lib/admin/infrastructure-switching, with the page's own check) — the
 * page being visible is not enough. Server actions are POST-only and
 * Next.js rejects cross-origin calls (Origin must match the host), so they
 * can't be triggered from another site.
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

export async function loadSwitchWizard(area: string) {
  return loadWizardAs(await viewer(), area, appSwitchDeps)
}

/** Test connection: the target's pre-flight checks against the proposed config (nothing saved). */
export async function testProviderChange(input: unknown) {
  return previewSwitchAs(await viewer(), input, 'test', appSwitchDeps)
}

/** Review plan: the switch's dry run (nothing saved). */
export async function planProviderChange(input: unknown) {
  return previewSwitchAs(await viewer(), input, 'plan', appSwitchDeps)
}

export async function applyProviderChange(input: unknown) {
  return applySwitchAs(await viewer(), input, appSwitchDeps)
}

export async function saveProviderSettings(input: unknown) {
  return saveProviderSettingsAs(await viewer(), input, appSwitchDeps)
}

export async function getProviderSwitch(id: string) {
  return switchRecordAs(await viewer(), id, appSwitchDeps)
}

export async function listProviderSwitches() {
  return recentSwitchesAs(await viewer(), appSwitchDeps)
}

export async function rollbackProviderSwitch(input: unknown) {
  return rollbackSwitchAs(await viewer(), input, appSwitchDeps)
}

export async function cancelProviderSwitch(id: string) {
  return cancelSwitchAs(await viewer(), id, appSwitchDeps)
}

export async function retryProviderSwitch(id: string) {
  return retrySwitchAs(await viewer(), id, appSwitchDeps)
}

export async function checkSecretReference(ref: string) {
  return checkSecretRefAs(await viewer(), ref, appSwitchDeps)
}

/** Cloud edition: unlock (or lock again) provider changes from this page (typed confirmation; recorded in the switch log). */
export async function setUiSwitching(input: unknown) {
  return setUiSwitchingAs(await viewer(), input, appSwitchDeps)
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
