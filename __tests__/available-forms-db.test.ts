/**
 * "Available forms" against a LOCAL Supabase stack (migration
 * 20261209000000_available_forms.sql): who sees which form in the sidebar
 * Forms menu (list_available_forms + lib/services/forms listAvailableForms).
 *
 * A form is listed only when it is marked available AND the person holds
 * forms.submit in the workspace AND an explicit grant on the form names
 * them, a team they belong to or a role they hold:
 *  - direct user grant, team grant, role grant (Submit only) → listed;
 *  - no grant, an unchecked form, a grant with neither View nor Submit,
 *    a role without forms.submit → not listed;
 *  - an Admin with no explicit grant sees nothing (workspace rights alone
 *    never list a form);
 *  - another workspace's forms never leak (wrong tenant, cross-tenant grant
 *    rows, signed-in callers asking for another tenant or another person);
 *  - anon cannot call the function;
 *  - results are alphabetical (case-insensitive, locale-aware);
 *  - the setting survives a content change (new version) and does not
 *    create one itself, and it travels through config export → apply.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/available-forms-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import * as forms from '@/lib/services/forms'
import { applyConfig, exportConfig } from '@/lib/services/config'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `af0af000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
// Users get a personal workspace whose slug is the first 8 characters of their id: keep those distinct.
const uid = (n: number) => `af${n.toString(16).padStart(6, '0')}-0000-4000-8000-0000000000af`
const A = id(0xa)
const B = id(0xb)
const C = id(0xc)
const DIRECT = uid(0x101)
const TEAMER = uid(0x102)
const ROLER = uid(0x103)
const ADMIN = uid(0x104)
const NOSUBMIT = uid(0x105)
const OUTSIDER = uid(0x106)
const MANY = uid(0x107)
const USERS = [DIRECT, TEAMER, ROLER, ADMIN, NOSUBMIT, OUTSIDER, MANY]
const TEAM = id(0x201)
const APPROVERS = id(0x301)
const NO_SUBMIT_ROLE = id(0x302)
const F = {
  direct: id(0x401), team: id(0x402), role: id(0x403), hidden: id(0x404), noflags: id(0x405), open: id(0x406), other: id(0x407),
}
const MANY_NAMES = ['zebra', 'Apple', 'banana', 'Éclair', 'eagle', 'Form 10', 'Form 2', 'cherry', 'Delta', 'fig', 'grape', 'Honeydew']
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

describe.skipIf(!DB_URL)('available forms (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (tenantId: string, actorId: string | null, permissions: string[] | null = ['forms.view', 'forms.edit', 'forms.submit']): ServiceContext =>
    ({ supabase: admin, tenantId, actorId, permissions: permissions ? new Set(permissions) : null, authKind: 'session', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  const manyIds: string[] = []

  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows

  /** list_available_forms as the database superuser (no auth.uid(): the service's path). */
  const menu = async (tenant: string, user: string) =>
    (await q('SELECT id, name FROM public.list_available_forms($1, $2)', [tenant, user])).map((r: any) => r.name as string)

  /** Run SQL as a role with JWT claims (signed-in user / anon), rolled back. */
  async function as(role: 'authenticated' | 'anon', user: string | null, sql: string, params: unknown[] = []) {
    await db.query('BEGIN')
    try {
      await db.query(`SET LOCAL ROLE ${role}`)
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(user ? { sub: user, role } : { role })])
      return { rows: (await db.query(sql, params)).rows as any[], error: null as null | { code?: string } }
    } catch (e) {
      return { rows: [] as any[], error: e as { code?: string } }
    } finally {
      await db.query('ROLLBACK')
    }
  }

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS])).map((r: any) => r.tenant_id)
    for (const t of [A, B, C]) {
      for (const table of ['object_permissions', 'form_versions', 'forms', 'user_teams', 'object_audit_log', 'github_sync_queue', 'github_sync_asset_map']) {
        if (table === 'user_teams') await db.query('DELETE FROM public.user_teams WHERE team_id IN (SELECT id FROM public.teams WHERE tenant_id = $1)', [t]).catch(() => undefined)
        else await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, B, C, ...personal.filter((t: string | null) => t && ![A, B, C].includes(t))]])
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Avail A', 'avail-a-test'), ($2, 'Avail B', 'avail-b-test'), ($3, 'Avail C', 'avail-c-test')`, [A, B, C])
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `u${user.slice(-3)}.${Date.now().toString(36)}@avail.test`])
    }
    const home = (user: string) => (user === OUTSIDER ? B : A)
    for (const user of USERS) {
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, home(user)])
      await q('UPDATE public.users SET current_tenant_id = $2 WHERE id = $1', [user, home(user)])
    }
    // Roles: the seeded Member / Admin (both hold forms.submit), plus two custom ones.
    const roleId = async (tenant: string, slug: string) => (await q('SELECT id FROM public.roles WHERE tenant_id = $1 AND slug = $2', [tenant, slug]))[0].id as string
    const member = await roleId(A, 'member')
    await q(`INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $3, 'Approvers', 'approvers-avail', '{forms.submit}'), ($2, $3, 'No submit', 'no-submit-avail', '{forms.view}')`, [APPROVERS, NO_SUBMIT_ROLE, A])
    const grantRole = (user: string, tenant: string, role: string) => q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [tenant, user, role])
    for (const user of [DIRECT, TEAMER, MANY]) await grantRole(user, A, member)
    await grantRole(ROLER, A, APPROVERS)
    await grantRole(ADMIN, A, await roleId(A, 'admin'))
    await grantRole(NOSUBMIT, A, NO_SUBMIT_ROLE)
    await grantRole(OUTSIDER, B, await roleId(B, 'member'))
    await q(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, 'Field crew')`, [TEAM, A])
    await q('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2)', [TEAMER, TEAM])

    const form = (fid: string, tenant: string, name: string, available: boolean) =>
      q(`INSERT INTO public.forms (id, tenant_id, name, fields, available_in_menu) VALUES ($1, $2, $3, '[{"key":"note","label":"Note","type":"text"}]', $4)`, [fid, tenant, name, available])
    await form(F.direct, A, 'beta direct', true)
    await form(F.team, A, 'Alpha team', true)
    await form(F.role, A, 'gamma role', true)
    await form(F.hidden, A, 'Hidden (not available)', false)
    await form(F.noflags, A, 'No flags', true)
    await form(F.open, A, 'Open to everyone', true)
    await form(F.other, B, 'Other workspace form', true)
    const grant = (tenant: string, fid: string, who: { user_id?: string; team_id?: string; role_id?: string }, view = true, execute = true) =>
      q(`INSERT INTO public.object_permissions (tenant_id, object_type, object_id, user_id, team_id, role_id, can_view, can_edit, can_delete, can_execute)
         VALUES ($1, 'form', $2, $3, $4, $5, $6, false, false, $7)`, [tenant, fid, who.user_id ?? null, who.team_id ?? null, who.role_id ?? null, view, execute])
    await grant(A, F.direct, { user_id: DIRECT })
    await grant(A, F.direct, { user_id: NOSUBMIT })
    await grant(A, F.team, { team_id: TEAM })
    await grant(A, F.role, { role_id: APPROVERS }, false, true)
    await grant(A, F.hidden, { user_id: DIRECT })
    await grant(A, F.noflags, { user_id: DIRECT }, false, false)
    await grant(B, F.other, { user_id: OUTSIDER })
    // A tenant-A grant row pointing at tenant B's form must not leak it.
    await grant(A, F.other, { user_id: DIRECT })
    // Workflow grants are not form grants.
    await q(`INSERT INTO public.object_permissions (tenant_id, object_type, object_id, user_id, can_view, can_execute) VALUES ($1, 'workflow', $2, $3, true, true)`, [A, F.open, DIRECT])

    for (const [i, name] of MANY_NAMES.entries()) {
      const fid = id(0x500 + i)
      manyIds.push(fid)
      await form(fid, A, name, true)
      await grant(A, fid, { user_id: MANY })
    }
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  it('lists a form granted directly to the person', async () => {
    expect(await menu(A, DIRECT)).toEqual(['beta direct'])
  })

  it('lists a form granted to a team the person belongs to', async () => {
    expect(await menu(A, TEAMER)).toEqual(['Alpha team'])
  })

  it('lists a form granted to a role the person holds (Submit alone counts)', async () => {
    expect(await menu(A, ROLER)).toEqual(['gamma role'])
  })

  it('never lists an unchecked form, a grant with neither View nor Submit, an ungranted form or another object type', async () => {
    const names = await menu(A, DIRECT)
    expect(names).not.toContain('Hidden (not available)')
    expect(names).not.toContain('No flags')
    expect(names).not.toContain('Open to everyone')
  })

  it('an Admin without an explicit grant sees nothing (workspace rights alone do not count)', async () => {
    expect(await menu(A, ADMIN)).toEqual([])
    expect(await forms.listAvailableForms(ctx(A, ADMIN, null))).toEqual([])
  })

  it('a granted person without forms.submit sees nothing', async () => {
    expect(await menu(A, NOSUBMIT)).toEqual([])
  })

  it('never leaks another workspace’s forms', async () => {
    expect(await menu(B, OUTSIDER)).toEqual(['Other workspace form'])
    expect(await menu(A, OUTSIDER)).toEqual([])
    expect(await menu(B, DIRECT)).toEqual([])
    // The cross-tenant grant row in A does not surface B's form in A.
    expect((await q('SELECT id FROM public.list_available_forms($1, $2)', [A, DIRECT])).map((r: any) => r.id)).not.toContain(F.other)
  })

  it('signed-in callers get their own menu only, in their current workspace; anon cannot call it', async () => {
    const own = await as('authenticated', DIRECT, 'SELECT name FROM public.list_available_forms($1, $2)', [A, DIRECT])
    expect(own.error).toBeNull()
    expect(own.rows.map((r) => r.name)).toEqual(['beta direct'])
    const someoneElse = await as('authenticated', DIRECT, 'SELECT name FROM public.list_available_forms($1, $2)', [A, TEAMER])
    expect(someoneElse.rows).toEqual([])
    const otherTenant = await as('authenticated', OUTSIDER, 'SELECT name FROM public.list_available_forms($1, $2)', [A, OUTSIDER])
    expect(otherTenant.rows).toEqual([])
    const anon = await as('anon', null, 'SELECT name FROM public.list_available_forms($1, $2)', [A, DIRECT])
    expect(anon.error?.code).toBe('42501')
  })

  it('the service: the caller’s own menu; nothing without forms.submit or an acting user', async () => {
    expect((await forms.listAvailableForms(ctx(A, DIRECT))).map((f) => f.id)).toEqual([F.direct])
    expect((await forms.listAvailableForms(ctx(A, TEAMER))).map((f) => f.name)).toEqual(['Alpha team'])
    expect(await forms.listAvailableForms(ctx(A, DIRECT, ['forms.view']))).toEqual([])
    expect(await forms.listAvailableForms(ctx(A, null))).toEqual([])
    expect(await forms.listAvailableForms(ctx(B, DIRECT))).toEqual([])
  })

  it('the service leaves out a form that needs a parameter to open (required, no default); a default brings it back', async () => {
    const [{ layout }] = await q('SELECT layout FROM public.forms WHERE id = $1', [F.direct])
    try {
      await q('UPDATE public.forms SET layout = $2 WHERE id = $1', [F.direct, { rows: [], params: [{ name: 'customer', type: 'text', source: 'url', required: true }] }])
      expect(await menu(A, DIRECT)).toEqual(['beta direct'])
      expect(await forms.listAvailableForms(ctx(A, DIRECT))).toEqual([])
      await q('UPDATE public.forms SET layout = $2 WHERE id = $1', [F.direct, { rows: [], params: [{ name: 'customer', type: 'text', source: 'url', required: true, default: 'ALFKI' }] }])
      expect((await forms.listAvailableForms(ctx(A, DIRECT))).map((f) => f.id)).toEqual([F.direct])
    } finally {
      await q('UPDATE public.forms SET layout = $2 WHERE id = $1', [F.direct, layout])
    }
  })

  it('sorts alphabetically: case-insensitive in SQL, locale-aware in the service; more than 10 forms', async () => {
    const sql = await menu(A, MANY)
    expect(sql).toHaveLength(MANY_NAMES.length)
    expect(sql.slice(0, 3)).toEqual(['Apple', 'banana', 'cherry'])
    const service = (await forms.listAvailableForms(ctx(A, MANY))).map((f) => f.name)
    expect(service).toEqual(['Apple', 'banana', 'cherry', 'Delta', 'eagle', 'Éclair', 'fig', 'Form 2', 'Form 10', 'grape', 'Honeydew', 'zebra'])
    expect(service.length).toBeGreaterThan(10)
  })

  it('a form can be shared with several people, teams and roles, each once', async () => {
    // F.direct holds two user grants (DIRECT, NOSUBMIT); add a team and a role grant too.
    await q(`INSERT INTO public.object_permissions (tenant_id, object_type, object_id, team_id, can_view) VALUES ($1, 'form', $2, $3, true)`, [A, F.direct, TEAM])
    await q(`INSERT INTO public.object_permissions (tenant_id, object_type, object_id, role_id, can_view) VALUES ($1, 'form', $2, $3, true)`, [A, F.direct, APPROVERS])
    expect((await q(`SELECT count(*)::int AS n FROM public.object_permissions WHERE object_type = 'form' AND object_id = $1`, [F.direct]))[0].n).toBe(4)
    await expect(q(`INSERT INTO public.object_permissions (tenant_id, object_type, object_id, user_id, can_view) VALUES ($1, 'form', $2, $3, true)`, [A, F.direct, DIRECT]))
      .rejects.toMatchObject({ code: '23505' })
    expect(await menu(A, TEAMER)).toEqual(['Alpha team', 'beta direct'])
    expect(await menu(A, ROLER)).toEqual(['beta direct', 'gamma role'])
    await q(`DELETE FROM public.object_permissions WHERE object_id = $1 AND (team_id IS NOT NULL OR role_id IS NOT NULL)`, [F.direct])
  })

  it('uses the partial index for available forms', async () => {
    const { rows } = await db.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_forms_available_in_menu'`)
    expect(rows[0]?.indexdef).toMatch(/WHERE available_in_menu/)
  })

  it('the setting is not versioned, survives a new version and travels through export → apply', async () => {
    const created = await forms.createForm(ctx(A, null), { name: 'Travel request', fields: [{ key: 'where', label: 'Where', type: 'text' }], available_in_menu: true }, { capture: false })
    expect(created.available_in_menu).toBe(true)
    expect(created.version).toBe(1)
    const bumped = await forms.updateForm(ctx(A, null), created.id, { fields: [{ key: 'where', label: 'Where to', type: 'text' }] }, { capture: false })
    expect(bumped).toMatchObject({ version: 2, available_in_menu: true, version_changed: true })
    const off = await forms.updateForm(ctx(A, null), created.id, { available_in_menu: false }, { capture: false })
    expect(off).toMatchObject({ version: 2, available_in_menu: false, version_changed: false })
    await expect(forms.updateForm(ctx(A, null), created.id, { available_in_menu: 'yes' as any })).rejects.toMatchObject({ status: 400 })
    await forms.updateForm(ctx(A, null), created.id, { available_in_menu: true }, { capture: false })
    expect((await forms.listForms(ctx(A, null), { search: 'Travel request' }, { limit: 10, offset: 0 })).forms[0]).toMatchObject({ available_in_menu: true })

    const manifest = (await exportConfig(ctx(A, null), { ids: [created.id], format: 'manifest' })).manifest!
    expect(manifest.forms[0]).toMatchObject({ name: 'Travel request', available_in_menu: true })
    const applied = await applyConfig(ctx(C, null), { manifest })
    expect(applied.result?.errors ?? []).toEqual([])
    const local = applied.id_map!.form[created.id]
    expect((await q('SELECT available_in_menu FROM public.forms WHERE id = $1 AND tenant_id = $2', [local, C]))[0]).toEqual({ available_in_menu: true })
    // Grants never travel: nobody in C has the form in their menu until someone is given access.
    expect(await q(`SELECT 1 FROM public.object_permissions WHERE tenant_id = $1 AND object_type = 'form'`, [C])).toEqual([])
  })
})
