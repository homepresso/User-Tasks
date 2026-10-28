import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEntraClient } from '@/lib/directory-sync/entra'
import { createOktaClient, parseNextLink } from '@/lib/directory-sync/okta'
import { DirectoryApiError } from '@/lib/directory-sync/types'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  }
}

const TOKEN_RESPONSE = { access_token: 'graph-token', expires_in: 3600 }

describe('createEntraClient', () => {
  it('requests a client-credentials token, caches it, and follows @odata.nextLink', async () => {
    const calls: Array<{ url: string; body?: string }> = []
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      calls.push({ url, body: init?.body })
      if (url.includes('login.microsoftonline.com')) return jsonResponse(TOKEN_RESPONSE)
      if (url.includes('/v1.0/users') && !url.includes('skiptoken')) {
        return jsonResponse({
          value: [{ id: 'u1', displayName: 'Ada', mail: 'ada@acme.com', accountEnabled: true }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=abc',
        })
      }
      if (url.includes('skiptoken')) {
        return jsonResponse({
          value: [{ id: 'u2', displayName: 'Bob', mail: 'bob@acme.com', accountEnabled: true }],
        })
      }
      if (url.includes('/v1.0/organization')) {
        return jsonResponse({ value: [{ displayName: 'Acme Corp' }] })
      }
      throw new Error(`unexpected ${url}`)
    })

    const client = createEntraClient({ tenantId: 'tid', clientId: 'cid', clientSecret: 'sec' })
    const users = await client.listUsers()
    const org = await client.verify()

    expect(users.map((u) => u.externalId)).toEqual(['u1', 'u2'])
    expect(org.orgName).toBe('Acme Corp')

    // Token endpoint hit exactly once (cached across the three API calls).
    const tokenCalls = calls.filter((c) => c.url.includes('login.microsoftonline.com'))
    expect(tokenCalls).toHaveLength(1)
    const tokenBody = new URLSearchParams(tokenCalls[0].body)
    expect(tokenBody.get('grant_type')).toBe('client_credentials')
    expect(tokenBody.get('scope')).toBe('https://graph.microsoft.com/.default')
    expect(tokenBody.get('client_id')).toBe('cid')
  })

  it('maps email as mail ?? userPrincipalName (only when UPN looks like an email)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('login.microsoftonline.com')) return jsonResponse(TOKEN_RESPONSE)
      return jsonResponse({
        value: [
          { id: 'u1', displayName: 'Has Mail', mail: 'Mail@Acme.com', userPrincipalName: 'upn@acme.com', accountEnabled: true },
          { id: 'u2', displayName: 'UPN Only', mail: null, userPrincipalName: 'upn.only@acme.com', accountEnabled: true },
          { id: 'u3', displayName: 'Guest', mail: null, userPrincipalName: 'guest#EXT#acme.onmicrosoft.com', accountEnabled: false },
          // Guest UPN that DOES look like an email — must still be rejected via #EXT#.
          { id: 'u4', displayName: 'Ext Guest', mail: null, userPrincipalName: 'jane_gmail.com#EXT#@org.onmicrosoft.com', accountEnabled: true },
        ],
      })
    })

    const client = createEntraClient({ tenantId: 't', clientId: 'c', clientSecret: 's' })
    const users = await client.listUsers()

    expect(users[0].email).toBe('mail@acme.com') // mail wins, lowercased
    expect(users[1].email).toBe('upn.only@acme.com') // falls back to UPN
    expect(users[2].email).toBeNull() // UPN that is not an email
    expect(users[2].active).toBe(false)
    expect(users[3].email).toBeNull() // #EXT# guest UPN is unroutable — never used
  })

  it('verify() probes /users (User.Read.All) and tolerates 403 on /organization', async () => {
    const graphUrls: string[] = []
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('login.microsoftonline.com')) return jsonResponse(TOKEN_RESPONSE)
      graphUrls.push(url)
      if (url.includes('/v1.0/users')) return jsonResponse({ value: [{ id: 'u1' }] })
      if (url.includes('/v1.0/organization')) {
        return jsonResponse({ error: { code: 'Authorization_RequestDenied', message: 'Insufficient privileges' } }, 403)
      }
      throw new Error(`unexpected ${url}`)
    })

    const client = createEntraClient({ tenantId: 't', clientId: 'c', clientSecret: 's' })
    // Org name is best-effort: 403 (no Organization.Read.All) → null, no throw.
    expect(await client.verify()).toEqual({ orgName: null })
    expect(graphUrls[0]).toContain('/v1.0/users?$top=1')
    expect(graphUrls[1]).toContain('/v1.0/organization')
  })

  it('verify() returns the org display name when /organization is permitted', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('login.microsoftonline.com')) return jsonResponse(TOKEN_RESPONSE)
      if (url.includes('/v1.0/users')) return jsonResponse({ value: [{ id: 'u1' }] })
      return jsonResponse({ value: [{ displayName: 'Acme Corp' }] })
    })
    const client = createEntraClient({ tenantId: 't', clientId: 'c', clientSecret: 's' })
    expect(await client.verify()).toEqual({ orgName: 'Acme Corp' })
  })

  it('retries throttled Graph requests, honoring Retry-After', async () => {
    let usersCalls = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('login.microsoftonline.com')) return jsonResponse(TOKEN_RESPONSE)
      usersCalls++
      if (usersCalls === 1) return jsonResponse({ error: { message: 'throttled' } }, 429, { 'retry-after': '0' })
      return jsonResponse({ value: [{ id: 'u1', displayName: 'Ada', mail: 'ada@acme.com', accountEnabled: true }] })
    })

    const client = createEntraClient({ tenantId: 't', clientId: 'c', clientSecret: 's' })
    const users = await client.listUsers()
    expect(users).toHaveLength(1)
    expect(usersCalls).toBe(2) // 429 then success
  })

  it('gives up after 3 retries on persistent 429s', async () => {
    let usersCalls = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('login.microsoftonline.com')) return jsonResponse(TOKEN_RESPONSE)
      usersCalls++
      return jsonResponse({ error: { message: 'throttled' } }, 429, { 'retry-after': '0' })
    })

    const client = createEntraClient({ tenantId: 't', clientId: 'c', clientSecret: 's' })
    await expect(client.listUsers()).rejects.toMatchObject({ status: 429 })
    expect(usersCalls).toBe(4) // initial + 3 retries
  })

  it('keeps only user members from group member listings', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('login.microsoftonline.com')) return jsonResponse(TOKEN_RESPONSE)
      return jsonResponse({
        value: [
          { id: 'u1', '@odata.type': '#microsoft.graph.user' },
          { id: 'g1', '@odata.type': '#microsoft.graph.group' },
          { id: 'd1', '@odata.type': '#microsoft.graph.device' },
          { id: 'u2' }, // untyped entries with an id are kept
        ],
      })
    })

    const client = createEntraClient({ tenantId: 't', clientId: 'c', clientSecret: 's' })
    expect(await client.listGroupMemberIds('grp')).toEqual(['u1', 'u2'])
  })

  it('surfaces token failures as DirectoryApiError with status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_client', error_description: 'AADSTS7000215' }, 401))
    const client = createEntraClient({ tenantId: 't', clientId: 'c', clientSecret: 'bad' })
    await expect(client.verify()).rejects.toMatchObject({ status: 401 })
    await expect(client.verify()).rejects.toBeInstanceOf(DirectoryApiError)
  })
})

describe('createOktaClient', () => {
  it('parses rel="next" Link headers', () => {
    expect(parseNextLink('<https://acme.okta.com/api/v1/users?after=x&limit=200>; rel="next", <https://acme.okta.com/api/v1/users>; rel="self"')).toBe('https://acme.okta.com/api/v1/users?after=x&limit=200')
    expect(parseNextLink('<https://acme.okta.com/api/v1/users>; rel="self"')).toBeNull()
    expect(parseNextLink(null)).toBeNull()
  })

  it('pages users via the Link header and maps profile fields', async () => {
    const urls: string[] = []
    fetchMock.mockImplementation(async (url: string) => {
      urls.push(url)
      if (url.includes('after=cursor')) {
        return jsonResponse([
          { id: 'ok2', status: 'DEPROVISIONED', profile: { firstName: 'Carol', lastName: 'Jones', email: 'carol@acme.com' } },
        ])
      }
      return jsonResponse(
        [{ id: 'ok1', status: 'ACTIVE', profile: { displayName: 'Ada L', email: 'ada@acme.com' } }],
        200,
        { link: '<https://acme.okta.com/api/v1/users?after=cursor&limit=200>; rel="next"' },
      )
    })

    const client = createOktaClient({ orgUrl: 'https://acme.okta.com', apiToken: 'tok' })
    const users = await client.listUsers()

    expect(urls[0]).toBe('https://acme.okta.com/api/v1/users?limit=200')
    expect(urls[1]).toContain('after=cursor')
    expect(users).toHaveLength(2)
    expect(users[0]).toMatchObject({ externalId: 'ok1', displayName: 'Ada L', email: 'ada@acme.com', active: true })
    // No displayName → firstName + lastName; non-ACTIVE status → inactive.
    expect(users[1]).toMatchObject({ externalId: 'ok2', displayName: 'Carol Jones', active: false })
  })

  it('skips BUILT_IN groups and strips trailing slashes from the org URL', async () => {
    const urls: string[] = []
    fetchMock.mockImplementation(async (url: string) => {
      urls.push(url)
      return jsonResponse([
        { id: 'g1', type: 'OKTA_GROUP', profile: { name: 'Engineering', description: 'Eng team' } },
        { id: 'g2', type: 'BUILT_IN', profile: { name: 'Everyone' } },
        { id: 'g3', type: 'APP_GROUP', profile: { name: 'From AD' } },
      ])
    })

    const client = createOktaClient({ orgUrl: 'https://acme.okta.com/', apiToken: 'tok' })
    const groups = await client.listGroups()

    expect(urls[0]).toBe('https://acme.okta.com/api/v1/groups?limit=200')
    expect(groups.map((g) => g.externalId)).toEqual(['g1', 'g3'])
    expect(groups[0]).toMatchObject({ displayName: 'Engineering', description: 'Eng team' })
  })

  it('sends the SSWS authorization header and surfaces API errors', async () => {
    let sawAuth: string | null = null
    fetchMock.mockImplementation(async (_url: string, init?: any) => {
      sawAuth = init?.headers?.Authorization ?? null
      return jsonResponse({ errorSummary: 'Invalid token provided' }, 401)
    })

    const client = createOktaClient({ orgUrl: 'https://acme.okta.com', apiToken: 'sekret' })
    await expect(client.verify()).rejects.toMatchObject({ status: 401 })
    expect(sawAuth).toBe('SSWS sekret')
  })

  it('verify returns the Okta org companyName', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'org1', companyName: 'Acme Inc' }))
    const client = createOktaClient({ orgUrl: 'https://acme.okta.com', apiToken: 'tok' })
    expect(await client.verify()).toEqual({ orgName: 'Acme Inc' })
  })

  it('treats credential-limbo statuses as active, departed statuses as inactive', async () => {
    fetchMock.mockResolvedValue(jsonResponse([
      { id: 'a', status: 'ACTIVE', profile: { email: 'a@acme.com' } },
      { id: 'b', status: 'LOCKED_OUT', profile: { email: 'b@acme.com' } },
      { id: 'c', status: 'RECOVERY', profile: { email: 'c@acme.com' } },
      { id: 'd', status: 'PASSWORD_EXPIRED', profile: { email: 'd@acme.com' } },
      { id: 'e', status: 'SUSPENDED', profile: { email: 'e@acme.com' } },
      { id: 'f', status: 'DEPROVISIONED', profile: { email: 'f@acme.com' } },
      { id: 'g', status: 'STAGED', profile: { email: 'g@acme.com' } },
    ]))

    const client = createOktaClient({ orgUrl: 'https://acme.okta.com', apiToken: 'tok' })
    const users = await client.listUsers()
    expect(users.map((u) => u.active)).toEqual([true, true, true, true, false, false, false])
  })

  it('retries throttled Okta requests using X-Rate-Limit-Reset', async () => {
    let calls = 0
    fetchMock.mockImplementation(async () => {
      calls++
      if (calls === 1) {
        // Reset already in the past → immediate retry.
        return jsonResponse({ errorSummary: 'rate limit' }, 429, {
          'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) - 1),
        })
      }
      return jsonResponse({ id: 'org1', companyName: 'Acme Inc' })
    })

    const client = createOktaClient({ orgUrl: 'https://acme.okta.com', apiToken: 'tok' })
    expect(await client.verify()).toEqual({ orgName: 'Acme Inc' })
    expect(calls).toBe(2)
  })
})
