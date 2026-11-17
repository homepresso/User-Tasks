/**
 * The trial licence issuer (usertasks.com only): builds and signs 30-day
 * trial licences with the TRIAL-ONLY key.
 *
 * The private key comes from TRIAL_LICENCE_SIGNING_KEY (Ed25519 PKCS#8 PEM;
 * literal "\n" accepted) and its id from TRIAL_LICENCE_KID (default: the
 * keyring's only trial key). The issuer refuses to sign — "Trials aren't
 * available yet" — unless the key is set, its kid names a `kind: 'trial'`
 * keyring entry, and the key's public half matches that entry. It can never
 * sign with the main licence key: that key is not on any server, and a main
 * (`licence`) keyring entry is refused here even if its private key were set.
 * Every licence is verified against the pinned keyring before it is
 * returned.
 */

import { createPrivateKey, randomBytes } from 'node:crypto'
import { publicKeyBase64 } from '@/lib/packages/format'
import { DAY_MS, signLicence } from './format'
import { LICENCE_KEYRING, trialKeys, type LicenceKey } from './keyring'
import { verifyLicence } from './service'
import { TRIAL_CLOCK_SKEW_MS, TRIAL_SKUS, normaliseFarmId } from './trial-policy'
import { LICENCE_FORMAT_VERSION, LICENCE_KIND, type LicenceDocument } from './types'

export const TRIAL_KEY_ENV = 'TRIAL_LICENCE_SIGNING_KEY'
export const TRIAL_KID_ENV = 'TRIAL_LICENCE_KID'
export const TRIALS_UNAVAILABLE_MESSAGE = "Trials aren't available yet. Contact us and we'll set one up for you."

export type TrialSigner =
  | { available: true; kid: string; keyring: readonly LicenceKey[]; sign: (body: Omit<LicenceDocument, 'signature' | 'kid'>) => LicenceDocument }
  | { available: false; reason: string }

/** The trial signer from the environment, or why there is none. Never logs or returns the key. */
export function trialSigner(env: Record<string, string | undefined> = process.env, keyring: readonly LicenceKey[] = LICENCE_KEYRING): TrialSigner {
  const pem = env[TRIAL_KEY_ENV]?.replace(/\\n/g, '\n').trim()
  if (!pem) return { available: false, reason: `${TRIAL_KEY_ENV} is not set` }
  const trial = trialKeys(keyring)
  const kid = env[TRIAL_KID_ENV]?.trim() || (trial.length === 1 ? trial[0].kid : '')
  if (!kid) return { available: false, reason: trial.length ? `Set ${TRIAL_KID_ENV}: the keyring has several trial keys` : 'No trial key in the keyring (lib/licensing/keyring.ts)' }
  const entry = keyring.find((k) => k.kid === kid)
  if (!entry) return { available: false, reason: `Key ${kid} is not in the keyring` }
  if (entry.kind !== 'trial') return { available: false, reason: `Key ${kid} is not a trial key: the trial issuer never signs with a main licence key` }
  let publicKey: string
  try {
    const key = createPrivateKey(pem)
    if (key.asymmetricKeyType !== 'ed25519') return { available: false, reason: `${TRIAL_KEY_ENV} is not an Ed25519 key` }
    publicKey = publicKeyBase64(key)
  } catch {
    return { available: false, reason: `${TRIAL_KEY_ENV} could not be read` }
  }
  if (publicKey !== entry.public_key) return { available: false, reason: `${TRIAL_KEY_ENV} does not match keyring entry ${kid}` }
  return { available: true, kid, keyring, sign: (body) => signLicence(body, pem, kid) }
}

export function newTrialLicenceId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  return `lic_trial_${Array.from(randomBytes(20), (b) => alphabet[b % alphabet.length]).join('')}`
}

export interface TrialLicenceInput {
  sku: string
  farmId: string
  instanceId?: string | null
  company: string
  licenceId?: string
  now: Date
}

/** The unsigned body of a trial licence (pure). */
export function trialLicenceBody(input: TrialLicenceInput): Omit<LicenceDocument, 'signature' | 'kid'> {
  const policy = TRIAL_SKUS[input.sku]
  if (!policy) throw new Error(`No trial for SKU ${input.sku}`)
  const farm = normaliseFarmId(input.farmId)
  if (!farm) throw new Error('The farm id must be a GUID')
  // Whole seconds; the term is a little under the maximum so clock skew never trips the verifier.
  const issued = new Date(Math.floor(input.now.getTime() / 1000) * 1000)
  const expires = new Date(issued.getTime() + policy.maxTermDays * DAY_MS)
  return {
    format: LICENCE_FORMAT_VERSION,
    kind: LICENCE_KIND,
    licence_id: input.licenceId ?? newTrialLicenceId(),
    customer: { name: input.company.trim().slice(0, 300) || 'Trial' },
    issued_at: issued.toISOString(),
    expires_at: expires.toISOString(),
    sku: input.sku,
    trial: true,
    binding: { farm_ids: [farm], ...(input.instanceId ? { instance_ids: [input.instanceId] } : {}) },
    deployment: ['self_hosted'],
    extensions: [policy.farmLimitKey ? { id: policy.extensionId, limits: { [policy.farmLimitKey.slice(policy.extensionId.length + 1)]: 1 } } : { id: policy.extensionId }],
    notes: `${policy.maxTermDays}-day trial`,
  }
}

/** Sign a trial licence and check it the way an installation will. Throws when it would not verify. */
export function issueTrialLicence(signer: Extract<TrialSigner, { available: true }>, input: TrialLicenceInput, keyring: readonly LicenceKey[] = signer.keyring): LicenceDocument {
  const body = trialLicenceBody(input)
  const doc = signer.sign(body)
  const identity = { instanceId: input.instanceId ?? null, hostnames: [] }
  const check = verifyLicence({ source: 'setting', raw: doc }, identity, new Date(input.now.getTime() + TRIAL_CLOCK_SKEW_MS / 2), keyring)
  if (!check.valid) throw new Error(`The trial licence did not verify: ${check.problems.map((p) => p.message).join('; ')}`)
  return doc
}
