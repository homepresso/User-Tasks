/**
 * Shared types and helpers for the log export formatters (one per destination
 * type). A formatter turns a batch of event_stream rows into one or more HTTP
 * requests that respect the vendor's size limits; the shipper sends them in
 * order and advances the destination cursor to each request's `lastEventId`
 * as it succeeds.
 *
 * Formatters are pure: no network, no clock unless passed in `now`.
 */

import type { EventRecord } from '@/lib/services/events'
import type { AwsCredentials } from '@/lib/aws/sigv4'

/* eslint-disable @typescript-eslint/no-explicit-any -- destination config/credentials are validated JSON */

/** An event_stream row as read by the shipper (ids may arrive as strings). */
export type ShipEvent = Omit<EventRecord, 'id'> & { id: number | string }

/** The JSON shape every destination receives for one event. */
export interface ExportedEvent {
  id: number
  tenant_id: string
  occurred_at: string
  type: string
  category: string
  severity: string
  message: string
  source_table: string
  source_id: string | null
  trace_id: string | null
  run_id: string | null
  workflow_id: string | null
  task_id: string | null
  actor_id: string | null
  attributes: Record<string, unknown>
}

export interface FormatContext {
  tenantId: string
  destinationId: string
  /** Validated, non-secret destination config (see lib/api-schemas/log-destinations). */
  config: Record<string, any>
  /** Decrypted credentials. Never logged. */
  credentials: Record<string, any>
  /** Clock (ms) for signatures / observed timestamps. */
  now?: () => number
  /** Bearer token from the formatter's authorize step (Entra ID / Google OAuth). Never logged. */
  accessToken?: string
  /** AWS credentials from the formatter's authorizeAws step (SigV4 signing). Never logged. */
  awsCredentials?: AwsCredentials
}

export interface OutboundRequest {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: string
  /** Events in this request. */
  eventCount: number
  /** Id of the last event in this request (the cursor after it succeeds). */
  lastEventId: number
  /**
   * Syslog (url syslog+tls:// | syslog+tcp:// | syslog+udp://): the framed
   * messages, sent over a socket instead of HTTP (one datagram each for udp).
   */
  messages?: string[]
  /** Syslog TLS options (server name, client certificate for mutual TLS). */
  tls?: { servername?: string; cert?: string; key?: string }
  /**
   * Vendor-specific reading of a non-2xx answer (e.g. CloudWatch's HTTP 400
   * ThrottlingException is a retry); null keeps the status-based kind.
   */
  classify?: (status: number, body: string) => 'success' | 'retry' | 'permanent' | null
}

export interface AuthorizeOptions {
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  now?: () => number
}

export interface Formatter {
  /** Build the request(s) for `events` (oldest first, non-empty). */
  build(events: ShipEvent[], ctx: FormatContext): OutboundRequest[]
  /**
   * Obtain the bearer token build() puts in its requests (cached until shortly
   * before it expires). Throws FormatterConfigError for unusable credentials
   * (permanent) and AuthorizeError for a token endpoint that failed (retry).
   */
  authorize?(ctx: FormatContext, options: AuthorizeOptions): Promise<string>
  /** Resolve the AWS credentials build() signs with (same error classes as authorize). */
  authorizeAws?(ctx: FormatContext, options: AuthorizeOptions): Promise<AwsCredentials>
  /**
   * One-off setup before the first batch, after authorization (e.g. creating
   * a CloudWatch log group); cached by the formatter. Same error classes.
   */
  prepare?(ctx: FormatContext, options: AuthorizeOptions & { assertUrl?: (url: string) => Promise<void> }): Promise<void>
}

/** The token endpoint could not be reached or answered 5xx / 429: retried. */
export class AuthorizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthorizeError'
  }
}

/** Thrown for configuration a destination cannot ship with (permanent failure). */
export class FormatterConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatterConfigError'
  }
}

export function toExportedEvent(event: ShipEvent, tenantId: string): ExportedEvent {
  return {
    id: Number(event.id),
    tenant_id: tenantId,
    occurred_at: event.occurred_at,
    type: event.type,
    category: event.category,
    severity: event.severity,
    message: event.message,
    source_table: event.source_table,
    source_id: event.source_id ?? null,
    trace_id: event.trace_id ?? null,
    run_id: event.run_id ?? null,
    workflow_id: event.workflow_id ?? null,
    task_id: event.task_id ?? null,
    actor_id: event.actor_id ?? null,
    attributes: event.attributes && typeof event.attributes === 'object' ? event.attributes : {},
  }
}

export const byteLength = (text: string) => Buffer.byteLength(text, 'utf8')

export interface BatchLimits {
  /** Max request body bytes (including wrapper and separators). */
  maxBytes: number
  /** Max entries per request. */
  maxEntries: number
  /** Max bytes of one serialized entry (defaults to what fits in maxBytes). */
  maxEntryBytes?: number
  /** Bytes the wrapper adds around the entries (e.g. `[` `]`). */
  wrapperBytes: number
  /** Bytes between two entries (e.g. `,` or `\n`). */
  separatorBytes: number
}

export interface SerializedEntry {
  json: string
  eventId: number
}

/**
 * Serialize one event entry; an entry above `maxEntryBytes` is re-built with
 * its attributes replaced by `{ _truncated: true }` so one oversized event can
 * never block a destination.
 */
export function serializeEntry(
  event: ExportedEvent,
  build: (event: ExportedEvent) => unknown,
  maxEntryBytes: number,
): SerializedEntry {
  let json = JSON.stringify(build(event))
  if (byteLength(json) > maxEntryBytes) {
    json = JSON.stringify(build({ ...event, message: event.message.slice(0, 1000), attributes: { _truncated: true } }))
  }
  return { json, eventId: event.id }
}

/** Split serialized entries into request-sized groups (order kept). */
export function chunkEntries(entries: SerializedEntry[], limits: BatchLimits): SerializedEntry[][] {
  const groups: SerializedEntry[][] = []
  let current: SerializedEntry[] = []
  let size = limits.wrapperBytes
  for (const entry of entries) {
    const entryBytes = byteLength(entry.json)
    const added = (current.length ? limits.separatorBytes : 0) + entryBytes
    if (current.length && (size + added > limits.maxBytes || current.length >= limits.maxEntries)) {
      groups.push(current)
      current = []
      size = limits.wrapperBytes
    }
    size += (current.length ? limits.separatorBytes : 0) + entryBytes
    current.push(entry)
  }
  if (current.length) groups.push(current)
  return groups
}

/**
 * Header names/values from credentials.headers (values never echoed in
 * errors). Names in `reserved` (case-insensitive) are dropped so they cannot
 * replace the formatter's own headers.
 */
export function customHeaders(credentials: Record<string, any>, reserved: readonly string[] = ['content-type']): Record<string, string> {
  const raw = credentials?.headers
  if (!raw || typeof raw !== 'object') return {}
  const blocked = new Set(reserved.map((name) => name.toLowerCase()))
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string' || blocked.has(name.toLowerCase())) continue
    if (/[\r\n\0]/.test(value)) throw new FormatterConfigError(`credentials.headers.${name} contains a line break or NUL`)
    out[name] = value
  }
  return out
}

/** Strip a trailing slash. */
export const trimSlash = (url: string) => url.replace(/\/+$/, '')
