import { createHash } from 'node:crypto'
import { existsSync, statSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore, type OAuthCredentials } from '../src/config'
import { EXIT } from '../src/exit-codes'
import type { Io } from '../src/io'
import { run } from '../src/main'
import { tempConfigPath } from './helpers'

// ─── Fake authorization server + API ───

interface FakeServer {
  url: string
  close(): Promise<void>
  /** Authorize requests the "browser" made. */
  authorizeRequests: URLSearchParams[]
  tokenRequests: URLSearchParams[]
  revokeRequests: URLSearchParams[]
  registerRequests: Record<string, unknown>[]
  meAuth: string[]
  /** Behaviour switches. */
  options: { firstParty: boolean; denyConsent: boolean; meRejects: Set<string> }
}

const ME = {
  tenant: { id: 't1', name: 'Acme', slug: 'acme' },
  user: { id: 'u1', email: 'ada@acme.test' },
  auth: { kind: 'oauth', key_type: 'user', oauth_scopes: ['workflows:read'], expires_at: '2030-01-01T00:00:00.000Z' },
  permissions: ['workflows.view'],
  resource_scopes: { workflow_ids: [], table_ids: [] },
}

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function startFakeServer(): Promise<FakeServer> {
  const codes = new Map<string, { challenge: string; redirectUri: string; clientId: string; scope: string }>()
  const liveAccess = new Set<string>()
  const liveRefresh = new Set<string>()
  const clients = new Map<string, string[]>([['usertasks-cli', ['http://127.0.0.1/callback']]])
  let n = 0
  const state: Omit<FakeServer, 'url' | 'close'> = {
    authorizeRequests: [], tokenRequests: [], revokeRequests: [], registerRequests: [], meAuth: [],
    options: { firstParty: true, denyConsent: false, meRejects: new Set() },
  }
  const issue = (scope: string) => {
    n++
    const pair = { access_token: `uoa_${n}`, refresh_token: `uor_${n}`, expires_in: 3600, token_type: 'Bearer', scope }
    liveAccess.add(pair.access_token)
    liveRefresh.add(pair.refresh_token)
    return pair
  }
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1')
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      res.end(JSON.stringify(body))
    }
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return send(200, {
        issuer: base,
        authorization_endpoint: `${base}/api/oauth/authorize`,
        token_endpoint: `${base}/api/oauth/token`,
        registration_endpoint: `${base}/api/oauth/register`,
        revocation_endpoint: `${base}/api/oauth/revoke`,
        scopes_supported: ['tasks:read', 'workflows:read', 'config:write', 'keys:write', 'mcp', 'admin'],
        code_challenge_methods_supported: ['S256'],
        ...(state.options.firstParty ? { usertasks_cli_client_id: 'usertasks-cli' } : {}),
      })
    }
    if (url.pathname === '/api/oauth/authorize') {
      const params = url.searchParams
      state.authorizeRequests.push(params)
      const redirect = new URL(params.get('redirect_uri')!)
      const registered = clients.get(params.get('client_id')!) ?? []
      const okRedirect = redirect.protocol === 'http:' && redirect.hostname === '127.0.0.1'
        && registered.some((uri) => new URL(uri).pathname === redirect.pathname)
      if (!okRedirect || params.get('code_challenge_method') !== 'S256') return send(400, { error: 'bad request' })
      if (state.options.denyConsent) {
        redirect.searchParams.set('error', 'access_denied')
      } else {
        const code = `uoc_${Math.random().toString(36).slice(2)}`
        codes.set(code, { challenge: params.get('code_challenge')!, redirectUri: params.get('redirect_uri')!, clientId: params.get('client_id')!, scope: params.get('scope')! })
        redirect.searchParams.set('code', code)
      }
      redirect.searchParams.set('state', params.get('state')!)
      res.writeHead(302, { Location: redirect.toString() })
      return res.end()
    }
    if (url.pathname === '/api/oauth/token' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req))
      state.tokenRequests.push(form)
      if (form.get('grant_type') === 'authorization_code') {
        const entry = codes.get(form.get('code')!)
        codes.delete(form.get('code')!)
        const verifier = form.get('code_verifier') ?? ''
        if (!entry || entry.redirectUri !== form.get('redirect_uri') || entry.clientId !== form.get('client_id')
          || createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) {
          return send(400, { error: 'invalid_grant' })
        }
        return send(200, issue(entry.scope))
      }
      if (form.get('grant_type') === 'refresh_token') {
        const token = form.get('refresh_token')!
        if (!liveRefresh.delete(token)) return send(400, { error: 'invalid_grant' })
        return send(200, issue('workflows:read'))
      }
      return send(400, { error: 'unsupported_grant_type' })
    }
    if (url.pathname === '/api/oauth/revoke' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req))
      state.revokeRequests.push(form)
      liveAccess.delete(form.get('token')!)
      liveRefresh.delete(form.get('token')!)
      return send(200, {})
    }
    if (url.pathname === '/api/oauth/register' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req))
      state.registerRequests.push(body)
      const id = `uocid_${state.registerRequests.length}`
      clients.set(id, body.redirect_uris)
      return send(201, { client_id: id, redirect_uris: body.redirect_uris })
    }
    if (url.pathname === '/api/v1/me') {
      const auth = String(req.headers.authorization ?? '')
      state.meAuth.push(auth)
      const token = auth.replace(/^Bearer /, '')
      if (!liveAccess.has(token) || state.options.meRejects.has(token)) return send(401, { success: false, error: 'Invalid or revoked access token' })
      return send(200, { success: true, data: ME })
    }
    send(404, { error: 'not found' })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    ...state,
    get options() { return state.options },
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }),
  } as FakeServer
}

// ─── Fake browser + CLI harness (real fetch, real loopback listener) ───

interface BrowserVisit { status: number; body: string; callback: URL }

function cli(configPath: string, options: { browser?: (authorizeUrl: string) => Promise<void>; loginTimeoutMs?: number } = {}) {
  const stdout: string[] = []
  const stderr: string[] = []
  const opened: string[] = []
  const browsing: Promise<unknown>[] = []
  const io: Io = {
    env: {},
    stdout: { write: (chunk: string) => stdout.push(chunk), isTTY: false },
    stderr: { write: (chunk: string) => stderr.push(chunk), isTTY: false },
    stdinIsTTY: false,
    readStdin: async () => '',
    confirm: async () => true,
    promptSecret: async () => '',
    configPath,
    openBrowser: async (url) => {
      opened.push(url)
      // Like a real browser: runs on its own; the test waits for it after the CLI returns.
      browsing.push((options.browser?.(url) ?? Promise.resolve()).catch(() => {}))
    },
    ...(options.loginTimeoutMs ? { loginTimeoutMs: options.loginTimeoutMs } : {}),
  }
  return { io, opened, stdout: () => stdout.join(''), stderr: () => stderr.join(''), run: async (...args: string[]) => {
    const code = await run(args, io)
    await Promise.all(browsing)
    return code
  } }
}

/** Consenting user: follow the authorize redirect to the CLI's loopback callback. */
function consentingBrowser(visits: BrowserVisit[], tamper?: (callback: URL) => URL[]) {
  return async (authorizeUrl: string) => {
    const response = await fetch(authorizeUrl, { redirect: 'manual' })
    const callback = new URL(response.headers.get('location')!)
    for (const target of tamper ? tamper(callback) : [callback]) {
      const result = await fetch(target)
      visits.push({ status: result.status, body: await result.text(), callback: target })
    }
  }
}

function storedCredentials(configPath: string, profile = 'default'): OAuthCredentials | undefined {
  const credentials = new ConfigStore(configPath).read().profiles[profile]?.credentials
  return credentials?.type === 'oauth' ? credentials : undefined
}

let fake: FakeServer
beforeEach(async () => { fake = await startFakeServer() })
afterEach(async () => { await fake.close() })

describe('usertasks login (browser)', () => {
  it('runs discovery → loopback → PKCE → exchange → /me and stores tokens 0600', async () => {
    const configPath = tempConfigPath()
    const visits: BrowserVisit[] = []
    const c = cli(configPath, { browser: consentingBrowser(visits) })
    expect(await c.run('login', '--url', fake.url)).toBe(0)

    // Authorize request: first-party client, loopback redirect on an ephemeral port, S256.
    const authorize = fake.authorizeRequests[0]
    expect(authorize.get('client_id')).toBe('usertasks-cli')
    expect(authorize.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(authorize.get('code_challenge_method')).toBe('S256')
    expect(authorize.get('state')!.length).toBeGreaterThanOrEqual(43)
    // Default scopes: everything offered except admin, mcp and keys:write.
    expect(authorize.get('scope')).toBe('tasks:read workflows:read config:write')

    // Token request carried the verifier for that challenge and the same redirect_uri.
    const token = fake.tokenRequests[0]
    expect(token.get('grant_type')).toBe('authorization_code')
    expect(createHash('sha256').update(token.get('code_verifier')!).digest('base64url')).toBe(authorize.get('code_challenge'))
    expect(token.get('redirect_uri')).toBe(authorize.get('redirect_uri'))

    expect(fake.meAuth).toEqual(['Bearer uoa_1'])
    expect(visits).toHaveLength(1)
    expect(visits[0].status).toBe(200)
    expect(visits[0].body).toContain('Logged in to UserTasks')
    expect(c.stderr()).toContain(`Logged in to ${fake.url} as ada@acme.test @ Acme`)
    expect(c.stderr()).toContain('/api/oauth/authorize?') // URL always printed

    const config = new ConfigStore(configPath).read()
    expect(config.current_profile).toBe('default')
    expect(config.profiles.default).toMatchObject({ url: fake.url, tenant: ME.tenant, user: ME.user })
    expect(config.profiles.default.oauth_client).toBeUndefined()
    expect(storedCredentials(configPath)).toMatchObject({
      type: 'oauth', client_id: 'usertasks-cli', access_token: 'uoa_1', refresh_token: 'uor_1',
      token_endpoint: `${fake.url}/api/oauth/token`, revocation_endpoint: `${fake.url}/api/oauth/revoke`,
    })
    expect(Date.parse(storedCredentials(configPath)!.expires_at!)).toBeGreaterThan(Date.now() + 3500_000)
    if (process.platform !== 'win32') {
      expect(statSync(configPath).mode & 0o777).toBe(0o600)
      expect(statSync(dirname(configPath)).mode & 0o777).toBe(0o700)
    }
  })

  it('ignores a callback with the wrong state (no exchange) and completes on the real one', async () => {
    const configPath = tempConfigPath()
    const visits: BrowserVisit[] = []
    const forged = (callback: URL) => {
      const bad = new URL(callback)
      bad.searchParams.set('state', 'attacker-state')
      const missing = new URL(callback)
      missing.searchParams.delete('state')
      return [bad, missing, callback]
    }
    const c = cli(configPath, { browser: consentingBrowser(visits, forged) })
    expect(await c.run('login', '--url', fake.url)).toBe(0)
    expect(visits.map((v) => v.status)).toEqual([400, 400, 200])
    expect(visits[0].body).toContain('state mismatch')
    expect(fake.tokenRequests).toHaveLength(1)
  })

  it('a callback after success is refused', async () => {
    const configPath = tempConfigPath()
    const visits: BrowserVisit[] = []
    const c = cli(configPath, { browser: consentingBrowser(visits, (cb) => [cb, cb]) })
    expect(await c.run('login', '--url', fake.url)).toBe(0)
    expect(visits[0].status).toBe(200)
    // Either refused by the listener (400) or the listener is already gone.
    expect(fake.tokenRequests).toHaveLength(1)
  }, 10_000)

  it('access_denied → exit 3 and nothing stored', async () => {
    fake.options.denyConsent = true
    const configPath = tempConfigPath()
    const visits: BrowserVisit[] = []
    const c = cli(configPath, { browser: consentingBrowser(visits) })
    expect(await c.run('login', '--url', fake.url)).toBe(EXIT.unauthenticated)
    expect(c.stderr()).toContain('access_denied')
    expect(visits[0].status).toBe(400)
    expect(fake.tokenRequests).toHaveLength(0)
    expect(new ConfigStore(configPath).read().profiles).toEqual({})
  })

  it('tokens that fail GET /me are not stored', async () => {
    fake.options.meRejects.add('uoa_1')
    const configPath = tempConfigPath()
    const visits: BrowserVisit[] = []
    const c = cli(configPath, { browser: consentingBrowser(visits) })
    expect(await c.run('login', '--url', fake.url)).toBe(EXIT.unauthenticated)
    expect(visits[0].status).toBe(500)
    expect(new ConfigStore(configPath).read().profiles).toEqual({})
  })

  it('--no-browser only prints the URL, and the login times out', async () => {
    const configPath = tempConfigPath()
    const c = cli(configPath, { loginTimeoutMs: 300 })
    expect(await c.run('login', '--url', fake.url, '--no-browser')).toBe(EXIT.unauthenticated)
    expect(c.opened).toEqual([])
    expect(c.stderr()).toContain('Open this URL in a browser')
    expect(c.stderr()).toMatch(/http:\/\/127\.0\.0\.1:\d+\/api\/oauth\/authorize\?/)
    expect(c.stderr()).toContain('Timed out')
    expect(fake.tokenRequests).toHaveLength(0)
    expect(new ConfigStore(configPath).read().profiles).toEqual({})
  })

  it('the loopback listener is gone after a timeout', async () => {
    const configPath = tempConfigPath()
    const c = cli(configPath, { loginTimeoutMs: 200 })
    expect(await c.run('login', '--url', fake.url, '--no-browser')).toBe(EXIT.unauthenticated)
    const redirect = c.stderr().match(/redirect_uri=([^&\s]+)/)![1]
    await expect(fetch(decodeURIComponent(redirect))).rejects.toThrow()
  })

  it('--scopes overrides the default (keys:write is opt-in)', async () => {
    const configPath = tempConfigPath()
    const c = cli(configPath, { browser: consentingBrowser([]) })
    expect(await c.run('login', '--url', fake.url, '--scopes', 'workflows:read,keys:write')).toBe(0)
    expect(fake.authorizeRequests[0].get('scope')).toBe('workflows:read keys:write')
  })

  it('falls back to dynamic registration and reuses the client on the next login', async () => {
    fake.options.firstParty = false
    const configPath = tempConfigPath()
    expect(await cli(configPath, { browser: consentingBrowser([]) }).run('login', '--url', fake.url)).toBe(0)
    expect(fake.registerRequests).toHaveLength(1)
    const registeredUris = fake.registerRequests[0].redirect_uris as string[]
    expect(registeredUris[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(fake.registerRequests[0].scope).toBe('tasks:read workflows:read config:write')
    const profile = new ConfigStore(configPath).read().profiles.default
    expect(profile.oauth_client).toEqual({ client_id: 'uocid_1', redirect_uri: registeredUris[0] })
    expect(storedCredentials(configPath)?.client_id).toBe('uocid_1')

    expect(await cli(configPath, { browser: consentingBrowser([]) }).run('login', '--url', fake.url)).toBe(0)
    expect(fake.registerRequests).toHaveLength(1) // reused
    expect(fake.authorizeRequests[1].get('client_id')).toBe('uocid_1')
    expect(fake.authorizeRequests[1].get('redirect_uri')).toBe(registeredUris[0])
  })
})

describe('using and ending a browser login', () => {
  async function loggedIn() {
    const configPath = tempConfigPath()
    expect(await cli(configPath, { browser: consentingBrowser([]) }).run('login', '--url', fake.url)).toBe(0)
    return configPath
  }

  it('whoami uses the access token and shows kind, scopes and expiry', async () => {
    const configPath = await loggedIn()
    const c = cli(configPath)
    expect(await c.run('whoami', '-o', 'table')).toBe(0)
    expect(fake.meAuth.at(-1)).toBe('Bearer uoa_1')
    expect(c.stdout()).toContain('oauth (user)')
    expect(c.stdout()).toContain('workflows:read')
    expect(c.stdout()).toContain('2030-01-01')
  })

  it('refreshes proactively when the stored token is about to expire', async () => {
    const configPath = await loggedIn()
    new ConfigStore(configPath).update((config) => {
      const creds = config.profiles.default.credentials as OAuthCredentials
      creds.expires_at = new Date(Date.now() + 30_000).toISOString()
    })
    expect(await cli(configPath).run('whoami')).toBe(0)
    expect(fake.tokenRequests.at(-1)!.get('grant_type')).toBe('refresh_token')
    expect(fake.tokenRequests.at(-1)!.get('refresh_token')).toBe('uor_1')
    expect(fake.meAuth.at(-1)).toBe('Bearer uoa_2')
    expect(storedCredentials(configPath)).toMatchObject({ access_token: 'uoa_2', refresh_token: 'uor_2' })
    expect(existsSync(`${configPath}.lock`)).toBe(false)
    if (process.platform !== 'win32') expect(statSync(configPath).mode & 0o777).toBe(0o600)
  })

  it('refreshes once after a 401 and retries', async () => {
    const configPath = await loggedIn()
    fake.options.meRejects.add('uoa_1')
    expect(await cli(configPath).run('whoami')).toBe(0)
    expect(fake.meAuth.slice(-2)).toEqual(['Bearer uoa_1', 'Bearer uoa_2'])
    expect(fake.tokenRequests.filter((f) => f.get('grant_type') === 'refresh_token')).toHaveLength(1)
  })

  it('parallel CLI processes sharing the config refresh only once', async () => {
    const configPath = await loggedIn()
    new ConfigStore(configPath).update((config) => {
      (config.profiles.default.credentials as OAuthCredentials).expires_at = new Date(Date.now() - 1000).toISOString()
    })
    const codes = await Promise.all([cli(configPath).run('whoami'), cli(configPath).run('whoami'), cli(configPath).run('whoami')])
    expect(codes).toEqual([0, 0, 0])
    const refreshes = fake.tokenRequests.filter((f) => f.get('grant_type') === 'refresh_token')
    expect(refreshes.map((f) => f.get('refresh_token'))).toEqual(['uor_1'])
  })

  it('a dead session (refresh rejected) exits 3 with a login hint', async () => {
    const configPath = await loggedIn()
    new ConfigStore(configPath).update((config) => {
      const creds = config.profiles.default.credentials as OAuthCredentials
      creds.expires_at = new Date(Date.now() - 1000).toISOString()
      creds.refresh_token = 'uor_revoked'
    })
    const c = cli(configPath)
    expect(await c.run('whoami')).toBe(EXIT.unauthenticated)
    expect(c.stderr()).toContain('run `usertasks login` again')
  })

  it('USERTASKS_API_KEY wins over stored OAuth tokens', async () => {
    const configPath = await loggedIn()
    const c = cli(configPath)
    c.io.env.USERTASKS_API_KEY = 'ut_env'
    await c.run('whoami')
    expect(fake.meAuth.at(-1)).toBe('Bearer ut_env')
  })

  it('stored tokens are never sent to a different --url', async () => {
    const configPath = await loggedIn()
    const c = cli(configPath)
    expect(await c.run('whoami', '--url', 'http://127.0.0.1:1')).toBe(EXIT.unauthenticated)
    expect(c.stderr()).toContain('Not logged in')
  })

  it('logout revokes refresh and access tokens, then clears them', async () => {
    const configPath = await loggedIn()
    const c = cli(configPath)
    expect(await c.run('logout')).toBe(0)
    expect(fake.revokeRequests.map((f) => [f.get('token'), f.get('token_type_hint'), f.get('client_id')])).toEqual([
      ['uor_1', 'refresh_token', 'usertasks-cli'],
      ['uoa_1', 'access_token', 'usertasks-cli'],
    ])
    expect(c.stderr()).toContain('revoked on the server')
    const profile = new ConfigStore(configPath).read().profiles.default
    expect(profile.credentials).toBeUndefined()
    expect(profile.url).toBe(fake.url)
    expect(await cli(configPath).run('whoami')).toBe(EXIT.unauthenticated)
  })

  it('logout still clears credentials when the server is unreachable', async () => {
    const configPath = await loggedIn()
    await fake.close()
    const c = cli(configPath)
    expect(await c.run('logout')).toBe(0)
    expect(c.stderr()).toContain('could not be reached')
    expect(new ConfigStore(configPath).read().profiles.default.credentials).toBeUndefined()
    fake = await startFakeServer() // for afterEach
  })
})

describe('ConfigStore.withLock', () => {
  it('serialises holders and removes the lock file', async () => {
    const store = new ConfigStore(tempConfigPath())
    const order: string[] = []
    let entered!: () => void
    const aInside = new Promise<void>((resolve) => { entered = resolve })
    const hold = (name: string, onEnter?: () => void) => store.withLock(async () => {
      order.push(`${name}:in`)
      onEnter?.()
      await new Promise((resolve) => setTimeout(resolve, 30))
      order.push(`${name}:out`)
    }, { pollMs: 5 })
    // Start b only once a holds the lock: which of two simultaneous open('wx')
    // calls wins is up to the OS, so racing them made the order flaky.
    const a = hold('a', entered)
    await aInside
    const b = hold('b')
    await Promise.all([a, b])
    expect(order).toEqual(['a:in', 'a:out', 'b:in', 'b:out'])
    expect(existsSync(store.lockPath)).toBe(false)
  })

  it('releases the lock when the holder throws', async () => {
    const store = new ConfigStore(tempConfigPath())
    await expect(store.withLock(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(existsSync(store.lockPath)).toBe(false)
  })

  it('breaks a stale lock but waits for (and then times out on) a live one', async () => {
    const store = new ConfigStore(tempConfigPath())
    mkdirSync(dirname(store.path), { recursive: true })
    writeFileSync(store.lockPath, '999999 crashed\n')
    const old = new Date(Date.now() - 120_000)
    utimesSync(store.lockPath, old, old)
    expect(await store.withLock(async () => 'ran')).toBe('ran')

    writeFileSync(store.lockPath, '1 live\n')
    await expect(store.withLock(async () => 'never', { timeoutMs: 100, pollMs: 10 })).rejects.toThrow(/Timed out waiting/)
    expect(existsSync(store.lockPath)).toBe(true) // someone else's lock is left alone
  })
})
