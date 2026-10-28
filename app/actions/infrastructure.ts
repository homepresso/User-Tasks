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
