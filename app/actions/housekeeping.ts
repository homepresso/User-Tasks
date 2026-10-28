'use server'

import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { getServiceDb } from '@/lib/providers/db'
import { setInstanceSetting } from '@/lib/config/instance-settings'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { rpcHousekeeping, HousekeepingUnavailableError } from '@/lib/admin/housekeeping'
import { runHousekeepingAs, saveHousekeepingSettingsAs, type HousekeepingActionDeps } from '@/lib/admin/housekeeping-actions'
import type { HousekeepingOption } from '@/lib/config/housekeeping'

/*
 * Settings → Infrastructure → Housekeeping. Instance admins only (checked in
 * lib/admin/housekeeping-actions with the page's own check); settings are
 * written with the service-role client and recorded with the user's id.
 */

const deps: HousekeepingActionDeps = {
  canView: viewerCanSeeInfrastructure,
  client: () => rpcHousekeeping(getServiceDb()),
  writeSetting: (key, value, updatedBy) => setInstanceSetting(key, value, { updatedBy }),
}

async function viewer() {
  const { user } = await getSessionDbWithUser()
  return user ? { id: user.id, email: user.email ?? null } : null
}

function failure(error: unknown, what: string) {
  if (error instanceof HousekeepingUnavailableError) return { ok: false as const, error: error.message }
  console.error(`[housekeeping] ${what}`, error)
  return { ok: false as const, error: `Could not ${what}.` }
}

export async function saveHousekeepingSettings(input: Partial<Record<HousekeepingOption, unknown>>) {
  try {
    return await saveHousekeepingSettingsAs(await viewer(), input, deps)
  } catch (error) {
    return failure(error, 'save the housekeeping settings')
  }
}

export async function runHousekeepingNow(options: { dryRun?: boolean } = {}) {
  try {
    return await runHousekeepingAs(await viewer(), options, deps)
  } catch (error) {
    return failure(error, 'run housekeeping')
  }
}
