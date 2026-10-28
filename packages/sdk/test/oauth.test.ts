import { describe, expect, it, vi } from 'vitest'
import { UsertasksClient } from '../src/client'
import {
  UsertasksOAuthError,
  buildAuthorizationUrl,
  codeChallengeS256,
  discoverAuthorizationServer,
  exchangeAuthorizationCode,
  generateCodeVerifier,
  generateState,
  oauthAuth,
  registerClient,
  revokeToken,
  safeEqual,
  type OAuthTokenStore,
  type OAuthTokens,
} from '../src/oauth'

/** vi.fn / plain async functions as `fetch`. */
const asFetch = (fn: unknown) => fn as typeof fetch

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('PKCE (RFC 7636 appendix B)', () => {
  it('matches the RFC test vector', () => {
    const octets = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]
    const verifier = Buffer.from(octets).toString('base64url')
    expect(verifier).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('generates verifiers in the RFC grammar and unique states', () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
    expect(generateState()).not.toBe(generateState())
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })

  it('builds an S256 authorization URL', () => {
    const url = new URL(buildAuthorizationUrl({
      authorizationEndpoint: 'https://tasks.test/api/oauth/authorize',
      clientId: 'usertasks-cli', redirectUri: 'http://127.0.0.1:5000/callback', scope: 'a:read b:write', state: 's', codeChallenge: 'c',
    }))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code', client_id: 'usertasks-cli', redirect_uri: 'http://127.0.0.1:5000/callback',
      scope: 'a:read b:write', state: 's', code_challenge: 'c', code_challenge_method: 'S256',
    })
  })
})

describe('OAuth endpoints', () => {
  it('discovers metadata from the server origin', async () => {
    const fetchImpl = vi.fn(async () => json({ issuer: 'x', authorization_endpoint: 'https://t/a', token_endpoint: 'https://t/t', code_challenge_methods_supported: ['S256'] }))
    const meta = await discoverAuthorizationServer('https://tasks.test/api/v1/', { fetch: asFetch(fetchImpl) })
    expect(meta.token_endpoint).toBe('https://t/t')
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe('https://tasks.test/.well-known/oauth-authorization-server')
  })

  it('rejects metadata without S256 or endpoints', async () => {
    await expect(discoverAuthorizationServer('https://t', { fetch: asFetch(async () => json({ authorization_endpoint: 'a', token_endpoint: 'b', code_challenge_methods_supported: ['plain'] })) }))
      .rejects.toThrow(/S256/)
    await expect(discoverAuthorizationServer('https://t', { fetch: asFetch(async () => json({}, 404)) })).rejects.toBeInstanceOf(UsertasksOAuthError)
  })

  it('exchanges a code with the verifier as a form post', async () => {
    let sent: URLSearchParams | undefined
    const fetchImpl = vi.fn(async (_url: unknown, init: RequestInit) => {
      sent = new URLSearchParams(String(init.body))
      return json({ access_token: 'uoa_1', refresh_token: 'uor_1', expires_in: 3600, scope: 'a:read' })
    })
    const tokens = await exchangeAuthorizationCode({
      tokenEndpoint: 'https://t/token', clientId: 'cli', code: 'uoc_1', redirectUri: 'http://127.0.0.1:1/callback', codeVerifier: 'v', fetch: asFetch(fetchImpl), now: () => 1000,
    })
    expect(Object.fromEntries(sent!)).toEqual({ grant_type: 'authorization_code', client_id: 'cli', code: 'uoc_1', redirect_uri: 'http://127.0.0.1:1/callback', code_verifier: 'v' })
    expect(tokens).toEqual({ access_token: 'uoa_1', refresh_token: 'uor_1', expires_at: 1000 + 3600_000, scope: 'a:read' })
  })

  it('surfaces OAuth errors', async () => {
    const fetchImpl = async () => json({ error: 'invalid_grant' }, 400)
    await expect(exchangeAuthorizationCode({ tokenEndpoint: 'https://t', clientId: 'c', code: 'x', redirectUri: 'r', codeVerifier: 'v', fetch: asFetch(fetchImpl) }))
      .rejects.toMatchObject({ error: 'invalid_grant', status: 400 })
  })

  it('revokes and registers', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl = vi.fn(async (url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), body: String(init.body) })
      return String(url).endsWith('/register') ? json({ client_id: 'uocid_x', scope: 'a:read' }, 201) : json({})
    })
    await revokeToken({ revocationEndpoint: 'https://t/revoke', clientId: 'cli', token: 'uor_1', tokenTypeHint: 'refresh_token', fetch: asFetch(fetchImpl) })
    expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toEqual({ token: 'uor_1', token_type_hint: 'refresh_token', client_id: 'cli' })
    const reg = await registerClient({ registrationEndpoint: 'https://t/register', clientName: 'CLI', redirectUris: ['http://127.0.0.1/callback'], fetch: asFetch(fetchImpl) })
    expect(reg.client_id).toBe('uocid_x')
    expect(JSON.parse(calls[1].body)).toMatchObject({ token_endpoint_auth_method: 'none', redirect_uris: ['http://127.0.0.1/callback'] })
  })
})

// ─── oauthAuth ───

/** In-memory store; `locked` lets a test simulate another process inside the lock. */
function memoryStore(initial: OAuthTokens | null, hooks: { insideLock?: (store: { tokens: OAuthTokens | null }) => void } = {}) {
  const state = { tokens: initial, saves: [] as OAuthTokens[], lockCount: 0 }
  let chain = Promise.resolve()
  const store: OAuthTokenStore = {
    load: () => (state.tokens ? { ...state.tokens } : null),
    save: (tokens) => {
      state.tokens = tokens
      state.saves.push(tokens)
    },
    withLock: <T>(fn: () => Promise<T>) => {
      const run = chain.then(async () => {
        state.lockCount++
        hooks.insideLock?.(state)
        return fn()
      })
      chain = run.then(() => undefined, () => undefined)
      return run
    },
  }
  return { store, state }
}

/** Fake token endpoint enforcing rotation + reuse detection like the real server. */
function tokenServer() {
  let n = 0
  const live = new Set<string>(['uor_0'])
  const presented: string[] = []
  const fetchImpl = vi.fn(async (_url: unknown, init: RequestInit) => {
    const form = new URLSearchParams(String(init.body))
    const token = form.get('refresh_token')!
    presented.push(token)
    if (!live.has(token)) return json({ error: 'invalid_grant' }, 400)
    live.delete(token)
    n++
    live.add(`uor_${n}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
    return json({ access_token: `uoa_${n}`, refresh_token: `uor_${n}`, expires_in: 3600 })
  })
  return { fetchImpl, presented }
}

describe('oauthAuth', () => {
  const NOW = 1_000_000

  it('returns the stored token while it is fresh', async () => {
    const { store } = memoryStore({ access_token: 'uoa_0', refresh_token: 'uor_0', expires_at: NOW + 120_000 })
    const server = tokenServer()
    const auth = oauthAuth({ store, clientId: 'cli', tokenUrl: 'https://t/token', fetch: asFetch(server.fetchImpl), now: () => NOW })
    expect(await auth.getToken()).toBe('uoa_0')
    expect(server.fetchImpl).not.toHaveBeenCalled()
  })

  it('refreshes proactively within 60 s of expiry and saves the rotated pair', async () => {
    const { store, state } = memoryStore({ access_token: 'uoa_0', refresh_token: 'uor_0', expires_at: NOW + 59_000, scope: 's' })
    const server = tokenServer()
    const auth = oauthAuth({ store, clientId: 'cli', tokenUrl: 'https://t/token', fetch: asFetch(server.fetchImpl), now: () => NOW })
    expect(await auth.getToken()).toBe('uoa_1')
    expect(state.tokens).toEqual({ access_token: 'uoa_1', refresh_token: 'uor_1', expires_at: NOW + 3600_000, scope: 's' })
    const form = new URLSearchParams(String((server.fetchImpl.mock.calls[0] as unknown[] as [unknown, RequestInit])[1].body))
    expect(Object.fromEntries(form)).toEqual({ grant_type: 'refresh_token', client_id: 'cli', refresh_token: 'uor_0' })
  })

  it('single-flight: concurrent callers share one refresh', async () => {
    const { store, state } = memoryStore({ access_token: 'uoa_0', refresh_token: 'uor_0', expires_at: NOW - 1 })
    const server = tokenServer()
    const auth = oauthAuth({ store, clientId: 'cli', tokenUrl: 'https://t/token', fetch: asFetch(server.fetchImpl), now: () => NOW })
    const tokens = await Promise.all(Array.from({ length: 8 }, () => auth.getToken()))
    expect(new Set(tokens)).toEqual(new Set(['uoa_1']))
    expect(server.presented).toEqual(['uor_0'])
    expect(state.saves).toHaveLength(1)
  })

  it('two providers on one store (two processes) never present the same refresh token', async () => {
    const { store } = memoryStore({ access_token: 'uoa_0', refresh_token: 'uor_0', expires_at: NOW - 1 })
    const server = tokenServer()
    const a = oauthAuth({ store, clientId: 'cli', tokenUrl: 'https://t/token', fetch: asFetch(server.fetchImpl), now: () => NOW })
    const b = oauthAuth({ store, clientId: 'cli', tokenUrl: 'https://t/token', fetch: asFetch(server.fetchImpl), now: () => NOW })
    const [ta, tb] = await Promise.all([a.getToken(), b.getToken()])
    expect(ta).toBe('uoa_1')
    expect(tb).toBe('uoa_1') // b re-read under the lock and adopted a's refresh
    expect(server.presented).toEqual(['uor_0'])
  })

  it('re-reads the store after acquiring the lock and adopts a refresh done elsewhere', async () => {
    const { store } = memoryStore(
      { access_token: 'uoa_0', refresh_token: 'uor_0', expires_at: NOW - 1 },
      { insideLock: (state) => { state.tokens = { access_token: 'uoa_other', refresh_token: 'uor_other', expires_at: NOW + 3600_000 } } },
    )
    const server = tokenServer()
    const auth = oauthAuth({ store, clientId: 'cli', tokenUrl: 'https://t/token', fetch: asFetch(server.fetchImpl), now: () => NOW })
    expect(await auth.getToken()).toBe('uoa_other')
    expect(server.fetchImpl).not.toHaveBeenCalled()
  })

  it('refreshes once on a 401 and retries the request', async () => {
    const { store } = memoryStore({ access_token: 'uoa_0', refresh_token: 'uor_0', expires_at: NOW + 3600_000 })
    const server = tokenServer()
    const auth = oauthAuth({ store, clientId: 'cli', tokenUrl: 'https://t/token', fetch: asFetch(server.fetchImpl), now: () => NOW })
    const seen: string[] = []
    const api = vi.fn(async (_url: unknown, init: RequestInit) => {
      const bearer = (init.headers as Record<string, string>).Authorization
      seen.push(bearer)
      return bearer === 'Bearer uoa_1' ? json({ success: true, data: { ok: true } }) : json({ success: false, error: 'expired' }, 401)
    })
    const client = new UsertasksClient({ baseUrl: 'https://tasks.test', auth, fetch: asFetch(api), retries: 0 })
    expect(await client.request('GET', '/me')).toEqual({ ok: true })
    expect(seen).toEqual(['Bearer uoa_0', 'Bearer uoa_1'])
    expect(server.presented).toEqual(['uor_0'])
  })

  it('a second 401 is surfaced without another refresh', async () => {
    const { store } = memoryStore({ access_token: 'uoa_0', refresh_token: 'uor_0', expires_at: NOW + 3600_000 })
    const server = tokenServer()
    const auth = oauthAuth({ store, clientId: 'cli', tokenUrl: 'https://t/token', fetch: asFetch(server.fetchImpl), now: () => NOW })
    const api = vi.fn(async () => json({ success: false, error: 'no longer authorized' }, 401))
    const client = new UsertasksClient({ baseUrl: 'https://tasks.test', auth, fetch: asFetch(api), retries: 0 })
    await expect(client.request('GET', '/me')).rejects.toMatchObject({ status: 401 })
    expect(api).toHaveBeenCalledTimes(2)
    expect(server.presented).toEqual(['uor_0'])
  })

  it('never presents a refresh token twice, even if the store hands it back', async () => {
    // The save is lost (store keeps returning the old pair): a reuse would
    // revoke the whole session server-side, so the provider must refuse.
    const stuck: OAuthTokens = { access_token: 'uoa_0', refresh_token: 'uor_0', expires_at: NOW - 1 }
    const store: OAuthTokenStore = { load: () => ({ ...stuck }), save: () => {} }
    const server = tokenServer()
    let clock = NOW
    const auth = oauthAuth({ store, clientId: 'cli', tokenUrl: 'https://t/token', fetch: asFetch(server.fetchImpl), now: () => clock })
    expect(await auth.getToken()).toBe('uoa_1')
    clock += 3600_000 // uoa_1 now stale too
    const rejected = await auth.invalidate!('uoa_1').catch((error: unknown) => error)
    expect(rejected).toBeInstanceOf(UsertasksOAuthError)
    expect((rejected as UsertasksOAuthError).error).toBe('login_required')
    expect(server.presented).toEqual(['uor_0'])
  })

  it('refresh failure (revoked session) asks for a new login', async () => {
    const { store } = memoryStore({ access_token: 'uoa_0', refresh_token: 'uor_revoked', expires_at: NOW - 1 })
    const server = tokenServer()
    const auth = oauthAuth({ store, clientId: 'cli', tokenUrl: 'https://t/token', fetch: asFetch(server.fetchImpl), now: () => NOW })
    await expect(auth.getToken()).rejects.toMatchObject({ error: 'invalid_grant' })
  })

  it('no stored tokens → login_required', async () => {
    const auth = oauthAuth({ store: { load: () => null, save: () => {} }, clientId: 'cli', tokenUrl: 'https://t/token' })
    await expect(auth.getToken()).rejects.toMatchObject({ error: 'login_required' })
  })
})
