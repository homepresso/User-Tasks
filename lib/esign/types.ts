/**
 * The shared e-signature model: what every provider adapter accepts and
 * returns. Provider payloads are mapped onto these shapes so workflows read
 * `{{envelope.status}}`, `{{signature.recipients}}` … the same way for
 * DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, SignNow and BoldSign.
 */

import type { EnvelopeStatus, EsignEventType, EsignProviderId, RecipientStatus } from './catalog'

export interface EsignDocument {
  name: string
  mime_type: string
  bytes: Uint8Array
}

/** Simple field placement: anchor text in the document (DocuSign) — text tags elsewhere. */
export interface EsignAnchor {
  /** Anchor text for the signature field, e.g. "/sn1/". */
  signature?: string
  /** Anchor text for the date-signed field. */
  date?: string
  /** Anchor text for the full-name field. */
  name?: string
  x_offset?: number
  y_offset?: number
}

export interface EsignRecipientInput {
  name: string
  email: string
  /** Role name (templates map recipients by role; documents use it as a label). */
  role?: string
  /** 1-based signing order (same number = sign in parallel). */
  routing_order?: number
  /** signer (default) or cc (receives a copy). */
  kind?: 'signer' | 'cc'
  anchor?: EsignAnchor
}

export interface SendCommon {
  subject: string
  message?: string
  recipients: EsignRecipientInput[]
  /** Remind unsigned recipients every N days (where supported). */
  reminder_days?: number
  /** The envelope expires after N days (where supported). */
  expires_in_days?: number
  /** Recipients sign through a link UserTasks shows (no provider email where supported). */
  embedded?: boolean
  /** Sandbox request (Dropbox Sign test_mode). */
  test_mode?: boolean
  /** Idempotency key: stored on the envelope (metadata / custom field / external id). */
  client_reference: string
  /** Provider-specific request fields merged into the request (the "Advanced" section). */
  advanced?: Record<string, unknown>
}

export interface SendDocumentsInput extends SendCommon {
  documents: EsignDocument[]
  /** The documents carry the provider's text tags. */
  use_text_tags?: boolean
}

export interface SendTemplateInput extends SendCommon {
  template_id: string
  /** Prefilled template fields: field / tab / merge-field name → value. */
  prefill?: Record<string, string>
}

export interface EsignRecipient {
  id: string
  name: string
  email: string
  role: string | null
  routing_order: number | null
  kind: 'signer' | 'cc' | 'approver'
  status: RecipientStatus
  provider_status: string | null
  signed_at: string | null
  declined_reason: string | null
}

export interface EsignEnvelope {
  provider: EsignProviderId
  envelope_id: string
  status: EnvelopeStatus
  /** The provider's own status text. */
  provider_status: string
  subject: string | null
  created_at: string | null
  sent_at: string | null
  completed_at: string | null
  declined_at: string | null
  voided_at: string | null
  expires_at: string | null
  void_reason: string | null
  recipients: EsignRecipient[]
  /** True once the status can no longer change. */
  terminal: boolean
  client_reference: string | null
}

export interface EsignTemplate {
  id: string
  name: string
  description: string | null
  roles: string[]
  updated_at: string | null
}

export interface TemplatePage {
  templates: EsignTemplate[]
  /** Pass back as `cursor` for the next page; null on the last page. */
  next_cursor: string | null
}

export interface DownloadedFile {
  bytes: Uint8Array
  name: string
  mime_type: string
}

export interface SigningLink {
  url: string
  expires_at: string | null
  recipient_email: string
}

/** A provider event after verification, normalized. */
export interface EsignWebhookEvent {
  type: EsignEventType
  envelope_id: string
  /** Stable id of this delivery (replays have the same one). */
  dedupe_key: string
  provider_event: string
  occurred_at: string | null
  recipient?: { email?: string; name?: string; id?: string } | null
}

export type EsignErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'validation'
  | 'unsupported'
  | 'provider_unavailable'
  | 'provider_error'
  | 'configuration'

/** A provider call failed: a clear message (never credentials), the HTTP status and whether a retry may help. */
export class EsignError extends Error {
  readonly code: EsignErrorCode
  readonly status: number | null
  readonly providerCode: string | null
  readonly retryable: boolean
  constructor(code: EsignErrorCode, message: string, opts: { status?: number | null; providerCode?: string | null; retryable?: boolean } = {}) {
    super(message)
    this.name = 'EsignError'
    this.code = code
    this.status = opts.status ?? null
    this.providerCode = opts.providerCode ?? null
    this.retryable = opts.retryable ?? (code === 'rate_limited' || code === 'provider_unavailable')
  }
}

/** HTTP status → error code. */
export function esignErrorCodeFor(status: number): EsignErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'provider_unavailable'
  if (status >= 400) return 'validation'
  return 'provider_error'
}
