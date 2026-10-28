import { afterEach, describe, expect, it } from 'vitest'
import { datadogEntry, datadogFormatter, datadogIntakeUrl, DATADOG_MAX_ENTRIES } from '@/lib/log-export/formats/datadog'
import { OTLP_SEVERITY, otlpHttpFormatter, otlpLogsUrl, otlpTraceId, unixNano } from '@/lib/log-export/formats/otlp-http'
import { SPLUNK_MAX_REQUEST_BYTES, splunkEventUrl, splunkHecFormatter } from '@/lib/log-export/formats/splunk-hec'
import { byteLength, chunkEntries, FormatterConfigError, toExportedEvent, type FormatContext, type ShipEvent } from '@/lib/log-export/formats/types'
import {
  signWebhookBody,
  verifyWebhookSignature,
  WEBHOOK_MAX_EVENTS,
  webhookFormatter,
} from '@/lib/log-export/formats/webhook'

/* eslint-disable @typescript-eslint/no-explicit-any -- parsed payloads */

const TENANT = '7a000000-0000-4000-8000-000000000001'
const TRACE = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const NOW = Date.parse('2026-10-24T12:00:00.000Z')

function event(id: number, overrides: Partial<ShipEvent> = {}): ShipEvent {
  return {
    id,
    occurred_at: '2026-10-24T11:59:58.250Z',
    type: 'workflow.run.completed',
    category: 'workflow',
    severity: 'info',
    message: `Run ${id} completed`,
    source_table: 'workflow_runs',
    source_id: `run-${id}`,
    trace_id: TRACE,
    run_id: 'b1000000-0000-4000-8000-000000000001',
    workflow_id: 'b2000000-0000-4000-8000-000000000002',
    task_id: null,
    actor_id: null,
    attributes: { duration_ms: 1200, status: 'completed' },
    ...overrides,
  }
}

const ctx = (config: Record<string, any>, credentials: Record<string, any>): FormatContext => ({
  tenantId: TENANT, destinationId: 'dest-1', config, credentials, now: () => NOW,
})

afterEach(() => { delete process.env.LOG_EXPORT_DATADOG_URL })

describe('exported event shape', () => {
  it('is the stable public event JSON with tenant id and numeric id', () => {
    expect(toExportedEvent(event(42, { id: '42' }), TENANT)).toEqual({
      id: 42, tenant_id: TENANT, occurred_at: '2026-10-24T11:59:58.250Z', type: 'workflow.run.completed', category: 'workflow',
      severity: 'info', message: 'Run 42 completed', source_table: 'workflow_runs', source_id: 'run-42', trace_id: TRACE,
      run_id: 'b1000000-0000-4000-8000-000000000001', workflow_id: 'b2000000-0000-4000-8000-000000000002',
      task_id: null, actor_id: null, attributes: { duration_ms: 1200, status: 'completed' },
    })
  })
})

describe('Splunk HEC', () => {
  const credentials = { token: 'hec-token-123' }

  it('accepts the base URL or the collector path', () => {
    expect(splunkEventUrl('https://splunk.example.com:8088')).toBe('https://splunk.example.com:8088/services/collector/event')
    expect(splunkEventUrl('https://splunk.example.com:8088/')).toBe('https://splunk.example.com:8088/services/collector/event')
    expect(splunkEventUrl('https://splunk.example.com:8088/services/collector')).toBe('https://splunk.example.com:8088/services/collector/event')
    expect(splunkEventUrl('https://splunk.example.com:8088/services/collector/event')).toBe('https://splunk.example.com:8088/services/collector/event')
  })

  it('builds NDJSON HEC events with Authorization: Splunk <token>', () => {
    const [request, ...rest] = splunkHecFormatter.build([event(1), event(2, { severity: 'error' })], ctx({ url: 'https://splunk.example.com:8088', index: 'ut', sourcetype: 'ut:events' }, credentials))
    expect(rest).toHaveLength(0)
    expect(request.url).toBe('https://splunk.example.com:8088/services/collector/event')
    expect(request.headers).toEqual({ Authorization: 'Splunk hec-token-123', 'Content-Type': 'application/json' })
    expect(request.eventCount).toBe(2)
    expect(request.lastEventId).toBe(2)
    const lines = request.body.split('\n').map((line) => JSON.parse(line))
    expect(lines).toHaveLength(2)
    // Documented HEC event shape: time (epoch seconds), host, source, sourcetype, index, event.
    expect(lines[0]).toEqual({
      time: 1792843198.25, host: 'usertasks', source: 'usertasks', sourcetype: 'ut:events', index: 'ut',
      event: toExportedEvent(event(1), TENANT),
    })
    expect(lines[1].event.severity).toBe('error')
  })

  it('omits index when unset and uses defaults', () => {
    const [request] = splunkHecFormatter.build([event(1)], ctx({ url: 'https://s:8088', host: 'ut-prod' }, credentials))
    const line = JSON.parse(request.body)
    expect(line).not.toHaveProperty('index')
    expect(line).toMatchObject({ host: 'ut-prod', source: 'usertasks', sourcetype: 'usertasks:event' })
  })

  it('splits requests at 1 MB', () => {
    const big = 'x'.repeat(300_000)
    const events = Array.from({ length: 7 }, (_, i) => event(i + 1, { attributes: { blob: big } }))
    const requests = splunkHecFormatter.build(events, ctx({ url: 'https://s:8088' }, credentials))
    expect(requests.length).toBeGreaterThan(1)
    for (const r of requests) expect(byteLength(r.body)).toBeLessThanOrEqual(SPLUNK_MAX_REQUEST_BYTES)
    expect(requests.reduce((n, r) => n + r.eventCount, 0)).toBe(7)
    expect(requests.map((r) => r.lastEventId)).toEqual([...requests.map((r) => r.lastEventId)].sort((a, b) => a - b))
    expect(requests[requests.length - 1].lastEventId).toBe(7)
  })

  it('rejects verify_tls=false and a missing token', () => {
    expect(() => splunkHecFormatter.build([event(1)], ctx({ url: 'https://s:8088', verify_tls: false }, credentials))).toThrow(FormatterConfigError)
    expect(() => splunkHecFormatter.build([event(1)], ctx({ url: 'https://s:8088' }, {}))).toThrow(/token/)
  })
})

describe('Datadog', () => {
  const credentials = { api_key: 'dd-key-abc' }

  it('posts to the site intake with DD-API-KEY (overridable by LOG_EXPORT_DATADOG_URL)', () => {
    expect(datadogIntakeUrl('datadoghq.eu')).toBe('https://http-intake.logs.datadoghq.eu/api/v2/logs')
    expect(datadogIntakeUrl(undefined)).toBe('https://http-intake.logs.datadoghq.com/api/v2/logs')
    process.env.LOG_EXPORT_DATADOG_URL = 'http://127.0.0.1:9999/api/v2/logs'
    expect(datadogIntakeUrl('datadoghq.eu')).toBe('http://127.0.0.1:9999/api/v2/logs')
  })

  it('builds the documented log entry array', () => {
    const [request] = datadogFormatter.build([event(5, { severity: 'warn' })], ctx({ site: 'us5.datadoghq.com', service: 'ut', tags: ['env:prod'] }, credentials))
    expect(request.url).toBe('https://http-intake.logs.us5.datadoghq.com/api/v2/logs')
    expect(request.headers).toEqual({ 'DD-API-KEY': 'dd-key-abc', 'Content-Type': 'application/json' })
    const body = JSON.parse(request.body)
    expect(Array.isArray(body)).toBe(true)
    const rest: Record<string, unknown> = { ...toExportedEvent(event(5, { severity: 'warn' }), TENANT) }
    delete rest.message
    expect(body[0]).toEqual({
      ddsource: 'usertasks', service: 'ut',
      ddtags: `tenant_id:${TENANT},category:workflow,event_type:workflow.run.completed,env:prod`,
      status: 'warning', message: 'Run 5 completed', date: '2026-10-24T11:59:58.250Z', ...rest,
    })
  })

  it('maps severities to Datadog statuses', () => {
    const status = (severity: string) => datadogEntry(toExportedEvent(event(1, { severity: severity as any }), TENANT), {}).status
    expect(['debug', 'info', 'warn', 'error'].map(status)).toEqual(['debug', 'info', 'warning', 'error'])
  })

  it('batches at 1000 entries and keeps oversized entries under 1 MB', () => {
    const many = Array.from({ length: 1500 }, (_, i) => event(i + 1))
    const requests = datadogFormatter.build(many, ctx({}, credentials))
    expect(requests.map((r) => r.eventCount)).toEqual([DATADOG_MAX_ENTRIES, 500])
    expect(requests.map((r) => r.lastEventId)).toEqual([1000, 1500])

    const [huge] = datadogFormatter.build([event(9, { attributes: { blob: 'y'.repeat(1_200_000) } })], ctx({}, credentials))
    expect(byteLength(huge.body)).toBeLessThan(1_000_000)
    expect(JSON.parse(huge.body)[0].attributes).toEqual({ _truncated: true })
  })

  it('batches at 5 MB', () => {
    const events = Array.from({ length: 12 }, (_, i) => event(i + 1, { attributes: { blob: 'z'.repeat(900_000) } }))
    const requests = datadogFormatter.build(events, ctx({}, credentials))
    expect(requests.length).toBeGreaterThan(2)
    for (const r of requests) expect(byteLength(r.body)).toBeLessThanOrEqual(5_000_000)
  })
})

describe('OTLP/HTTP', () => {
  it('normalizes the endpoint', () => {
    expect(otlpLogsUrl('https://otel.example.com:4318')).toBe('https://otel.example.com:4318/v1/logs')
    expect(otlpLogsUrl('https://otel.example.com:4318/v1/logs')).toBe('https://otel.example.com:4318/v1/logs')
    expect(otlpLogsUrl('https://otlp.eu01.nr-data.net/')).toBe('https://otlp.eu01.nr-data.net/v1/logs')
  })

  it('maps severities to OTLP severity numbers', () => {
    expect(Object.fromEntries(Object.entries(OTLP_SEVERITY).map(([k, v]) => [k, v.number]))).toEqual({ debug: 5, info: 9, warn: 13, error: 17 })
  })

  it('only sends 32-hex trace ids', () => {
    expect(otlpTraceId(TRACE)).toBe('3f2504e04f8911d39a0c0305e82c3301')
    expect(otlpTraceId(null)).toBeNull()
    expect(otlpTraceId('not-a-trace')).toBeNull()
    expect(otlpTraceId('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('builds ExportLogsServiceRequest JSON per the OTLP spec', () => {
    const [request] = otlpHttpFormatter.build(
      [event(7, { severity: 'error' }), event(8, { trace_id: null, attributes: { nested: { a: [1, true] }, ratio: 0.5 } })],
      ctx({ endpoint: 'https://otel.example.com:4318', resource_attributes: { 'deployment.environment': 'prod', 'service.name': 'ut-prod' } }, { headers: { 'x-honeycomb-team': 'hc-key', 'Content-Type': 'text/plain' } }),
    )
    expect(request.url).toBe('https://otel.example.com:4318/v1/logs')
    expect(request.headers).toEqual({ 'x-honeycomb-team': 'hc-key', 'Content-Type': 'application/json' })
    const body = JSON.parse(request.body)
    expect(body.resourceLogs).toHaveLength(1)
    expect(body.resourceLogs[0].resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'ut-prod' } },
      { key: 'tenant.id', value: { stringValue: TENANT } },
      { key: 'deployment.environment', value: { stringValue: 'prod' } },
    ])
    const scope = body.resourceLogs[0].scopeLogs[0]
    expect(scope.scope).toEqual({ name: 'usertasks.event_stream' })
    const [first, second] = scope.logRecords
    expect(first).toMatchObject({
      timeUnixNano: '1792843198250000000',
      observedTimeUnixNano: String(BigInt(NOW) * BigInt(1_000_000)),
      severityNumber: 17,
      severityText: 'ERROR',
      body: { stringValue: 'Run 7 completed' },
      traceId: '3f2504e04f8911d39a0c0305e82c3301',
    })
    expect(typeof first.timeUnixNano).toBe('string')
    expect(first.attributes).toEqual(expect.arrayContaining([
      { key: 'event.name', value: { stringValue: 'workflow.run.completed' } },
      { key: 'usertasks.event.id', value: { intValue: '7' } },
      { key: 'usertasks.category', value: { stringValue: 'workflow' } },
      { key: 'usertasks.run_id', value: { stringValue: 'b1000000-0000-4000-8000-000000000001' } },
      { key: 'usertasks.attr.duration_ms', value: { intValue: '1200' } },
    ]))
    for (const attr of first.attributes) expect(Object.keys(attr).sort()).toEqual(['key', 'value'])
    expect(second).not.toHaveProperty('traceId')
    expect(second.attributes).toEqual(expect.arrayContaining([
      { key: 'usertasks.attr.nested', value: { kvlistValue: { values: [{ key: 'a', value: { arrayValue: { values: [{ intValue: '1' }, { boolValue: true }] } } }] } } },
      { key: 'usertasks.attr.ratio', value: { doubleValue: 0.5 } },
    ]))
  })

  it('converts timestamps to nanosecond strings', () => {
    expect(unixNano('1970-01-01T00:00:01.000Z')).toBe('1000000000')
  })

  it('survives a resource attribute containing the internal placeholder', () => {
    const [request] = otlpHttpFormatter.build([event(1)], ctx({ endpoint: 'https://o:4318', resource_attributes: { x: '__RECORDS__' } }, {}))
    const body = JSON.parse(request.body)
    expect(body.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1)
  })
})

describe('webhook', () => {
  const secret = 'whsec_test_secret_value_1234567890'

  it('signs {events:[...]} with t=<unix>,v1=<hmac> and counts events', () => {
    const [request] = webhookFormatter.build([event(1), event(2)], ctx({ url: 'https://hooks.example.com/ut' }, { signing_secret: secret, headers: { 'X-Team': 'ops', 'x-usertasks-signature': 'forged' } }))
    expect(request.url).toBe('https://hooks.example.com/ut')
    expect(request.headers['Content-Type']).toBe('application/json')
    expect(request.headers['X-UserTasks-Event-Count']).toBe('2')
    expect(request.headers['X-Team']).toBe('ops')
    expect(Object.keys(request.headers).filter((h) => h.toLowerCase() === 'x-usertasks-signature')).toEqual(['X-UserTasks-Signature'])
    const t = Math.floor(NOW / 1000)
    expect(request.headers['X-UserTasks-Signature']).toBe(`t=${t},v1=${signWebhookBody(secret, t, request.body)}`)
    expect(JSON.parse(request.body)).toEqual({ events: [toExportedEvent(event(1), TENANT), toExportedEvent(event(2), TENANT)] })
    expect(request.body).not.toContain(secret)
  })

  it('verifyWebhookSignature accepts valid signatures and rejects tampering, replay and garbage', () => {
    const [request] = webhookFormatter.build([event(1)], ctx({ url: 'https://h.example.com' }, { signing_secret: secret }))
    const header = request.headers['X-UserTasks-Signature']
    expect(verifyWebhookSignature(secret, header, request.body, { now: NOW })).toBe(true)
    expect(verifyWebhookSignature(secret, header, request.body.replace('Run 1', 'Run 9'), { now: NOW })).toBe(false)
    expect(verifyWebhookSignature('wrong-secret-wrong-secret', header, request.body, { now: NOW })).toBe(false)
    expect(verifyWebhookSignature(secret, header, request.body, { now: NOW + 301_000 })).toBe(false)
    expect(verifyWebhookSignature(secret, header, request.body, { now: NOW + 601_000, toleranceSeconds: 700 })).toBe(true)
    expect(verifyWebhookSignature(secret, 'v1=abc', request.body, { now: NOW })).toBe(false)
    expect(verifyWebhookSignature(secret, null, request.body, { now: NOW })).toBe(false)
    // Rotation: any matching v1 passes.
    const t = Math.floor(NOW / 1000)
    expect(verifyWebhookSignature(secret, `t=${t},v1=${'0'.repeat(64)},v1=${signWebhookBody(secret, t, request.body)}`, request.body, { now: NOW })).toBe(true)
  })

  it('batches at 500 events', () => {
    const requests = webhookFormatter.build(Array.from({ length: 1200 }, (_, i) => event(i + 1)), ctx({ url: 'https://h.example.com' }, { signing_secret: secret }))
    expect(requests.map((r) => r.eventCount)).toEqual([WEBHOOK_MAX_EVENTS, WEBHOOK_MAX_EVENTS, 200])
    for (const r of requests) expect(verifyWebhookSignature(secret, r.headers['X-UserTasks-Signature'], r.body, { now: NOW })).toBe(true)
  })

  it('rejects header values with line breaks without echoing them', () => {
    try {
      webhookFormatter.build([event(1)], ctx({ url: 'https://h.example.com' }, { signing_secret: secret, headers: { 'X-Key': 'abc\r\nInjected: 1' } }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(FormatterConfigError)
      expect((error as Error).message).not.toContain('abc')
    }
  })
})

describe('chunkEntries', () => {
  it('respects bytes, entry count and order', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ json: 'x'.repeat(10), eventId: i + 1 }))
    expect(chunkEntries(entries, { maxBytes: 35, maxEntries: 100, wrapperBytes: 2, separatorBytes: 1 }).map((g) => g.map((e) => e.eventId)))
      .toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]])
    expect(chunkEntries(entries, { maxBytes: 1e6, maxEntries: 4, wrapperBytes: 0, separatorBytes: 0 }).map((g) => g.length)).toEqual([4, 4, 2])
  })
})
