/**
 * Browser login (OAuth 2.1 authorization code + PKCE, RFC 8252 loopback
 * redirect) and the profile-backed token store used for refreshes.
 *
 * Flow: discovery → loopback listener on 127.0.0.1:<ephemeral>/callback →
 * PKCE S256 verifier + state → browser opens the authorize URL → the server
 * redirects back with ?code&state → state checked (constant time) → code
 * exchanged with the verifier → caller verifies the tokens (GET /me) → the
 * browser gets a result page. Gives up after five minutes.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  UsertasksOAuthError,
  buildAuthorizationUrl,
  codeChallengeS256,
  discoverAuthorizationServer,
  exchangeAuthorizationCode,
  generateCodeVerifier,
  generateState,
  registerClient,
  safeEqual,
  type AuthorizationServerMetadata,
  type OAuthTokenStore,
  type OAuthTokens,
} from '@usertasks/sdk'
import type { ConfigStore, OAuthCredentials, Profile } from './config'
import { CliAuthError } from './exit-codes'

export const LOGIN_TIMEOUT_MS = 5 * 60_000
const CALLBACK_PATH = '/callback'

/** Never requested unless asked for: `admin`/`mcp` are not CLI scopes, `keys:write` mints API keys. */
const OPT_IN_SCOPES = new Set(['admin', 'mcp', 'keys:write'])

/** Scopes to request: `--scopes` (comma/space separated) or everything the server offers minus opt-ins. */
export function chooseScopes(requested: string | undefined, meta: AuthorizationServerMetadata): string[] {
  if (requested && requested.trim()) return [...new Set(requested.split(/[\s,]+/).filter(Boolean))]
  const offered = Array.isArray(meta.scopes_supported) ? meta.scopes_supported : []
  return offered.filter((scope) => !OPT_IN_SCOPES.has(scope))
}

// ─── Token store over a profile ───

export function credentialsToTokens(credentials: OAuthCredentials): OAuthTokens {
  const expires = credentials.expires_at ? Date.parse(credentials.expires_at) : NaN
  return {
    access_token: credentials.access_token,
    ...(credentials.refresh_token ? { refresh_token: credentials.refresh_token } : {}),
    ...(Number.isFinite(expires) ? { expires_at: expires } : {}),
    ...(credentials.scope !== undefined ? { scope: credentials.scope } : {}),
  }
}

function tokenFields(tokens: OAuthTokens): Pick<OAuthCredentials, 'access_token' | 'refresh_token' | 'expires_at' | 'scope'> {
  return {
    access_token: tokens.access_token,
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    ...(tokens.expires_at !== undefined ? { expires_at: new Date(tokens.expires_at).toISOString() } : {}),
    ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
  }
}

/** OAuthTokenStore reading/writing one profile's credentials (always from disk) under the config lock. */
export function profileTokenStore(store: ConfigStore, profileName: string): OAuthTokenStore {
  const current = (): OAuthCredentials | undefined => {
    const credentials = store.read().profiles[profileName]?.credentials
    return credentials?.type === 'oauth' ? credentials : undefined
  }
  return {
    load: () => {
      const credentials = current()
      return credentials ? credentialsToTokens(credentials) : null
    },
    save: (tokens) => {
      store.update((config) => {
        const profile = config.profiles[profileName]
        // Logged out meanwhile: drop the refreshed tokens rather than resurrect the session.
        if (profile?.credentials?.type !== 'oauth') return
        profile.credentials = { ...profile.credentials, refresh_token: undefined, ...tokenFields(tokens) }
        profile.updated_at = new Date().toISOString()
      })
    },
    withLock: (fn) => store.withLock(fn),
  }
}

export function buildOAuthCredentials(clientId: string, meta: AuthorizationServerMetadata, tokens: OAuthTokens): OAuthCredentials {
  return {
    type: 'oauth',
    client_id: clientId,
    ...tokenFields(tokens),
    token_endpoint: meta.token_endpoint,
    ...(meta.revocation_endpoint ? { revocation_endpoint: meta.revocation_endpoint } : {}),
  }
}

// ─── Loopback listener ───

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve((server.address() as AddressInfo).port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

function page(title: string, message: string): string {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${escapeHtml(title)}</title></head>`
    + '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#0f172a">'
    + `<h1 style="font-size:1.25rem">${escapeHtml(title)}</h1><p style="color:#475569">${escapeHtml(message)}</p></body></html>`
}

function reply(res: ServerResponse, status: number, html: string): Promise<void> {
  return new Promise((resolve) => {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Referrer-Policy': 'no-referrer',
    })
    res.end(html, () => resolve())
  })
}

export interface BrowserLoginOptions<T> {
  serverUrl: string
  /** `--scopes` value. */
  scopes?: string
  /** A client registered dynamically by an earlier login against this server. */
  savedClient?: Profile['oauth_client']
  fetch?: typeof fetch
  /** Show the authorize URL to the user (always called). */
  showUrl: (url: string) => void
  /** Open the URL in a browser; omitted with --no-browser. */
  openBrowser?: (url: string) => Promise<void> | void
  /** Check the issued tokens (GET /me) before success is shown in the browser. */
  verify: (tokens: OAuthTokens, clientId: string, meta: AuthorizationServerMetadata) => Promise<T>
  timeoutMs?: number
}

export interface BrowserLoginResult<T> {
  meta: AuthorizationServerMetadata
  clientId: string
  tokens: OAuthTokens
  verified: T
  /** Set when the client was (re)registered dynamically and should be saved on the profile. */
  registeredClient?: { client_id: string; redirect_uri: string }
}

export async function browserLogin<T>(options: BrowserLoginOptions<T>): Promise<BrowserLoginResult<T>> {
  const meta = await discoverAuthorizationServer(options.serverUrl, { fetch: options.fetch })
  const scopes = chooseScopes(options.scopes, meta)
  if (scopes.length === 0) throw new CliAuthError('The server advertises no scopes; pass --scopes.')

  let clientId = meta.usertasks_cli_client_id
  let registeredClient: BrowserLoginResult<T>['registeredClient']

  const server = createServer()
  let port: number
  if (clientId) {
    port = await listen(server, 0)
  } else {
    // Older server without the first-party client (and possibly without
    // any-port loopback matching): reuse an earlier registration while its
    // exact port is free, else register a new public client for this port.
    const savedPort = options.savedClient ? Number(new URL(options.savedClient.redirect_uri).port) : 0
    port = 0
    if (savedPort) {
      try {
        port = await listen(server, savedPort)
        clientId = options.savedClient!.client_id
      } catch {
        port = 0
      }
    }
    if (!clientId) {
      port = await listen(server, 0)
      if (!meta.registration_endpoint) {
        server.close()
        throw new CliAuthError('The server offers neither a CLI client nor dynamic client registration; use `usertasks login --api-key`.')
      }
      const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`
      try {
        const registered = await registerClient({
          registrationEndpoint: meta.registration_endpoint,
          clientName: 'UserTasks CLI (unverified)',
          redirectUris: [redirectUri, `http://127.0.0.1${CALLBACK_PATH}`],
          scope: scopes.join(' '),
          fetch: options.fetch,
        })
        clientId = registered.client_id
        registeredClient = { client_id: registered.client_id, redirect_uri: redirectUri }
      } catch (error) {
        server.close()
        throw error
      }
    }
  }

  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`
  const verifier = generateCodeVerifier()
  const state = generateState()
  const authorizeUrl = buildAuthorizationUrl({
    authorizationEndpoint: meta.authorization_endpoint,
    clientId: clientId!,
    redirectUri,
    scope: scopes.join(' '),
    state,
    codeChallenge: codeChallengeS256(verifier),
  })

  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS
  try {
    const outcome = await new Promise<{ tokens: OAuthTokens; verified: T }>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        settled = true
        reject(new CliAuthError(`Timed out after ${Math.round(timeoutMs / 1000)} s waiting for the browser login.`))
      }, timeoutMs)

      server.on('request', (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
            await reply(res, 404, page('Not found', 'This address only receives the UserTasks login callback.'))
            return
          }
          if (settled) {
            await reply(res, 400, page('Login already finished', 'You can close this tab.'))
            return
          }
          // A callback without our state is not from this login (or forged):
          // ignore it and keep waiting for the real one.
          const returnedState = url.searchParams.get('state') ?? ''
          if (!safeEqual(returnedState, state)) {
            await reply(res, 400, page('Login failed', 'The response did not match this login attempt (state mismatch). Start again from the terminal.'))
            return
          }
          const error = url.searchParams.get('error')
          const code = url.searchParams.get('code')
          if (!error && !code) {
            await reply(res, 400, page('Login failed', 'The response had no authorization code.'))
            return
          }
          settled = true
          clearTimeout(timer)
          if (error) {
            const description = url.searchParams.get('error_description') ?? undefined
            await reply(res, 400, page('Login was not completed', description ?? error))
            reject(new UsertasksOAuthError(error, description))
            return
          }
          try {
            const tokens = await exchangeAuthorizationCode({
              tokenEndpoint: meta.token_endpoint,
              clientId: clientId!,
              code: code!,
              redirectUri,
              codeVerifier: verifier,
              fetch: options.fetch,
            })
            const verified = await options.verify(tokens, clientId!, meta)
            await reply(res, 200, page('Logged in to UserTasks', 'You can close this tab and return to the terminal.'))
            resolve({ tokens, verified })
          } catch (failure) {
            await reply(res, 500, page('Login failed', 'The terminal shows the details.'))
            reject(failure)
          }
        })()
      })

      options.showUrl(authorizeUrl)
      if (options.openBrowser) {
        Promise.resolve()
          .then(() => options.openBrowser!(authorizeUrl))
          .catch(() => { /* the URL was printed; the user can open it by hand */ })
      }
    })
    return { meta, clientId: clientId!, tokens: outcome.tokens, verified: outcome.verified, ...(registeredClient ? { registeredClient } : {}) }
  } finally {
    server.close()
    server.closeAllConnections()
  }
}
