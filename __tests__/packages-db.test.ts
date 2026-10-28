/**
 * Packages end to end against a LOCAL Supabase stack (service-role REST
 * client, two scratch tenants): build a signed package in A, install it into
 * B with keep_incomplete, check the incomplete state (integration disabled,
 * workflow inactive and blocked), complete setup, upgrade in place to a new
 * version (diffs, kept credentials, removed-upstream flagged not deleted,
 * local changes detected), data-row modes, uninstall dry run / skip rules,
 * tamper rejection and permissions.
 *
 * Runs only when EVENT_STREAM_DB_URL is set (and needs the packages
 * migration 20261103400000 applied), e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/packages-db.test.ts
 */
import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { buildPackageVersion, createPackage, getPackageContents, listPackages, updatePackage } from '@/lib/services/packages'
import { completePackageInstall, getPackageInstall, installPackage, listPackageInstalls, planPackageInstall, uninstallPackage, upgradePackageInstall } from '@/lib/services/package-installs'
import { setWorkflowActive } from '@/lib/services/workflows'
import { readZip, writeZip } from '@/lib/packages/zip'
import type { ServiceContext } from '@/lib/services/context'
import { PERMISSION_KEYS } from '@/lib/permissions'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `e7c0f100-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa)
const B = id(0xb)
const IDS = { workflow: id(0x101), decision: id(0x102), table: id(0x103), integration: id(0x104), reference: id(0x105) }
const ROWS = [id(0x201), id(0x202), id(0x203)]
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const REQ = `integration_auth:integrations:${IDS.integration}`

describe.skipIf(!DB_URL)('packages (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (tenantId: string, permissions: string[] | null = null): ServiceContext => ({ supabase: admin, tenantId, actorId: null, permissions: permissions ? new Set(permissions) : null, authKind: 'api_key', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, signing: process.env.PACKAGE_SIGNING_KEY }
  let packageId = ''
  let file1 = ''
  let file2 = ''
  let installId = ''

  const one = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0]
  const localOf = async (section: string, sourceId: string) => (await one('SELECT local_id, status FROM public.package_install_assets WHERE tenant_id = $1 AND section = $2 AND source_id = $3', [B, section, sourceId]))

  async function cleanup() {
    for (const t of [A, B]) {
      for (const table of ['package_installs', 'packages', 'workflow_runs', 'workflows', 'workflow_versions', 'workflow_logs', 'object_audit_log', 'github_sync_asset_map']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t])
    }
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    process.env.PACKAGE_SIGNING_KEY = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Packages A', 'packages-a-test'), ($2, 'Packages B', 'packages-b-test')`, [A, B])

    await db.query(`INSERT INTO public.integrations (id, tenant_id, name, type, config) VALUES ($1, $2, 'Pkg ERP', 'rest_api', $3)`,
      [IDS.integration, A, JSON.stringify({ base_url: 'https://erp.dev.test', auth_type: 'bearer', auth_config: { token: 'tok-source' } })])
    await db.query(`INSERT INTO public.integration_references (id, tenant_id, integration_id, name, request_config, inputs, outputs) VALUES ($1, $2, $3, 'Get vendor', $4, '[]', '[]')`,
      [IDS.reference, A, IDS.integration, JSON.stringify({ method: 'GET', path: '/vendors/{{id}}' })])
    await db.query(`INSERT INTO public.decision_tables (id, tenant_id, name, inputs, outputs, rules) VALUES ($1, $2, 'Pkg policy', '[]', '[]', '[]')`, [IDS.decision, A])
    await db.query(`INSERT INTO public.custom_tables (id, tenant_id, name, slug, columns) VALUES ($1, $2, 'Pkg vendors', 'pkg-vendors', $3)`,
      [IDS.table, A, JSON.stringify([{ id: 'c1', key: 'name', name: 'Name', type: 'text' }])])
    for (const [index, rowId] of ROWS.entries()) {
      await db.query(`INSERT INTO public.custom_table_rows (id, tenant_id, table_id, data, created_at) VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
        [rowId, A, IDS.table, JSON.stringify({ name: `Vendor ${index + 1}` }), String(index)])
    }
    const nodes = [
      { id: 'trigger', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} },
      { id: 'lookup', type: 'call_reference', label: 'Get vendor', position: { x: 0, y: 100 }, config: { reference_id: IDS.reference } },
      { id: 'policy', type: 'decision_table', label: 'Policy', position: { x: 0, y: 200 }, config: { decision_table_id: IDS.decision } },
    ]
    const edges = [{ id: 'e1', source: 'trigger', target: 'lookup' }, { id: 'e2', source: 'lookup', target: 'policy' }]
    await db.query(`INSERT INTO public.workflows (id, tenant_id, name, trigger_type, trigger_config, nodes, edges, is_active) VALUES ($1, $2, 'Pkg invoice approval', 'manual', '{}', $3, $4, true)`,
      [IDS.workflow, A, JSON.stringify(nodes), JSON.stringify(edges)])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
    process.env.PACKAGE_SIGNING_KEY = prev.signing
  })

  it('resolves the dependency closure and requirements; builds a signed 1.0.0 without secrets', async () => {
    const { package: pkg } = await createPackage(ctx(A), {
      name: 'Pkg invoice approval', roots: [{ type: 'workflow', id: IDS.workflow }],
      items: [{ type: 'data_table', id: IDS.table }], data_modes: { [IDS.table]: 'rows' },
    })
    packageId = pkg.id
    const contents = await getPackageContents(ctx(A), pkg.id)
    expect(contents.items.map((i) => `${i.type}:${i.included_as}`).sort()).toEqual(['data_table:manual', 'decision_table:dependency', 'integration:dependency', 'workflow:root'])
    expect(contents.requirements.map((r) => r.id)).toContain(REQ)

    const built = await buildPackageVersion(ctx(A), pkg.id, { include_file: true })
    expect(built.version.version).toBe('1.0.0')
    expect(built.manifest.signature?.alg).toBe('ed25519')
    file1 = built.file_base64!
    const bytes = Buffer.from(file1, 'base64')
    expect(bytes.includes(Buffer.from('tok-source'))).toBe(false)
    const text = readZip(bytes).map((e) => Buffer.from(e.data).toString('utf8')).join('\n')
    expect(text).not.toContain('tok-source')
    expect(text).toContain('Vendor 1')
    await expect(buildPackageVersion(ctx(A), pkg.id, { version: '1.0.0' })).rejects.toThrow(/greater than/)
  })

  it('enforces permissions', async () => {
    await expect(listPackages(ctx(A, ['workflows.view']), { limit: 10, offset: 0 })).rejects.toThrow(/packages.view/)
    await expect(createPackage(ctx(A, ['packages.view', 'workflows.view']), { name: 'x', roots: [{ type: 'workflow', id: IDS.workflow }] })).rejects.toThrow(/packages.manage/)
    await expect(planPackageInstall(ctx(B, ['packages.view']), { file: file1 })).rejects.toThrow(/workflows.view/)
    const viewer = ctx(B, ['packages.view', ...PERMISSION_KEYS.filter((p) => p.endsWith('.view'))])
    const plan = await planPackageInstall(viewer, { file: file1 })
    expect(plan.mode).toBe('install')
    await expect(installPackage(viewer, { file: file1, keep_incomplete: true })).rejects.toThrow(/packages.install/)
    // packages.install alone is not enough: each section needs its own create permission.
    await expect(installPackage(ctx(B, ['packages.view', 'packages.install', ...PERMISSION_KEYS.filter((p) => p.endsWith('.view'))]), { file: file1, keep_incomplete: true, data: { [IDS.table]: 'skip' } })).rejects.toThrow(/Forbidden: missing permission/)
  })

  it('refuses tampered packages', async () => {
    const entries = readZip(Buffer.from(file1, 'base64'))
    const workflowFile = entries.find((e) => e.path.startsWith('assets/workflows/'))!
    const tampered = writeZip(entries.map((e) => (e === workflowFile ? { path: e.path, data: Buffer.from(Buffer.from(e.data).toString('utf8').replace('Get vendor', 'Steal vendor')) } : e)))
    await expect(planPackageInstall(ctx(B), { file: Buffer.from(tampered).toString('base64') })).rejects.toThrow(/failed verification/)
  })

  it('fails on missing required values unless keep_incomplete; incomplete installs disable and block', async () => {
    await expect(installPackage(ctx(B), { file: file1 })).rejects.toThrow(/Missing required values/)
    const result = await installPackage(ctx(B), { file: file1, keep_incomplete: true })
    installId = result.install!.id
    expect(result.install!.status).toBe('incomplete')
    expect(result.verification.signed).toBe(true)
    expect(result.result?.rows?.[0]).toMatchObject({ inserted: 3 })

    const integration = await localOf('integrations', IDS.integration)
    const workflow = await localOf('workflows', IDS.workflow)
    expect(integration.status).toBe('needs_config')
    expect(workflow.status).toBe('needs_config')
    expect((await one('SELECT is_active FROM public.integrations WHERE id = $1', [integration.local_id])).is_active).toBe(false)
    expect((await one('SELECT is_active FROM public.workflows WHERE id = $1', [workflow.local_id])).is_active).toBe(false)
    await expect(setWorkflowActive(ctx(B), workflow.local_id, true)).rejects.toThrow(/Needs configuration.*Pkg invoice approval/)

    const library = await listPackageInstalls(ctx(B), { limit: 10, offset: 0 })
    expect(library.installs[0]).toMatchObject({ status: 'incomplete', incomplete_count: 1 })
  })

  it('complete setup enables the integration and activates (publishes) the workflow', async () => {
    const done = await completePackageInstall(ctx(B), installId, { values: { [REQ]: { 'config.auth_config.token': 'tok-target', 'config.base_url': 'https://erp.test.test' } } })
    expect(done.status).toBe('complete')
    const integration = await localOf('integrations', IDS.integration)
    const workflow = await localOf('workflows', IDS.workflow)
    const row = await one('SELECT is_active, config FROM public.integrations WHERE id = $1', [integration.local_id])
    expect(row.is_active).toBe(true)
    expect(row.config.auth_config.token).toBe('tok-target')
    expect(row.config.base_url).toBe('https://erp.test.test')
    expect((await one('SELECT is_active, published_version_id FROM public.workflows WHERE id = $1', [workflow.local_id]))).toMatchObject({ is_active: true })
    expect((await getPackageInstall(ctx(B), installId)).install.status).toBe('complete')
  })

  it('upgrades in place: diff first, local credentials and settings kept, removed assets flagged not deleted, local changes detected', async () => {
    // Source changes: a renamed step, the decision table left out, a new row.
    await db.query(`UPDATE public.workflows SET nodes = jsonb_set(nodes, '{1,label}', '"Fetch vendor"') WHERE id = $1`, [IDS.workflow])
    await db.query(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data) VALUES ($1, $2, '{"name":"Vendor 4"}')`, [A, IDS.table])
    await updatePackage(ctx(A), packageId, { remove: [{ type: 'decision_table', id: IDS.decision }] })
    const built = await buildPackageVersion(ctx(A), packageId, { include_file: true })
    expect(built.version.version).toBe('1.0.1')
    file2 = built.file_base64!

    // A local change in B.
    const table = await localOf('data_tables', IDS.table)
    await db.query(`UPDATE public.custom_tables SET description = 'edited in B' WHERE id = $1`, [table.local_id])

    const plan = await upgradePackageInstall(ctx(B), installId, { file: file2, dry_run: true })
    expect(plan.mode).toBe('upgrade')
    expect(plan.blockers).toEqual([])
    const wf = plan.plan.assets.find((a) => a.section === 'workflows')!
    expect(wf.action).toBe('update')
    expect(wf.diffs?.some((d) => d.path.includes('label'))).toBe(true)
    expect(plan.plan.assets.find((a) => a.section === 'data_tables')?.locally_modified).toBe(true)
    expect(plan.removed_upstream.map((r) => r.section)).toEqual(['decision_tables'])
    expect(plan.requirements.find((r) => r.id === REQ)?.status).toBe('met')

    const upgraded = await upgradePackageInstall(ctx(B), installId, { file: file2, keep_local_changes: true })
    expect(upgraded.install).toMatchObject({ version: '1.0.1', previous_version: '1.0.0', status: 'complete' })
    const integration = await localOf('integrations', IDS.integration)
    const row = await one('SELECT is_active, config FROM public.integrations WHERE id = $1', [integration.local_id])
    expect(row.config.auth_config.token).toBe('tok-target')
    expect(row.config.base_url).toBe('https://erp.test.test')
    expect(row.is_active).toBe(true)
    const decision = await localOf('decision_tables', IDS.decision)
    expect(decision.status).toBe('removed_upstream')
    expect(await one('SELECT id FROM public.decision_tables WHERE id = $1', [decision.local_id])).toBeTruthy()
    expect((await one('SELECT description FROM public.custom_tables WHERE id = $1', [table.local_id])).description).toBe('edited in B')
    const nodes = (await one('SELECT nodes FROM public.workflows WHERE id = $1', [(await localOf('workflows', IDS.workflow)).local_id])).nodes
    expect(nodes[1].label).toBe('Fetch vendor')
    // Rows merged: 3 updated, 1 added — no duplicates.
    expect(upgraded.result?.rows?.[0]).toMatchObject({ inserted: 1, updated: 3 })
    expect(Number((await one('SELECT count(*) FROM public.custom_table_rows WHERE table_id = $1', [table.local_id])).count)).toBe(4)
  })

  it('data rows: replace and skip', async () => {
    const table = await localOf('data_tables', IDS.table)
    await db.query(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data) VALUES ($1, $2, '{"name":"Local only"}')`, [B, table.local_id])
    await installPackage(ctx(B), { file: file2, data: { [IDS.table]: 'skip' }, keep_local_changes: true })
    expect(Number((await one('SELECT count(*) FROM public.custom_table_rows WHERE table_id = $1', [table.local_id])).count)).toBe(5)
    await installPackage(ctx(B), { file: file2, data: { [IDS.table]: 'replace' }, keep_local_changes: true })
    expect(Number((await one('SELECT count(*) FROM public.custom_table_rows WHERE table_id = $1', [table.local_id])).count)).toBe(4)
  })

  it('uninstall: dry run first, locally changed assets and tables with rows are kept unless forced', async () => {
    const dry = await uninstallPackage(ctx(B), installId, { dry_run: true })
    const byName = Object.fromEntries(dry.plan.map((p) => [p.section, p]))
    expect(byName.workflows.action).toBe('delete')
    expect(byName.data_tables).toMatchObject({ action: 'skip' })
    expect(byName.decision_tables.action).toBe('delete')
    const done = await uninstallPackage(ctx(B), installId, {})
    expect(done.errors).toEqual([])
    const table = await one('SELECT id FROM public.custom_tables WHERE tenant_id = $1', [B])
    expect(table).toBeTruthy() // kept: changed locally and holds rows
    expect(await one('SELECT id FROM public.package_installs WHERE id = $1', [installId])).toBeUndefined()
  })
})
