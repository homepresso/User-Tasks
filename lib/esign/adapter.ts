/**
 * The provider adapter contract (lib/esign/providers/*) plus the webhook
 * verification helpers they share. Adapters map the shared model
 * (lib/esign/types) onto each provider's REST API and back.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { EsignClient, EsignContext } from './client'
import type { EsignEventType, EsignProviderId } from './catalog'
import type {
  DownloadedFile, EsignEnvelope, EsignWebhookEvent, SendDocumentsInput, SendTemplateInput, SigningLink, TemplatePage,
} from './types'

export interface WebhookRequest {
  method: string
  headers: Headers
  rawBody: Buffer
  url: URL
}

export interface WebhookSecrets {
  /** The shared secret configured in the connector (HMAC key / URL token). */
  webhook_secret?: string
  /** API key (Dropbox Sign signs event hashes with it). */
  api_key?: string
  /** OAuth client id (Adobe Acrobat Sign echoes it). */
  client_id?: string
}

export interface WebhookVerifyInput {
  req: WebhookRequest
  secrets: WebhookSecrets
  now: number
}

export interface WebhookResult {
  events: EsignWebhookEvent[]
  /** The response the provider expects (handshakes, acknowledgement bodies). */
  response?: { status: number; body?: string; json?: unknown; headers?: Record<string, string> }
}

/** The delivery is not authentic (bad / missing signature, stale timestamp). */
export class WebhookAuthError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message)
    this.name = 'WebhookAuthError'
  }
}

/** Deliveries older than this are refused (providers retry for at most a few days). */
export const WEBHOOK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface ListTemplatesInput { search?: string; page_size?: number; cursor?: string | null }
export interface SigningUrlInput { email: string; name?: string; return_url?: string }

export interface EsignAdapter {
  id: EsignProviderId
  client(ctx: EsignContext): Promise<EsignClient>
  sendDocuments(ctx: EsignContext, input: SendDocumentsInput): Promise<EsignEnvelope>
  sendTemplate(ctx: EsignContext, input: SendTemplateInput): Promise<EsignEnvelope>
  getEnvelope(ctx: EsignContext, envelopeId: string): Promise<EsignEnvelope>
  download(ctx: EsignContext, envelopeId: string, kind: 'combined' | 'certificate'): Promise<DownloadedFile>
  cancel(ctx: EsignContext, envelopeId: string, reason: string): Promise<void>
  signingUrl(ctx: EsignContext, envelopeId: string, input: SigningUrlInput): Promise<SigningLink>
  listTemplates(ctx: EsignContext, input: ListTemplatesInput): Promise<TemplatePage>
  /** A connection test: a short description of the account reached. */
  whoami(ctx: EsignContext): Promise<string>
  verifyWebhook(input: WebhookVerifyInput): WebhookResult
}

/* ── Crypto helpers ────────────────────────────────────────────────── */

export function hmac(key: string, data: string | Buffer, encoding: 'hex' | 'base64'): string {
  return createHmac('sha256', key).update(data).digest(encoding)
}

/** Constant-time string comparison (false for different lengths). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a ?? ''))
  const bb = Buffer.from(String(b ?? ''))
  if (ab.length === 0 || ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function requireSecret(value: string | undefined, label: string): string {
  if (!value) throw new WebhookAuthError(`${label} is not configured on this connector — webhook deliveries cannot be verified`, 401)
  return value
}

export function parseJsonBody(raw: Buffer): any {
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw new WebhookAuthError('The webhook body is not JSON', 400)
  }
}

export function assertFresh(occurredAt: string | null, now: number, maxAgeMs = WEBHOOK_MAX_AGE_MS) {
  if (!occurredAt) return
  const t = Date.parse(occurredAt)
  if (Number.isFinite(t) && now - t > maxAgeMs) throw new WebhookAuthError('The webhook delivery is too old (possible replay)', 400)
}

export function event(type: EsignEventType | null, envelopeId: unknown, dedupeParts: unknown[], providerEvent: string, occurredAt: string | null, recipient?: EsignWebhookEvent['recipient']): EsignWebhookEvent | null {
  if (!type || !envelopeId) return null
  return {
    type,
    envelope_id: String(envelopeId),
    dedupe_key: sha256(JSON.stringify(dedupeParts)),
    provider_event: providerEvent,
    occurred_at: occurredAt,
    recipient: recipient ?? null,
  }
}
