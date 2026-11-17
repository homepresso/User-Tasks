/**
 * The usertasks.com registry front (`/v2/…`, app/v2/[[...path]]/route.ts): a
 * read-only, licence-gated view of the private edition repositories, in the
 * OCI distribution API that `docker login` / `docker pull` speak.
 *
 *   docker login usertasks.com -u licence --password-stdin   (the pull token)
 *   docker pull usertasks.com/editions/sharepoint@sha256:…
 *
 * - Auth: HTTP Basic (or Bearer) carrying a pull token (./pull-token.ts),
 *   checked on every request — MAC and expiry, no database. A token opens
 *   only its edition's repository. Without one: 401 + a Basic challenge,
 *   which is what makes `docker login` send the credential.
 * - Only GET / HEAD of `/v2/`, `<repo>/manifests/<tag|digest>` and
 *   `<repo>/blobs/<digest>`. No push, no catalog, no tag listing.
 * - Manifests are relayed from the upstream (a few KB each). Blob requests
 *   get the upstream's redirect to its CDN (GHCR: a signed URL valid for a
 *   few minutes) passed through, so image layers never transit usertasks.com;
 *   a registry that answers blobs inline is streamed instead.
 */

import { editionById, EDITIONS, type EditionDefinition } from './catalog'
import { basicPassword, verifyPullToken, type PullTokenPayload } from './pull-token'
import { MANIFEST_ACCEPT, type UpstreamRegistry } from './upstream'

export const REGISTRY_REALM = 'UserTasks editions'

export interface RegistryFrontDeps {
  now: () => Date
  /** Per edition: the token secret and the upstream client; null when not configured. */
  edition: (edition: EditionDefinition) => { secret: string; upstream: UpstreamRegistry } | null
  /** Rate limit per token (jti); false = over the limit. */
  allow?: (token: PullTokenPayload) => Promise<boolean>
}

export interface RegistryRequest {
  method: string
  /** Path segments after /v2 (empty for /v2/). */
  segments: string[]
  authorization: string | null
  accept: string | null
}

const BASE_HEADERS = { 'Docker-Distribution-API-Version': 'registry/2.0', 'Cache-Control': 'no-store' }

function ociError(status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ errors: [{ code, message }] }), { status, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json', ...extra } })
}

function unauthorized(message = 'authentication required'): Response {
  return ociError(401, 'UNAUTHORIZED', message, { 'WWW-Authenticate': `Basic realm="${REGISTRY_REALM}"` })
}

const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/

/** Split `<repo…>/(manifests|blobs)/<ref>`. */
export function parseRegistryPath(segments: string[]): { repository: string; kind: 'manifests' | 'blobs'; ref: string } | null {
  if (segments.length < 3) return null
  const kind = segments[segments.length - 2]
  if (kind !== 'manifests' && kind !== 'blobs') return null
  const ref = segments[segments.length - 1]
  const repository = segments.slice(0, -2).join('/')
  if (kind === 'blobs' ? !DIGEST.test(ref) : !(DIGEST.test(ref) || TAG.test(ref))) return null
  return { repository, kind, ref }
}

function editionForRepository(repository: string): EditionDefinition | null {
  return Object.values(EDITIONS).find((e) => e.repository === repository) ?? null
}

const RELAYED = ['content-type', 'content-length', 'docker-content-digest', 'etag', 'last-modified']

function relayHeaders(from: Headers): Record<string, string> {
  const out: Record<string, string> = { ...BASE_HEADERS }
  for (const name of RELAYED) {
    const v = from.get(name)
    if (v) out[name] = v
  }
  return out
}

export async function handleRegistryRequest(req: RegistryRequest, deps: RegistryFrontDeps): Promise<Response> {
  const method = req.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return ociError(405, 'UNSUPPORTED', 'this registry is read-only', { Allow: 'GET, HEAD' })
  const password = basicPassword(req.authorization)
  const now = deps.now()

  // /v2/ — the API version check `docker login` and every pull start with.
  if (!req.segments.length) {
    if (!password) return unauthorized()
    for (const edition of Object.values(EDITIONS)) {
      const conf = deps.edition(edition)
      if (conf && verifyPullToken(password, edition.id, now, conf.secret).ok) {
        return new Response(method === 'HEAD' ? null : '{}', { status: 200, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' } })
      }
    }
    return unauthorized('the pull token is not valid or has expired: run the installer again for a new one')
  }

  const parsed = parseRegistryPath(req.segments)
  if (!parsed) return ociError(404, 'NAME_UNKNOWN', 'not found')
  const edition = editionForRepository(parsed.repository)
  if (!edition || !editionById(edition.id)) return ociError(404, 'NAME_UNKNOWN', 'repository not found')
  const conf = deps.edition(edition)
  if (!conf) return ociError(503, 'UNAVAILABLE', 'edition downloads are not available right now')
  if (!password) return unauthorized()
  const check = verifyPullToken(password, edition.id, now, conf.secret)
  if (!check.ok) {
    if (check.reason === 'wrong_edition') return ociError(403, 'DENIED', `this pull token is not for ${edition.name}`)
    return unauthorized('the pull token is not valid or has expired: run the installer again for a new one')
  }
  if (deps.allow && !(await deps.allow(check.payload))) return ociError(429, 'TOOMANYREQUESTS', 'too many requests for this pull token', { 'Retry-After': '60' })

  try {
    if (parsed.kind === 'manifests') {
      const accept = req.accept?.split(',').map((s) => s.trim()).filter(Boolean)
      const res = await conf.upstream.request(`manifests/${parsed.ref}`, { method, accept: accept?.length ? accept : MANIFEST_ACCEPT })
      if (res.status === 404) return ociError(404, 'MANIFEST_UNKNOWN', 'manifest unknown')
      if (!res.ok) return ociError(502, 'UNAVAILABLE', `upstream answered ${res.status}`)
      return new Response(method === 'HEAD' ? null : await res.arrayBuffer(), { status: 200, headers: relayHeaders(res.headers) })
    }
    const res = await conf.upstream.request(`blobs/${parsed.ref}`, { method })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location || !/^https:\/\//i.test(location)) return ociError(502, 'UNAVAILABLE', 'upstream blob redirect is not usable')
      return new Response(null, { status: 307, headers: { ...BASE_HEADERS, Location: location } })
    }
    if (res.status === 404) return ociError(404, 'BLOB_UNKNOWN', 'blob unknown')
    if (!res.ok) return ociError(502, 'UNAVAILABLE', `upstream answered ${res.status}`)
    return new Response(method === 'HEAD' ? null : res.body, { status: 200, headers: relayHeaders(res.headers) })
  } catch (error) {
    console.error(`[editions] registry front ${parsed.kind}: ${(error as Error).message}`)
    return ociError(502, 'UNAVAILABLE', 'the upstream registry could not be reached')
  }
}
