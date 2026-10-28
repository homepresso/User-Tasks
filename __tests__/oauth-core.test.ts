import { describe, it, expect } from 'vitest'
import { expandScopes, parseScopeParam, scopesAllowed, OAUTH_SCOPES } from '@/lib/oauth/scopes'
import { verifyPkce, computeS256Challenge } from '@/lib/oauth/pkce'
import { isAllowedRedirect, isRegistrableRedirectUri } from '@/lib/oauth/redirect'
import { generateOAuthToken, hashOAuthToken, displayPrefix } from '@/lib/oauth/tokens'
import { sanitizeRedirect } from '@/lib/safe-redirect'
import { randomBytes } from 'crypto'

describe('oauth scopes', () => {
  it('expands read/write families to permission keys', () => {
    const perms = expandScopes(['tasks:read'])
    expect(perms).toContain('tasks.view_all')
    expect(perms).not.toContain('tasks.delete')
    const write = expandScopes(['tasks:write'])
    expect(write).toContain('tasks.view_all') // write includes read
    expect(write).toContain('tasks.delete')
  })
  it('workflows:run aliases workflows:write', () => {
    expect(expandScopes(['workflows:run'])).toContain('workflows.activate')
  })
  it('admin expands to the full permission set', () => {
    expect(expandScopes(['admin']).length).toBeGreaterThan(20)
  })
  it('mcp is a marker granting no permissions', () => {
    expect(expandScopes(['mcp'])).toEqual([])
  })
  it('unknown scopes are dropped', () => {
    expect(expandScopes(['bogus:scope'])).toEqual([])
    expect(parseScopeParam('tasks:read bogus mcp')).toEqual(['tasks:read', 'mcp'])
  })
  it('scopesAllowed enforces the client ceiling', () => {
    expect(scopesAllowed(['tasks:read'], ['tasks:read', 'mcp'])).toBe(true)
    expect(scopesAllowed(['admin'], ['tasks:read'])).toBe(false)
  })
  it('every catalog scope has a description-safe expansion', () => {
    for (const scope of OAUTH_SCOPES) expect(() => expandScopes([scope])).not.toThrow()
  })
})

describe('pkce S256', () => {
  it('verifies a correct verifier/challenge pair', () => {
    const verifier = randomBytes(48).toString('base64url')
    const challenge = computeS256Challenge(verifier)
    expect(verifyPkce(verifier, challenge)).toBe(true)
  })
  it('rejects a wrong verifier', () => {
    const challenge = computeS256Challenge(randomBytes(48).toString('base64url'))
    expect(verifyPkce(randomBytes(48).toString('base64url'), challenge)).toBe(false)
  })
  it('rejects plain method and malformed verifiers', () => {
    const verifier = randomBytes(48).toString('base64url')
    expect(verifyPkce(verifier, computeS256Challenge(verifier), 'plain')).toBe(false)
    expect(verifyPkce('short', 'x')).toBe(false)
  })
})

describe('redirect handling', () => {
  it('exact-match allowlist only', () => {
    const reg = ['https://app.example.com/cb']
    expect(isAllowedRedirect(reg, 'https://app.example.com/cb')).toBe(true)
    expect(isAllowedRedirect(reg, 'https://app.example.com/cb/extra')).toBe(false)
    expect(isAllowedRedirect(reg, 'https://app.example.com/cb?x=1')).toBe(false)
    expect(isAllowedRedirect(reg, 'https://evil.com/cb')).toBe(false)
  })
  it('registrable URIs require https or loopback', () => {
    expect(isRegistrableRedirectUri('https://x.com/cb')).toBe(true)
    expect(isRegistrableRedirectUri('http://localhost:3000/cb')).toBe(true)
    expect(isRegistrableRedirectUri('http://evil.com/cb')).toBe(false)
    expect(isRegistrableRedirectUri('https://x.com/cb#frag')).toBe(false)
    expect(isRegistrableRedirectUri('not a url')).toBe(false)
  })
})

describe('sanitizeRedirect (open-redirect guard)', () => {
  it('permits same-origin paths', () => {
    expect(sanitizeRedirect('/tasks/queue')).toBe('/tasks/queue')
  })
  it('rejects absolute, protocol-relative, and backslash tricks', () => {
    expect(sanitizeRedirect('https://evil.com')).toBe('/tasks')
    expect(sanitizeRedirect('//evil.com')).toBe('/tasks')
    expect(sanitizeRedirect('/\\evil.com')).toBe('/tasks')
    expect(sanitizeRedirect('/path\r\nSet-Cookie: x')).toBe('/tasks')
    expect(sanitizeRedirect('')).toBe('/tasks')
    expect(sanitizeRedirect(null)).toBe('/tasks')
  })
})

describe('token hashing', () => {
  it('generates prefixed tokens and stable sha256 hashes', () => {
    const t = generateOAuthToken('uoa_')
    expect(t.startsWith('uoa_')).toBe(true)
    expect(hashOAuthToken(t)).toBe(hashOAuthToken(t))
    expect(hashOAuthToken(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashOAuthToken(t)).not.toBe(hashOAuthToken(generateOAuthToken('uoa_')))
    expect(displayPrefix(t)).toHaveLength(12)
  })
})
