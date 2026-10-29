/**
 * AWS S3 Executor — handles S3 API calls with proper AWS Signature V4 signing.
 * Zero external dependencies: uses Node.js crypto for HMAC/SHA256.
 */

import { createHmac, createHash } from 'crypto'

// ─── Types ───

interface S3ExecutorOptions {
  accessKeyId: string
  secretAccessKey: string
  region: string
  bucket: string
  method: string
  objectKey: string        // e.g. "uploads/file.pdf" or "" for bucket-level ops
  queryParams?: Record<string, string>
  body?: string | Buffer
  contentType?: string
  headers?: Record<string, string>  // additional headers (e.g. x-amz-copy-source)
  timeout?: number
}

interface S3ExecutorResult {
  status: number
  data: any
  headers?: Record<string, string>
}

// ─── AWS Signature V4 Helpers ───

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  return hmacSha256(kService, 'aws4_request')
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return {
    amzDate: iso,              // 20260401T120000Z
    dateStamp: iso.slice(0, 8), // 20260401
  }
}

/** URI-encode per AWS spec (RFC 3986, with / NOT encoded for paths) */
function uriEncode(str: string, encodeSlash: boolean): string {
  return str.split('').map(ch => {
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
        (ch >= '0' && ch <= '9') || ch === '_' || ch === '-' || ch === '~' || ch === '.') {
      return ch
    }
    if (ch === '/' && !encodeSlash) return ch
    return '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  }).join('')
}

function buildCanonicalQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map(k => `${uriEncode(k, true)}=${uriEncode(params[k], true)}`)
    .join('&')
}

function signRequest(
  method: string,
  path: string,
  queryParams: Record<string, string>,
  headers: Record<string, string>,
  payloadHash: string,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  amzDate: string,
  dateStamp: string,
): string {
  // Canonical headers — must be sorted, lowercased, trimmed
  const signedHeaderKeys = Object.keys(headers)
    .map(k => k.toLowerCase())
    .sort()
  const canonicalHeaders = signedHeaderKeys
    .map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!].trim()}`)
    .join('\n') + '\n'
  const signedHeaders = signedHeaderKeys.join(';')

  // Canonical request
  const canonicalRequest = [
    method,
    uriEncode(path || '/', false),
    buildCanonicalQueryString(queryParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  // String to sign
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n')

  // Signature
  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, 's3')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

// ─── Minimal XML Parser ───

/** Parse S3 XML responses into JS objects. Handles the subset S3 actually returns. */
function parseS3Xml(xml: string): any {
  // Remove XML declaration, namespace attributes, and clean up leftover whitespace in tags
  const clean = xml
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/\s+xmlns="[^"]*"/g, '')
    .replace(/\s+xmlns:[a-z]+="[^"]*"/g, '')
    .trim()

  function parseNode(s: string): any {
    const result: Record<string, any> = {}
    // Match top-level child tags
    const tagRe = /<(\w+)>([\s\S]*?)<\/\1>/g
    let match: RegExpExecArray | null
    let hasChildren = false

    while ((match = tagRe.exec(s)) !== null) {
      hasChildren = true
      const [, tag, inner] = match
      const parsed = inner.includes('<') ? parseNode(inner) : inner

      // If same tag appears multiple times, collect as array
      if (result[tag] !== undefined) {
        if (!Array.isArray(result[tag])) result[tag] = [result[tag]]
        result[tag].push(parsed)
      } else {
        result[tag] = parsed
      }
    }

    return hasChildren ? result : s
  }

  // Get root element — allow optional attributes after tag name
  const rootMatch = clean.match(/^<(\w+)[^>]*>([\s\S]*)<\/\1>$/)
  if (!rootMatch) return { _raw: xml }
  return { [rootMatch[1]]: parseNode(rootMatch[2]) }
}

// ─── Main Executor ───

function buildSignedRequest(
  accessKeyId: string, secretAccessKey: string, region: string,
  bucket: string, method: string, objectKey: string,
  queryParams: Record<string, string>, body: string | Buffer | undefined,
  contentType: string, extraHeaders: Record<string, string>,
): { url: string; headers: Record<string, string>; host: string } {
  const host = `${bucket}.s3.${region}.amazonaws.com`
  const path = '/' + (objectKey ? uriEncode(objectKey, false) : '')

  const now = new Date()
  const { amzDate, dateStamp } = toAmzDate(now)

  const payloadContent = body ?? ''
  const payloadHash = sha256(payloadContent)

  const requestHeaders: Record<string, string> = {
    Host: host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    ...extraHeaders,
  }

  if (method === 'PUT' && body) {
    requestHeaders['Content-Type'] = contentType
  }

  const authorization = signRequest(
    method, path, queryParams, requestHeaders,
    payloadHash, accessKeyId, secretAccessKey, region, amzDate, dateStamp,
  )
  requestHeaders['Authorization'] = authorization

  const qs = buildCanonicalQueryString(queryParams)
  const url = `https://${host}${path}${qs ? '?' + qs : ''}`

  return { url, headers: requestHeaders, host }
}

export async function executeS3Request(opts: S3ExecutorOptions): Promise<S3ExecutorResult> {
  const {
    accessKeyId,
    secretAccessKey,
    region,
    bucket,
    method,
    objectKey,
    queryParams = {},
    body,
    contentType = 'application/octet-stream',
    headers: extraHeaders = {},
    timeout = 30000,
  } = opts

  let { url, headers: requestHeaders, host } = buildSignedRequest(
    accessKeyId, secretAccessKey, region, bucket, method, objectKey,
    queryParams, body, contentType, extraHeaders,
  )

  let resp = await fetch(url, {
    method,
    headers: requestHeaders,
    body: method !== 'GET' && method !== 'HEAD' && method !== 'DELETE' && body ? (Buffer.isBuffer(body) ? new Uint8Array(body) : body) : undefined,
    signal: AbortSignal.timeout(timeout),
    redirect: 'manual',
  })

  // Handle S3 redirects (301 PermanentRedirect or 307 TemporaryRedirect)
  // S3 redirects for region mismatches, legacy endpoint formats, or bucket endpoint changes.
  if (resp.status === 301 || resp.status === 307) {
    let redirectHost: string | null = null
    let redirectRegion = region

    // 1. Check Location header — most reliable, always present on 307
    const location = resp.headers.get('location')
    if (location) {
      try {
        const locUrl = new URL(location)
        redirectHost = locUrl.hostname
        const regionMatch = redirectHost.match(/\.s3[.-]([a-z0-9-]+)\.amazonaws\.com/)
        if (regionMatch) redirectRegion = regionMatch[1]
      } catch { /* not a valid URL */ }
    }

    // 2. Check x-amz-bucket-region header
    if (!redirectHost) {
      const bucketRegion = resp.headers.get('x-amz-bucket-region')
      if (bucketRegion) {
        redirectRegion = bucketRegion
        redirectHost = `${bucket}.s3.${bucketRegion}.amazonaws.com`
      }
    }

    // 3. Try XML body (301 responses include an Endpoint element)
    if (!redirectHost) {
      try {
        const redirectBody = await resp.text()
        const endpointMatch = redirectBody.match(/<Endpoint>([^<]+)<\/Endpoint>/)
        if (endpointMatch) {
          redirectHost = endpointMatch[1]
          const regionMatch = redirectHost.match(/\.s3[.-]([a-z0-9-]+)\.amazonaws\.com/)
          if (regionMatch) redirectRegion = regionMatch[1]
        }
      } catch { /* body may already be consumed or empty */ }
    }

    // Retry with the correct endpoint — always retry if we found a redirect target
    if (redirectHost) {
      const retry = buildSignedRequest(
        accessKeyId, secretAccessKey, redirectRegion, bucket, method, objectKey,
        queryParams, body, contentType, extraHeaders,
      )
      url = retry.url
      requestHeaders = retry.headers
      host = retry.host

      // If the redirect host differs from what we built, override the URL and Host header
      if (redirectHost !== host) {
        const path = '/' + (objectKey ? uriEncode(objectKey, false) : '')
        const qs = buildCanonicalQueryString(queryParams)
        url = `https://${redirectHost}${path}${qs ? '?' + qs : ''}`
        requestHeaders['Host'] = redirectHost
      }

      resp = await fetch(url, {
        method,
        headers: requestHeaders,
        body: method !== 'GET' && method !== 'HEAD' && method !== 'DELETE' && body ? (Buffer.isBuffer(body) ? new Uint8Array(body) : body) : undefined,
        signal: AbortSignal.timeout(timeout),
      })
    }
  }

  // Extract response headers we care about
  const respHeaders: Record<string, string> = {}
  for (const key of ['etag', 'content-type', 'content-length', 'x-amz-request-id', 'x-amz-copy-source-version-id', 'last-modified']) {
    const v = resp.headers.get(key)
    if (v) respHeaders[key] = v
  }

  // HEAD requests return no body — metadata is in headers
  if (method === 'HEAD') {
    const exists = resp.ok
    return {
      status: resp.status,
      data: {
        exists,
        content_type: respHeaders['content-type'] ?? '',
        content_length: Number(respHeaders['content-length'] ?? 0),
        last_modified: respHeaders['last-modified'] ?? '',
        etag: respHeaders['etag']?.replace(/"/g, '') ?? '',
      },
      headers: respHeaders,
    }
  }

  // Parse response
  const respContentType = resp.headers.get('content-type') ?? ''
  let data: any

  if (resp.status === 204 || resp.status === 200 && resp.headers.get('content-length') === '0') {
    // No body (DELETE responses, etc.)
    data = { success: true }
  } else if (respContentType.includes('xml') || respContentType === '' && method !== 'GET') {
    // S3 returns XML for list operations and error responses
    const text = await resp.text()
    if (text.trim().startsWith('<')) {
      data = parseS3Xml(text)
    } else {
      data = { _raw: text.slice(0, 5000) }
    }
  } else if (respContentType.includes('json')) {
    try { data = await resp.json() } catch { data = await resp.text() }
  } else {
    // GET object returns raw content (binary/text)
    if (method === 'GET' && objectKey && !Object.keys(queryParams).length) {
      // This is a GetObject — return content
      const text = await resp.text()
      data = {
        body: text.slice(0, 100000), // cap at 100KB for safety
        content_type: respHeaders['content-type'] ?? '',
        content_length: Number(respHeaders['content-length'] ?? text.length),
      }
    } else {
      const text = await resp.text()
      if (text.trim().startsWith('<')) {
        data = parseS3Xml(text)
      } else {
        data = { _raw: text.slice(0, 5000) }
      }
    }
  }

  // For errors, try to extract the S3 error message
  if (!resp.ok && data?.Error) {
    const err = data.Error
    data = { error: true, code: err.Code ?? resp.status, message: err.Message ?? 'S3 request failed', requestId: err.RequestId }
  }

  // Enrich successful PUT responses with the object URL
  if (resp.ok && method === 'PUT' && objectKey) {
    data = {
      ...data,
      etag: respHeaders['etag']?.replace(/"/g, ''),
      url: `https://${host}/${objectKey}`,
    }
  }

  // Normalize ListObjectsV2 response
  if (resp.ok && data?.ListBucketResult) {
    const r = data.ListBucketResult
    const contents = r.Contents
      ? (Array.isArray(r.Contents) ? r.Contents : [r.Contents])
      : []
    data = {
      contents: contents.map((c: any) => ({
        key: c.Key,
        size: Number(c.Size ?? 0),
        last_modified: c.LastModified,
        etag: c.ETag?.replace(/"/g, ''),
        storage_class: c.StorageClass,
      })),
      key_count: Number(r.KeyCount ?? contents.length),
      is_truncated: r.IsTruncated === 'true',
      prefix: r.Prefix ?? '',
      next_continuation_token: r.NextContinuationToken,
    }
  }

  // Normalize CopyObject response
  if (resp.ok && data?.CopyObjectResult) {
    const r = data.CopyObjectResult
    data = {
      etag: r.ETag?.replace(/"/g, ''),
      last_modified: r.LastModified,
    }
  }

  return { status: resp.status, data, headers: respHeaders }
}

// ─── High-level entry point for reference-executor ───

export async function executeS3Reference(
  integrationConfig: any,
  method: string,
  path: string,
  body: string | undefined,
  queryParams: Record<string, string>,
  inputHeaders: Record<string, string>,
  timeout: number,
  /** The reference's workspace: form attachments in the body are read for it only. */
  tenantId?: string | null,
): Promise<S3ExecutorResult> {
  const authCfg = integrationConfig.auth_config ?? {}

  const accessKeyId = authCfg.access_key_id
  const secretAccessKey = authCfg.secret_access_key
  const region = authCfg.region || 'us-east-1'

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS S3 credentials missing. Provide access_key_id and secret_access_key.')
  }

  // Determine bucket: from query params override, auth_config default, or base_url
  let bucket = queryParams.bucket || authCfg.bucket || ''
  delete queryParams.bucket // don't send as S3 query param

  if (!bucket) {
    // Try to extract from base_url
    const baseUrl = integrationConfig.base_url ?? ''
    const hostMatch = baseUrl.match(/\/\/([^.]+)\.s3\./)
    if (hostMatch) bucket = hostMatch[1]
    else {
      const pathMatch = baseUrl.match(/amazonaws\.com\/([^/]+)/)
      if (pathMatch) bucket = pathMatch[1]
    }
  }

  if (!bucket) throw new Error('S3 bucket not configured. Set a default bucket or provide one as input.')

  // Extract object key and inline query params from path
  // Path may be "/key" or "/?list-type=2&prefix=foo" — split on ?
  let cleanPath = path.replace(/^\/+/, '')
  let objectKey = cleanPath
  const qsIdx = cleanPath.indexOf('?')
  if (qsIdx >= 0) {
    objectKey = cleanPath.slice(0, qsIdx)
    // Parse inline query params and merge
    const inlineQs = cleanPath.slice(qsIdx + 1)
    for (const pair of inlineQs.split('&')) {
      const [k, v] = pair.split('=')
      if (k && !queryParams[k]) queryParams[k] = decodeURIComponent(v ?? '')
    }
  }

  // Detect content type from input headers or query params
  let contentType = inputHeaders['content_type'] || inputHeaders['Content-Type'] || queryParams.content_type || 'application/octet-stream'
  delete queryParams.content_type
  delete inputHeaders['content_type']
  delete inputHeaders['Content-Type']

  // Remove input params that were already consumed by path/body templates — they are NOT S3 query params.
  // Only legitimate S3 query params should remain (list-type, prefix, max-keys, delimiter, etc.)
  const s3QueryParams = new Set([
    'list-type', 'prefix', 'max-keys', 'delimiter', 'continuation-token',
    'start-after', 'encoding-type', 'fetch-owner', 'marker', 'max-uploads',
    'key-marker', 'upload-id-marker', 'uploadId', 'partNumber',
    'versionId', 'response-content-type', 'response-content-disposition',
    'response-cache-control', 'response-content-encoding', 'response-expires',
    'delete', 'tagging', 'acl', 'torrent', 'restore', 'select', 'analytics',
    'inventory', 'metrics', 'replication', 'lifecycle', 'policy', 'cors',
    'versioning', 'website', 'logging', 'notification', 'accelerate',
    'requestPayment', 'encryption', 'object-lock', 'legal-hold', 'retention',
  ])
  for (const k of Object.keys(queryParams)) {
    if (!s3QueryParams.has(k)) delete queryParams[k]
  }

  // Build extra S3 headers from inputs (e.g. x-amz-copy-source)
  const s3Headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(inputHeaders)) {
    if (k.startsWith('x-amz-') || k.startsWith('X-Amz-')) {
      s3Headers[k] = v
    }
  }

  // For copy operations: if source_bucket was empty, default to the current bucket
  if (s3Headers['x-amz-copy-source']?.startsWith('//')) {
    s3Headers['x-amz-copy-source'] = `/${bucket}${s3Headers['x-amz-copy-source'].slice(1)}`
  }

  // Resolve body content for uploads — handle URLs, base64, and file reference objects.
  // S3 needs raw binary bytes, not a base64 string or a URL.
  let resolvedBody: string | Buffer | undefined = body
  // A form attachment (file input of an upload): its bytes and verified type.
  const { readFormFileBody } = method === 'PUT' && body ? await import('@/lib/services/form-files') : { readFormFileBody: null }
  const formFile = readFormFileBody ? await readFormFileBody(body!, tenantId) : null
  if (formFile) {
    resolvedBody = Buffer.from(formFile.bytes)
    if (contentType === 'application/octet-stream') contentType = formFile.mime_type
  } else if (method === 'PUT' && body) {
    // File reference object: { _file: true, url: "https://...", ... } — stringified by caller
    let parsed: any = null
    if (body.startsWith('{') || body.startsWith('[object')) {
      try { parsed = JSON.parse(body) } catch { /* not JSON */ }
    }

    // Detect a URL — either from a file ref object or a plain URL string
    const fileUrl = parsed?.url ?? parsed?.file_url ?? (
      (body.startsWith('http://') || body.startsWith('https://')) ? body : null
    )

    if (fileUrl) {
      // Download the actual file binary from the URL
      const fileResp = await fetch(fileUrl, { signal: AbortSignal.timeout(timeout) })
      if (!fileResp.ok) throw new Error(`Failed to download file for S3 upload: HTTP ${fileResp.status}`)
      resolvedBody = Buffer.from(await fileResp.arrayBuffer())
      // Auto-detect content type from the file response if not explicitly set
      if (contentType === 'application/octet-stream') {
        const detectedType = fileResp.headers.get('content-type')
        if (detectedType && detectedType !== 'application/octet-stream') {
          contentType = detectedType.split(';')[0].trim()
        }
      }
    } else if (/^[A-Za-z0-9+/]+=*$/.test(body.slice(0, 200).replace(/\s/g, '')) && body.length > 100) {
      // Looks like base64 — decode to binary Buffer
      const buf = Buffer.from(body, 'base64')
      if (buf.byteLength > 0 && buf.byteLength < body.length) {
        resolvedBody = buf
      }
    }
  }

  return executeS3Request({
    accessKeyId,
    secretAccessKey,
    region,
    bucket,
    method,
    objectKey,
    queryParams,
    body: resolvedBody || undefined,
    contentType,
    headers: s3Headers,
    timeout,
  })
}
