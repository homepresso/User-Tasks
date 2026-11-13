/**
 * The real EntitlementPort for the extension framework
 * (lib/extensions/entitlement-port.ts, owned by the framework).
 *
 * Wiring (at boot, done by the coordinator when the branches merge):
 *
 *   import { setEntitlementPort } from '@/lib/extensions/entitlement-port'
 *   import { registerLicensingEntitlements } from '@/lib/licensing/entitlement-port-impl'
 *   registerLicensingEntitlements(setEntitlementPort, { licenceOf: (id) => registry.get(id)?.manifest.licence })
 *
 * Manifests declare `licence: { tier: 'free' | 'paid', sku?, features? }`:
 * free → `not_required`; paid (or an extension whose manifest isn't known
 * here — fail closed) → the licence / cloud entitlement decision
 * (lib/licensing/service.ts).
 */

import { checkEntitlement, licensingDeps, registerExtensionLicence } from './service'
import type { EntitlementCheckInput, EntitlementDecision, EntitlementPort, ExtensionLicenceDeclaration } from './types'

export const licensingEntitlementPort: EntitlementPort = {
  check(input: EntitlementCheckInput): Promise<EntitlementDecision> {
    return checkEntitlement(input)
  },
}

export interface RegisterLicensingOptions {
  /** The manifest `licence` declaration of an extension (the framework's registry). */
  licenceOf?: (extensionId: string) => ExtensionLicenceDeclaration | null | undefined
  /** Declarations to register up front (extension id → manifest licence). */
  declarations?: Record<string, ExtensionLicenceDeclaration>
}

/** Install the licensing port into the framework. Returns the port. */
export function registerLicensingEntitlements(
  setEntitlementPort: (port: EntitlementPort) => void,
  options: RegisterLicensingOptions = {},
): EntitlementPort {
  for (const [id, declaration] of Object.entries(options.declarations ?? {})) registerExtensionLicence(id, declaration)
  if (options.licenceOf) {
    const fallback = licensingDeps.licenceOf
    const lookup = options.licenceOf
    licensingDeps.licenceOf = (id) => lookup(id) ?? fallback(id)
  }
  setEntitlementPort(licensingEntitlementPort)
  return licensingEntitlementPort
}
