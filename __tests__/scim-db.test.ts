/**
 * SCIM 2.0 endpoint end to end against the local stack's database: the
 * request shapes Microsoft Entra ID's SCIM validator and Okta's SCIM test
 * suite send (users, groups, filters, PATCH quirks, pagination), ETags,
 * reconciliation into local accounts / memberships / roles / teams, token
 * scopes, rotation and revocation, and workspace isolation — including every
 * denied case.
 *
 * Runs only against a LOCAL database — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/scim-db.test.ts
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { dataApiProvider, dbCapabilities } from './helpers/db-capabilities'

/* eslint-disable @typescript-eslint/no-explicit-any -- SCIM responses are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const DATA_API = dataApiProvider(await dbCapabilities())
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const RUN = randomUUID().slice(0, 8)
const DOMAIN = `scim-${RUN}.test`
const ENV_KEYS = ['AUTH_PROVIDER', 'DB_PROVIDER', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_URL', 'EMAIL_PROVIDER'] as const
const saved: Record<string, string | undefined> = {}

const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'

describe.skipIf(!DB_URL)('SCIM 2.0 endpoint (local stack)', () => {
  const pg = new Client({ connectionString: DB_URL })
  let tenantA = ''
  let tenantB = ''
  let tokenA = ''
  let tokenB = ''
  let handle: typeof import('@/lib/scim/handler').handleScimRequest
  let directory: typeof import('@/lib/services/directory-sync')
  let ctxFor: (tenantId: string) => import('@/lib/services/context').ServiceContext

  async function scim(method: string, path: string, options: { token?: string | null; body?: unknown; headers?: Record<string, string>; ip?: string } = {}) {
    const url = `https://app.test/scim/v2/${path}`
    const headers: Record<string, string> = { 'content-type': 'application/scim+json', 'x-forwarded-for': options.ip ?? '203.0.113.10', ...(options.headers ?? {}) }
    const token = options.token === undefined ? tokenA : options.token
    if (token) headers.authorization = `Bearer ${token}`
    const request = new Request(url, { method, headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) })
    const segments = path.split('?')[0].split('/').filter(Boolean)
    const response = await handle(request, segments)
    const text = await response.text()
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null }
  }

  const entraUser = (userName: string, extra: Record<string, unknown> = {}) => ({
    schemas: [USER_SCHEMA, ENTERPRISE],
    externalId: `ext-${userName}`,
    userName,
    active: true,
    displayName: `Display ${userName}`,
    emails: [{ primary: true, type: 'work', value: userName }],
    name: { formatted: `Given ${userName} Family`, familyName: 'Family', givenName: 'Given' },
    title: 'Engineer',
    [ENTERPRISE]: { employeeNumber: '42', department: 'R&D', manager: { value: '' } },
    ...extra,
  })

  async function localUser(email: string) {
    const { rows } = await pg.query('SELECT id, display_name FROM public.users WHERE lower(email) = lower($1)', [email])
    return rows[0] as { id: string; display_name: string } | undefined
  }

  async function access(userId: string, tenantId: string) {
    const { rows: m } = await pg.query('SELECT is_active FROM public.user_memberships WHERE user_id = $1 AND tenant_id = $2', [userId, tenantId])
    const { rows: r } = await pg.query('SELECT count(*)::int AS n FROM public.user_roles WHERE user_id = $1 AND tenant_id = $2', [userId, tenantId])
    return { member: m[0]?.is_active ?? null, roles: r[0].n as number }
  }

  beforeAll(async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    Object.assign(process.env, {
      AUTH_PROVIDER: 'builtin',
      DB_PROVIDER: DATA_API,
      DATABASE_URL: DB_URL,
      ...(DATA_API === 'supabase' ? { SUPABASE_URL: API_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } : {}),
      APP_URL: 'https://app.test',
      EMAIL_PROVIDER: 'console',
    })
    await pg.connect()
    const a = await pg.query<{ id: string }>(`INSERT INTO public.tenants (name, slug) VALUES ($1, $2) RETURNING id`, [`SCIM A ${RUN}`, `scim-a-${RUN}`])
    const b = await pg.query<{ id: string }>(`INSERT INTO public.tenants (name, slug) VALUES ($1, $2) RETURNING id`, [`SCIM B ${RUN}`, `scim-b-${RUN}`])
    tenantA = a.rows[0].id
    tenantB = b.rows[0].id
    handle = (await import('@/lib/scim/handler')).handleScimRequest
    directory = await import('@/lib/services/directory-sync')
    const { getServiceDb } = await import('@/lib/providers/db')
    const db = getServiceDb()
    ctxFor = (tenantId) => ({ db, supabase: db, tenantId, actorId: null, permissions: null, authKind: 'api_key', source: 'api' })
    tokenA = (await directory.createScimToken(ctxFor(tenantA), { name: 'Entra' })).token
    tokenB = (await directory.createScimToken(ctxFor(tenantB), { name: 'Okta' })).token
  }, 60_000)

  afterAll(async () => {
    const { rows } = await pg.query<{ id: string }>(`SELECT id FROM public.users WHERE email LIKE $1`, [`%@${DOMAIN}`])
    const ids = rows.map((r) => r.id)
    if (ids.length) {
      for (const table of ['user_teams', 'user_roles', 'user_memberships']) await pg.query(`DELETE FROM public.${table} WHERE user_id = ANY($1)`, [ids]).catch(() => undefined)
      await pg.query(`DELETE FROM app_auth.credentials WHERE user_id = ANY($1)`, [ids]).catch(() => undefined)
      await pg.query(`DELETE FROM public.users WHERE id = ANY($1)`, [ids]).catch(() => undefined)
      await pg.query(`DELETE FROM public.tenants WHERE slug = ANY($1)`, [ids.map((id) => `personal-${id.slice(0, 8)}`)]).catch(() => undefined)
    }
    for (const tenantId of [tenantA, tenantB].filter(Boolean)) {
      for (const table of ['scim_group_members', 'scim_resources', 'scim_tokens', 'directory_links', 'teams', 'tenant_connectors', 'object_audit_log', 'user_roles', 'user_memberships', 'roles', 'workspace_themes']) {
        await pg.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [tenantId]).catch(() => undefined)
      }
      await pg.query(`DELETE FROM public.tenants WHERE id = $1`, [tenantId]).catch(() => undefined)
    }
    await pg.end()
    const { closeAuthDb } = await import('@/lib/providers/auth/builtin/db')
    await closeAuthDb()
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }, 60_000)

  it('serves the discovery documents', async () => {
    const spc = await scim('GET', 'ServiceProviderConfig')
    expect(spc.status).toBe(200)
    expect(spc.headers.get('content-type')).toContain('application/scim+json')
    expect(spc.body).toMatchObject({ patch: { supported: true }, filter: { supported: true, maxResults: 1000 }, bulk: { supported: false }, etag: { supported: true } })
    const types = await scim('GET', 'ResourceTypes')
    expect(types.body.Resources.map((r: any) => r.id)).toEqual(['User', 'Group'])
    expect((await scim('GET', 'ResourceTypes/User')).body.endpoint).toBe('/Users')
    const schemas = await scim('GET', 'Schemas')
    expect(schemas.body.Resources.map((s: any) => s.id)).toEqual([USER_SCHEMA, ENTERPRISE, GROUP_SCHEMA])
    expect((await scim('GET', `Schemas/${GROUP_SCHEMA}`)).status).toBe(200)
    expect((await scim('GET', 'Schemas/urn:nope')).status).toBe(404)
    expect((await scim('GET', 'Nope')).status).toBe(404)
  })

  describe('denied requests', () => {
    it('refuses missing, malformed and unknown tokens with a SCIM 401', async () => {
      for (const token of [null, 'not-a-scim-token', `utscim_${'x'.repeat(43)}`, tokenA.slice(0, -1)]) {
        const res = await scim('GET', 'Users', { token, ip: '198.51.100.1' })
        expect(res.status).toBe(401)
        expect(res.body.schemas).toEqual([ERROR_SCHEMA])
        expect(res.body.status).toBe('401')
        expect(res.headers.get('www-authenticate')).toContain('Bearer')
      }
      const basic = await scim('GET', 'Users', { token: null, headers: { authorization: `Basic ${Buffer.from('a:b').toString('base64')}` } })
      expect(basic.status).toBe(401)
    })

    it('rate limits failed authentication per client IP', async () => {
      // Random per run: with a shared cache store the failure window outlives the process.
      const ip = `203.0.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
      const statuses: number[] = []
      for (let i = 0; i < 31; i++) statuses.push((await scim('GET', 'Users', { token: 'utscim_bogus', ip })).status)
      expect(statuses.slice(0, 29).every((s) => s === 401)).toBe(true)
      expect(statuses.at(-1)).toBe(429)
      // A valid token from elsewhere is unaffected.
      expect((await scim('GET', 'Users', { ip: '198.51.100.99' })).status).toBe(200)
    })

    it('enforces token scopes, expiry and revocation', async () => {
      const readOnly = (await directory.createScimToken(ctxFor(tenantA), { name: 'read only', scopes: ['users:read'] })).token
      expect((await scim('GET', 'Users', { token: readOnly })).status).toBe(200)
      const write = await scim('POST', 'Users', { token: readOnly, body: entraUser(`ro@${DOMAIN}`) })
      expect(write.status).toBe(403)
      expect(write.body.detail).toMatch(/users:write/)
      expect((await scim('GET', 'Groups', { token: readOnly })).status).toBe(403)

      const expiring = await directory.createScimToken(ctxFor(tenantA), { name: 'expiring', expires_in_days: 1 })
      await pg.query(`UPDATE public.scim_tokens SET expires_at = now() - interval '1 second' WHERE id = $1`, [expiring.scim_token.id])
      expect((await scim('GET', 'Users', { token: expiring.token })).body.detail).toMatch(/expired/)

      const rotated = await directory.createScimToken(ctxFor(tenantA), { name: 'rotated' })
      const next = await directory.rotateScimToken(ctxFor(tenantA), rotated.scim_token.id)
      expect((await scim('GET', 'Users', { token: rotated.token })).status).toBe(401)
      expect((await scim('GET', 'Users', { token: next.token })).status).toBe(200)
      const graced = await directory.rotateScimToken(ctxFor(tenantA), next.scim_token.id, { grace_minutes: 30 })
      expect((await scim('GET', 'Users', { token: next.token })).status).toBe(200) // still inside the grace period
      expect((await scim('GET', 'Users', { token: graced.token })).status).toBe(200)
      await directory.deleteScimToken(ctxFor(tenantA), graced.scim_token.id)
      expect((await scim('GET', 'Users', { token: graced.token })).status).toBe(401)

      // Only the hash is stored.
      const { rows } = await pg.query('SELECT token_hash, token_prefix FROM public.scim_tokens WHERE tenant_id = $1', [tenantA])
      expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash) && !tokenA.includes(r.token_hash))).toBe(true)
      expect(JSON.stringify(rows)).not.toContain(tokenA.slice(14))
    })

    it('a workspace token can neither see nor change another workspace’s resources', async () => {
      const created = await scim('POST', 'Users', { body: entraUser(`isolated@${DOMAIN}`) })
      expect(created.status).toBe(201)
      const id = created.body.id
      expect((await scim('GET', `Users/${id}`, { token: tokenB })).status).toBe(404)
      expect((await scim('PATCH', `Users/${id}`, { token: tokenB, body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'replace', path: 'active', value: false }] } })).status).toBe(404)
      expect((await scim('PUT', `Users/${id}`, { token: tokenB, body: entraUser(`isolated@${DOMAIN}`) })).status).toBe(404)
      expect((await scim('DELETE', `Users/${id}`, { token: tokenB })).status).toBe(404)
      const listB = await scim('GET', `Users?filter=${encodeURIComponent(`userName eq "isolated@${DOMAIN}"`)}`, { token: tokenB })
      expect(listB.body.totalResults).toBe(0)
      expect(JSON.stringify((await scim('GET', 'Users?count=1000', { token: tokenB })).body)).not.toContain(id)

      // The same userName is independent per workspace…
      const inB = await scim('POST', 'Users', { token: tokenB, body: entraUser(`isolated@${DOMAIN}`) })
      expect(inB.status).toBe(201)
      expect(inB.body.id).not.toBe(id)
      // …and a B group naming A's user ignores it (no cross-workspace links).
      const group = await scim('POST', 'Groups', { token: tokenB, body: { schemas: [GROUP_SCHEMA], displayName: `B team ${RUN}`, members: [{ value: id }, { value: inB.body.id }] } })
      expect(group.status).toBe(201)
      expect(group.body.members.map((m: any) => m.value)).toEqual([inB.body.id])
      const { rows } = await pg.query(`SELECT tenant_id FROM public.scim_group_members WHERE group_id = $1`, [group.body.id])
      expect(rows.every((r) => r.tenant_id === tenantB)).toBe(true)
      // A still has its own user, active.
      expect((await scim('GET', `Users/${id}`)).body.active).toBe(true)
    })

    it('stops accepting tokens when SCIM is disabled', async () => {
      const temp = await pg.query<{ id: string }>(`INSERT INTO public.tenants (name, slug) VALUES ($1, $2) RETURNING id`, [`SCIM C ${RUN}`, `scim-c-${RUN}`])
      const tenantC = temp.rows[0].id
      try {
        const { token } = await directory.createScimToken(ctxFor(tenantC), { name: 'c' })
        expect((await scim('GET', 'Users', { token })).status).toBe(200)
        await directory.deleteDirectoryConnection(ctxFor(tenantC), 'scim')
        expect((await scim('GET', 'Users', { token })).status).toBe(401)
        const { rows } = await pg.query('SELECT revoked_at FROM public.scim_tokens WHERE tenant_id = $1', [tenantC])
        expect(rows.every((r) => r.revoked_at)).toBe(true)
      } finally {
        for (const table of ['scim_tokens', 'tenant_connectors', 'object_audit_log', 'roles', 'workspace_themes']) await pg.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [tenantC]).catch(() => undefined)
        await pg.query('DELETE FROM public.tenants WHERE id = $1', [tenantC]).catch(() => undefined)
      }
    })

    it('rejects malformed bodies, unknown methods and bad filters', async () => {
      expect((await scim('POST', 'Users', { body: { schemas: [USER_SCHEMA] } })).body).toMatchObject({ status: '400', scimType: 'invalidValue' })
      const bad = await handle(new Request('https://app.test/scim/v2/Users', { method: 'POST', headers: { authorization: `Bearer ${tokenA}` }, body: '{not json' }), ['Users'])
      expect(bad.status).toBe(400)
      expect((await scim('GET', `Users?filter=${encodeURIComponent('userName xx "a"')}`)).body).toMatchObject({ status: '400', scimType: 'invalidFilter' })
      expect((await scim('PATCH', 'Users')).status).toBe(405)
      expect((await scim('GET', 'Users/not-a-uuid')).status).toBe(404)
      expect((await scim('PATCH', `Users/${randomUUID()}`, { body: { Operations: [{ op: 'replace', path: 'active', value: false }] } })).status).toBe(404)
    })
  })

  describe('Microsoft Entra ID validator flow', () => {
    let userId = ''
    let groupId = ''
    const email = `entra.user@${DOMAIN}`

    it('creates a user, links a new account and refuses a duplicate', async () => {
      const res = await scim('POST', 'Users', { body: entraUser(email) })
      expect(res.status).toBe(201)
      userId = res.body.id
      expect(res.headers.get('location')).toBe(`https://app.test/scim/v2/Users/${userId}`)
      expect(res.headers.get('etag')).toBe('W/"1"')
      expect(res.body).toMatchObject({
        schemas: [USER_SCHEMA, ENTERPRISE], userName: email, externalId: `ext-${email}`, active: true, displayName: `Display ${email}`,
        [ENTERPRISE]: { employeeNumber: '42', department: 'R&D' },
        meta: { resourceType: 'User', version: 'W/"1"', location: `https://app.test/scim/v2/Users/${userId}` },
      })
      const local = await localUser(email)
      expect(local).toBeTruthy()
      expect(await access(local!.id, tenantA)).toEqual({ member: true, roles: 1 })
      // Not granted anywhere else.
      const { rows } = await pg.query('SELECT count(*)::int AS n FROM public.user_roles WHERE user_id = $1 AND tenant_id <> $2', [local!.id, tenantA])
      expect(rows[0].n).toBe(0)

      const dup = await scim('POST', 'Users', { body: entraUser(email.toUpperCase()) })
      expect(dup.status).toBe(409)
      expect(dup.body.scimType).toBe('uniqueness')
    })

    it('filters by userName (any case), externalId, and misses cleanly', async () => {
      const q = (filter: string) => scim('GET', `Users?filter=${encodeURIComponent(filter)}`)
      expect((await q(`userName eq "${email.toUpperCase()}"`)).body).toMatchObject({ totalResults: 1, itemsPerPage: 1, startIndex: 1 })
      expect((await q(`externalId eq "ext-${email}"`)).body.Resources[0].id).toBe(userId)
      const none = await q(`userName eq "nobody-${RUN}@example.com"`)
      expect(none.body).toEqual({ schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] })
      expect((await q(`userName eq "${email}" and active eq true`)).body.totalResults).toBe(1)
      expect((await q(`emails[type eq "work" and value eq "${email}"]`)).body.totalResults).toBe(1)
      expect((await q(`${ENTERPRISE}:employeeNumber eq "42" and userName co "entra.user@scim-${RUN}"`)).body.totalResults).toBe(1)
    })

    it('patches attributes the way Entra sends them', async () => {
      const res = await scim('PATCH', `Users/${userId}`, {
        body: {
          schemas: [PATCH_SCHEMA],
          Operations: [
            { op: 'Replace', path: 'displayName', value: 'Entra Renamed' },
            { op: 'Replace', path: 'emails[type eq "work"].value', value: email },
            { op: 'Replace', path: 'name.givenName', value: 'Grace' },
            { op: 'Add', path: `${ENTERPRISE}:department`, value: 'Platform' },
            { op: 'Add', value: { title: 'Staff Engineer', 'name.familyName': 'Hopper' } },
          ],
        },
      })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ displayName: 'Entra Renamed', title: 'Staff Engineer', name: { givenName: 'Grace', familyName: 'Hopper' }, [ENTERPRISE]: { department: 'Platform', employeeNumber: '42' } })
      expect(res.headers.get('etag')).toBe('W/"2"')
      expect((await localUser(email))!.display_name).toBe('Entra Renamed')
    })

    it('deactivates ("False") and reactivates, as directory sync does', async () => {
      const local = (await localUser(email))!
      const off = await scim('PATCH', `Users/${userId}`, { body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] } })
      expect(off.body.active).toBe(false)
      expect(await access(local.id, tenantA)).toEqual({ member: false, roles: 0 })
      const on = await scim('PATCH', `Users/${userId}`, { body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'Replace', value: { active: true } }] } })
      expect(on.body.active).toBe(true)
      expect(await access(local.id, tenantA)).toEqual({ member: true, roles: 1 })
    })

    it('honours ETags', async () => {
      const current = await scim('GET', `Users/${userId}`)
      const etag = current.headers.get('etag')!
      expect((await scim('GET', `Users/${userId}`, { headers: { 'if-none-match': etag } })).status).toBe(304)
      const stale = await scim('PATCH', `Users/${userId}`, { headers: { 'if-match': 'W/"1"' }, body: { Operations: [{ op: 'replace', path: 'title', value: 'x' }] } })
      expect(stale.status).toBe(412)
      const fresh = await scim('PATCH', `Users/${userId}`, { headers: { 'if-match': etag }, body: { Operations: [{ op: 'replace', path: 'title', value: 'y' }] } })
      expect(fresh.status).toBe(200)
    })

    it('creates a group, filters it, adds and removes members (teams follow)', async () => {
      const created = await scim('POST', 'Groups', { body: { schemas: [GROUP_SCHEMA], externalId: `g-${RUN}`, displayName: `Entra Group ${RUN}`, members: [] } })
      expect(created.status).toBe(201)
      groupId = created.body.id
      expect((await scim('GET', `Groups?filter=${encodeURIComponent(`displayName eq "entra group ${RUN}"`)}&excludedAttributes=members`)).body.Resources).toEqual([
        expect.not.objectContaining({ members: expect.anything() }),
      ])
      const local = (await localUser(email))!
      const { rows: teamRows } = await pg.query('SELECT local_id FROM public.scim_resources WHERE id = $1', [groupId])
      const teamId = teamRows[0].local_id
      expect(teamId).toBeTruthy()

      const add = await scim('PATCH', `Groups/${groupId}`, { body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'Add', path: 'members', value: [{ value: userId }] }] } })
      expect(add.status).toBe(204)
      expect((await pg.query('SELECT 1 FROM public.user_teams WHERE team_id = $1 AND user_id = $2', [teamId, local.id])).rowCount).toBe(1)

      // Entra's membership check.
      const probe = (uid: string) => scim('GET', `Groups?filter=${encodeURIComponent(`id eq "${groupId}" and members[value eq "${uid}"]`)}&excludedAttributes=members`)
      expect((await probe(userId)).body.totalResults).toBe(1)
      expect((await probe(randomUUID())).body.totalResults).toBe(0)

      // A member added by hand stays when SCIM removes its own.
      const manual = await pg.query<{ id: string }>(`INSERT INTO public.users (id, email, display_name, tenant_id) VALUES (gen_random_uuid(), $1, 'Manual', $2) RETURNING id`, [`manual@${DOMAIN}`, tenantA])
      await pg.query('INSERT INTO public.user_teams (team_id, user_id) VALUES ($1, $2)', [teamId, manual.rows[0].id])
      const remove = await scim('PATCH', `Groups/${groupId}`, { body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'Remove', path: 'members', value: [{ value: userId }] }] } })
      expect(remove.status).toBe(204)
      const { rows: members } = await pg.query('SELECT user_id FROM public.user_teams WHERE team_id = $1', [teamId])
      expect(members.map((m) => m.user_id)).toEqual([manual.rows[0].id])

      const rename = await scim('PATCH', `Groups/${groupId}`, { body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'Replace', path: 'displayName', value: `Renamed ${RUN}` }] } })
      expect(rename.status).toBe(204)
      expect((await pg.query('SELECT name FROM public.teams WHERE id = $1', [teamId])).rows[0].name).toBe(`Renamed ${RUN}`)
    })

    it('renames the userName, then deletes the user (access revoked, account kept)', async () => {
      const newName = `entra.renamed@${DOMAIN}`
      const renamed = await scim('PATCH', `Users/${userId}`, { body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'Replace', path: 'userName', value: newName }] } })
      expect(renamed.body.userName).toBe(newName)
      expect((await scim('GET', `Users?filter=${encodeURIComponent(`userName eq "${newName}"`)}`)).body.totalResults).toBe(1)
      const local = (await localUser(email))!
      await scim('PATCH', `Groups/${groupId}`, { body: { Operations: [{ op: 'add', path: 'members', value: [{ value: userId }] }] } })
      expect((await scim('DELETE', `Users/${userId}`)).status).toBe(204)
      expect((await scim('GET', `Users/${userId}`)).status).toBe(404)
      expect(await localUser(email)).toBeTruthy()
      expect(await access(local.id, tenantA)).toEqual({ member: false, roles: 0 })
      expect((await pg.query('SELECT 1 FROM public.user_teams WHERE user_id = $1', [local.id])).rowCount).toBe(0)
      expect((await scim('DELETE', `Groups/${groupId}`)).status).toBe(204)
      expect((await scim('GET', `Groups/${groupId}`)).status).toBe(404)
    })
  })

  describe('Okta SCIM test flow', () => {
    const userName = `okta.user@${DOMAIN}`
    let id = ''

    it('probes with an empty filtered list, creates with a password (never stored), reads back', async () => {
      const probe = await scim('GET', `Users?filter=${encodeURIComponent(`userName eq "${userName}"`)}&startIndex=1&count=100`, { token: tokenB })
      expect(probe.body).toMatchObject({ totalResults: 0, Resources: [] })
      const created = await scim('POST', 'Users', {
        token: tokenB,
        body: {
          schemas: [USER_SCHEMA],
          userName,
          name: { givenName: 'Okta', familyName: 'User' },
          emails: [{ primary: true, value: userName, type: 'work' }],
          displayName: 'Okta User',
          locale: 'en-US',
          externalId: '00u1abcd',
          groups: [],
          password: 'never-store-me-1!',
          active: true,
        },
      })
      expect(created.status).toBe(201)
      id = created.body.id
      expect(JSON.stringify(created.body)).not.toContain('never-store-me')
      const { rows } = await pg.query('SELECT attributes::text AS a FROM public.scim_resources WHERE id = $1', [id])
      expect(rows[0].a).not.toContain('never-store-me')
      expect((await scim('GET', `Users/${id}`, { token: tokenB })).body).toMatchObject({ id, userName, locale: 'en-US', active: true })
    })

    it('updates with PUT and deactivates with PATCH replace {active:false}', async () => {
      const put = await scim('PUT', `Users/${id}`, {
        token: tokenB,
        body: { schemas: [USER_SCHEMA], id, userName, name: { givenName: 'Okta', familyName: 'Changed' }, emails: [{ primary: true, value: userName, type: 'work' }], active: true },
      })
      expect(put.status).toBe(200)
      expect(put.body.name.familyName).toBe('Changed')
      expect(put.body.locale).toBeUndefined() // PUT replaces
      const local = (await localUser(userName))!
      const off = await scim('PATCH', `Users/${id}`, { token: tokenB, body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'replace', value: { active: false } }] } })
      expect(off.body.active).toBe(false)
      expect(await access(local.id, tenantB)).toEqual({ member: false, roles: 0 })
      await scim('PATCH', `Users/${id}`, { token: tokenB, body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'replace', value: { active: true } }] } })
    })

    it('pushes groups: create with members, PATCH add / remove by filter path, PUT replaces members', async () => {
      const second = await scim('POST', 'Users', { token: tokenB, body: { schemas: [USER_SCHEMA], userName: `okta.two@${DOMAIN}`, emails: [{ value: `okta.two@${DOMAIN}`, primary: true }], active: true } })
      const group = await scim('POST', 'Groups', { token: tokenB, body: { schemas: [GROUP_SCHEMA], displayName: `Okta Group ${RUN}`, members: [{ value: id, display: userName }] } })
      expect(group.status).toBe(201)
      // The PUT above dropped displayName, so the member shows its userName.
      expect(group.body.members).toEqual([{ value: id, display: userName, $ref: `https://app.test/scim/v2/Users/${id}`, type: 'User' }])
      const gid = group.body.id
      await scim('PATCH', `Groups/${gid}`, { token: tokenB, body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'add', path: 'members', value: [{ value: second.body.id, display: 'two' }] }] } })
      expect((await scim('GET', `Groups/${gid}`, { token: tokenB })).body.members.map((m: any) => m.value).sort()).toEqual([id, second.body.id].sort())
      await scim('PATCH', `Groups/${gid}`, { token: tokenB, body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'remove', path: `members[value eq "${id}"]` }] } })
      expect((await scim('GET', `Groups/${gid}`, { token: tokenB })).body.members.map((m: any) => m.value)).toEqual([second.body.id])
      const put = await scim('PUT', `Groups/${gid}`, { token: tokenB, body: { schemas: [GROUP_SCHEMA], displayName: `Okta Group ${RUN}`, members: [{ value: id }] } })
      expect(put.body.members.map((m: any) => m.value)).toEqual([id])
      const teamId = (await pg.query('SELECT local_id FROM public.scim_resources WHERE id = $1', [gid])).rows[0].local_id
      const { rows } = await pg.query('SELECT u.email FROM public.user_teams ut JOIN public.users u ON u.id = ut.user_id WHERE ut.team_id = $1', [teamId])
      expect(rows.map((r) => r.email)).toEqual([userName])
      // Okta also replaces the whole membership in one PATCH.
      const replaced = await scim('PATCH', `Groups/${gid}?attributes=members`, { token: tokenB, body: { Operations: [{ op: 'replace', path: 'members', value: [{ value: second.body.id }] }] } })
      expect(replaced.status).toBe(200)
      expect(replaced.body.members.map((m: any) => m.value)).toEqual([second.body.id])
    })

    it('pages through users with startIndex and count', async () => {
      for (let i = 0; i < 4; i++) {
        await scim('POST', 'Users', { token: tokenB, body: { schemas: [USER_SCHEMA], userName: `page${i}@${DOMAIN}`, active: true } })
      }
      const all = await scim('GET', 'Users?count=1000', { token: tokenB })
      const total = all.body.totalResults
      expect(total).toBeGreaterThanOrEqual(6)
      const page = await scim('GET', 'Users?startIndex=2&count=2', { token: tokenB })
      expect(page.body).toMatchObject({ totalResults: total, startIndex: 2, itemsPerPage: 2 })
      expect(page.body.Resources.map((r: any) => r.id)).toEqual(all.body.Resources.slice(1, 3).map((r: any) => r.id))
      expect((await scim('GET', 'Users?count=0', { token: tokenB })).body).toMatchObject({ totalResults: total, itemsPerPage: 0, Resources: [] })
      const filtered = await scim('GET', `Users?filter=${encodeURIComponent(`userName sw "page"`)}&startIndex=3&count=10`, { token: tokenB })
      expect(filtered.body).toMatchObject({ totalResults: 4, startIndex: 3, itemsPerPage: 2 })
      const projected = await scim('GET', 'Users?count=1&attributes=userName', { token: tokenB })
      expect(Object.keys(projected.body.Resources[0]).sort()).toEqual(['id', 'schemas', 'userName'])
      const search = await scim('POST', 'Users/.search', { token: tokenB, body: { schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'], filter: 'userName sw "page"', count: 2 } })
      expect(search.body).toMatchObject({ totalResults: 4, itemsPerPage: 2 })
    })
  })

  describe('reconciliation rules', () => {
    it('links an existing account by email instead of creating one', async () => {
      const auth = await import('@/lib/providers/auth')
      const email = `existing@${DOMAIN}`
      const { id: existing } = await auth.resolveAuthProvider('builtin').admin.createUser({ email, password: 'existing-pass-1', emailConfirmed: true })
      const res = await scim('POST', 'Users', { body: entraUser(email.toUpperCase()) })
      expect(res.status).toBe(201)
      const { rows } = await pg.query('SELECT count(*)::int AS n FROM public.users WHERE lower(email) = $1', [email])
      expect(rows[0].n).toBe(1)
      expect((await pg.query('SELECT local_id FROM public.scim_resources WHERE id = $1', [res.body.id])).rows[0].local_id).toBe(existing)
      expect(await access(existing, tenantA)).toMatchObject({ member: true, roles: 1 })
      const { rows: link } = await pg.query(`SELECT local_id FROM public.directory_links WHERE tenant_id = $1 AND provider = 'scim' AND external_id = $2`, [tenantA, res.body.id])
      expect(link[0].local_id).toBe(existing)
    })

    it('with auto-provisioning off, unknown users are stored but not given accounts', async () => {
      await directory.updateDirectoryConnection(ctxFor(tenantA), 'scim', { auto_provision: false })
      try {
        const email = `noprovision@${DOMAIN}`
        const res = await scim('POST', 'Users', { body: entraUser(email) })
        expect(res.status).toBe(201)
        expect(await localUser(email)).toBeUndefined()
        expect((await pg.query('SELECT local_id FROM public.scim_resources WHERE id = $1', [res.body.id])).rows[0].local_id).toBeNull()
      } finally {
        await directory.updateDirectoryConnection(ctxFor(tenantA), 'scim', { auto_provision: true })
      }
    })

    it('users without an email stay unlinked; group sync off creates no teams', async () => {
      const res = await scim('POST', 'Users', { body: { schemas: [USER_SCHEMA], userName: `no-email-${RUN}`, active: true } })
      expect(res.status).toBe(201)
      expect((await pg.query('SELECT local_id FROM public.scim_resources WHERE id = $1', [res.body.id])).rows[0].local_id).toBeNull()
      await directory.updateDirectoryConnection(ctxFor(tenantA), 'scim', { sync_groups: false })
      try {
        const group = await scim('POST', 'Groups', { body: { schemas: [GROUP_SCHEMA], displayName: `No team ${RUN}` } })
        expect(group.status).toBe(201)
        expect((await pg.query('SELECT local_id FROM public.scim_resources WHERE id = $1', [group.body.id])).rows[0].local_id).toBeNull()
        expect((await pg.query('SELECT 1 FROM public.teams WHERE tenant_id = $1 AND name = $2', [tenantA, `No team ${RUN}`])).rowCount).toBe(0)
      } finally {
        await directory.updateDirectoryConnection(ctxFor(tenantA), 'scim', { sync_groups: true })
      }
    })

    it('audits provisioning with the token, never the token itself', async () => {
      const { rows } = await pg.query(`SELECT summary, metadata FROM public.object_audit_log WHERE tenant_id = $1 AND object_type = 'directory_sync' ORDER BY created_at`, [tenantA])
      expect(rows.some((r) => /SCIM provisioned user/.test(r.summary) && r.metadata.provider === 'scim' && r.metadata.token_id)).toBe(true)
      expect(JSON.stringify(rows)).not.toContain(tokenA)
    })
  })

  describe('service layer', () => {
    it('lists the SCIM connection with counts and the base URL; token list hides hashes', async () => {
      const list = await directory.listDirectoryConnections(ctxFor(tenantA))
      const scimConnection = list.connections.find((c) => c.provider === 'scim')!
      expect(scimConnection).toMatchObject({ enabled: true, sync_groups: true, auto_provision: true })
      expect(scimConnection.linked_users).toBeGreaterThan(0)
      expect(list.scim_url).toBe('https://app.test/scim/v2')
      const tokens = await directory.listScimTokens(ctxFor(tenantA))
      expect(tokens.scim_tokens.length).toBeGreaterThan(0)
      expect(JSON.stringify(tokens)).not.toMatch(/token_hash/)
    })

    it('refuses callers without the permissions', async () => {
      const viewer = { ...ctxFor(tenantA), permissions: new Set(['settings.view']) }
      await expect(directory.createScimToken(viewer, { name: 'x' })).rejects.toMatchObject({ code: 'forbidden' })
      await expect(directory.deleteDirectoryConnection(viewer, 'scim')).rejects.toMatchObject({ code: 'forbidden' })
      const nobody = { ...ctxFor(tenantA), permissions: new Set<string>() }
      await expect(directory.listScimTokens(nobody)).rejects.toMatchObject({ code: 'forbidden' })
      await expect(directory.listDirectoryConnections(nobody)).rejects.toMatchObject({ code: 'forbidden' })
      // Another workspace's token id is not found.
      const [mine] = (await directory.listScimTokens(ctxFor(tenantA))).scim_tokens
      await expect(directory.deleteScimToken(ctxFor(tenantB), mine.id)).rejects.toMatchObject({ code: 'not_found' })
      await expect(directory.rotateScimToken(ctxFor(tenantB), mine.id)).rejects.toMatchObject({ code: 'not_found' })
    })

    it('refuses secret references outside the workspace prefix', async () => {
      const settings = { url: 'ldap://127.0.0.1:1', bind_dn: 'cn=x', base_dn: 'dc=x' }
      await expect(directory.createDirectoryConnection(ctxFor(tenantA), { provider: 'ldap', settings, credentials: { bind_password: 'secret://ENCRYPTION_KEY' } }))
        .rejects.toMatchObject({ code: 'validation_error', message: expect.stringContaining(`tenants/${tenantA}/`) })
      await expect(directory.createDirectoryConnection(ctxFor(tenantA), { provider: 'ldap', settings, credentials: { bind_password: `secret://tenants/${tenantB}/ldap` } }))
        .rejects.toMatchObject({ code: 'validation_error' })
      await expect(directory.createDirectoryConnection(ctxFor(tenantA), { provider: 'ldap', settings, credentials: { bind_password: `secret://tenants/${tenantA}/../x` } }))
        .rejects.toMatchObject({ code: 'validation_error' })
    })
  })
})
