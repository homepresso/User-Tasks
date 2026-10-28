import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose'

/**
 * A minimal OpenID Connect provider for tests and local E2E: discovery,
 * JWKS (RS256), an authorization endpoint that signs in a preset user
 * immediately (redirects back with a code), a token endpoint that checks the
 * client secret, redirect_uri and PKCE verifier, and userinfo.
 *
 *   const idp = await startMockOidcIdp({ clientId: 'app', clientSecret: 's' })
 *   idp.user = { sub: 'u1', email: 'a@x.test', email_verified: true, groups: ['admins'] }
 *
 * `tamper` lets a test break one property of the next ID token.
 */

export interface MockOidcUser {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  groups?: string[]
  [claim: string]: unknown
}

export interface MockOidcIdp {
  issuer: string
  url: string
  user: MockOidcUser
  tamper: null | 'nonce' | 'audience' | 'issuer' | 'expired' | 'signature'
  /** Codes issued and not yet redeemed. */
  codes: Map<string, { nonce: string; challenge: string; redirectUri: string; user: MockOidcUser }>
  close(): Promise<void>
}

export async function startMockOidcIdp(opts: { clientId: string; clientSecret: string; port?: number; path?: string }): Promise<MockOidcIdp> {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const other = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  const accessTokens = new Map<string, MockOidcUser>()

  const state: MockOidcIdp = {
    issuer: '',
    url: '',
    user: { sub: 'mock-user', email: 'mock@idp.test', email_verified: true, name: 'Mock User' },
    tamper: null,
    codes: new Map(),
    close: async () => undefined,
  }

  const sign = async (claims: Record<string, unknown>, key: CryptoKey) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).sign(key)

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', state.url)
    const base = opts.path ?? ''
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === `${base}/.well-known/openid-configuration`) {
      return json(200, {
        issuer: state.issuer,
        authorization_endpoint: `${state.issuer}/authorize`,
        token_endpoint: `${state.issuer}/token`,
        jwks_uri: `${state.issuer}/jwks`,
        userinfo_endpoint: `${state.issuer}/userinfo`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (url.pathname === `${base}/jwks`) return json(200, { keys: [jwk] })
    if (url.pathname === `${base}/authorize`) {
      const p = url.searchParams
      if (p.get('client_id') !== opts.clientId || p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256') {
        return json(400, { error: 'invalid_request' })
      }
      const code = randomBytes(16).toString('hex')
      state.codes.set(code, { nonce: p.get('nonce') ?? '', challenge: p.get('code_challenge') ?? '', redirectUri: p.get('redirect_uri') ?? '', user: { ...state.user } })
      const back = new URL(p.get('redirect_uri') ?? '')
      back.searchParams.set('code', code)
      back.searchParams.set('state', p.get('state') ?? '')
      res.writeHead(302, { location: back.toString() })
      return res.end()
    }
    if (url.pathname === `${base}/token` && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
      let clientId = form.get('client_id')
      let secret = form.get('client_secret')
      const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '')
      if (basic) {
        const [id, s] = Buffer.from(basic[1], 'base64').toString('utf8').split(':').map(decodeURIComponent)
        clientId = id
        secret = s
      }
      if (clientId !== opts.clientId || secret !== opts.clientSecret) return json(401, { error: 'invalid_client' })
      const grant = state.codes.get(form.get('code') ?? '')
      if (!grant) return json(400, { error: 'invalid_grant', error_description: 'unknown or used code' })
      state.codes.delete(form.get('code') ?? '')
      if (grant.redirectUri !== form.get('redirect_uri')) return json(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' })
      const verifier = form.get('code_verifier') ?? ''
      if (createHash('sha256').update(verifier).digest('base64url') !== grant.challenge) {
        return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' })
      }
      const now = Math.floor(Date.now() / 1000)
      const tamper = state.tamper
      state.tamper = null
      const claims: Record<string, unknown> = {
        ...grant.user,
        iss: tamper === 'issuer' ? 'https://evil.example' : state.issuer,
        aud: tamper === 'audience' ? 'someone-else' : opts.clientId,
        nonce: tamper === 'nonce' ? 'wrong-nonce' : grant.nonce,
        iat: tamper === 'expired' ? now - 7200 : now,
        exp: tamper === 'expired' ? now - 3600 : now + 300,
      }
      const idToken = await sign(claims, tamper === 'signature' ? other.privateKey : privateKey)
      const accessToken = randomBytes(16).toString('hex')
      accessTokens.set(accessToken, grant.user)
      return json(200, { access_token: accessToken, token_type: 'Bearer', expires_in: 300, id_token: idToken })
    }
    if (url.pathname === `${base}/userinfo`) {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
      const user = accessTokens.get(token)
      if (!user) return json(401, { error: 'invalid_token' })
      return json(200, user)
    }
    json(404, { error: 'not_found' })
  })

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  state.url = `http://127.0.0.1:${port}`
  state.issuer = `${state.url}${opts.path ?? ''}`
  state.close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return state
}

/** Follow the IdP's authorization redirect: returns the callback URL it sends the browser to. */
export async function authorizeAtMockIdp(authorizationUrl: string): Promise<URL> {
  const res = await fetch(authorizationUrl, { redirect: 'manual' })
  const location = res.headers.get('location')
  if (res.status !== 302 || !location) throw new Error(`mock IdP authorize failed: HTTP ${res.status}`)
  return new URL(location)
}
