import type { StorageProvider } from '@/lib/providers/storage/types'
import { bucketPolicy, isSafeStorageKey, type BucketPolicy } from './buckets'
import { verifyFilesSignature } from './signing'

/**
 * GET /files/<bucket>/<key> (app/files/[bucket]/[...key]/route.ts): streams
 * a stored object through the configured StorageProvider.
 *
 *  - public buckets (all current ones): no session needed; cached publicly
 *    (the object's Cache-Control, else one hour) with ETag / 304 support
 *  - private buckets: an app-signed URL (lib/storage/signing.ts), or a
 *    signed-in member of the tenant that owns the key (bucket policy);
 *    otherwise 404, so object names don't leak
 *
 * The files are user uploads served from the app's origin, so every response
 * is locked down: nosniff, a sandboxing CSP (no scripts, even for SVG or
 * HTML), and `Content-Disposition: attachment` for anything that isn't a
 * plain image, font, PDF, text, audio or video type.
 */

export interface ServeFileDeps {
  provider: () => Promise<StorageProvider>
  /** Bucket rules; defaults to lib/storage/buckets. */
  policy?: (bucket: string) => BucketPolicy | null
  /** Tenants the signed-in user belongs to (null = not signed in). Only called for private buckets. */
  sessionTenants: () => Promise<string[] | null>
}

const SANDBOX_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'; media-src 'self'; sandbox"

const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json', xml: 'application/xml',
  html: 'text/html', htm: 'text/html', zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/** Shown inline; everything else downloads. */
const INLINE_TYPE = /^(?:image\/(?:png|jpeg|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)|font\/[a-z0-9.+-]+|application\/pdf|text\/plain|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/i

export function contentTypeFor(key: string, stored: string | null): string {
  const clean = String(stored ?? '').split(';')[0].trim().toLowerCase()
  if (clean && clean !== 'application/octet-stream' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(clean)) return stored!.trim()
  const ext = key.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_TYPES[ext] ?? 'application/octet-stream'
}

function dispositionFor(key: string, contentType: string): string {
  const name = key.split('/').pop() ?? 'file'
  const kind = INLINE_TYPE.test(contentType.split(';')[0].trim()) ? 'inline' : 'attachment'
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } })
}

export async function serveStorageFile(request: Request, bucket: string, segments: string[], deps: ServeFileDeps): Promise<Response> {
  const policy = (deps.policy ?? bucketPolicy)(bucket)
  if (!policy) return notFound()
  // Route params arrive decoded; reject traversal / control characters outright.
  const key = segments.join('/')
  if (!isSafeStorageKey(key)) return new Response('Bad request', { status: 400, headers: { 'Cache-Control': 'no-store' } })

  if (!policy.public) {
    const url = new URL(request.url)
    const signed = verifyFilesSignature(bucket, key, url.searchParams.get('expires'), url.searchParams.get('signature'))
    if (!signed) {
      const owner = policy.tenantFromKey?.(key) ?? null
      const tenants = owner ? await deps.sessionTenants() : null
      if (!owner || !tenants || !tenants.includes(owner)) return notFound()
    }
  }

  const provider = await deps.provider()
  const head = request.method === 'HEAD'
  const object = head ? await provider.head(bucket, key) : await provider.get(bucket, key)
  if (!object) return notFound()

  const contentType = contentTypeFor(key, object.contentType)
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': policy.public ? (object.cacheControl || 'public, max-age=3600') : 'private, max-age=60',
    'Content-Disposition': dispositionFor(key, contentType),
    'Content-Security-Policy': SANDBOX_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': policy.public ? 'cross-origin' : 'same-origin',
  })
  if (policy.public) headers.set('Access-Control-Allow-Origin', '*')
  if (object.etag) headers.set('ETag', `"${object.etag.replace(/"/g, '')}"`)
  if (object.lastModified) headers.set('Last-Modified', new Date(object.lastModified).toUTCString())

  const ifNoneMatch = request.headers.get('if-none-match')
  if (object.etag && ifNoneMatch && ifNoneMatch.split(',').map((t) => t.trim().replace(/^W\//, '')).includes(`"${object.etag.replace(/"/g, '')}"`)) {
    if ('body' in object) await (object.body as ReadableStream).cancel().catch(() => {})
    return new Response(null, { status: 304, headers })
  }
  if (object.size) headers.set('Content-Length', String(object.size))
  if (head || !('body' in object)) return new Response(null, { status: 200, headers })
  return new Response(object.body as ReadableStream<Uint8Array>, { status: 200, headers })
}
