/**
 * Settings → Licence and the licence banner, behind the server actions in
 * app/actions/licence.ts. Every call re-checks that the signed-in user is an
 * instance admin (INSTANCE_ADMIN_EMAILS / instance.admin_emails, verified
 * email) — the page being visible is not enough.
 */

import type { ActionResult } from '@/lib/action-result'
import { isServiceError, ServiceError } from '@/lib/services/context'
import type { InfrastructureViewer } from '@/lib/admin/instance-admins'
import type { ActivationRequest } from './install'
import type { InstallResult, LicenceStatusView } from './admin'
import type { LicenceWarning } from './service'

export interface LicenceUiDeps {
  canView: (user: InfrastructureViewer | null | undefined) => Promise<boolean>
  status: () => Promise<LicenceStatusView>
  install: (text: string, who: { actorId: string | null; actor: string }) => Promise<InstallResult>
  remove: (licenceId: string, who: { actorId: string | null; actor: string }) => Promise<{ removed: string[] }>
  request: () => Promise<ActivationRequest>
  warnings: () => Promise<LicenceWarning[]>
}

const DENIED = 'Only instance admins can manage the licence'

async function guard<T>(user: InfrastructureViewer | null | undefined, deps: LicenceUiDeps, fn: (who: { actorId: string | null; actor: string }) => Promise<T>): Promise<ActionResult<T>> {
  if (!(await deps.canView(user).catch(() => false)) || !user) return { ok: false, error: DENIED }
  try {
    return { ok: true, data: await fn({ actorId: user.id, actor: user.email ?? user.id }) }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    console.error('[licensing] action failed:', error)
    return { ok: false, error: 'The licence action failed; see the server log' }
  }
}

export function licenceStatusAs(user: InfrastructureViewer | null | undefined, deps: LicenceUiDeps) {
  return guard(user, deps, () => deps.status())
}

export function installLicenceAs(user: InfrastructureViewer | null | undefined, text: unknown, deps: LicenceUiDeps) {
  return guard(user, deps, (who) => deps.install(typeof text === 'string' ? text : '', who))
}

export function removeLicenceAs(user: InfrastructureViewer | null | undefined, licenceId: unknown, deps: LicenceUiDeps) {
  return guard(user, deps, async (who) => {
    if (typeof licenceId !== 'string' || !licenceId.trim()) throw ServiceError.validation('Choose the licence to remove')
    return deps.remove(licenceId, who)
  })
}

export function licenceRequestAs(user: InfrastructureViewer | null | undefined, deps: LicenceUiDeps) {
  return guard(user, deps, () => deps.request())
}

/** Banner warnings: only for instance admins (empty for everyone else, never an error). */
export async function licenceBannerAs(user: InfrastructureViewer | null | undefined, deps: LicenceUiDeps): Promise<LicenceWarning[]> {
  try {
    if (!user || !(await deps.canView(user))) return []
    return await deps.warnings()
  } catch {
    return []
  }
}
