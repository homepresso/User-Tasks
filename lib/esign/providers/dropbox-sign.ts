/**
 * Dropbox Sign (formerly HelloSign) API v3 — https://api.hellosign.com/v3.
 *
 * Auth: the API key as HTTP Basic user name, or an OAuth access token.
 * Requests are multipart (files[n], signers[n][…]); test_mode=1 sends a
 * non-binding sandbox request. The client reference is stored as
 * metadata[usertasks_client_reference]. Embedded signing needs an API app
 * client_id (create_embedded + /embedded/sign_url, opened with
 * hellosign-embedded). Callbacks: multipart / form `json`, authenticated by
 * event.event_hash = HMAC-SHA256(API key, event_time + event_type); the
 * response must contain "Hello API Event Received".
 */

import type { EnvelopeStatus, EsignEventType, RecipientStatus } from '../catalog'
import { TERMINAL_STATUSES } from '../catalog'
import { EsignClient, isoOrNull, plainObject, type EsignContext } from '../client'
import { assertFresh, event, hmac, requireSecret, safeEqual, WebhookAuthError, type EsignAdapter, type WebhookRequest } from '../adapter'
import { EsignError, type EsignEnvelope, type EsignRecipient, type SendCommon } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any -- Dropbox Sign JSON */

export const DROPBOX_SIGN_ACK = 'Hello API Event Received'
const REF_KEY = 'usertasks_client_reference'

const SIGNATURE_STATUS: Record<string, RecipientStatus> = {
  awaiting_signature: 'sent', signed: 'signed', declined: 'declined', on_hold: 'waiting', error_unknown: 'unknown',
  error_file: 'unknown', error_component_position: 'unknown', error_text_tag: 'unknown',
}

function errorMessage(data: any): string | null {
  if (data && typeof data === 'object' && data.error) return data.error.error_msg ?? data.error.error_name ?? null
  return null
}

function testMode(ctx: EsignContext, input: SendCommon): boolean {
  if (input.test_mode !== undefined) return Boolean(input.test_mode)
  return String(ctx.settings.test_mode ?? 'true') !== 'false'
}

/** Flatten an "Advanced" object into multipart fields (a[b][c]=v). */
function appendAdvanced(form: FormData, value: unknown, prefix = '') {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) value.forEach((v, i) => appendAdvanced(form, v, `${prefix}[${i}]`))
  else if (typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, unknown>)) appendAdvanced(form, v, prefix ? `${prefix}[${k}]` : k)
  else form.set(prefix, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
}

function commonForm(ctx: EsignContext, input: SendCommon): FormData {
  const form = new FormData()
  form.set('title', input.subject.slice(0, 255))
  form.set('subject', input.subject.slice(0, 255))
  if (input.message) form.set('message', input.message.slice(0, 5000))
  if (testMode(ctx, input)) form.set('test_mode', '1')
  form.set(`metadata[${REF_KEY}]`, input.client_reference)
  if (input.expires_in_days && input.expires_in_days > 0) form.set('expires_at', String(Math.floor(Date.now() / 1000) + Math.round(input.expires_in_days * 86400)))
  if (input.embedded) {
    const clientId = String(ctx.settings.client_id ?? '').trim()
    if (!clientId) throw new EsignError('configuration', 'Embedded signing with Dropbox Sign needs the API app client ID in the connector settings', { retryable: false })
    form.set('client_id', clientId)
  }
  return form
}

function latest(values: Array<string | null>): string | null {
  const ms = Math.max(0, ...values.map((v) => (v ? Date.parse(v) : 0)).filter(Number.isFinite))
  return ms > 0 ? new Date(ms).toISOString() : null
}

export function mapDropboxSignRequest(r: any): EsignEnvelope {
  const sigs: any[] = Array.isArray(r?.signatures) ? r.signatures : []
  const recipients: EsignRecipient[] = sigs.map((s) => ({
    id: String(s.signature_id ?? ''),
    name: String(s.signer_name ?? ''),
    email: String(s.signer_email_address ?? ''),
    role: s.signer_role ? String(s.signer_role) : null,
    routing_order: s.order != null ? Number(s.order) + 1 : null,
    kind: 'signer',
    status: SIGNATURE_STATUS[String(s.status_code ?? '')] ?? 'unknown',
    provider_status: s.status_code ? String(s.status_code) : null,
    signed_at: isoOrNull(s.signed_at),
    declined_reason: s.decline_reason ? String(s.decline_reason) : null,
  }))
  for (const cc of r?.cc_email_addresses ?? []) recipients.push({ id: '', name: '', email: String(cc), role: 'CC', routing_order: null, kind: 'cc', status: 'unknown', provider_status: null, signed_at: null, declined_reason: null })
  let status: EnvelopeStatus = 'sent'
  let providerStatus = 'awaiting_signature'
  if (r?.is_complete) { status = 'completed'; providerStatus = 'complete' }
  else if (r?.is_declined || recipients.some((x) => x.status === 'declined')) { status = 'declined'; providerStatus = 'declined' }
  else if (r?.has_error) { status = 'error'; providerStatus = 'error' }
  else if (r?.expires_at && Number(r.expires_at) * 1000 < Date.now()) { status = 'expired'; providerStatus = 'expired' }
  else if (recipients.some((x) => x.status === 'signed')) status = 'delivered'
  return {
    provider: 'dropbox_sign',
    envelope_id: String(r?.signature_request_id ?? ''),
    status,
    provider_status: providerStatus,
    subject: r?.subject ? String(r.subject) : r?.title ? String(r.title) : null,
    created_at: isoOrNull(r?.created_at),
    sent_at: isoOrNull(r?.created_at),
    completed_at: status === 'completed' ? latest(recipients.map((x) => x.signed_at)) : null,
    declined_at: null,
    voided_at: null,
    expires_at: isoOrNull(r?.expires_at),
    void_reason: null,
    recipients,
    terminal: TERMINAL_STATUSES.has(status),
    client_reference: r?.metadata?.[REF_KEY] ? String(r.metadata[REF_KEY]) : null,
  }
}

/** The `json` field of a callback (multipart, urlencoded or a JSON body). */
export function dropboxSignCallbackJson(req: WebhookRequest): any {
  const ct = req.headers.get('content-type') ?? ''
  const text = req.rawBody.toString('utf8')
  let raw: string | null = null
  if (/multipart\/form-data/i.test(ct)) {
    const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1]
    if (boundary) {
      for (const part of text.split(`--${boundary}`)) {
        const m = /content-disposition:[^\r\n]*name="json"[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*)$/i.exec(part.replace(/^\r?\n/, ''))
        if (m) { raw = m[1].replace(/\r?\n$/, ''); break }
      }
    }
  } else if (/x-www-form-urlencoded/i.test(ct)) {
    raw = new URLSearchParams(text).get('json')
  } else raw = text
  if (!raw) throw new WebhookAuthError('The callback has no json field', 400)
  try { return JSON.parse(raw) } catch { throw new WebhookAuthError('The callback json field is not JSON', 400) }
}

const DROPBOX_SIGN_EVENTS: Record<string, EsignEventType | null> = {
  signature_request_sent: 'envelope_sent',
  signature_request_viewed: 'recipient_viewed',
  signature_request_signed: 'recipient_signed',
  // all_signed comes before the signed files are ready; downloadable means done.
  signature_request_all_signed: null,
  signature_request_downloadable: 'envelope_completed',
  signature_request_declined: 'envelope_declined',
  signature_request_canceled: 'envelope_voided',
  signature_request_expired: 'envelope_expired',
}

export const dropboxSignAdapter: EsignAdapter = {
  id: 'dropbox_sign',

  async client(ctx) {
    const base = String(ctx.settings.api_base_url || 'https://api.hellosign.com/v3').replace(/\/+$/, '')
    return new EsignClient(ctx, base, { label: 'Dropbox Sign', errorMessage })
  },

  async sendDocuments(ctx, input) {
    const c = await this.client(ctx)
    const form = commonForm(ctx, input)
    input.documents.forEach((d, i) => form.set(`files[${i}]`, new Blob([Buffer.from(d.bytes)], { type: d.mime_type }), d.name))
    const signers = input.recipients.filter((r) => r.kind !== 'cc')
    signers.forEach((r, i) => {
      form.set(`signers[${i}][name]`, r.name)
      form.set(`signers[${i}][email_address]`, r.email)
      if (r.routing_order) form.set(`signers[${i}][order]`, String(Math.max(0, r.routing_order - 1)))
    })
    input.recipients.filter((r) => r.kind === 'cc').forEach((r, i) => form.set(`cc_email_addresses[${i}]`, r.email))
    if (input.use_text_tags !== false) { form.set('use_text_tags', '1'); form.set('hide_text_tags', '1') }
    appendAdvanced(form, input.advanced)
    const path = input.embedded ? 'signature_request/create_embedded' : 'signature_request/send'
    const data = await c.json({ method: 'POST', path, form })
    if (!data?.signature_request?.signature_request_id) throw new EsignError('provider_error', 'Dropbox Sign did not return a signature request id')
    return mapDropboxSignRequest(data.signature_request)
  },

  async sendTemplate(ctx, input) {
    const c = await this.client(ctx)
    const form = commonForm(ctx, input)
    form.set('template_ids[0]', input.template_id)
    input.recipients.forEach((r, i) => {
      const role = r.role || (r.kind === 'cc' ? 'CC' : `Signer ${i + 1}`)
      if (r.kind === 'cc') form.set(`ccs[${role}][email_address]`, r.email)
      else {
        form.set(`signers[${role}][name]`, r.name)
        form.set(`signers[${role}][email_address]`, r.email)
      }
    })
    const fields = Object.entries(input.prefill ?? {}).map(([name, value]) => ({ name, value: String(value) }))
    if (fields.length) form.set('custom_fields', JSON.stringify(fields))
    appendAdvanced(form, input.advanced)
    const path = input.embedded ? 'signature_request/create_embedded_with_template' : 'signature_request/send_with_template'
    const data = await c.json({ method: 'POST', path, form })
    if (!data?.signature_request?.signature_request_id) throw new EsignError('provider_error', 'Dropbox Sign did not return a signature request id')
    return mapDropboxSignRequest(data.signature_request)
  },

  async getEnvelope(ctx, id) {
    const c = await this.client(ctx)
    const res = await c.request({ path: `signature_request/${encodeURIComponent(id)}`, allowStatus: [410] })
    if (res.status === 410) {
      // Cancelled requests are gone.
      return { ...mapDropboxSignRequest({ signature_request_id: id }), status: 'voided', provider_status: 'canceled', terminal: true }
    }
    return mapDropboxSignRequest(res.data?.signature_request)
  },

  async download(ctx, id, kind) {
    if (kind === 'certificate') throw new EsignError('unsupported', 'Dropbox Sign appends the audit trail to the signed PDF — download the combined document', { retryable: false })
    const c = await this.client(ctx)
    const res = await c.request({ path: `signature_request/files/${encodeURIComponent(id)}`, query: { file_type: 'pdf' }, binary: true })
    return { bytes: res.bytes!, name: 'signed.pdf', mime_type: 'application/pdf' }
  },

  async cancel(ctx, id) {
    const c = await this.client(ctx)
    await c.request({ method: 'POST', path: `signature_request/cancel/${encodeURIComponent(id)}` })
  },

  async signingUrl(ctx, id, input) {
    const c = await this.client(ctx)
    const req = await c.json({ path: `signature_request/${encodeURIComponent(id)}` })
    const sig = (req?.signature_request?.signatures ?? []).find((s: any) => String(s.signer_email_address ?? '').toLowerCase() === input.email.toLowerCase())
    if (!sig) throw new EsignError('not_found', `${input.email} is not a signer of this request`, { retryable: false })
    const data = await c.json({ path: `embedded/sign_url/${encodeURIComponent(String(sig.signature_id))}` })
    if (!data?.embedded?.sign_url) throw new EsignError('provider_error', 'Dropbox Sign did not return a sign URL')
    return { url: String(data.embedded.sign_url), expires_at: isoOrNull(data.embedded.expires_at), recipient_email: String(sig.signer_email_address) }
  },

  async listTemplates(ctx, input) {
    const c = await this.client(ctx)
    const page = Math.max(1, Number(input.cursor) || 1)
    const data = await c.json({ path: 'template/list', query: { page, page_size: Math.min(Math.max(Number(input.page_size) || 20, 1), 100), query: input.search } })
    const list: any[] = Array.isArray(data?.templates) ? data.templates : []
    const pages = Number(data?.list_info?.num_pages ?? page)
    return {
      templates: list.map((t) => ({
        id: String(t.template_id),
        name: String(t.title ?? t.template_id),
        description: t.message ? String(t.message) : null,
        roles: (t.signer_roles ?? []).map((r: any) => String(r.name ?? '')).filter(Boolean),
        updated_at: isoOrNull(t.updated_at),
      })),
      next_cursor: page < pages ? String(page + 1) : null,
    }
  },

  async whoami(ctx) {
    const c = await this.client(ctx)
    const data = await c.json({ path: 'account' })
    return `Dropbox Sign account ${plainObject(data?.account).email_address ?? ''}`.trim()
  },

  verifyWebhook({ req, secrets, now }) {
    const key = requireSecret(secrets.webhook_secret || secrets.api_key, 'The Dropbox Sign API key')
    const body = dropboxSignCallbackJson(req)
    const ev = body?.event ?? {}
    const time = String(ev.event_time ?? '')
    const type = String(ev.event_type ?? '')
    if (!time || !type || !ev.event_hash) throw new WebhookAuthError('The callback has no event hash')
    if (!safeEqual(String(ev.event_hash), hmac(key, time + type, 'hex'))) throw new WebhookAuthError('Dropbox Sign event hash mismatch')
    const occurred = isoOrNull(time)
    assertFresh(occurred, now)
    const ack = { status: 200, body: DROPBOX_SIGN_ACK, headers: { 'Content-Type': 'text/plain' } }
    const requestId = body?.signature_request?.signature_request_id
    const relatedSig = ev.event_metadata?.related_signature_id ?? ''
    const signer = relatedSig ? (body?.signature_request?.signatures ?? []).find((s: any) => s.signature_id === relatedSig) : null
    const e = event(DROPBOX_SIGN_EVENTS[type] ?? null, requestId, ['dropbox_sign', ev.event_hash, requestId, relatedSig], type, occurred,
      signer ? { email: String(signer.signer_email_address ?? ''), name: String(signer.signer_name ?? ''), id: String(relatedSig) } : null)
    return { events: e ? [e] : [], response: ack }
  },
}
