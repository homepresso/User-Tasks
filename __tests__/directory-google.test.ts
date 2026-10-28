import { describe, expect, it, vi } from 'vitest'
import { createGoogleDirectoryClient, GOOGLE_DIRECTORY_SCOPES, parseServiceAccountJson } from '@/lib/directory-sync/google'
import { DirectoryApiError } from '@/lib/directory-sync/types'

/**
 * Google Workspace directory client (Admin SDK Directory API): paging,
 * mapping (suspended / archived users are inactive), derived (nested) group
 * membership, domain vs customer scoping, retries and error surfacing. The
 * service-account JWT exchange is replaced by getAccessToken.
 */

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

const SETTINGS = { admin_email: 'admin@example.com' }

describe('Google Workspace directory client', () => {
  it('lists users across pages and maps status', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url))
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
      const u = new URL(String(url))
      if (!u.searchParams.get('pageToken')) {
        return json({ users: [{ id: '1', primaryEmail: 'Ada@Example.com', name: { fullName: 'Ada Lovelace' } }], nextPageToken: 'p2' })
      }
      return json({ users: [
        { id: '2', primaryEmail: 'bob@example.com', name: { givenName: 'Bob', familyName: 'Smith' }, suspended: true },
        { id: '3', primaryEmail: 'cy@example.com', archived: true },
      ] })
    })
    const client = createGoogleDirectoryClient({ settings: SETTINGS, serviceAccountJson: '', getAccessToken: async () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch })
    const users = await client.listUsers()
    expect(users).toEqual([
      { externalId: '1', displayName: 'Ada Lovelace', email: 'ada@example.com', active: true },
      { externalId: '2', displayName: 'Bob Smith', email: 'bob@example.com', active: false },
      { externalId: '3', displayName: 'cy@example.com', email: 'cy@example.com', active: false },
    ])
    const first = new URL(urls[0])
    expect(first.pathname).toBe('/admin/directory/v1/users')
    expect(first.searchParams.get('customer')).toBe('my_customer')
    expect(first.searchParams.get('maxResults')).toBe('500')
    expect(new URL(urls[1]).searchParams.get('pageToken')).toBe('p2')
  })

  it('scopes to a domain and a users query when configured', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => { urls.push(String(url)); return json({ users: [] }) })
    const client = createGoogleDirectoryClient({ settings: { ...SETTINGS, domain: 'eng.example.com', user_query: 'orgUnitPath=/Eng' }, serviceAccountJson: '', getAccessToken: async () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch })
    await client.listUsers()
    const u = new URL(urls[0])
    expect(u.searchParams.get('domain')).toBe('eng.example.com')
    expect(u.searchParams.get('customer')).toBeNull()
    expect(u.searchParams.get('query')).toBe('orgUnitPath=/Eng')
  })

  it('reads groups and derived membership, keeping active USER members only', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url))
      const u = new URL(String(url))
      if (u.pathname.endsWith('/groups')) return json({ groups: [{ id: 'g1', name: 'Engineering', email: 'eng@example.com', description: 'Eng' }, { id: 'g2', email: 'noname@example.com' }] })
      return json({ members: [
        { id: '1', type: 'USER', status: 'ACTIVE' },
        { id: 'g9', type: 'GROUP' },
        { id: '2', type: 'USER', status: 'SUSPENDED' },
        { id: '1', type: 'USER', status: 'ACTIVE' },
        { id: 'c1', type: 'CUSTOMER' },
      ] })
    })
    const client = createGoogleDirectoryClient({ settings: SETTINGS, serviceAccountJson: '', getAccessToken: async () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await client.listGroups()).toEqual([
      { externalId: 'g1', displayName: 'Engineering', description: 'Eng' },
      { externalId: 'g2', displayName: 'noname@example.com', description: null },
    ])
    expect(await client.listGroupMemberIds('g1')).toEqual(['1'])
    const members = new URL(urls[1])
    expect(members.pathname).toBe('/admin/directory/v1/groups/g1/members')
    expect(members.searchParams.get('includeDerivedMembership')).toBe('true')
  })

  it('retries 429s and surfaces API errors with the status', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      if (calls === 1) return json({}, 429, { 'retry-after': '0' })
      return json({ error: { message: 'Not Authorized to access this resource/api' } }, 403)
    })
    const client = createGoogleDirectoryClient({ settings: SETTINGS, serviceAccountJson: '', getAccessToken: async () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch })
    const error = await client.listUsers().catch((e) => e)
    expect(error).toBeInstanceOf(DirectoryApiError)
    expect(error.status).toBe(403)
    expect(error.message).toContain('Not Authorized')
    expect(calls).toBe(2)
  })

  it('verify probes users and falls back when the customer record is not readable', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => (String(url).includes('/customers/') ? json({ error: { message: 'no' } }, 403) : json({ users: [] })))
    const client = createGoogleDirectoryClient({ settings: SETTINGS, serviceAccountJson: '', getAccessToken: async () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await client.verify()).toEqual({ orgName: 'example.com' })
  })

  it('validates settings and service-account keys', () => {
    expect(() => createGoogleDirectoryClient({ settings: {}, serviceAccountJson: '' })).toThrow()
    expect(() => parseServiceAccountJson('not json')).toThrow(/not valid JSON/)
    expect(() => parseServiceAccountJson('{"type":"service_account"}')).toThrow(/client_email and private_key/)
    expect(parseServiceAccountJson('{"client_email":"sa@p.iam.gserviceaccount.com","private_key":"k"}').client_email).toBe('sa@p.iam.gserviceaccount.com')
    expect(GOOGLE_DIRECTORY_SCOPES.every((s) => s.endsWith('.readonly'))).toBe(true)
  })
})
