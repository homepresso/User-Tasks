'use server'

import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { installLicence, licenceActivationRequest, licenceStatusView, removeInstalledLicence } from '@/lib/licensing/admin'
import { getLicenceStatus } from '@/lib/licensing/service'
import { asInstanceAdmin, installLicenceAs, licenceBannerAs, licenceRequestAs, licenceStatusAs, removeLicenceAs, type LicenceUiDeps } from '@/lib/licensing/ui-actions'

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

// ─── Self-serve trials ─────────────────────────────────────────────────────

/** Start a trial from this installation: online through usertasks.com, else the offline request code. */
export async function startTrialAction(input: { extensionId: string; farmId: string; name: string; email: string; company: string; acceptTerms: boolean }) {
  return asInstanceAdmin(await viewer(), deps.canView, async (who) => {
    const { startTrial, defaultTrialClientDeps } = await import('@/lib/licensing/trial-client')
    return startTrial({
      extensionId: String(input?.extensionId ?? ''), farmId: String(input?.farmId ?? ''), name: String(input?.name ?? ''),
      email: String(input?.email ?? ''), company: String(input?.company ?? ''), acceptTerms: input?.acceptTerms === true,
    }, who, await defaultTrialClientDeps())
  })
}

/** The request code to copy for an offline trial (air-gapped farms). */
export async function trialRequestCodeAction(input: { extensionId: string; farmId: string }) {
  return asInstanceAdmin(await viewer(), deps.canView, async () => {
    const { trialRequestCode, defaultTrialClientDeps } = await import('@/lib/licensing/trial-client')
    try {
      return { requestCode: await trialRequestCode({ extensionId: String(input?.extensionId ?? ''), farmId: String(input?.farmId ?? '') }, await defaultTrialClientDeps()) }
    } catch (error) {
      const { ServiceError } = await import('@/lib/services/context')
      throw ServiceError.validation(error instanceof Error ? error.message : String(error))
    }
  })
}

/** Farms this installation already knows (pre-fills the trial form), from the extension's licensing hook. */
export async function trialFarmsAction(extensionId: string) {
  return asInstanceAdmin(await viewer(), deps.canView, async () => {
    const [{ getServerExtension }, { createExtensionContext }, { fromSession }] = await Promise.all([
      import('@/lib/extensions/server-registry'), import('@/lib/extensions/host'), import('@/lib/services/context'),
    ])
    const hook = getServerExtension(String(extensionId))?.licensing?.trialFarms
    if (!hook) return [] as Array<{ id: string; label?: string }>
    const tenantId = await fromSession().then((c) => c.tenantId).catch(() => null)
    try {
      return (await hook({ ctx: createExtensionContext({ extensionId: String(extensionId), tenantId, actorId: null }) })).slice(0, 20)
    } catch {
      return []
    }
  })
}

/** Trials issued by usertasks.com (cloud instance admins). */
export async function listIssuedTrialsAction() {
  return asInstanceAdmin(await viewer(), deps.canView, async () => {
    const { isCloud } = await import('@/lib/deployment')
    if (!isCloud()) return { cloud: false, available: false, reason: null, trials: [] }
    const [{ supabaseTrialStore, trialsAvailable }, { trialSigner }, { getServiceDb }] = await Promise.all([
      import('@/lib/licensing/trial-service'), import('@/lib/licensing/trial-issuer'), import('@/lib/providers/db'),
    ])
    const store = supabaseTrialStore(getServiceDb())
    const available = await trialsAvailable({ signer: () => trialSigner(), store: () => store })
    const rows = await store.list(200).catch(() => [])
    return {
      cloud: true,
      available: available.available,
      reason: available.reason ?? null,
      trials: rows.map((r) => ({ licence_id: r.licence_id, sku: r.sku, farm_id: r.farm_id, instance_id: r.instance_id, name: r.name, email: r.email, company: r.company, source: r.source, issued_at: r.issued_at, expires_at: r.expires_at, emailed_at: r.emailed_at ?? null, resent_count: r.resent_count ?? 0 })),
    }
  })
}
