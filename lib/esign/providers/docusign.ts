/**
 * DocuSign eSignature REST API v2.1.
 *
 * Base URI: the connector's account base URI, or discovered from
 * {auth server}/oauth/userinfo (account-d.docusign.com for demo,
 * account.docusign.com for production) — the account's `base_uri` + /restapi.
 * Envelopes carry the client reference as a hidden text custom field
 * (`usertasks_client_reference`). Embedded signers get a clientUserId
 * (`ut:<email>`) so a recipient view URL can be created for them.
 * Connect webhooks: HMAC-SHA256 of the raw body, base64, in
 * X-DocuSign-Signature-1 (…-N while keys rotate).
 */

import type { EnvelopeStatus, RecipientStatus } from '../catalog'
import { TERMINAL_STATUSES } from '../catalog'
import { EsignClient, discover, discoveryGet, docusignAuthServer, extOf, isoOrNull, mergeAdvanced, type EsignContext } from '../client'
import { assertFresh, event, hmac, parseJsonBody, requireSecret, safeEqual, WebhookAuthError, type EsignAdapter, type WebhookResult } from '../adapter'
import { EsignError, type EsignEnvelope, type EsignRecipient, type EsignRecipientInput, type SendCommon } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any -- DocuSign JSON */

export const DOCUSIGN_REF_FIELD = 'usertasks_client_reference'

const ENVELOPE_STATUS: Record<string, EnvelopeStatus> = {
  created: 'draft', sent: 'sent', delivered: 'delivered', signed: 'delivered', completed: 'completed',
  declined: 'declined', voided: 'voided', timedout: 'expired', deleted: 'voided', correct: 'sent', authoritativecopy: 'completed',
}
const RECIPIENT_STATUS: Record<string, RecipientStatus> = {
  created: 'created', sent: 'sent', delivered: 'delivered', signed: 'signed', completed: 'signed', declined: 'declined',
  autoresponded: 'sent', faxpending: 'sent', voided: 'voided',
}

function errorMessage(data: any): string | null {
  if (data && typeof data === 'object') return data.message ?? data.errorCode ?? data.error_description ?? null
  return null
}

export function embeddedClientUserId(email: string): string {
  return `ut:${String(email).trim().toLowerCase()}`.slice(0, 100)
}

async function accountBase(ctx: EsignContext): Promise<{ base: string; accountId: string; accountName?: string }> {
  const s = ctx.settings
  const explicit = String(s.api_base_url || (s.base_url && s.base_url !== 'auto' ? s.base_url : '') || '').trim().replace(/\/+$/, '')
  const accountId = String(s.account_id ?? '').trim()
  if (explicit && accountId) return { base: explicit, accountId }
  return discover(ctx, 'docusign-userinfo', async () => {
    const server = docusignAuthServer(s, ctx.integrationConfig?.auth_config)
    const info = await discoveryGet(ctx, `${server}/oauth/userinfo`, 'DocuSign account discovery (/oauth/userinfo)')
    const accounts: any[] = Array.isArray(info?.accounts) ? info.accounts : []
    const account = accountId ? accounts.find((a) => String(a.account_id) === accountId) : accounts.find((a) => a.is_default === true || a.is_default === 'true') ?? accounts[0]
    if (!account) {
      throw new EsignError('configuration', accountId
        ? `DocuSign account ${accountId} is not available to this user (check the Account ID and the environment)`
        : 'The DocuSign user has no eSignature account', { retryable: false })
    }
    return {
      base: explicit || `${String(account.base_uri).replace(/\/+$/, '')}/restapi`,
      accountId: String(account.account_id),
      accountName: account.account_name ? String(account.account_name) : undefined,
    }
  })
}

function tabsFor(r: EsignRecipientInput) {
  const a = r.anchor
  if (!a) return undefined
  const anchor = (text: string) => ({
    anchorString: text,
    anchorUnits: 'pixels',
    anchorXOffset: String(a.x_offset ?? 0),
    anchorYOffset: String(a.y_offset ?? 0),
    anchorIgnoreIfNotPresent: 'false',
  })
  const tabs: Record<string, unknown[]> = {}
  if (a.signature) tabs.signHereTabs = [anchor(a.signature)]
  if (a.date) tabs.dateSignedTabs = [anchor(a.date)]
  if (a.name) tabs.fullNameTabs = [anchor(a.name)]
  return Object.keys(tabs).length ? tabs : undefined
}

function recipientsBody(input: SendCommon) {
  const signers: any[] = []
  const carbonCopies: any[] = []
  input.recipients.forEach((r, i) => {
    const base: Record<string, unknown> = {
      email: r.email,
      name: r.name,
      recipientId: String(i + 1),
      routingOrder: String(r.routing_order ?? 1),
      ...(r.role ? { roleName: r.role } : {}),
    }
    if (r.kind === 'cc') carbonCopies.push(base)
    else {
      const tabs = tabsFor(r)
      signers.push({ ...base, ...(input.embedded ? { clientUserId: embeddedClientUserId(r.email) } : {}), ...(tabs ? { tabs } : {}) })
    }
  })
  return { signers, ...(carbonCopies.length ? { carbonCopies } : {}) }
}

function notificationFor(input: SendCommon) {
  const reminders = input.reminder_days && input.reminder_days > 0
    ? { reminderEnabled: 'true', reminderDelay: String(input.reminder_days), reminderFrequency: String(input.reminder_days) }
    : undefined
  const expirations = input.expires_in_days && input.expires_in_days > 0
    ? { expireEnabled: 'true', expireAfter: String(input.expires_in_days), expireWarn: String(Math.max(0, Math.min(3, input.expires_in_days - 1))) }
    : undefined
  if (!reminders && !expirations) return undefined
  return { useAccountDefaults: 'false', ...(reminders ? { reminders } : {}), ...(expirations ? { expirations } : {}) }
}

function common(input: SendCommon) {
  const notification = notificationFor(input)
  return {
    emailSubject: input.subject.slice(0, 100),
    ...(input.message ? { emailBlurb: input.message.slice(0, 10000) } : {}),
    customFields: { textCustomFields: [{ name: DOCUSIGN_REF_FIELD, value: input.client_reference, show: 'false', required: 'false' }] },
    ...(notification ? { notification } : {}),
    status: 'sent',
  }
}

function mapRecipient(r: any, kind: EsignRecipient['kind']): EsignRecipient {
  const ps = String(r.status ?? '').toLowerCase()
  return {
    id: String(r.recipientId ?? r.recipientIdGuid ?? ''),
    name: String(r.name ?? r.userName ?? ''),
    email: String(r.email ?? ''),
    role: r.roleName ? String(r.roleName) : null,
    routing_order: r.routingOrder != null ? Number(r.routingOrder) : null,
    kind,
    status: kind === 'cc' && ps === 'completed' ? 'signed' : RECIPIENT_STATUS[ps] ?? 'unknown',
    provider_status: r.status ? String(r.status) : null,
    signed_at: isoOrNull(r.signedDateTime),
    declined_reason: r.declinedReason ? String(r.declinedReason) : null,
  }
}

export function mapDocusignEnvelope(e: any): EsignEnvelope {
  const ps = String(e?.status ?? '').toLowerCase()
  let status: EnvelopeStatus = ENVELOPE_STATUS[ps] ?? 'unknown'
  if (status === 'voided' && /expir/i.test(String(e?.voidedReason ?? ''))) status = 'expired'
  const r = e?.recipients ?? {}
  const recipients: EsignRecipient[] = [
    ...(Array.isArray(r.signers) ? r.signers.map((x: any) => mapRecipient(x, 'signer')) : []),
    ...(Array.isArray(r.carbonCopies) ? r.carbonCopies.map((x: any) => mapRecipient(x, 'cc')) : []),
  ]
  const ref = (e?.customFields?.textCustomFields ?? []).find((f: any) => f?.name === DOCUSIGN_REF_FIELD)
  return {
    provider: 'docusign',
    envelope_id: String(e?.envelopeId ?? ''),
    status,
    provider_status: String(e?.status ?? ''),
    subject: e?.emailSubject ? String(e.emailSubject) : null,
    created_at: isoOrNull(e?.createdDateTime),
    sent_at: isoOrNull(e?.sentDateTime),
    completed_at: isoOrNull(e?.completedDateTime),
    declined_at: isoOrNull(e?.declinedDateTime),
    voided_at: isoOrNull(e?.voidedDateTime),
    expires_at: isoOrNull(e?.expireDateTime),
    void_reason: e?.voidedReason ? String(e.voidedReason) : null,
    recipients,
    terminal: TERMINAL_STATUSES.has(status),
    client_reference: ref?.value ? String(ref.value) : null,
  }
}

function sentEnvelope(id: string, input: SendCommon, providerStatus: string): EsignEnvelope {
  return {
    provider: 'docusign', envelope_id: id, status: 'sent', provider_status: providerStatus, subject: input.subject,
    created_at: new Date().toISOString(), sent_at: new Date().toISOString(), completed_at: null, declined_at: null, voided_at: null, expires_at: null, void_reason: null,
    recipients: input.recipients.map((r, i) => ({
      id: String(i + 1), name: r.name, email: r.email, role: r.role ?? null, routing_order: r.routing_order ?? 1,
      kind: r.kind === 'cc' ? 'cc' : 'signer', status: 'sent', provider_status: 'sent', signed_at: null, declined_reason: null,
    })),
    terminal: false,
    client_reference: input.client_reference,
  }
}

const DOCUSIGN_EVENTS: Record<string, import('../catalog').EsignEventType> = {
  'envelope-sent': 'envelope_sent',
  'envelope-completed': 'envelope_completed',
  'envelope-declined': 'envelope_declined',
  'envelope-voided': 'envelope_voided',
  'recipient-delivered': 'recipient_viewed',
  'recipient-completed': 'recipient_signed',
  'recipient-declined': 'envelope_declined',
}

export const docusignAdapter: EsignAdapter = {
  id: 'docusign',

  async client(ctx) {
    const { base, accountId } = await accountBase(ctx)
    return new EsignClient(ctx, `${base}/v2.1/accounts/${encodeURIComponent(accountId)}`, { label: 'DocuSign', errorMessage })
  },

  async sendDocuments(ctx, input) {
    const c = await this.client(ctx)
    const body = mergeAdvanced({
      ...common(input),
      documents: input.documents.map((d, i) => ({
        documentBase64: Buffer.from(d.bytes).toString('base64'),
        name: d.name,
        fileExtension: extOf(d.name, d.mime_type),
        documentId: String(i + 1),
      })),
      recipients: recipientsBody(input),
    }, input.advanced)
    const data = await c.json({ method: 'POST', path: 'envelopes', json: body })
    if (!data?.envelopeId) throw new EsignError('provider_error', 'DocuSign did not return an envelope id')
    return sentEnvelope(String(data.envelopeId), input, String(data.status ?? 'sent'))
  },

  async sendTemplate(ctx, input) {
    const c = await this.client(ctx)
    const textTabs = Object.entries(input.prefill ?? {}).map(([tabLabel, value]) => ({ tabLabel, value: String(value) }))
    const templateRoles = input.recipients.map((r, i) => ({
      roleName: r.role || (r.kind === 'cc' ? 'CC' : `Signer ${i + 1}`),
      name: r.name,
      email: r.email,
      ...(r.routing_order ? { routingOrder: String(r.routing_order) } : {}),
      ...(input.embedded && r.kind !== 'cc' ? { clientUserId: embeddedClientUserId(r.email) } : {}),
      ...(textTabs.length && r.kind !== 'cc' ? { tabs: { textTabs } } : {}),
    }))
    const body = mergeAdvanced({ ...common(input), templateId: input.template_id, templateRoles }, input.advanced)
    const data = await c.json({ method: 'POST', path: 'envelopes', json: body })
    if (!data?.envelopeId) throw new EsignError('provider_error', 'DocuSign did not return an envelope id')
    return sentEnvelope(String(data.envelopeId), input, String(data.status ?? 'sent'))
  },

  async getEnvelope(ctx, envelopeId) {
    const c = await this.client(ctx)
    const data = await c.json({ path: `envelopes/${encodeURIComponent(envelopeId)}`, query: { include: 'recipients,custom_fields' } })
    return mapDocusignEnvelope(data)
  },

  async download(ctx, envelopeId, kind) {
    const c = await this.client(ctx)
    const res = await c.request({ path: `envelopes/${encodeURIComponent(envelopeId)}/documents/${kind === 'certificate' ? 'certificate' : 'combined'}`, binary: true })
    return { bytes: res.bytes!, name: kind === 'certificate' ? 'certificate-of-completion.pdf' : 'signed.pdf', mime_type: 'application/pdf' }
  },

  async cancel(ctx, envelopeId, reason) {
    const c = await this.client(ctx)
    await c.json({ method: 'PUT', path: `envelopes/${encodeURIComponent(envelopeId)}`, json: { status: 'voided', voidedReason: reason.slice(0, 200) } })
  },

  async signingUrl(ctx, envelopeId, input) {
    const c = await this.client(ctx)
    const data = await c.json({ path: `envelopes/${encodeURIComponent(envelopeId)}/recipients` })
    const signer = (data?.signers ?? []).find((s: any) => String(s.email ?? '').toLowerCase() === input.email.toLowerCase())
    if (!signer) throw new EsignError('not_found', `${input.email} is not a signer of this envelope`, { retryable: false })
    if (!signer.clientUserId) throw new EsignError('unsupported', `${input.email} was not added as an embedded signer — send the envelope with "Embedded signing" on to get a signing link`, { retryable: false })
    const view = await c.json({
      method: 'POST',
      path: `envelopes/${encodeURIComponent(envelopeId)}/views/recipient`,
      json: {
        returnUrl: input.return_url || ctx.settings.default_return_url || 'https://www.docusign.com',
        authenticationMethod: 'none',
        email: signer.email,
        userName: signer.name,
        clientUserId: signer.clientUserId,
        recipientId: signer.recipientId,
      },
    })
    if (!view?.url) throw new EsignError('provider_error', 'DocuSign did not return a signing URL')
    // Recipient view URLs are valid for 5 minutes and one use.
    return { url: String(view.url), expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), recipient_email: signer.email }
  },

  async listTemplates(ctx, input) {
    const c = await this.client(ctx)
    const count = Math.min(Math.max(Number(input.page_size) || 25, 1), 100)
    const start = Math.max(0, Number(input.cursor) || 0)
    const data = await c.json({ path: 'templates', query: { search_text: input.search, count, start_position: start, include: 'recipients' } })
    const list: any[] = Array.isArray(data?.envelopeTemplates) ? data.envelopeTemplates : []
    const end = Number(data?.endPosition ?? start + list.length - 1)
    const total = Number(data?.totalSetSize ?? 0)
    return {
      templates: list.map((t) => ({
        id: String(t.templateId),
        name: String(t.name ?? t.templateId),
        description: t.description ? String(t.description) : null,
        roles: [...(t.recipients?.signers ?? []), ...(t.recipients?.carbonCopies ?? [])].map((s: any) => String(s.roleName ?? '')).filter(Boolean),
        updated_at: isoOrNull(t.lastModified),
      })),
      next_cursor: list.length && end + 1 < total ? String(end + 1) : null,
    }
  },

  async whoami(ctx) {
    const { base, accountId, accountName } = await accountBase(ctx)
    const c = new EsignClient(ctx, `${base}/v2.1/accounts/${encodeURIComponent(accountId)}`, { label: 'DocuSign', errorMessage })
    const data = await c.json({ path: '' })
    return `DocuSign account ${data?.accountName ?? accountName ?? accountId}`
  },

  verifyWebhook({ req, secrets, now }): WebhookResult {
    const secret = requireSecret(secrets.webhook_secret, 'The DocuSign Connect HMAC key')
    const expected = hmac(secret, req.rawBody, 'base64')
    const provided: string[] = []
    for (let i = 1; i <= 10; i++) {
      const v = req.headers.get(`x-docusign-signature-${i}`)
      if (v) provided.push(v.trim())
    }
    if (!provided.length) throw new WebhookAuthError('Missing X-DocuSign-Signature-1 (turn on "Include HMAC signature" in the Connect configuration)')
    if (!provided.some((p) => safeEqual(p, expected))) throw new WebhookAuthError('DocuSign HMAC signature mismatch')
    const body = parseJsonBody(req.rawBody)
    const name = String(body?.event ?? '')
    const data = body?.data ?? {}
    const occurred = isoOrNull(body?.generatedDateTime)
    assertFresh(occurred, now)
    const envelopeId = data.envelopeId ?? data.envelopeSummary?.envelopeId
    const ev = event(DOCUSIGN_EVENTS[name] ?? null, envelopeId, ['docusign', name, body?.generatedDateTime, envelopeId, data.recipientId ?? '', body?.configurationId ?? ''], name, occurred,
      data.recipientId ? { id: String(data.recipientId) } : null)
    return { events: ev ? [ev] : [] }
  },
}
