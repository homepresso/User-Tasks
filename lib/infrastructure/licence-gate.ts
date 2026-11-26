import { LICENCE_KEYRING, type LicenceKey } from '@/lib/licensing/keyring'
import { instanceHostnames } from '@/lib/licensing/instance'
import { licenceGrants, resolveDecision, verifyLicence } from '@/lib/licensing/service'
import type { RawLicence } from '@/lib/licensing/store'
import type { EntitlementDecision, InstanceIdentity } from '@/lib/licensing/types'
import { INFRASTRUCTURE_EXTENSION_ID, INFRASTRUCTURE_FEATURE } from './addon'

/**
 * Offline checks of an Infrastructure licence, outside the running app:
 *
 *  - the installers, before they write a separated install profile
 *    (`usertasks-admin install profile write|apply --licence <file>`): there
 *    is no database yet, so the licence file itself is verified — signature
 *    against the pinned keyring (no network: air-gapped installs work), dates
 *    (it stops 24 hours after expiry, as every extension licence does), the
 *    `infrastructure` extension with the `infrastructure-separation` feature,
 *    and its binding (a licence bound to hostnames must name the install's
 *    address; one bound only to an instance id can't be checked before the
 *    instance exists and is refused with that reason);
 *  - `usertasks-admin switch|rollback`, over the CLI's own connection (the
 *    licences installed in instance_settings plus USERTASKS_LICENCE[_FILE]).
 *
 * The app itself decides through the extension framework (extensionAccess →
 * the licensing entitlement port), with the same verifier and rules.
 */

export interface InfrastructureLicenceCheck {
  ok: boolean
  /** Why not (or the expiry warning when ok). */
  reason: string | null
  decision: EntitlementDecision
  licenceId: string | null
  customer: string | null
  expiresAt: string | null
}

/** The decision for the add-on from raw licences (no database, no network). */
export function infrastructureDecision(raw: RawLicence[], identity: InstanceIdentity, now: Date, keyring: readonly LicenceKey[] = LICENCE_KEYRING): EntitlementDecision {
  const verified = raw.map((entry) => verifyLicence(entry, identity, now, keyring))
  return resolveDecision({
    extensionId: INFRASTRUCTURE_EXTENSION_ID,
    feature: INFRASTRUCTURE_FEATURE,
    declaration: { tier: 'paid' },
    grants: licenceGrants(verified, INFRASTRUCTURE_EXTENSION_ID),
  })
}

/**
 * Check a licence file's text for an install at `appUrl` (offline). The
 * instance id is unknown before the first start unless the installer passes
 * the one an existing install has.
 */
export function checkInfrastructureLicenceText(text: string, input: { appUrl: string | undefined; now?: Date; instanceId?: string | null; keyring?: readonly LicenceKey[] }): InfrastructureLicenceCheck {
  return checkAddonLicenceText(text, { ...input, extensionId: INFRASTRUCTURE_EXTENSION_ID, feature: INFRASTRUCTURE_FEATURE, addonName: 'Infrastructure' })
}

/**
 * The same offline check for any paid add-on's licence (the Processing
 * add-on's installer step uses it with extension `processing`, feature
 * `processing`).
 */
export function checkAddonLicenceText(text: string, input: { appUrl: string | undefined; now?: Date; instanceId?: string | null; keyring?: readonly LicenceKey[]; extensionId: string; feature: string; addonName: string }): InfrastructureLicenceCheck {
  const { extensionId, feature } = input
  const now = input.now ?? new Date()
  const keyring = input.keyring ?? LICENCE_KEYRING
  const identity: InstanceIdentity = { instanceId: input.instanceId ?? null, hostnames: instanceHostnames(input.appUrl) }
  const verified = verifyLicence({ source: 'env_file', raw: text }, identity, now, keyring)
  const base = { licenceId: verified.licence?.licence_id ?? null, customer: verified.licence?.customer?.name ?? null, expiresAt: verified.licence?.expires_at ?? null }
  const fatal = verified.problems.find((p) => p.code === 'malformed' || p.code === 'unsupported_format' || p.code === 'unknown_key' || p.code === 'bad_signature' || p.code === 'trial_policy')
  if (fatal) {
    return { ok: false, reason: `The licence file was not accepted: ${fatal.message}.`, decision: { allowed: false, state: 'unlicensed', reason: fatal.message }, ...base }
  }
  const binding = verified.problems.find((p) => p.code === 'binding_mismatch')
  if (binding) {
    const onlyInstance = Boolean(verified.licence?.binding?.instance_ids?.length) && !verified.licence?.binding?.hostnames?.length
    return {
      ok: false,
      reason: onlyInstance && !identity.instanceId
        ? `This licence is bound to an instance id, which a new install does not have yet: install with the standard stack first, then run \`usertasks-admin licence install <file>\` and ${input.addonName === 'Infrastructure' ? 'change providers in Settings → Infrastructure' : 'turn the add-on on in Settings → Infrastructure'}, or ask for a licence bound to this address.`
        : `This licence is for another installation: ${binding.message}.`,
      decision: { allowed: false, state: 'unlicensed', reason: binding.message },
      ...base,
    }
  }
  const decision = resolveDecision({ extensionId, feature, declaration: { tier: 'paid' }, grants: licenceGrants([verified], extensionId) })
  return { ok: decision.allowed, reason: decision.reason ?? null, decision, ...base }
}
