/**
 * Amazon CloudWatch Logs (PutLogEvents).
 *
 *   POST https://logs.<region>.amazonaws.com/
 *   X-Amz-Target: Logs_20140328.PutLogEvents
 *   Content-Type: application/x-amz-json-1.1
 *   Authorization: AWS4-HMAC-SHA256 … (SigV4, service "logs")
 *   body: { logGroupName, logStreamName, logEvents: [{ timestamp, message }] }
 *
 * Batches follow the PutLogEvents limits: at most 1,048,576 bytes (each
 * event's UTF-8 message plus 26 bytes), 10,000 events, and 24 hours between
 * the oldest and newest event; within a request, events are sorted by
 * timestamp (the cursor still advances in event id order). One event is at
 * most 256 KB (larger ones keep the message and drop the attributes).
 * Sequence tokens are no longer required by CloudWatch and are not sent.
 * CloudWatch itself drops events older than 14 days or more than 2 hours in
 * the future (reported as rejectedLogEventsInfo on a successful call).
 *
 * Errors: CloudWatch answers throttling with HTTP 400 ThrottlingException,
 * which is retried like a 429 (as are ServiceUnavailable / InternalFailure);
 * DataAlreadyAcceptedException counts as delivered. ResourceNotFoundException
 * is permanent unless auto_create is on, in which case the log group and
 * stream are created once per process before the first batch
 * (logs:CreateLogGroup, logs:CreateLogStream; "already exists" is fine).
 *
 * Credentials (lib/log-export/cloud-auth awsCredentialsFor): an IAM access
 * key stored with the destination (encrypted; either value may be a
 * secret://tenants/<workspace id>/… reference), or the instance's own role
 * (auth=instance_role; ECS task role, instance profile, IRSA) when the
 * operator allows it with LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true.
 * LOG_EXPORT_AWS_ENDPOINT_URL (operator) replaces the endpoint (VPC
 * endpoints, LocalStack).
 */

import { awsCredentialsFor } from '../cloud-auth'
import { signRequest, type AwsCredentials } from '@/lib/aws/sigv4'
import {
  AuthorizeError,
  byteLength,
  FormatterConfigError,
  serializeEntry,
  toExportedEvent,
  trimSlash,
  type AuthorizeOptions,
  type FormatContext,
  type Formatter,
  type OutboundRequest,
  type SerializedEntry,
  type ShipEvent,
} from './types'

export const CLOUDWATCH_MAX_BATCH_BYTES = 1_048_576
export const CLOUDWATCH_EVENT_OVERHEAD_BYTES = 26
export const CLOUDWATCH_MAX_EVENTS = 10_000
export const CLOUDWATCH_MAX_SPAN_MS = 24 * 3_600_000
export const CLOUDWATCH_MAX_EVENT_BYTES = 256_000
const TARGET_PREFIX = 'Logs_20140328'

export function cloudWatchEndpoint(region: string): string {
  const override = process.env.LOG_EXPORT_AWS_ENDPOINT_URL?.trim()
  if (override) return `${trimSlash(override)}/`
  return `https://logs.${region}.amazonaws.com${region.startsWith('cn-') ? '.cn' : ''}/`
}

const errorType = (text: string) => /"__type"\s*:\s*"(?:[^"#]*#)?([A-Za-z]+)"/.exec(text)?.[1] ?? /x-amzn-ErrorType:?\s*([A-Za-z]+)/i.exec(text)?.[1] ?? null

const RETRYABLE = new Set(['ThrottlingException', 'ServiceUnavailableException', 'InternalFailure', 'RequestTimeout', 'RequestTimeoutException', 'InvalidSequenceTokenException', 'LimitExceededException'])

/** CloudWatch's error type decides retry vs. permanent (throttling arrives as HTTP 400). */
export function classifyCloudWatch(status: number, text: string): 'success' | 'retry' | 'permanent' | null {
  const type = errorType(text)
  if (type === 'DataAlreadyAcceptedException') return 'success'
  if (type && RETRYABLE.has(type)) return 'retry'
  if (status >= 400 && status < 500 && type) return 'permanent'
  return null
}

interface Group {
  entries: Array<SerializedEntry & { timestamp: number }>
  bytes: number
  oldest: number
  newest: number
}

/** Split entries (in event id order) into PutLogEvents batches. */
export function chunkCloudWatch(entries: Array<SerializedEntry & { timestamp: number }>): Group[] {
  const groups: Group[] = []
  let current: Group | null = null
  for (const entry of entries) {
    const size = byteLength(entry.json) + CLOUDWATCH_EVENT_OVERHEAD_BYTES
    if (current) {
      const oldest = Math.min(current.oldest, entry.timestamp)
      const newest = Math.max(current.newest, entry.timestamp)
      if (current.bytes + size > CLOUDWATCH_MAX_BATCH_BYTES || current.entries.length >= CLOUDWATCH_MAX_EVENTS || newest - oldest > CLOUDWATCH_MAX_SPAN_MS) {
        groups.push(current)
        current = null
      } else {
        current.entries.push(entry)
        current.bytes += size
        current.oldest = oldest
        current.newest = newest
        continue
      }
    }
    current = { entries: [entry], bytes: size, oldest: entry.timestamp, newest: entry.timestamp }
  }
  if (current) groups.push(current)
  return groups
}

function names(ctx: FormatContext): { group: string; stream: string } {
  const group = String(ctx.config.log_group_name ?? '')
  const stream = String(ctx.config.log_stream_name ?? 'usertasks')
  if (!group) throw new FormatterConfigError('config.log_group_name is required')
  return { group, stream }
}

function signedCall(ctx: FormatContext, action: string, payload: unknown, now: number): { url: string; headers: Record<string, string>; body: string } {
  const credentials = ctx.awsCredentials
  if (!credentials) throw new FormatterConfigError('no AWS credentials')
  const region = String(ctx.config.region)
  const url = cloudWatchEndpoint(region)
  const body = JSON.stringify(payload)
  const headers = signRequest({
    method: 'POST', url, body, region, service: 'logs', credentials, now,
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `${TARGET_PREFIX}.${action}` },
  })
  delete headers.host // fetch sets Host itself (it is signed with the same value)
  return { url, headers, body }
}

const ensured = new Set<string>()
const MAX_ENSURED = 1000

/** Forget which log groups / streams were created (tests). */
export function resetCloudWatchEnsured(): void {
  ensured.clear()
}

async function ensureLogStream(ctx: FormatContext, options: AuthorizeOptions & { assertUrl?: (url: string) => Promise<void> }): Promise<void> {
  const { group, stream } = names(ctx)
  const region = String(ctx.config.region)
  const key = `${ctx.destinationId}|${cloudWatchEndpoint(region)}|${group}|${stream}`
  if (ensured.has(key)) return
  const now = (options.now ?? Date.now)()
  for (const [action, payload] of [
    ['CreateLogGroup', { logGroupName: group }],
    ['CreateLogStream', { logGroupName: group, logStreamName: stream }],
  ] as const) {
    const call = signedCall(ctx, action, payload, now)
    await options.assertUrl?.(call.url)
    let res: Response
    try {
      res = await (options.fetch ?? fetch)(call.url, { method: 'POST', headers: call.headers, body: call.body, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    } catch (error) {
      throw new AuthorizeError(`CloudWatch Logs ${action} failed: ${(error as Error).message}`)
    }
    if (res.ok) { await res.body?.cancel().catch(() => {}); continue }
    const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    if (errorType(text) === 'ResourceAlreadyExistsException') continue
    const kind = classifyCloudWatch(res.status, text) ?? (res.status === 429 || res.status >= 500 ? 'retry' : 'permanent')
    const message = `CloudWatch Logs ${action} → HTTP ${res.status}: ${text}`
    throw kind === 'retry' ? new AuthorizeError(message) : new FormatterConfigError(message)
  }
  if (ensured.size >= MAX_ENSURED) ensured.delete(ensured.values().next().value!)
  ensured.add(key)
}

export const awsCloudWatchLogsFormatter: Formatter = {
  authorizeAws(ctx): Promise<AwsCredentials> {
    return awsCredentialsFor(ctx)
  },
  async prepare(ctx, options) {
    if (ctx.config.auto_create === true) await ensureLogStream(ctx, options)
  },
  build(events: ShipEvent[], ctx: FormatContext): OutboundRequest[] {
    const { group, stream } = names(ctx)
    const now = (ctx.now ?? Date.now)()
    const entries = events.map((e) => {
      const exported = toExportedEvent(e, ctx.tenantId)
      const parsed = Date.parse(exported.occurred_at)
      return { ...serializeEntry(exported, (ev) => ev, CLOUDWATCH_MAX_EVENT_BYTES), timestamp: Number.isFinite(parsed) ? parsed : now }
    })
    return chunkCloudWatch(entries).map((batch) => {
      // Chronological inside the request (stable for equal timestamps); the cursor follows event ids.
      const logEvents = [...batch.entries].sort((a, b) => a.timestamp - b.timestamp || a.eventId - b.eventId)
      const call = signedCall(ctx, 'PutLogEvents', {
        logGroupName: group,
        logStreamName: stream,
        logEvents: logEvents.map((entry) => ({ timestamp: entry.timestamp, message: entry.json })),
      }, now)
      return {
        url: call.url,
        method: 'POST' as const,
        headers: call.headers,
        body: call.body,
        eventCount: batch.entries.length,
        lastEventId: batch.entries[batch.entries.length - 1].eventId,
        classify: classifyCloudWatch,
      }
    })
  },
}
