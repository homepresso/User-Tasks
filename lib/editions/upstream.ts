/**
 * The private upstream registry behind the usertasks.com registry front
 * (OCI distribution API v2; GitHub Container Registry in production).
 *
 * usertasks.com holds ONE read-only credential for it (EDITION_UPSTREAM_USERNAME
 * / EDITION_UPSTREAM_TOKEN: for GHCR a token with only `read:packages`,
 * ideally of a machine account that can read nothing but the edition
 * packages). Customers never see it.
 *
 *   - Bearer token discovery from the `WWW-Authenticate` challenge of
 *     `GET /v2/` (GHCR: https://ghcr.io/token), scope
 *     `repository:<repo>:pull`, cached until shortly before it expires.
 *   - Manifests are fetched and relayed (a few KB).
 *   - Blobs are NOT relayed: GHCR answers a blob GET with a 307 to a
 *     short-lived signed URL on its CDN, and the front passes that redirect
 *     to the Docker client, so layers (hundreds of MB) never go through
 *     usertasks.com. A registry that serves blobs inline is streamed instead.
 *   - Edition manifests (edition.json + edition.json.sig) are read from an
 *     OCI artifact tagged `edition-<ref>` in the same repository (pushed by
 *     the edition build with ORAS), with the same credential.
 */

import { createHash } from 'node:crypto'

export interface UpstreamRef {
  /** Registry host, e.g. ghcr.io */
  host: string
  /** Repository path, e.g. owner/name */
  repository: string
}

export interface UpstreamCredentials {
  username: string
  token: string
}

/** `ghcr.io/owner/name` → { host, repository }; null when it isn't one. */
export function parseUpstream(value: string | undefined | null): UpstreamRef | null {
  const v = value?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!v) return null
  const at = v.indexOf('/')
  if (at <= 0) return null
  const host = v.slice(0, at).toLowerCase()
  const repository = v.slice(at + 1).toLowerCase()
  if (!/^[a-z0-9.-]+(:[0-9]{1,5})?$/.test(host)) return null
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/.test(repository)) return null
  return { host, repository }
}

/** Manifest media types the front asks the upstream for (and relays). */
export const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
]

const MAX_ARTIFACT_FILE_BYTES = 256 * 1024

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface CachedToken { value: string; until: number }
const tokenCache = new Map<string, CachedToken>()

/** Parse `Bearer realm="…",service="…",scope="…"`. */
export function parseChallenge(header: string | null): { scheme: string; params: Record<string, string> } | null {
  if (!header) return null
  const m = /^\s*(\w+)\s+(.*)$/.exec(header)
  if (!m) return null
  const params: Record<string, string> = {}
  for (const p of m[2].matchAll(/(\w+)="([^"]*)"/g)) params[p[1].toLowerCase()] = p[2]
  return { scheme: m[1].toLowerCase(), params }
}

export class UpstreamError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message)
    this.name = 'UpstreamError'
  }
}

export class UpstreamRegistry {
  constructor(
    readonly ref: UpstreamRef,
    private readonly creds: UpstreamCredentials,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly nowMs: () => number = Date.now,
  ) {}

  private get base(): string {
    return `https://${this.ref.host}/v2`
  }

  private get cacheKey(): string {
    return `${this.ref.host}/${this.ref.repository}|${this.creds.username}`
  }

  private basic(): string {
    return `Basic ${Buffer.from(`${this.creds.username}:${this.creds.token}`).toString('base64')}`
  }

  /** A pull token for the repository (cached). */
  async token(fresh = false): Promise<string> {
    const hit = tokenCache.get(this.cacheKey)
    if (!fresh && hit && hit.until > this.nowMs()) return hit.value
    const ping = await this.fetchImpl(`${this.base}/`, { method: 'GET', redirect: 'manual', cache: 'no-store' })
    const challenge = parseChallenge(ping.headers.get('www-authenticate'))
    if (ping.ok) return '' // anonymous registry (tests / a mirror)
    if (!challenge || challenge.scheme !== 'bearer' || !challenge.params.realm) {
      if (challenge?.scheme === 'basic') return 'basic'
      throw new UpstreamError(`upstream registry ${this.ref.host}: no token challenge (HTTP ${ping.status})`)
    }
    const realm = new URL(challenge.params.realm)
    if (realm.protocol !== 'https:') throw new UpstreamError('upstream token realm is not https')
    if (challenge.params.service) realm.searchParams.set('service', challenge.params.service)
    realm.searchParams.set('scope', `repository:${this.ref.repository}:pull`)
    const res = await this.fetchImpl(realm.toString(), { headers: { Authorization: this.basic() }, redirect: 'error', cache: 'no-store' })
    if (!res.ok) throw new UpstreamError(`upstream registry refused the credential (HTTP ${res.status})`, res.status === 401 || res.status === 403 ? 503 : 502)
    const body = await res.json() as { token?: string; access_token?: string; expires_in?: number }
    const value = body.token ?? body.access_token
    if (!value) throw new UpstreamError('upstream registry returned no token')
    const ttl = Math.max(30, Math.min(Number(body.expires_in) || 300, 3600))
    tokenCache.set(this.cacheKey, { value, until: this.nowMs() + (ttl - 20) * 1000 })
    return value
  }

  /** A request to `/v2/<repository>/<path>` with the upstream credential; redirects are returned, not followed. */
  async request(path: string, init: { method?: 'GET' | 'HEAD'; accept?: string[] } = {}): Promise<Response> {
    const url = `${this.base}/${this.ref.repository}/${path}`
    const send = async (fresh: boolean) => {
      const token = await this.token(fresh)
      const headers: Record<string, string> = {}
      if (token === 'basic') headers.Authorization = this.basic()
      else if (token) headers.Authorization = `Bearer ${token}`
      if (init.accept?.length) headers.Accept = init.accept.join(', ')
      return this.fetchImpl(url, { method: init.method ?? 'GET', headers, redirect: 'manual', cache: 'no-store' })
    }
    let res = await send(false)
    if (res.status === 401) res = await send(true)
    return res
  }

  /** A small blob's bytes (following the CDN redirect), checked against its digest. */
  async smallBlob(digest: string, maxBytes = MAX_ARTIFACT_FILE_BYTES): Promise<Buffer> {
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new UpstreamError('bad blob digest')
    let res = await this.request(`blobs/${digest}`)
    for (let hops = 0; res.status >= 300 && res.status < 400 && hops < 3; hops++) {
      const location = res.headers.get('location')
      if (!location) break
      const next = new URL(location, `${this.base}/`)
      if (next.protocol !== 'https:') throw new UpstreamError('blob redirect is not https')
      res = await this.fetchImpl(next.toString(), { redirect: 'manual', cache: 'no-store' })
    }
    if (!res.ok) throw new UpstreamError(`blob ${digest.slice(0, 19)}…: HTTP ${res.status}`)
    const length = Number(res.headers.get('content-length') ?? 0)
    if (length > maxBytes) throw new UpstreamError('blob too large')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) throw new UpstreamError('blob too large')
    if (`sha256:${createHash('sha256').update(buf).digest('hex')}` !== digest) throw new UpstreamError('blob digest mismatch')
    return buf
  }

  /**
   * Files of an OCI artifact (ORAS: one layer per file, named by the
   * `org.opencontainers.image.title` annotation). Null when the tag does not exist.
   */
  async artifactFiles(tag: string, names: readonly string[]): Promise<Record<string, Buffer> | null> {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw new UpstreamError('bad tag')
    const res = await this.request(`manifests/${tag}`, { accept: ['application/vnd.oci.image.manifest.v1+json'] })
    if (res.status === 404) return null
    if (!res.ok) throw new UpstreamError(`artifact ${tag}: HTTP ${res.status}`)
    const manifest = await res.json() as { layers?: Array<{ digest?: string; size?: number; annotations?: Record<string, string> }> }
    const out: Record<string, Buffer> = {}
    for (const name of names) {
      const layer = manifest.layers?.find((l) => l.annotations?.['org.opencontainers.image.title'] === name)
      if (!layer?.digest) throw new UpstreamError(`artifact ${tag} has no ${name}`)
      if ((layer.size ?? 0) > MAX_ARTIFACT_FILE_BYTES) throw new UpstreamError(`${name} too large`)
      out[name] = await this.smallBlob(layer.digest)
    }
    return out
  }
}

/** Test hook. */
export function clearUpstreamTokenCache(): void {
  tokenCache.clear()
}
