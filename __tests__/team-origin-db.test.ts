/**
 * Team origin and the assignee search against a LOCAL database (migration
 * 20270116050000_team_origin.sql, lib/teams/origin.ts,
 * lib/services/assignee-search.ts, lib/services/teams.ts):
 *  - the backfill: teams kept by an extension directory source (SharePoint
 *    by id / label), teams the built-in directory sync linked (Entra ID, Okta,
 *    LDAP — Active Directory when the connection uses that flavour — Google,
 *    SCIM) get their origin and external id; everything else stays Internal;
 *    re-running changes nothing (idempotent);
 *  - the sync paths tag new teams (tagTeamOrigin; an extension snapshot with
 *    the source's and a group's own kind) and never move a team between
 *    directories;
 *  - the search (signed-in user, RLS client): people and teams of the
 *    current workspace only, origin and member count on each team, the
 *    origin filter (teams only), the origins present, a team's first members;
 *    a non-member sees nothing of the workspace;
 *  - GET /api/v1/teams's service: search + origin filters, unknown origin 400.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g. a plain Postgres with every
 * migration applied (usertasks-admin db migrate):
 *   EVENT_STREAM_DB_URL=$URL DATABASE_URL=$URL DB_PROVIDER=postgres npx vitest run __tests__/team-origin-db.test.ts
 * or the local Supabase stack:
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/team-origin-db.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Pool } from 'pg'
import { createPgQuery } from '@user-tasks/pg-query'
import { createClient } from './helpers/db-test-client'
import { searchAssignees, teamMemberPreview, teamOriginCounts } from '@/lib/services/assignee-search'
import { listTeams } from '@/lib/services/teams'
import { tagTeamOrigin } from '@/lib/directory-sync/sync'
import { applySnapshot, normaliseSnapshot } from '@/lib/directory-sync/sources'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `70e1ce00-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const uid = (n: number) => `70${n.toString(16).padStart(6, '0')}-0000-4000-8000-0000000070e1`
const A = id(0xa)
const B = id(0xb)
const PRIYA = uid(0x101) // member of A
const FINN = uid(0x102)  // member of A ("Finn Fischer": matches "fin")
const SAM = uid(0x103)   // member of A
const OLGA = uid(0x104)  // member of B only (also named like "fin": never listed in A)
const USERS = [PRIYA, FINN, SAM, OLGA]
const T_INTERNAL = id(0x201)
const T_ENTRA = id(0x202)
const T_AD = id(0x203)
const T_SP = id(0x204)
const T_OKTA = id(0x205)
const T_EXT = id(0x206)
const T_B = id(0x207)
const T_SCIM = id(0x208)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270116050000_team_origin.sql'), 'utf8')

describe.skipIf(!DB_URL)('team origin + assignee search (local database)', () => {
  const db = new Client({ connectionString: DB_URL })
  const pool = new Pool({ connectionString: DB_URL, max: 2 })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const pgq = createPgQuery({ pool, maxRows: 1000 })

  const api = (tenantId: string, permissions: string[] = ['team.view_members']): ServiceContext =>
    ({ supabase: admin, db: admin, tenantId, actorId: null, permissions: new Set(permissions), authKind: 'api_key', source: 'api' } as ServiceContext)
  /** Signed-in user: an RLS-bound client (the dashboard's session client); service-role reads use `admin`. */
  const session = (tenantId: string, actorId: string): ServiceContext => {
    const client = pgq.client({ role: 'authenticated', claims: { sub: actorId, role: 'authenticated', aud: 'authenticated' } }) as any
    return { supabase: client, db: client, tenantId, actorId, permissions: new Set(['tasks.create', 'tasks.view_own']), authKind: 'session', source: 'ui' } as ServiceContext
  }
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows
  const originOf = async (team: string) => (await q('SELECT origin, external_id FROM public.teams WHERE id = $1', [team]))[0]

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS])).map((r: any) => r.tenant_id)
    for (const t of [A, B]) {
      await db.query('DELETE FROM public.directory_links WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.directory_entries WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tenant_connectors WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.user_teams WHERE team_id IN (SELECT id FROM public.teams WHERE tenant_id = $1)', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.teams WHERE tenant_id = $1', [t]).catch(() => undefined)
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, B, ...personal.filter((t: string | null) => t && ![A, B].includes(t))]])
  }

  const team = (tid: string, tenant: string, name: string, extra: { source?: string; source_label?: string } = {}) =>
    q('INSERT INTO public.teams (id, tenant_id, name, source, source_label) VALUES ($1, $2, $3, $4, $5)', [tid, tenant, name, extra.source ?? null, extra.source_label ?? null])
  const link = (tenant: string, provider: string, externalId: string, local: string) =>
    q(`INSERT INTO public.directory_links (tenant_id, provider, object_type, external_id, local_id, display_name) VALUES ($1, $2, 'group', $3, $4, $3)`, [tenant, provider, externalId, local])

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Origin A', 'origin-a-test'), ($2, 'Origin B', 'origin-b-test')`, [A, B])
    const names: Record<string, string> = { [PRIYA]: 'Priya Nair', [FINN]: 'Finn Fischer', [SAM]: 'Sam Lee', [OLGA]: 'Olga Finley' }
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `o${user.slice(2, 8)}.${Date.now().toString(36)}@origin.test`])
      const home = user === OLGA ? B : A
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, home])
      await q('UPDATE public.users SET current_tenant_id = $2, display_name = $3 WHERE id = $1', [user, home, names[user]])
    }
    // An LDAP connection with the Active Directory flavour in A.
    await q(`INSERT INTO public.tenant_connectors (tenant_id, connector_key, config) VALUES ($1, 'ldap_directory', $2)`,
      [A, JSON.stringify({ provider: 'ldap', settings: { flavor: 'active_directory' } })])

    await team(T_INTERNAL, A, 'Finance Ops')
    await team(T_ENTRA, A, 'Finance Approvers')
    await team(T_AD, A, 'FIN-Payables')
    await team(T_SP, A, 'Finance Site Members', { source: 'ext.sharepoint.directory', source_label: 'SharePoint · Finance' })
    await team(T_OKTA, A, 'Sales EMEA')
    await team(T_EXT, A, 'Partner Finance', { source: 'ext.partners.people', source_label: 'Partner portal' })
    await team(T_SCIM, A, 'Finance Contractors')
    await team(T_B, B, 'Finance B')
    await link(A, 'entra', 'entra-guid-1', T_ENTRA)
    await link(A, 'ldap', 'ad-guid-1', T_AD)
    await link(A, 'okta', '00g-okta', T_OKTA)
    await link(A, 'ext.sharepoint.directory', 'sp-group-7', T_SP)
    await link(A, 'scim', 'scim-res-1', T_SCIM)
    await q('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $3), ($2, $3), ($1, $4), ($2, $5), ($1, $5), ($6, $5)',
      [PRIYA, FINN, T_ENTRA, T_INTERNAL, T_SP, SAM])
    await q('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2)', [OLGA, T_B])
    // As if the teams predate the migration: every origin back to the default, then the migration's backfill.
    await q(`UPDATE public.teams SET origin = 'internal', external_id = NULL WHERE tenant_id = ANY($1::uuid[])`, [[A, B]])
    await db.query(MIGRATION)
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    await pool.end()
  }, 60_000)

  /* ── backfill ──────────────────────────────────────────────────────── */

  it('backfills the origin and external id from directory links and extension sources', async () => {
    expect(await originOf(T_INTERNAL)).toEqual({ origin: 'internal', external_id: null })
    expect(await originOf(T_ENTRA)).toEqual({ origin: 'entra', external_id: 'entra-guid-1' })
    expect(await originOf(T_AD)).toEqual({ origin: 'active_directory', external_id: 'ad-guid-1' })
    expect(await originOf(T_OKTA)).toEqual({ origin: 'okta', external_id: '00g-okta' })
    expect(await originOf(T_SCIM)).toEqual({ origin: 'scim', external_id: 'scim-res-1' })
    expect(await originOf(T_SP)).toEqual({ origin: 'sharepoint', external_id: 'sp-group-7' })
    expect(await originOf(T_EXT)).toEqual({ origin: 'extension', external_id: null })
    expect(await originOf(T_B)).toEqual({ origin: 'internal', external_id: null })
  })

  it('LDAP without the Active Directory flavour is LDAP; re-running the migration changes nothing', async () => {
    await q(`UPDATE public.teams SET origin = 'internal', external_id = NULL WHERE id = $1`, [T_AD])
    await q(`UPDATE public.tenant_connectors SET config = jsonb_set(config, '{settings,flavor}', '"openldap"') WHERE tenant_id = $1`, [A])
    await db.query(MIGRATION)
    expect(await originOf(T_AD)).toEqual({ origin: 'ldap', external_id: 'ad-guid-1' })
    // Restore AD and check idempotency: a second run keeps every value.
    await q(`UPDATE public.teams SET origin = 'internal', external_id = NULL WHERE id = $1`, [T_AD])
    await q(`UPDATE public.tenant_connectors SET config = jsonb_set(config, '{settings,flavor}', '"active_directory"') WHERE tenant_id = $1`, [A])
    await db.query(MIGRATION)
    const before = await q('SELECT id, origin, external_id FROM public.teams WHERE tenant_id = $1 ORDER BY id', [A])
    await db.query(MIGRATION)
    expect(await q('SELECT id, origin, external_id FROM public.teams WHERE tenant_id = $1 ORDER BY id', [A])).toEqual(before)
    expect(before.find((r: any) => r.id === T_AD)).toMatchObject({ origin: 'active_directory' })
  })

  it('refuses an origin that is not a slug', async () => {
    await expect(q(`UPDATE public.teams SET origin = 'Not valid!' WHERE id = $1`, [T_INTERNAL])).rejects.toThrow(/teams_origin_check/)
  })

  /* ── sync paths ────────────────────────────────────────────────────── */

  it('tagTeamOrigin tags a new directory team once and never moves it to another directory', async () => {
    const fresh = id(0x2f0)
    await team(fresh, A, 'Okta Admins')
    await tagTeamOrigin(admin as any, A, [fresh], 'okta', '00g-admins')
    expect(await originOf(fresh)).toEqual({ origin: 'okta', external_id: '00g-admins' })
    await tagTeamOrigin(admin as any, A, [fresh], 'entra', 'other')
    expect(await originOf(fresh)).toEqual({ origin: 'okta', external_id: '00g-admins' })
    // Another workspace's id is never touched.
    await tagTeamOrigin(admin as any, B, [T_INTERNAL], 'google')
    expect((await originOf(T_INTERNAL)).origin).toBe('internal')
    await q('DELETE FROM public.teams WHERE id = $1', [fresh])
  })

  it('an extension snapshot tags its teams with the source kind, or a group\'s own kind', async () => {
    const source = { id: 'ext.sharepoint.directory', label: 'SharePoint', kind: 'sharepoint' as const }
    await applySnapshot(admin as any, A, source, normaliseSnapshot({
      users: [],
      groups: [
        { externalId: 'sp-owners', displayName: 'Site Owners', members: [] },
        { externalId: 'ad-sg-finance', displayName: 'CONTOSO\\Finance SG', kind: 'active_directory', members: [] },
      ],
      complete: false,
    }))
    const rows = await q(`SELECT name, origin, external_id, source FROM public.teams WHERE tenant_id = $1 AND name IN ('Site Owners', 'CONTOSO\\Finance SG') ORDER BY name`, [A])
    expect(rows).toEqual([
      { name: 'CONTOSO\\Finance SG', origin: 'active_directory', external_id: 'ad-sg-finance', source: 'ext.sharepoint.directory' },
      { name: 'Site Owners', origin: 'sharepoint', external_id: 'sp-owners', source: 'ext.sharepoint.directory' },
    ])
    await q(`DELETE FROM public.directory_links WHERE tenant_id = $1 AND external_id IN ('sp-owners', 'ad-sg-finance')`, [A])
    await q(`DELETE FROM public.teams WHERE tenant_id = $1 AND name IN ('Site Owners', 'CONTOSO\\Finance SG')`, [A])
  })

  /* ── assignee search (signed-in user) ──────────────────────────────── */

  it('finds people and teams of the current workspace, with origin and member count', async () => {
    const result = await searchAssignees(session(A, PRIYA), { q: 'fin', limit: 20 })
    expect(result.people.map((p) => p.id)).toEqual([FINN]) // Olga (workspace B) is not listed
    const byId = Object.fromEntries(result.teams.map((t) => [t.id, t]))
    expect(Object.keys(byId).sort()).toEqual([T_AD, T_ENTRA, T_EXT, T_INTERNAL, T_SCIM, T_SP].sort())
    expect(byId[T_ENTRA]).toMatchObject({ kind: 'team', name: 'Finance Approvers', origin: 'entra', origin_label: 'Entra ID', member_count: 2 })
    expect(byId[T_SP]).toMatchObject({ origin: 'sharepoint', origin_label: 'SharePoint', source_label: 'SharePoint · Finance', member_count: 3 })
    expect(byId[T_AD]).toMatchObject({ origin: 'active_directory', origin_label: 'Active Directory', member_count: 0 })
    expect(byId[T_INTERNAL]).toMatchObject({ origin: 'internal', origin_label: 'Internal', member_count: 1 })
    expect(result.teams.some((t) => t.id === T_B)).toBe(false)
  })

  it('the origin filter narrows teams and leaves people out; kinds and limit apply', async () => {
    const entra = await searchAssignees(session(A, PRIYA), { q: '', origin: 'entra' })
    expect(entra.people).toEqual([])
    expect(entra.teams.map((t) => t.id)).toEqual([T_ENTRA])
    const sp = await searchAssignees(session(A, PRIYA), { q: 'site', origin: 'sharepoint' })
    expect(sp.teams.map((t) => t.id)).toEqual([T_SP])
    const teamsOnly = await searchAssignees(session(A, PRIYA), { q: 'fin', kinds: ['team'], limit: 2 })
    expect(teamsOnly.people).toEqual([])
    expect(teamsOnly.teams).toHaveLength(2)
    const peopleOnly = await searchAssignees(session(A, PRIYA), { q: 'sam', kinds: ['person'] })
    expect(peopleOnly).toEqual({ people: [expect.objectContaining({ id: SAM, name: 'Sam Lee' })], teams: [] })
    await expect(searchAssignees(session(A, PRIYA), { origin: 'myspace' })).rejects.toThrow(/Unknown team origin/)
  })

  it('search terms with LIKE / PostgREST syntax are inert', async () => {
    // Only syntax: the term is empty once cleaned — the same as no term (the first people and teams by name).
    expect(await searchAssignees(session(A, PRIYA), { q: '%,()*:"' })).toEqual(await searchAssignees(session(A, PRIYA), { q: '' }))
    // A comma cannot inject another or() condition: "x,email.ilike.*" is searched as plain words.
    expect((await searchAssignees(session(A, PRIYA), { q: 'zz,email.ilike.*' })).people).toEqual([])
    expect((await searchAssignees(session(A, PRIYA), { q: 'Finance_Ops', kinds: ['team'] })).teams.map((t) => t.id)).toEqual([T_INTERNAL])
  })

  it('the origins present in the workspace, with counts (the filter chips)', async () => {
    expect(await teamOriginCounts(session(A, PRIYA))).toEqual([
      { origin: 'internal', label: 'Internal', count: 1 },
      { origin: 'active_directory', label: 'Active Directory', count: 1 },
      { origin: 'entra', label: 'Entra ID', count: 1 },
      { origin: 'okta', label: 'Okta', count: 1 },
      { origin: 'scim', label: 'SCIM', count: 1 },
      { origin: 'sharepoint', label: 'SharePoint', count: 1 },
      { origin: 'extension', label: 'Directory source', count: 1 },
    ])
    expect(await teamOriginCounts(session(B, OLGA))).toEqual([{ origin: 'internal', label: 'Internal', count: 1 }])
  })

  it('a team\'s first members by name and its member count', async () => {
    expect(await teamMemberPreview(session(A, PRIYA), T_SP, 2)).toEqual({
      team_id: T_SP, total: 3,
      members: [expect.objectContaining({ id: FINN, name: 'Finn Fischer' }), expect.objectContaining({ id: PRIYA, name: 'Priya Nair' })],
    })
    // Another workspace's team: nothing.
    expect(await teamMemberPreview(session(A, PRIYA), T_B)).toEqual({ team_id: T_B, total: 0, members: [] })
  })

  it('a caller who is not a member of the workspace finds nothing in it (RLS)', async () => {
    const result = await searchAssignees(session(A, OLGA), { q: 'fin' })
    expect(result).toEqual({ people: [], teams: [] })
    expect(await teamOriginCounts(session(A, OLGA))).toEqual([])
  })

  /* ── GET /api/v1/teams (service) ───────────────────────────────────── */

  it('lists teams with origin, filtered by search and origin', async () => {
    const all = await listTeams(api(A))
    expect(all.teams.every((t: any) => typeof t.origin === 'string' && typeof t.origin_label === 'string')).toBe(true)
    const entra = await listTeams(api(A), { origin: 'entra' })
    expect(entra.teams.map((t: any) => [t.id, t.origin, t.external_id, t.member_count])).toEqual([[T_ENTRA, 'entra', 'entra-guid-1', 2]])
    const search = await listTeams(api(A), { search: 'sales' })
    expect(search.teams.map((t: any) => t.id)).toEqual([T_OKTA])
    expect((await listTeams(api(A), { search: 'fin', limit: 2 })).teams).toHaveLength(2)
    await expect(listTeams(api(A), { origin: 'nope' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(listTeams(api(A, []))).rejects.toMatchObject({ code: 'forbidden' })
  })
})
