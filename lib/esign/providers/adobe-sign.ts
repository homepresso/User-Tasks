/**
 * Adobe Acrobat Sign REST API v6.
 *
 * Base URI: discovered with GET https://api.<shard>.adobesign.com/api/rest/v6/baseUris
 * (any shard answers with the account's apiAccessPoint) unless the connector
 * sets an API base URL. Documents are uploaded as transient documents, then
 * an agreement is created with them; the client reference travels as the
 * agreement's externalId. Text tags in the documents ({{Sig_es_:signer1:signature}})
 * are detected by Acrobat Sign itself.
 * Webhooks: Acrobat Sign proves the delivery is for our app by sending
 * X-AdobeSign-ClientId, which must match the OAuth client id and be echoed
 * back (header and JSON); the webhook URL also carries a secret token.
 */

import type { EnvelopeStatus, EsignEventType, RecipientStatus } from '../catalog'
import { TERMINAL_STATUSES } from '../catalog'
import { EsignClient, discover, discoveryGet, isoOrNull, mergeAdvanced, type EsignContext } from '../client'
import { assertFresh, event, parseJsonBody, requireSecret, safeEqual, WebhookAuthError, type EsignAdapter } from '../adapter'
import { EsignError, type EsignEnvelope, type EsignRecipient, type SendCommon } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any -- Acrobat Sign JSON */

const AGREEMENT_STATUS: Record<string, EnvelopeStatus> = {
  DRAFT: 'draft', AUTHORING: 'draft', PREFILL: 'draft', DOCUMENTS_NOT_YET_PROCESSED: 'draft',
  IN_PROCESS: 'sent', OUT_FOR_SIGNATURE: 'sent', OUT_FOR_APPROVAL: 'sent', OUT_FOR_ACCEPTANCE: 'sent', OUT_FOR_DELIVERY: 'sent',
  OUT_FOR_FORM_FILLING: 'sent', WAITING_FOR_VERIFICATION: 'sent', WAITING_FOR_NOTARIZATION: 'sent', WAITING_FOR_FAXING: 'sent',
  SIGNED: 'completed', APPROVED: 'completed', ACCEPTED: 'completed', DELIVERED: 'completed', FORM_FILLED: 'completed', COMPLETED: 'completed',
  CANCELLED: 'voided', ABORTED: 'voided', RECALLED: 'voided', EXPIRED: 'expired',
}
const MEMBER_STATUS: Record<string, RecipientStatus> = {
  COMPLETED: 'signed', REJECTED: 'declined', CANCELLED: 'voided', EXPIRED: 'voided', NOT_YET_VISIBLE: 'created',
  WAITING_FOR_OTHERS: 'waiting', WAITING_FOR_MY_SIGNATURE: 'sent', WAITING_FOR_MY_APPROVAL: 'sent', WAITING_FOR_MY_ACCEPTANCE: 'sent',
  WAITING_FOR_MY_ACKNOWLEDGEMENT: 'sent', WAITING_FOR_MY_FORM_FILLING: 'sent', WAITING_FOR_MY_DELEGATION: 'sent', WAITING_FOR_MY_VERIFICATION: 'sent',
}

function errorMessage(data: any): string | null {
  if (data && typeof data === 'object') return data.message ?? data.code ?? null
  return null
}

function reminderFrequency(days?: number): string | undefined {
  if (!days || days <= 0) return undefined
  if (days <= 1) return 'DAILY_UNTIL_SIGNED'
  if (days <= 2) return 'EVERY_OTHER_DAY_UNTIL_SIGNED'
  if (days <= 3) return 'EVERY_THIRD_DAY_UNTIL_SIGNED'
  if (days <= 5) return 'EVERY_FIFTH_DAY_UNTIL_SIGNED'
  return 'WEEKLY_UNTIL_SIGNED'
}

async function apiBase(ctx: EsignContext): Promise<string> {
  const explicit = String(ctx.settings.api_base_url ?? '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  return discover(ctx, 'adobe-baseuris', async () => {
    const shard = String(ctx.settings.shard || 'na1').trim().toLowerCase()
    if (!/^[a-z]{2}\d{1,2}$/.test(shard)) throw new EsignError('configuration', `"${shard}" is not an Acrobat Sign shard (na1, na2, eu1, eu2, jp1, au1, in1 …)`, { retryable: false })
    const data = await discoveryGet(ctx, `https://api.${shard}.adobesign.com/api/rest/v6/baseUris`, 'Acrobat Sign base URI discovery')
    const point = String(data?.apiAccessPoint ?? '').replace(/\/+$/, '')
    if (!/^https:\/\//.test(point)) throw new EsignError('provider_error', 'Acrobat Sign did not return an apiAccessPoint')
    return `${point}/api/rest/v6`
  })
}

function participantSets(input: SendCommon) {
  return input.recipients.filter((r) => r.kind !== 'cc').map((r, i) => ({
    memberInfos: [{ email: r.email, ...(r.name ? { name: r.name } : {}) }],
    order: r.routing_order ?? i + 1,
    role: 'SIGNER',
    ...(r.role ? { label: r.role } : {}),
  }))
}

function common(input: SendCommon) {
  const ccs = input.recipients.filter((r) => r.kind === 'cc').map((r) => ({ email: r.email }))
  const freq = reminderFrequency(input.reminder_days)
  return {
    name: input.subject.slice(0, 255),
    ...(input.message ? { message: input.message } : {}),
    participantSetsInfo: participantSets(input),
    ...(ccs.length ? { ccs } : {}),
    signatureType: 'ESIGN',
    state: 'IN_PROCESS',
    externalId: { id: input.client_reference },
    ...(freq ? { reminderFrequency: freq } : {}),
    ...(input.expires_in_days && input.expires_in_days > 0 ? { expirationTime: new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString() } : {}),
    ...(input.embedded ? { emailOption: { sendOptions: { initEmails: 'NONE', inFlightEmails: 'NONE', completionEmails: 'ALL' } } } : {}),
  }
}

export function mapAdobeAgreement(a: any, members: any): EsignEnvelope {
  const sets: any[] = Array.isArray(members?.participantSets) ? members.participantSets : []
  const recipients: EsignRecipient[] = []
  for (const set of sets) {
    const ps = String(set.status ?? '').toUpperCase()
    for (const m of set.memberInfos ?? []) {
      const ms = String(m.status ?? ps).toUpperCase()
      recipients.push({
        id: String(m.id ?? set.id ?? ''),
        name: String(m.name ?? ''),
        email: String(m.email ?? ''),
        role: set.label ? String(set.label) : set.role ? String(set.role) : null,
        routing_order: set.order != null ? Number(set.order) : null,
        kind: String(set.role ?? '').toUpperCase() === 'APPROVER' ? 'approver' : 'signer',
        status: MEMBER_STATUS[ms] ?? 'unknown',
        provider_status: ms || null,
        signed_at: null,
        declined_reason: null,
      })
    }
  }
  for (const cc of members?.ccsInfo ?? []) {
    recipients.push({ id: String(cc.id ?? ''), name: String(cc.name ?? ''), email: String(cc.email ?? ''), role: 'CC', routing_order: null, kind: 'cc', status: 'unknown', provider_status: null, signed_at: null, declined_reason: null })
  }
  const ps = String(a?.status ?? '').toUpperCase()
  let status: EnvelopeStatus = AGREEMENT_STATUS[ps] ?? 'unknown'
  if (recipients.some((r) => r.status === 'declined')) status = 'declined'
  return {
    provider: 'adobe_sign',
    envelope_id: String(a?.id ?? ''),
    status,
    provider_status: ps,
    subject: a?.name ? String(a.name) : null,
    created_at: isoOrNull(a?.createdDate),
    sent_at: isoOrNull(a?.createdDate),
    completed_at: status === 'completed' ? isoOrNull(a?.lastEventDate ?? a?.modifiedDate) : null,
    declined_at: null,
    voided_at: null,
    expires_at: isoOrNull(a?.expirationTime),
    void_reason: null,
    recipients,
    terminal: TERMINAL_STATUSES.has(status),
    client_reference: a?.externalId?.id ? String(a.externalId.id) : null,
  }
}

function sentEnvelope(id: string, input: SendCommon): EsignEnvelope {
  return {
    provider: 'adobe_sign', envelope_id: id, status: 'sent', provider_status: 'IN_PROCESS', subject: input.subject,
    created_at: new Date().toISOString(), sent_at: new Date().toISOString(), completed_at: null, declined_at: null, voided_at: null, expires_at: null, void_reason: null,
    recipients: input.recipients.map((r, i) => ({ id: String(i + 1), name: r.name, email: r.email, role: r.role ?? null, routing_order: r.routing_order ?? i + 1, kind: r.kind === 'cc' ? 'cc' : 'signer', status: 'sent', provider_status: null, signed_at: null, declined_reason: null })),
    terminal: false,
    client_reference: input.client_reference,
  }
}

const ADOBE_EVENTS: Record<string, EsignEventType> = {
  AGREEMENT_CREATED: 'envelope_sent',
  AGREEMENT_EMAIL_VIEWED: 'recipient_viewed',
  AGREEMENT_ACTION_COMPLETED: 'recipient_signed',
  AGREEMENT_WORKFLOW_COMPLETED: 'envelope_completed',
  AGREEMENT_REJECTED: 'envelope_declined',
  AGREEMENT_RECALLED: 'envelope_voided',
  AGREEMENT_EXPIRED: 'envelope_expired',
}

export const adobeSignAdapter: EsignAdapter = {
  id: 'adobe_sign',

  async client(ctx) {
    return new EsignClient(ctx, await apiBase(ctx), { label: 'Acrobat Sign', errorMessage })
  },

  async sendDocuments(ctx, input) {
    const c = await this.client(ctx)
    const fileInfos: Array<{ transientDocumentId: string }> = []
    for (const doc of input.documents) {
      const form = new FormData()
      form.set('File-Name', doc.name)
      form.set('Mime-Type', doc.mime_type)
      form.set('File', new Blob([Buffer.from(doc.bytes)], { type: doc.mime_type }), doc.name)
      const up = await c.json({ method: 'POST', path: 'transientDocuments', form })
      if (!up?.transientDocumentId) throw new EsignError('provider_error', `Acrobat Sign did not accept ${doc.name}`)
      fileInfos.push({ transientDocumentId: String(up.transientDocumentId) })
    }
    const data = await c.json({ method: 'POST', path: 'agreements', json: mergeAdvanced({ ...common(input), fileInfos }, input.advanced) })
    if (!data?.id) throw new EsignError('provider_error', 'Acrobat Sign did not return an agreement id')
    return sentEnvelope(String(data.id), input)
  },

  async sendTemplate(ctx, input) {
    const c = await this.client(ctx)
    const mergeFieldInfo = Object.entries(input.prefill ?? {}).map(([fieldName, defaultValue]) => ({ fieldName, defaultValue: String(defaultValue) }))
    const body = mergeAdvanced({
      ...common(input),
      fileInfos: [{ libraryDocumentId: input.template_id }],
      ...(mergeFieldInfo.length ? { mergeFieldInfo } : {}),
    }, input.advanced)
    const data = await c.json({ method: 'POST', path: 'agreements', json: body })
    if (!data?.id) throw new EsignError('provider_error', 'Acrobat Sign did not return an agreement id')
    return sentEnvelope(String(data.id), input)
  },

  async getEnvelope(ctx, id) {
    const c = await this.client(ctx)
    const agreement = await c.json({ path: `agreements/${encodeURIComponent(id)}` })
    const members = await c.json({ path: `agreements/${encodeURIComponent(id)}/members` })
    return mapAdobeAgreement(agreement, members)
  },

  async download(ctx, id, kind) {
    const c = await this.client(ctx)
    const res = await c.request({ path: `agreements/${encodeURIComponent(id)}/${kind === 'certificate' ? 'auditTrail' : 'combinedDocument'}`, binary: true })
    return { bytes: res.bytes!, name: kind === 'certificate' ? 'audit-report.pdf' : 'signed.pdf', mime_type: 'application/pdf' }
  },

  async cancel(ctx, id, reason) {
    const c = await this.client(ctx)
    await c.request({ method: 'PUT', path: `agreements/${encodeURIComponent(id)}/state`, json: { state: 'CANCELLED', agreementCancellationInfo: { comment: reason.slice(0, 255), notifyOthers: true } } })
  },

  async signingUrl(ctx, id, input) {
    const c = await this.client(ctx)
    const data = await c.json({ path: `agreements/${encodeURIComponent(id)}/signingUrls` })
    for (const set of data?.signingUrlSetInfos ?? []) {
      for (const u of set.signingUrls ?? []) {
        if (String(u.email ?? '').toLowerCase() === input.email.toLowerCase() && u.esignUrl) {
          return { url: String(u.esignUrl), expires_at: null, recipient_email: String(u.email) }
        }
      }
    }
    throw new EsignError('not_found', `No signing URL for ${input.email} yet — it is not this recipient's turn, or they are not a signer`, { retryable: true })
  },

  async listTemplates(ctx, input) {
    const c = await this.client(ctx)
    const pageSize = Math.min(Math.max(Number(input.page_size) || 25, 1), 100)
    const data = await c.json({ path: 'libraryDocuments', query: { pageSize, cursor: input.cursor ?? undefined } })
    const q = String(input.search ?? '').trim().toLowerCase()
    const list: any[] = Array.isArray(data?.libraryDocumentList) ? data.libraryDocumentList : []
    return {
      templates: list
        .filter((t) => !Array.isArray(t.templateTypes) || t.templateTypes.includes('DOCUMENT'))
        .filter((t) => !q || String(t.name ?? '').toLowerCase().includes(q))
        .map((t) => ({ id: String(t.id), name: String(t.name ?? t.id), description: null, roles: [], updated_at: isoOrNull(t.modifiedDate) })),
      next_cursor: data?.page?.nextCursor ? String(data.page.nextCursor) : null,
    }
  },

  async whoami(ctx) {
    const c = await this.client(ctx)
    const me = await c.json({ path: 'users/me' })
    return `Acrobat Sign user ${me?.email ?? me?.id ?? ''}`.trim()
  },

  verifyWebhook({ req, secrets, now }) {
    const token = requireSecret(secrets.webhook_secret, 'The webhook secret (URL token)')
    if (!safeEqual(req.url.searchParams.get('token') ?? '', token)) throw new WebhookAuthError('Missing or wrong webhook URL token')
    const expectedClient = requireSecret(secrets.client_id, 'The Acrobat Sign OAuth client ID')
    const clientId = req.headers.get('x-adobesign-clientid') ?? ''
    if (!safeEqual(clientId, expectedClient)) throw new WebhookAuthError('X-AdobeSign-ClientId does not match this connector\'s client ID')
    const echo = { status: 200, headers: { 'X-AdobeSign-ClientId': clientId }, json: { xAdobeSignClientId: clientId } }
    // Verification of intent: GET (or an empty POST) when the webhook is registered.
    if (req.method === 'GET' || req.rawBody.length === 0) return { events: [], response: echo }
    const body = parseJsonBody(req.rawBody)
    const name = String(body?.event ?? '')
    const agreementId = body?.agreement?.id ?? body?.agreementId
    const occurred = isoOrNull(body?.eventDate)
    assertFresh(occurred, now)
    const dedupe = body?.webhookNotificationId ? ['adobe', body.webhookNotificationId] : ['adobe', name, body?.eventDate, agreementId, body?.participantUserEmail ?? '']
    const ev = event(ADOBE_EVENTS[name] ?? null, agreementId, dedupe, name, occurred,
      body?.participantUserEmail || body?.actingUserEmail ? { email: String(body.participantUserEmail ?? body.actingUserEmail) } : null)
    return { events: ev ? [ev] : [], response: echo }
  },
}
