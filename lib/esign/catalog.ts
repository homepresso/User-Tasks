/**
 * E-signature providers, operations, events and node types (client-safe: no
 * server imports). The provider adapters live in lib/esign/providers/*, the
 * shared runtime in lib/esign/service.ts; docs at /docs/integrations/e-signature.
 *
 * Every provider is a connector (lib/connectors/definitions/<key>.ts) whose
 * reference templates run through the e-sign executor, so "Send for
 * signature", "Get status", "Download signed document" … look and behave the
 * same whichever provider a workspace uses.
 */

export type EsignProviderId = 'docusign' | 'adobe_sign' | 'dropbox_sign' | 'pandadoc' | 'signnow' | 'boldsign'

export interface EsignProviderInfo {
  id: EsignProviderId
  /** Connector key (lib/connectors/registry). */
  connectorKey: string
  label: string
  /** What the provider calls an envelope. */
  envelopeNoun: string
  supports: {
    /** A per-recipient signing link UserTasks can show ("Sign now"). */
    embeddedSigning: boolean
    /** Text tags in the document place fields (DocuSign uses anchor strings). */
    textTags: boolean
    /** Anchor strings (search text) place signature / date fields. */
    anchors: boolean
    reminders: boolean
    expiry: boolean
    /** A separate certificate / audit trail PDF. */
    certificate: boolean
    /** Sandbox flag on the request (Dropbox Sign test_mode). */
    testMode: boolean
    /** Several documents in one envelope (otherwise PDFs are merged first). */
    multipleDocuments: boolean
  }
  /** How webhook deliveries are authenticated. */
  webhookAuth: string
}

export const ESIGN_PROVIDERS: readonly EsignProviderInfo[] = [
  {
    id: 'docusign', connectorKey: 'docusign', label: 'DocuSign', envelopeNoun: 'envelope',
    supports: { embeddedSigning: true, textTags: false, anchors: true, reminders: true, expiry: true, certificate: true, testMode: false, multipleDocuments: true },
    webhookAuth: 'Connect HMAC (X-DocuSign-Signature-1)',
  },
  {
    id: 'adobe_sign', connectorKey: 'adobe_sign', label: 'Adobe Acrobat Sign', envelopeNoun: 'agreement',
    supports: { embeddedSigning: true, textTags: true, anchors: false, reminders: true, expiry: true, certificate: true, testMode: false, multipleDocuments: true },
    webhookAuth: 'Client ID echo (X-AdobeSign-ClientId) + webhook URL token',
  },
  {
    id: 'dropbox_sign', connectorKey: 'dropbox_sign', label: 'Dropbox Sign', envelopeNoun: 'signature request',
    supports: { embeddedSigning: true, textTags: true, anchors: false, reminders: false, expiry: true, certificate: false, testMode: true, multipleDocuments: true },
    webhookAuth: 'Event hash (HMAC-SHA256 of event_time + event_type with the API key)',
  },
  {
    id: 'pandadoc', connectorKey: 'pandadoc', label: 'PandaDoc', envelopeNoun: 'document',
    supports: { embeddedSigning: true, textTags: true, anchors: false, reminders: false, expiry: false, certificate: false, testMode: false, multipleDocuments: false },
    webhookAuth: 'HMAC-SHA256 of the body (?signature=)',
  },
  {
    id: 'signnow', connectorKey: 'signnow', label: 'SignNow', envelopeNoun: 'document',
    supports: { embeddedSigning: true, textTags: true, anchors: false, reminders: true, expiry: true, certificate: true, testMode: false, multipleDocuments: false },
    webhookAuth: 'HMAC-SHA256 of the body (X-SignNow-Signature)',
  },
  {
    id: 'boldsign', connectorKey: 'boldsign', label: 'BoldSign', envelopeNoun: 'document',
    supports: { embeddedSigning: true, textTags: true, anchors: false, reminders: true, expiry: true, certificate: true, testMode: false, multipleDocuments: true },
    webhookAuth: 'Timestamped HMAC-SHA256 (X-BoldSign-Signature)',
  },
]

export function esignProviderForConnector(connectorKey: unknown): EsignProviderInfo | null {
  return ESIGN_PROVIDERS.find((p) => p.connectorKey === connectorKey) ?? null
}

export function esignProvider(id: unknown): EsignProviderInfo | null {
  return ESIGN_PROVIDERS.find((p) => p.id === id) ?? null
}

export function isEsignConnector(connectorKey: unknown): boolean {
  return esignProviderForConnector(connectorKey) !== null
}

/** Path prefix of the e-sign reference templates (handled by lib/esign/executor). */
export const ESIGN_INTERNAL_PATH = '/_internal/esign/'

export const ESIGN_OPERATIONS = ['send_documents', 'send_template', 'get_status', 'download_signed', 'cancel_envelope', 'signing_url', 'search_templates'] as const
export type EsignOperation = typeof ESIGN_OPERATIONS[number]

/** Normalized envelope status (provider statuses map onto these). */
export const ENVELOPE_STATUSES = ['draft', 'sent', 'delivered', 'completed', 'declined', 'voided', 'expired', 'error', 'unknown'] as const
export type EnvelopeStatus = typeof ENVELOPE_STATUSES[number]

/** Statuses after which an envelope never changes again. */
export const TERMINAL_STATUSES: ReadonlySet<EnvelopeStatus> = new Set(['completed', 'declined', 'voided', 'expired'])

export const RECIPIENT_STATUSES = ['created', 'sent', 'delivered', 'signed', 'declined', 'voided', 'waiting', 'unknown'] as const
export type RecipientStatus = typeof RECIPIENT_STATUSES[number]

/** Normalized events (webhooks and polling) — what the "E-signature event" trigger listens for. */
export const ESIGN_EVENTS = [
  { value: 'envelope_sent', label: 'Envelope sent' },
  { value: 'recipient_viewed', label: 'Recipient viewed' },
  { value: 'recipient_signed', label: 'Recipient signed' },
  { value: 'envelope_completed', label: 'Envelope completed' },
  { value: 'envelope_declined', label: 'Declined' },
  { value: 'envelope_voided', label: 'Voided / cancelled' },
  { value: 'envelope_expired', label: 'Expired' },
] as const
export type EsignEventType = typeof ESIGN_EVENTS[number]['value']

/** What "Wait for signature" resumes with. */
export const WAIT_OUTCOMES = ['completed', 'declined', 'voided', 'expired', 'timeout'] as const
export type WaitOutcome = typeof WAIT_OUTCOMES[number]

export const ESIGN_NODE_TYPES = ['esign_send', 'esign_envelope', 'esign_wait'] as const
export type EsignNodeType = typeof ESIGN_NODE_TYPES[number]
export const ESIGN_TRIGGER_TYPE = 'esign_event'

export function isEsignNodeType(type: unknown): type is EsignNodeType {
  return typeof type === 'string' && (ESIGN_NODE_TYPES as readonly string[]).includes(type)
}

export const ENVELOPE_ACTIONS = [
  { value: 'status', label: 'Get status' },
  { value: 'download', label: 'Download signed document' },
  { value: 'cancel', label: 'Void / cancel' },
  { value: 'signing_url', label: 'Embedded signing URL' },
  { value: 'list_templates', label: 'List templates' },
] as const

export const DOWNLOAD_KINDS = [
  { value: 'combined', label: 'Signed document (combined PDF)' },
  { value: 'certificate', label: 'Certificate / audit trail' },
  { value: 'both', label: 'Both' },
] as const

/** Default output variable per node type. */
export function esignOutputVar(type: string, config: Record<string, unknown>): string {
  const own = typeof config.output_var === 'string' ? config.output_var.trim() : ''
  if (own) return own
  if (type === 'esign_send') return 'envelope'
  if (type === 'esign_wait') return 'signature'
  return 'esign_result'
}

/** Webhook URL path for an integration (shown in the connector and docs). */
export function esignWebhookPath(provider: EsignProviderId, integrationId: string): string {
  return `/api/webhooks/esign/${provider.replace(/_/g, '-')}/${integrationId}`
}

export function providerFromWebhookSlug(slug: string): EsignProviderId | null {
  const id = String(slug ?? '').replace(/-/g, '_')
  return esignProvider(id)?.id ?? null
}

const OUTCOME_SYNONYMS: Record<string, WaitOutcome> = {
  completed: 'completed', complete: 'completed', signed: 'completed', done: 'completed',
  declined: 'declined', rejected: 'declined', decline: 'declined',
  voided: 'voided', void: 'voided', cancelled: 'voided', canceled: 'voided',
  expired: 'expired',
  timeout: 'timeout', timedout: 'timeout',
}

/** The outcome an edge label names ("Signed", "Declined", "Timed out" …), or null for other labels. */
export function edgeOutcome(label: unknown): WaitOutcome | null {
  const key = String(label ?? '').toLowerCase().trim()
  return OUTCOME_SYNONYMS[key] ?? OUTCOME_SYNONYMS[key.replace(/[^a-z]/g, '')] ?? null
}

/** Whether a Wait for signature edge is followed for an outcome: unlabelled / other labels always, outcome labels when they match. */
export function esignEdgeMatches(label: unknown, outcome: unknown): boolean {
  const named = edgeOutcome(label)
  return named === null || named === outcome
}
