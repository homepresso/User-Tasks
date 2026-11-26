/**
 * App rules' server actions against the real schema and RLS (migration
 * 20270120090000_apps applied inside this test's transaction and rolled
 * back): POST /api/v1/apps/{id}/actions's service as real viewers —
 *
 *  - a contributor (through a team) looks up and creates data table rows
 *    with their own permissions and RLS; the rule's table comes from the
 *    saved page, never the request;
 *  - a viewer (read-only app role) is refused writes; a member without View
 *    data is refused the lookup;
 *  - an API reference call is refused without View integrations;
 *  - a member outside the audience, and another workspace's user, get
 *    "not found"; every run is audited.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/apps-rules-db.test.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client, type Pool } from 'pg'
import { createPgQuery } from '@user-tasks/pg-query'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows */

let serviceClient: any = null
vi.mock('@/lib/cron-auth', async (orig) => ({ ...(await orig() as object), createServiceClient: () => serviceClient }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
const { writeAudit } = await import('@/lib/audit-log')
const { runAppRuleAction, appActionDeps } = await import('@/lib/services/app-rule-actions')

const DB_URL = process.env.EVENT_STREAM_DB_URL
const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270120090000_apps.sql'), 'utf8')
// App drafts (20270123090000): applied after the fixture rows — its backfill publishes the app as version 1, and rule actions run the PUBLISHED rules.
const DRAFTS_MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270123090000_app_drafts.sql'), 'utf8')

function uid(key: string): string {
  const h = createHash('md5').update(`apps-rules-db:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const TENANT = { A: uid('tenant:A'), B: uid('tenant:B') }
const U = { builder: uid('u:builder'), member: uid('u:member'), viewer: uid('u:viewer'), outsider: uid('u:outsider'), other: uid('u:other') }
const ROLE = { use: uid('role:use'), b: uid('role:b') }
const TEAM = uid('team:desk')
const APP = uid('app:A')
const PAGE = uid('page:A')
const TABLE = { A: uid('table:A'), B: uid('table:B') }
const REF = uid('ref:A')
const ROW = { A: uid('row:A'), B: uid('row:B') }

function savepointPool(client: Client): Pool {
  let chain: Promise<unknown> = Promise.resolve()
  let statements: Promise<unknown> = Promise.resolve()
  const query = (text: any, values?: any) => {
    const next = statements.then(() => client.query(text, values))
    statements = next.catch(() => {})
    return next
  }
  return {
    query,
    async connect() {
      let release!: () => void
      const turn = chain.then(() => undefined)
      chain = turn.then(() => new Promise<void>((r) => { release = r }))
      await turn
      return {
        query(text: any, values?: any) {
          if (typeof text === 'string' && /^BEGIN\b/.test(text)) return query('SAVEPOINT pgq')
          // Writes made through the clients are kept until the test's own ROLLBACK.
          // A released savepoint keeps the request's SET LOCAL role, which a real
          // COMMIT would end: reset it, or the next service-role request (pg-query
          // runs it as the session owner where service_role has no BYPASSRLS, the
          // managed-PostgreSQL CI job) and the test's own statements inherit it.
          if (text === 'COMMIT') return query('RELEASE SAVEPOINT pgq; RESET ROLE')
          if (text === 'ROLLBACK') return query('ROLLBACK TO SAVEPOINT pgq; RELEASE SAVEPOINT pgq')
          return query(text, values)
        },
        release: () => release(),
      }
    },
  } as unknown as Pool
}

describe.skipIf(!DB_URL)('app rules server actions (local DB, RLS)', () => {
  const db = new Client({ connectionString: DB_URL })
  let pgq: ReturnType<typeof createPgQuery>
  const as = (user: string) => pgq.client({ role: 'authenticated', claims: { sub: user, role: 'authenticated', aud: 'authenticated' } }) as any
  const ctx = (user: string, tenant: string, perms: string[]): ServiceContext => {
    const client = as(user)
    return { db: client, supabase: client, tenantId: tenant, actorId: user, permissions: new Set(perms), authKind: 'session', source: 'ui' }
  }
  const PERMS = ['apps.view', 'data.view', 'data.manage_rows']
  let n = 0
  const run = (c: ServiceContext, path: string, values: Record<string, string> = {}) => runAppRuleAction(c, APP, { page: 'home', rule_id: 'desk', path, values, idempotency_key: `key-${++n}-${Date.now()}` })

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(MIGRATION)
    for (const k of ['A', 'B'] as const) await db.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)', [TENANT[k], `rules ${k}`, `apps-rules-db-${k.toLowerCase()}`])
    const people: Array<[string, 'A' | 'B']> = [[U.builder, 'A'], [U.member, 'A'], [U.viewer, 'A'], [U.outsider, 'A'], [U.other, 'B']]
    for (const [user, k] of people) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [user, `${user.slice(0, 8)}@apps-rules-db.test`])
      await db.query('DELETE FROM public.user_memberships WHERE user_id = $1', [user])
      await db.query('DELETE FROM public.user_roles WHERE user_id = $1', [user])
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [user, TENANT[k]])
      await db.query('INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home) VALUES ($1, $2, $3, true)', [user, TENANT[k], 'member'])
    }
    await db.query('INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $5)', [ROLE.use, TENANT.A, 'Desk users', 'apps-rules-db-use', PERMS, ROLE.b, TENANT.B, 'B users', 'apps-rules-db-b'])
    for (const u of [U.builder, U.member, U.viewer, U.outsider]) await db.query('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [TENANT.A, u, ROLE.use])
    await db.query('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [TENANT.B, U.other, ROLE.b])
    await db.query('INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, $3)', [TEAM, TENANT.A, 'Desk'])
    await db.query('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2)', [U.member, TEAM])
    for (const k of ['A', 'B'] as const) {
      await db.query(`INSERT INTO public.custom_tables (id, tenant_id, name, slug, columns, created_by) VALUES ($1, $2, $3, $4, $5, $6)`, [TABLE[k], TENANT[k], `Customers ${k}`, `customers-${k.toLowerCase()}`, JSON.stringify([{ key: 'name', name: 'Name', type: 'text' }, { key: 'region', name: 'Region', type: 'text' }]), k === 'A' ? U.builder : U.other])
      await db.query(`INSERT INTO public.custom_table_rows (id, tenant_id, table_id, data, created_by) VALUES ($1, $2, $3, $4, $5)`, [ROW[k], TENANT[k], TABLE[k], JSON.stringify({ name: k === 'A' ? 'Northwind' : 'Secret B', region: 'EMEA' }), k === 'A' ? U.builder : U.other])
    }
    await db.query(`INSERT INTO public.apps (id, tenant_id, slug, name, created_by) VALUES ($1, $2, 'desk', 'Desk', $3)`, [APP, TENANT.A, U.builder])
    const layout = {
      widgets: [{ id: 'grid', type: 'data_grid', w: 12, h: 6, config: { table_id: TABLE.A } }],
      variables: [{ name: 'customer', type: 'record' }],
      rules: [{ id: 'desk', when: { type: 'row_click' }, then: [
        { type: 'table_lookup', table_id: TABLE.A, row_id: '{{event.row.id}}', limit: 1, result_var: 'customer' },
        { type: 'table_create', table_id: TABLE.A, values: { name: '{{event.row.name}}', region: 'APAC' } },
        { type: 'call_reference', reference_id: REF, inputs: { company: '{{var.customer.name}}' } },
        // Another workspace's table in a saved rule: still read as the viewer, so nothing comes back.
        { type: 'table_lookup', table_id: TABLE.B, row_id: '{{event.row.id}}', limit: 1 },
      ] }],
    }
    await db.query(`INSERT INTO public.app_pages (id, tenant_id, app_id, slug, title, layout) VALUES ($1, $2, $3, 'home', 'Home', $4)`, [PAGE, TENANT.A, APP, JSON.stringify(layout)])
    await db.query(`INSERT INTO public.app_audience (tenant_id, app_id, principal_type, principal_id, app_role) VALUES ($1, $2, 'team', $3, 'contributor'), ($1, $2, 'user', $4, 'viewer')`, [TENANT.A, APP, TEAM, U.viewer])
    await db.query('INSERT INTO public.app_editors (tenant_id, app_id, user_id) VALUES ($1, $2, $3)', [TENANT.A, APP, U.builder])
    await db.query(DRAFTS_MIGRATION)
    pgq = createPgQuery({ pool: savepointPool(db), maxRows: 1000 })
    serviceClient = pgq.client({ role: 'service_role', claims: { role: 'service_role' } })
    Object.assign(appActionDeps, { rateLimit: async () => ({ ok: true, retryAfterMs: 0 }), cache: async () => null })
  }, 60_000)

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  it('a contributor looks up and creates rows with their own permissions; audited', async () => {
    vi.mocked(writeAudit).mockClear()
    const member = ctx(U.member, TENANT.A, PERMS)
    const found = await run(member, 'then.0', { row_id: ROW.A })
    expect(found.result).toMatchObject({ id: ROW.A, name: 'Northwind' })
    const created = await run(member, 'then.1', { 'values.name': 'Contoso', 'values.region': 'ignored-not-a-slot', evil: 'x' })
    const { rows } = await db.query('SELECT tenant_id, data FROM public.custom_table_rows WHERE id = $1', [(created.result as any).row_id])
    expect(rows[0].tenant_id).toBe(TENANT.A)
    // region is a fixed value in the saved rule: the request can't change it.
    expect(rows[0].data).toMatchObject({ name: 'Contoso', region: 'APAC' })
    expect(vi.mocked(writeAudit).mock.calls.length).toBeGreaterThan(0)
  })

  it('another workspace’s row is never readable through a rule, even when the request names it', async () => {
    const member = ctx(U.member, TENANT.A, PERMS)
    expect((await run(member, 'then.0', { row_id: ROW.B })).result).toBeNull()
    await expect(run(member, 'then.3', { row_id: ROW.B })).rejects.toBeTruthy()
  })

  it('viewers can read but not write; no View data, no lookup; no View integrations, no API call', async () => {
    const viewer = ctx(U.viewer, TENANT.A, PERMS)
    expect((await run(viewer, 'then.0', { row_id: ROW.A })).result).toMatchObject({ name: 'Northwind' })
    await expect(run(viewer, 'then.1', { 'values.name': 'X' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(run(ctx(U.member, TENANT.A, ['apps.view']), 'then.0', { row_id: ROW.A })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(run(ctx(U.member, TENANT.A, PERMS), 'then.2', { 'inputs.company': 'Northwind' })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('outside the audience, or another workspace: not found', async () => {
    await expect(run(ctx(U.outsider, TENANT.A, PERMS), 'then.0', { row_id: ROW.A })).rejects.toMatchObject({ code: 'not_found' })
    await expect(run(ctx(U.other, TENANT.B, PERMS), 'then.0', { row_id: ROW.A })).rejects.toMatchObject({ code: 'not_found' })
  })
})
