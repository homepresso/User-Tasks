'use server'

import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { installLicence, licenceActivationRequest, licenceStatusView, removeInstalledLicence } from '@/lib/licensing/admin'
import { getLicenceStatus } from '@/lib/licensing/service'
import { installLicenceAs, licenceBannerAs, licenceRequestAs, licenceStatusAs, removeLicenceAs, type LicenceUiDeps } from '@/lib/licensing/ui-actions'

/*
 * Settings → Licence and the app-shell licence banner. Every action re-checks
 * instance-admin access (lib/licensing/ui-actions.ts). Server actions are
 * POST-only and Next.js rejects cross-origin calls.
 */

const deps: LicenceUiDeps = {
  canView: viewerCanSeeInfrastructure,
  status: () => licenceStatusView({ fresh: true }),
  install: (text, who) => installLicence(text, who),
  remove: (id, who) => removeInstalledLicence(id, who),
  request: licenceActivationRequest,
  warnings: async () => (await getLicenceStatus()).warnings,
}

async function viewer() {
  try {
    const { user } = await getSessionDbWithUser()
    return user ? { id: user.id, email: user.email ?? null } : null
  } catch {
    return null
  }
}

export async function getLicenceStatusAction() {
  return licenceStatusAs(await viewer(), deps)
}

export async function installLicenceAction(text: string) {
  return installLicenceAs(await viewer(), text, deps)
}

export async function removeLicenceAction(licenceId: string) {
  return removeLicenceAs(await viewer(), licenceId, deps)
}

export async function licenceRequestAction() {
  return licenceRequestAs(await viewer(), deps)
}

/** Expiry / invalid-licence warnings for the shell banner (instance admins only; [] for everyone else). */
export async function licenceBannerAction() {
  return licenceBannerAs(await viewer(), deps)
}
