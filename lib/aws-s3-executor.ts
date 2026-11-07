/**
 * AWS S3 executor: S3 REST calls signed with AWS Signature V4.
 *
 *  - Object keys are percent-encoded exactly once, as UTF-8 (RFC 3986 per
 *    path segment, '/' kept). The canonical URI is that encoded path; S3 does
 *    not double-encode.
 *  - Bucket names are validated before they reach a hostname. DNS-compatible
 *    names use virtual-hosted style; names with dots (TLS wildcard mismatch)
 *    or legacy upper-case names use path style.
 *  - All traffic goes through connectorFetch (egress guard, retries on
 *    429 / 5xx for idempotent methods, one timeout budget). S3 region
 *    redirects (301 / 307) are handled here: the request is re-signed for the
 *    bucket's region, and only ever sent to an amazonaws.com host.
 *  - Upload bodies naming a file (form attachment, http(s) URL, base64) are
 *    resolved to bytes; URLs are downloaded through the egress guard and
 *    size-capped.
 *  - GetObject: text up to 1 MB is returned inline; anything else is stored
 *    as a workflow file and returned as a file reference ({ _file: true … }).
 *  - Pseudo query parameters (never sent to S3) let templates ask for the
 *    things S3 expresses in headers or that need no request at all:
 *      x-ut-copy-source-bucket / x-ut-copy-source-key → x-amz-copy-source
 *      x-ut-presign-expires (+ x-ut-presign-method)   → a presigned URL
 *
 * Optional temporary credentials: auth_config.session_token is sent (and
 * signed) as x-amz-security-token.
 */

import { createHash, createHmac } from 'crypto'
import {
  connectorFetch,
  readCappedBody,
  MAX_BINARY_RESPONSE_BYTES,
  MAX_STRUCTURED_RESPONSE_BYTES,
} from '@/lib/integrations/http'
import { presignUrl, rfc3986 } from '@/lib/aws/sigv4'

// ─── Types ───

export interface S3ExecutorOptions {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  bucket: string
  method: string
  objectKey: string        // raw (unencoded) key, e.g. "uploads/my file.pdf"; "" for bucket-level ops
  queryParams?: Record<string, string>
  body?: string | Buffer | Uint8Array
  contentType?: string
  headers?: Record<string, string>  // additional x-amz-* headers (e.g. x-amz-copy-source)
  timeout?: number
  /** Workspace for files stored from downloads. */
  tenantId?: string | null
}

export interface S3ExecutorResult {
  status: number
  data: any
  headers?: Record<string, string>
}

// ─── Validation & endpoints ───

const INLINE_TEXT_LIMIT = 1024 * 1024
const MAX_PRESIGN_SECONDS = 604800

/** S3 bucket names: 3–63 chars (legacy us-east-1 names up to 255, mixed case, '_'). */
export function isValidBucketName(bucket: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,253}[A-Za-z0-9]$/.test(bucket)) return false
  if (bucket.includes('..')) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bucket)) return false
  return true
}

/** Virtual-hosted style only for DNS- and TLS-safe names (no dots, lower case). */
function isVirtualHostable(bucket: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)
}

export function isValidRegion(region: string): boolean {
  return /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/.test(region)
}

function awsDomain(region: string): string {
  return region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com'
}

function isAwsHost(host: string): boolean {
  return /^[a-z0-9.-]+\.amazonaws\.com(\.cn)?$/i.test(host)
}

/** Raw key → encoded path (once, UTF-8, per segment, '/' kept). */
export function encodeKey(key: string): string {
  return key.split('/').map((segment) => rfc3986(segment)).join('/')
}

export function s3Endpoint(bucket: string, region: string, objectKey: string): { host: string; path: string; virtualHosted: boolean } {
  const domain = awsDomain(region)
  const keyPath = objectKey ? encodeKey(objectKey) : ''
  if (isVirtualHostable(bucket)) {
    return { host: `${bucket}.s3.${region}.${domain}`, path: `/${keyPath}`, virtualHosted: true }
  }
  return { host: `s3.${region}.${domain}`, path: `/${rfc3986(bucket)}${keyPath ? `/${keyPath}` : ''}`, virtualHosted: false }
}

// ─── Signature V4 ───

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  return hmacSha256(kService, 'aws4_request')
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

export function buildCanonicalQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .map((k) => [rfc3986(k), rfc3986(params[k] ?? '')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

/** Authorization header value. `encodedPath` is the path exactly as sent (already encoded). */
function signRequest(
  method: string,
  encodedPath: string,
  queryParams: Record<string, string>,
  headers: Record<string, string>,
  payloadHash: string,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  amzDate: string,
  dateStamp: string,
): string {
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase().trim(), String(v).trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const canonicalHeaders = entries.map(([k, v]) => `${k}:${v}\n`).join('')
  const signedHeaders = entries.map(([k]) => k).join(';')

  const canonicalRequest = [
    method,
    encodedPath || '/',
    buildCanonicalQueryString(queryParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n')
  const signature = createHmac('sha256', getSigningKey(secretAccessKey, dateStamp, region, 's3')).update(stringToSign, 'utf8').digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

// ─── Minimal XML parser ───

function xmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

/** Parse S3 XML responses into JS objects. Handles the subset S3 actually returns. */
export function parseS3Xml(xml: string): any {
  const clean = xml
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/\s+xmlns="[^"]*"/g, '')
    .replace(/\s+xmlns:[a-z]+="[^"]*"/g, '')
    .trim()

  function parseNode(s: string): any {
    const result: Record<string, any> = {}
    const tagRe = /<(\w+)>([\s\S]*?)<\/\1>/g
    let match: RegExpExecArray | null
    let hasChildren = false
    while ((match = tagRe.exec(s)) !== null) {
      hasChildren = true
      const [, tag, inner] = match
      const parsed = inner.includes('<') ? parseNode(inner) : xmlDecode(inner)
      if (result[tag] !== undefined) {
        if (!Array.isArray(result[tag])) result[tag] = [result[tag]]
        result[tag].push(parsed)
      } else {
        result[tag] = parsed
      }
    }
    return hasChildren ? result : xmlDecode(s)
  }

  const rootMatch = clean.match(/^<(\w+)[^>]*>([\s\S]*)<\/\1>$/)
  if (!rootMatch) return { _raw: xml.slice(0, 5000) }
  return { [rootMatch[1]]: parseNode(rootMatch[2]) }
}

// ─── Request building ───

interface SignedRequest { url: string; headers: Record<string, string>; host: string; path: string }

function buildSignedRequest(
  creds: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
  region: string,
  bucket: string,
  method: string,
  objectKey: string,
  queryParams: Record<string, string>,
  body: Uint8Array | string | undefined,
  contentType: string | null,
  extraHeaders: Record<string, string>,
  hostOverride?: string,
): SignedRequest {
  const endpoint = s3Endpoint(bucket, region, objectKey)
  const host = hostOverride ?? endpoint.host
  const path = endpoint.path
  const { amzDate, dateStamp } = toAmzDate(new Date())
  const payloadHash = sha256(body ?? '')

  const signed: Record<string, string> = {
    host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    ...extraHeaders,
  }
  if (creds.sessionToken) signed['x-amz-security-token'] = creds.sessionToken
  if (contentType) signed['content-type'] = contentType

  const authorization = signRequest(
    method, path, queryParams, signed, payloadHash,
    creds.accessKeyId, creds.secretAccessKey, region, amzDate, dateStamp,
  )
  // Host is signed but set by fetch itself from the URL.
  const { host: _host, ...headers } = signed
  headers['Authorization'] = authorization
  const qs = buildCanonicalQueryString(queryParams)
  return { url: `https://${host}${path}${qs ? `?${qs}` : ''}`, headers, host, path }
}

/**
 * connectorFetch follows redirects itself; S3 redirects must instead be
 * re-signed for the target region, so the Location header is moved aside
 * and the 3xx handed back to us.
 */
const fetchWithoutRedirects: typeof fetch = async (input, init) => {
  const res = await fetch(input as any, init)
  const location = res.headers.get('location')
  if (res.status >= 300 && res.status < 400 && location) {
    const headers = new Headers(res.headers)
    headers.delete('location')
    headers.set('x-s3-redirect-location', location)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
  return res
}

const TEXT_TYPE_RE = /^(text\/|application\/(json|xml|csv|javascript|x-ndjson|ld\+json|yaml|x-yaml)|[^;]*\+(json|xml))/i

async function storeDownloadedFile(bytes: Buffer, objectKey: string, contentType: string, tenantId: string | null | undefined) {
  const fileName = (objectKey.split('/').pop() || 'download').replace(/[\\\r\n]/g, '_').slice(0, 200)
  const ext = fileName.includes('.') ? (fileName.split('.').pop() ?? 'bin').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'bin' : 'bin'
  const mime = contentType.split(';')[0].trim() || 'application/octet-stream'
  if (tenantId) {
    try {
      const { storeWorkflowFile } = await import('@/lib/storage/files')
      const { createServiceClient } = await import('@/lib/cron-auth')
      const stored = await storeWorkflowFile(createServiceClient() as any, tenantId, new Uint8Array(bytes), ext, mime)
      return {
        _file: true,
        name: fileName,
        url: stored.url,
        path: stored.path,
        size: bytes.byteLength,
        content_type: mime,
        content_length: bytes.byteLength,
        ...((stored as any).ref ? { ref: (stored as any).ref } : {}),
      }
    } catch (error: any) {
      if (bytes.byteLength > INLINE_TEXT_LIMIT) throw new Error(`File storage failed: ${error?.message ?? error}`)
    }
  } else if (bytes.byteLength > INLINE_TEXT_LIMIT) {
    throw new Error('S3 download needs a workspace to store the file')
  }
  // No storage available: small files inline as base64.
  return { _binary: true, name: fileName, size: bytes.byteLength, content_type: mime, content_length: bytes.byteLength, base64: bytes.toString('base64') }
}

// ─── Main executor ───

export async function executeS3Request(opts: S3ExecutorOptions): Promise<S3ExecutorResult> {
  const {
    accessKeyId,
    secretAccessKey,
    sessionToken,
    bucket,
    method,
    objectKey,
    queryParams = {},
    body,
    contentType = 'application/octet-stream',
    headers: extraHeaders = {},
    timeout = 30000,
    tenantId,
  } = opts
  let region = opts.region
  if (!isValidBucketName(bucket)) throw new Error(`Invalid S3 bucket name "${bucket}"`)
  if (!isValidRegion(region)) throw new Error(`Invalid AWS region "${region}"`)

  const creds = { accessKeyId, secretAccessKey, sessionToken }
  const payload: Uint8Array | string | undefined =
    method === 'GET' || method === 'HEAD' || method === 'DELETE' || body == null || body === ''
      ? undefined
      : (typeof body === 'string' ? body : new Uint8Array(body))
  const signedContentType = method === 'PUT' && payload !== undefined ? contentType : null

  const send = (req: SignedRequest) =>
    connectorFetch(req.url, { method, headers: req.headers, body: payload as BodyInit | undefined }, { timeoutMs: timeout, fetchImpl: fetchWithoutRedirects })

  let req = buildSignedRequest(creds, region, bucket, method, objectKey, queryParams, payload, signedContentType, extraHeaders)
  let resp = await send(req)

  // S3 region redirects: 301 PermanentRedirect (x-amz-bucket-region / <Endpoint>)
  // or 307 TemporaryRedirect (Location). Re-sign for the right region; only
  // ever follow to an amazonaws.com host.
  if (resp.status === 301 || resp.status === 307 || (resp.status === 400 && resp.headers.get('x-amz-bucket-region'))) {
    let redirectHost: string | null = null
    let redirectRegion: string | null = resp.headers.get('x-amz-bucket-region')
    const location = resp.headers.get('x-s3-redirect-location')
    if (location) {
      try { redirectHost = new URL(location).hostname } catch { /* ignore */ }
    }
    if (!redirectHost && !redirectRegion) {
      const text = (await readCappedBody(resp, 64 * 1024).catch(() => Buffer.alloc(0))).toString('utf8')
      const endpoint = text.match(/<Endpoint>([^<]+)<\/Endpoint>/)?.[1]
      if (endpoint) redirectHost = endpoint
      redirectRegion = text.match(/<Region>([^<]+)<\/Region>/)?.[1] ?? null
    } else {
      await resp.body?.cancel().catch(() => {})
    }
    if (!redirectRegion && redirectHost) {
      redirectRegion = redirectHost.match(/\.s3[.-]([a-z0-9-]+)\.amazonaws\.com/)?.[1] ?? null
    }
    if (redirectRegion && isValidRegion(redirectRegion)) region = redirectRegion
    const safeHost = redirectHost && isAwsHost(redirectHost) && redirectHost.includes(region) ? redirectHost : undefined
    if (redirectRegion || safeHost) {
      req = buildSignedRequest(creds, region, bucket, method, objectKey, queryParams, payload, signedContentType, extraHeaders, safeHost)
      resp = await send(req)
    }
  }

  const respHeaders: Record<string, string> = {}
  for (const key of ['etag', 'content-type', 'content-length', 'x-amz-request-id', 'x-amz-version-id', 'x-amz-copy-source-version-id', 'last-modified', 'x-amz-bucket-region']) {
    const v = resp.headers.get(key)
    if (v) respHeaders[key] = v
  }

  if (method === 'HEAD') {
    await resp.body?.cancel().catch(() => {})
    return {
      status: resp.status,
      data: {
        exists: resp.ok,
        content_type: respHeaders['content-type'] ?? '',
        content_length: Number(respHeaders['content-length'] ?? 0),
        last_modified: respHeaders['last-modified'] ?? '',
        etag: respHeaders['etag']?.replace(/"/g, '') ?? '',
      },
      headers: respHeaders,
    }
  }

  const respContentType = resp.headers.get('content-type') ?? ''
  const isObjectGet = method === 'GET' && Boolean(objectKey) && Object.keys(queryParams).every((k) => k.startsWith('response-') || k === 'versionId')
  let data: any

  if (resp.status === 204 || (resp.ok && resp.headers.get('content-length') === '0')) {
    await resp.body?.cancel().catch(() => {})
    data = { success: true }
  } else if (isObjectGet && resp.ok) {
    const bytes = await readCappedBody(resp, MAX_BINARY_RESPONSE_BYTES)
    if (TEXT_TYPE_RE.test(respContentType) && bytes.byteLength <= INLINE_TEXT_LIMIT) {
      data = {
        body: bytes.toString('utf8'),
        content_type: respContentType,
        content_length: bytes.byteLength,
      }
    } else {
      data = await storeDownloadedFile(bytes, objectKey, respContentType, tenantId)
    }
  } else {
    const text = (await readCappedBody(resp, MAX_STRUCTURED_RESPONSE_BYTES)).toString('utf8')
    if (text.trim().startsWith('<')) data = parseS3Xml(text)
    else if (respContentType.includes('json')) { try { data = JSON.parse(text) } catch { data = { _raw: text.slice(0, 5000) } } }
    else data = text ? { _raw: text.slice(0, 5000) } : (resp.ok ? { success: true } : null)
  }

  if (!resp.ok && data?.Error) {
    const err = data.Error
    data = { error: true, code: err.Code ?? resp.status, message: err.Message ?? 'S3 request failed', requestId: err.RequestId }
  }

  if (resp.ok && method === 'PUT' && objectKey) {
    data = {
      ...(data && typeof data === 'object' ? data : {}),
      etag: respHeaders['etag']?.replace(/"/g, ''),
      ...(respHeaders['x-amz-version-id'] ? { version_id: respHeaders['x-amz-version-id'] } : {}),
      url: `https://${req.host}${req.path}`,
    }
    delete data.success
    if (data.CopyObjectResult) {
      const r = data.CopyObjectResult
      data = { etag: r.ETag?.replace(/"/g, ''), last_modified: r.LastModified, url: data.url }
    }
  }

  if (resp.ok && data?.ListBucketResult) {
    const r = data.ListBucketResult
    const asArray = (v: any) => (v == null ? [] : Array.isArray(v) ? v : [v])
    const contents = asArray(r.Contents)
    data = {
      contents: contents.map((c: any) => ({
        key: c.Key,
        size: Number(c.Size ?? 0),
        last_modified: c.LastModified,
        etag: typeof c.ETag === 'string' ? c.ETag.replace(/"/g, '') : c.ETag,
        storage_class: c.StorageClass,
      })),
      common_prefixes: asArray(r.CommonPrefixes).map((p: any) => p?.Prefix).filter(Boolean),
      key_count: Number(r.KeyCount ?? contents.length),
      is_truncated: r.IsTruncated === 'true',
      prefix: typeof r.Prefix === 'string' ? r.Prefix : '',
      next_continuation_token: r.NextContinuationToken ?? null,
    }
  }

  return { status: resp.status, data, headers: respHeaders }
}

// ─── High-level entry point for reference-executor ───

const S3_QUERY_PARAMS = new Set([
  'list-type', 'prefix', 'max-keys', 'delimiter', 'continuation-token',
  'start-after', 'encoding-type', 'fetch-owner', 'marker', 'max-uploads',
  'key-marker', 'upload-id-marker', 'uploadId', 'partNumber',
  'versionId', 'response-content-type', 'response-content-disposition',
  'response-cache-control', 'response-content-encoding', 'response-expires',
  'delete', 'tagging', 'acl', 'restore', 'versions', 'uploads',
])

function safeDecode(value: string): string {
  try { return decodeURIComponent(value.replace(/\+/g, '%20')) } catch { return value }
}

/**
 * Entry point from lib/reference-executor. `path` is the rendered path
 * template WITHOUT percent-encoding of the key (already checked for '.'/'..'
 * segments); its query part (after '?') is encoded.
 */
export async function executeS3Reference(
  integrationConfig: any,
  method: string,
  path: string,
  body: string | undefined,
  queryParams: Record<string, string>,
  inputHeaders: Record<string, string>,
  timeout: number,
  /** The reference's workspace: form attachments and downloads belong to it only. */
  tenantId?: string | null,
): Promise<S3ExecutorResult> {
  const authCfg = integrationConfig.auth_config ?? {}
  const accessKeyId = authCfg.access_key_id
  const secretAccessKey = authCfg.secret_access_key
  const sessionToken = authCfg.session_token || undefined
  const region = String(authCfg.region || 'us-east-1').trim()
  queryParams = { ...queryParams }
  inputHeaders = { ...inputHeaders }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS S3 credentials missing. Provide access_key_id and secret_access_key.')
  }

  // Bucket: input override, then the connector default, then the base URL.
  let bucket = String(queryParams.bucket || authCfg.bucket || '').trim()
  delete queryParams.bucket
  if (!bucket) {
    const baseUrl = String(integrationConfig.base_url ?? '')
    bucket = baseUrl.match(/\/\/([^/]+)\.s3[.-]/)?.[1] ?? baseUrl.match(/amazonaws\.com\/([^/?]+)/)?.[1] ?? ''
  }
  if (!bucket) throw new Error('S3 bucket not configured. Set a default bucket or provide one as input.')

  // Object key (raw) and the template's own query part.
  const cleanPath = path.replace(/^\/+/, '')
  const qsIdx = cleanPath.indexOf('?')
  const objectKey = qsIdx >= 0 ? cleanPath.slice(0, qsIdx) : cleanPath
  const inline: Record<string, string> = {}
  if (qsIdx >= 0) {
    for (const pair of cleanPath.slice(qsIdx + 1).split('&')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      const k = safeDecode(eq < 0 ? pair : pair.slice(0, eq))
      inline[k] = eq < 0 ? '' : safeDecode(pair.slice(eq + 1))
    }
  }

  let contentType = inputHeaders['content_type'] || inputHeaders['Content-Type'] || queryParams.content_type || 'application/octet-stream'
  delete queryParams.content_type

  // Copy source (pseudo params, or a legacy x-amz-copy-source header).
  const s3Headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(inputHeaders)) {
    if (/^x-amz-/i.test(k) && v) s3Headers[k.toLowerCase()] = v
  }
  const copyKey = inline['x-ut-copy-source-key']
  const legacyCopy = s3Headers['x-amz-copy-source']
  if (copyKey !== undefined || legacyCopy) {
    let srcBucket: string
    let srcKey: string
    if (copyKey !== undefined) {
      srcBucket = (inline['x-ut-copy-source-bucket'] || bucket).trim()
      srcKey = copyKey
    } else {
      const raw = legacyCopy.replace(/^\/+/, '')
      const slash = raw.indexOf('/')
      srcBucket = (legacyCopy.startsWith('//') || slash === 0) ? bucket : raw.slice(0, slash)
      srcKey = legacyCopy.startsWith('//') ? raw : raw.slice(slash + 1)
    }
    srcKey = srcKey.replace(/^\/+/, '')
    if (!srcKey) throw new Error('Copy source key is required')
    if (!isValidBucketName(srcBucket)) throw new Error(`Invalid S3 bucket name "${srcBucket}"`)
    s3Headers['x-amz-copy-source'] = `/${srcBucket}/${encodeKey(srcKey)}`
  }

  // Presigned URL: no request is sent.
  const presignExpires = inline['x-ut-presign-expires']
  if (presignExpires !== undefined) {
    if (!isValidBucketName(bucket)) throw new Error(`Invalid S3 bucket name "${bucket}"`)
    if (!isValidRegion(region)) throw new Error(`Invalid AWS region "${region}"`)
    if (!objectKey) throw new Error('Object key is required for a presigned URL')
    const seconds = Number(presignExpires || 3600)
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_PRESIGN_SECONDS) {
      throw new Error(`expires_in must be a whole number of seconds between 1 and ${MAX_PRESIGN_SECONDS}`)
    }
    const presignMethod = (inline['x-ut-presign-method'] || 'GET').toUpperCase()
    if (!['GET', 'PUT'].includes(presignMethod)) throw new Error('Presign method must be GET or PUT')
    const endpoint = s3Endpoint(bucket, region, objectKey)
    const now = Date.now()
    const url = presignUrl({
      method: presignMethod,
      url: `https://${endpoint.host}${endpoint.path}`,
      region,
      service: 's3',
      credentials: { accessKeyId, secretAccessKey, sessionToken },
      expiresInSeconds: seconds,
      now,
    })
    return { status: 200, data: { url, method: presignMethod, expires_at: new Date(now + seconds * 1000).toISOString() } }
  }

  // Remaining S3 query parameters (template query + location=query inputs).
  const s3Query: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...queryParams, ...inline })) {
    if (S3_QUERY_PARAMS.has(k)) s3Query[k] = v
  }

  // Upload bodies that name a file → bytes.
  let resolvedBody: string | Buffer | undefined = body
  if (method === 'PUT' && body && !s3Headers['x-amz-copy-source']) {
    const { readFormFileBody } = await import('@/lib/services/form-files')
    const formFile = await readFormFileBody(body, tenantId)
    if (formFile) {
      resolvedBody = Buffer.from(formFile.bytes)
      if (contentType === 'application/octet-stream') contentType = formFile.mime_type
    } else {
      let parsed: any = null
      if (body.startsWith('{')) {
        try { parsed = JSON.parse(body) } catch { /* not JSON */ }
      }
      const fileUrl: string | null = (typeof parsed?.url === 'string' && parsed.url) || (typeof parsed?.file_url === 'string' && parsed.file_url)
        || (/^https?:\/\/\S+$/.test(body.trim()) ? body.trim() : null)
      if (fileUrl) {
        // Downloaded through the egress guard (no private / metadata addresses), size-capped.
        const fileResp = await connectorFetch(fileUrl, {}, { timeoutMs: timeout })
        if (!fileResp.ok) {
          await fileResp.body?.cancel().catch(() => {})
          throw new Error(`Failed to download file for S3 upload: HTTP ${fileResp.status}`)
        }
        resolvedBody = await readCappedBody(fileResp, MAX_BINARY_RESPONSE_BYTES)
        if (contentType === 'application/octet-stream') {
          const detected = fileResp.headers.get('content-type')
          if (detected && !detected.startsWith('application/octet-stream')) contentType = detected.split(';')[0].trim()
        }
      } else if (/^[A-Za-z0-9+/]+=*$/.test(body.slice(0, 200).replace(/\s/g, '')) && body.length > 100) {
        // Looks like base64 — decode to binary.
        const buf = Buffer.from(body, 'base64')
        if (buf.byteLength > 0 && buf.byteLength < body.length) resolvedBody = buf
      }
    }
  }
  if (s3Headers['x-amz-copy-source']) resolvedBody = undefined

  return executeS3Request({
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region,
    bucket,
    method,
    objectKey,
    queryParams: s3Query,
    body: resolvedBody || undefined,
    contentType,
    headers: s3Headers,
    timeout,
    tenantId,
  })
}
