/**
 * Installing, replacing and removing licences, and the offline activation
 * request. The pure checks (checkInstallable, activationRequest) are shared
 * by the app (Settings → Licence, /api/v1/licence) and the admin CLI, which
 * stores the result over its own database connection.
 */

import packageJson from '@/package.json'
import { LICENCE_KEYRING, type LicenceKey } from './keyring'
import { LicenceFormatError, parseLicence } from './format'
import { summarise, verifyLicence, type LicenceSummary } from './service'
import type { InstanceIdentity, LicenceDocument, LicenceProblem } from './types'

/** Problems that make a licence useless here: installing it is refused. */
const REFUSED: ReadonlySet<LicenceProblem['code']> = new Set(['malformed', 'unsupported_format', 'unknown_key', 'bad_signature', 'binding_mismatch', 'expired'])

export interface InstallCheck {
  ok: boolean
  licence: LicenceDocument | null
  summary: LicenceSummary | null
  problems: LicenceProblem[]
  /** Not refusing, but worth saying (valid from a later date). */
  notes: string[]
}

/** Can this licence text be installed on this instance now? */
export function checkInstallable(text: string, identity: InstanceIdentity, now: Date, keyring: readonly LicenceKey[] = LICENCE_KEYRING): InstallCheck {
  let licence: LicenceDocument
  try {
    licence = parseLicence(text)
  } catch (error) {
    const message = error instanceof LicenceFormatError ? error.message : String((error as Error).message)
    return { ok: false, licence: null, summary: null, problems: [{ code: 'malformed', message }], notes: [] }
  }
  const verified = verifyLicence({ source: 'setting', raw: licence }, identity, now, keyring)
  const refused = verified.problems.filter((p) => REFUSED.has(p.code))
  const notes = verified.problems.filter((p) => !REFUSED.has(p.code)).map((p) => p.message)
  return { ok: refused.length === 0, licence, summary: summarise(verified), problems: refused, notes }
}

export const ACTIVATION_REQUEST_KIND = 'usertasks.licence_request'

export interface ActivationRequest {
  kind: typeof ACTIVATION_REQUEST_KIND
  format: 1
  instance_id: string | null
  hostnames: string[]
  version: string
  deployment_mode: 'cloud' | 'self_hosted'
  installed_licences: string[]
  created_at: string
}

/**
 * The offline activation request: what the licensing portal needs to issue a
 * licence bound to this installation. No secrets and no usage data.
 */
export function activationRequest(input: { identity: InstanceIdentity; installed: string[]; now: Date; deploymentMode: 'cloud' | 'self_hosted' }): ActivationRequest {
  return {
    kind: ACTIVATION_REQUEST_KIND,
    format: 1,
    instance_id: input.identity.instanceId,
    hostnames: input.identity.hostnames,
    version: String(packageJson.version),
    deployment_mode: input.deploymentMode,
    installed_licences: input.installed,
    created_at: input.now.toISOString(),
  }
}
