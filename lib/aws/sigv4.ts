import { createHash, createHmac } from 'node:crypto'

/**
 * AWS Signature Version 4, synchronous and dependency-free (node:crypto), for
 * the places that sign without an AWS SDK client:
 *
 *  - the CloudWatch Logs log destination (header-signed JSON requests, built
 *    inside the pure formatter step);
 *  - ElastiCache / MemoryDB IAM auth tokens (a presigned `connect` URL used
 *    as the Redis AUTH password).
 *
 * RDS IAM tokens come from @aws-sdk/rds-signer (lib/providers/db/pg-auth);
 * __tests__/aws-sigv4.test.ts checks this signer against the SDK's
 * (@smithy/signature-v4) for both header signing and presigning.
 *
 * Paths are encoded once per segment (the services signed here only use `/`).
 * Nothing here logs; callers must never put a secret key or a signature in an
 * error message.
 */

export interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  /** When temporary credentials stop working. */
  expiration?: Date
}

export interface SignInput {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  region: string
  service: string
  credentials: AwsCredentials
  /** Clock (ms). */
  now?: number
}

const ALGORITHM = 'AWS4-HMAC-SHA256'
export const EMPTY_SHA256 = createHash('sha256').update('').digest('hex')

const sha256Hex = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex')
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest()

/** RFC 3986 encoding (what SigV4 wants; encodeURIComponent leaves !'()* alone). */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** 20150830T123600Z and 20150830 for a clock value. */
export function amzDate(now: number): { dateTime: string; date: string } {
  const dateTime = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return { dateTime, date: dateTime.slice(0, 8) }
}

function canonicalPath(pathname: string): string {
  if (!pathname || pathname === '/') return '/'
  return pathname.split('/').map((segment) => rfc3986(decodeURIComponent(segment))).join('/')
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request')
}

function canonicalHeaders(headers: Record<string, string>): { canonical: string; signed: string } {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase().trim(), String(value).trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return {
    canonical: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: entries.map(([name]) => name).join(';'),
  }
}

function signature(input: { method: string; url: URL; query: URLSearchParams; headers: Record<string, string>; payloadHash: string; dateTime: string; scope: string; key: Buffer }) {
  const { canonical, signed } = canonicalHeaders(input.headers)
  const request = [input.method.toUpperCase(), canonicalPath(input.url.pathname), canonicalQuery(input.query), canonical, signed, input.payloadHash].join('\n')
  const toSign = [ALGORITHM, input.dateTime, input.scope, sha256Hex(request)].join('\n')
  return { signedHeaders: signed, signature: createHmac('sha256', input.key).update(toSign, 'utf8').digest('hex') }
}

/**
 * Sign a request with an Authorization header. Returns the headers to send:
 * the caller's, plus host, x-amz-date, x-amz-security-token (temporary
 * credentials) and authorization.
 */
export function signRequest(input: SignInput): Record<string, string> {
  const url = new URL(input.url)
  const { dateTime, date } = amzDate(input.now ?? Date.now())
  const scope = `${date}/${input.region}/${input.service}/aws4_request`
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (!['authorization', 'x-amz-date', 'x-amz-security-token', 'host'].includes(name.toLowerCase())) headers[name] = value
  }
  headers.host = url.host
  headers['x-amz-date'] = dateTime
  if (input.credentials.sessionToken) headers['x-amz-security-token'] = input.credentials.sessionToken
  const { signedHeaders, signature: sig } = signature({
    method: input.method, url, query: url.searchParams, headers, payloadHash: sha256Hex(input.body ?? ''), dateTime, scope,
    key: signingKey(input.credentials.secretAccessKey, date, input.region, input.service),
  })
  headers.authorization = `${ALGORITHM} Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`
  return headers
}

/**
 * Presign a GET-style URL (query-string auth, signed header: host). Returns
 * the full URL including the X-Amz-* parameters.
 */
export function presignUrl(input: Omit<SignInput, 'body' | 'headers'> & { expiresInSeconds: number }): string {
  const url = new URL(input.url)
  const { dateTime, date } = amzDate(input.now ?? Date.now())
  const scope = `${date}/${input.region}/${input.service}/aws4_request`
  const query = new URLSearchParams(url.search)
  query.set('X-Amz-Algorithm', ALGORITHM)
  query.set('X-Amz-Credential', `${input.credentials.accessKeyId}/${scope}`)
  query.set('X-Amz-Date', dateTime)
  query.set('X-Amz-Expires', String(Math.floor(input.expiresInSeconds)))
  if (input.credentials.sessionToken) query.set('X-Amz-Security-Token', input.credentials.sessionToken)
  query.set('X-Amz-SignedHeaders', 'host')
  const { signature: sig } = signature({
    method: input.method, url, query, headers: { host: url.host }, payloadHash: EMPTY_SHA256, dateTime, scope,
    key: signingKey(input.credentials.secretAccessKey, date, input.region, input.service),
  })
  query.set('X-Amz-Signature', sig)
  return `${url.protocol}//${url.host}${url.pathname}?${canonicalQuery(query)}`
}
