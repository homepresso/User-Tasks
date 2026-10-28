import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { deliverEvents } from '@/lib/log-export/deliver'
import { resetCloudWatchEnsured } from '@/lib/log-export/formats/aws-cloudwatch-logs'
import type { FormatContext, ShipEvent } from '@/lib/log-export/formats/types'
import { signRequest } from '@/lib/aws/sigv4'

/**
 * CloudWatch Logs destination end to end against LocalStack (community
 * edition, `logs` service). Runs when LOCALSTACK_URL is set, e.g.
 *
 *   docker run -d -p 4566:4566 -e SERVICES=logs localstack/localstack:4.9
 *   LOCALSTACK_URL=http://127.0.0.1:4566 npx vitest run __tests__/log-export-cloudwatch-localstack.test.ts
 *
 * With EVENT_STREAM_DB_URL as well, it also checks that the database accepts
 * the aws_cloudwatch_logs destination type (migration 20261111000000).
 */

const LOCALSTACK = process.env.LOCALSTACK_URL
const DB_URL = process.env.EVENT_STREAM_DB_URL
const TENANT = '0e000000-0000-4000-8000-0000000000c1'
const CREDS = { access_key_id: 'AKIALOCALSTACKTEST01', secret_access_key: 'localstack-secret-access-key-value' }
const region = 'eu-west-1'

function event(id: number, occurred: string, extra: Partial<ShipEvent> = {}): ShipEvent {
  return {
    id, occurred_at: occurred, type: 'workflow.run.completed', category: 'workflow', severity: 'info', message: `Run ${id} completed`,
    source_table: 'workflow_runs', source_id: `run-${id}`, trace_id: null, run_id: null, workflow_id: null, task_id: null, actor_id: null,
    attributes: { n: id }, ...extra,
  }
}

async function logsCall(action: string, payload: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any -- AWS JSON
  const url = `${LOCALSTACK!.replace(/\/+$/, '')}/`
  const body = JSON.stringify(payload)
  const headers = signRequest({
    method: 'POST', url, body, region, service: 'logs', credentials: { accessKeyId: CREDS.access_key_id, secretAccessKey: CREDS.secret_access_key },
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `Logs_20140328.${action}` },
  })
  delete headers.host
  const res = await fetch(url, { method: 'POST', headers, body })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${action} → ${res.status} ${JSON.stringify(json)}`)
  return json
}

describe.skipIf(!LOCALSTACK)('CloudWatch Logs destination against LocalStack', () => {
  const group = `/usertasks/e2e-${randomUUID().slice(0, 8)}`
  const ctx = (config: Record<string, unknown>): FormatContext => ({ tenantId: TENANT, destinationId: `cw-${group}`, config: { region, log_group_name: group, log_stream_name: 'events', auth: 'access_key', ...config }, credentials: CREDS })

  beforeAll(() => {
    process.env.LOG_EXPORT_AWS_ENDPOINT_URL = LOCALSTACK
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    resetCloudWatchEnsured()
  })
  afterAll(async () => {
    await logsCall('DeleteLogGroup', { logGroupName: group }).catch(() => undefined)
    delete process.env.LOG_EXPORT_AWS_ENDPOINT_URL
    delete process.env.ALLOW_PRIVATE_EGRESS
  })

  it('a missing log group is a permanent failure without auto_create', async () => {
    const result = await deliverEvents('aws_cloudwatch_logs', [event(1, new Date().toISOString())], ctx({ auto_create: false }))
    expect(result.result.kind).toBe('permanent')
    expect(result.result.error).toMatch(/ResourceNotFoundException/)
    expect(result.result.error).not.toContain(CREDS.secret_access_key)
  })

  it('auto_create, then PutLogEvents: events land in order, and later batches append (no sequence tokens)', async () => {
    const base = Date.now() - 60_000
    const first = [event(1, new Date(base + 2000).toISOString()), event(2, new Date(base + 1000).toISOString()), event(3, new Date(base + 3000).toISOString())]
    const r1 = await deliverEvents('aws_cloudwatch_logs', first, ctx({ auto_create: true }))
    expect(r1).toMatchObject({ sent: 3, sentThrough: 3, result: { kind: 'success' } })
    const r2 = await deliverEvents('aws_cloudwatch_logs', [event(4, new Date(base + 4000).toISOString())], ctx({ auto_create: true }))
    expect(r2.result.kind).toBe('success')

    const got = await logsCall('GetLogEvents', { logGroupName: group, logStreamName: 'events', startFromHead: true })
    const messages = (got.events as Array<{ timestamp: number; message: string }>)
    expect(messages.map((m) => JSON.parse(m.message).id)).toEqual([2, 1, 3, 4])
    expect(messages[0].timestamp).toBe(base + 1000)
    expect(JSON.parse(messages[0].message)).toMatchObject({ tenant_id: TENANT, type: 'workflow.run.completed', attributes: { n: 2 } })
  })

  it('a backlog over 1 MB goes out as several accepted batches', async () => {
    const now = Date.now()
    const events = Array.from({ length: 40 }, (_, i) => event(100 + i, new Date(now - 30_000 + i).toISOString(), { attributes: { blob: 'b'.repeat(60_000) } }))
    const result = await deliverEvents('aws_cloudwatch_logs', events, ctx({ auto_create: true }))
    expect(result).toMatchObject({ sent: 40, sentThrough: 139, result: { kind: 'success' } })
    expect(result.requests).toBeGreaterThan(1)
  })

  it.skipIf(!DB_URL)('the database accepts the aws_cloudwatch_logs type', async () => {
    const db = new Client({ connectionString: DB_URL })
    await db.connect()
    try {
      await db.query(`DELETE FROM public.tenants WHERE id = $1`, [TENANT])
      await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'CloudWatch E2E', 'cloudwatch-e2e')`, [TENANT])
      const { rows } = await db.query(
        `INSERT INTO public.log_destinations (tenant_id, name, type, config, enabled) VALUES ($1, 'cw', 'aws_cloudwatch_logs', $2, false) RETURNING type`,
        [TENANT, JSON.stringify({ region, log_group_name: group })],
      )
      expect(rows[0].type).toBe('aws_cloudwatch_logs')
    } finally {
      await db.query(`DELETE FROM public.tenants WHERE id = $1`, [TENANT]).catch(() => undefined)
      await db.end()
    }
  })
})
