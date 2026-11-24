/**
 * App drafts against the real schema and RLS (migrations 20270120090000_apps
 * and 20270123090000_app_drafts, applied inside this test's transaction and
 * rolled back):
 *
 *  - the backfill publishes an existing app as version 1, with the snapshot
 *    lib/apps/versions.ts buildAppSnapshot would build from the same rows
 *    and the card summary (home page);
 *  - RLS: the draft rows (apps, app_pages) are readable by the app's editors
 *    only; app_versions by editors (every version) and the audience (the
 *    published version only); nothing for anyone else or another workspace;
 *    no client writes; versions are immutable (UPDATE refused);
 *  - through the services as the signed-in viewer: a draft change never
 *    reaches apps.page / apps.widget until it is published; publishing
 *    moves the audience to the new version and RLS follows.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/app-drafts-db.test.ts
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
const appsService = await import('@/lib/services/apps')
const versions = await import('@/lib/services/app-versions')
const { resetAppDrafts } = await import('@/lib/services/app-published')
const { buildAppSnapshot } = await import('@/lib/apps/versions')
const { runUiRead } = await import('@/lib/services/ui-reads')

const DB_URL = process.env.EVENT_STREAM_DB_URL
const APPS_MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270120090000_apps.sql'), 'utf8')
const DRAFTS_MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270123090000_app_drafts.sql'), 'utf8')

function uid(key: string): string {
  const h = createHash('md5').update(`app-drafts-db:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const TENANT = { A: uid('tenant:A'), B: uid('tenant:B') }
const U = { builder: uid('u:builder'), member: uid('u:member'), outsider: uid('u:outsider'), other: uid('u:other') }
const ROLE = { build: uid('role:build'), use: uid('role:use'), bOwner: uid('role:b') }
const TEAM = uid('team:desk')
const APP = { A: uid('app:A'), B: uid('app:B') }
const PAGE = { home: uid('page:home'), hidden: uid('page:hidden') }

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
          if (text === 'COMMIT') return query('RELEASE SAVEPOINT pgq')
          if (text === 'ROLLBACK') return query('ROLLBACK TO SAVEPOINT pgq; RELEASE SAVEPOINT pgq')
          return query(text, values)
        },
        release: () => release(),
      }
    },
  } as unknown as Pool
}

describe.skipIf(!DB_URL)('app drafts (local DB, RLS)', () => {
  const db = new Client({ connectionString: DB_URL })
  let pgq: ReturnType<typeof createPgQuery>
  const as = (user: string) => pgq.client({ role: 'authenticated', claims: { sub: user, role: 'authenticated', aud: 'authenticated' } }) as any
  const ctx = (user: string, tenant: string, perms: string[]): ServiceContext => {
    const client = as(user)
    return { db: client, supabase: client, tenantId: tenant, actorId: user, permissions: new Set(perms), authKind: 'session', source: 'ui' } as ServiceContext
  }
  const MEMBER_PERMS = ['apps.view', 'tasks.view_own']
  const BUILDER_PERMS = ['apps.view', 'apps.manage']
  const selectIds = async (user: string, table: string, column = 'id') => {
    const { data, error } = await as(user).from(table).select(column)
    if (error) throw new Error(error.message)
    return ((data ?? []) as any[]).map((r) => r[column])
  }

  beforeAll(async () => {
    resetAppDrafts()
    await db.connect()
    await db.query('BEGIN')
    await db.query(APPS_MIGRATION)
    for (const k of ['A', 'B'] as const) await db.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)', [TENANT[k], `drafts ${k}`, `app-drafts-db-${k.toLowerCase()}`])
    const people: Array<[string, 'A' | 'B']> = [[U.builder, 'A'], [U.member, 'A'], [U.outsider, 'A'], [U.other, 'B']]
    for (const [user, k] of people) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [user, `${user.slice(0, 8)}@app-drafts-db.test`])
      await db.query('DELETE FROM public.user_memberships WHERE user_id = $1', [user])
      await db.query('DELETE FROM public.user_roles WHERE user_id = $1', [user])
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [user, TENANT[k]])
      await db.query('INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home) VALUES ($1, $2, $3, true)', [user, TENANT[k], 'member'])
    }
    await db.query('INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $9), ($10, $11, $12, $13, $5)', [
      ROLE.build, TENANT.A, 'Builders', 'app-drafts-build', BUILDER_PERMS,
      ROLE.use, 'Users', 'app-drafts-use', MEMBER_PERMS,
      ROLE.bOwner, TENANT.B, 'B builders', 'app-drafts-b',
    ])
    await db.query('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3), ($1, $4, $5), ($1, $6, $5), ($7, $8, $9)', [
      TENANT.A, U.builder, ROLE.build, U.member, ROLE.use, U.outsider, TENANT.B, U.other, ROLE.bOwner,
    ])
    await db.query('INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, $3)', [TEAM, TENANT.A, 'Desk'])
    await db.query('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2)', [U.member, TEAM])
    await db.query(`INSERT INTO public.apps (id, tenant_id, slug, name, subtitle, menu, settings, created_by) VALUES ($1, $2, 'desk', 'Desk', 'Front desk', '[]', $3, $4), ($5, $6, 'desk', 'B desk', null, '[]', '{}', $7)`,
      [APP.A, TENANT.A, JSON.stringify({ access_issues: 3, nav: { style: 'tabs' } }), U.builder, APP.B, TENANT.B, U.other])
    const heading = (id: string, text: string) => ({ id, type: 'heading', w: 12, h: 2, config: { text } })
    // A hidden page first: the home page is the first page every audience role may open.
    await db.query(`INSERT INTO public.app_pages (id, tenant_id, app_id, slug, title, position, layout) VALUES ($1, $2, $3, 'setup', 'Setup', 0, $4), ($5, $2, $3, 'home', 'Home', 1, $6)`,
      [PAGE.hidden, TENANT.A, APP.A, JSON.stringify({ widgets: [], options: { hidden: true, min_role: 'viewer' } }), PAGE.home, JSON.stringify({ widgets: [heading('h1', 'Published hello')] })])
    await db.query(`INSERT INTO public.app_audience (tenant_id, app_id, principal_type, principal_id, app_role) VALUES ($1, $2, 'team', $3, 'viewer')`, [TENANT.A, APP.A, TEAM])
    await db.query(`INSERT INTO public.app_audience (tenant_id, app_id, principal_type, principal_id) VALUES ($1, $2, 'user', $3)`, [TENANT.B, APP.B, U.member])
    await db.query('INSERT INTO public.app_editors (tenant_id, app_id, user_id) VALUES ($1, $2, $3)', [TENANT.A, APP.A, U.builder])
    // Existing apps when the drafts migration runs: snapshotted and published as version 1.
    await db.query(DRAFTS_MIGRATION)
    // Idempotent: a second run changes nothing.
    await db.query(DRAFTS_MIGRATION)
    pgq = createPgQuery({ pool: savepointPool(db), maxRows: 1000 })
    serviceClient = pgq.client({ role: 'service_role', claims: { role: 'service_role' } })
  }, 60_000)

  afterAll(async () => {
    resetAppDrafts()
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  it('the backfill publishes existing apps as version 1 with the snapshot the code builds', async () => {
    const { rows: apps } = await db.query('SELECT id, published_version, has_draft_changes FROM public.apps WHERE id = ANY($1) ORDER BY id', [[APP.A, APP.B]])
    expect(apps.every((a) => a.published_version === 1 && a.has_draft_changes === false)).toBe(true)
    const { rows } = await db.query('SELECT version, snapshot, summary, source, tenant_id FROM public.app_versions WHERE app_id = $1', [APP.A])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ version: 1, source: 'initial', tenant_id: TENANT.A })
    const { rows: app } = await db.query('SELECT name, subtitle, description, icon, color, menu, settings FROM public.apps WHERE id = $1', [APP.A])
    const { rows: pages } = await db.query('SELECT id, slug, title, icon, position, layout, filters, created_at::text FROM public.app_pages WHERE app_id = $1', [APP.A])
    expect(rows[0].snapshot).toEqual(JSON.parse(JSON.stringify(buildAppSnapshot(app[0], pages))))
    expect(rows[0].snapshot.app.settings).toEqual({ nav: { style: 'tabs' } })
    expect(rows[0].summary).toMatchObject({ name: 'Desk', subtitle: 'Front desk', home_page: 'home' })
  })

  it('RLS: drafts for editors only; the audience reads the published version only; others nothing', async () => {
    expect(await selectIds(U.builder, 'apps')).toEqual([APP.A])
    expect((await selectIds(U.builder, 'app_pages')).sort()).toEqual([PAGE.hidden, PAGE.home].sort())
    expect(await selectIds(U.member, 'apps')).toEqual([])
    expect(await selectIds(U.member, 'app_pages')).toEqual([])
    expect(await selectIds(U.member, 'app_versions', 'app_id')).toEqual([APP.A])
    expect(await selectIds(U.outsider, 'app_versions')).toEqual([])
    expect(await selectIds(U.other, 'app_versions', 'app_id')).toEqual([APP.B])
    // Workspace B's app names our member: still invisible from workspace A.
    expect(await selectIds(U.member, 'app_versions', 'app_id')).not.toContain(APP.B)
  })

  it('no client writes; versions are immutable', async () => {
    const ins = await as(U.builder).from('app_versions').insert({ tenant_id: TENANT.A, app_id: APP.A, version: 9, snapshot: {} })
    expect(ins.error).toBeTruthy()
    // (The session clients SET LOCAL ROLE on this connection: back to the owner for the direct statement.)
    await db.query('SAVEPOINT immut')
    await db.query('RESET ROLE')
    const error = await db.query(`UPDATE public.app_versions SET note = 'changed' WHERE app_id = $1`, [APP.A]).then(() => null, (e: Error) => e)
    await db.query('ROLLBACK TO SAVEPOINT immut')
    expect(error?.message).toMatch(/immutable/)
  })

  it('a draft change never reaches the audience until published; then RLS follows the new version', async () => {
    const builder = ctx(U.builder, TENANT.A, BUILDER_PERMS)
    const member = ctx(U.member, TENANT.A, MEMBER_PERMS)
    await appsService.updatePage(builder, APP.A, 'home', { layout: { widgets: [{ id: 'h1', type: 'heading', w: 12, h: 2, config: { text: 'Draft hello' } }] } as any })
    await appsService.updateApp(builder, APP.A, { name: 'Desk v2' })
    await db.query('RESET ROLE')
    const { rows: flag } = await db.query('SELECT has_draft_changes, draft_updated_by FROM public.apps WHERE id = $1', [APP.A])
    expect(flag[0]).toEqual({ has_draft_changes: true, draft_updated_by: U.builder })

    const view = await runUiRead(member, { name: 'apps.page', args: { app: 'desk', page: 'home' } })
    expect(view.ok && (view.data as any).app.name).toBe('Desk')
    expect(view.ok && (view.data as any).page.layout.widgets[0].config.text).toBe('Published hello')
    expect(await runUiRead(member, { name: 'apps.page', args: { app: 'desk', page: 'home', mode: 'preview' } })).toMatchObject({ ok: false, status: 403 })
    const mine = await runUiRead(member, { name: 'apps.mine', args: {} })
    expect(mine.ok && (mine.data as any[]).map((a) => a.name)).toEqual(['Desk'])
    const preview = await runUiRead(builder, { name: 'apps.page', args: { app: 'desk', page: 'home', mode: 'preview' } })
    expect(preview.ok && (preview.data as any).page.layout.widgets[0].config.text).toBe('Draft hello')

    const published = await versions.publishApp(builder, APP.A, { note: 'Greeting' })
    expect(published.version).toBe(2)
    const after = await runUiRead(member, { name: 'apps.page', args: { app: 'desk', page: 'home' } })
    expect(after.ok && (after.data as any).page.layout.widgets[0].config.text).toBe('Draft hello')
    const { data } = await as(U.member).from('app_versions').select('version').eq('app_id', APP.A)
    expect((data as any[]).map((r) => r.version)).toEqual([2])
    expect((await selectIds(U.builder, 'app_versions', 'version')).sort()).toEqual([1, 2])
    await db.query('RESET ROLE')
    const { rows } = await db.query('SELECT published_version, has_draft_changes, published_by FROM public.apps WHERE id = $1', [APP.A])
    expect(rows[0]).toEqual({ published_version: 2, has_draft_changes: false, published_by: U.builder })
  })

  it('an app created after the migration stays invisible to its audience until published', async () => {
    const builder = ctx(U.builder, TENANT.A, BUILDER_PERMS)
    const created = await appsService.createApp(builder, { name: 'Fresh desk', audience: [{ type: 'team', id: TEAM }] })
    const member = ctx(U.member, TENANT.A, MEMBER_PERMS)
    expect(await runUiRead(member, { name: 'apps.page', args: { app: created.slug } })).toMatchObject({ ok: false, status: 404 })
    expect(await selectIds(U.member, 'app_versions', 'app_id')).not.toContain(created.id)
    await versions.publishApp(builder, created.id)
    expect(await selectIds(U.member, 'app_versions', 'app_id')).toContain(created.id)
    // Discard on the published app writes version 1 back; restore copies a version into the draft.
    await appsService.updateApp(builder, created.id, { name: 'Renamed draft' })
    await versions.discardAppDraft(builder, created.id)
    expect((await appsService.getApp(builder, created.id)).name).toBe('Fresh desk')
  })
})
