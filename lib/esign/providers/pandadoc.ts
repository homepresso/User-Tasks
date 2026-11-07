/**
 * PandaDoc API — https://api.pandadoc.com/public/v1.
 *
 * Auth: `Authorization: API-Key <key>` or an OAuth access token. A document
 * is created from one file (several PDFs are merged first) or from a
 * template; PandaDoc processes it asynchronously (document.uploaded →
 * document.draft) and it is sent once it is a draft. The client reference is
 * document metadata. PandaDoc field tags in the PDF ({signature:Signer}) are
 * parsed when text tags are on. Embedded signing: a document session
 * (https://app.pandadoc.com/s/<session id>).
 * Webhooks: ?signature= is HMAC-SHA256(shared key, raw body), hex; the body
 * is a JSON array of events.
 */

import type { EnvelopeStatus, EsignEventType } from '../catalog'
import { TERMINAL_STATUSES } from '../catalog'
import { EsignClient, isoOrNull, mergeAdvanced, splitName, type EsignContext } from '../client'
import { event, hmac, parseJsonBody, requireSecret, safeEqual, sha256, WebhookAuthError, type EsignAdapter } from '../adapter'
import { EsignError, type EsignEnvelope, type EsignRecipient, type SendCommon } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any -- PandaDoc JSON */

const REF_KEY = 'usertasks_client_reference'
/** How long to wait for an uploaded document to become a draft before sending. */
const DRAFT_WAIT_MS = 30_000

const DOC_STATUS: Record<string, EnvelopeStatus> = {
  'document.uploaded': 'draft', 'document.draft': 'draft', 'document.sent': 'sent', 'document.viewed': 'delivered',
  'document.waiting_approval': 'sent', 'document.approved': 'sent', 'document.waiting_pay': 'sent', 'document.external_review': 'sent',
  'document.completed': 'completed', 'document.paid': 'completed', 'document.rejected': 'declined', 'document.declined': 'declined',
  'document.voided': 'voided', 'document.expired': 'expired', 'document.error': 'error',
}

function errorMessage(data: any): string | null {
  if (!data || typeof data !== 'object') return null
  if (typeof data.detail === 'string') return data.detail
  if (data.detail && typeof data.detail === 'object') return Object.entries(data.detail).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join('; ')
  return data.type ?? null
}

function recipientsBody(input: SendCommon) {
  return input.recipients.map((r, i) => {
    const { first, last } = splitName(r.name)
    return {
      email: r.email,
      first_name: first,
      last_name: last,
      ...(r.role ? { role: r.role } : {}),
      ...(r.kind === 'cc' ? { type: 'cc' } : { signing_order: r.routing_order ?? i + 1 }),
    }
  })
}

async function waitForDraft(ctx: EsignContext, c: EsignClient, id: string) {
  const sleep = ctx.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const deadline = Date.now() + Math.min(DRAFT_WAIT_MS, ctx.timeoutMs)
  for (let i = 0; ; i++) {
    const doc = await c.json({ path: `documents/${encodeURIComponent(id)}` })
    const status = String(doc?.status ?? '')
    if (status === 'document.draft') return
    if (status === 'document.error') throw new EsignError('provider_error', 'PandaDoc could not process the document')
    if (status !== 'document.uploaded' || Date.now() >= deadline) {
      if (status === 'document.uploaded') throw new EsignError('provider_unavailable', `PandaDoc is still processing document ${id} — retry the step to send it`, { retryable: true })
      return
    }
    await sleep(Math.min(2_000, 500 * (i + 1)))
  }
}

async function send(ctx: EsignContext, c: EsignClient, id: string, input: SendCommon) {
  await waitForDraft(ctx, c, id)
  await c.json({ method: 'POST', path: `documents/${encodeURIComponent(id)}/send`, json: { subject: input.subject, ...(input.message ? { message: input.message } : {}), silent: Boolean(input.embedded) } })
}

export function mapPandaDocDocument(d: any): EsignEnvelope {
  const ps = String(d?.status ?? '')
  const status: EnvelopeStatus = DOC_STATUS[ps] ?? 'unknown'
  const recipients: EsignRecipient[] = (Array.isArray(d?.recipients) ? d.recipients : []).map((r: any) => ({
    id: String(r.id ?? ''),
    name: [r.first_name, r.last_name].filter(Boolean).join(' ') || String(r.email ?? ''),
    email: String(r.email ?? ''),
    role: r.role ? String(r.role) : null,
    routing_order: r.signing_order != null ? Number(r.signing_order) : null,
    kind: r.recipient_type === 'CC' || r.type === 'cc' ? 'cc' : 'signer',
    status: r.has_completed ? 'signed' : status === 'declined' ? 'declined' : status === 'draft' ? 'created' : 'sent',
    provider_status: r.has_completed ? 'completed' : null,
    signed_at: null,
    declined_reason: null,
  }))
  return {
    provider: 'pandadoc',
    envelope_id: String(d?.id ?? ''),
    status,
    provider_status: ps,
    subject: d?.name ? String(d.name) : null,
    created_at: isoOrNull(d?.date_created),
    sent_at: isoOrNull(d?.date_sent),
    completed_at: isoOrNull(d?.date_completed),
    declined_at: null,
    voided_at: null,
    expires_at: isoOrNull(d?.expiration_date),
    void_reason: null,
    recipients,
    terminal: TERMINAL_STATUSES.has(status),
    client_reference: d?.metadata?.[REF_KEY] ? String(d.metadata[REF_KEY]) : null,
  }
}

function sentEnvelope(id: string, input: SendCommon): EsignEnvelope {
  return mapPandaDocDocument({
    id, name: input.subject, status: 'document.sent', metadata: { [REF_KEY]: input.client_reference }, date_created: new Date().toISOString(),
    recipients: recipientsBody(input).map((r: any) => ({ ...r, has_completed: false })),
  })
}

const PANDADOC_STATES: Record<string, EsignEventType> = {
  'document.sent': 'envelope_sent',
  'document.viewed': 'recipient_viewed',
  'document.completed': 'envelope_completed',
  'document.declined': 'envelope_declined',
  'document.rejected': 'envelope_declined',
  'document.voided': 'envelope_voided',
  'document.expired': 'envelope_expired',
}

export const pandadocAdapter: EsignAdapter = {
  id: 'pandadoc',

  async client(ctx) {
    const base = String(ctx.settings.api_base_url || 'https://api.pandadoc.com/public/v1').replace(/\/+$/, '')
    return new EsignClient(ctx, base, { label: 'PandaDoc', errorMessage })
  },

  async sendDocuments(ctx, input) {
    if (input.documents.length !== 1) throw new EsignError('validation', 'PandaDoc takes one file per document (PDFs are merged first; other formats must be sent one at a time)', { retryable: false })
    const c = await this.client(ctx)
    const doc = input.documents[0]
    const form = new FormData()
    form.set('file', new Blob([Buffer.from(doc.bytes)], { type: doc.mime_type }), doc.name)
    form.set('data', JSON.stringify(mergeAdvanced({
      name: input.subject,
      recipients: recipientsBody(input),
      metadata: { [REF_KEY]: input.client_reference },
      parse_form_fields: input.use_text_tags !== false,
    }, input.advanced)))
    const created = await c.json({ method: 'POST', path: 'documents', form })
    if (!created?.id) throw new EsignError('provider_error', 'PandaDoc did not return a document id')
    await send(ctx, c, String(created.id), input)
    return sentEnvelope(String(created.id), input)
  },

  async sendTemplate(ctx, input) {
    const c = await this.client(ctx)
    const tokens = Object.entries(input.prefill ?? {}).map(([name, value]) => ({ name, value: String(value) }))
    const created = await c.json({
      method: 'POST',
      path: 'documents',
      json: mergeAdvanced({
        name: input.subject,
        template_uuid: input.template_id,
        recipients: recipientsBody(input),
        ...(tokens.length ? { tokens } : {}),
        metadata: { [REF_KEY]: input.client_reference },
      }, input.advanced),
    })
    if (!created?.id) throw new EsignError('provider_error', 'PandaDoc did not return a document id')
    await send(ctx, c, String(created.id), input)
    return sentEnvelope(String(created.id), input)
  },

  async getEnvelope(ctx, id) {
    const c = await this.client(ctx)
    return mapPandaDocDocument(await c.json({ path: `documents/${encodeURIComponent(id)}/details` }))
  },

  async download(ctx, id, kind) {
    if (kind === 'certificate') throw new EsignError('unsupported', 'PandaDoc has no separate certificate download — the completed PDF includes the electronic signature certificate page', { retryable: false })
    const c = await this.client(ctx)
    const res = await c.request({ path: `documents/${encodeURIComponent(id)}/download`, binary: true })
    return { bytes: res.bytes!, name: 'signed.pdf', mime_type: 'application/pdf' }
  },

  async cancel(ctx, id, reason) {
    const c = await this.client(ctx)
    // PandaDoc has no "void" endpoint: the status change to Voided (11) stops signing.
    await c.request({ method: 'PATCH', path: `documents/${encodeURIComponent(id)}/status`, json: { status: 11, note: reason.slice(0, 500), notify_recipients: true } })
  },

  async signingUrl(ctx, id, input) {
    const c = await this.client(ctx)
    const session = await c.json({ method: 'POST', path: `documents/${encodeURIComponent(id)}/session`, json: { recipient: input.email, lifetime: 3600 } })
    if (!session?.id) throw new EsignError('provider_error', 'PandaDoc did not return a signing session')
    const app = String(ctx.settings.app_base_url || 'https://app.pandadoc.com').replace(/\/+$/, '')
    return { url: `${app}/s/${encodeURIComponent(String(session.id))}`, expires_at: isoOrNull(session.expires_at), recipient_email: input.email }
  },

  async listTemplates(ctx, input) {
    const c = await this.client(ctx)
    const page = Math.max(1, Number(input.cursor) || 1)
    const count = Math.min(Math.max(Number(input.page_size) || 25, 1), 100)
    const data = await c.json({ path: 'templates', query: { q: input.search, count, page } })
    const list: any[] = Array.isArray(data?.results) ? data.results : []
    return {
      templates: list.map((t) => ({ id: String(t.id), name: String(t.name ?? t.id), description: null, roles: [], updated_at: isoOrNull(t.date_modified) })),
      next_cursor: list.length === count ? String(page + 1) : null,
    }
  },

  async whoami(ctx) {
    const c = await this.client(ctx)
    const me = await c.json({ path: 'members/current' })
    return `PandaDoc member ${me?.email ?? ''}`.trim()
  },

  verifyWebhook({ req, secrets }) {
    const key = requireSecret(secrets.webhook_secret, 'The PandaDoc webhook shared key')
    const signature = req.url.searchParams.get('signature') ?? ''
    if (!signature) throw new WebhookAuthError('Missing ?signature=')
    if (!safeEqual(signature, hmac(key, req.rawBody, 'hex'))) throw new WebhookAuthError('PandaDoc signature mismatch')
    const body = parseJsonBody(req.rawBody)
    const list: any[] = Array.isArray(body) ? body : [body]
    const events = list.flatMap((e) => {
      const name = String(e?.event ?? '')
      const data = e?.data ?? {}
      const type: EsignEventType | null = name === 'document_state_changed' ? PANDADOC_STATES[String(data.status ?? '')] ?? null
        : name === 'recipient_completed' ? 'recipient_signed' : null
      const who = data.action_by ?? null
      const ev = event(type, data.id, ['pandadoc', sha256(JSON.stringify(e))], name, isoOrNull(data.date_modified),
        who?.email ? { email: String(who.email), name: [who.first_name, who.last_name].filter(Boolean).join(' ') } : null)
      return ev ? [ev] : []
    })
    return { events }
  },
}
