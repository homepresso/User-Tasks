/**
 * Gateway versions the cloud advertises (poll / register answers, the UI's
 * "update available"): the latest release of packages/gateway and the
 * minimum version still given work. Overridable per deployment with
 * GATEWAY_LATEST_VERSION / GATEWAY_MIN_VERSION.
 */
import gatewayPackage from '@/packages/gateway/package.json'

/** Oldest gateway version that speaks protocol v1 as this server expects. */
export const GATEWAY_MIN_VERSION = '1.0.0'

export function gatewayVersionPolicy(): { latest: string | null; min: string | null } {
  const latest = process.env.GATEWAY_LATEST_VERSION?.trim() || String(gatewayPackage.version ?? '') || null
  const min = process.env.GATEWAY_MIN_VERSION?.trim() || GATEWAY_MIN_VERSION
  return { latest, min }
}
