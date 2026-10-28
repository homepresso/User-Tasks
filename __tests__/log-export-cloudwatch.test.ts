import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { deliverEvents, type FetchLike } from '@/lib/log-export/deliver'
import {
  awsCloudWatchLogsFormatter,
  chunkCloudWatch,
  classifyCloudWatch,
  CLOUDWATCH_EVENT_OVERHEAD_BYTES,
  CLOUDWATCH_MAX_BATCH_BYTES,
  CLOUDWATCH_MAX_EVENTS,
  resetCloudWatchEnsured,
} from '@/lib/log-export/formats/aws-cloudwatch-logs'
import { byteLength, type FormatContext, type ShipEvent } from '@/lib/log-export/formats/types'
import { signRequest } from '@/lib/aws/sigv4'
import { setInstanceCredentialsForTests } from '@/lib/aws/credentials'
import { LOG_DESTINATION_SCHEMAS } from '@/lib/api-schemas/log-destinations'
import { checkDestinationAuth } from '@/lib/services/log-destinations'
import { shipDestination, type ClaimedDestination } from '@/lib/log-export/shipper'
import { encryptSecret } from '@/lib/secret-crypto'
import { createMemorySupabase } from './fixtures/supabase-memory'

/**
 * Amazon CloudWatch Logs destination under the same contracts as the other
 * destinations: the exact PutLogEvents wire format and SigV4 signature,
 * the batching limits (1 MB incl. 26 bytes per event, 10,000 events, 24 h
 * span, chronological order inside a request), throttling and error
 * classification, optional log group / stream creation, the instance-role
 * opt-in (allowed and denied), secret:// references confined to the
 * workspace, the shipper advancing its cursor, and no key in any error.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- parsed payloads and stubs */

const TENANT = '7a000000-0000-4000-8000-000000000001'
const NOW = Date.parse('2026-10-24T12:00:00.000Z')
const KEY_ID = 'AKIAIOSFODNN7EXAMPLE'
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYSUPERSECRET'
const ENDPOINT = 'https://logs.eu-west-1.amazonaws.com/'
const config = { region: 'eu-west-1', log_group_name: '/usertasks/events', log_stream_name: 'prod', auth: 'access_key' }
const creds = { access_key_id: KEY_ID, secret_access_key: SECRET_KEY }

function event(id: number, overrides: Partial<ShipEvent> = {}): ShipEvent {
  return {
    id, occurred_at: new Date(NOW - 10_000 + id).toISOString(), type: 'workflow.run.completed', category: 'workflow', severity: 'info',
    message: `Run ${id} completed`, source_table: 'workflow_runs', source_id: `run-${id}`, trace_id: null, run_id: null,
    workflow_id: null, task_id: null, actor_id: null, attributes: { status: 'completed' }, ...overrides,
  }
}
const ctx = (cfg: Record<string, any> = config, credentials: Record<string, any> = creds, extra: Partial<FormatContext> = {}): FormatContext => ({
  tenantId: TENANT, destinationId: 'dest-1', config: cfg, credentials, now: () => NOW, ...extra,
})

type Call = { url: string; init: RequestInit; body: string; target: string }
function fakeAws(handler: (call: Call) => { status: number; json?: unknown }) {
  const calls: Call[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    const call = { url, init, body: String(init.body ?? ''), target: headers['X-Amz-Target'] ?? '' }
    calls.push(call)
    const { status, json } = handler(call)
    return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } })
  }) as unknown as FetchLike & { mock: any }
  return { fetch, calls }
}

beforeEach(() => {
  resetCloudWatchEnsured()
})
afterEach(() => {
  for (const k of ['ALLOW_PRIVATE_EGRESS', 'LOG_EXPORT_ALLOW_INSTANCE_IDENTITY', 'LOG_EXPORT_AWS_ENDPOINT_URL']) delete process.env[k]
  setInstanceCredentialsForTests(null)
})

describe('PutLogEvents wire format', () => {
  it('one SigV4-signed request: target, content type, chronological events, the event JSON as message', async () => {
    const aws = fakeAws(() => ({ status: 200, json: { nextSequenceToken: 'ignored' } }))
    // Event 2 happened before event 1: the request is sorted by time, the cursor follows ids.
    const events = [event(1, { occurred_at: '2026-10-24T11:59:59.000Z' }), event(2, { occurred_at: '2026-10-24T11:59:58.000Z' })]
    const result = await deliverEvents('aws_cloudwatch_logs', events, ctx(), { fetch: aws.fetch })
    expect(result).toMatchObject({ sent: 2, sentThrough: 2, requests: 1, result: { kind: 'success' } })
    const [call] = aws.calls
    expect(call.url).toBe(ENDPOINT)
    const headers = call.init.headers as Record<string, string>
    expect(headers['X-Amz-Target']).toBe('Logs_20140328.PutLogEvents')
    expect(headers['Content-Type']).toBe('application/x-amz-json-1.1')
    expect(headers['x-amz-date']).toBe('20261024T120000Z')
    expect(headers.authorization).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${KEY_ID}/20261024/eu-west-1/logs/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$`))
    // The signature is the one an independent signing of the same request gives.
    const expected = signRequest({ method: 'POST', url: ENDPOINT, body: call.body, region: 'eu-west-1', service: 'logs', credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET_KEY }, now: NOW, headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'Logs_20140328.PutLogEvents' } })
    expect(headers.authorization).toBe(expected.authorization)
    const body = JSON.parse(call.body)
    expect(body).toMatchObject({ logGroupName: '/usertasks/events', logStreamName: 'prod' })
    expect(body).not.toHaveProperty('sequenceToken')
    expect(body.logEvents.map((e: any) => e.timestamp)).toEqual([Date.parse('2026-10-24T11:59:58.000Z'), Date.parse('2026-10-24T11:59:59.000Z')])
    expect(JSON.parse(body.logEvents[0].message)).toMatchObject({ id: 2, tenant_id: TENANT, type: 'workflow.run.completed', attributes: { status: 'completed' } })
    expect(call.body).not.toContain(SECRET_KEY)
  })

  it('China regions use the .amazonaws.com.cn endpoint; LOG_EXPORT_AWS_ENDPOINT_URL overrides (LocalStack, VPC endpoints)', () => {
    const [cn] = awsCloudWatchLogsFormatter.build([event(1)], ctx({ ...config, region: 'cn-north-1' }, creds, { awsCredentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET_KEY } }))
    expect(cn.url).toBe('https://logs.cn-north-1.amazonaws.com.cn/')
    process.env.LOG_EXPORT_AWS_ENDPOINT_URL = 'http://localstack:4566/'
    const [local] = awsCloudWatchLogsFormatter.build([event(1)], ctx(config, creds, { awsCredentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET_KEY } }))
    expect(local.url).toBe('http://localstack:4566/')
  })
})

describe('batching limits', () => {
  const withTs = (n: number, size = 10, spanMs = 0) => Array.from({ length: n }, (_, i) => ({ json: 'x'.repeat(size), eventId: i + 1, timestamp: NOW + Math.round((spanMs * i) / Math.max(1, n - 1)) }))

  it('at most 10,000 events per request', () => {
    const groups = chunkCloudWatch(withTs(CLOUDWATCH_MAX_EVENTS + 5))
    expect(groups.map((g) => g.entries.length)).toEqual([CLOUDWATCH_MAX_EVENTS, 5])
  })

  it('at most 1,048,576 bytes counting 26 bytes per event', () => {
    const size = 100_000
    const groups = chunkCloudWatch(withTs(25, size))
    for (const g of groups) expect(g.entries.length * (size + CLOUDWATCH_EVENT_OVERHEAD_BYTES)).toBeLessThanOrEqual(CLOUDWATCH_MAX_BATCH_BYTES)
    expect(groups[0].entries).toHaveLength(10)
    expect(groups.flatMap((g) => g.entries).map((e) => e.eventId)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
  })

  it('no request spans more than 24 hours', () => {
    const groups = chunkCloudWatch(withTs(5, 10, 48 * 3_600_000))
    for (const g of groups) expect(g.newest - g.oldest).toBeLessThanOrEqual(24 * 3_600_000)
    expect(groups.length).toBeGreaterThan(1)
  })

  it('out-of-order timestamps: sorted inside the request, cursor at the last id', () => {
    const events = [event(1, { occurred_at: '2026-10-24T11:00:03.000Z' }), event(2, { occurred_at: '2026-10-24T11:00:01.000Z' }), event(3, { occurred_at: '2026-10-24T11:00:02.000Z' })]
    const [req] = awsCloudWatchLogsFormatter.build(events, ctx(config, creds, { awsCredentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET_KEY } }))
    expect(JSON.parse(req.body).logEvents.map((e: any) => JSON.parse(e.message).id)).toEqual([2, 3, 1])
    expect(req.lastEventId).toBe(3)
  })

  it('an event over 256 KB keeps its message and drops its attributes', () => {
    const [req] = awsCloudWatchLogsFormatter.build([event(1, { attributes: { blob: 'z'.repeat(400_000) } })], ctx(config, creds, { awsCredentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET_KEY } }))
    const message = JSON.parse(JSON.parse(req.body).logEvents[0].message)
    expect(message.attributes).toEqual({ _truncated: true })
    expect(byteLength(req.body)).toBeLessThan(CLOUDWATCH_MAX_BATCH_BYTES)
  })
})

describe('errors, throttling and retries', () => {
  const err = (status: number, type: string, message = 'x') => () => ({ status, json: { __type: type, message } })

  it('ThrottlingException (HTTP 400) and 5xx are retried; DataAlreadyAccepted counts as delivered', async () => {
    expect((await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(), { fetch: fakeAws(err(400, 'ThrottlingException', 'Rate exceeded')).fetch })).result.kind).toBe('retry')
    expect((await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(), { fetch: fakeAws(err(503, 'ServiceUnavailableException')).fetch })).result.kind).toBe('retry')
    expect((await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(), { fetch: fakeAws(err(500, 'InternalFailure')).fetch })).result.kind).toBe('retry')
    const dup = await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(), { fetch: fakeAws(err(400, 'DataAlreadyAcceptedException')).fetch })
    expect(dup).toMatchObject({ sent: 1, sentThrough: 1, result: { kind: 'success' } })
    expect(classifyCloudWatch(400, '{"__type":"com.amazonaws.logs#ThrottlingException"}')).toBe('retry')
  })

  it('missing group, denied access and bad signatures are permanent and never echo the key', async () => {
    const missing = await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(), { fetch: fakeAws(err(400, 'ResourceNotFoundException', 'The specified log group does not exist.')).fetch })
    expect(missing.result).toMatchObject({ kind: 'permanent', status: 400 })
    expect(missing.result.error).toMatch(/ResourceNotFoundException/)
    const denied = await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(), { fetch: fakeAws(err(400, 'AccessDeniedException', `User is not authorized; key ${SECRET_KEY}`)).fetch })
    expect(denied.result.kind).toBe('permanent')
    expect(denied.result.error).not.toContain(SECRET_KEY)
    expect(denied.result.error).toContain('***')
  })

  it('a second batch after a failed first one is not sent (order kept)', async () => {
    const big = Array.from({ length: 12 }, (_, i) => event(i + 1, { attributes: { blob: 'q'.repeat(200_000) } }))
    let n = 0
    const aws = fakeAws(() => (++n === 1 ? { status: 200, json: {} } : { status: 400, json: { __type: 'ThrottlingException' } }))
    const result = await deliverEvents('aws_cloudwatch_logs', big, ctx(), { fetch: aws.fetch })
    expect(result.requests).toBe(2)
    expect(result.result.kind).toBe('retry')
    expect(result.sentThrough).toBe(result.sent)
    expect(result.sent).toBeGreaterThan(0)
    expect(result.sent).toBeLessThan(12)
  })
})

describe('auto_create', () => {
  it('creates the log group and stream once per process; "already exists" is fine', async () => {
    const aws = fakeAws((call) => {
      if (call.target.endsWith('CreateLogGroup')) return { status: 400, json: { __type: 'ResourceAlreadyExistsException', message: 'exists' } }
      return { status: 200, json: {} }
    })
    const cfg = { ...config, auto_create: true }
    await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(cfg), { fetch: aws.fetch })
    await deliverEvents('aws_cloudwatch_logs', [event(2)], ctx(cfg), { fetch: aws.fetch })
    expect(aws.calls.map((c) => c.target)).toEqual(['Logs_20140328.CreateLogGroup', 'Logs_20140328.CreateLogStream', 'Logs_20140328.PutLogEvents', 'Logs_20140328.PutLogEvents'])
    expect(JSON.parse(aws.calls[1].body)).toEqual({ logGroupName: '/usertasks/events', logStreamName: 'prod' })
  })

  it('a denied CreateLogGroup is permanent; a throttled one is retried', async () => {
    const cfg = { ...config, auto_create: true }
    const denied = await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(cfg), { fetch: fakeAws(() => ({ status: 400, json: { __type: 'AccessDeniedException', message: 'no logs:CreateLogGroup' } })).fetch })
    expect(denied.result).toMatchObject({ kind: 'permanent' })
    expect(denied.result.error).toMatch(/CreateLogGroup → HTTP 400/)
    const throttled = await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(cfg), { fetch: fakeAws(() => ({ status: 400, json: { __type: 'ThrottlingException' } })).fetch })
    expect(throttled.result.kind).toBe('retry')
  })
})

describe('credentials', () => {
  it('access_key needs both values (permanent when missing)', async () => {
    const result = await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(config, { access_key_id: KEY_ID }), { fetch: fakeAws(() => ({ status: 200 })).fetch })
    expect(result.result).toMatchObject({ kind: 'permanent' })
    expect(result.result.error).toMatch(/secret_access_key is not set/)
    expect(() => checkDestinationAuth('aws_cloudwatch_logs', config, { access_key_id: KEY_ID }, TENANT)).toThrow(/secret_access_key are required/)
    expect(() => checkDestinationAuth('aws_cloudwatch_logs', config, creds, TENANT)).not.toThrow()
  })

  it('the instance role only with LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true', async () => {
    const chain = vi.fn(async () => ({ accessKeyId: 'ASIAINSTANCE', secretAccessKey: 'instance-secret-value', sessionToken: 'instance-session' }))
    setInstanceCredentialsForTests(chain)
    const role = { ...config, auth: 'instance_role' }
    const denied = await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(role, {}), { fetch: fakeAws(() => ({ status: 200 })).fetch })
    expect(denied.result).toMatchObject({ kind: 'permanent' })
    expect(denied.result.error).toMatch(/LOG_EXPORT_ALLOW_INSTANCE_IDENTITY/)
    expect(chain).not.toHaveBeenCalled()
    expect(() => checkDestinationAuth('aws_cloudwatch_logs', role, {}, TENANT)).toThrow(/does not allow.*IAM access key/)

    process.env.LOG_EXPORT_ALLOW_INSTANCE_IDENTITY = 'true'
    expect(() => checkDestinationAuth('aws_cloudwatch_logs', role, {}, TENANT)).not.toThrow()
    const aws = fakeAws(() => ({ status: 200, json: {} }))
    const ok = await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(role, {}), { fetch: aws.fetch })
    expect(ok.result.kind).toBe('success')
    const headers = aws.calls[0].init.headers as Record<string, string>
    expect(headers.authorization).toContain('Credential=ASIAINSTANCE/')
    expect(headers['x-amz-security-token']).toBe('instance-session')
  })

  it('secret:// references: only under tenants/<workspace id>/, resolved from the secret store', async () => {
    const own = `secret://tenants/${TENANT}/cloudwatch-secret-key`
    expect(() => checkDestinationAuth('aws_cloudwatch_logs', config, { access_key_id: KEY_ID, secret_access_key: own }, TENANT)).not.toThrow()
    expect(() => checkDestinationAuth('aws_cloudwatch_logs', config, { access_key_id: KEY_ID, secret_access_key: 'secret://encryption-key' }, TENANT)).toThrow(/under tenants\//)
    expect(() => checkDestinationAuth('aws_cloudwatch_logs', config, { access_key_id: KEY_ID, secret_access_key: `secret://tenants/${TENANT}/../other` }, TENANT)).toThrow(/under tenants\//)

    // Shipping refuses a foreign reference too (stored before the check existed, or written directly).
    const foreign = await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(config, { access_key_id: KEY_ID, secret_access_key: 'secret://encryption-key' }), { fetch: fakeAws(() => ({ status: 200 })).fetch })
    expect(foreign.result).toMatchObject({ kind: 'permanent' })
    expect(foreign.result.error).toMatch(/under tenants\//)

    // The default env secret store: secret://tenants/<id>/cloudwatch-secret-key → TENANTS_<ID>_CLOUDWATCH_SECRET_KEY.
    const variable = `TENANTS_${TENANT.replace(/-/g, '_').toUpperCase()}_CLOUDWATCH_SECRET_KEY`
    process.env[variable] = SECRET_KEY
    try {
      const aws = fakeAws(() => ({ status: 200, json: {} }))
      const ok = await deliverEvents('aws_cloudwatch_logs', [event(1)], ctx(config, { access_key_id: KEY_ID, secret_access_key: own }), { fetch: aws.fetch })
      expect(ok.result.kind).toBe('success')
      const expected = signRequest({ method: 'POST', url: ENDPOINT, body: aws.calls[0].body, region: 'eu-west-1', service: 'logs', credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET_KEY }, now: NOW, headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'Logs_20140328.PutLogEvents' } })
      expect((aws.calls[0].init.headers as Record<string, string>).authorization).toBe(expected.authorization)
    } finally {
      delete process.env[variable]
    }
  })

  it('validates its config', () => {
    const schema = LOG_DESTINATION_SCHEMAS.aws_cloudwatch_logs.config
    expect(schema.parse({ region: 'eu-west-1', log_group_name: '/usertasks/events' })).toEqual({ region: 'eu-west-1', log_group_name: '/usertasks/events', log_stream_name: 'usertasks', auto_create: false, auth: 'access_key' })
    expect(schema.safeParse({ ...config, region: 'europe' }).success).toBe(false)
    expect(schema.safeParse({ ...config, log_group_name: 'bad group!' }).success).toBe(false)
    expect(schema.safeParse({ ...config, log_stream_name: 'a:b' }).success).toBe(false)
    expect(schema.safeParse({ ...config, endpoint: 'https://evil.example' }).success).toBe(false)
  })
})

describe('shipper with CloudWatch Logs', () => {
  function shipDb(dest: Record<string, unknown>) {
    return createMemorySupabase({
      event_stream: [1, 2].map((id) => ({ ...event(id), tenant_id: TENANT, occurred_at: new Date(NOW - 60_000 + id).toISOString() })),
      log_destinations: [{
        id: 'dest-1', tenant_id: TENANT, name: 'CW', filters: {}, enabled: true, cursor: 0, status: 'healthy', next_attempt_at: null, locked_by: 'w1', locked_at: new Date(NOW).toISOString(),
        events_sent: 0, last_success_at: null, last_error: null, last_error_at: null, consecutive_failures: 0, ...dest,
      }],
      notifications: [], users: [], user_roles: [],
    })
  }
  const credentials = () => ({ access_key_id: encryptSecret(KEY_ID), secret_access_key: encryptSecret(SECRET_KEY) })

  it('delivers, advances the cursor; a throttled batch is retried later and the key stays out of storage and logs', async () => {
    const db = shipDb({ type: 'aws_cloudwatch_logs', config, credentials: credentials() })
    const ok = fakeAws(() => ({ status: 200, json: {} }))
    const outcome = await shipDestination({ supabase: db as never, workerId: 'w1', now: () => NOW, random: () => 0.5, pollMs: 2000, fetch: ok.fetch, log: () => undefined }, { ...db.tables.log_destinations[0], purged_through: 0 } as unknown as ClaimedDestination, 2)
    expect(outcome).toMatchObject({ sent: 2, status: 'healthy', cursor: 2 })

    const db2 = shipDb({ type: 'aws_cloudwatch_logs', config, credentials: credentials() })
    const logs: string[] = []
    const throttled = fakeAws(() => ({ status: 400, json: { __type: 'ThrottlingException', message: `Rate exceeded for ${SECRET_KEY}` } }))
    await shipDestination({ supabase: db2 as never, workerId: 'w1', now: () => NOW, random: () => 0.5, pollMs: 2000, fetch: throttled.fetch, log: (m) => logs.push(m) }, { ...db2.tables.log_destinations[0], purged_through: 0 } as unknown as ClaimedDestination, 2)
    expect(db2.tables.log_destinations[0]).toMatchObject({ cursor: 0, status: 'retrying' })
    expect(db2.tables.log_destinations[0].next_attempt_at).toBeTruthy()
    expect(JSON.stringify(db2.tables)).not.toContain(SECRET_KEY)
    expect(logs.join('\n')).not.toContain(SECRET_KEY)
  })
})
