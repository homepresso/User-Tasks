import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))
// Downloads land in workflow files through the storage provider: stubbed here (no storage in unit tests).
vi.mock('@/lib/documents/store', async (orig) => ({
  ...(await orig() as object),
  storeDocumentFile: async (_c: unknown, tenantId: string, bytes: Uint8Array, name: string, mime: string) => ({
    _file: true, id: 'f1', name, size: bytes.byteLength, mime_type: mime, content_type: mime, url: `https://files.example/${tenantId}/${name}`, path: `workflow-files/${tenantId}/${name}`, storage_ref: 'storage://task-files/x', uploaded_by: null, uploaded_at: '2026-01-01T00:00:00.000Z', checksum_sha256: 'x',
  }),
}))

import { generateKeyPairSync, createVerify } from 'node:crypto'
import { runConnectorTemplate, TEST_TENANT, type RecordedRequest } from './helpers/connector-contract'
import { fakeDb, type FakeDb } from './helpers/esign-fake-db'
import { getConnectorDefinition } from '@/lib/connectors/registry'
import { runConnectorPreflight } from '@/lib/connectors/preflight'
import { clearEsignTokenCache, docusignJwtAssertion } from '@/lib/esign/client'
import { setEsignServiceDb } from '@/lib/esign/service'
import { ESIGN_PROVIDERS } from '@/lib/esign/catalog'

/**
 * Contract tests for the e-signature connectors (lib/esign): every shared
 * action as actually sent by the runtime (connector reference →
 * reference-executor → e-sign executor → adapter → connectorFetch), against
 * fixtures shaped like each provider's public API docs. No real service is
 * called: fetch is replaced and DNS is stubbed for the egress guard.
 */

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const DOC = { base64: PDF.toString('base64'), name: 'contract.pdf', mime_type: 'application/pdf' }
const RECIPIENTS = [
  { name: 'Ada Lovelace', email: 'ada@example.com', role: 'Client', routing_order: 1, anchor: '/sn1/' },
  { name: 'Grace Hopper', email: 'grace@example.com', role: 'Manager', routing_order: 2 },
  { name: 'Legal', email: 'legal@example.com', kind: 'cc' },
]

let db: FakeDb
beforeEach(() => {
  db = fakeDb()
  setEsignServiceDb(db as never)
  clearEsignTokenCache()
})
afterEach(() => setEsignServiceDb(null))

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const pdfResponse = () => new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } })
const bodyOf = (r: RecordedRequest) => JSON.parse(r.body ?? '{}')
const providerCalls = (requests: RecordedRequest[], host: string) => requests.filter((r) => r.url.includes(host))

/* ── DocuSign ──────────────────────────────────────────────────────── */

describe('DocuSign', () => {
  const DS = 'https://demo.docusign.net/restapi/v2.1/accounts/acct-1'
  const config = { environment: 'demo', base_url: 'auto', account_id: 'acct-1', api_base_url: '', default_return_url: '' }
  const credentials = { auth_method: 'authorization_code', access_token: 'ds-access-token', client_id: '', client_secret: '', refresh_token: '', webhook_secret: '' }
  const envelope = {
    envelopeId: 'env-1', status: 'completed', emailSubject: 'Please sign', sentDateTime: '2026-11-01T10:00:00Z', completedDateTime: '2026-11-02T10:00:00Z',
    recipients: {
      signers: [
        { recipientId: '1', name: 'Ada Lovelace', email: 'ada@example.com', roleName: 'Client', routingOrder: '1', status: 'completed', signedDateTime: '2026-11-01T12:00:00Z' },
        { recipientId: '2', name: 'Grace Hopper', email: 'grace@example.com', routingOrder: '2', status: 'completed', clientUserId: 'ut:grace@example.com' },
      ],
      carbonCopies: [{ recipientId: '3', name: 'Legal', email: 'legal@example.com', status: 'completed' }],
    },
    customFields: { textCustomFields: [{ name: 'usertasks_client_reference', value: 'ref-1' }] },
  }
  const respond = (req: RecordedRequest): Response => {
    if (req.url.endsWith('/oauth/userinfo')) return json({ sub: 'u1', accounts: [{ account_id: 'acct-0', base_uri: 'https://na3.docusign.net', is_default: true }, { account_id: 'acct-1', base_uri: 'https://demo.docusign.net', is_default: false, account_name: 'Northwind' }] })
    if (req.method === 'POST' && req.url === `${DS}/envelopes`) return json({ envelopeId: 'env-1', status: 'sent', uri: '/envelopes/env-1' }, 201)
    if (req.url.startsWith(`${DS}/envelopes/env-1?`)) return json(envelope)
    if (req.url === `${DS}/envelopes/env-1/recipients`) return json(envelope.recipients)
    if (req.url.endsWith('/views/recipient')) return json({ url: 'https://demo.docusign.net/Signing/MTRedeem/v1/abc' }, 201)
    if (req.url.includes('/documents/')) return pdfResponse()
    if (req.url.startsWith(`${DS}/templates`)) return json({ envelopeTemplates: [{ templateId: 'tpl-1', name: 'NDA', recipients: { signers: [{ roleName: 'Client' }] } }], resultSetSize: '1', totalSetSize: '3', startPosition: '0', endPosition: '0' })
    if (req.method === 'PUT') return json({})
    return json({ errorCode: 'NOT_FOUND', message: 'no route' }, 404)
  }
  const run = (template: string, inputs: Record<string, unknown>, opts: { respond?: typeof respond; credentials?: Record<string, unknown>; config?: Record<string, unknown> } = {}) =>
    runConnectorTemplate({ connector: 'docusign', template, config: { ...config, ...(opts.config ?? {}) }, credentials: { ...credentials, ...(opts.credentials ?? {}) }, inputs, respond: opts.respond ?? respond })

  it('discovers the account base URI with /oauth/userinfo (demo auth server) and sends documents', async () => {
    const { requests, call, result } = await run('send_documents', { documents: [DOC], recipients: RECIPIENTS, subject: 'Please sign', message: 'Thanks', reminder_days: 2, expires_in_days: 14 })
    expect(requests[0]).toMatchObject({ method: 'GET', url: 'https://account-d.docusign.com/oauth/userinfo' })
    expect(requests[0].headers.authorization).toBe('Bearer ***')
    expect(call.method).toBe('POST')
    expect(call.url).toBe(`${DS}/envelopes`)
    expect(call.headers.authorization).toBe('Bearer ***')
    const body = bodyOf(call)
    expect(body).toMatchObject({
      emailSubject: 'Please sign', emailBlurb: 'Thanks', status: 'sent',
      documents: [{ documentBase64: PDF.toString('base64'), name: 'contract.pdf', fileExtension: 'pdf', documentId: '1' }],
      recipients: {
        signers: [
          { email: 'ada@example.com', name: 'Ada Lovelace', recipientId: '1', routingOrder: '1', roleName: 'Client', tabs: { signHereTabs: [{ anchorString: '/sn1/', anchorUnits: 'pixels' }] } },
          { email: 'grace@example.com', recipientId: '2', routingOrder: '2' },
        ],
        carbonCopies: [{ email: 'legal@example.com', recipientId: '3' }],
      },
      notification: { useAccountDefaults: 'false', reminders: { reminderEnabled: 'true', reminderDelay: '2' }, expirations: { expireEnabled: 'true', expireAfter: '14' } },
    })
    expect(body.customFields.textCustomFields[0]).toMatchObject({ name: 'usertasks_client_reference', show: 'false' })
    expect(result.status).toBe(201)
    expect(result.data).toMatchObject({ provider: 'docusign', envelope_id: 'env-1', status: 'sent', signer_count: 2, replayed: false })
    expect(db.tables.esign_envelopes[0]).toMatchObject({ tenant_id: TEST_TENANT, status: 'sent', envelope_id: 'env-1', provider: 'docusign' })
  })

  it('embedded signers get a clientUserId; the recipient view needs it', async () => {
    const { call } = await run('send_documents', { documents: [DOC], recipients: RECIPIENTS.slice(0, 1), subject: 'S', embedded: true })
    expect(bodyOf(call).recipients.signers[0].clientUserId).toBe('ut:ada@example.com')
    const view = await run('signing_url', { envelope_id: 'env-1', recipient_email: 'grace@example.com', return_url: 'https://app.example/done' })
    expect(view.call.url).toBe(`${DS}/envelopes/env-1/views/recipient`)
    expect(bodyOf(view.call)).toEqual({ returnUrl: 'https://app.example/done', authenticationMethod: 'none', email: 'grace@example.com', userName: 'Grace Hopper', clientUserId: 'ut:grace@example.com', recipientId: '2' })
    expect(view.result.data.url).toMatch(/^https:\/\/demo\.docusign\.net\/Signing/)
    const notEmbedded = await run('signing_url', { envelope_id: 'env-1', recipient_email: 'ada@example.com' })
    expect(notEmbedded.result.status).toBe(400)
    expect(notEmbedded.result.error_message).toMatch(/not added as an embedded signer/)
  })

  it('sends from a template with role mapping and prefilled text tabs', async () => {
    const { call } = await run('send_template', { template_id: 'tpl-1', recipients: RECIPIENTS.slice(0, 2), subject: 'NDA', prefill: { company: 'Northwind' } })
    expect(bodyOf(call)).toMatchObject({
      templateId: 'tpl-1', status: 'sent',
      templateRoles: [
        { roleName: 'Client', email: 'ada@example.com', name: 'Ada Lovelace', routingOrder: '1', tabs: { textTabs: [{ tabLabel: 'company', value: 'Northwind' }] } },
        { roleName: 'Manager', email: 'grace@example.com' },
      ],
    })
  })

  it('normalizes status and per-recipient status', async () => {
    const { call, result } = await run('get_status', { envelope_id: 'env-1' })
    expect(call.url).toBe(`${DS}/envelopes/env-1?include=recipients%2Ccustom_fields`)
    expect(result.data).toMatchObject({ status: 'completed', completed: true, signed_count: 2, signer_count: 2, client_reference: 'ref-1' })
    expect(result.data.recipients[0]).toMatchObject({ email: 'ada@example.com', role: 'Client', status: 'signed', signed_at: '2026-11-01T12:00:00.000Z' })
    expect(result.data.recipients[2]).toMatchObject({ kind: 'cc', email: 'legal@example.com' })
  })

  it('maps a voided envelope with an expiry reason to expired', async () => {
    const { result } = await run('get_status', { envelope_id: 'env-1' }, { respond: (r) => r.url.endsWith('userinfo') ? respond(r) : json({ envelopeId: 'env-1', status: 'voided', voidedReason: 'Envelope has expired.' }) })
    expect(result.data.status).toBe('expired')
  })

  it('downloads the combined PDF and the certificate into workflow files', async () => {
    const { requests, result } = await run('download_signed', { envelope_id: 'env-1', document: 'both', file_name: 'NDA signed' })
    expect(providerCalls(requests, '/documents/').map((r) => r.url)).toEqual([`${DS}/envelopes/env-1/documents/combined`, `${DS}/envelopes/env-1/documents/certificate`])
    expect(result.data.file).toMatchObject({ _file: true, name: 'NDA signed.pdf', size: PDF.byteLength, mime_type: 'application/pdf' })
    expect(result.data.certificate).toMatchObject({ name: 'NDA signed-certificate.pdf' })
    expect(JSON.stringify(result.data)).not.toContain(PDF.toString('base64'))
  })

  it('voids with a reason', async () => {
    const { call, result } = await run('cancel_envelope', { envelope_id: 'env-1', reason: 'Superseded' })
    expect(call).toMatchObject({ method: 'PUT', url: `${DS}/envelopes/env-1` })
    expect(bodyOf(call)).toEqual({ status: 'voided', voidedReason: 'Superseded' })
    expect(result.data).toEqual({ envelope_id: 'env-1', cancelled: true })
  })

  it('lists templates with roles and a next cursor (start_position paging)', async () => {
    const { call, result } = await run('search_templates', { search: 'nda', page_size: 1 })
    expect(call.url).toBe(`${DS}/templates?search_text=nda&count=1&start_position=0&include=recipients`)
    expect(result.data).toEqual({ templates: [{ id: 'tpl-1', name: 'NDA', description: null, roles: ['Client'], updated_at: null }], next_cursor: '1' })
    const next = await run('search_templates', { cursor: '1' })
    expect(next.call.url).toContain('start_position=1')
  })

  it('a fixed base URI + account id skips discovery; legacy (raw REST) integrations keep their base URL', async () => {
    const { requests } = await run('get_status', { envelope_id: 'env-1' }, { config: { base_url: 'https://demo.docusign.net/restapi' } })
    expect(requests.some((r) => r.url.includes('userinfo'))).toBe(false)
    const built = getConnectorDefinition('docusign')!.buildIntegrationConfig({ base_url: 'https://na3.docusign.net/restapi', account_id: 'a' }, { access_token: 't' })
    expect(built).toMatchObject({ base_url: 'https://na3.docusign.net/restapi', auth_type: 'bearer', auth_config: { token: 't' } })
  })

  it('refresh-token auth authenticates the client with HTTP Basic at the demo token endpoint', async () => {
    const { requests } = await run('get_status', { envelope_id: 'env-1' }, {
      config: { base_url: 'https://demo.docusign.net/restapi' },
      credentials: { access_token: '', client_id: 'ik-1', client_secret: 'sk-1', refresh_token: 'rt-1' },
      respond: (r) => (r.url.endsWith('/oauth/token') ? json({ access_token: 'minted', expires_in: 28800 }) : respond(r)),
    })
    const token = requests.find((r) => r.url === 'https://account-d.docusign.com/oauth/token')!
    expect(token.headers.authorization).toBe('Basic ***')
    expect(token.body).toBe('grant_type=refresh_token&refresh_token=rt-1')
  })

  it('production integrations refresh at account.docusign.com', async () => {
    const { requests } = await run('get_status', { envelope_id: 'env-1' }, {
      config: { environment: 'production', base_url: 'https://na3.docusign.net/restapi' },
      credentials: { access_token: '', client_id: 'ik-1', client_secret: 'sk-1', refresh_token: 'rt-1' },
      respond: (r) => (r.url.endsWith('/oauth/token') ? json({ access_token: 'minted', expires_in: 28800 }) : json(envelope)),
    })
    expect(requests[0].url).toBe('https://account.docusign.com/oauth/token')
    expect(requests[1].url).toBe('https://na3.docusign.net/restapi/v2.1/accounts/acct-1/envelopes/env-1?include=recipients%2Ccustom_fields')
  })

  it('JWT Grant signs an RS256 assertion (iss = integration key, sub = user, aud = auth host) and mints a token', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
    const assertion = docusignJwtAssertion({ integrationKey: 'ik-1', userId: 'user-guid', privateKey: pem, authServer: 'https://account-d.docusign.com', nowSec: 1_800_000_000 })
    const [h, p, s] = assertion.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iss: 'ik-1', sub: 'user-guid', aud: 'account-d.docusign.com', iat: 1_800_000_000, exp: 1_800_003_600, scope: 'signature impersonation' })
    expect(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true)

    const { requests } = await run('get_status', { envelope_id: 'env-1' }, {
      credentials: { auth_method: 'jwt', client_id: 'ik-1', user_id: 'user-guid', private_key: pem, access_token: '' },
      respond: (r) => (r.url.endsWith('/oauth/token') ? json({ access_token: 'jwt-minted', expires_in: 3600 }) : respond(r)),
    })
    const token = requests.find((r) => r.url === 'https://account-d.docusign.com/oauth/token')!
    expect(token.body).toMatch(/^grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=ey/)
    expect(requests.at(-1)!.headers.authorization).toBe('Bearer ***')
  })

  it('consent_required is explained', async () => {
    const { result } = await run('get_status', { envelope_id: 'env-1' }, {
      credentials: { auth_method: 'jwt', client_id: 'ik-1', user_id: 'u', private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString() },
      respond: (r) => (r.url.endsWith('/oauth/token') ? json({ error: 'consent_required' }, 400) : respond(r)),
    })
    expect(result.status).toBe(400)
    expect(result.error_message).toMatch(/consent/)
  })

  it('maps provider errors (401 → unauthorized, 400 with errorCode) without leaking credentials', async () => {
    const { result } = await run('get_status', { envelope_id: 'env-1' }, { respond: (r) => r.url.endsWith('userinfo') ? respond(r) : json({ errorCode: 'ENVELOPE_DOES_NOT_EXIST', message: 'The envelope ID specified does not exist.' }, 400) })
    expect(result.status).toBe(400)
    expect(result.data).toMatchObject({ code: 'validation', retryable: false })
    expect(result.error_message).toBe('DocuSign: The envelope ID specified does not exist.')
    const unauthorized = await run('get_status', { envelope_id: 'env-1' }, { respond: (r) => r.url.endsWith('userinfo') ? respond(r) : json({ errorCode: 'USER_AUTHENTICATION_FAILED', message: 'One or both of Username and Password are invalid.' }, 401) })
    expect(unauthorized.result.data.code).toBe('unauthorized')
    expect(JSON.stringify(unauthorized.result)).not.toContain('ds-access-token')
  })

  it('retries 429 with Retry-After, then succeeds', async () => {
    let n = 0
    const { requests, result } = await run('get_status', { envelope_id: 'env-1' }, {
      respond: (r) => {
        if (r.url.endsWith('userinfo')) return respond(r)
        n++
        return n === 1 ? json({ errorCode: 'HOURLY_APIINVOCATION_LIMIT_EXCEEDED', message: 'limit' }, 429, { 'retry-after': '0' }) : respond(r)
      },
    })
    expect(providerCalls(requests, '/envelopes/env-1').length).toBe(2)
    expect(result.status).toBe(200)
  })

  it('preflight: JWT needs key, user and private key; auth code needs a token', () => {
    expect(runConnectorPreflight('docusign', {}, { auth_method: 'jwt', client_id: 'ik' })?.message).toMatch(/user_id, private_key/)
    expect(runConnectorPreflight('docusign', {}, { auth_method: 'authorization_code' })?.message).toMatch(/access token/)
    expect(runConnectorPreflight('docusign', {}, { auth_method: 'authorization_code', access_token: 't' })).toBeNull()
  })
})

/* ── Idempotency (shared) ─────────────────────────────────────────── */

describe('idempotent send (client reference ledger)', () => {
  const DS = 'https://demo.docusign.net/restapi/v2.1/accounts/acct-1'
  const run = (inputs: Record<string, unknown>, respond?: (r: RecordedRequest) => Response) => runConnectorTemplate({
    connector: 'docusign', template: 'send_documents',
    config: { base_url: 'https://demo.docusign.net/restapi', account_id: 'acct-1', api_base_url: '' }, credentials: { access_token: 't', auth_method: 'authorization_code', client_id: '', refresh_token: '', webhook_secret: '' },
    inputs: { documents: [DOC], recipients: RECIPIENTS.slice(0, 1), subject: 'S', ...inputs },
    respond: respond ?? (() => json({ envelopeId: 'env-9', status: 'sent' }, 201)),
  })

  it('a retry with the same client reference returns the first envelope and sends nothing', async () => {
    const first = await run({ client_reference: 'order-42' })
    expect(first.result.data).toMatchObject({ envelope_id: 'env-9', replayed: false, client_reference: 'order-42' })
    const second = await run({ client_reference: 'order-42' })
    expect(second.requests).toHaveLength(0)
    expect(second.result.status).toBe(200)
    expect(second.result.data).toMatchObject({ envelope_id: 'env-9', replayed: true })
  })

  it('the default reference is derived from the request (same request → same reference)', async () => {
    const a = await run({})
    const b = await run({})
    expect(a.result.data.client_reference).toMatch(/^ut-[0-9a-f]{32}$/)
    expect(b.result.data).toMatchObject({ client_reference: a.result.data.client_reference, replayed: true })
    const c = await run({ subject: 'Different' })
    expect(c.result.data.client_reference).not.toBe(a.result.data.client_reference)
  })

  it('a send in progress is a conflict; a failed send may be retried', async () => {
    db.tables.esign_envelopes = [{ tenant_id: TEST_TENANT, integration_id: 'int-1', client_reference: 'busy', status: 'sending', updated_at: new Date().toISOString() }]
    const busy = await run({ client_reference: 'busy' })
    expect(busy.result.status).toBe(409)
    expect(busy.requests).toHaveLength(0)
    const failed = await run({ client_reference: 'boom' }, () => json({ errorCode: 'INVALID_EMAIL_ADDRESS_FOR_RECIPIENT', message: 'bad email' }, 400))
    expect(failed.result.status).toBe(400)
    expect(db.tables.esign_envelopes.find((r) => r.client_reference === 'boom')).toMatchObject({ status: 'failed', error: expect.stringContaining('bad email') })
    const retried = await run({ client_reference: 'boom' })
    expect(retried.result.data).toMatchObject({ envelope_id: 'env-9', replayed: false })
    expect(retried.call.url).toBe(`${DS}/envelopes`)
  })

  it('rejects bad recipients before calling the provider', async () => {
    const bad = await run({ recipients: [{ name: 'X', email: 'not-an-email' }] })
    expect(bad.result.status).toBe(400)
    expect(bad.result.error_message).toMatch(/valid email/)
    expect(bad.requests).toHaveLength(0)
    const onlyCc = await run({ recipients: [{ name: 'X', email: 'x@example.com', kind: 'cc' }] })
    expect(onlyCc.result.error_message).toMatch(/at least one signer/i)
  })
})

/* ── Adobe Acrobat Sign ────────────────────────────────────────────── */

describe('Adobe Acrobat Sign', () => {
  const AS = 'https://api.na2.adobesign.com/api/rest/v6'
  const respond = (req: RecordedRequest): Response => {
    if (req.url === 'https://api.na1.adobesign.com/api/rest/v6/baseUris') return json({ apiAccessPoint: 'https://api.na2.adobesign.com/', webAccessPoint: 'https://secure.na2.adobesign.com/' })
    if (req.url === `${AS}/transientDocuments`) return json({ transientDocumentId: 'tr-1' }, 201)
    if (req.method === 'POST' && req.url === `${AS}/agreements`) return json({ id: 'agr-1' }, 201)
    if (req.url === `${AS}/agreements/agr-1`) return json({ id: 'agr-1', name: 'NDA', status: 'SIGNED', createdDate: '2026-11-01T10:00:00Z', externalId: { id: 'ref-1' } })
    if (req.url === `${AS}/agreements/agr-1/members`) return json({ participantSets: [{ id: 'ps1', order: 1, role: 'SIGNER', status: 'COMPLETED', memberInfos: [{ id: 'm1', email: 'ada@example.com', name: 'Ada Lovelace' }] }], ccsInfo: [{ email: 'legal@example.com' }] })
    if (req.url === `${AS}/agreements/agr-1/signingUrls`) return json({ signingUrlSetInfos: [{ signingUrls: [{ email: 'ada@example.com', esignUrl: 'https://secure.na2.adobesign.com/public/apiesign?pid=x' }] }] })
    if (req.url.includes('/combinedDocument') || req.url.includes('/auditTrail')) return pdfResponse()
    if (req.url.startsWith(`${AS}/libraryDocuments`)) return json({ libraryDocumentList: [{ id: 'lib-1', name: 'NDA template', templateTypes: ['DOCUMENT'] }, { id: 'lib-2', name: 'Layer', templateTypes: ['FORM_FIELD_LAYER'] }], page: { nextCursor: 'c2' } })
    if (req.method === 'PUT') return new Response(null, { status: 204 })
    return json({ code: 'INVALID_AGREEMENT_ID', message: 'The Agreement ID specified is invalid.' }, 404)
  }
  const run = (template: string, inputs: Record<string, unknown>, extra: { respond?: typeof respond; credentials?: Record<string, unknown> } = {}) => runConnectorTemplate({
    connector: 'adobe_sign', template, config: { shard: 'na1', api_base_url: '' }, credentials: { access_token: 'integration-key', client_id: 'cid', client_secret: '', refresh_token: '', webhook_secret: '', ...(extra.credentials ?? {}) },
    inputs, respond: extra.respond ?? respond,
  })

  it('discovers the API access point, uploads transient documents and creates the agreement', async () => {
    const { requests, call, result } = await run('send_documents', { documents: [DOC, { ...DOC, name: 'annex.pdf' }], recipients: RECIPIENTS, subject: 'NDA', message: 'Hi', reminder_days: 1, expires_in_days: 10 })
    expect(requests[0].url).toBe('https://api.na1.adobesign.com/api/rest/v6/baseUris')
    const uploads = requests.filter((r) => r.url === `${AS}/transientDocuments`)
    expect(uploads).toHaveLength(2)
    expect(uploads[0].body).toBe('<FormData File-Name,Mime-Type,File>')
    expect(call.url).toBe(`${AS}/agreements`)
    const body = bodyOf(call)
    expect(body).toMatchObject({
      name: 'NDA', message: 'Hi', signatureType: 'ESIGN', state: 'IN_PROCESS', reminderFrequency: 'DAILY_UNTIL_SIGNED',
      fileInfos: [{ transientDocumentId: 'tr-1' }, { transientDocumentId: 'tr-1' }],
      participantSetsInfo: [
        { memberInfos: [{ email: 'ada@example.com', name: 'Ada Lovelace' }], order: 1, role: 'SIGNER', label: 'Client' },
        { memberInfos: [{ email: 'grace@example.com' }], order: 2, role: 'SIGNER', label: 'Manager' },
      ],
      ccs: [{ email: 'legal@example.com' }],
    })
    expect(body.externalId.id).toMatch(/^ut-/)
    expect(Date.parse(body.expirationTime)).toBeGreaterThan(Date.now() + 9 * 86_400_000)
    expect(result.data).toMatchObject({ provider: 'adobe_sign', envelope_id: 'agr-1', status: 'sent' })
  })

  it('templates: libraryDocumentId with merge fields', async () => {
    const { call } = await run('send_template', { template_id: 'lib-1', recipients: RECIPIENTS.slice(0, 1), subject: 'NDA', prefill: { Company: 'Northwind' } })
    expect(bodyOf(call)).toMatchObject({ fileInfos: [{ libraryDocumentId: 'lib-1' }], mergeFieldInfo: [{ fieldName: 'Company', defaultValue: 'Northwind' }] })
  })

  it('status from the agreement + members; SIGNED → completed', async () => {
    const { result } = await run('get_status', { envelope_id: 'agr-1' })
    expect(result.data).toMatchObject({ status: 'completed', provider_status: 'SIGNED', client_reference: 'ref-1', signed_count: 1 })
    expect(result.data.recipients[0]).toMatchObject({ email: 'ada@example.com', status: 'signed' })
  })

  it('a rejected participant makes the agreement declined', async () => {
    const { result } = await run('get_status', { envelope_id: 'agr-1' }, { respond: (r) => r.url.endsWith('/members') ? json({ participantSets: [{ order: 1, role: 'SIGNER', status: 'REJECTED', memberInfos: [{ email: 'ada@example.com' }] }] }) : r.url.endsWith('/agreements/agr-1') ? json({ id: 'agr-1', status: 'CANCELLED' }) : respond(r) })
    expect(result.data.status).toBe('declined')
  })

  it('downloads the combined document and audit trail; cancels; signing URL; library templates', async () => {
    const dl = await run('download_signed', { envelope_id: 'agr-1', document: 'both' })
    expect(dl.requests.filter((r) => r.url.includes('agr-1/')).map((r) => r.url)).toEqual([`${AS}/agreements/agr-1/combinedDocument`, `${AS}/agreements/agr-1/auditTrail`])
    const cancel = await run('cancel_envelope', { envelope_id: 'agr-1', reason: 'Wrong file' })
    expect(cancel.call).toMatchObject({ method: 'PUT', url: `${AS}/agreements/agr-1/state` })
    expect(bodyOf(cancel.call)).toEqual({ state: 'CANCELLED', agreementCancellationInfo: { comment: 'Wrong file', notifyOthers: true } })
    const link = await run('signing_url', { envelope_id: 'agr-1', recipient_email: 'ada@example.com' })
    expect(link.result.data.url).toContain('apiesign')
    const list = await run('search_templates', { search: 'nda' })
    expect(list.call.url).toBe(`${AS}/libraryDocuments?pageSize=25`)
    expect(list.result.data).toEqual({ templates: [{ id: 'lib-1', name: 'NDA template', description: null, roles: [], updated_at: null }], next_cursor: 'c2' })
  })

  it('refresh tokens are exchanged at the shard\'s /oauth/v2/refresh endpoint', async () => {
    const { requests } = await run('get_status', { envelope_id: 'agr-1' }, {
      credentials: { access_token: '', refresh_token: 'rt', client_secret: 'cs' },
      respond: (r) => (r.url.endsWith('/oauth/v2/refresh') ? json({ access_token: 'new', expires_in: 3600 }) : respond(r)),
    })
    expect(requests[0].url).toBe('https://api.na1.adobesign.com/oauth/v2/refresh')
    expect(requests[0].body).toContain('grant_type=refresh_token')
  })

  it('maps 404 with the provider code', async () => {
    const { result } = await run('get_status', { envelope_id: 'nope' })
    expect(result.status).toBe(404)
    expect(result.error_message).toBe('Acrobat Sign: The Agreement ID specified is invalid.')
  })
})

/* ── Dropbox Sign ──────────────────────────────────────────────────── */

describe('Dropbox Sign', () => {
  const HS = 'https://api.hellosign.com/v3'
  const request = {
    signature_request_id: 'sr-1', title: 'NDA', subject: 'NDA', is_complete: false, is_declined: false, has_error: false, created_at: 1_793_000_000, metadata: { usertasks_client_reference: 'ref-1' },
    signatures: [
      { signature_id: 'sig-1', signer_email_address: 'ada@example.com', signer_name: 'Ada Lovelace', order: 0, status_code: 'signed', signed_at: 1_793_000_100 },
      { signature_id: 'sig-2', signer_email_address: 'grace@example.com', signer_name: 'Grace Hopper', order: 1, status_code: 'awaiting_signature' },
    ],
  }
  const respond = (req: RecordedRequest): Response => {
    if (req.method === 'POST' && /signature_request\/(send|create_embedded|send_with_template)/.test(req.url)) return json({ signature_request: request })
    if (req.url === `${HS}/signature_request/sr-1`) return json({ signature_request: request })
    if (req.url.startsWith(`${HS}/signature_request/files/sr-1`)) return pdfResponse()
    if (req.url === `${HS}/embedded/sign_url/sig-2`) return json({ embedded: { sign_url: 'https://app.hellosign.com/editor/embeddedSign?signature_id=sig-2&token=x', expires_at: 1_793_000_500 } })
    if (req.url.startsWith(`${HS}/template/list`)) return json({ templates: [{ template_id: 't1', title: 'NDA', signer_roles: [{ name: 'Client' }] }], list_info: { page: 1, num_pages: 2, num_results: 30, page_size: 20 } })
    if (req.url === `${HS}/signature_request/cancel/sr-1`) return new Response(null, { status: 200 })
    return json({ error: { error_msg: 'Not found', error_name: 'not_found' } }, 404)
  }
  const run = (template: string, inputs: Record<string, unknown>, extra: { respond?: typeof respond; config?: Record<string, unknown>; credentials?: Record<string, unknown> } = {}) => runConnectorTemplate({
    connector: 'dropbox_sign', template, config: { test_mode: 'true', api_base_url: '', ...(extra.config ?? {}) }, credentials: { auth_method: 'api_key', api_key: 'hs-api-key', client_id: 'app-client', ...(extra.credentials ?? {}) },
    inputs, respond: extra.respond ?? respond,
  })

  it('sends multipart with files, signers, text tags, test_mode and metadata; API key as Basic', async () => {
    const { call, result } = await run('send_documents', { documents: [DOC], recipients: RECIPIENTS, subject: 'NDA', message: 'Hi', expires_in_days: 5 })
    expect(call).toMatchObject({ method: 'POST', url: `${HS}/signature_request/send` })
    expect(call.headers.authorization).toBe('Basic ***')
    expect(call.body).toMatch(/^<FormData /)
    for (const key of ['title', 'subject', 'message', 'test_mode', 'metadata[usertasks_client_reference]', 'expires_at', 'files[0]', 'signers[0][name]', 'signers[0][email_address]', 'signers[1][order]', 'cc_email_addresses[0]', 'use_text_tags', 'hide_text_tags']) {
      expect(call.body).toContain(key)
    }
    expect(result.data).toMatchObject({ envelope_id: 'sr-1', status: 'delivered', signed_count: 1, client_reference: expect.stringMatching(/^ut-/) })
  })

  it('embedded sends use create_embedded with the app client_id; templates use send_with_template with roles', async () => {
    const embedded = await run('send_documents', { documents: [DOC], recipients: RECIPIENTS.slice(0, 1), subject: 'NDA', embedded: true })
    expect(embedded.call.url).toBe(`${HS}/signature_request/create_embedded`)
    expect(embedded.call.body).toContain('client_id')
    const tpl = await run('send_template', { template_id: 't1', recipients: RECIPIENTS.slice(0, 1), subject: 'NDA', prefill: { Company: 'Northwind' } })
    expect(tpl.call.url).toBe(`${HS}/signature_request/send_with_template`)
    expect(tpl.call.body).toContain('template_ids[0]')
    expect(tpl.call.body).toContain('signers[Client][email_address]')
    expect(tpl.call.body).toContain('custom_fields')
  })

  it('status, files, cancel, embedded sign URL and paged templates', async () => {
    const status = await run('get_status', { envelope_id: 'sr-1' })
    expect(status.result.data.recipients.map((r: any) => r.status)).toEqual(['signed', 'sent'])
    const files = await run('download_signed', { envelope_id: 'sr-1' })
    expect(files.call.url).toBe(`${HS}/signature_request/files/sr-1?file_type=pdf`)
    const both = await run('download_signed', { envelope_id: 'sr-1', document: 'both' })
    expect(both.result.data.warnings?.[0]).toMatch(/audit trail/)
    const cert = await run('download_signed', { envelope_id: 'sr-1', document: 'certificate' })
    expect(cert.result.status).toBe(400)
    const cancel = await run('cancel_envelope', { envelope_id: 'sr-1', reason: 'x' })
    expect(cancel.call).toMatchObject({ method: 'POST', url: `${HS}/signature_request/cancel/sr-1` })
    const link = await run('signing_url', { envelope_id: 'sr-1', recipient_email: 'grace@example.com' })
    expect(link.result.data.url).toContain('embeddedSign')
    const list = await run('search_templates', { search: 'nda', page_size: 20 })
    expect(list.call.url).toBe(`${HS}/template/list?page=1&page_size=20&query=nda`)
    expect(list.result.data.next_cursor).toBe('2')
  })

  it('a cancelled request (410) reads as voided; errors use error_msg', async () => {
    const gone = await run('get_status', { envelope_id: 'sr-1' }, { respond: () => json({ error: { error_msg: 'Gone' } }, 410) })
    expect(gone.result.data.status).toBe('voided')
    const missing = await run('get_status', { envelope_id: 'nope' })
    expect(missing.result.error_message).toBe('Dropbox Sign: Not found')
  })

  it('OAuth tokens refresh at app.hellosign.com', async () => {
    const { requests } = await run('get_status', { envelope_id: 'sr-1' }, {
      credentials: { auth_method: 'oauth', access_token: '', refresh_token: 'rt', client_id: 'cid', client_secret: 'cs' },
      respond: (r) => (r.url.includes('/oauth/token') ? json({ access_token: 'new', expires_in: 86400 }) : respond(r)),
    })
    expect(requests[0].url).toBe('https://app.hellosign.com/oauth/token')
    expect(requests[1].headers.authorization).toBe('Bearer ***')
  })
})

/* ── PandaDoc ──────────────────────────────────────────────────────── */

describe('PandaDoc', () => {
  const PD = 'https://api.pandadoc.com/public/v1'
  const respond = (req: RecordedRequest): Response => {
    if (req.method === 'POST' && req.url === `${PD}/documents`) return json({ id: 'doc-1', status: 'document.uploaded' }, 201)
    if (req.url === `${PD}/documents/doc-1`) return json({ id: 'doc-1', status: 'document.draft' })
    if (req.url === `${PD}/documents/doc-1/send`) return json({ id: 'doc-1', status: 'document.sent' })
    if (req.url === `${PD}/documents/doc-1/details`) return json({ id: 'doc-1', name: 'NDA', status: 'document.completed', date_completed: '2026-11-02T00:00:00Z', metadata: { usertasks_client_reference: 'r' }, recipients: [{ id: 'r1', email: 'ada@example.com', first_name: 'Ada', last_name: 'Lovelace', role: 'Client', signing_order: 1, has_completed: true }] })
    if (req.url === `${PD}/documents/doc-1/download`) return pdfResponse()
    if (req.url === `${PD}/documents/doc-1/session`) return json({ id: 'sess-1', expires_at: '2026-11-02T01:00:00Z' }, 201)
    if (req.url === `${PD}/documents/doc-1/status`) return new Response(null, { status: 204 })
    if (req.url.startsWith(`${PD}/templates`)) return json({ results: [{ id: 'tpl-1', name: 'NDA' }] })
    return json({ type: 'request_error', detail: 'Not found.' }, 404)
  }
  const run = (template: string, inputs: Record<string, unknown>, extra: { respond?: typeof respond } = {}) => runConnectorTemplate({
    connector: 'pandadoc', template, config: { api_base_url: '' }, credentials: { auth_method: 'api_key', api_key: 'pd-key' }, inputs, respond: extra.respond ?? respond,
  })

  it('creates from a file (merging PDFs), waits for draft, then sends; API-Key auth scheme', async () => {
    const { requests, result } = await run('send_documents', { documents: [DOC], recipients: RECIPIENTS.slice(0, 2), subject: 'NDA', message: 'Hi' })
    expect(requests.map((r) => `${r.method} ${r.url.replace(PD, '')}`)).toEqual(['POST /documents', 'GET /documents/doc-1', 'POST /documents/doc-1/send'])
    expect(requests[0].headers.authorization).toBe('***')
    expect(requests[0].body).toBe('<FormData file,data>')
    expect(bodyOf(requests[2])).toEqual({ subject: 'NDA', message: 'Hi', silent: false })
    expect(result.data).toMatchObject({ envelope_id: 'doc-1', status: 'sent' })
  })

  it('the API key is sent as "API-Key <key>" (not Bearer)', async () => {
    const def = getConnectorDefinition('pandadoc')!
    expect(def.buildIntegrationConfig({}, { api_key: 'abc' }).auth_config).toMatchObject({ key_name: 'Authorization', key_value: 'API-Key abc' })
    const { applyAuthHeaders } = await import('@/lib/integrations/attach-auth')
    const headers: Record<string, string> = {}
    await applyAuthHeaders(def.buildIntegrationConfig({}, { api_key: 'abc' }), headers)
    expect(headers.Authorization).toBe('API-Key abc')
  })

  it('templates with tokens; status; download; void (status 11); session link; templates paging', async () => {
    const tpl = await run('send_template', { template_id: 'tpl-1', recipients: RECIPIENTS.slice(0, 1), subject: 'NDA', prefill: { 'Client.Company': 'Northwind' } })
    expect(bodyOf(tpl.requests[0])).toMatchObject({ template_uuid: 'tpl-1', tokens: [{ name: 'Client.Company', value: 'Northwind' }], recipients: [{ email: 'ada@example.com', first_name: 'Ada', last_name: 'Lovelace', role: 'Client', signing_order: 1 }] })
    const status = await run('get_status', { envelope_id: 'doc-1' })
    expect(status.result.data).toMatchObject({ status: 'completed', signed_count: 1, completed_at: '2026-11-02T00:00:00.000Z' })
    const dl = await run('download_signed', { envelope_id: 'doc-1' })
    expect(dl.call.url).toBe(`${PD}/documents/doc-1/download`)
    const cancel = await run('cancel_envelope', { envelope_id: 'doc-1', reason: 'Withdrawn' })
    expect(cancel.call.method).toBe('PATCH')
    expect(bodyOf(cancel.call)).toEqual({ status: 11, note: 'Withdrawn', notify_recipients: true })
    const link = await run('signing_url', { envelope_id: 'doc-1', recipient_email: 'ada@example.com' })
    expect(bodyOf(link.call)).toEqual({ recipient: 'ada@example.com', lifetime: 3600 })
    expect(link.result.data.url).toBe('https://app.pandadoc.com/s/sess-1')
    const list = await run('search_templates', { search: 'nda', page_size: 1 })
    expect(list.call.url).toBe(`${PD}/templates?q=nda&count=1&page=1`)
    expect(list.result.data.next_cursor).toBe('2')
  })

  it('several non-PDF files are refused (one file per document)', async () => {
    const { result } = await run('send_documents', { documents: [{ base64: 'aGVsbG8=', name: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, { base64: 'aGVsbG8=', name: 'b.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }], recipients: RECIPIENTS.slice(0, 1), subject: 'x' })
    expect(result.status).toBe(400)
    expect(result.error_message).toMatch(/one document per envelope/)
  })
})

/* ── SignNow ───────────────────────────────────────────────────────── */

describe('SignNow', () => {
  const SN = 'https://api-eval.signnow.com'
  const doc = { id: 'd1', document_name: 'NDA', roles: [{ unique_id: 'role-b', name: 'Manager', signing_order: 2 }, { unique_id: 'role-a', name: 'Client', signing_order: 1 }], field_invites: [{ id: 'fi-1', email: 'ada@example.com', role: 'Client', role_id: 'role-a', status: 'fulfilled', updated: 1_793_000_000 }, { id: 'fi-2', email: 'grace@example.com', role: 'Manager', status: 'pending' }] }
  const respond = (req: RecordedRequest): Response => {
    if (req.url === `${SN}/oauth2/token`) return json({ access_token: 'sn-token', expires_in: 2592000 })
    if (req.url === `${SN}/document/fieldextract` || req.url === `${SN}/document`) return json({ id: 'd1' })
    if (req.url === `${SN}/document/d1`) return json(doc)
    if (req.url === `${SN}/document/d1/invite`) return json({ status: 'success' })
    if (req.url === `${SN}/template/tpl-1/copy`) return json({ id: 'd1' })
    if (req.url === `${SN}/document/d1/prefill-texts`) return new Response(null, { status: 204 })
    if (req.url.startsWith(`${SN}/document/d1/download`)) return pdfResponse()
    if (req.url === `${SN}/document/d1/fieldinvitecancel`) return json({ status: 'success' })
    if (req.url === `${SN}/v2/documents/d1/embedded-invites/fi-2/link`) return json({ data: { link: 'https://app-eval.signnow.com/webapp/document/d1?embedded=1' } })
    if (req.url === `${SN}/user/documentsv2`) return json([{ id: 't1', document_name: 'NDA template', template: true }, { id: 'x', document_name: 'Regular', template: false }])
    if (req.url === `${SN}/user`) return json({ primary_email: 'sender@example.com' })
    return json({ errors: [{ code: 65582, message: 'Document not found' }] }, 404)
  }
  const run = (template: string, inputs: Record<string, unknown>, extra: { respond?: typeof respond; config?: Record<string, unknown> } = {}) => runConnectorTemplate({
    connector: 'signnow', template, config: { environment: 'sandbox', sender_email: '', api_base_url: '', ...(extra.config ?? {}) },
    credentials: { auth_method: 'password', client_id: 'cid', client_secret: 'csecret', username: 'svc@example.com', password: 'pw' },
    inputs, respond: extra.respond ?? respond,
  })

  it('password grant with Basic client auth, text tags → field extract, field invite per role', async () => {
    const { requests, call } = await run('send_documents', { documents: [DOC], recipients: RECIPIENTS, subject: 'NDA', reminder_days: 3, expires_in_days: 20 })
    const token = requests[0]
    expect(token.url).toBe(`${SN}/oauth2/token`)
    expect(token.headers.authorization).toBe('Basic ***')
    expect(token.body).toBe('grant_type=password&username=svc%40example.com&password=pw&scope=*')
    expect(requests.map((r) => `${r.method} ${r.url.replace(SN, '')}`).slice(1)).toEqual(['POST /document/fieldextract', 'GET /document/d1', 'GET /user', 'POST /document/d1/invite'])
    expect(call.headers.authorization).toBe('Bearer ***')
    const body = bodyOf(call)
    expect(body.from).toBe('sender@example.com')
    expect(body.cc).toEqual(['legal@example.com'])
    expect(body.to).toEqual([
      expect.objectContaining({ email: 'ada@example.com', role_id: 'role-a', role: 'Client', order: 1, reminder: 3, expiration_days: 20 }),
      expect.objectContaining({ email: 'grace@example.com', role_id: 'role-b', role: 'Manager', order: 2 }),
    ])
  })

  it('templates are copied, prefilled and invited; status from field invites; downloads; cancel; embedded link; templates', async () => {
    const tpl = await run('send_template', { template_id: 'tpl-1', recipients: RECIPIENTS.slice(0, 2), subject: 'NDA', prefill: { Company: 'Northwind' } })
    expect(tpl.requests.map((r) => r.url.replace(SN, '')).slice(1, 4)).toEqual(['/template/tpl-1/copy', '/document/d1/prefill-texts', '/document/d1'])
    const status = await run('get_status', { envelope_id: 'd1' })
    expect(status.result.data).toMatchObject({ status: 'delivered', signed_count: 1, signer_count: 2 })
    const dl = await run('download_signed', { envelope_id: 'd1', document: 'both' })
    expect(dl.requests.filter((r) => r.url.includes('/download')).map((r) => r.url)).toEqual([`${SN}/document/d1/download?type=collapsed`, `${SN}/document/d1/download?type=collapsed&with_history=1`])
    const cancel = await run('cancel_envelope', { envelope_id: 'd1', reason: 'Stop' })
    expect(cancel.call).toMatchObject({ method: 'PUT', url: `${SN}/document/d1/fieldinvitecancel` })
    const link = await run('signing_url', { envelope_id: 'd1', recipient_email: 'grace@example.com' })
    expect(bodyOf(link.call)).toEqual({ auth_method: 'none', link_expiration: 45 })
    const list = await run('search_templates', { search: 'nda' })
    expect(list.result.data.templates).toEqual([{ id: 't1', name: 'NDA template', description: null, roles: [], updated_at: null }])
  })

  it('without roles only one signer can be invited (free-form)', async () => {
    const noRoles = (r: RecordedRequest) => (r.url === `${SN}/document/d1` ? json({ id: 'd1', roles: [] }) : respond(r))
    const { result } = await run('send_documents', { documents: [DOC], recipients: RECIPIENTS.slice(0, 2), subject: 'NDA' }, { respond: noRoles })
    expect(result.status).toBe(400)
    expect(result.error_message).toMatch(/text tags/)
    const one = await run('send_documents', { documents: [DOC], recipients: RECIPIENTS.slice(0, 1), subject: 'NDA' }, { respond: noRoles })
    expect(bodyOf(one.call)).toMatchObject({ to: 'ada@example.com', from: 'sender@example.com' })
  })

  it('errors[] messages are surfaced', async () => {
    const { result } = await run('get_status', { envelope_id: 'nope' })
    expect(result.error_message).toBe('SignNow: Document not found')
  })
})

/* ── BoldSign ──────────────────────────────────────────────────────── */

describe('BoldSign', () => {
  const BS = 'https://api-eu.boldsign.com/v1'
  const respond = (req: RecordedRequest): Response => {
    if (req.url === `${BS}/document/send` || req.url.startsWith(`${BS}/template/send`)) return json({ documentId: 'bd-1' }, 201)
    if (req.url.startsWith(`${BS}/document/properties`)) return json({ documentId: 'bd-1', messageTitle: 'NDA', status: 'Completed', signerDetails: [{ signerName: 'Ada', signerEmail: 'ada@example.com', status: 'Completed', order: 1, lastActivityDate: 1_793_000_000 }] })
    if (req.url.includes('/document/download')) return pdfResponse()
    if (req.url.startsWith(`${BS}/document/revoke`)) return new Response(null, { status: 204 })
    if (req.url.startsWith(`${BS}/document/getEmbeddedSignLink`)) return json({ signLink: 'https://app.boldsign.com/document/sign/?documentId=bd-1' })
    if (req.url.startsWith(`${BS}/template/list`)) return json({ result: [{ documentId: 'bt-1', messageTitle: 'NDA', roles: [{ name: 'Client' }] }], pageDetails: { page: 1, totalPages: 1, totalRecordsCount: 1 } })
    return json({ error: 'Invalid documentId' }, 400)
  }
  const run = (template: string, inputs: Record<string, unknown>) => runConnectorTemplate({ connector: 'boldsign', template, config: { region: 'eu', api_base_url: '' }, credentials: { api_key: 'bs-key' }, inputs, respond })

  it('sends JSON with data-URI files, signers, reminders, expiry and metadata; X-API-KEY', async () => {
    const { call, result } = await run('send_documents', { documents: [DOC], recipients: RECIPIENTS, subject: 'NDA', reminder_days: 2, expires_in_days: 7 })
    expect(call.url).toBe(`${BS}/document/send`)
    expect(call.headers['x-api-key']).toBe('***')
    const body = bodyOf(call)
    expect(body.Files).toEqual([`data:application/pdf;base64,${PDF.toString('base64')}`])
    expect(body).toMatchObject({ Title: 'NDA', ExpiryDays: 7, UseTextTags: true, EnableSigningOrder: true, ReminderSettings: { EnableAutoReminder: true, ReminderDays: 2 }, CC: [{ EmailAddress: 'legal@example.com' }], Signers: [{ Name: 'Ada Lovelace', EmailAddress: 'ada@example.com', SignerOrder: 1, SignerType: 'Signer' }, { Name: 'Grace Hopper', SignerOrder: 2 }] })
    expect(result.data.envelope_id).toBe('bd-1')
  })

  it('template send, status, downloads, revoke, embedded link, templates', async () => {
    const tpl = await run('send_template', { template_id: 'bt-1', recipients: RECIPIENTS.slice(0, 1), subject: 'NDA', prefill: { company: 'Northwind' } })
    expect(tpl.call.url).toBe(`${BS}/template/send?templateId=bt-1`)
    expect(bodyOf(tpl.call).Roles[0]).toMatchObject({ RoleIndex: 1, SignerRole: 'Client', SignerEmail: 'ada@example.com', ExistingFormFields: [{ Id: 'company', Value: 'Northwind' }] })
    expect((await run('get_status', { envelope_id: 'bd-1' })).result.data).toMatchObject({ status: 'completed', signed_count: 1 })
    const dl = await run('download_signed', { envelope_id: 'bd-1', document: 'both' })
    expect(dl.requests.map((r) => r.url)).toEqual([`${BS}/document/download?documentId=bd-1`, `${BS}/document/downloadAuditLog?documentId=bd-1`])
    const revoke = await run('cancel_envelope', { envelope_id: 'bd-1', reason: 'No' })
    expect(revoke.call.url).toBe(`${BS}/document/revoke?documentId=bd-1`)
    expect((await run('signing_url', { envelope_id: 'bd-1', recipient_email: 'ada@example.com' })).result.data.url).toContain('boldsign')
    expect((await run('search_templates', { search: 'nda' })).result.data.templates[0]).toMatchObject({ id: 'bt-1', roles: ['Client'] })
  })
})

/* ── Catalogue ─────────────────────────────────────────────────────── */

describe('e-sign connector catalogue', () => {
  it('every provider is a connector with the same seven actions', () => {
    for (const p of ESIGN_PROVIDERS) {
      const def = getConnectorDefinition(p.connectorKey)
      expect(def, p.id).toBeTruthy()
      expect(def!.referenceTemplates.map((t) => t.key)).toEqual(['send_documents', 'send_template', 'get_status', 'download_signed', 'cancel_envelope', 'signing_url', 'search_templates'])
      expect(def!.credentialFields.some((f) => f.key === 'webhook_secret' && f.type === 'password')).toBe(true)
      for (const t of def!.referenceTemplates) expect(t.pathTemplate.startsWith('/_internal/esign/')).toBe(true)
    }
  })

  it('no credential reaches template_vars (non-secret settings only)', async () => {
    const { connectorTemplateVars } = await import('@/lib/connectors/template-vars')
    const vars = connectorTemplateVars(getConnectorDefinition('signnow')!, { environment: 'sandbox' }, { client_id: 'cid', client_secret: 'S3CRET', password: 'PW', username: 'u', webhook_secret: 'WH' })
    expect(JSON.stringify(vars)).not.toMatch(/S3CRET|PW|WH/)
  })
})
