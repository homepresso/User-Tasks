/**
 * Whether the Processing add-on (a paid extension with a `processing`
 * provider) is in this build and usable, for pages: Settings →
 * Infrastructure → Processing and the setup wizard show its switches when
 * it is ready, and the upsell (missing from this build / installed without a
 * usable licence, with the reason) otherwise.
 *
 * Licence: instance-wide (tenantId null) for the provider's `feature`,
 * through extensionAccess → the licensing entitlement port: an expired
 * licence keeps working for 24 hours (the warning says when it stops), then
 * core stops asking the provider — work runs in the web app again and the
 * add-on's settings can no longer be changed (configureProcessing refuses).
 *
 * Server-only.
 */
import { hasExtensions } from '@/lib/extensions/registry'
import { getServerExtensions } from '@/lib/extensions/server-registry'
import { extensionAccess } from '@/lib/extensions/state'
import { PROCESSING_FEATURE } from '@/lib/infrastructure/addon'

export interface ProcessingAddonView {
  state: 'missing' | 'unlicensed' | 'ready'
  extensionId: string | null
  /** Why it is unavailable (unlicensed), or the expiry warning (ready, licence expired: changes stop 24 hours after expiry). */
  reason: string | null
}

export async function processingAddonView(): Promise<ProcessingAddonView> {
  try {
    if (!hasExtensions()) return { state: 'missing', extensionId: null, reason: null }
    for (const server of getServerExtensions()) {
      const provider = server.processing
      if (!provider) continue
      const access = await extensionAccess(null, server.id, provider.feature ?? PROCESSING_FEATURE)
      if (!access.usable) return { state: 'unlicensed', extensionId: server.id, reason: access.reason ?? 'No usable licence' }
      // Usable: a reason is the licensing layer's warning (expired, stops 24 hours after expiry).
      return { state: 'ready', extensionId: server.id, reason: access.entitlement.reason ?? null }
    }
    return { state: 'missing', extensionId: null, reason: null }
  } catch (error) {
    return { state: 'missing', extensionId: null, reason: (error as Error).message }
  }
}
