/**
 * BoldSign API v1 — https://api.boldsign.com/v1 (EU: https://api-eu.boldsign.com/v1).
 *
 * Auth: X-API-KEY or an OAuth access token. Documents are sent as JSON with
 * the files as base64 data URIs; text tags ({{sign|1|*}}) are honoured with
 * UseTextTags. The client reference is document metadata.
 * Webhooks: X-BoldSign-Signature: t=<unix seconds>, s0=<hex HMAC-SHA256(secret, "t.body")>;
 * deliveries older than five minutes are refused. A "Verification" event is
 * answered with 200 when the webhook is registered.
 */

import type { EnvelopeStatus, EsignEventType, RecipientStatus } from '../catalog'
import { TERMINAL_STATUSES } from '../catalog'
import { EsignClient, isoOrNull, mergeAdvanced, type EsignContext } from '../client'
import { event, hmac, parseJsonBody, requireSecret, safeEqual, WebhookAuthError, type EsignAdapter } from '../adapter'
import { EsignError, type EsignEnvelope, type EsignRecipient, type SendCommon } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any -- BoldSign JSON */

const REF_KEY = 'usertasks_client_reference'
export const BOLDSIGN_TOLERANCE_MS = 5 * 60_000

const DOC_STATUS: Record<string, EnvelopeStatus> = {
  draft: 'draft', inprogress: 'sent', waitingforothers: 'sent', needsattention: 'sent', completed: 'completed',
  declined: 'declined', revoked: 'voided', expired: 'expired', scheduled: 'draft',
}
const SIGNER_STATUS: Record<string, RecipientStatus> = {
  none: 'created', notcompleted: 'sent', completed: 'signed', signed: 'signed', declined: 'declined', revoked: 'voided', expired: 'voided', viewed: 'delivered',
}

function errorMessage(data: any): string | null {
  if (!data || typeof data !== 'object') return null
  if (data.errors && typeof data.errors === 'object') {
    const first = Object.entries(data.errors)[0]
    if (first) return `${first[0]}: ${Array.isArray(first[1]) ? first[1].join(', ') : String(first[1])}`
  }
  return data.error ?? data.message ?? data.title ?? null
}

function base(ctx: EsignContext): string {
  const explicit = String(ctx.settings.api_base_url ?? '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  return String(ctx.settings.region ?? 'us') === 'eu' ? 'https://api-eu.boldsign.com/v1' : 'https://api.boldsign.com/v1'
}

function common(input: SendCommon) {
  const signers = input.recipients.filter((r) => r.kind !== 'cc')
  return {
    Title: input.subject.slice(0, 256),
    ...(input.message ? { Message: input.message.slice(0, 5000) } : {}),
    EnableSigningOrder: signers.some((r) => (r.routing_order ?? 1) > 1),
    ...(input.expires_in_days && input.expires_in_days > 0 ? { ExpiryDays: Math.round(input.expires_in_days) } : {}),
    ...(input.reminder_days && input.reminder_days > 0 ? { ReminderSettings: { EnableAutoReminder: true, ReminderDays: Math.round(input.reminder_days), ReminderCount: 5 } } : {}),
    ...(input.embedded ? { DisableEmails: true } : {}),
    CC: input.recipients.filter((r) => r.kind === 'cc').map((r) => ({ EmailAddress: r.email })),
    MetaData: { [REF_KEY]: input.client_reference },
  }
}

export function mapBoldSignDocument(d: any): EsignEnvelope {
  const ps = String(d?.status ?? '').replace(/\s+/g, '').toLowerCase()
  const status: EnvelopeStatus = DOC_STATUS[ps] ?? 'unknown'
  const recipients: EsignRecipient[] = (Array.isArray(d?.signerDetails) ? d.signerDetails : []).map((s: any, i: number) => {
    const ss = String(s.status ?? '').replace(/\s+/g, '').toLowerCase()
    return {
      id: String(s.id ?? i + 1),
      name: String(s.signerName ?? ''),
      email: String(s.signerEmail ?? ''),
      role: s.signerRole ? String(s.signerRole) : null,
      routing_order: s.order != null ? Number(s.order) : null,
      kind: 'signer',
      status: SIGNER_STATUS[ss] ?? 'unknown',
      provider_status: s.status ? String(s.status) : null,
      signed_at: ss === 'completed' ? isoOrNull(s.lastActivityDate) : null,
      declined_reason: s.declineMessage ? String(s.declineMessage) : null,
    }
  })
  for (const cc of d?.ccDetails ?? []) recipients.push({ id: '', name: '', email: String(cc.emailAddress ?? ''), role: 'CC', routing_order: null, kind: 'cc', status: 'unknown', provider_status: null, signed_at: null, declined_reason: null })
  return {
    provider: 'boldsign',
    envelope_id: String(d?.documentId ?? ''),
    status,
    provider_status: String(d?.status ?? ''),
    subject: d?.messageTitle ? String(d.messageTitle) : null,
    created_at: isoOrNull(d?.createdDate),
    sent_at: isoOrNull(d?.createdDate),
    completed_at: status === 'completed' ? isoOrNull(d?.activityDate ?? d?.completedDate) : null,
    declined_at: null,
    voided_at: null,
    expires_at: isoOrNull(d?.expiryDate),
    void_reason: d?.revokeMessage ? String(d.revokeMessage) : null,
    recipients,
    terminal: TERMINAL_STATUSES.has(status),
    client_reference: d?.metaData?.[REF_KEY] ?? d?.MetaData?.[REF_KEY] ?? null,
  }
}

function sentEnvelope(id: string, input: SendCommon): EsignEnvelope {
  return {
    provider: 'boldsign', envelope_id: id, status: 'sent', provider_status: 'InProgress', subject: input.subject,
    created_at: new Date().toISOString(), sent_at: new Date().toISOString(), completed_at: null, declined_at: null, voided_at: null, expires_at: null, void_reason: null,
    recipients: input.recipients.map((r, i) => ({ id: String(i + 1), name: r.name, email: r.email, role: r.role ?? null, routing_order: r.routing_order ?? i + 1, kind: r.kind === 'cc' ? 'cc' : 'signer', status: 'sent', provider_status: 'NotCompleted', signed_at: null, declined_reason: null })),
    terminal: false,
    client_reference: input.client_reference,
  }
}

const BOLDSIGN_EVENTS: Record<string, EsignEventType> = {
  Sent: 'envelope_sent',
  Viewed: 'recipient_viewed',
  Signed: 'recipient_signed',
  Completed: 'envelope_completed',
  Declined: 'envelope_declined',
  Revoked: 'envelope_voided',
  Expired: 'envelope_expired',
}

export const boldsignAdapter: EsignAdapter = {
  id: 'boldsign',

  async client(ctx) {
    return new EsignClient(ctx, base(ctx), { label: 'BoldSign', errorMessage })
  },

  async sendDocuments(ctx, input) {
    const c = await this.client(ctx)
    const body = mergeAdvanced({
      ...common(input),
      Files: input.documents.map((d) => `data:${d.mime_type};base64,${Buffer.from(d.bytes).toString('base64')}`),
      FileNames: input.documents.map((d) => d.name),
      UseTextTags: input.use_text_tags !== false,
      Signers: input.recipients.filter((r) => r.kind !== 'cc').map((r, i) => ({ Name: r.name, EmailAddress: r.email, SignerOrder: r.routing_order ?? i + 1, SignerType: 'Signer' })),
    }, input.advanced)
    const data = await c.json({ method: 'POST', path: 'document/send', json: body })
    if (!data?.documentId) throw new EsignError('provider_error', 'BoldSign did not return a document id')
    return sentEnvelope(String(data.documentId), input)
  },

  async sendTemplate(ctx, input) {
    const c = await this.client(ctx)
    const prefill = Object.entries(input.prefill ?? {}).map(([Id, Value]) => ({ Id, Value: String(Value) }))
    const roles = input.recipients.filter((r) => r.kind !== 'cc').map((r, i) => ({
      RoleIndex: /^\d+$/.test(String(r.role ?? '')) ? Number(r.role) : i + 1,
      ...(r.role && !/^\d+$/.test(r.role) ? { SignerRole: r.role } : {}),
      SignerName: r.name,
      SignerEmail: r.email,
      ...(prefill.length ? { ExistingFormFields: prefill } : {}),
    }))
    const body = mergeAdvanced({ ...common(input), Roles: roles }, input.advanced)
    const data = await c.json({ method: 'POST', path: 'template/send', query: { templateId: input.template_id }, json: body })
    if (!data?.documentId) throw new EsignError('provider_error', 'BoldSign did not return a document id')
    return sentEnvelope(String(data.documentId), input)
  },

  async getEnvelope(ctx, id) {
    const c = await this.client(ctx)
    return mapBoldSignDocument(await c.json({ path: 'document/properties', query: { documentId: id } }))
  },

  async download(ctx, id, kind) {
    const c = await this.client(ctx)
    const res = await c.request({ path: kind === 'certificate' ? 'document/downloadAuditLog' : 'document/download', query: { documentId: id }, binary: true })
    return { bytes: res.bytes!, name: kind === 'certificate' ? 'audit-log.pdf' : 'signed.pdf', mime_type: 'application/pdf' }
  },

  async cancel(ctx, id, reason) {
    const c = await this.client(ctx)
    await c.request({ method: 'POST', path: 'document/revoke', query: { documentId: id }, json: { Message: reason.slice(0, 500) } })
  },

  async signingUrl(ctx, id, input) {
    const c = await this.client(ctx)
    const data = await c.json({ path: 'document/getEmbeddedSignLink', query: { documentId: id, signerEmail: input.email, redirectUrl: input.return_url || ctx.settings.default_return_url } })
    if (!data?.signLink) throw new EsignError('provider_error', 'BoldSign did not return a signing link')
    return { url: String(data.signLink), expires_at: null, recipient_email: input.email }
  },

  async listTemplates(ctx, input) {
    const c = await this.client(ctx)
    const page = Math.max(1, Number(input.cursor) || 1)
    const pageSize = Math.min(Math.max(Number(input.page_size) || 25, 1), 100)
    const data = await c.json({ path: 'template/list', query: { Page: page, PageSize: pageSize, SearchKey: input.search } })
    const list: any[] = Array.isArray(data?.result) ? data.result : []
    const pages = Number(data?.pageDetails?.totalPages ?? page)
    return {
      templates: list.map((t) => ({
        id: String(t.documentId ?? t.templateId),
        name: String(t.messageTitle ?? t.templateName ?? t.documentId),
        description: t.templateDescription ? String(t.templateDescription) : null,
        roles: (t.roles ?? t.signerDetails ?? []).map((r: any) => String(r.name ?? r.signerRole ?? '')).filter(Boolean),
        updated_at: isoOrNull(t.activityDate ?? t.createdDate),
      })),
      next_cursor: page < pages ? String(page + 1) : null,
    }
  },

  async whoami(ctx) {
    const c = await this.client(ctx)
    const data = await c.json({ path: 'template/list', query: { Page: 1, PageSize: 1 } })
    return `BoldSign account (${Number(data?.pageDetails?.totalRecordsCount ?? 0)} templates)`
  },

  verifyWebhook({ req, secrets, now }) {
    const secret = requireSecret(secrets.webhook_secret, 'The BoldSign webhook secret')
    const header = req.headers.get('x-boldsign-signature') ?? ''
    const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')).filter((kv) => kv.length === 2).map(([k, v]) => [k.trim(), v.trim()]))
    const t = parts.t
    if (!t || !parts.s0) throw new WebhookAuthError('Missing X-BoldSign-Signature')
    const expected = hmac(secret, `${t}.${req.rawBody.toString('utf8')}`, 'hex')
    if (!Object.entries(parts).some(([k, v]) => /^s\d+$/.test(k) && safeEqual(v, expected))) throw new WebhookAuthError('BoldSign signature mismatch')
    if (!/^\d+$/.test(t) || Math.abs(now - Number(t) * 1000) > BOLDSIGN_TOLERANCE_MS) throw new WebhookAuthError('The BoldSign signature timestamp is outside the 5-minute tolerance (possible replay)', 400)
    if ((req.headers.get('x-boldsign-event') ?? '') === 'Verification') return { events: [] }
    const body = parseJsonBody(req.rawBody)
    const name = String(body?.event?.eventType ?? req.headers.get('x-boldsign-event') ?? '')
    const data = body?.data ?? {}
    const signer = data.signerDetails?.find?.((s: any) => s.signerEmail && /completed|signed|declined/i.test(String(s.status ?? '')))
    const ev = event(BOLDSIGN_EVENTS[name] ?? null, data.documentId, ['boldsign', body?.event?.id ?? `${t}:${name}:${data.documentId}`], name, isoOrNull(body?.event?.created ?? Number(t)),
      name === 'Signed' && signer ? { email: String(signer.signerEmail), name: String(signer.signerName ?? '') } : null)
    return { events: ev ? [ev] : [] }
  },
}
