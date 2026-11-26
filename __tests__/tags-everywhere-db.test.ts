/**
 * Tags on every object type against the real schema and RLS (migration
 * 20270122150000_tags_everywhere, applied inside this test's transaction and
 * rolled back):
 *
 *  - each new table has `tags text[] NOT NULL DEFAULT '{}'` and a GIN index;
 *    rows inserted without tags read as {};
 *  - tag_usage / tag_objects (SECURITY INVOKER) count and list data tables,
 *    reports, business rules, email templates, form controls and apps — only
 *    what the caller's RLS shows (a colleague's private report stays hidden,
 *    an app needs the caller's access, nothing of another workspace) — and
 *    leave authored packages to the service (no client grant);
 *  - rename_tag / remove_tag stay service-role only and reach every new type,
 *    packages included, in one workspace only; the old types keep working.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/tags-everywhere-db.test.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const STYLES = readFileSync(join(process.cwd(), 'supabase/migrations/20270121150000_tag_styles.sql'), 'utf8')
const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270122150000_tags_everywhere.sql'), 'utf8')
// App tags for an app's audience (published apps only), on top of the above.
const AUDIENCE = readFileSync(join(process.cwd(), 'supabase/migrations/20270130150000_app_tags_audience.sql'), 'utf8')

function uid(key: string): string {
  const h = createHash('md5').update(`tags-everywhere-db:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const TENANT = { A: uid('tenant:A'), B: uid('tenant:B') }
const U = { builder: uid('u:builder'), viewer: uid('u:viewer'), other: uid('u:other') }
const ROLE = { builder: uid('role:builder'), viewer: uid('role:viewer'), other: uid('role:other') }
const APP = { open: uid('app:open'), hidden: uid('app:hidden'), b: uid('app:b'), unpublished: uid('app:unpublished') }
const NEW_TABLES = ['custom_tables', 'reports', 'decision_tables', 'email_templates', 'form_controls', 'apps', 'packages']
const BUILDER_PERMS = ['data.view', 'reports.view', 'workflows.view', 'extensibility.view', 'apps.view', 'packages.view']

describe.skipIf(!DB_URL)('tags on every object type (local DB, RLS)', () => {
  const db = new Client({ connectionString: DB_URL })

  /** Run one statement as a user inside a savepoint; errors come back instead of aborting the transaction. */
  async function as(user: string, sql: string, params: unknown[] = []): Promise<{ rows: any[]; error: string | null }> {
    await db.query('SAVEPOINT q')
    try {
      await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`, [JSON.stringify({ sub: user, role: 'authenticated', aud: 'authenticated' })])
      await db.query('SET LOCAL ROLE authenticated')
      const { rows } = await db.query(sql, params)
      await db.query('RESET ROLE')
      await db.query('RELEASE SAVEPOINT q')
      return { rows, error: null }
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT q')
      await db.query('RELEASE SAVEPOINT q')
      await db.query('RESET ROLE')
      return { rows: [], error: (error as Error).message }
    }
  }

  const usage = async (user: string, tenant = TENANT.A) => {
    const { rows, error } = await as(user, 'SELECT name_key, object_type, uses::int AS uses FROM public.tag_usage($1) ORDER BY object_type, name_key', [tenant])
    expect(error).toBeNull()
    return Object.fromEntries(rows.map((r) => [`${r.object_type}:${r.name_key}`, r.uses]))
  }

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(STYLES)
    await db.query(MIGRATION)
    await db.query(AUDIENCE)
    for (const k of ['A', 'B'] as const) {
      await db.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)', [TENANT[k], `tags everywhere ${k}`, `tags-everywhere-db-${k.toLowerCase()}`])
    }
    const people: Array<[string, 'A' | 'B']> = [[U.builder, 'A'], [U.viewer, 'A'], [U.other, 'B']]
    for (const [user, k] of people) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [user, `${user.slice(0, 8)}@tags-everywhere-db.test`])
      await db.query('DELETE FROM public.user_memberships WHERE user_id = $1', [user])
      await db.query('DELETE FROM public.user_roles WHERE user_id = $1', [user])
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [user, TENANT[k]])
      await db.query('INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home) VALUES ($1, $2, $3, true)', [user, TENANT[k], 'member'])
    }
    await db.query('INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $9), ($10, $11, $12, $13, $5)', [
      ROLE.builder, TENANT.A, 'Builders', 'tags-everywhere-db-builder', BUILDER_PERMS,
      ROLE.viewer, 'Viewers', 'tags-everywhere-db-viewer', ['reports.view', 'apps.view'],
      ROLE.other, TENANT.B, 'B builders', 'tags-everywhere-db-other',
    ])
    await db.query('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3), ($1, $4, $5), ($6, $7, $8)', [
      TENANT.A, U.builder, ROLE.builder, U.viewer, ROLE.viewer, TENANT.B, U.other, ROLE.other,
    ])

    // Workspace A: one tagged object of each new type (plus an untagged data table), and the same in B.
    for (const [tenant, prefix, owner] of [[TENANT.A, 'a', U.builder], [TENANT.B, 'b', U.other]] as const) {
      await db.query(`INSERT INTO public.custom_tables (tenant_id, name, slug, columns, tags) VALUES ($1, 'Clients', $2, '[]', ARRAY['Finance','crm']), ($1, 'Plain', $3, '[]', DEFAULT)`, [tenant, `${prefix}-clients`, `${prefix}-plain`])
      await db.query(`INSERT INTO public.decision_tables (tenant_id, name, inputs, outputs, rules, tags) VALUES ($1, 'Routing', '[]', '[]', '[]', ARRAY['finance'])`, [tenant])
      await db.query(`INSERT INTO public.email_templates (tenant_id, name, subject, html_body, text_body, tags) VALUES ($1, 'Welcome', 'Hi', '<p>Hi</p>', 'Hi', ARRAY['Finance'])`, [tenant])
      await db.query(`INSERT INTO public.form_controls (tenant_id, tag, name, latest_version, tags) VALUES ($1, 'ut-rating', 'Rating', '1.0.0', ARRAY['FINANCE','survey'])`, [tenant])
      await db.query(`INSERT INTO public.packages (tenant_id, name, slug, tags) VALUES ($1, 'Invoices', 'invoices', ARRAY['Finance'])`, [tenant])
      await db.query(`INSERT INTO public.reports (tenant_id, created_by, name, config, is_shared, tags) VALUES ($1, $2, 'Mine', '{}', false, ARRAY['Finance'])`, [tenant, owner])
    }
    // A colleague's private and shared reports in A.
    await db.query(`INSERT INTO public.reports (tenant_id, created_by, name, config, is_shared, tags) VALUES ($1, $2, 'Shared', '{}', true, ARRAY['finance']), ($1, $2, 'Private', '{}', false, ARRAY['Finance'])`, [TENANT.A, U.viewer])
    // Apps: one the viewer is in the audience of, one hidden from them; the builder edits both (named editor).
    await db.query(`INSERT INTO public.apps (id, tenant_id, slug, name, tags) VALUES ($1, $3, 'open', 'Open app', ARRAY['Finance']), ($2, $3, 'hidden', 'Hidden app', ARRAY['Finance']), ($4, $5, 'b', 'B app', ARRAY['Finance'])`, [APP.open, APP.hidden, TENANT.A, APP.b, TENANT.B])
    await db.query(`INSERT INTO public.app_editors (tenant_id, app_id, user_id) VALUES ($1, $2, $3), ($1, $4, $3)`, [TENANT.A, APP.open, U.builder, APP.hidden])
    await db.query(`INSERT INTO public.app_audience (tenant_id, app_id, principal_type, principal_id, app_role) VALUES ($1, $2, 'user', $3, 'viewer')`, [TENANT.A, APP.open, U.viewer])
    // Published: open (under its published name; the draft has been renamed since), hidden and B's app.
    for (const [app, name] of [[APP.open, 'Open app'], [APP.hidden, 'Hidden app'], [APP.b, 'B app']] as const) {
      await db.query(`INSERT INTO public.app_versions (tenant_id, app_id, version, snapshot, summary) VALUES ($1, $2, 1, '{}', jsonb_build_object('name', $3::text))`, [TENANT.A, app, name])
      await db.query('UPDATE public.apps SET published_version = 1 WHERE id = $1', [app])
    }
    await db.query(`UPDATE public.apps SET name = 'Open app (unpublished rename)' WHERE id = $1`, [APP.open])
    // Shared with the viewer but never published: its audience sees nothing of it, tags included.
    await db.query(`INSERT INTO public.apps (id, tenant_id, slug, name, tags) VALUES ($1, $2, 'unpublished', 'Unpublished app', ARRAY['Finance'])`, [APP.unpublished, TENANT.A])
    await db.query(`INSERT INTO public.app_audience (tenant_id, app_id, principal_type, principal_id, app_role) VALUES ($1, $2, 'user', $3, 'viewer')`, [TENANT.A, APP.unpublished, U.viewer])
  })

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  it('adds tags text[] NOT NULL DEFAULT {} with a GIN index to every new table', async () => {
    const { rows } = await db.query(`SELECT table_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tags' AND table_name = ANY($1) ORDER BY table_name`, [NEW_TABLES])
    expect(rows.map((r) => r.table_name).sort()).toEqual([...NEW_TABLES].sort())
    for (const r of rows) {
      expect(r).toMatchObject({ data_type: 'ARRAY', is_nullable: 'NO' })
      expect(r.column_default).toMatch(/'\{\}'/)
    }
    const { rows: indexes } = await db.query(`SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1) AND indexdef ILIKE '%USING gin (tags)%'`, [NEW_TABLES])
    expect(indexes.map((i) => i.tablename).sort()).toEqual([...NEW_TABLES].sort())
    const { rows: plain } = await db.query(`SELECT tags FROM public.custom_tables WHERE tenant_id = $1 AND name = 'Plain'`, [TENANT.A])
    expect(plain[0].tags).toEqual([])
  })

  it('tag_usage counts every new type the caller can see, and never packages', async () => {
    const counts = await usage(U.builder)
    expect(counts).toMatchObject({
      'data_tables:finance': 1, 'data_tables:crm': 1,
      'business_rules:finance': 1,
      'email_templates:finance': 1,
      'form_controls:finance': 1, 'form_controls:survey': 1,
      // Own private report + the colleague's shared one; not their private one.
      'reports:finance': 2,
      // Named editor of both apps.
      'apps:finance': 2,
    })
    expect(Object.keys(counts).some((k) => k.startsWith('packages:'))).toBe(false)
  })

  it('a viewer counts only their own and shared reports, and only the published apps shared with them', async () => {
    const counts = await usage(U.viewer)
    expect(counts['reports:finance']).toBe(2) // their shared + private ones
    // The published app shared with them (20270130150000), not the hidden one
    // nor the unpublished one that names them.
    expect(counts['apps:finance']).toBe(1)
    const objects = await as(U.viewer, `SELECT name FROM public.tag_objects($1, 'FINANCE', 'reports', 20, 0) ORDER BY name`, [TENANT.A])
    expect(objects.rows.map((r) => r.name)).toEqual(['Private', 'Shared'])
    const builderReports = await as(U.builder, `SELECT name, total::int AS total FROM public.tag_objects($1, 'finance', 'reports', 20, 0) ORDER BY name`, [TENANT.A])
    expect(builderReports.rows).toEqual([{ name: 'Mine', total: 2 }, { name: 'Shared', total: 2 }])
    const apps = await as(U.viewer, `SELECT name FROM public.tag_objects($1, 'finance', 'apps', 20, 0)`, [TENANT.A])
    // Under its published name: an unpublished rename never reaches the audience.
    expect(apps.rows.map((r) => r.name)).toEqual(['Open app'])
  })

  it('nothing of another workspace is counted or listed', async () => {
    const counts = await usage(U.other, TENANT.A)
    expect(counts).toEqual({})
    const listed = await as(U.other, `SELECT id FROM public.tag_objects($1, 'finance', 'data_tables', 20, 0)`, [TENANT.A])
    expect(listed.rows).toEqual([])
    const own = await usage(U.other, TENANT.B)
    expect(own['data_tables:finance']).toBe(1)
  })

  it('tag_objects lists each new type (packages excepted) by name', async () => {
    for (const [type, name] of [['data_tables', 'Clients'], ['business_rules', 'Routing'], ['email_templates', 'Welcome'], ['form_controls', 'Rating']]) {
      const { rows, error } = await as(U.builder, `SELECT name FROM public.tag_objects($1, ' finance ', $2, 20, 0)`, [TENANT.A, type])
      expect(error).toBeNull()
      expect(rows.map((r) => r.name)).toEqual([name])
    }
    const packages = await as(U.builder, `SELECT name FROM public.tag_objects($1, 'finance', 'packages', 20, 0)`, [TENANT.A])
    expect(packages.error).toBeNull()
    expect(packages.rows).toEqual([])
    const direct = await as(U.builder, 'SELECT id FROM public.packages')
    expect(direct.error).toMatch(/permission denied/)
  })

  it('rename_tag and remove_tag stay service-role only', async () => {
    expect((await as(U.builder, `SELECT public.rename_tag($1, 'finance', 'money', NULL)`, [TENANT.A])).error).toMatch(/permission denied/)
    expect((await as(U.builder, `SELECT public.remove_tag($1, 'finance')`, [TENANT.A])).error).toMatch(/permission denied/)
  })

  it('rename_tag renames on every new type, packages included, in one workspace only', async () => {
    await db.query('SAVEPOINT rename')
    const { rows } = await db.query(`SELECT public.rename_tag($1, 'FINANCE', 'Money', NULL) AS result`, [TENANT.A])
    expect(rows[0].result.objects).toMatchObject({ data_tables: 1, reports: 3, business_rules: 1, email_templates: 1, form_controls: 1, apps: 3, packages: 1 }) // apps: open, hidden and the unpublished one
    const { rows: tagged } = await db.query(`SELECT tags FROM public.form_controls WHERE tenant_id = $1`, [TENANT.A])
    expect(tagged[0].tags).toEqual(['Money', 'survey'])
    const { rows: b } = await db.query(`SELECT tags FROM public.packages WHERE tenant_id = $1`, [TENANT.B])
    expect(b[0].tags).toEqual(['Finance'])
    await db.query('ROLLBACK TO SAVEPOINT rename')
  })

  it('remove_tag removes from every new type in one workspace only', async () => {
    await db.query('SAVEPOINT remove')
    const { rows } = await db.query(`SELECT public.remove_tag($1, 'finance') AS result`, [TENANT.A])
    expect(rows[0].result.objects).toMatchObject({ data_tables: 1, reports: 3, business_rules: 1, email_templates: 1, form_controls: 1, apps: 3, packages: 1 }) // apps: open, hidden and the unpublished one
    const { rows: left } = await db.query(`SELECT tags FROM public.custom_tables WHERE tenant_id = $1 AND name = 'Clients'`, [TENANT.A])
    expect(left[0].tags).toEqual(['crm'])
    const { rows: b } = await db.query(`SELECT count(*)::int AS n FROM public.reports WHERE tenant_id = $1 AND 'Finance' = ANY(tags)`, [TENANT.B])
    expect(b[0].n).toBe(1)
    await db.query('ROLLBACK TO SAVEPOINT remove')
  })
})
