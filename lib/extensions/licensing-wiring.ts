/**
 * Installs the licensing implementation (lib/licensing) into the framework's
 * entitlement port, so every gate (extensionAccess: API / MCP / public routes,
 * nodes, triggers, jobs, UI payload; the settings service) decides with
 * installed licences and cloud workspace entitlements instead of the
 * manifest-only default (which denies every paid extension).
 *
 * Imported for its side effect by ./server-registry — the module every
 * server-side extension path loads — so no entry point can miss it. Server
 * only (lib/licensing reads instance settings, secrets and node:crypto); the
 * client bundle keeps the manifest-only default in ./entitlement-port.
 */

import { setEntitlementPort } from './entitlement-port'
import { getExtensionManifest } from './registry'
import { registerLicensingEntitlements } from '@/lib/licensing/entitlement-port-impl'

let lookupInstalled = false

/**
 * (Re)install the licensing port. Idempotent: the manifest lookup is chained
 * into the licensing layer once per module instance; the port itself is set
 * on every call (tests call this after resetEntitlementPort()).
 */
export function wireLicensingEntitlements(): void {
  registerLicensingEntitlements(setEntitlementPort, lookupInstalled ? {} : { licenceOf: (id) => getExtensionManifest(id)?.licence })
  lookupInstalled = true
}

wireLicensingEntitlements()
