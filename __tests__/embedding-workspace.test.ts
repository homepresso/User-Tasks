import { describe, expect, it } from 'vitest'
import { embedFrameAncestors, framedSessionsEnabled, sessionCookiesAllowed, workspaceEmbeddingEnabled } from '@/lib/embedding'
import { mintEmbedToken, verifyEmbedToken, embedTokenKey } from '@/lib/embedding-token'

const KEY = Buffer.alloc(32, 5)
const ORIGINS = ['http://spsites', 'https://*.contoso.com']

describe('per-workspace trusted embedding tokens', () => {
  it('round-trips the workspace origins on that workspace only', () => {
    const token = mintEmbedToken({ workspace: 'acme', origins: ORIGINS }, KEY)!
    expect(verifyEmbedToken(token, 'acme', { key: KEY })).toEqual(ORIGINS)
    // A token minted by one workspace never opens another workspace's pages.
    expect(verifyEmbedToken(token, 'globex', { key: KEY })).toEqual([])
  })

  it('refuses forged, tampered and expired tokens', () => {
    const token = mintEmbedToken({ workspace: 'acme', origins: ORIGINS }, KEY)!
    expect(verifyEmbedToken(token, 'acme', { key: Buffer.alloc(32, 6) })).toEqual([])
    const [payload, mac] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ v: 1, w: 'acme', o: ['https://evil.example'], e: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
    expect(verifyEmbedToken(`${forged}.${mac}`, 'acme', { key: KEY })).toEqual([])
    expect(verifyEmbedToken(`${payload}.${mac}x`, 'acme', { key: KEY })).toEqual([])
    const old = mintEmbedToken({ workspace: 'acme', origins: ORIGINS, now: Date.now() - 2 * 3600_000 }, KEY)!
    expect(verifyEmbedToken(old, 'acme', { key: KEY })).toEqual([])
    expect(verifyEmbedToken(null, 'acme', { key: KEY })).toEqual([])
  })

  it('mints nothing without a key, a workspace or origins; drops invalid origins', () => {
    expect(mintEmbedToken({ workspace: 'acme', origins: ORIGINS }, null)).toBeNull()
    expect(mintEmbedToken({ workspace: '', origins: ORIGINS }, KEY)).toBeNull()
    expect(mintEmbedToken({ workspace: 'acme', origins: ['*', 'javascript:alert(1)'] }, KEY)).toBeNull()
  })

  it('derives its key from EMBED_SIGNING_SECRET or ENCRYPTION_KEY', () => {
    expect(embedTokenKey({})).toBeNull()
    expect(embedTokenKey({ ENCRYPTION_KEY: 'secret://vault/x' })).toBeNull()
    expect(embedTokenKey({ ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') })).toHaveLength(32)
    expect(embedTokenKey({ EMBED_SIGNING_SECRET: 'abc' })!.toString()).toBe('abc')
  })
})

describe('trusted embedding policy with per-workspace lists', () => {
  const none = { origins: [] as string[], source: 'none' as const, invalid: [] as string[] }

  it('frame-ancestors joins the instance list and the verified workspace origins', () => {
    expect(embedFrameAncestors(none, [])).toBe("'none'")
    expect(embedFrameAncestors(none, ['http://spsites'])).toBe("'self' http://spsites")
    expect(embedFrameAncestors({ ...none, origins: ['https://intranet'] }, ['https://intranet', 'http://spsites'])).toBe("'self' https://intranet http://spsites")
  })

  it('framed sessions (SameSite=None) follow the instance switch, only with Secure cookies', () => {
    expect(workspaceEmbeddingEnabled({ EMBED_WORKSPACE_ORIGINS: 'true' })).toBe(true)
    expect(framedSessionsEnabled(true, none, { EMBED_WORKSPACE_ORIGINS: 'true' })).toBe(true)
    expect(framedSessionsEnabled(false, none, { EMBED_WORKSPACE_ORIGINS: 'true' })).toBe(false)
    expect(framedSessionsEnabled(true, none, {})).toBe(false)
  })

  it('the cookie guard keeps SameSite=Lax semantics for every cross-site request', () => {
    const req = (method: string, pathname: string, h: Record<string, string>) => ({ method, pathname, get: (n: string) => h[n] ?? null })
    expect(sessionCookiesAllowed(req('POST', '/api/v1/tasks', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }))).toBe(false)
    expect(sessionCookiesAllowed(req('GET', '/settings', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }))).toBe(false)
    expect(sessionCookiesAllowed(req('GET', '/embed/x/sharepoint/launch', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }))).toBe(true)
    expect(sessionCookiesAllowed(req('GET', '/api/v1/me', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }))).toBe(false)
  })
})
