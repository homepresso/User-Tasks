/**
 * Licensing types.
 *
 * EntitlementDecision / EntitlementPort are a LOCAL COPY of the port the
 * extension framework declares in lib/extensions/entitlement-port.ts (owned by
 * the framework). They MUST stay identical to it: the coordinator wires
 * registerLicensingEntitlements(setEntitlementPort) at boot, and TypeScript
 * checks the shapes match at that call.
 */

export type EntitlementState = 'licensed' | 'unlicensed' | 'expired' | 'not_required'

export type EntitlementDecision = {
  allowed: boolean
  state: EntitlementState
  reason?: string
  limits?: Record<string, number>
}

export interface EntitlementCheckInput {
  tenantId: string | null
  extensionId: string
  feature?: string
}

export interface EntitlementPort {
  check(input: EntitlementCheckInput): Promise<EntitlementDecision>
}

/** What an extension manifest declares about licensing (`licence` member). */
export interface ExtensionLicenceDeclaration {
  tier: 'free' | 'paid'
  /** Commercial SKU the extension is sold as (informational). */
  sku?: string
  /** Features the licence can grant (informational; the licence decides). */
  features?: string[]
}

// ─── Licence document ──────────────────────────────────────────────────────

export const LICENCE_FORMAT_VERSION = 1
export const LICENCE_KIND = 'usertasks.licence'

export interface LicenceExtensionGrant {
  /** Extension id, as in the extension manifest (e.g. `sharepoint`). */
  id: string
  edition?: string
  /** Features granted; omitted or containing `*` = every feature. */
  features?: string[]
  /** Limits for this extension, short names (`farms`) — normalised to `<id>.<name>`. */
  limits?: Record<string, number>
}

export interface LicenceSignature {
  alg: 'ed25519'
  /** Key id in the verifier's keyring (key rotation). */
  kid: string
  /** Ed25519 signature over canonicalJson(document without `signature`), base64. */
  value: string
}

export interface LicenceDocument {
  format: number
  kind: string
  licence_id: string
  customer: { id?: string; name: string }
  issued_at: string
  not_before?: string
  expires_at: string
  /** Newest extension release date this licence covers (informational for now). */
  updates_until?: string
  /** Empty or missing = unbound (trials). Either list matching is enough. */
  binding?: { instance_ids?: string[]; hostnames?: string[] }
  /** Deployment kinds the licence is for (informational). */
  deployment?: Array<'self_hosted' | 'cloud'>
  extensions: LicenceExtensionGrant[]
  /** Namespaced numeric limits, e.g. `{ "sharepoint.farms": 2 }`. */
  limits?: Record<string, number>
  trial?: boolean
  notes?: string
  /** Signing key id (must equal signature.kid). */
  kid: string
  signature: LicenceSignature
}

/** Time state of a licence or entitlement against the clock. */
export type LicenceTimeState =
  /** before not_before */
  | 'not_yet_valid'
  /** more than the warning window left */
  | 'active'
  /** within the warning window before expiry */
  | 'expiring'
  /** expired less than 24 hours ago: still works, about to stop */
  | 'cutoff_pending'
  /** expired 24 hours ago or more: denied */
  | 'expired'

export interface LicenceTiming {
  state: LicenceTimeState
  expiresAt: string | null
  /** expires_at + 24 h: when the licensed extensions stop. */
  cutoffAt: string | null
  /** Whole days until expiry (negative once expired); null without an expiry. */
  daysLeft: number | null
  /** Whether the grant still allows use (active, expiring or cutoff_pending). */
  usable: boolean
}

export type LicenceProblemCode =
  | 'malformed'
  | 'unsupported_format'
  | 'unknown_key'
  | 'bad_signature'
  | 'not_yet_valid'
  | 'expired'
  | 'binding_mismatch'

export interface LicenceProblem {
  code: LicenceProblemCode
  message: string
}

/** Where an installed licence came from. */
export type LicenceSource = 'setting' | 'env' | 'env_file'

export interface VerifiedLicence {
  source: LicenceSource
  /** Parsed document (null when it could not be parsed). */
  licence: LicenceDocument | null
  /** Signature good, known key, binding matches, not before not_before (expiry is reported in timing). */
  valid: boolean
  problems: LicenceProblem[]
  timing: LicenceTiming | null
}

/** A cloud entitlement row (public.tenant_entitlements). */
export interface TenantEntitlementRow {
  id?: string
  tenant_id: string
  extension_id: string
  edition?: string | null
  features?: string[] | null
  limits?: Record<string, number> | null
  status: 'active' | 'suspended' | 'revoked'
  source: 'admin' | 'trial' | 'stripe' | 'licence'
  starts_at?: string | null
  ends_at?: string | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
  updated_by?: string | null
}

export interface InstanceIdentity {
  instanceId: string | null
  /** Hostnames this instance answers on (APP_URL host, LICENCE_HOSTNAMES). */
  hostnames: string[]
}
