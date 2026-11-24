/**
 * App packaging end to end against a LOCAL Supabase stack (two scratch
 * workspaces): an app in A with a form, a workflow and a data table (rows as
 * sample data) is packaged; installing it into B creates an equivalent app
 * with every id remapped to B's copies, an empty audience and the installer as
 * editor; an upgrade keeps B's audience and local page; RLS keeps each
 * workspace's app invisible to the other's members; uninstall lists the app.
 *
 * Runs only when EVENT_STREAM_DB_URL is set (and the apps migration
 * 20270120090000 is applied), e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres LOCKDOWN_SUPABASE_URL=http://127.0.0.1:54321 npx vitest run __tests__/app-packages-db.test.ts
 */
import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows */

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
const files = new Map<string, Uint8Array>()
vi.mock('@/lib/providers/storage', () => ({
  getStorageProvider: async () => ({
    id: 'supabase',
    put: async (bucket: string, path: string, bytes: Uint8Array) => { files.set(`${bucket}/${path}`, bytes) },
    get: async (bucket: string, path: string) => (files.has(`${bucket}/${path}`) ? { body: new Blob([files.get(`${bucket}/${path}`)! as BlobPart]).stream(), contentType: 'image/svg+xml' } : null),
    publicUrl: (bucket: string, path: string) => `https://files.example/${bucket}/${path}`,
  }),
}))

import { buildPackageVersion, createPackage, getPackageContents } from '@/lib/services/packages'
import { installPackage, planPackageInstall, uninstallPackage } from '@/lib/services/package-installs'
import type { ServiceContext } from '@/lib/services/context'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const id = (n: number) => `a99c0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa0), B = id(0xb0)
const APP = id(1), FORM = id(2), WORKFLOW = id(3), TABLE = id(4), ICON = id(5)
const ROWS = [id(0x201), id(0x202)]
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><circle cx="12" cy="12" r="10"/></svg>'

describe.skipIf(!DB_URL)('app packaging (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const users: Record<'a' | 'b', { id: string; email: string }> = { a: { id: '', email: `apppkg-a-${Date.now()}@example.com` }, b: { id: '', email: `apppkg-b-${Date.now()}@example.com` } }
  const ctx = (tenantId: string, actorId: string | null = null): ServiceContext => ({ supabase: admin, tenantId, actorId, permissions: null, authKind: 'session', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, signing: process.env.PACKAGE_SIGNING_KEY }
  let packageId = ''
  let file1 = ''
  let installedAppId = ''

  const rows = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows
  async function cleanup() {
    for (const t of [A, B]) {
      for (const table of ['package_installs', 'packages', 'apps', 'workflows', 'forms', 'custom_tables', 'github_sync_asset_map']) await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t]).catch(() => undefined)
    }
    for (const u of Object.values(users)) if (u.id) await admin.auth.admin.deleteUser(u.id).catch(() => undefined)
  }
  async function addUser(key: 'a' | 'b', tenant: string) {
    const { data, error } = await admin.auth.admin.createUser({ email: users[key].email, password: 'App-pkg-pass-123!', email_confirm: true })
    if (error) throw error
    users[key].id = data.user!.id
    await new Promise((r) => setTimeout(r, 300))
    const { data: profile } = await admin.from('users').select('tenant_id').eq('id', users[key].id).maybeSingle()
    await db.query('DELETE FROM public.user_memberships WHERE user_id = $1', [users[key].id])
    await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [users[key].id, tenant])
    await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home, is_active) VALUES ($1, $2, 'admin', true, true)`, [users[key].id, tenant])
    const owner = await rows(`SELECT id FROM public.roles WHERE tenant_id = $1 AND slug = 'owner'`, [tenant])
    if (owner[0]) await db.query('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [tenant, users[key].id, owner[0].id])
    if (profile?.tenant_id && profile.tenant_id !== tenant) await db.query('DELETE FROM public.tenants WHERE id = $1', [profile.tenant_id]).catch(() => undefined)
  }
  async function session(key: 'a' | 'b') {
    const client = createClient(API_URL, ANON_KEY, opts)
    const { error } = await client.auth.signInWithPassword({ email: users[key].email, password: 'App-pkg-pass-123!' })
    if (error) throw error
    return client
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    process.env.PACKAGE_SIGNING_KEY = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug, settings) VALUES ($1, 'App pkg A', 'app-pkg-a-test', $3), ($2, 'App pkg B', 'app-pkg-b-test', '{}')`,
      [A, B, JSON.stringify({ apps: { icons: [{ id: ICON, token: `svg:${ICON}`, name: 'Circle', tint: true }] } })])
    files.set(`task-files/app-icons/${A}/${ICON}.svg`, new TextEncoder().encode(SVG))
    await addUser('a', A)
    await addUser('b', B)
    await db.query(`INSERT INTO public.forms (id, tenant_id, name, fields) VALUES ($1, $2, 'Expense claim', $3)`, [FORM, A, JSON.stringify([{ key: 'title', label: 'What for?', type: 'text', required: true }])])
    await db.query(`INSERT INTO public.workflows (id, tenant_id, name, trigger_type, trigger_config, nodes, edges, is_active) VALUES ($1, $2, 'Expense approval', 'manual', '{}', $3, '[]', false)`,
      [WORKFLOW, A, JSON.stringify([{ id: 'trigger', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} }])])
    await db.query(`INSERT INTO public.custom_tables (id, tenant_id, name, slug, columns) VALUES ($1, $2, 'Vendors', 'vendors-apppkg', $3)`, [TABLE, A, JSON.stringify([{ id: 'c1', key: 'name', name: 'Name', type: 'text' }])])
    for (const [i, rowId] of ROWS.entries()) await db.query('INSERT INTO public.custom_table_rows (id, tenant_id, table_id, data) VALUES ($1, $2, $3, $4)', [rowId, A, TABLE, JSON.stringify({ name: `Vendor ${i + 1}` })])
    await db.query(`INSERT INTO public.apps (id, tenant_id, slug, name, subtitle, icon, color, menu, settings) VALUES ($1, $2, 'expenses', 'Expenses', 'Claims desk', $3, '#2563eb', $4, $5)`,
      [APP, A, `svg:${ICON}`, JSON.stringify([{ kind: 'form', label: 'New claim', form_id: FORM, open: 'modal' }]), JSON.stringify({ nav: { style: 'sidebar' }, access_issues: 0 })])
    await db.query(`INSERT INTO public.app_pages (tenant_id, app_id, slug, title, position, layout, filters) VALUES ($1, $2, 'home', 'Home', 0, $3, '[]')`, [A, APP, JSON.stringify({ widgets: [
      { id: 'form', type: 'form_embed', w: 6, h: 6, config: { form_id: FORM } },
      { id: 'start', type: 'start_workflow', w: 6, h: 2, config: { workflow_id: WORKFLOW } },
      { id: 'grid', type: 'data_grid', w: 12, h: 6, config: { table_id: TABLE } },
    ] })])
    await db.query(`INSERT INTO public.app_audience (tenant_id, app_id, principal_type, principal_id, app_role) VALUES ($1, $2, 'user', $3, 'contributor')`, [A, APP, users.a.id])
    await db.query('INSERT INTO public.app_editors (tenant_id, app_id, user_id) VALUES ($1, $2, $3)', [A, APP, users.a.id])
  }, 90_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
    process.env.PACKAGE_SIGNING_KEY = prev.signing
  })

  it('packages the app with its form, workflow and table (rows as sample data), without the audience', async () => {
    const { package: pkg } = await createPackage(ctx(A, users.a.id), { name: 'Expenses app', roots: [{ type: 'app', id: APP }], data_modes: { [TABLE]: 'rows' } })
    packageId = pkg.id
    const contents = await getPackageContents(ctx(A), pkg.id)
    expect(contents.items.map((i) => `${i.type}:${i.included_as}`).sort()).toEqual(['app:root', 'data_table:dependency', 'form:dependency', 'workflow:dependency'])
    const built = await buildPackageVersion(ctx(A, users.a.id), pkg.id, { include_file: true })
    file1 = built.file_base64!
    const text = Buffer.from(file1, 'base64').toString('latin1')
    expect(text).not.toContain(users.a.id)
  })

  it('previews the install: creates, needs Build apps, prompts for the audience', async () => {
    const plan = await planPackageInstall(ctx(B, users.b.id), { file: file1 })
    expect(plan.blockers).toEqual([])
    expect(plan.plan.assets.find((a) => a.section === 'apps')).toMatchObject({ action: 'create', name: 'Expenses' })
    expect(plan.apps).toEqual([expect.objectContaining({ name: 'Expenses', set_audience: true, pages: 1 })])
  })

  it('installs into another workspace: remapped ids, empty audience, installer is editor, icon re-sanitised', async () => {
    const result = await installPackage(ctx(B, users.b.id), { file: file1 })
    expect(result.result?.errors ?? []).toEqual([])
    const local = async (section: string, source: string) => (await rows('SELECT local_id FROM public.package_install_assets WHERE tenant_id = $1 AND section = $2 AND source_id = $3', [B, section, source]))[0]?.local_id
    installedAppId = await local('apps', APP)
    const [formB, workflowB, tableB] = [await local('forms', FORM), await local('workflows', WORKFLOW), await local('data_tables', TABLE)]
    expect(new Set([installedAppId, formB, workflowB, tableB]).size).toBe(4)
    expect([formB, workflowB, tableB]).not.toContain(FORM)
    const [app] = await rows('SELECT * FROM public.apps WHERE id = $1', [installedAppId])
    expect(app).toMatchObject({ tenant_id: B, slug: 'expenses', name: 'Expenses' })
    expect(app.menu[0].form_id).toBe(formB)
    expect(Number.isFinite(app.settings.access_issues)).toBe(true)
    const [page] = await rows('SELECT layout FROM public.app_pages WHERE app_id = $1', [installedAppId])
    expect(page.layout.widgets.map((w: any) => w.config.form_id ?? w.config.workflow_id ?? w.config.table_id)).toEqual([formB, workflowB, tableB])
    expect(await rows('SELECT * FROM public.app_audience WHERE app_id = $1', [installedAppId])).toEqual([])
    expect((await rows('SELECT user_id FROM public.app_editors WHERE app_id = $1', [installedAppId])).map((r) => r.user_id)).toEqual([users.b.id])
    const [tenant] = await rows('SELECT settings FROM public.tenants WHERE id = $1', [B])
    const icon = tenant.settings.apps.icons[0]
    expect(app.icon).toBe(`svg:${icon.id}`)
    expect(new TextDecoder().decode(files.get(`task-files/app-icons/${B}/${icon.id}.svg`)!)).not.toContain('script')
    expect((await rows('SELECT count(*)::int AS n FROM public.custom_table_rows WHERE table_id = $1', [tableB]))[0].n).toBe(2)
    expect(result.apps?.[0]).toMatchObject({ local_id: installedAppId, local_slug: 'expenses', set_audience: true })
  })

  it('keeps each workspace’s apps to its own members (RLS)', async () => {
    const asA = await session('a')
    const asB = await session('b')
    expect((await asA.from('apps').select('id').eq('id', installedAppId)).data ?? []).toEqual([])
    expect((await asA.from('app_pages').select('id').eq('app_id', installedAppId)).data ?? []).toEqual([])
    expect((await asB.from('apps').select('id').eq('id', APP)).data ?? []).toEqual([])
    expect(((await asB.from('apps').select('id').eq('id', installedAppId)).data ?? []).map((r: any) => r.id)).toEqual([installedAppId])
    // Session clients never write app tables.
    await asB.from('apps').update({ name: 'Hacked' }).eq('id', installedAppId)
    expect((await rows('SELECT name FROM public.apps WHERE id = $1', [installedAppId]))[0].name).toBe('Expenses')
  })

  it('upgrades in place: shows the diff, keeps the audience, editors and pages added in B', async () => {
    await db.query(`INSERT INTO public.app_audience (tenant_id, app_id, principal_type, principal_id, app_role) VALUES ($1, $2, 'user', $3, 'viewer')`, [B, installedAppId, users.b.id])
    await db.query(`INSERT INTO public.app_pages (tenant_id, app_id, slug, title, position, layout, filters) VALUES ($1, $2, 'notes', 'Notes', 3, '{"widgets":[]}', '[]')`, [B, installedAppId])
    await db.query(`UPDATE public.app_pages SET title = 'Start here' WHERE app_id = $1 AND slug = 'home'`, [APP])
    const built = await buildPackageVersion(ctx(A, users.a.id), packageId, { include_file: true })
    const plan = await planPackageInstall(ctx(B, users.b.id), { file: built.file_base64!, data: { [TABLE]: 'skip' } })
    expect(plan.mode).toBe('upgrade')
    const appPlan = plan.plan.assets.find((a) => a.section === 'apps')!
    expect(appPlan.action).toBe('update')
    expect(appPlan.diffs?.map((d) => d.path)).toContain('pages[0].title')
    expect(plan.apps?.[0].set_audience).toBe(false)
    await installPackage(ctx(B, users.b.id), { file: built.file_base64!, data: { [TABLE]: 'skip' } })
    expect((await rows('SELECT principal_id FROM public.app_audience WHERE app_id = $1', [installedAppId])).map((r) => r.principal_id)).toEqual([users.b.id])
    expect((await rows('SELECT user_id FROM public.app_editors WHERE app_id = $1', [installedAppId])).map((r) => r.user_id)).toEqual([users.b.id])
    const pages = await rows('SELECT slug, title FROM public.app_pages WHERE app_id = $1 ORDER BY slug', [installedAppId])
    expect(pages).toEqual([{ slug: 'home', title: 'Start here' }, { slug: 'notes', title: 'Notes' }])
  })

  it('uninstall removes the app first', async () => {
    const [install] = await rows('SELECT id FROM public.package_installs WHERE tenant_id = $1', [B])
    const plan = await uninstallPackage(ctx(B, users.b.id), install.id, { dry_run: true }) as any
    const entries = (plan.plan ?? plan.entries ?? []) as any[]
    expect(entries[0]?.section).toBe('apps')
  })
})
