/**
 * OAuth 2.1 helpers for UserTasks browser login: PKCE (RFC 7636, S256 only),
 * authorization-server discovery (RFC 8414), code exchange, refresh, dynamic
 * client registration (RFC 7591) and revocation (RFC 7009).
 *
 * The token endpoint rotates refresh tokens and treats a replayed refresh
 * token as theft (the whole chain is revoked), so a refresh token must never
 * be sent twice. `oauthAuth()` guarantees that within a process
 * (single-flight) and, through the store's lock, across processes.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import type { TokenProvider } from './auth'
import { UsertasksNetworkError } from './errors'

// ─── Types ───

export interface AuthorizationServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  revocation_endpoint?: string
  scopes_supported?: string[]
  code_challenge_methods_supported?: string[]
  /** Client id of the first-party UserTasks CLI, when the server has one. */
  usertasks_cli_client_id?: string
  [key: string]: unknown
}

export interface OAuthTokens {
  access_token: string
  refresh_token?: string
  /** Access-token expiry, epoch milliseconds. */
  expires_at?: number
  /** Space-delimited granted scopes. */
  scope?: string
}

/** An OAuth protocol error (`invalid_grant`, `access_denied`, …). */
export class UsertasksOAuthError extends Error {
  override readonly name = 'UsertasksOAuthError'
  readonly error: string
  readonly description?: string
  readonly status?: number

  constructor(error: string, description?: string, status?: number) {
    super(description ? `${error}: ${description}` : error)
    this.error = error
    this.description = description
    this.status = status
  }
}

// ─── PKCE / state ───

/** RFC 7636 code verifier: 32 random bytes → 43 base64url characters. */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/** S256 code challenge: BASE64URL(SHA256(ASCII(verifier))). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

/** Unguessable `state` value (256 bits). */
export function generateState(): string {
  return randomBytes(32).toString('base64url')
}

/** Constant-time string comparison (for `state`). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

// ─── HTTP ───

type FetchLike = typeof fetch

/** OAuth calls are bounded so a refresh can't hold the CLI's lock indefinitely. */
const OAUTH_TIMEOUT_MS = 30_000

async function send(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UsertasksNetworkError(`${init.method ?? 'GET'} ${url} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: response.status, body }
}

function oauthFailure(status: number, body: unknown, fallback: string): UsertasksOAuthError {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const code = typeof record.error === 'string' ? record.error : fallback
  const description = typeof record.error_description === 'string' ? record.error_description : status ? `HTTP ${status}` : undefined
  return new UsertasksOAuthError(code, description, status)
}

function postForm(fetchImpl: FetchLike, url: string, form: Record<string, string | undefined>) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(form)) if (value !== undefined) body.set(key, value)
  return send(fetchImpl, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

function toTokens(body: unknown, now: number): OAuthTokens {
  const record = (body ?? {}) as Record<string, unknown>
  if (typeof record.access_token !== 'string' || !record.access_token) {
    throw new UsertasksOAuthError('invalid_response', 'Token response has no access_token')
  }
  const expiresIn = Number(record.expires_in)
  return {
    access_token: record.access_token,
    ...(typeof record.refresh_token === 'string' && record.refresh_token ? { refresh_token: record.refresh_token } : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expires_at: now + expiresIn * 1000 } : {}),
    ...(typeof record.scope === 'string' ? { scope: record.scope } : {}),
  }
}

// ─── Endpoints ───

/** Fetch `/.well-known/oauth-authorization-server` for a server origin. */
export async function discoverAuthorizationServer(serverUrl: string, options: { fetch?: FetchLike } = {}): Promise<AuthorizationServerMetadata> {
  const origin = serverUrl.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '')
  const url = `${origin}/.well-known/oauth-authorization-server`
  const { status, body } = await send(options.fetch ?? globalThis.fetch, url, { method: 'GET' })
  const meta = body as AuthorizationServerMetadata | null
  if (status !== 200 || !meta || typeof meta !== 'object' || typeof meta.authorization_endpoint !== 'string' || typeof meta.token_endpoint !== 'string') {
    throw new UsertasksOAuthError('discovery_failed', `${url} did not return authorization-server metadata (HTTP ${status})`, status)
  }
  if (Array.isArray(meta.code_challenge_methods_supported) && !meta.code_challenge_methods_supported.includes('S256')) {
    throw new UsertasksOAuthError('discovery_failed', 'Server does not support PKCE S256')
  }
  return meta
}

export function buildAuthorizationUrl(params: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  scope: string
  state: string
  codeChallenge: string
}): string {
  const url = new URL(params.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', params.scope)
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export async function exchangeAuthorizationCode(params: {
  tokenEndpoint: string
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
  fetch?: FetchLike
  now?: () => number
}): Promise<OAuthTokens> {
  const { status, body } = await postForm(params.fetch ?? globalThis.fetch, params.tokenEndpoint, {
    grant_type: 'authorization_code',
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  })
  if (status !== 200) throw oauthFailure(status, body, 'invalid_grant')
  return toTokens(body, (params.now ?? Date.now)())
}

export async function refreshAccessToken(params: {
  tokenEndpoint: string
  clientId: string
  refreshToken: string
  fetch?: FetchLike
  now?: () => number
}): Promise<OAuthTokens> {
  const { status, body } = await postForm(params.fetch ?? globalThis.fetch, params.tokenEndpoint, {
    grant_type: 'refresh_token',
    client_id: params.clientId,
    refresh_token: params.refreshToken,
  })
  if (status !== 200) throw oauthFailure(status, body, 'invalid_grant')
  return toTokens(body, (params.now ?? Date.now)())
}

/** RFC 7009 revocation. The server answers 200 even for unknown tokens. */
export async function revokeToken(params: {
  revocationEndpoint: string
  clientId: string
  token: string
  tokenTypeHint?: 'access_token' | 'refresh_token'
  fetch?: FetchLike
}): Promise<void> {
  const { status, body } = await postForm(params.fetch ?? globalThis.fetch, params.revocationEndpoint, {
    token: params.token,
    token_type_hint: params.tokenTypeHint,
    client_id: params.clientId,
  })
  if (status !== 200) throw oauthFailure(status, body, 'revocation_failed')
}

/** RFC 7591 dynamic registration of a public (PKCE, no secret) client. */
export async function registerClient(params: {
  registrationEndpoint: string
  clientName: string
  redirectUris: string[]
  scope?: string
  fetch?: FetchLike
}): Promise<{ client_id: string; scope?: string }> {
  const { status, body } = await send(params.fetch ?? globalThis.fetch, params.registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: params.clientName,
      redirect_uris: params.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
      ...(params.scope ? { scope: params.scope } : {}),
    }),
  })
  const record = (body ?? {}) as Record<string, unknown>
  if (status !== 201 && status !== 200) throw oauthFailure(status, body, 'registration_failed')
  if (typeof record.client_id !== 'string') throw new UsertasksOAuthError('registration_failed', 'Response has no client_id')
  return { client_id: record.client_id, ...(typeof record.scope === 'string' ? { scope: record.scope } : {}) }
}

// ─── Refreshing token provider ───

/** Persistent token storage. `load()` must return what is stored NOW (no caching). */
export interface OAuthTokenStore {
  load(): Promise<OAuthTokens | null> | OAuthTokens | null
  save(tokens: OAuthTokens): Promise<void> | void
  /**
   * Run `fn` holding an exclusive lock shared with every other process using
   * the same storage. Refreshes run inside it and re-read the store first.
   */
  withLock?<T>(fn: () => Promise<T>): Promise<T>
}

export interface OAuthAuthOptions {
  store: OAuthTokenStore
  clientId: string
  tokenUrl: string
  fetch?: FetchLike
  /** Refresh this long before expiry (default 60 000 ms). */
  refreshSkewMs?: number
  now?: () => number
}

export interface OAuthTokenProvider extends TokenProvider {
  readonly kind: 'oauth'
}

/**
 * TokenProvider for OAuth access tokens: refreshes proactively when the
 * access token is within `refreshSkewMs` of expiry, and once after a 401.
 * Concurrent callers share one refresh; under the store lock the tokens are
 * re-read, and a refresh another process already did is adopted instead of
 * refreshing again.
 */
export function oauthAuth(options: OAuthAuthOptions): OAuthTokenProvider {
  const skew = options.refreshSkewMs ?? 60_000
  const now = options.now ?? Date.now
  const fetchImpl = options.fetch ?? globalThis.fetch
  /** Refresh tokens this provider has already presented (never send one twice). */
  const spent = new Set<string>()
  let current: OAuthTokens | null = null
  let inflight: Promise<OAuthTokens> | null = null

  const stale = (tokens: OAuthTokens) => tokens.expires_at !== undefined && tokens.expires_at - skew <= now()

  async function load(): Promise<OAuthTokens> {
    const tokens = await options.store.load()
    if (!tokens?.access_token) throw new UsertasksOAuthError('login_required', 'Not logged in')
    return tokens
  }

  async function doRefresh(seen: string): Promise<OAuthTokens> {
    const latest = await load()
    // Someone else (another process, or an earlier flight) already replaced
    // the token we found wanting: use theirs.
    if (latest.access_token !== seen && !stale(latest)) {
      current = latest
      return latest
    }
    const refreshToken = latest.refresh_token
    if (!refreshToken) throw new UsertasksOAuthError('login_required', 'Session expired and no refresh token is stored; log in again')
    if (spent.has(refreshToken)) {
      throw new UsertasksOAuthError('login_required', 'Refresh token was already used; log in again')
    }
    spent.add(refreshToken)
    const next = await refreshAccessToken({ tokenEndpoint: options.tokenUrl, clientId: options.clientId, refreshToken, fetch: fetchImpl, now })
    // A server that does not rotate may keep the old refresh token valid.
    if (!next.refresh_token) spent.delete(refreshToken)
    const merged: OAuthTokens = { ...next, refresh_token: next.refresh_token ?? refreshToken, scope: next.scope ?? latest.scope }
    await options.store.save(merged)
    current = merged
    return merged
  }

  function refresh(seen: string): Promise<OAuthTokens> {
    inflight ??= (async () => {
      try {
        const run = () => doRefresh(seen)
        return options.store.withLock ? await options.store.withLock(run) : await run()
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  return {
    kind: 'oauth',
    async getToken() {
      if (inflight) return (await inflight).access_token
      current ??= await load()
      if (stale(current)) current = await refresh(current.access_token)
      return current.access_token
    },
    async invalidate(rejectedToken: string) {
      const next = await refresh(rejectedToken)
      return next.access_token !== rejectedToken
    },
  }
}
