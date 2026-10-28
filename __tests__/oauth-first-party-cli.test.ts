import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Mocks for the route tests (service client + cookie session) ───

type Row = Record<string, unknown>

const { serviceState, sessionUser } = vi.hoisted(() => ({
  serviceState: {
    client: null as Row | null,
    inserts: [] as { table: string; row: Row }[],
    users: [{ id: 'user-1', tenant_id: 'tenant-home', current_tenant_id: 'tenant-current' }] as Row[],
  },
  sessionUser: { current: { id: 'user-1' } as { id: string } | null },
}))

function chain(table: string) {
  const filters: Record<string, unknown> = {}
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => { filters[column] = value; return builder },
    is: () => builder,
    gt: () => builder,
    limit: () => builder,
    maybeSingle: async () => {
      if (table === 'oauth_clients') {
        const client = serviceState.client
        return { data: client && client.client_id === filters.client_id ? client : null, error: null }
      }
      if (table === 'users') return { data: serviceState.users.find((u) => u.id === filters.id) ?? null, error: null }
      return { data: null, error: null }
    },
    insert: async (row: Row) => { serviceState.inserts.push({ table, row }); return { error: null } },
    then: (resolve: (value: unknown) => void) => resolve({ count: 0, data: [], error: null }),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => chain(table) }),
}))
vi.mock('@/lib/supabase/server', () => ({
  getCachedUser: async () => sessionUser.current,
}))

import { isAllowedRedirect, isRegistrableRedirectUri } from '@/lib/oauth/redirect'
import {
  FIRST_PARTY_ONLY_SCOPES,
  OAUTH_SCOPES,
  SCOPE_DESCRIPTIONS,
  expandScopes,
  parseScopeParam,
  requestsFirstPartyScope,
  withoutFirstPartyScopes,
} from '@/lib/oauth/scopes'
import { USERTASKS_CLI_CLIENT_ID, USERTASKS_CLI_SCOPES } from '@/lib/oauth/first-party'
import { resolveConsentTenant } from '@/lib/oauth/provider'
import { PERMISSION_KEYS } from '@/lib/permissions'
import { GET as authorize } from '@/app/api/oauth/authorize/route'
import { POST as register } from '@/app/api/oauth/register/route'

// ─── Redirect matching (RFC 8252 loopback) ───

describe('isAllowedRedirect loopback matching', () => {
  const registered = ['http://127.0.0.1/callback', 'http://[::1]/callback', 'http://localhost/cb?app=cli', 'https://app.example.com/cb']

  it.each([
    'http://127.0.0.1/callback',
    'http://127.0.0.1:49152/callback',
    'http://127.0.0.1:1/callback',
    'http://[::1]:8080/callback',
    'http://localhost:5000/cb?app=cli',
    'https://app.example.com/cb',
  ])('allows %s', (candidate) => {
    expect(isAllowedRedirect(registered, candidate)).toBe(true)
  })

  it.each([
    ['localhost is not 127.0.0.1', 'http://localhost:5000/callback'],
    ['127.0.0.1 is not localhost', 'http://127.0.0.1:5000/cb?app=cli'],
    ['[::1] is not 127.0.0.1', 'http://[::1]:5000/cb?app=cli'],
    ['https loopback is not relaxed', 'https://127.0.0.1:5000/callback'],
    ['https non-loopback port is not relaxed', 'https://app.example.com:8443/cb'],
    ['different path', 'http://127.0.0.1:5000/callback/extra'],
    ['path prefix', 'http://127.0.0.1:5000/call'],
    ['trailing slash', 'http://127.0.0.1:5000/callback/'],
    ['added query', 'http://127.0.0.1:5000/callback?x=1'],
    ['different query', 'http://localhost:5000/cb?app=evil'],
    ['missing query', 'http://localhost:5000/cb'],
    ['fragment', 'http://127.0.0.1:5000/callback#x'],
    ['userinfo', 'http://evil@127.0.0.1:5000/callback'],
    ['non-canonical IPv4', 'http://0x7f.0.0.1:5000/callback'],
    ['short IPv4', 'http://127.1:5000/callback'],
    ['other loopback address', 'http://127.0.0.2:5000/callback'],
    ['dot segments', 'http://127.0.0.1:5000/x/../callback'],
    ['upper-case host', 'http://LOCALHOST:5000/cb?app=cli'],
    ['subdomain of localhost', 'http://evil.localhost:5000/cb?app=cli'],
    ['localhost-looking host', 'http://127.0.0.1.evil.com:5000/callback'],
    ['non-http scheme', 'ftp://127.0.0.1:5000/callback'],
    ['not a URL', 'not a url'],
    ['empty', ''],
  ])('denies: %s', (_label, candidate) => {
    expect(isAllowedRedirect(registered, candidate)).toBe(false)
  })

  it('never relaxes a client that registered no loopback URI', () => {
    expect(isAllowedRedirect(['https://app.example.com/cb'], 'http://127.0.0.1:5000/cb')).toBe(false)
    expect(isAllowedRedirect(['https://127.0.0.1/callback'], 'https://127.0.0.1:5000/callback')).toBe(false)
  })

  it('a registered port does not pin the loopback port, but path still must match', () => {
    expect(isAllowedRedirect(['http://127.0.0.1:3000/callback'], 'http://127.0.0.1:4000/callback')).toBe(true)
    expect(isAllowedRedirect(['http://127.0.0.1:3000/callback'], 'http://127.0.0.1:4000/other')).toBe(false)
  })

  it('registration accepts loopback http and https only', () => {
    expect(isRegistrableRedirectUri('http://[::1]/callback')).toBe(true)
    expect(isRegistrableRedirectUri('http://127.0.0.1/callback')).toBe(true)
    expect(isRegistrableRedirectUri('http://example.com/callback')).toBe(false)
  })
})

// ─── Scopes ───

describe('new OAuth scopes', () => {
  const permissionSet = new Set<string>(PERMISSION_KEYS)

  it('every scope expands only to real permission keys and has a description', () => {
    for (const scope of OAUTH_SCOPES) {
      for (const key of expandScopes([scope])) expect(permissionSet.has(key)).toBe(true)
      expect(SCOPE_DESCRIPTIONS[scope], scope).toBeTruthy()
    }
  })

  it.each([
    ['agents', 'agents.view', 'agents.delete'],
    ['integrations', 'integrations.view', 'integrations.manage_references'],
    ['extensibility', 'extensibility.view', 'extensibility.edit'],
    ['settings', 'settings.view', 'settings.edit'],
    ['team', 'team.view_members', 'team.change_roles'],
    ['sync', 'sync.view', 'sync.deploy'],
  ])('%s:read is read-only and %s:write adds writes', (family, readKey, writeKey) => {
    expect(expandScopes([`${family}:read`])).toEqual([readKey])
    const write = expandScopes([`${family}:write`])
    expect(write).toContain(readKey)
    expect(write).toContain(writeKey)
  })

  it('settings:write never grants API-key management', () => {
    expect(expandScopes(['settings:write'])).not.toContain('settings.manage_api_keys')
    expect(expandScopes(['settings:write'])).toContain('settings.manage_webhooks')
  })

  it('config:read covers config views only', () => {
    const perms = expandScopes(['config:read'])
    for (const key of ['workflows.view', 'data.view', 'integrations.view', 'extensibility.view', 'agents.view', 'reports.view', 'settings.view']) {
      expect(perms).toContain(key)
    }
    expect(perms.every((key) => /\.(view|view_runs)$/.test(key))).toBe(true)
  })

  it('config:write adds config writes but no tasks, team, sync, webhook or key permissions', () => {
    const perms = expandScopes(['config:write'])
    expect(perms).toEqual(expect.arrayContaining(['workflows.edit', 'data.edit_schema', 'integrations.create', 'extensibility.edit', 'agents.edit', 'settings.edit']))
    for (const key of ['settings.manage_api_keys', 'settings.manage_webhooks', 'team.change_roles', 'team.invite', 'sync.deploy', 'tasks.complete', 'tasks.view_all']) {
      expect(perms).not.toContain(key)
    }
  })

  it('keys:write maps to API-key management only and is first-party-only', () => {
    expect(expandScopes(['keys:write']).sort()).toEqual(['settings.manage_api_keys', 'settings.view'])
    expect(FIRST_PARTY_ONLY_SCOPES).toEqual(['keys:write'])
    expect(requestsFirstPartyScope(['tasks:read', 'keys:write'])).toBe(true)
    expect(requestsFirstPartyScope(['tasks:read'])).toBe(false)
    expect(withoutFirstPartyScopes(OAUTH_SCOPES)).not.toContain('keys:write')
  })

  it('no scope other than admin grants API-key management', () => {
    for (const scope of OAUTH_SCOPES.filter((s) => s !== 'admin' && s !== 'keys:write')) {
      expect(expandScopes([scope]), scope).not.toContain('settings.manage_api_keys')
    }
  })

  it('events:read grants observability.view only and has no write form', () => {
    expect(expandScopes(['events:read'])).toEqual(['observability.view'])
    expect(expandScopes(['events:write'])).toEqual([])
    expect(OAUTH_SCOPES).toContain('events:read')
    expect(USERTASKS_CLI_SCOPES).toContain('events:read')
    expect(withoutFirstPartyScopes(OAUTH_SCOPES)).toContain('events:read')
  })

  it('malformed scope strings expand to nothing', () => {
    expect(expandScopes(['agents:delete', 'config:admin', 'keys:read', 'config', 'agents'])).toEqual([])
    expect(parseScopeParam('keys:read config:admin config:read')).toEqual(['config:read'])
  })
})

// ─── First-party client seed (migration) ───

describe('first-party CLI client migration', () => {
  const sql = readFileSync(path.resolve(__dirname, '../supabase/migrations/20261023000000_oauth_first_party_cli.sql'), 'utf8')

  it('relaxes the tenant-bound CHECK only for dynamic or first-party clients', () => {
    expect(sql).toMatch(/CHECK \(is_dynamic OR is_first_party OR tenant_id IS NOT NULL\)/)
    expect(sql).toMatch(/is_first_party boolean NOT NULL DEFAULT false/)
  })

  it('seeds a public, secret-less client with loopback /callback URIs', () => {
    expect(sql).toContain(`'${USERTASKS_CLI_CLIENT_ID}'`)
    expect(sql).toMatch(/'public'/)
    expect(sql).toMatch(/ARRAY\['authorization_code', 'refresh_token'\]/)
    expect(sql).toMatch(/ARRAY\['http:\/\/127\.0\.0\.1\/callback', 'http:\/\/\[::1\]\/callback'\]/)
  })

  it('seeds exactly the non-admin, non-mcp scopes', () => {
    const block = sql.slice(sql.indexOf('-- Every scope'), sql.indexOf('],', sql.indexOf('-- Every scope')))
    const seeded = [...block.matchAll(/'([a-z]+:[a-z]+)'/g)].map((m) => m[1])
    // Later migrations append scopes added since (array_append on usertasks-cli).
    for (const file of ['20261024000001_observability_permission.sql', '20261103400000_packages.sql']) {
      const appended = readFileSync(path.resolve(__dirname, `../supabase/migrations/${file}`), 'utf8')
      seeded.push(...[...appended.matchAll(/array_append\(allowed_scopes, '([a-z]+:[a-z]+)'\)/g)].map((m) => m[1]))
    }
    expect(seeded.sort()).toEqual([...USERTASKS_CLI_SCOPES].sort())
    expect(seeded).not.toContain('admin')
    expect(seeded).not.toContain('mcp')
  })
})

// ─── /api/oauth/authorize ───

const CLI_CLIENT = {
  client_id: 'usertasks-cli', tenant_id: null, name: 'UserTasks CLI', client_type: 'public',
  grant_types: ['authorization_code', 'refresh_token'],
  redirect_uris: ['http://127.0.0.1/callback', 'http://[::1]/callback'],
  allowed_scopes: USERTASKS_CLI_SCOPES, is_dynamic: false, is_first_party: true, revoked_at: null,
}

function authorizeRequest(params: Record<string, string>) {
  const query = new URLSearchParams({
    response_type: 'code', client_id: 'usertasks-cli', redirect_uri: 'http://127.0.0.1:53111/callback',
    state: 'st', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256',
    scope: 'workflows:read keys:write', ...params,
  })
  return new NextRequest(`http://localhost:3000/api/oauth/authorize?${query}`)
}

function consentPayload() {
  return serviceState.inserts.find((entry) => entry.table === 'oauth_connect_states')?.row?.payload
}

function insertedClient(): Row {
  return serviceState.inserts.find((entry) => entry.table === 'oauth_clients')!.row
}

describe('/api/oauth/authorize', () => {
  beforeEach(() => {
    serviceState.inserts = []
    serviceState.client = { ...CLI_CLIENT }
    sessionUser.current = { id: 'user-1' }
  })

  it('first-party client: any loopback port + keys:write → consent bound to the user\'s current tenant', async () => {
    const response = await authorize(authorizeRequest({}))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toMatch(/\/oauth\/consent\?request=uost_/)
    expect(consentPayload()).toMatchObject({
      client_id: 'usertasks-cli',
      redirect_uri: 'http://127.0.0.1:53111/callback',
      scopes: ['workflows:read', 'keys:write'],
      tenant_id: 'tenant-current',
      client_first_party: true,
      client_dynamic: false,
    })
  })

  it('rejects a non-loopback or https redirect with an error page (no redirect)', async () => {
    for (const redirect of ['https://127.0.0.1:53111/callback', 'http://localhost:53111/callback', 'http://127.0.0.1:53111/other']) {
      const response = await authorize(authorizeRequest({ redirect_uri: redirect }))
      expect(response.status).toBe(400)
      expect(response.headers.get('location')).toBeNull()
    }
  })

  it('dynamic client: keys:write is refused even if its allowed_scopes lists it', async () => {
    serviceState.client = { ...CLI_CLIENT, client_id: 'uocid_dyn', is_dynamic: true, is_first_party: false }
    const response = await authorize(authorizeRequest({ client_id: 'uocid_dyn' }))
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('http://127.0.0.1:53111/callback')
    expect(location.searchParams.get('error')).toBe('invalid_scope')
    expect(location.searchParams.get('state')).toBe('st')
    expect(consentPayload()).toBeUndefined()
  })

  it('a row flagged both dynamic and first-party is not treated as first-party', async () => {
    serviceState.client = { ...CLI_CLIENT, is_dynamic: true, is_first_party: true }
    const response = await authorize(authorizeRequest({}))
    expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe('invalid_scope')
  })

  it('tenant-bound workspace client: keys:write refused', async () => {
    serviceState.client = { ...CLI_CLIENT, client_id: 'uocid_ws', tenant_id: 'tenant-current', is_first_party: false }
    const response = await authorize(authorizeRequest({ client_id: 'uocid_ws' }))
    expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe('invalid_scope')
  })

  it('dynamic client without keys:write proceeds and is labelled unverified', async () => {
    serviceState.client = { ...CLI_CLIENT, client_id: 'uocid_dyn', is_dynamic: true, is_first_party: false, allowed_scopes: ['workflows:read'] }
    const response = await authorize(authorizeRequest({ client_id: 'uocid_dyn', scope: 'workflows:read' }))
    expect(response.headers.get('location')).toMatch(/\/oauth\/consent\?request=/)
    expect(consentPayload()).toMatchObject({ client_first_party: false, client_dynamic: true })
  })

  it('first-party client can still never get admin', async () => {
    serviceState.client = { ...CLI_CLIENT, allowed_scopes: [...USERTASKS_CLI_SCOPES, 'admin'] }
    const response = await authorize(authorizeRequest({ scope: 'admin' }))
    expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe('invalid_scope')
  })

  it('a database without is_first_party behaves as before (no first-party clients)', async () => {
    serviceState.client = Object.fromEntries(Object.entries(CLI_CLIENT).filter(([key]) => key !== 'is_first_party'))
    const response = await authorize(authorizeRequest({}))
    expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe('invalid_scope')
  })
})

// ─── /api/oauth/register ───

describe('/api/oauth/register (DCR)', () => {
  beforeEach(() => { serviceState.inserts = [] })

  const registerRequest = (body: Record<string, unknown>) => new NextRequest('http://localhost:3000/api/oauth/register', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })

  it('rejects an explicit keys:write request', async () => {
    const response = await register(registerRequest({ redirect_uris: ['http://127.0.0.1/callback'], scope: 'tasks:read keys:write' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_client_metadata')
    expect(serviceState.inserts).toHaveLength(0)
  })

  it('default scopes exclude keys:write and admin; the client is dynamic, never first-party', async () => {
    const response = await register(registerRequest({ redirect_uris: ['http://127.0.0.1/callback'] }))
    expect(response.status).toBe(201)
    const row = insertedClient()
    expect(row.allowed_scopes).not.toContain('keys:write')
    expect(row.allowed_scopes).not.toContain('admin')
    expect(row.allowed_scopes).toContain('config:read')
    expect(row.is_dynamic).toBe(true)
    expect(row.is_first_party).toBeUndefined()
    expect(row.tenant_id).toBeNull()
  })
})

// ─── Consent tenant binding ───

describe('resolveConsentTenant for the first-party client', () => {
  const supabase = { from: (table: string) => chain(table) } as unknown as Parameters<typeof resolveConsentTenant>[0]

  it('binds to the user\'s current workspace', async () => {
    expect(await resolveConsentTenant(supabase, { tenant_id: null, is_dynamic: false }, 'user-1')).toBe('tenant-current')
  })

  it('falls back to the home tenant and refuses unknown users', async () => {
    serviceState.users = [{ id: 'user-2', tenant_id: 'tenant-home', current_tenant_id: null }]
    expect(await resolveConsentTenant(supabase, { tenant_id: null, is_dynamic: false }, 'user-2')).toBe('tenant-home')
    expect(await resolveConsentTenant(supabase, { tenant_id: null, is_dynamic: false }, 'nobody')).toBeNull()
    serviceState.users = [{ id: 'user-1', tenant_id: 'tenant-home', current_tenant_id: 'tenant-current' }]
  })
})
