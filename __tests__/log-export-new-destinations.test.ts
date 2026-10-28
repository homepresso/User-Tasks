import crypto from 'node:crypto'
import dgram from 'node:dgram'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { jwtVerify, importSPKI } from 'jose'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { deliverEvents, type FetchLike } from '@/lib/log-export/deliver'
import { clearTokenCache, GOOGLE_TOKEN_URL } from '@/lib/log-export/cloud-auth'
import { frame, normalisePem, sdEscape, SYSLOG_UDP_MAX_BYTES, syslogFormatter, syslogMessage } from '@/lib/log-export/formats/syslog'
import { azureMonitorFormatter, azureMonitorUrl } from '@/lib/log-export/formats/azure-monitor'
import { sasToken } from '@/lib/log-export/formats/azure-event-hubs'
import { gcpLoggingFormatter } from '@/lib/log-export/formats/gcp-logging'
import { gcpPubsubFormatter } from '@/lib/log-export/formats/gcp-pubsub'
import { byteLength, toExportedEvent, type FormatContext, type ShipEvent } from '@/lib/log-export/formats/types'
import { sendSyslog } from '@/lib/log-export/syslog-transport'
import { LOG_DESTINATION_SCHEMAS } from '@/lib/api-schemas/log-destinations'
import { checkDestinationAuth, checkDestinationUrls } from '@/lib/services/log-destinations'
import { shipDestination, type ClaimedDestination } from '@/lib/log-export/shipper'
import { encryptSecret } from '@/lib/secret-crypto'
import { createMemorySupabase } from './fixtures/supabase-memory'

/**
 * Log destinations of providers phase 15 — syslog (RFC 5424 over TLS / TCP /
 * UDP), Azure Monitor Logs Ingestion, Azure Event Hubs, Google Cloud Logging
 * and Pub/Sub — under the same contracts as Splunk / Datadog / OTLP: exact
 * wire formats and limits, real sockets for syslog (TLS incl. mutual TLS,
 * TCP octet counting, UDP datagrams), token flows against fake identity
 * providers (Entra ID client credentials, Google service-account JWT), the
 * instance-identity opt-in (allowed and denied), egress rules, the shipper
 * advancing its cursor, and that no secret or token ever reaches an error.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- parsed payloads and stubs */

const TENANT = '7a000000-0000-4000-8000-000000000001'
const NOW = Date.parse('2026-10-24T12:00:00.000Z')
const CLIENT_SECRET = 'entra-client-secret-SUPER-SECRET-9'

function event(id: number, overrides: Partial<ShipEvent> = {}): ShipEvent {
  return {
    id, occurred_at: '2026-10-24T11:59:58.250Z', type: 'workflow.run.completed', category: 'workflow', severity: 'info',
    message: `Run ${id} completed`, source_table: 'workflow_runs', source_id: `run-${id}`, trace_id: null, run_id: null,
    workflow_id: null, task_id: null, actor_id: null, attributes: { status: 'completed' }, ...overrides,
  }
}
const ctx = (config: Record<string, any>, credentials: Record<string, any> = {}, extra: Partial<FormatContext> = {}): FormatContext => ({
  tenantId: TENANT, destinationId: 'dest-1', config, credentials, now: () => NOW, ...extra,
})

beforeEach(() => {
  clearTokenCache()
  process.env.ALLOW_PRIVATE_EGRESS = 'true'
})
afterEach(() => {
  for (const k of ['ALLOW_PRIVATE_EGRESS', 'LOG_EXPORT_ALLOW_INSTANCE_IDENTITY', 'LOG_EXPORT_AZURE_AUTHORITY_URL', 'LOG_EXPORT_GCP_TOKEN_URL', 'LOG_EXPORT_GCP_LOGGING_URL', 'LOG_EXPORT_GCP_PUBSUB_URL', 'LOG_EXPORT_EVENT_HUBS_URL']) delete process.env[k]
})

// ── syslog ──────────────────────────────────────────────────────────────────

describe('syslog formatter (RFC 5424)', () => {
  it('builds <PRI>1 TIMESTAMP HOST APP - MSGID [SD] JSON', () => {
    const msg = syslogMessage(toExportedEvent(event(7, { severity: 'error', type: 'workflow.run.failed' }), TENANT), { facility: 16 })
    expect(msg).toBe(
      `<131>1 2026-10-24T11:59:58.250Z usertasks usertasks - workflow.run.failed [usertasks@32473 tenant_id="${TENANT}" event_id="7" category="workflow" severity="error"] ` +
      JSON.stringify(toExportedEvent(event(7, { severity: 'error', type: 'workflow.run.failed' }), TENANT)),
    )
    // facility 1 (user), debug → <15>
    expect(syslogMessage(toExportedEvent(event(1, { severity: 'debug' }), TENANT), { facility: 1 })).toMatch(/^<15>1 /)
    expect(sdEscape('a"b\\c]d')).toBe('a\\"b\\\\c\\]d')
  })

  it('frames with octet counting (bytes, not characters) or newlines', () => {
    expect(frame('héllo', 'octet_counting')).toBe('6 héllo')
    expect(frame('x', 'lf')).toBe('x\n')
    const [request] = syslogFormatter.build([event(1, { message: 'ünïcode' }), event(2)], ctx({ host: 'logs.example', transport: 'tls' }))
    expect(request.url).toBe('syslog+tls://logs.example:6514')
    for (const m of request.messages!) {
      const [len, ...rest] = m.split(' ')
      expect(Number(len)).toBe(byteLength(rest.join(' ')))
    }
    expect(syslogFormatter.build([event(1)], ctx({ host: 'h', transport: 'tcp', framing: 'lf', port: 1514 }))[0]).toMatchObject({ url: 'syslog+tcp://h:1514' })
  })

  it('UDP: one datagram per event, each ≤ 8 KB (oversized events truncated); 1000 per request', () => {
    const big = event(1, { attributes: { blob: 'x'.repeat(50_000) } })
    const requests = syslogFormatter.build([big, ...Array.from({ length: 1200 }, (_, i) => event(i + 2))], ctx({ host: '10.0.0.5', transport: 'udp' }))
    expect(requests.map((r) => r.messages!.length)).toEqual([1000, 201])
    expect(requests[0].url).toBe('syslog+udp://10.0.0.5:514')
    expect(byteLength(requests[0].messages![0])).toBeLessThanOrEqual(SYSLOG_UDP_MAX_BYTES)
    expect(requests[0].messages![0]).toContain('"_truncated":true')
  })

  it('mutual TLS needs both halves; a PEM pasted on one line is restored', () => {
    expect(() => syslogFormatter.build([event(1)], ctx({ host: 'h', transport: 'tls' }, { client_cert: 'x' }))).toThrow(/both credentials.client_cert and credentials.client_key/)
    const body = 'A'.repeat(130)
    expect(normalisePem(`-----BEGIN CERTIFICATE----- ${body} -----END CERTIFICATE-----`)).toBe(`-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n${'A'.repeat(64)}\nAA\n-----END CERTIFICATE-----\n`)
  })
})

/** A self-signed certificate for `CN` (openssl). */
function selfSigned(dir: string, name: string): { key: string; cert: string } {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.pem`, '-days', '1', '-subj', `/CN=${name}`, '-addext', `subjectAltName=DNS:${name},IP:127.0.0.1`], { cwd: dir, stdio: 'pipe' })
  return { key: readFileSync(path.join(dir, `${name}.key`), 'utf8'), cert: readFileSync(path.join(dir, `${name}.pem`), 'utf8') }
}

/** Parse octet-counted frames from a stream. */
function octetFrames(data: Buffer): string[] {
  const out: string[] = []
  let i = 0
  while (i < data.length) {
    const sp = data.indexOf(0x20, i)
    const len = Number(data.subarray(i, sp).toString())
    out.push(data.subarray(sp + 1, sp + 1 + len).toString('utf8'))
    i = sp + 1 + len
  }
  return out
}

describe('syslog transport (real sockets)', () => {
  let dir: string
  let server: { key: string; cert: string }
  let client: { key: string; cert: string }
  let hasOpenssl = true
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ut-syslog-'))
    try {
      server = selfSigned(dir, 'localhost')
      client = selfSigned(dir, 'usertasks-client')
    } catch {
      hasOpenssl = false
    }
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  async function streamServer(kind: 'tcp' | 'tls', opts: tls.TlsOptions = {}) {
    const received: Buffer[] = []
    let peerCert: string | null = null
    const onSocket = (socket: net.Socket) => {
      if (socket instanceof tls.TLSSocket) peerCert = String(socket.getPeerCertificate()?.subject?.CN ?? '') || null
      socket.on('data', (d) => received.push(d))
    }
    const srv = kind === 'tls' ? tls.createServer({ key: server.key, cert: server.cert, ...opts }, onSocket) : net.createServer(onSocket)
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    return { port: (srv.address() as net.AddressInfo).port, data: () => Buffer.concat(received), peer: () => peerCert, close: () => new Promise((r) => srv.close(r)) }
  }

  it('TCP: octet-counted frames arrive intact and in order', async () => {
    const srv = await streamServer('tcp')
    const requests = syslogFormatter.build([event(1), event(2), event(3)], ctx({ host: '127.0.0.1', port: srv.port, transport: 'tcp' }))
    const result = await deliverEvents('syslog', [event(1), event(2), event(3)], ctx({ host: '127.0.0.1', port: srv.port, transport: 'tcp' }))
    expect(result).toMatchObject({ sent: 3, sentThrough: 3, result: { kind: 'success' } })
    await new Promise((r) => setTimeout(r, 50))
    const frames = octetFrames(srv.data())
    expect(frames).toEqual(requests[0].messages!.map((m) => m.slice(m.indexOf(' ') + 1)))
    expect(JSON.parse(frames[2].slice(frames[2].indexOf('] ') + 2)).id).toBe(3)
    await srv.close()
  })

  it('TLS with server verification and a client certificate (mutual TLS)', async () => {
    if (!hasOpenssl) return
    const srv = await streamServer('tls', { requestCert: true, rejectUnauthorized: true, ca: client.cert })
    const config = { host: '127.0.0.1', port: srv.port, transport: 'tls', tls_servername: 'localhost' }
    const result = await deliverEvents('syslog', [event(1)], ctx(config, { client_cert: client.cert, client_key: client.key }), {
      syslog: (req, o) => sendSyslog(req, { ...o, ca: server.cert }),
    })
    expect(result.result.kind).toBe('success')
    await new Promise((r) => setTimeout(r, 50))
    expect(srv.peer()).toBe('usertasks-client')
    expect(octetFrames(srv.data())).toHaveLength(1)
    // An untrusted server certificate is a (retried) failure, not a silent send.
    const untrusted = await deliverEvents('syslog', [event(1)], ctx(config, { client_cert: client.cert, client_key: client.key }))
    expect(untrusted.result).toMatchObject({ kind: 'retry' })
    expect(untrusted.result.error).toMatch(/certificate/i)
    expect(untrusted.result.error).not.toContain(client.key.slice(40, 80))
    await srv.close()
  })

  it('UDP: one datagram per message', async () => {
    const sock = dgram.createSocket('udp4')
    const got: string[] = []
    sock.on('message', (m) => got.push(m.toString()))
    await new Promise<void>((r) => sock.bind(0, '127.0.0.1', r))
    const port = sock.address().port
    const result = await deliverEvents('syslog', [event(1), event(2)], ctx({ host: '127.0.0.1', port, transport: 'udp' }))
    expect(result.result.kind).toBe('success')
    await new Promise((r) => setTimeout(r, 100))
    expect(got.map((m) => m.slice(0, 5))).toEqual(['<134>', '<134>'])
    sock.close()
  })

  it('unencrypted syslog and private hosts follow the egress policy; an unreachable receiver is retried', async () => {
    process.env.ALLOW_PRIVATE_EGRESS = 'false'
    const plain = await deliverEvents('syslog', [event(1)], ctx({ host: 'logs.example', transport: 'tcp' }))
    expect(plain.result).toMatchObject({ kind: 'permanent' })
    expect(plain.result.error).toMatch(/syslog must use tls/)
    const privateTls = await deliverEvents('syslog', [event(1)], ctx({ host: '10.1.2.3', transport: 'tls' }))
    expect(privateTls.result.kind).toBe('permanent')
    await expect(checkDestinationUrls('syslog', { host: 'logs.example', transport: 'udp' })).rejects.toThrow(/unencrypted/)
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    const down = await deliverEvents('syslog', [event(1)], ctx({ host: '127.0.0.1', port: 9, transport: 'tcp' }))
    expect(down.result).toMatchObject({ kind: 'retry' })
  })
})

// ── cloud destinations: fake identity providers and APIs ────────────────────

interface Call { url: string; init: RequestInit; body: string }

function fakeCloud(handlers: Record<string, (call: Call) => { status: number; json?: unknown } | Promise<{ status: number; json?: unknown }>>) {
  const calls: Call[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, init, body: String(init.body ?? '') }
    calls.push(call)
    const key = Object.keys(handlers).find((k) => url.startsWith(k))
    const { status, json } = key ? await handlers[key](call) : { status: 404, json: { error: 'no handler' } }
    return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as FetchLike & { mock: any }
  return { fetch, calls }
}

const ENTRA = 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token'
const entraConfig = { tenant_id: '11111111-2222-3333-4444-555555555555', client_id: '66666666-7777-8888-9999-000000000000' }

describe('Azure Monitor Logs Ingestion', () => {
  const config = { endpoint: 'https://my-dce-abcd.westeurope-1.ingest.monitor.azure.com', dcr_immutable_id: `dcr-${'a'.repeat(32)}`, stream_name: 'Custom-UserTasks_CL', auth: 'client_secret', ...entraConfig, cloud: 'public' }

  it('client credentials → bearer → DCR stream; the token is cached', async () => {
    const cloud = fakeCloud({
      [ENTRA]: () => ({ status: 200, json: { access_token: 'monitor-token', expires_in: 3600 } }),
      [config.endpoint]: () => ({ status: 204 }),
    })
    const first = await deliverEvents('azure_monitor', [event(1), event(2)], ctx(config, { client_secret: CLIENT_SECRET }), { fetch: cloud.fetch })
    expect(first).toMatchObject({ sent: 2, result: { kind: 'success' } })
    const token = new URLSearchParams(cloud.calls[0].body)
    expect(Object.fromEntries(token)).toEqual({ grant_type: 'client_credentials', client_id: entraConfig.client_id, client_secret: CLIENT_SECRET, scope: 'https://monitor.azure.com/.default' })
    expect(cloud.calls[1].url).toBe(azureMonitorUrl(config))
    expect(cloud.calls[1].url).toBe(`${config.endpoint}/dataCollectionRules/${config.dcr_immutable_id}/streams/Custom-UserTasks_CL?api-version=2023-01-01`)
    expect((cloud.calls[1].init.headers as any).Authorization).toBe('Bearer monitor-token')
    const rows = JSON.parse(cloud.calls[1].body)
    expect(rows[0]).toMatchObject({ TimeGenerated: '2026-10-24T11:59:58.250Z', EventId: 1, TenantId: TENANT, EventType: 'workflow.run.completed', Attributes: { status: 'completed' } })
    await deliverEvents('azure_monitor', [event(3)], ctx(config, { client_secret: CLIENT_SECRET }), { fetch: cloud.fetch })
    expect(cloud.calls.filter((c) => c.url === ENTRA)).toHaveLength(1)
  })

  it('splits at 1 MB', () => {
    const big = Array.from({ length: 30 }, (_, i) => event(i + 1, { attributes: { blob: 'y'.repeat(60_000) } }))
    const requests = azureMonitorFormatter.build(big, ctx(config, {}, { accessToken: 't' }))
    expect(requests.length).toBeGreaterThan(1)
    for (const r of requests) expect(byteLength(r.body)).toBeLessThanOrEqual(1_000_000)
  })

  it('rejected credentials are permanent and never echo the secret; an IdP outage is retried', async () => {
    const bad = fakeCloud({ [ENTRA]: () => ({ status: 401, json: { error: 'invalid_client', error_description: `AADSTS7000215: Invalid client secret provided. ${CLIENT_SECRET}` } }) })
    const result = await deliverEvents('azure_monitor', [event(1)], ctx(config, { client_secret: CLIENT_SECRET }), { fetch: bad.fetch })
    expect(result.result).toMatchObject({ kind: 'permanent' })
    expect(result.result.error).toMatch(/Microsoft Entra ID rejected the credentials \(401\): AADSTS7000215/)
    expect(result.result.error).not.toContain(CLIENT_SECRET)
    clearTokenCache()
    const down = fakeCloud({ [ENTRA]: () => ({ status: 503, json: {} }) })
    expect((await deliverEvents('azure_monitor', [event(1)], ctx(config, { client_secret: CLIENT_SECRET }), { fetch: down.fetch })).result.kind).toBe('retry')
  })

  it('the instance\'s managed identity only with LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true', async () => {
    const mi = { ...config, auth: 'managed_identity' }
    const denied = await deliverEvents('azure_monitor', [event(1)], ctx(mi))
    expect(denied.result).toMatchObject({ kind: 'permanent' })
    expect(denied.result.error).toMatch(/LOG_EXPORT_ALLOW_INSTANCE_IDENTITY/)
    expect(() => checkDestinationAuth('azure_monitor', mi, {})).toThrow(/does not allow/)
    process.env.LOG_EXPORT_ALLOW_INSTANCE_IDENTITY = 'true'
    expect(() => checkDestinationAuth('azure_monitor', mi, {})).not.toThrow()
  })

  it('validates its config (DCR id, stream, https endpoint) and the app registration fields', () => {
    const schema = LOG_DESTINATION_SCHEMAS.azure_monitor.config
    expect(schema.safeParse(config).success).toBe(true)
    expect(schema.safeParse({ ...config, dcr_immutable_id: 'dcr-123' }).success).toBe(false)
    expect(schema.safeParse({ ...config, stream_name: 'UserTasks' }).success).toBe(false)
    expect(() => checkDestinationAuth('azure_monitor', { ...config, tenant_id: undefined }, { client_secret: 'x' })).toThrow(/tenant_id and config.client_id/)
    expect(() => checkDestinationAuth('azure_monitor', config, {})).toThrow(/client_secret is required/)
  })
})

describe('Azure Event Hubs', () => {
  const config = { namespace: 'ut-events', event_hub: 'usertasks', auth: 'sas', sas_key_name: 'send', cloud: 'public' }

  it('SAS: a correct SharedAccessSignature and the batched JSON body', async () => {
    const cloud = fakeCloud({ 'https://ut-events.servicebus.windows.net/': () => ({ status: 201 }) })
    const result = await deliverEvents('azure_event_hubs', [event(1), event(2)], ctx(config, { sas_key: 'c2VjcmV0LWtleQ==' }), { fetch: cloud.fetch })
    expect(result.result.kind).toBe('success')
    const call = cloud.calls[0]
    expect(call.url).toBe('https://ut-events.servicebus.windows.net/usertasks/messages?timeout=60&api-version=2014-01')
    expect((call.init.headers as any)['Content-Type']).toBe('application/vnd.microsoft.servicebus.json')
    const auth = String((call.init.headers as any).Authorization)
    const params = Object.fromEntries(auth.replace('SharedAccessSignature ', '').split('&').map((kv) => kv.split('=').map(decodeURIComponent)))
    expect(params.sr).toBe('https://ut-events.servicebus.windows.net/usertasks')
    expect(params.skn).toBe('send')
    expect(Number(params.se)).toBe(Math.floor(NOW / 1000) + 3600)
    // Microsoft's algorithm: HMAC-SHA256(key, urlencode(resource) + "\n" + expiry), base64.
    expect(params.sig).toBe(crypto.createHmac('sha256', 'c2VjcmV0LWtleQ==').update(`${encodeURIComponent(params.sr)}\n${params.se}`).digest('base64'))
    const body = JSON.parse(call.body)
    expect(body).toHaveLength(2)
    expect(JSON.parse(body[0].Body)).toMatchObject({ id: 1, tenant_id: TENANT })
    expect(body[0].UserProperties).toMatchObject({ tenant_id: TENANT, event_type: 'workflow.run.completed' })
    expect(sasToken('https://X/y', 'k', 'v', 1)).toMatch(/^SharedAccessSignature sr=https%3A%2F%2Fx%2Fy&sig=/)
  })

  it('Entra ID scope for Event Hubs; sovereign clouds use their own hosts', async () => {
    const cloud = fakeCloud({
      'https://login.microsoftonline.us/': () => ({ status: 200, json: { access_token: 'eh-token', expires_in: 3600 } }),
      'https://ut-events.servicebus.usgovcloudapi.net/': () => ({ status: 201 }),
    })
    const gov = { ...config, auth: 'client_secret', cloud: 'usgov', ...entraConfig }
    expect((await deliverEvents('azure_event_hubs', [event(1)], ctx(gov, { client_secret: CLIENT_SECRET }), { fetch: cloud.fetch })).result.kind).toBe('success')
    expect(new URLSearchParams(cloud.calls[0].body).get('scope')).toBe('https://eventhubs.azure.net/.default')
    expect((cloud.calls[1].init.headers as any).Authorization).toBe('Bearer eh-token')
  })

  it('needs the SAS policy and key', () => {
    expect(() => checkDestinationAuth('azure_event_hubs', { ...config, sas_key_name: undefined }, { sas_key: 'x' })).toThrow(/sas_key_name/)
    expect(() => checkDestinationAuth('azure_event_hubs', config, {})).toThrow(/sas_key is required/)
    expect(LOG_DESTINATION_SCHEMAS.azure_event_hubs.config.safeParse({ ...config, namespace: 'evil.example.com' }).success).toBe(false)
  })
})

describe('Google Cloud Logging and Pub/Sub (service-account JWT)', () => {
  let sa: string
  let publicKey: string
  beforeAll(() => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    sa = JSON.stringify({
      type: 'service_account', client_email: 'logs@proj-1234.iam.gserviceaccount.com', private_key_id: 'kid-1',
      private_key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      // A tenant-supplied token_uri is never used (it would be an SSRF vector).
      token_uri: 'https://evil.example/token',
    })
  })

  function googleToken(scope: string) {
    return async (call: Call) => {
      const form = new URLSearchParams(call.body)
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
      const { payload, protectedHeader } = await jwtVerify(form.get('assertion')!, await importSPKI(publicKey, 'RS256'), { audience: GOOGLE_TOKEN_URL, issuer: 'logs@proj-1234.iam.gserviceaccount.com', currentDate: new Date(NOW) })
      expect(protectedHeader.kid).toBe('kid-1')
      expect(payload.scope).toBe(scope)
      return { status: 200, json: { access_token: 'g-token', expires_in: 3599 } }
    }
  }

  it('Cloud Logging: entries:write with insertId, severity, labels and the logName', async () => {
    let tokenCalls = 0
    const verify = googleToken('https://www.googleapis.com/auth/logging.write')
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url === GOOGLE_TOKEN_URL) { tokenCalls++; const r = await verify({ url, init, body: String(init.body) }); return Response.json(r.json, { status: r.status }) }
      expect(url).toBe('https://logging.googleapis.com/v2/entries:write')
      expect((init.headers as any).Authorization).toBe('Bearer g-token')
      const body = JSON.parse(String(init.body))
      expect(body).toMatchObject({ logName: 'projects/proj-1234/logs/usertasks', resource: { type: 'global', labels: { project_id: 'proj-1234' } }, labels: { env: 'prod' } })
      expect(body.entries[0]).toMatchObject({ severity: 'ERROR', insertId: `${TENANT}-1`, labels: { tenant_id: TENANT, category: 'workflow' }, jsonPayload: { id: 1 }, trace: `projects/proj-1234/traces/${'c'.repeat(32)}` })
      return new Response('{}', { status: 200 })
    })
    const config = { project_id: 'proj-1234', log_id: 'usertasks', resource_type: 'global', labels: { env: 'prod' }, auth: 'service_account' }
    const result = await deliverEvents('gcp_logging', [event(1, { severity: 'error', trace_id: 'c'.repeat(32) })], ctx(config, { service_account_json: sa }), { fetch: fetch as unknown as FetchLike })
    expect(result.result.kind).toBe('success')
    expect(tokenCalls).toBe(1)
    expect(fetch.mock.calls.map((c) => c[0])).not.toContain('https://evil.example/token')
  })

  it('Pub/Sub: base64 event data, attributes and the tenant ordering key; 1000 per request', async () => {
    const cloud = fakeCloud({ [GOOGLE_TOKEN_URL]: googleToken('https://www.googleapis.com/auth/pubsub'), 'https://pubsub.googleapis.com/': () => ({ status: 200, json: { messageIds: ['1'] } }) })
    const config = { project_id: 'proj-1234', topic: 'usertasks-events', attributes: { source: 'ut' }, ordering_key: 'tenant', auth: 'service_account' }
    const result = await deliverEvents('gcp_pubsub', [event(1)], ctx(config, { service_account_json: sa }), { fetch: cloud.fetch })
    expect(result.result.kind).toBe('success')
    const publish = cloud.calls.find((c) => c.url.includes(':publish'))!
    expect(publish.url).toBe('https://pubsub.googleapis.com/v1/projects/proj-1234/topics/usertasks-events:publish')
    const message = JSON.parse(publish.body).messages[0]
    expect(JSON.parse(Buffer.from(message.data, 'base64').toString())).toMatchObject({ id: 1, tenant_id: TENANT })
    expect(message.attributes).toEqual({ source: 'ut', tenant_id: TENANT, event_type: 'workflow.run.completed', category: 'workflow', severity: 'info' })
    expect(message.orderingKey).toBe(TENANT)
    const many = gcpPubsubFormatter.build(Array.from({ length: 2500 }, (_, i) => event(i + 1)), ctx(config, {}, { accessToken: 't' }))
    expect(many.map((r) => r.eventCount)).toEqual([1000, 1000, 500])
    const logs = gcpLoggingFormatter.build(Array.from({ length: 1500 }, (_, i) => event(i + 1)), ctx({ project_id: 'proj-1234' }, {}, { accessToken: 't' }))
    expect(logs.map((r) => r.eventCount)).toEqual([1000, 500])
  })

  it('a broken key is permanent; workload identity only when the operator allows it', async () => {
    const bad = await deliverEvents('gcp_logging', [event(1)], ctx({ project_id: 'proj-1234', auth: 'service_account' }, { service_account_json: '{"client_email":"x","private_key":"nope"}' }))
    expect(bad.result).toMatchObject({ kind: 'permanent' })
    expect(bad.result.error).toMatch(/unusable private_key/)
    const wi = await deliverEvents('gcp_pubsub', [event(1)], ctx({ project_id: 'proj-1234', topic: 't-1', auth: 'workload_identity' }))
    expect(wi.result.error).toMatch(/LOG_EXPORT_ALLOW_INSTANCE_IDENTITY/)
    expect(() => checkDestinationAuth('gcp_logging', { auth: 'service_account' }, {})).toThrow(/service_account_json is required/)
    expect(() => checkDestinationAuth('gcp_pubsub', { auth: 'workload_identity' }, {})).toThrow(/does not allow/)
  })
})

// ── shipper contract ────────────────────────────────────────────────────────

describe('shipper with the new destinations', () => {
  function shipDb(dest: Record<string, unknown>) {
    return createMemorySupabase({
      event_stream: [1, 2].map((id) => ({ ...event(id), tenant_id: TENANT, occurred_at: new Date(NOW - 60_000 + id).toISOString() })),
      log_destinations: [{
        id: 'dest-1', tenant_id: TENANT, name: 'D', filters: {}, enabled: true, cursor: 0, status: 'healthy', next_attempt_at: null, locked_by: 'w1', locked_at: new Date(NOW).toISOString(),
        events_sent: 0, last_success_at: null, last_error: null, last_error_at: null, consecutive_failures: 0, ...dest,
      }],
      notifications: [], users: [], user_roles: [],
    })
  }

  it('Azure Monitor: delivers, advances the cursor, and keeps the client secret out of errors', async () => {
    const config = { endpoint: 'https://dce.westeurope-1.ingest.monitor.azure.com', dcr_immutable_id: `dcr-${'b'.repeat(32)}`, stream_name: 'Custom-UT_CL', auth: 'client_secret', ...entraConfig }
    const db = shipDb({ type: 'azure_monitor', config, credentials: { client_secret: encryptSecret(CLIENT_SECRET) } })
    const ok = fakeCloud({ [ENTRA]: () => ({ status: 200, json: { access_token: 'tok', expires_in: 3600 } }), [config.endpoint]: () => ({ status: 204 }) })
    const claimed = { ...db.tables.log_destinations[0], purged_through: 0 } as unknown as ClaimedDestination
    const outcome = await shipDestination({ supabase: db as never, workerId: 'w1', now: () => NOW, random: () => 0.5, pollMs: 2000, fetch: ok.fetch, log: () => undefined }, claimed, 2)
    expect(outcome).toMatchObject({ sent: 2, status: 'healthy', cursor: 2 })

    clearTokenCache()
    const db2 = shipDb({ type: 'azure_monitor', config, credentials: { client_secret: encryptSecret(CLIENT_SECRET) } })
    const logs: string[] = []
    const denied = fakeCloud({ [ENTRA]: () => ({ status: 400, json: { error: 'invalid_client', error_description: `bad secret ${CLIENT_SECRET}` } }) })
    await shipDestination({ supabase: db2 as never, workerId: 'w1', now: () => NOW, random: () => 0.5, pollMs: 2000, fetch: denied.fetch, log: (m) => logs.push(m) }, { ...db2.tables.log_destinations[0], purged_through: 0 } as unknown as ClaimedDestination, 2)
    expect(db2.tables.log_destinations[0]).toMatchObject({ cursor: 0, status: 'retrying' })
    expect(JSON.stringify(db2.tables)).not.toContain(CLIENT_SECRET)
    expect(logs.join('\n')).not.toContain(CLIENT_SECRET)
  })

  it('syslog over TCP: delivers both events', async () => {
    const received: Buffer[] = []
    const srv = net.createServer((s) => s.on('data', (d) => received.push(d)))
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const db = shipDb({ type: 'syslog', config: { host: '127.0.0.1', port: (srv.address() as net.AddressInfo).port, transport: 'tcp' }, credentials: {} })
    const outcome = await shipDestination({ supabase: db as never, workerId: 'w1', now: () => NOW, random: () => 0.5, pollMs: 2000, fetch: vi.fn() as never, log: () => undefined }, { ...db.tables.log_destinations[0], purged_through: 0 } as unknown as ClaimedDestination, 2)
    expect(outcome).toMatchObject({ sent: 2, cursor: 2 })
    await new Promise((r) => setTimeout(r, 50))
    expect(octetFrames(Buffer.concat(received))).toHaveLength(2)
    await new Promise((r) => srv.close(r))
  })
})

// ── settings form ───────────────────────────────────────────────────────────

describe('settings form for field-driven types', () => {
  it('builds create / update inputs, hides fields by auth, keeps stored secrets', async () => {
    const { buildCreateInput, buildUpdateInput, emptyForm, formFromDestination, validateForm } = await import('@/components/settings/log-export/form-state')
    const form = { ...emptyForm('azure_event_hubs'), name: 'Hub', fields: { namespace: 'ut-events', event_hub: 'h', auth: 'sas', sas_key_name: 'send', tenant_id: 'ignored' } }
    expect(validateForm(form, 'create')).toBe('Shared access key is required')
    form.fieldSecrets = { sas_key: { stored: false, replacing: false, value: 'k' } }
    expect(validateForm(form, 'create')).toBeNull()
    const create = buildCreateInput(form)
    expect(create.config).toEqual({ namespace: 'ut-events', event_hub: 'h', auth: 'sas', sas_key_name: 'send' }) // tenant_id hidden for sas
    expect(create.credentials).toEqual({ sas_key: 'k' })

    const loaded = formFromDestination({ name: 'S', type: 'syslog', enabled: true, config: { host: 'logs', port: 6514, transport: 'tls' }, credentials: { client_cert: '__SECRET__', client_key: '__SECRET__' } })
    expect(loaded.fields).toMatchObject({ host: 'logs', port: '6514', transport: 'tls' })
    const update = buildUpdateInput({ ...loaded, fields: { ...loaded.fields, port: '' } }, { config: { host: 'logs', port: 6514, transport: 'tls' } })
    expect(update.config).toEqual({ host: 'logs', transport: 'tls', port: null })
    expect(update).not.toHaveProperty('credentials')
    expect(validateForm({ ...loaded, fields: { ...loaded.fields, port: 'abc' } }, 'edit')).toMatch(/must be a number/)
  })
})
