import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resumes = vi.hoisted(() => ({ calls: [] as Array<{ tenantId: string; eventId: string; variables: Record<string, any> }>, gone: new Set<string>() }))
vi.mock('@/lib/workflow-resume-queue', () => ({
  enqueueResume: async (p: { tenantId: string; eventId: string; variables: Record<string, any> }) => {
    if (resumes.gone.has(p.eventId)) {
      const { RunNotResumableError } = await import('@/lib/workflow-run-errors')
      throw new RunNotResumableError()
    }
    resumes.calls.push({ tenantId: p.tenantId, eventId: p.eventId, variables: p.variables })
    return { run_id: 'run-1', workflow_id: 'wf-1', job_id: 'job-1', resumed: 'queued' }
  },
}))
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: () => {} }))
vi.mock('@/lib/documents/store', async (orig) => ({
  ...(await orig() as object),
  storeDocumentFile: async (_c: unknown, tenantId: string, bytes: Uint8Array, name: string, mime: string) => ({ _file: true, id: 'f1', name, size: bytes.byteLength, mime_type: mime, url: `https://files.example/${tenantId}/${name}` }),
}))

import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { fakeDb, claimDueWaits, type FakeDb } from './helpers/esign-fake-db'
import { setEsignServiceDb, type LoadedEsign } from '@/lib/esign/service'
import { getEsignAdapter } from '@/lib/esign/providers'
import { WebhookAuthError, type WebhookRequest } from '@/lib/esign/adapter'
import { processEsignEvents, pollDueWaits, registerWait } from '@/lib/esign/waits'
import { invalidateEsignTriggerCache } from '@/lib/esign/triggers'
import { DROPBOX_SIGN_ACK } from '@/lib/esign/providers/dropbox-sign'
import { esignEdgeMatches, esignWebhookPath } from '@/lib/esign/catalog'
import type { EsignEnvelope } from '@/lib/esign/types'

/**
 * Webhook verification for every provider (valid / invalid / replayed /
 * stale), the waits that resume a paused run (webhook and polling paths,
 * timeouts, cancelled runs), triggers firing once, and the webhook route
 * resolving the tenant from the URL, never the payload.
 */

const SECRET = 'whsec-test-0123456789'
const NOW = Date.parse('2026-11-05T12:00:00Z')
const TENANT = '11111111-1111-4111-8111-111111111111'
const INTEGRATION = '22222222-2222-4222-8222-222222222222'

function req(body: string | Buffer, opts: { headers?: Record<string, string>; url?: string; method?: string } = {}): WebhookRequest {
  return { method: opts.method ?? 'POST', headers: new Headers(opts.headers ?? {}), rawBody: Buffer.isBuffer(body) ? body : Buffer.from(body), url: new URL(opts.url ?? 'https://app.example/api/webhooks/esign/x/y') }
}
const b64 = (data: string) => createHmac('sha256', SECRET).update(data).digest('base64')
const hex = (data: string, key = SECRET) => createHmac('sha256', key).update(data).digest('hex')

/* ── Signature verification per provider ───────────────────────────── */

describe('webhook verification', () => {
  const docusignBody = JSON.stringify({ event: 'envelope-completed', generatedDateTime: '2026-11-05T11:59:00Z', configurationId: '1001', data: { accountId: 'a', envelopeId: 'env-1' } })

  it('DocuSign Connect: HMAC-SHA256 base64 of the raw body (any of the rotating keys)', () => {
    const a = getEsignAdapter('docusign')
    const ok = a.verifyWebhook({ req: req(docusignBody, { headers: { 'x-docusign-signature-1': 'wrong', 'x-docusign-signature-2': b64(docusignBody) } }), secrets: { webhook_secret: SECRET }, now: NOW })
    expect(ok.events).toEqual([expect.objectContaining({ type: 'envelope_completed', envelope_id: 'env-1', provider_event: 'envelope-completed' })])
    expect(() => a.verifyWebhook({ req: req(docusignBody, { headers: { 'x-docusign-signature-1': b64(docusignBody + ' ') } }), secrets: { webhook_secret: SECRET }, now: NOW })).toThrow(WebhookAuthError)
    expect(() => a.verifyWebhook({ req: req(docusignBody), secrets: { webhook_secret: SECRET }, now: NOW })).toThrow(/Missing X-DocuSign-Signature-1/)
    expect(() => a.verifyWebhook({ req: req(docusignBody, { headers: { 'x-docusign-signature-1': b64(docusignBody) } }), secrets: {}, now: NOW })).toThrow(/not configured/)
    // A signed but stale delivery is refused.
    const old = JSON.stringify({ event: 'envelope-completed', generatedDateTime: '2026-10-01T00:00:00Z', data: { envelopeId: 'env-1' } })
    expect(() => a.verifyWebhook({ req: req(old, { headers: { 'x-docusign-signature-1': b64(old) } }), secrets: { webhook_secret: SECRET }, now: NOW })).toThrow(/too old/)
  })

  it('DocuSign: the same delivery always has the same dedupe key; recipient events carry the recipient', () => {
    const a = getEsignAdapter('docusign')
    const sign = (body: string) => ({ 'x-docusign-signature-1': b64(body) })
    const k1 = a.verifyWebhook({ req: req(docusignBody, { headers: sign(docusignBody) }), secrets: { webhook_secret: SECRET }, now: NOW }).events[0].dedupe_key
    const k2 = a.verifyWebhook({ req: req(docusignBody, { headers: sign(docusignBody) }), secrets: { webhook_secret: SECRET }, now: NOW }).events[0].dedupe_key
    expect(k1).toBe(k2)
    const recip = JSON.stringify({ event: 'recipient-completed', generatedDateTime: '2026-11-05T11:59:00Z', data: { envelopeId: 'env-1', recipientId: '2' } })
    expect(a.verifyWebhook({ req: req(recip, { headers: sign(recip) }), secrets: { webhook_secret: SECRET }, now: NOW }).events[0]).toMatchObject({ type: 'recipient_signed', recipient: { id: '2' } })
  })

  it('Adobe Acrobat Sign: verification GET echoes the client id; POSTs need the client id and the URL token', () => {
    const a = getEsignAdapter('adobe_sign')
    const url = `https://app.example/hook?token=${SECRET}`
    const handshake = a.verifyWebhook({ req: req('', { method: 'GET', url, headers: { 'x-adobesign-clientid': 'CID123' } }), secrets: { webhook_secret: SECRET, client_id: 'CID123' }, now: NOW })
    expect(handshake.events).toEqual([])
    expect(handshake.response).toEqual({ status: 200, headers: { 'X-AdobeSign-ClientId': 'CID123' }, json: { xAdobeSignClientId: 'CID123' } })
    const body = JSON.stringify({ webhookNotificationId: 'n-1', event: 'AGREEMENT_WORKFLOW_COMPLETED', eventDate: '2026-11-05T11:58:00Z', agreement: { id: 'agr-1', status: 'SIGNED' } })
    const ok = a.verifyWebhook({ req: req(body, { url, headers: { 'x-adobesign-clientid': 'CID123' } }), secrets: { webhook_secret: SECRET, client_id: 'CID123' }, now: NOW })
    expect(ok.events[0]).toMatchObject({ type: 'envelope_completed', envelope_id: 'agr-1' })
    expect(ok.response?.headers).toEqual({ 'X-AdobeSign-ClientId': 'CID123' })
    expect(() => a.verifyWebhook({ req: req(body, { url, headers: { 'x-adobesign-clientid': 'OTHER' } }), secrets: { webhook_secret: SECRET, client_id: 'CID123' }, now: NOW })).toThrow(/client ID/)
    expect(() => a.verifyWebhook({ req: req(body, { url: 'https://app.example/hook?token=nope', headers: { 'x-adobesign-clientid': 'CID123' } }), secrets: { webhook_secret: SECRET, client_id: 'CID123' }, now: NOW })).toThrow(/token/)
  })

  it('Dropbox Sign: event_hash = HMAC(API key, event_time + event_type); multipart json field; acknowledgement body', () => {
    const a = getEsignAdapter('dropbox_sign')
    const time = String(Math.floor(NOW / 1000) - 30)
    const payload = (hash: string, type = 'signature_request_downloadable') => JSON.stringify({ event: { event_time: time, event_type: type, event_hash: hash, event_metadata: { related_signature_id: 'sig-2' } }, signature_request: { signature_request_id: 'sr-1', signatures: [{ signature_id: 'sig-2', signer_email_address: 'grace@example.com', signer_name: 'Grace' }] } })
    const multipart = (json: string) => `--XyZ\r\nContent-Disposition: form-data; name="json"\r\n\r\n${json}\r\n--XyZ--\r\n`
    const valid = payload(hex(`${time}signature_request_downloadable`, 'hs-api-key'))
    const ok = a.verifyWebhook({ req: req(multipart(valid), { headers: { 'content-type': 'multipart/form-data; boundary=XyZ' } }), secrets: { api_key: 'hs-api-key' }, now: NOW })
    expect(ok.events[0]).toMatchObject({ type: 'envelope_completed', envelope_id: 'sr-1', recipient: { email: 'grace@example.com' } })
    expect(ok.response).toMatchObject({ status: 200, body: DROPBOX_SIGN_ACK })
    // urlencoded form too
    expect(a.verifyWebhook({ req: req(new URLSearchParams({ json: valid }).toString(), { headers: { 'content-type': 'application/x-www-form-urlencoded' } }), secrets: { api_key: 'hs-api-key' }, now: NOW }).events).toHaveLength(1)
    expect(() => a.verifyWebhook({ req: req(multipart(payload(hex(`${time}signature_request_downloadable`, 'other-key'))), { headers: { 'content-type': 'multipart/form-data; boundary=XyZ' } }), secrets: { api_key: 'hs-api-key' }, now: NOW })).toThrow(/hash mismatch/)
    // all_signed is acknowledged but not an event (the files are not ready yet)
    const allSigned = payload(hex(`${time}signature_request_all_signed`, 'hs-api-key'), 'signature_request_all_signed')
    expect(a.verifyWebhook({ req: req(allSigned, { headers: { 'content-type': 'application/json' } }), secrets: { api_key: 'hs-api-key' }, now: NOW }).events).toEqual([])
  })

  it('PandaDoc: ?signature= HMAC-SHA256 hex of the body; arrays of events', () => {
    const a = getEsignAdapter('pandadoc')
    const body = JSON.stringify([
      { event: 'document_state_changed', data: { id: 'doc-1', status: 'document.completed', date_modified: '2026-11-05T11:59:00Z' } },
      { event: 'recipient_completed', data: { id: 'doc-1', action_by: { email: 'ada@example.com', first_name: 'Ada' } } },
    ])
    const ok = a.verifyWebhook({ req: req(body, { url: `https://app.example/hook?signature=${hex(body)}` }), secrets: { webhook_secret: SECRET }, now: NOW })
    expect(ok.events.map((e) => e.type)).toEqual(['envelope_completed', 'recipient_signed'])
    expect(ok.events[0].dedupe_key).not.toBe(ok.events[1].dedupe_key)
    expect(() => a.verifyWebhook({ req: req(body, { url: `https://app.example/hook?signature=${hex(body + 'x')}` }), secrets: { webhook_secret: SECRET }, now: NOW })).toThrow(WebhookAuthError)
    expect(() => a.verifyWebhook({ req: req(body), secrets: { webhook_secret: SECRET }, now: NOW })).toThrow(/signature/)
  })

  it('SignNow: X-SignNow-Signature (base64 or hex HMAC of the body)', () => {
    const a = getEsignAdapter('signnow')
    const body = JSON.stringify({ meta: { timestamp: Math.floor(NOW / 1000) - 10, event: 'document.complete' }, content: { document_id: 'd1' } })
    expect(a.verifyWebhook({ req: req(body, { headers: { 'x-signnow-signature': b64(body) } }), secrets: { webhook_secret: SECRET }, now: NOW }).events[0]).toMatchObject({ type: 'envelope_completed', envelope_id: 'd1' })
    expect(a.verifyWebhook({ req: req(body, { headers: { 'x-signnow-signature': hex(body) } }), secrets: { webhook_secret: SECRET }, now: NOW }).events).toHaveLength(1)
    expect(() => a.verifyWebhook({ req: req(body, { headers: { 'x-signnow-signature': b64('{}') } }), secrets: { webhook_secret: SECRET }, now: NOW })).toThrow(WebhookAuthError)
  })

  it('BoldSign: t=…, s0=… over "t.body" within five minutes; verification event', () => {
    const a = getEsignAdapter('boldsign')
    const body = JSON.stringify({ event: { id: 'evt-1', eventType: 'Completed', created: Math.floor(NOW / 1000) }, data: { object: 'document', documentId: 'bd-1' } })
    const t = String(Math.floor(NOW / 1000) - 60)
    const header = (ts: string, b = body) => ({ 'x-boldsign-signature': `t=${ts}, s0=${hex(`${ts}.${b}`)}`, 'x-boldsign-event': 'Completed' })
    expect(a.verifyWebhook({ req: req(body, { headers: header(t) }), secrets: { webhook_secret: SECRET }, now: NOW }).events[0]).toMatchObject({ type: 'envelope_completed', envelope_id: 'bd-1' })
    const stale = String(Math.floor(NOW / 1000) - 600)
    expect(() => a.verifyWebhook({ req: req(body, { headers: header(stale) }), secrets: { webhook_secret: SECRET }, now: NOW })).toThrow(/tolerance/)
    expect(() => a.verifyWebhook({ req: req(body, { headers: { 'x-boldsign-signature': `t=${t}, s0=${'0'.repeat(64)}` } }), secrets: { webhook_secret: SECRET }, now: NOW })).toThrow(/mismatch/)
    expect(a.verifyWebhook({ req: req('{}', { headers: { ...header(t, '{}'), 'x-boldsign-event': 'Verification' } }), secrets: { webhook_secret: SECRET }, now: NOW }).events).toEqual([])
  })
})

/* ── Waits, events and triggers ────────────────────────────────────── */

function envelope(status: EsignEnvelope['status']): EsignEnvelope {
  return {
    provider: 'docusign', envelope_id: 'env-1', status, provider_status: status, subject: 'NDA', created_at: null, sent_at: null,
    completed_at: status === 'completed' ? '2026-11-05T11:59:00.000Z' : null, declined_at: null, voided_at: null, expires_at: null, void_reason: null,
    recipients: [{ id: '1', name: 'Ada', email: 'ada@example.com', role: 'Client', routing_order: 1, kind: 'signer', status: status === 'completed' ? 'signed' : status === 'declined' ? 'declined' : 'sent', provider_status: null, signed_at: null, declined_reason: status === 'declined' ? 'No thanks' : null }],
    terminal: ['completed', 'declined', 'voided', 'expired'].includes(status), client_reference: null,
  }
}

function loadedWith(state: { status: EsignEnvelope['status']; reads: number; downloads: string[] }): LoadedEsign {
  const real = getEsignAdapter('docusign')
  return {
    provider: 'docusign',
    integration: { id: INTEGRATION, name: 'DocuSign', type: 'docusign', tenant_id: TENANT },
    ctx: { provider: 'docusign', tenantId: TENANT, integrationId: INTEGRATION, settings: {}, integrationConfig: { auth_config: { webhook_secret: SECRET } }, timeoutMs: 5000, sleep: async () => {} },
    adapter: {
      ...real,
      getEnvelope: async () => { state.reads++; return envelope(state.status) },
      download: async (_c, _id, kind) => { state.downloads.push(kind); return { bytes: new Uint8Array([37, 80, 68, 70]), name: 'signed.pdf', mime_type: 'application/pdf' } },
    },
  }
}

describe('waits: webhook and polling paths', () => {
  let db: FakeDb
  let state: { status: EsignEnvelope['status']; reads: number; downloads: string[] }
  let loaded: LoadedEsign
  beforeEach(() => {
    resumes.calls.length = 0
    resumes.gone.clear()
    invalidateEsignTriggerCache()
    db = fakeDb({ workflows: [], workflow_runs: [{ id: 'run-1', tenant_id: TENANT, status: 'waiting_for_event' }] }, { claim_due_esign_waits: claimDueWaits, enqueue_workflow: () => 'job-t' })
    setEsignServiceDb(db as never)
    state = { status: 'sent', reads: 0, downloads: [] }
    loaded = loadedWith(state)
  })
  afterEach(() => setEsignServiceDb(null))

  const register = (config: Partial<{ download: boolean; document: string }> = {}) => registerWait({
    db: db as never, loaded, envelopeId: 'env-1', runId: 'run-1', workflowId: 'wf-1', nodeId: 'wait', nodeLabel: 'Wait',
    config: { output_var: 'signature', download: config.download ?? true, document: config.document ?? 'both', poll_minutes: 5 }, timeoutDays: 14,
  })
  const ev = (type: 'envelope_completed' | 'recipient_signed' | 'envelope_declined', key = `k-${type}`) => ({ type, envelope_id: 'env-1', dedupe_key: key, provider_event: type, occurred_at: null })

  it('registers a wait (30-minute safety-net polling when webhooks are configured, a deadline)', async () => {
    const eventId = await register()
    expect(eventId).toMatch(/^esignwait_[0-9a-f]{32}$/)
    const w = db.tables.esign_waits[0]
    expect(w).toMatchObject({ tenant_id: TENANT, integration_id: INTEGRATION, envelope_id: 'env-1', run_id: 'run-1', status: 'waiting', config: { poll_minutes: 30, download: true } })
    expect(Date.parse(w.deadline_at) - Date.now()).toBeGreaterThan(13.9 * 86_400_000)
  })

  it('a non-final event reads the envelope and keeps waiting; the completion resumes with recipients and the signed PDF', async () => {
    const eventId = await register()
    await processEsignEvents(loaded, [ev('recipient_signed')], { db: db as never })
    expect(resumes.calls).toHaveLength(0)
    expect(db.tables.esign_waits[0]).toMatchObject({ status: 'waiting', last_status: 'sent' })

    state.status = 'completed'
    const result = await processEsignEvents(loaded, [ev('envelope_completed')], { db: db as never })
    expect(result).toMatchObject({ processed: 1, duplicates: 0, resumed: 1 })
    expect(resumes.calls).toHaveLength(1)
    const out = resumes.calls[0].variables._esign_node_output
    expect(resumes.calls[0]).toMatchObject({ tenantId: TENANT, eventId })
    expect(out).toMatchObject({ outcome: 'completed', status: 'completed', envelope_id: 'env-1', signed_count: 1, signed_document: { _file: true, name: 'signed-env-1.pdf' }, certificate: { name: 'signed-env-1-certificate.pdf' } })
    expect(state.downloads).toEqual(['combined', 'certificate'])
    expect(db.tables.esign_waits[0]).toMatchObject({ status: 'resumed', outcome: 'completed' })
  })

  it('a replayed delivery is not processed again', async () => {
    await register()
    state.status = 'completed'
    await processEsignEvents(loaded, [ev('envelope_completed', 'same-key')], { db: db as never })
    const reads = state.reads
    const replay = await processEsignEvents(loaded, [ev('envelope_completed', 'same-key')], { db: db as never })
    expect(replay).toMatchObject({ processed: 0, duplicates: 1, resumed: 0 })
    expect(state.reads).toBe(reads)
    expect(resumes.calls).toHaveLength(1)
  })

  it('the outcome comes from the provider, not the payload (a forged "completed" for a sent envelope resumes nothing)', async () => {
    await register()
    state.status = 'sent'
    await processEsignEvents(loaded, [ev('envelope_completed', 'forged')], { db: db as never })
    expect(resumes.calls).toHaveLength(0)
  })

  it('declined resumes without downloading', async () => {
    await register()
    state.status = 'declined'
    await processEsignEvents(loaded, [ev('envelope_declined')], { db: db as never })
    expect(resumes.calls[0].variables._esign_node_output).toMatchObject({ outcome: 'declined', recipients: [{ status: 'declined', declined_reason: 'No thanks' }] })
    expect(resumes.calls[0].variables._esign_node_output.signed_document).toBeUndefined()
    expect(state.downloads).toEqual([])
  })

  it('polling: reschedules while sent, resumes when completed, times out after the deadline, cancels when the run is gone', async () => {
    // Due now.
    await register()
    db.tables.esign_waits[0].next_poll_at = new Date(Date.now() - 1000).toISOString()
    const load = async () => loaded
    {
      let r = await pollDueWaits({ db: db as never, load })
      expect(r).toMatchObject({ claimed: 1, resumed: 0, errors: 0 })
      expect(db.tables.esign_waits[0]).toMatchObject({ status: 'waiting', poll_count: 1, last_status: 'sent' })
      expect(Date.parse(db.tables.esign_waits[0].next_poll_at)).toBeGreaterThan(Date.now() + 29 * 60_000)

      db.tables.esign_waits[0].next_poll_at = new Date(Date.now() - 1000).toISOString()
      state.status = 'completed'
      r = await pollDueWaits({ db: db as never, load })
      expect(r.resumed).toBe(1)
      expect(resumes.calls[0].variables._esign_node_output.outcome).toBe('completed')
      // The poll also fires the trigger once (dedupe key per envelope + event)…
      expect(db.tables.esign_events.map((e) => e.dedupe_key)).toContain('trigger:env-1:envelope_completed')

      // Timeout
      resumes.calls.length = 0
      state.status = 'sent'
      await register()
      const w2 = db.tables.esign_waits[1]
      w2.next_poll_at = new Date(Date.now() - 1000).toISOString()
      w2.deadline_at = new Date(Date.now() - 1000).toISOString()
      r = await pollDueWaits({ db: db as never, load })
      expect(resumes.calls[0].variables._esign_node_output).toMatchObject({ outcome: 'timeout', status: 'sent' })

      // Run no longer waiting → cancelled, nothing resumed.
      resumes.calls.length = 0
      await register()
      const w3 = db.tables.esign_waits[2]
      w3.run_id = 'run-gone'
      w3.next_poll_at = new Date(Date.now() - 1000).toISOString()
      await pollDueWaits({ db: db as never, load })
      expect(w3.status).toBe('cancelled')
      expect(resumes.calls).toHaveLength(0)
    }
  })

  it('triggers: matching active workflows are queued once per terminal event (webhook + poll), with read-back data', async () => {
    db.tables.workflows = [
      { id: 'wf-any', tenant_id: TENANT, is_active: true, trigger_type: 'esign_event', nodes: [{ type: 'esign_event', config: {} }] },
      { id: 'wf-declined', tenant_id: TENANT, is_active: true, trigger_type: 'esign_event', nodes: [{ type: 'esign_event', config: { events: ['envelope_declined'] } }] },
      { id: 'wf-other', tenant_id: TENANT, is_active: true, trigger_type: 'esign_event', nodes: [{ type: 'esign_event', config: { integration_id: 'other-integration' } }] },
    ]
    state.status = 'completed'
    await processEsignEvents(loaded, [ev('envelope_completed', 'd1')], { db: db as never })
    await processEsignEvents(loaded, [ev('envelope_completed', 'd2')], { db: db as never }) // second delivery (different key) of the same transition
    const queued = db.rpcCalls.filter((c) => c.name === 'enqueue_workflow')
    expect(queued.map((c) => c.args.p_workflow_id)).toEqual(['wf-any'])
    expect(queued[0].args).toMatchObject({ p_tenant_id: TENANT, p_trigger_type: 'esign_event', p_trigger_data: { esign_event: 'envelope_completed', esign_envelope_id: 'env-1', esign_status: 'completed', esign_provider: 'docusign', esign_integration_id: INTEGRATION } })
    // Non-terminal events fire per delivery.
    await processEsignEvents(loaded, [{ ...ev('recipient_signed', 'r1'), recipient: { email: 'ada@example.com' } }], { db: db as never })
    const last = db.rpcCalls.filter((c) => c.name === 'enqueue_workflow').at(-1)!
    expect(last.args.p_trigger_data).toMatchObject({ esign_event: 'recipient_signed', esign_recipient: { email: 'ada@example.com', name: 'Ada', role: 'Client' } })
  })

  it('a failed resume (run gone) cancels the wait', async () => {
    const eventId = await register()
    resumes.gone.add(eventId)
    state.status = 'completed'
    await processEsignEvents(loaded, [ev('envelope_completed')], { db: db as never })
    expect(db.tables.esign_waits[0].status).toBe('cancelled')
  })
})

describe('outcome edges', () => {
  it('labelled edges follow their outcome; other labels always', () => {
    expect(esignEdgeMatches('Completed', 'completed')).toBe(true)
    expect(esignEdgeMatches('Signed', 'completed')).toBe(true)
    expect(esignEdgeMatches('Declined', 'completed')).toBe(false)
    expect(esignEdgeMatches('Timed out', 'timeout')).toBe(true)
    expect(esignEdgeMatches('Cancelled', 'voided')).toBe(true)
    expect(esignEdgeMatches('', 'declined')).toBe(true)
    expect(esignEdgeMatches('Notify team', 'declined')).toBe(true)
  })
})

/* ── Route ─────────────────────────────────────────────────────────── */

describe('POST /api/webhooks/esign/{provider}/{integrationId}', () => {
  let db: FakeDb
  beforeEach(() => {
    resumes.calls.length = 0
    db = fakeDb({
      integrations: [
        { id: INTEGRATION, name: 'PandaDoc', type: 'pandadoc', tenant_id: TENANT, is_active: true, config: { base_url: 'https://api.pandadoc.com/public/v1', auth_type: 'api_key', auth_config: { key_name: 'Authorization', key_value: 'API-Key k', webhook_secret: SECRET }, template_vars: {} } },
      ],
      workflows: [],
    })
    setEsignServiceDb(db as never)
  })
  afterEach(() => setEsignServiceDb(null))

  const call = async (provider: string, integrationId: string, body: string, query = '') => {
    const { POST } = await import('@/app/api/webhooks/esign/[provider]/[integrationId]/route')
    const request = new NextRequest(`https://app.example${esignWebhookPath(provider as never, integrationId)}${query}`, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
    return POST(request, { params: Promise.resolve({ provider: provider.replace(/_/g, '-'), integrationId }) })
  }

  it('resolves the tenant from the URL, verifies, refuses bad signatures, other providers and unknown integrations', async () => {
    const body = JSON.stringify([{ event: 'document_state_changed', data: { id: 'doc-x', status: 'document.sent' } }])
    const mod = await import('@/lib/esign/providers/pandadoc')
    const spy = vi.spyOn(mod.pandadocAdapter, 'getEnvelope').mockResolvedValue({ ...envelope('sent'), provider: 'pandadoc', envelope_id: 'doc-x' })
    try {
      const ok = await call('pandadoc', INTEGRATION, body, `?signature=${hex(body)}`)
      expect(ok.status).toBe(200)
      expect(await ok.json()).toMatchObject({ ok: true, received: 1, processed: 1 })
      expect(db.tables.esign_events[0]).toMatchObject({ tenant_id: TENANT, integration_id: INTEGRATION, provider: 'pandadoc', envelope_id: 'doc-x', source: 'webhook' })

      const replay = await call('pandadoc', INTEGRATION, body, `?signature=${hex(body)}`)
      expect(await replay.json()).toMatchObject({ duplicates: 1, processed: 0, duplicate: true })
      expect(spy).toHaveBeenCalledTimes(1)

      expect((await call('pandadoc', INTEGRATION, body, `?signature=${hex('tampered')}`)).status).toBe(401)
      expect((await call('docusign', INTEGRATION, body)).status).toBe(404) // integration is not a DocuSign one
      expect((await call('pandadoc', '33333333-3333-4333-8333-333333333333', body)).status).toBe(404)
      expect((await call('pandadoc', 'not-a-uuid', body)).status).toBe(404)
      expect((await call('nope', INTEGRATION, body)).status).toBe(404)
    } finally {
      spy.mockRestore()
    }
  })
})
