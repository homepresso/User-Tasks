/**
 * Licence file format (`usertasks.licence`, format 1) and its offline verifier.
 *
 * A licence is one JSON document (file extension `.licence`; pretty-printed or
 * not, or the same JSON base64-encoded for environment variables):
 *
 *   {
 *     "format": 1, "kind": "usertasks.licence", "licence_id": "lic_…",
 *     "customer": { "id": "cus_…", "name": "Example Corp" },
 *     "issued_at": "2026-11-12T00:00:00Z", "not_before": "…", "expires_at": "2027-11-12T00:00:00Z",
 *     "updates_until": "2027-11-12",
 *     "binding": { "instance_ids": ["inst_…"], "hostnames": ["usertasks.corp.example"] },
 *     "extensions": [{ "id": "sharepoint", "features": ["connector", "importers"], "limits": { "farms": 2 } }],
 *     "limits": { "sharepoint.active_users": 500 },
 *     "kid": "lic-2026-1",
 *     "signature": { "alg": "ed25519", "kid": "lic-2026-1", "value": "<base64>" }
 *   }
 *
 * The signature is Ed25519 over the UTF-8 canonical JSON (lib/packages/format.ts
 * canonicalJson: keys sorted at every depth, no whitespace) of the document
 * without `signature`. Any edit — even re-ordering keys changes nothing, but a
 * changed value does — breaks it. The public key is looked up by `kid` in the
 * pinned keyring (./keyring.ts); a signature carrying its own key is never
 * trusted.
 *
 * Pure: no database, environment or clock access (the caller passes `now`).
 */

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson, keyFingerprint, publicKeyBase64 } from '@/lib/packages/format'
import { LICENCE_KEYRING, type LicenceKey } from './keyring'
import {
  LICENCE_FORMAT_VERSION,
  LICENCE_KIND,
  type InstanceIdentity,
  type LicenceDocument,
  type LicenceProblem,
  type LicenceTiming,
} from './types'

export const LICENCE_FILE_EXTENSION = '.licence'
export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
/** Licensed extensions stop this long after expiry (owner decision: no grace period). */
export const EXPIRY_CUTOFF_MS = 24 * HOUR_MS
/** Days before expiry at which admins are warned (banner from the first, emails at each). */
export const EXPIRY_WARNING_DAYS = [30, 14, 7, 1] as const
export const EXPIRY_WARNING_WINDOW_DAYS = EXPIRY_WARNING_DAYS[0]

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'not a date')
const limitMap = z.record(z.string().min(1).max(100), z.number().finite().nonnegative())
const idText = z.string().trim().min(1).max(200)

export const LicenceDocumentSchema = z.looseObject({
  format: z.number().int(),
  kind: z.literal(LICENCE_KIND),
  licence_id: idText,
  customer: z.looseObject({ id: idText.optional(), name: z.string().trim().min(1).max(300) }),
  issued_at: isoDate,
  not_before: isoDate.optional(),
  expires_at: isoDate,
  updates_until: isoDate.optional(),
  binding: z.looseObject({
    instance_ids: z.array(idText).max(100).optional(),
    hostnames: z.array(z.string().trim().min(1).max(253)).max(100).optional(),
  }).optional(),
  deployment: z.array(z.enum(['self_hosted', 'cloud'])).optional(),
  extensions: z.array(z.looseObject({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/, 'extension ids are lowercase a-z, 0-9 and hyphens'),
    edition: idText.optional(),
    features: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
    limits: limitMap.optional(),
  })).min(1).max(100),
  limits: limitMap.optional(),
  trial: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
  kid: idText,
  signature: z.looseObject({ alg: z.literal('ed25519'), kid: idText, value: z.string().min(1).max(500) }),
})

export class LicenceFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LicenceFormatError'
  }
}

// ─── Parse ─────────────────────────────────────────────────────────────────

/** The JSON value in a licence text: raw JSON, or base64 of it (environment variables). */
export function decodeLicenceText(text: string): unknown {
  const trimmed = text.replace(/^﻿/, '').trim()
  if (!trimmed) throw new LicenceFormatError('The licence is empty')
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed) } catch { throw new LicenceFormatError('The licence is not valid JSON') }
  }
  if (/^[A-Za-z0-9+/=_\-\s]+$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64').toString('utf8').trim()
    if (decoded.startsWith('{')) {
      try { return JSON.parse(decoded) } catch { /* fall through */ }
    }
  }
  throw new LicenceFormatError('The licence is not a UserTasks licence file (expected JSON, or base64-encoded JSON)')
}

/** Parse and shape-check a licence (no signature check). Throws LicenceFormatError. */
export function parseLicence(input: string | unknown): LicenceDocument {
  const value = typeof input === 'string' ? decodeLicenceText(input) : input
  if (value && typeof value === 'object' && (value as { kind?: unknown }).kind !== LICENCE_KIND) {
    throw new LicenceFormatError('Not a UserTasks licence (kind must be "usertasks.licence")')
  }
  if (value && typeof value === 'object' && (value as { format?: unknown }).format !== LICENCE_FORMAT_VERSION) {
    throw new LicenceFormatError(`Unsupported licence format ${JSON.stringify((value as { format?: unknown }).format)} (this version reads format ${LICENCE_FORMAT_VERSION})`)
  }
  const parsed = LicenceDocumentSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new LicenceFormatError(`Malformed licence: ${issue?.path.join('.') || 'document'}: ${issue?.message ?? 'invalid'}`)
  }
  return parsed.data as unknown as LicenceDocument
}

// ─── Sign / verify ─────────────────────────────────────────────────────────

/** The exact bytes that are signed: canonical JSON without `signature`. */
export function licenceSigningPayload(doc: Omit<LicenceDocument, 'signature'> & { signature?: unknown }): string {
  const { signature: _signature, ...rest } = doc
  return canonicalJson(rest)
}

/** Sign a licence body (issuer side: scripts/licence-issue.ts and tests). */
export function signLicence(body: Omit<LicenceDocument, 'signature' | 'kid'> & { kid?: string }, privateKeyPem: string, kid: string): LicenceDocument {
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') throw new LicenceFormatError('The licence signing key must be an Ed25519 private key (PEM)')
  const unsigned = { ...body, kid } as Omit<LicenceDocument, 'signature'>
  const value = sign(null, Buffer.from(licenceSigningPayload(unsigned), 'utf8'), key).toString('base64')
  return { ...unsigned, signature: { alg: 'ed25519', kid, value } }
}

/** The keyring entry for a private key (to print when generating one). */
export function keyringEntryFor(privateKeyPem: string, kid: string): LicenceKey {
  const publicKey = publicKeyBase64(createPrivateKey(privateKeyPem))
  return { kid, public_key: publicKey, fingerprint: keyFingerprint(publicKey) }
}

/** Signature check against the pinned keyring. */
export function checkLicenceSignature(doc: LicenceDocument, keyring: readonly LicenceKey[] = LICENCE_KEYRING): LicenceProblem | null {
  if (doc.signature.kid !== doc.kid) return { code: 'bad_signature', message: 'The signature key id does not match the licence key id' }
  const entry = keyring.find((k) => k.kid === doc.kid)
  if (!entry) return { code: 'unknown_key', message: `Signed with an unknown key (${doc.kid}): this UserTasks version does not trust it` }
  try {
    const key = createPublicKey({ key: Buffer.from(entry.public_key, 'base64'), format: 'der', type: 'spki' })
    const ok = verify(null, Buffer.from(licenceSigningPayload(doc), 'utf8'), key, Buffer.from(doc.signature.value, 'base64'))
    return ok ? null : { code: 'bad_signature', message: 'The signature does not match: the licence was changed or is not genuine' }
  } catch {
    return { code: 'bad_signature', message: 'The signature could not be checked' }
  }
}

// ─── Binding ───────────────────────────────────────────────────────────────

function hostMatches(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase().replace(/\.$/, '')
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  if (!p || !h) return false
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1
  return p === h
}

/** Whether a licence's binding is satisfied (unbound licences always are). */
export function bindingMatches(doc: Pick<LicenceDocument, 'binding'>, identity: InstanceIdentity): boolean {
  const ids = doc.binding?.instance_ids?.filter(Boolean) ?? []
  const hosts = doc.binding?.hostnames?.filter(Boolean) ?? []
  if (!ids.length && !hosts.length) return true
  if (identity.instanceId && ids.includes(identity.instanceId)) return true
  return hosts.some((pattern) => identity.hostnames.some((host) => hostMatches(pattern, host)))
}

export function isBound(doc: Pick<LicenceDocument, 'binding'>): boolean {
  return Boolean(doc.binding?.instance_ids?.length || doc.binding?.hostnames?.length)
}

// ─── Time ──────────────────────────────────────────────────────────────────

/**
 * Time state of a grant that expires at `expiresAt` (null = no expiry).
 * Exactly at expiry and up to (not including) expiry + 24 h: `cutoff_pending`
 * (still usable); from expiry + 24 h: `expired`.
 */
export function timingFor(expiresAt: string | null | undefined, now: Date, notBefore?: string | null): LicenceTiming {
  const t = now.getTime()
  if (notBefore && Date.parse(notBefore) > t) {
    return { state: 'not_yet_valid', expiresAt: expiresAt ?? null, cutoffAt: expiresAt ? new Date(Date.parse(expiresAt) + EXPIRY_CUTOFF_MS).toISOString() : null, daysLeft: null, usable: false }
  }
  if (!expiresAt) return { state: 'active', expiresAt: null, cutoffAt: null, daysLeft: null, usable: true }
  const expires = Date.parse(expiresAt)
  const cutoff = expires + EXPIRY_CUTOFF_MS
  const daysLeft = Math.ceil((expires - t) / DAY_MS)
  const base = { expiresAt: new Date(expires).toISOString(), cutoffAt: new Date(cutoff).toISOString(), daysLeft }
  if (t >= cutoff) return { ...base, state: 'expired', usable: false }
  if (t >= expires) return { ...base, state: 'cutoff_pending', usable: true }
  if (daysLeft <= EXPIRY_WARNING_WINDOW_DAYS) return { ...base, state: 'expiring', usable: true }
  return { ...base, state: 'active', usable: true }
}

/** The warning threshold (30/14/7/1) a number of days left falls on, or null. */
export function warningThreshold(daysLeft: number | null): number | null {
  if (daysLeft === null || daysLeft < 0) return null
  const sorted = [...EXPIRY_WARNING_DAYS].sort((a, b) => a - b)
  return sorted.find((d) => daysLeft <= d) ?? null
}

// ─── Grants ────────────────────────────────────────────────────────────────

/** Namespaced limits of one extension in a licence (`<ext>.<name>`). */
export function licenceLimitsFor(doc: LicenceDocument, extensionId: string): Record<string, number> {
  const out: Record<string, number> = {}
  const prefix = `${extensionId}.`
  for (const [key, value] of Object.entries(doc.limits ?? {})) if (key.startsWith(prefix)) out[key] = value
  for (const grant of doc.extensions) {
    if (grant.id !== extensionId) continue
    for (const [key, value] of Object.entries(grant.limits ?? {})) out[key.startsWith(prefix) ? key : `${prefix}${key}`] = value
  }
  return out
}

/** Whether a features list grants `feature` (no list or `*` = all). */
export function featureGranted(features: readonly string[] | null | undefined, feature: string | undefined): boolean {
  if (!feature) return true
  if (!features || !features.length || features.includes('*')) return true
  return features.includes(feature)
}
