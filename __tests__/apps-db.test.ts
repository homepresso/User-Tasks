/**
 * Apps against the real schema and RLS (migration 20270120090000_apps,
 * applied inside this test's transaction and rolled back):
 *
 *  - public.app_access and the SELECT policies: an audience member (through
 *    a team) reads the app and its pages but not its audience / editors; a
 *    member outside the audience reads nothing; another workspace's user
 *    never sees it, and an app of another workspace that names our user in
 *    its audience stays invisible to them; builders read the audience.
 *  - the session client can't write any app table (writes go through the
 *    service);
 *  - the dashboard reads (apps.mine, apps.page, apps.widget) run as the
 *    signed-in viewer: a task list widget shows the viewer's tasks only, and
 *    a non-audience member gets "not found" for the app's widgets.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/apps-db.test.ts
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
const appsService = await import('@/lib/services/apps')

const { runUiRead } = await import('@/lib/services/ui-reads')

const DB_URL = process.env.EVENT_STREAM_DB_URL
const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270120090000_apps.sql'), 'utf8')
// App drafts (20270123090000): applied after the fixture rows, so its backfill publishes the app as version 1.
const DRAFTS_MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270123090000_app_drafts.sql'), 'utf8')

function uid(key: string): string {
  const h = createHash('md5').update(`apps-db:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const TENANT = { A: uid('tenant:A'), B: uid('tenant:B') }
const U = { builder: uid('u:builder'), member: uid('u:member'), outsider: uid('u:outsider'), other: uid('u:other') }
const ROLE = { build: uid('role:build'), use: uid('role:use'), bOwner: uid('role:b') }
const TEAM = uid('team:claims')
const APP = { A: uid('app:A'), B: uid('app:B') }
const PAGE_A = uid('page:A')
const FORM = { A: uid('form:A'), B: uid('form:B') }

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

describe.skipIf(!DB_URL)('apps (local DB, RLS)', () => {
  const db = new Client({ connectionString: DB_URL })
  let pgq: ReturnType<typeof createPgQuery>
  const as = (user: string) => pgq.client({ role: 'authenticated', claims: { sub: user, role: 'authenticated', aud: 'authenticated' } }) as any
  const ctx = (user: string, tenant: string, perms: string[]): ServiceContext => {
    const client = as(user)
    return { db: client, supabase: client, tenantId: tenant, actorId: user, permissions: new Set(perms), authKind: 'session', source: 'ui' }
  }
  const MEMBER_PERMS = ['apps.view', 'tasks.view_own', 'tasks.complete', 'forms.submit']

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(MIGRATION)
    for (const k of ['A', 'B'] as const) {
      await db.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)', [TENANT[k], `apps ${k}`, `apps-db-${k.toLowerCase()}`])
    }
    const people: Array<[string, 'A' | 'B']> = [[U.builder, 'A'], [U.member, 'A'], [U.outsider, 'A'], [U.other, 'B']]
    for (const [user, k] of people) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [user, `${user.slice(0, 8)}@apps-db.test`])
      await db.query('DELETE FROM public.user_memberships WHERE user_id = $1', [user])
      await db.query('DELETE FROM public.user_roles WHERE user_id = $1', [user])
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [user, TENANT[k]])
      await db.query('INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home) VALUES ($1, $2, $3, true)', [user, TENANT[k], 'member'])
    }
    await db.query('INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $9), ($10, $11, $12, $13, $5)', [
      ROLE.build, TENANT.A, 'App builders', 'apps-db-build', ['apps.view', 'apps.manage', 'tasks.view_all'],
      ROLE.use, 'App users', 'apps-db-use', ['apps.view', 'tasks.view_own', 'tasks.complete', 'forms.submit'],
      ROLE.bOwner, TENANT.B, 'B builders', 'apps-db-b',
    ])
    await db.query('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3), ($1, $4, $5), ($1, $6, $5), ($7, $8, $9)', [
      TENANT.A, U.builder, ROLE.build, U.member, ROLE.use, U.outsider, TENANT.B, U.other, ROLE.bOwner,
    ])
    await db.query('INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, $3)', [TEAM, TENANT.A, 'Claims'])
    await db.query('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2)', [U.member, TEAM])
    await db.query(`INSERT INTO public.apps (id, tenant_id, slug, name, created_by) VALUES ($1, $2, 'claims', 'Claims', $3), ($4, $5, 'claims', 'B claims', $6)`, [APP.A, TENANT.A, U.builder, APP.B, TENANT.B, U.other])
    await db.query(`INSERT INTO public.forms (id, tenant_id, name, created_by) VALUES ($1, $2, 'Expense claim', $3), ($4, $5, 'B form', $6)`, [FORM.A, TENANT.A, U.builder, FORM.B, TENANT.B, U.other])
    const layout = { widgets: [
      { id: 'tasks-1', type: 'task_list', w: 6, h: 8, config: { scope: 'all', status: 'open', limit: 20 } },
      { id: 'btns', type: 'actions', w: 12, h: 2, config: { buttons: [{ label: 'New claim', action: { kind: 'new_submission', form_id: FORM.A, open: 'modal' } }] } },
      // Another workspace's form id: never usable here, never grantable from here.
      { id: 'btns-b', type: 'actions', w: 12, h: 2, config: { buttons: [{ label: 'B form', action: { kind: 'new_submission', form_id: FORM.B, open: 'modal' } }] } },
    ] }
    await db.query(`INSERT INTO public.app_pages (id, tenant_id, app_id, slug, title, layout) VALUES ($1, $2, $3, 'home', 'Home', $4)`, [PAGE_A, TENANT.A, APP.A, JSON.stringify(layout)])
    // tenant_id is taken from the app by the trigger (the value given here is ignored).
    await db.query(`INSERT INTO public.app_audience (tenant_id, app_id, principal_type, principal_id, app_role) VALUES ($1, $2, 'team', $3, 'contributor')`, [TENANT.B, APP.A, TEAM])
    // Workspace B's app names our member: it must still never reach them.
    await db.query(`INSERT INTO public.app_audience (tenant_id, app_id, principal_type, principal_id) VALUES ($1, $2, 'user', $3)`, [TENANT.B, APP.B, U.member])
    await db.query('INSERT INTO public.app_editors (tenant_id, app_id, user_id) VALUES ($1, $2, $3)', [TENANT.A, APP.A, U.builder])
    for (const [title, assignee] of [['APPSDB member task', U.member], ['APPSDB outsider task', U.outsider]] as const) {
      await db.query(`INSERT INTO public.tasks (tenant_id, title, assignee_id, assigner_id, status) VALUES ($1, $2, $3, $4, 'todo')`, [TENANT.A, title, assignee, U.builder])
    }
    await db.query(DRAFTS_MIGRATION)
    pgq = createPgQuery({ pool: savepointPool(db), maxRows: 1000 })
    serviceClient = pgq.client({ role: 'service_role', claims: { role: 'service_role' } })
  }, 60_000)

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  const selectIds = async (user: string, table: string) => {
    const { data, error } = await as(user).from(table).select('id')
    if (error) throw new Error(error.message)
    return ((data ?? []) as any[]).map((r) => r.id)
  }

  it('child rows carry their app’s workspace', async () => {
    const { rows } = await db.query('SELECT DISTINCT tenant_id FROM public.app_audience WHERE app_id = $1', [APP.A])
    expect(rows.map((r) => r.tenant_id)).toEqual([TENANT.A])
  })

  it('app_access: edit for builders, view for the audience, nothing for others', async () => {
    const access = async (user: string, app: string) => {
      const { data, error } = await as(user).rpc('app_access', { p_app_id: app })
      if (error) throw new Error(error.message)
      return data
    }
    expect(await access(U.builder, APP.A)).toBe('edit')
    expect(await access(U.member, APP.A)).toBe('view')
    expect(await access(U.outsider, APP.A)).toBeNull()
    expect(await access(U.other, APP.A)).toBeNull()
    expect(await access(U.member, APP.B)).toBeNull()
    expect(await access(U.other, APP.B)).toBe('edit')
  })

  it('RLS: the audience reads the published version, not the draft rows nor who else it is shared with; others read nothing', async () => {
    // Since app drafts (20270123090000) the apps / app_pages rows are the draft: editors only.
    expect(await selectIds(U.member, 'apps')).toEqual([])
    expect(await selectIds(U.member, 'app_pages')).toEqual([])
    expect((await selectIds(U.member, 'app_versions')).length).toBe(1)
    expect(await selectIds(U.builder, 'apps')).toEqual([APP.A])
    expect(await selectIds(U.builder, 'app_pages')).toEqual([PAGE_A])
    expect(await selectIds(U.member, 'app_audience')).toEqual([])
    expect(await selectIds(U.member, 'app_editors')).toEqual([])
    expect(await selectIds(U.outsider, 'apps')).toEqual([])
    expect(await selectIds(U.outsider, 'app_pages')).toEqual([])
    expect(await selectIds(U.other, 'apps')).toEqual([APP.B])
    expect((await selectIds(U.builder, 'app_audience')).length).toBe(1)
  })

  it('the session client can’t write app tables', async () => {
    const res = await as(U.builder).from('apps').insert({ tenant_id: TENANT.A, slug: 'sneaky', name: 'Sneaky' })
    expect(res.error).toBeTruthy()
    const upd = await as(U.builder).from('app_pages').update({ title: 'Changed' }).eq('id', PAGE_A)
    expect(upd.error || !(upd.data ?? []).length).toBeTruthy()
    const { rows } = await db.query('SELECT title FROM public.app_pages WHERE id = $1', [PAGE_A])
    expect(rows[0].title).toBe('Home')
  })

  it('dashboard reads run as the viewer: apps.mine, apps.page and a task list widget', async () => {
    const member = ctx(U.member, TENANT.A, MEMBER_PERMS)
    const mine = await runUiRead(member, { name: 'apps.mine', args: {} })
    expect(mine.ok && (mine.data as any[]).map((a) => a.id)).toEqual([APP.A])
    const view = await runUiRead(member, { name: 'apps.page', args: { app: 'claims', page: 'home' } })
    expect(view.ok && (view.data as any).page.id).toBe(PAGE_A)
    const widget = await runUiRead(member, { name: 'apps.widget', args: { app: APP.A, page: PAGE_A, widget_id: 'tasks-1' } })
    expect(widget.ok).toBe(true)
    const titles = ((widget as any).data.tasks as any[]).map((t) => t.title)
    expect(titles).toContain('APPSDB member task')
    expect(titles).not.toContain('APPSDB outsider task')
  })

  it('a member outside the audience gets not found for the app and its widgets', async () => {
    const outsider = ctx(U.outsider, TENANT.A, MEMBER_PERMS)
    expect(await runUiRead(outsider, { name: 'apps.mine', args: {} })).toEqual({ ok: true, data: [] })
    expect(await runUiRead(outsider, { name: 'apps.page', args: { app: 'claims' } })).toMatchObject({ ok: false, status: 404 })
    expect(await runUiRead(outsider, { name: 'apps.widget', args: { app: APP.A, page: PAGE_A, widget_id: 'tasks-1' } })).toMatchObject({ ok: false, status: 404 })
    // Another workspace's user, even naming A's app id directly.
    const other = ctx(U.other, TENANT.B, MEMBER_PERMS)
    expect(await runUiRead(other, { name: 'apps.widget', args: { app: APP.A, page: PAGE_A, widget_id: 'tasks-1' } })).toMatchObject({ ok: false, status: 404 })
  })

  describe('apps and permissions', () => {
    const BUILDER_PERMS = ['apps.view', 'apps.manage', 'tasks.view_all']
    const buttons = (view: any) => (view.page.layout.widgets as any[]).filter((w) => w.type === 'actions').flatMap((w) => w.config.buttons.map((b: any) => b.label))

    it('a contributor without a grant on the form gets no button, and its widget is not found', async () => {
      const member = ctx(U.member, TENANT.A, MEMBER_PERMS)
      const view = await runUiRead(member, { name: 'apps.page', args: { app: 'claims', page: 'home' } })
      expect(view.ok && buttons(view.data)).toEqual([])
      expect(JSON.stringify(view)).not.toContain(FORM.A)
      expect(await runUiRead(member, { name: 'apps.widget', args: { app: APP.A, page: PAGE_A, widget_id: 'btns' } })).toMatchObject({ ok: false, status: 404 })
    })

    it('the access analysis finds the gap; only a designer who can manage roles may grant it', async () => {
      const without = await appsService.getAppAccessAnalysis(ctx(U.builder, TENANT.A, BUILDER_PERMS), APP.A)
      const gap = without.gaps.find((g) => g.object.id === FORM.A)!
      expect(gap).toMatchObject({ principal: { type: 'team', id: TEAM, role: 'contributor' }, need: 'submit', missing: 'grant', affected: 1, total: 1, fix: { kind: 'grant', can_grant: false } })
      expect(gap.message).toMatch(/Team Claims.*can’t submit form “Expense claim”/)
      // The other workspace's form is "no longer exists" here: nothing to grant.
      expect(without.gaps.find((g) => g.object.id === FORM.B)).toMatchObject({ missing: 'object', fix: { kind: 'ask' } })
      expect(without.grantable).toBe(0)
      await expect(appsService.grantAppAccess(ctx(U.builder, TENANT.A, BUILDER_PERMS), APP.A, 'all')).rejects.toMatchObject({ code: 'forbidden' })
      // A viewer of the app can't run the analysis at all.
      expect(await runUiRead(ctx(U.member, TENANT.A, MEMBER_PERMS), { name: 'apps.access', args: { app: APP.A } })).toMatchObject({ ok: false, status: 403 })
    })

    it('granting applies the minimal form grant through object permissions, audited; the member then sees the button', async () => {
      vi.mocked(writeAudit).mockClear()
      // Manage roles in the database too: object_permissions writes are gated on it by RLS as well.
      await db.query(`UPDATE public.roles SET permissions = permissions || ARRAY['team.change_roles'] WHERE id = $1`, [ROLE.build])
      const designer = ctx(U.builder, TENANT.A, [...BUILDER_PERMS, 'team.change_roles'])
      const result = await appsService.grantAppAccess(designer, APP.A, 'all')
      expect(result.granted).toBe(1)
      const { rows } = await db.query(`SELECT tenant_id, team_id, can_view, can_execute, can_edit FROM public.object_permissions WHERE object_type = 'form' AND object_id = $1`, [FORM.A])
      expect(rows).toEqual([{ tenant_id: TENANT.A, team_id: TEAM, can_view: true, can_execute: true, can_edit: false }])
      const { rows: foreign } = await db.query(`SELECT count(*)::int AS n FROM public.object_permissions WHERE object_id = $1`, [FORM.B])
      expect(foreign[0].n).toBe(0)
      expect(vi.mocked(writeAudit).mock.calls.some(([p]: any[]) => p.action === 'grant' && p.objectType === 'form' && p.objectId === FORM.A)).toBe(true)
      expect(result.analysis.gaps.some((g) => g.object.id === FORM.A)).toBe(false)
      const view = await runUiRead(ctx(U.member, TENANT.A, MEMBER_PERMS), { name: 'apps.page', args: { app: 'claims', page: 'home' } })
      expect(view.ok && buttons(view.data)).toEqual(['New claim'])
      // Still nothing for someone outside the audience, grant or not.
      expect(await runUiRead(ctx(U.outsider, TENANT.A, MEMBER_PERMS), { name: 'apps.page', args: { app: 'claims' } })).toMatchObject({ ok: false, status: 404 })
    })

    it('a viewer entry (read-only) gets no action buttons even with the grant', async () => {
      await db.query(`UPDATE public.app_audience SET app_role = 'viewer' WHERE app_id = $1`, [APP.A])
      const view = await runUiRead(ctx(U.member, TENANT.A, MEMBER_PERMS), { name: 'apps.page', args: { app: 'claims', page: 'home' } })
      expect(view.ok && buttons(view.data)).toEqual([])
      await db.query(`UPDATE public.app_audience SET app_role = 'contributor' WHERE app_id = $1`, [APP.A])
    })
  })
})
