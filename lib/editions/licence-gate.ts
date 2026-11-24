/**
 * May this licence pull an edition image? (POST /api/public/extensions/<edition>/pull-token)
 *
 * The same offline verifier as an installation (lib/licensing/format.ts):
 *   - genuine: a known key in the pinned keyring (main or trial keys) and a
 *     matching signature; a licence from a trial key must keep the trial
 *     rules (lib/licensing/trial-policy.ts);
 *   - for this edition: it grants one of the edition's extensions (for the
 *     Enterprise edition ANY paid extension it may contain: sharepoint,
 *     infrastructure, processing), and when it names a SKU, it is that
 *     extension's SKU (`sharepoint-se`, `infrastructure`, `processing-tier`).
 *     The pull service then checks the build actually contains it
 *     (`onlyExtensions`, from the signed edition.json);
 *   - in date: from not_before until expiry + 24 hours (the same cutoff at
 *     which the extension stops; lib/licensing/format.ts timingFor);
 *   - not revoked (EDITION_REVOKED_LICENCES: licence ids, comma separated).
 *
 * The installation binding (instance id / hostnames / farm) is NOT checked
 * here: a fresh install has no instance id yet, and the binding is enforced
 * where it matters, by the installation that runs the extension.
 *
 * Pure: the caller passes `now` and the keyring.
 */

import { checkLicenceSignature, LicenceFormatError, parseLicence, timingFor } from '@/lib/licensing/format'
import { checkTrialPolicy } from '@/lib/licensing/trial-policy'
import type { LicenceKey } from '@/lib/licensing/keyring'
import type { LicenceDocument, LicenceTiming } from '@/lib/licensing/types'
import type { EditionDefinition, EditionExtension } from './catalog'

export type LicenceGateCode = 'licence_malformed' | 'licence_invalid' | 'licence_not_for_edition' | 'licence_not_yet_valid' | 'licence_expired' | 'licence_revoked'

export type LicenceGateResult =
  | { ok: true; licence: LicenceDocument; timing: LicenceTiming; trial: boolean; /** The edition extensions this licence grants (at least one). */ extensions: EditionExtension[] }
  | { ok: false; code: LicenceGateCode; message: string; licenceId?: string; timing?: LicenceTiming }

function day(iso: string | null): string {
  return iso ? iso.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, ' UTC') : ''
}

export function checkLicenceForEdition(input: {
  raw: unknown
  edition: EditionDefinition
  now: Date
  keyring: readonly LicenceKey[]
  revoked?: readonly string[]
  /** Only these extension ids count (what the build contains); default every extension of the edition. */
  onlyExtensions?: readonly string[]
}): LicenceGateResult {
  let licence: LicenceDocument
  try {
    licence = parseLicence(input.raw as string)
  } catch (error) {
    return { ok: false, code: 'licence_malformed', message: error instanceof LicenceFormatError ? error.message : 'The licence could not be read' }
  }
  const id = licence.licence_id
  const signature = checkLicenceSignature(licence, input.keyring)
  if (signature) return { ok: false, code: 'licence_invalid', message: signature.message, licenceId: id }
  const trialProblem = checkTrialPolicy(licence, input.keyring.find((k) => k.kid === licence.kid), input.now)
  if (trialProblem) return { ok: false, code: 'licence_invalid', message: trialProblem.message, licenceId: id }

  const { edition } = input
  const candidates = edition.extensions.filter((x) => !input.onlyExtensions || input.onlyExtensions.includes(x.id))
  const granted = candidates.filter((x) => licence.extensions.some((g) => g.id === x.id) && (!licence.sku || licence.sku === x.sku))
  if (!granted.length) {
    const wanted = candidates.map((x) => `${x.name} (${x.id}, SKU ${x.sku})`).join(', ') || 'none'
    const inEdition = edition.extensions.filter((x) => licence.extensions.some((g) => g.id === x.id))
    const message = input.onlyExtensions && inEdition.length
      ? `This ${edition.name} build does not include ${inEdition.map((x) => x.name).join(', ')} yet. Licences for: ${wanted}.`
      : `This licence is not for ${edition.name} (it must grant ${candidates.length > 1 ? 'one of' : ''} ${wanted}).`.replace('  ', ' ')
    return { ok: false, code: 'licence_not_for_edition', message, licenceId: id }
  }
  if (input.revoked?.includes(id)) {
    return { ok: false, code: 'licence_revoked', message: 'This licence has been withdrawn. Contact UserTasks for a replacement.', licenceId: id }
  }
  const timing = timingFor(licence.expires_at, input.now, licence.not_before)
  if (timing.state === 'not_yet_valid') {
    return { ok: false, code: 'licence_not_yet_valid', message: `This licence is valid from ${day(licence.not_before ?? null)}.`, licenceId: id, timing }
  }
  if (!timing.usable) {
    return {
      ok: false,
      code: 'licence_expired',
      message: `This ${licence.trial ? 'trial ' : ''}licence expired on ${day(timing.expiresAt)}. Downloads and upgrades of ${edition.name} need an active licence; a UserTasks installation that is already running keeps running. Renew (https://usertasks.com/extensions), then try again with the new licence.`,
      licenceId: id,
      timing,
    }
  }
  return { ok: true, licence, timing, trial: licence.trial === true, extensions: granted }
}
