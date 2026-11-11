/**
 * Package items against a LOCAL Supabase stack: add / remove items on an
 * authored package (dependency prompt, dependents warning), build a new
 * version that keeps the self-install in step (uninstall removes what was
 * added and keeps what was removed), detach / adopt on installs (adopt only
 * for packages authored here) and permissions.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/package-items-db.test.ts
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { buildPackageVersion, createPackage } from '@/lib/services/packages'
import { addPackageItems, listPackageItems, removePackageItems } from '@/lib/services/package-items'
import { adoptInstallItems, detachInstallItems, getPackageInstall, installPackage, uninstallPackage } from '@/lib/services/package-installs'
import { createDataTable } from '@/lib/services/data-tables'
import { createForm } from '@/lib/services/forms'
import { createWorkflow } from '@/lib/services/workflows'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const T = 'e7c0f100-0000-4000-8000-0000000007a1'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

describe.skipIf(!DB_URL)('package items (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (permissions: string[] | null = null): ServiceContext => ({ supabase: admin, tenantId: T, actorId: null, permissions: permissions ? new Set(permissions) : null, authKind: 'api_key', source: 'api' }) as any
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, signing: process.env.PACKAGE_SIGNING_KEY }
  const ids: Record<string, string> = {}
  let packageId = ''
  let installId = ''

  async function cleanup() {
    for (const table of ['package_installs', 'packages', 'workflow_runs', 'workflows', 'workflow_versions', 'forms', 'reports', 'decision_tables', 'custom_tables', 'object_audit_log', 'github_sync_asset_map', 'package_events', 'deletion_queue']) {
      await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [T]).catch(() => undefined)
    }
    await db.query('DELETE FROM public.tenants WHERE id = $1', [T])
  }
  const owned = async (install = installId) => (await db.query('SELECT local_id FROM public.package_install_assets WHERE tenant_id = $1 AND install_id = $2', [T, install])).rows.map((r: any) => String(r.local_id))
  const uninstallDeletes = async (install = installId) => ((await uninstallPackage(ctx(), install, { dry_run: true })) as any).plan.filter((p: any) => p.action === 'delete').map((p: any) => p.local_id)

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    process.env.PACKAGE_SIGNING_KEY = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Package items', 'package-items-test')`, [T])
    const c = ctx()
    const requests = await createDataTable(c, { name: 'PI Requests', columns: [{ name: 'Title', type: 'text' }] as any })
    const categories = await createDataTable(c, { name: 'PI Categories', columns: [{ name: 'Name', type: 'text' }] as any })
    const start = await createForm(c, { name: 'PI Request form', fields: [{ key: 'title', label: 'Title', type: 'text' }] } as any)
    const adminForm = await createForm(c, { name: 'PI Manage categories', fields: [{ key: 'rows', label: 'Categories', type: 'data_table', data_table: { source: 'table', mode: 'edit', table_id: categories.id, allow_add: true, columns: [{ key: 'name', label: 'Name', type: 'text' }] } }] } as any)
    const spare = await createForm(c, { name: 'PI Spare form', fields: [{ key: 'x', label: 'X', type: 'text' }] } as any)
    const wf = await createWorkflow(c, {
      name: 'PI Approval', trigger_type: 'form_submitted', trigger_config: {},
      nodes: [
        { id: 'trigger', type: 'form_submitted', label: 'Submitted', position: { x: 0, y: 0 }, config: { form_id: start.id, form_name: start.name } },
        { id: 'save', type: 'update_data_table', label: 'Save', position: { x: 0, y: 100 }, config: { table_id: requests.id, operation: 'insert', column_values: { title: '{{form.title}}' } } },
      ] as any,
      edges: [{ id: 'e1', source: 'trigger', target: 'save' }] as any,
    })
    const { rows: [report] } = await db.query(`INSERT INTO public.reports (tenant_id, name, config) VALUES ($1, 'PI Report', $2) RETURNING id`, [T, JSON.stringify({ columns: [], charts: [] })])
    Object.assign(ids, { requests: requests.id, categories: categories.id, start: start.id, adminForm: adminForm.id, spare: spare.id, workflow: String(wf.workflow_id), report: String(report.id) })

    const pkg = await createPackage(c, { name: 'PI Purchase requests', roots: [{ type: 'workflow', id: ids.workflow }] })
    packageId = pkg.package.id
    await buildPackageVersion(c, packageId, { version: '1.0.0' })
    const installed: any = await installPackage(c, { package_id: packageId, version: '1.0.0', source: 'mcp' })
    installId = String(installed.install.id)
  }, 90_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
    process.env.PACKAGE_SIGNING_KEY = prev.signing
  })

  it('lists items with their dependencies, edges, no unpublished changes and the self-install', async () => {
    const list = await listPackageItems(ctx(), packageId)
    const byId = new Map(list.items.map((i) => [i.id, i]))
    expect(byId.get(ids.workflow)?.included_as).toBe('root')
    expect(byId.get(ids.start)?.included_as).toBe('dependency')
    expect(byId.get(ids.requests)?.included_as).toBe('dependency')
    expect(byId.get(ids.start)?.used_by.map((u) => u.id)).toContain(ids.workflow)
    expect(byId.get(ids.workflow)?.uses.map((u) => u.id)).toEqual(expect.arrayContaining([ids.start, ids.requests]))
    expect(list.groups.map((g) => g.type)).toEqual(expect.arrayContaining(['workflow', 'form', 'data_table']))
    expect(list.changes).toMatchObject({ since_version: '1.0.0', unpublished: false, added: [], removed: [] })
    expect(list.install?.id).toBe(installId)
  }, 60_000)

  it('adds an item with its dependencies (dry run offers them first)', async () => {
    const dry = await addPackageItems(ctx(), packageId, { items: [{ type: 'form', id: ids.adminForm }], dry_run: true })
    expect(dry.adding.map((a) => a.id)).toEqual([ids.adminForm])
    expect(dry.dependencies.map((d) => d.id)).toEqual([ids.categories])
    expect(dry.dependencies[0].required_by?.id).toBe(ids.adminForm)
    expect((await listPackageItems(ctx(), packageId)).items.map((i) => i.id)).not.toContain(ids.adminForm)

    const done = await addPackageItems(ctx(), packageId, { items: [{ type: 'form', id: ids.adminForm }] })
    expect(done.dependencies_added).toBe(1)
    const list = await listPackageItems(ctx(), packageId)
    expect(list.items.map((i) => i.id)).toEqual(expect.arrayContaining([ids.adminForm, ids.categories]))
    expect(list.changes.unpublished).toBe(true)
    expect(list.changes.added.map((a) => a.id).sort()).toEqual([ids.adminForm, ids.categories].sort())
  }, 60_000)

  it('adds without dependencies: they are left out', async () => {
    const done = await addPackageItems(ctx(), packageId, { items: [{ type: 'report', id: ids.report }], with_dependencies: false })
    expect(done.package?.items.map((i) => i.id)).toContain(ids.report)
  }, 60_000)

  it('warns before removing an item another item uses, and removes it anyway with force', async () => {
    const dry = await removePackageItems(ctx(), packageId, { items: [{ type: 'form', id: ids.start }], dry_run: true })
    expect(dry.dependents).toHaveLength(1)
    expect(dry.dependents[0].used_by.map((u) => u.id)).toEqual([ids.workflow])
    expect(dry.warnings[0]).toMatch(/Workflow “PI Approval” uses form “PI Request form”/)
    await expect(removePackageItems(ctx(), packageId, { items: [{ type: 'form', id: ids.start }] })).rejects.toMatchObject({ code: 'conflict' })
    const forced = await removePackageItems(ctx(), packageId, { items: [{ type: 'form', id: ids.start }], force: true })
    expect(forced.left_out.map((l) => l.id)).toEqual([ids.start])
    expect(forced.package?.excluded.map((e) => e.id)).toContain(ids.start)
    expect((await listPackageItems(ctx(), packageId)).items.map((i) => i.id)).not.toContain(ids.start)
    // Back in for the rest of the run.
    await addPackageItems(ctx(), packageId, { items: [{ type: 'form', id: ids.start }] })
  }, 60_000)

  it('removes an item nothing uses, and refuses items that are not in the package', async () => {
    const done = await removePackageItems(ctx(), packageId, { items: [{ type: 'report', id: ids.report }] })
    expect(done.dependents).toEqual([])
    expect(done.left_out).toEqual([])
    expect(done.package?.items.map((i) => i.id)).not.toContain(ids.report)
    expect(done.package?.excluded.map((i) => i.id)).not.toContain(ids.report)
    await expect(removePackageItems(ctx(), packageId, { items: [{ type: 'form', id: ids.spare }] })).rejects.toMatchObject({ code: 'not_found' })
  }, 60_000)

  it('builds a new version that updates the self-install: uninstall removes the added items', async () => {
    const built = await buildPackageVersion(ctx(), packageId, { bump: 'minor', update_install: true })
    expect(built.version.version).toBe('1.1.0')
    expect(built.install_sync).toMatchObject({ status: 'upgraded', version: '1.1.0', adopted: 2 })
    expect((await getPackageInstall(ctx(), installId)).install.version).toBe('1.1.0')
    expect(await owned()).toEqual(expect.arrayContaining([ids.adminForm, ids.categories]))
    expect(await uninstallDeletes()).toEqual(expect.arrayContaining([ids.workflow, ids.start, ids.requests, ids.adminForm, ids.categories]))
    expect((await listPackageItems(ctx(), packageId)).changes.unpublished).toBe(false)
  }, 90_000)

  it('after removing an item and building, uninstall keeps the removed item', async () => {
    await removePackageItems(ctx(), packageId, { items: [{ type: 'form', id: ids.adminForm }] })
    const built = await buildPackageVersion(ctx(), packageId, { bump: 'patch', update_install: true })
    expect(built.version.version).toBe('1.1.1')
    expect(built.install_sync?.status).toBe('upgraded')
    expect(built.install_sync?.released.map((r) => r.local_id).sort()).toEqual([ids.adminForm, ids.categories].sort())
    const deletes = await uninstallDeletes()
    expect(deletes).not.toContain(ids.adminForm)
    expect(deletes).not.toContain(ids.categories)
    expect(deletes).toEqual(expect.arrayContaining([ids.workflow, ids.start, ids.requests]))
  }, 90_000)

  it('detaches an item from the self-install (uninstall keeps it; the package drops it)', async () => {
    const dry = await detachInstallItems(ctx(), installId, { items: [{ type: 'data_table', id: ids.requests }], dry_run: true })
    expect(dry.used_by[0]?.used_by.map((u) => u.id)).toEqual([ids.workflow])
    expect(dry.authored_package?.id).toBe(packageId)
    const done = await detachInstallItems(ctx(), installId, { items: [{ type: 'data_table', id: ids.requests }] })
    expect(done.package_updated).toBe(true)
    expect(await owned()).not.toContain(ids.requests)
    expect(await uninstallDeletes()).not.toContain(ids.requests)
    expect((await listPackageItems(ctx(), packageId)).items.map((i) => i.id)).not.toContain(ids.requests)
    await expect(detachInstallItems(ctx(), installId, { items: [{ type: 'data_table', id: ids.requests }] })).rejects.toMatchObject({ code: 'not_found' })
  }, 60_000)

  it('adopts a workspace item into the self-install (uninstall removes it; the package gains it)', async () => {
    const done = await adoptInstallItems(ctx(), installId, { items: [{ type: 'form', id: ids.spare }] })
    expect(done.items.map((i) => i.id)).toEqual([ids.spare])
    expect(done.package_updated).toBe(true)
    expect(await uninstallDeletes()).toContain(ids.spare)
    expect((await listPackageItems(ctx(), packageId)).items.map((i) => i.id)).toContain(ids.spare)
    const again = await adoptInstallItems(ctx(), installId, { items: [{ type: 'form', id: ids.spare }] })
    expect(again.items).toEqual([])
    expect(again.skipped.map((s) => s.id)).toEqual([ids.spare])
  }, 60_000)

  it('third-party installs allow detach only, and upgrades leave detached items alone', async () => {
    const { rows: [other] } = await db.query(
      `INSERT INTO public.package_installs (tenant_id, package_uid, name, slug, version, source, checksum, status, requirements, manifest)
       VALUES ($1, $2, 'Gallery thing', 'gallery-thing', '2.0.0', 'file', 'x', 'complete', '[]', '{}') RETURNING id`, [T, randomUUID()])
    await db.query(`INSERT INTO public.package_install_assets (tenant_id, install_id, asset_type, section, source_id, local_id, name, status) VALUES ($1, $2, 'report', 'reports', $3, $4, 'PI Report', 'ok')`, [T, other.id, randomUUID(), ids.report])
    await expect(adoptInstallItems(ctx(), other.id, { items: [{ type: 'form', id: ids.spare }] })).rejects.toMatchObject({ code: 'forbidden' })
    const done = await detachInstallItems(ctx(), other.id, { items: [{ type: 'report', id: ids.report }] })
    expect(done.authored_package).toBeNull()
    expect(done.package_updated).toBe(false)
    expect(await owned(other.id)).toEqual([])
    const install: any = await getPackageInstall(ctx(), other.id)
    expect(install.detached.map((d: any) => d.local_id)).toEqual([ids.report])
    await db.query('DELETE FROM public.package_installs WHERE id = $1', [other.id])
  }, 60_000)

  it('enforces the package permissions', async () => {
    const viewer = ctx(['packages.view', 'workflows.view', 'forms.view', 'data.view', 'reports.view'])
    await expect(listPackageItems(viewer, packageId)).resolves.toBeTruthy()
    await expect(addPackageItems(viewer, packageId, { items: [{ type: 'report', id: ids.report }], dry_run: true })).resolves.toBeTruthy()
    await expect(addPackageItems(viewer, packageId, { items: [{ type: 'report', id: ids.report }] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(removePackageItems(viewer, packageId, { items: [{ type: 'form', id: ids.spare }] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(detachInstallItems(viewer, installId, { items: [{ type: 'form', id: ids.spare }] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(adoptInstallItems(viewer, installId, { items: [{ type: 'report', id: ids.report }] })).rejects.toMatchObject({ code: 'forbidden' })
    // Adding needs view permission on the item's type.
    await expect(addPackageItems(ctx(['packages.view', 'packages.manage']), packageId, { items: [{ type: 'report', id: ids.report }] })).rejects.toThrow(/reports\.view/)
    // Install changes without packages.manage: the install changes, the package itself does not.
    const installer = ctx(['packages.view', 'packages.install', 'forms.view', 'reports.view', 'workflows.view', 'data.view'])
    const done = await adoptInstallItems(installer, installId, { items: [{ type: 'report', id: ids.report }] })
    expect(done.package_updated).toBe(false)
    expect(done.warnings.join(' ')).toMatch(/packages\.manage/)
  }, 60_000)
})
