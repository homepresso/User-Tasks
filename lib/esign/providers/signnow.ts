/**
 * SignNow REST API — https://api.signnow.com (sandbox: https://api-eval.signnow.com).
 *
 * Auth: OAuth 2.0 bearer tokens (authorization code + refresh, or the
 * password grant for a service user; the client authenticates with HTTP
 * Basic). One file per document (several PDFs are merged first); with text
 * tags on, the file goes through /document/fieldextract so tags such as
 * {{t:s;r:y;o:"Signer 1";}} become fields with roles, and recipients are
 * invited per role (field invite). Without roles a single signer gets a
 * free-form invite. Embedded signing uses v2 embedded invites + links.
 * Event subscriptions: X-SignNow-Signature = HMAC-SHA256(secret key, raw body).
 */

import type { EnvelopeStatus, EsignEventType, RecipientStatus } from '../catalog'
import { TERMINAL_STATUSES } from '../catalog'
import { EsignClient, isoOrNull, mergeAdvanced, type EsignContext } from '../client'
import { assertFresh, event, hmac, parseJsonBody, requireSecret, safeEqual, WebhookAuthError, type EsignAdapter } from '../adapter'
import { EsignError, type EsignEnvelope, type EsignRecipient, type SendCommon } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any -- SignNow JSON */

const INVITE_STATUS: Record<string, RecipientStatus> = {
  created: 'created', pending: 'sent', fulfilled: 'signed', signed: 'signed', declined: 'declined', canceled: 'voided', cancelled: 'voided',
  expired: 'voided', skipped: 'waiting', waiting: 'waiting',
}

function errorMessage(data: any): string | null {
  if (!data || typeof data !== 'object') return null
  return data.errors?.[0]?.message ?? data.error ?? data.message ?? null
}

export function signnowBase(ctx: EsignContext): string {
  const explicit = String(ctx.settings.api_base_url ?? '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  return String(ctx.settings.environment ?? 'production') === 'sandbox' ? 'https://api-eval.signnow.com' : 'https://api.signnow.com'
}

async function senderEmail(ctx: EsignContext, c: EsignClient): Promise<string> {
  const configured = String(ctx.settings.sender_email ?? '').trim()
  if (configured) return configured
  const me = await c.json({ path: 'user' })
  const email = me?.primary_email ?? me?.emails?.[0]
  if (!email) throw new EsignError('configuration', 'Set the SignNow sender email in the connector settings', { retryable: false })
  return String(email)
}

/** Invite the recipients to sign document `id` (field invite per role, free-form, or embedded). */
async function invite(ctx: EsignContext, c: EsignClient, id: string, input: SendCommon) {
  const doc = await c.json({ path: `document/${encodeURIComponent(id)}` })
  const roles: any[] = Array.isArray(doc?.roles) ? [...doc.roles].sort((a, b) => Number(a.signing_order ?? 0) - Number(b.signing_order ?? 0)) : []
  const signers = input.recipients.filter((r) => r.kind !== 'cc')
  const ccs = input.recipients.filter((r) => r.kind === 'cc').map((r) => r.email)
  if (!roles.length) {
    if (signers.length !== 1) throw new EsignError('validation', 'This SignNow document has no signer roles: add SignNow text tags (e.g. {{t:s;r:y;o:"Signer 1";}}) for several signers, or send to one signer', { retryable: false })
    if (input.embedded) throw new EsignError('unsupported', 'SignNow embedded signing needs signer roles in the document (text tags or template roles)', { retryable: false })
    const from = await senderEmail(ctx, c)
    await c.json({ method: 'POST', path: `document/${encodeURIComponent(id)}/invite`, json: mergeAdvanced({ to: signers[0].email, from, subject: input.subject, message: input.message ?? input.subject, ...(ccs.length ? { cc: ccs } : {}) }, input.advanced) })
    return
  }
  const used = new Set<string>()
  const assignments = signers.map((r, i) => {
    const byName = r.role ? roles.find((x) => String(x.name).toLowerCase() === r.role!.toLowerCase() && !used.has(x.unique_id)) : null
    const role = byName ?? roles.filter((x) => !used.has(x.unique_id))[0] ?? null
    if (!role) throw new EsignError('validation', `The SignNow document has ${roles.length} signer role(s) but ${signers.length} signers were given`, { retryable: false })
    used.add(role.unique_id)
    return { r, role, order: r.routing_order ?? Number(role.signing_order ?? i + 1) }
  })
  if (input.embedded) {
    await c.json({
      method: 'POST',
      path: `v2/documents/${encodeURIComponent(id)}/embedded-invites`,
      json: mergeAdvanced({ invites: assignments.map(({ r, role, order }) => ({ email: r.email, role_id: role.unique_id, order, auth_method: 'none', first_name: r.name.split(' ')[0] ?? '', last_name: r.name.split(' ').slice(1).join(' ') })) }, input.advanced),
    })
    return
  }
  const from = await senderEmail(ctx, c)
  await c.json({
    method: 'POST',
    path: `document/${encodeURIComponent(id)}/invite`,
    json: mergeAdvanced({
      to: assignments.map(({ r, role, order }) => ({
        email: r.email,
        role_id: role.unique_id,
        role: role.name,
        order,
        subject: input.subject,
        message: input.message ?? input.subject,
        ...(input.reminder_days && input.reminder_days > 0 ? { reminder: Math.round(input.reminder_days) } : {}),
        ...(input.expires_in_days && input.expires_in_days > 0 ? { expiration_days: Math.round(input.expires_in_days) } : {}),
      })),
      from,
      ...(ccs.length ? { cc: ccs } : {}),
      subject: input.subject,
      message: input.message ?? input.subject,
    }, input.advanced),
  })
}

export function mapSignNowDocument(d: any): EsignEnvelope {
  const invites: any[] = Array.isArray(d?.field_invites) ? d.field_invites : []
  const requests: any[] = Array.isArray(d?.requests) ? d.requests : []
  const recipients: EsignRecipient[] = invites.map((f) => {
    const ps = String(f.status ?? '').toLowerCase()
    return {
      id: String(f.id ?? ''),
      name: String(f.signer_name ?? ''),
      email: String(f.email ?? ''),
      role: f.role ? String(f.role) : null,
      routing_order: f.order != null ? Number(f.order) : null,
      kind: 'signer',
      status: INVITE_STATUS[ps] ?? 'unknown',
      provider_status: ps || null,
      signed_at: ps === 'fulfilled' ? isoOrNull(f.updated) : null,
      declined_reason: Array.isArray(f.declined) && f.declined[0]?.declined_text ? String(f.declined[0].declined_text) : null,
    }
  })
  for (const r of requests) {
    recipients.push({
      id: String(r.id ?? ''), name: '', email: String(r.signer_email ?? ''), role: null, routing_order: 1, kind: 'signer',
      status: r.canceled ? 'voided' : r.signature_id || r.fulfilled ? 'signed' : 'sent', provider_status: r.canceled ? 'canceled' : r.signature_id || r.fulfilled ? 'fulfilled' : 'pending',
      signed_at: null, declined_reason: null,
    })
  }
  let status: EnvelopeStatus = 'draft'
  if (recipients.length) {
    if (recipients.some((r) => r.status === 'declined')) status = 'declined'
    else if (recipients.every((r) => r.status === 'voided')) status = invites.some((f) => String(f.status) === 'expired') ? 'expired' : 'voided'
    else if (recipients.every((r) => r.status === 'signed' || r.status === 'voided')) status = 'completed'
    else if (recipients.some((r) => r.status === 'signed')) status = 'delivered'
    else status = 'sent'
  }
  return {
    provider: 'signnow',
    envelope_id: String(d?.id ?? ''),
    status,
    provider_status: status,
    subject: d?.document_name ? String(d.document_name) : null,
    created_at: isoOrNull(d?.created),
    sent_at: isoOrNull(invites[0]?.created ?? requests[0]?.created),
    completed_at: status === 'completed' ? isoOrNull(d?.updated) : null,
    declined_at: null,
    voided_at: null,
    expires_at: null,
    void_reason: null,
    recipients,
    terminal: TERMINAL_STATUSES.has(status),
    client_reference: null,
  }
}

function sentEnvelope(id: string, input: SendCommon): EsignEnvelope {
  return {
    provider: 'signnow', envelope_id: id, status: 'sent', provider_status: 'pending', subject: input.subject,
    created_at: new Date().toISOString(), sent_at: new Date().toISOString(), completed_at: null, declined_at: null, voided_at: null, expires_at: null, void_reason: null,
    recipients: input.recipients.map((r, i) => ({ id: String(i + 1), name: r.name, email: r.email, role: r.role ?? null, routing_order: r.routing_order ?? i + 1, kind: r.kind === 'cc' ? 'cc' : 'signer', status: 'sent', provider_status: 'pending', signed_at: null, declined_reason: null })),
    terminal: false,
    client_reference: input.client_reference,
  }
}

const SIGNNOW_EVENTS: Record<string, EsignEventType> = {
  'document.complete': 'envelope_completed',
  'user.document.complete': 'envelope_completed',
  'document.freeform.signed': 'envelope_completed',
  'document.fieldinvite.signed': 'recipient_signed',
  'user.document.fieldinvite.signed': 'recipient_signed',
  'document.fieldinvite.decline': 'envelope_declined',
  'user.document.fieldinvite.decline': 'envelope_declined',
  'document.fieldinvite.sent': 'envelope_sent',
  'user.document.fieldinvite.sent': 'envelope_sent',
  'document.open': 'recipient_viewed',
  'user.document.open': 'recipient_viewed',
}

export const signnowAdapter: EsignAdapter = {
  id: 'signnow',

  async client(ctx) {
    return new EsignClient(ctx, signnowBase(ctx), { label: 'SignNow', errorMessage })
  },

  async sendDocuments(ctx, input) {
    if (input.documents.length !== 1) throw new EsignError('validation', 'SignNow takes one file per document (PDFs are merged first; other formats must be sent one at a time)', { retryable: false })
    const c = await this.client(ctx)
    const doc = input.documents[0]
    const form = new FormData()
    form.set('file', new Blob([Buffer.from(doc.bytes)], { type: doc.mime_type }), doc.name)
    const uploaded = await c.json({ method: 'POST', path: input.use_text_tags === false ? 'document' : 'document/fieldextract', form })
    if (!uploaded?.id) throw new EsignError('provider_error', 'SignNow did not return a document id')
    await invite(ctx, c, String(uploaded.id), input)
    return sentEnvelope(String(uploaded.id), input)
  },

  async sendTemplate(ctx, input) {
    const c = await this.client(ctx)
    const copy = await c.json({ method: 'POST', path: `template/${encodeURIComponent(input.template_id)}/copy`, json: { document_name: input.subject } })
    const id = String(copy?.id ?? '')
    if (!id) throw new EsignError('provider_error', 'SignNow did not create a document from the template')
    const fields = Object.entries(input.prefill ?? {}).map(([field_name, value]) => ({ field_name, prefilled_text: String(value) }))
    if (fields.length) await c.request({ method: 'PUT', path: `document/${encodeURIComponent(id)}/prefill-texts`, json: { fields } })
    await invite(ctx, c, id, input)
    return sentEnvelope(id, input)
  },

  async getEnvelope(ctx, id) {
    const c = await this.client(ctx)
    return mapSignNowDocument(await c.json({ path: `document/${encodeURIComponent(id)}` }))
  },

  async download(ctx, id, kind) {
    const c = await this.client(ctx)
    const res = await c.request({ path: `document/${encodeURIComponent(id)}/download`, query: { type: 'collapsed', ...(kind === 'certificate' ? { with_history: 1 } : {}) }, binary: true })
    return { bytes: res.bytes!, name: kind === 'certificate' ? 'signed-with-history.pdf' : 'signed.pdf', mime_type: 'application/pdf' }
  },

  async cancel(ctx, id, reason) {
    const c = await this.client(ctx)
    const doc = await c.json({ path: `document/${encodeURIComponent(id)}` })
    if ((doc?.field_invites ?? []).length) {
      await c.request({ method: 'PUT', path: `document/${encodeURIComponent(id)}/fieldinvitecancel`, json: { reason: reason.slice(0, 500) } })
      return
    }
    const open = (doc?.requests ?? []).filter((r: any) => !r.canceled && !r.signature_id)
    if (!open.length) throw new EsignError('conflict', 'This SignNow document has no open invite to cancel', { retryable: false })
    for (const r of open) await c.request({ method: 'PUT', path: `invite/${encodeURIComponent(String(r.id))}/cancel` })
  },

  async signingUrl(ctx, id, input) {
    const c = await this.client(ctx)
    const doc = await c.json({ path: `document/${encodeURIComponent(id)}` })
    const inv = (doc?.field_invites ?? []).find((f: any) => String(f.email ?? '').toLowerCase() === input.email.toLowerCase())
    if (!inv) throw new EsignError('not_found', `${input.email} has no invite on this document`, { retryable: false })
    const data = await c.json({ method: 'POST', path: `v2/documents/${encodeURIComponent(id)}/embedded-invites/${encodeURIComponent(String(inv.id))}/link`, json: { auth_method: 'none', link_expiration: 45 } })
    const link = data?.data?.link
    if (!link) throw new EsignError('unsupported', `${input.email} was not invited for embedded signing — send with "Embedded signing" on`, { retryable: false })
    return { url: String(link), expires_at: new Date(Date.now() + 45 * 60_000).toISOString(), recipient_email: input.email }
  },

  async listTemplates(ctx, input) {
    const c = await this.client(ctx)
    const data = await c.json({ path: 'user/documentsv2' })
    const q = String(input.search ?? '').trim().toLowerCase()
    const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []
    return {
      templates: list
        .filter((d) => d.template === true || d.template === 1 || d.is_template === true)
        .filter((d) => !q || String(d.document_name ?? '').toLowerCase().includes(q))
        .slice(0, Math.min(Math.max(Number(input.page_size) || 50, 1), 200))
        .map((d) => ({ id: String(d.id), name: String(d.document_name ?? d.id), description: null, roles: (d.roles ?? []).map((r: any) => String(r.name ?? '')).filter(Boolean), updated_at: isoOrNull(d.updated) })),
      next_cursor: null,
    }
  },

  async whoami(ctx) {
    const c = await this.client(ctx)
    const me = await c.json({ path: 'user' })
    return `SignNow user ${me?.primary_email ?? me?.emails?.[0] ?? ''}`.trim()
  },

  verifyWebhook({ req, secrets, now }) {
    const key = requireSecret(secrets.webhook_secret, 'The SignNow event subscription secret key')
    const provided = (req.headers.get('x-signnow-signature') ?? '').trim()
    if (!provided) throw new WebhookAuthError('Missing X-SignNow-Signature')
    if (!safeEqual(provided, hmac(key, req.rawBody, 'base64')) && !safeEqual(provided, hmac(key, req.rawBody, 'hex'))) throw new WebhookAuthError('SignNow signature mismatch')
    const body = parseJsonBody(req.rawBody)
    const meta = body?.meta ?? {}
    const content = body?.content ?? {}
    const name = String(meta.event ?? '')
    const occurred = isoOrNull(meta.timestamp)
    assertFresh(occurred, now)
    const ev = event(SIGNNOW_EVENTS[name] ?? null, content.document_id, ['signnow', meta.timestamp, name, content.document_id, content.invite_id ?? '', content.signer ?? ''], name, occurred,
      content.signer || content.email ? { email: String(content.signer ?? content.email) } : null)
    return { events: ev ? [ev] : [] }
  },
}
