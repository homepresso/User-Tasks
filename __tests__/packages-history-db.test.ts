/**
 * Package history and "remove a package and all its artifacts" against a
 * LOCAL Supabase stack (service-role REST client, two scratch tenants):
 * every install / upgrade / reconfigure / uninstall — and failed attempts —
 * is recorded in package_events with the applied plan; uninstall plans list
 * every artifact, unfinished runs block it unless cancel_runs, missing
 * section delete permissions are refused up front, and delete_data + force
 * remove everything (workflow, decision table, integration, data table and
 * rows, email template). History filters, CSV, tenant isolation, permission
 * denials, and the migration backfill from the audit log (idempotent).
 *
 * Runs only when EVENT_STREAM_DB_URL is set (needs migrations 20261103400000
 * and 20261113000000 applied), e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/packages-history-db.test.ts
 */
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/deletion-queue', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/deletion-queue')>()), kickDeletionProcessor: vi.fn() }))

import { buildPackageVersion, createPackage } from '@/lib/services/packages'
import { completePackageInstall, installPackage, uninstallPackage, upgradePackageInstall } from '@/lib/services/package-installs'
import { getPackageEvent, listPackageEvents, packageEventsCsv } from '@/lib/services/package-events'
import { readZip, writeZip } from '@/lib/packages/zip'
import type { ServiceContext } from '@/lib/services/context'
import { PERMISSION_KEYS } from '@/lib/permissions'

/* eslint-disable @typescript-eslint/no-explicit-any -- plans are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `e7c0f200-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const C = id(0xc)
const D = id(0xd)
const ACTOR = id(0xacc)
const IDS = { workflow: id(0x101), decision: id(0x102), table: id(0x103), integration: id(0x104), reference: id(0x105), template: id(0x106) }
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const REQ = `integration_auth:integrations:${IDS.integration}`
const ALL_BUT = (...without: string[]) => PERMISSION_KEYS.filter((p) => !without.includes(p))

describe.skipIf(!DB_URL)('package history + uninstall (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (tenantId: string, permissions: string[] | null = null, source: ServiceContext['source'] = 'api'): ServiceContext =>
    ({ supabase: admin, tenantId, actorId: ACTOR, permissions: permissions ? new Set(permissions) : null, authKind: 'api_key', source })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, signing: process.env.PACKAGE_SIGNING_KEY }
  let file1 = ''
  let file2 = ''
  let installId = ''

  const rows = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows
  const one = async (sql: string, params: unknown[]) => (await rows(sql, params))[0]
  const events = async () => rows('SELECT * FROM public.package_events WHERE tenant_id = $1 ORDER BY created_at, id', [D])
  const latest = async () => (await events()).at(-1)
  const localOf = async (section: string, sourceId: string) => (await one('SELECT local_id FROM public.package_install_assets WHERE tenant_id = $1 AND section = $2 AND source_id = $3', [D, section, sourceId]))?.local_id

  async function cleanup() {
    for (const t of [C, D]) {
      for (const table of ['package_events', 'package_installs', 'packages', 'workflow_runs', 'workflows', 'workflow_versions', 'workflow_logs', 'object_audit_log', 'github_sync_asset_map', 'deletion_queue']) {
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
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'History C', 'pkg-history-c-test'), ($2, 'History D', 'pkg-history-d-test')`, [C, D])
    await db.query(`INSERT INTO public.users (id, tenant_id, email, display_name) VALUES ($1, $2, 'hist-actor@example.test', 'Hist Actor')`, [ACTOR, D])
    await db.query(`INSERT INTO public.integrations (id, tenant_id, name, type, config) VALUES ($1, $2, 'Hist ERP', 'rest_api', $3)`,
      [IDS.integration, C, JSON.stringify({ base_url: 'https://erp.dev.test', auth_type: 'bearer', auth_config: { token: 'tok-source' } })])
    await db.query(`INSERT INTO public.integration_references (id, tenant_id, integration_id, name, request_config, inputs, outputs) VALUES ($1, $2, $3, 'Get vendor', $4, '[]', '[]')`,
      [IDS.reference, C, IDS.integration, JSON.stringify({ method: 'GET', path: '/vendors/{{id}}' })])
    await db.query(`INSERT INTO public.decision_tables (id, tenant_id, name, inputs, outputs, rules) VALUES ($1, $2, 'Hist policy', '[]', '[]', '[]')`, [IDS.decision, C])
    await db.query(`INSERT INTO public.custom_tables (id, tenant_id, name, slug, columns) VALUES ($1, $2, 'Hist vendors', 'hist-vendors', $3)`,
      [IDS.table, C, JSON.stringify([{ id: 'c1', key: 'name', name: 'Name', type: 'text' }])])
    await db.query(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data) VALUES ($1, $2, '{"name":"Vendor 1"}'), ($1, $2, '{"name":"Vendor 2"}')`, [C, IDS.table])
    await db.query(`INSERT INTO public.email_templates (id, tenant_id, name, subject, html_body) VALUES ($1, $2, 'Hist approval mail', 'Approve {{title}}', '<p>Approve</p>')`, [IDS.template, C])
    const nodes = [
      { id: 'trigger', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} },
      { id: 'lookup', type: 'call_reference', label: 'Get vendor', position: { x: 0, y: 100 }, config: { reference_id: IDS.reference } },
      { id: 'policy', type: 'decision_table', label: 'Policy', position: { x: 0, y: 200 }, config: { decision_table_id: IDS.decision } },
    ]
    await db.query(`INSERT INTO public.workflows (id, tenant_id, name, trigger_type, trigger_config, nodes, edges, is_active) VALUES ($1, $2, 'Hist invoice approval', 'manual', '{}', $3, $4, true)`,
      [IDS.workflow, C, JSON.stringify(nodes), JSON.stringify([{ id: 'e1', source: 'trigger', target: 'lookup' }, { id: 'e2', source: 'lookup', target: 'policy' }])])

    const { package: pkg } = await createPackage(ctx(C), {
      name: 'Hist invoice approval', roots: [{ type: 'workflow', id: IDS.workflow }],
      items: [{ type: 'data_table', id: IDS.table }, { type: 'email_template', id: IDS.template }], data_modes: { [IDS.table]: 'rows' },
    })
    file1 = (await buildPackageVersion(ctx(C), pkg.id, { include_file: true })).file_base64!
    await db.query(`UPDATE public.workflows SET nodes = jsonb_set(nodes, '{1,label}', '"Fetch vendor"') WHERE id = $1`, [IDS.workflow])
    file2 = (await buildPackageVersion(ctx(C), pkg.id, { include_file: true })).file_base64!
  }, 90_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
    process.env.PACKAGE_SIGNING_KEY = prev.signing
  })

  it('records failed attempts: missing values, a tampered file, a corrupt file', async () => {
    await expect(installPackage(ctx(D), { file: file1, source: 'cli', source_label: 'hist.utpkg' })).rejects.toThrow(/Missing required values/)
    let event = await latest()
    expect(event).toMatchObject({ action: 'install', status: 'failed', package_name: 'Hist invoice approval', to_version: '1.0.0', channel: 'cli', source: 'cli', signed: true })
    expect(event.error).toMatch(/Missing required values/)
    expect(event.plan.plan.assets.length).toBeGreaterThan(0) // the plan that was refused

    const entries = readZip(Buffer.from(file1, 'base64'))
    const target = entries.find((e) => e.path.startsWith('assets/workflows/'))!
    const tampered = writeZip(entries.map((e) => (e === target ? { path: e.path, data: Buffer.from(Buffer.from(e.data).toString('utf8').replace('Get vendor', 'Steal vendor')) } : e)))
    await expect(installPackage(ctx(D), { file: Buffer.from(tampered).toString('base64') })).rejects.toThrow(/failed verification/)
    event = await latest()
    expect(event).toMatchObject({ action: 'install', status: 'failed', package_name: 'Hist invoice approval', channel: 'api' })

    await expect(installPackage(ctx(D), { file: Buffer.from('not a zip').toString('base64'), file_name: 'broken.utpkg' })).rejects.toThrow()
    event = await latest()
    expect(event).toMatchObject({ action: 'install', status: 'failed', package_name: 'broken.utpkg', package_uid: null })
  })

  it('a denied caller records nothing; packages.view is needed to read the history', async () => {
    const before = (await events()).length
    await expect(installPackage(ctx(D, ['packages.view']), { file: file1, keep_incomplete: true })).rejects.toThrow(/packages.install/)
    expect((await events()).length).toBe(before)
    await expect(listPackageEvents(ctx(D, ['workflows.view']), {}, { limit: 10, offset: 0 })).rejects.toThrow(/packages.view/)
    await expect(packageEventsCsv(ctx(D, ['workflows.view']), {})).rejects.toThrow(/packages.view/)
    const viewer = await listPackageEvents(ctx(D, ['packages.view']), {}, { limit: 10, offset: 0 })
    expect(viewer.total).toBe(before)
  })

  it('install (incomplete), reconfigure and upgrade are recorded with counts, requirement changes and the plan', async () => {
    const installed = await installPackage(ctx(D, null, 'ui'), { file: file1, keep_incomplete: true, source: 'file', source_label: 'hist-1.0.0.utpkg' })
    installId = installed.install!.id
    let event = await latest()
    expect(event).toMatchObject({ action: 'install', status: 'succeeded', install_id: installId, from_version: null, to_version: '1.0.0', channel: 'ui', source: 'file', source_label: 'hist-1.0.0.utpkg', trust: 'instance', actor_id: ACTOR })
    expect(event.counts.created).toBeGreaterThanOrEqual(4)
    expect(event.counts.rows_inserted).toBe(2)
    expect(event.options).toMatchObject({ keep_incomplete: true })
    expect(event.requirement_changes).toContainEqual(expect.objectContaining({ id: REQ, before: null, after: 'missing' }))
    expect(JSON.stringify(event.plan)).not.toContain('tok-source')
    expect(event.plan.install).toBeUndefined()

    await completePackageInstall(ctx(D), installId, { values: { [REQ]: { 'config.auth_config.token': 'tok-target-secret', 'config.base_url': 'https://erp.test.test' } }, source: 'cli' })
    event = await latest()
    expect(event).toMatchObject({ action: 'reconfigure', status: 'succeeded', from_version: '1.0.0', to_version: '1.0.0', channel: 'cli' })
    expect(event.requirement_changes).toEqual([expect.objectContaining({ id: REQ, before: 'missing', after: 'met' })])
    expect(JSON.stringify(event)).not.toContain('tok-target-secret')

    await upgradePackageInstall(ctx(D), installId, { file: file2 })
    event = await latest()
    expect(event).toMatchObject({ action: 'upgrade', status: 'succeeded', from_version: '1.0.0', to_version: '1.0.1' })
    expect(event.counts.updated).toBeGreaterThanOrEqual(1)
    const wf = event.plan.plan.assets.find((a: any) => a.section === 'workflows')
    expect(wf.diffs.some((d: any) => d.path.includes('label') && d.after === 'Fetch vendor')).toBe(true)

    // A refused downgrade is a failed attempt.
    await expect(installPackage(ctx(D), { file: file1 })).rejects.toThrow(/older than/)
    event = await latest()
    expect(event).toMatchObject({ action: 'downgrade', status: 'failed', from_version: '1.0.1', to_version: '1.0.0', install_id: installId })
  })

  it('uninstall plan lists every artifact; missing section permissions and unfinished runs block it', async () => {
    const workflow = await localOf('workflows', IDS.workflow)
    await db.query(`INSERT INTO public.workflow_runs (id, workflow_id, tenant_id, status, title) VALUES ($1, $2, $3, 'waiting_for_event', 'Invoice 42')`, [id(0x901), workflow, D])
    // A local change to the email template.
    await db.query(`UPDATE public.email_templates SET subject = 'Edited here' WHERE id = $1`, [await localOf('email_templates', IDS.template)])

    const dry = await uninstallPackage(ctx(D), installId, { dry_run: true })
    const by = Object.fromEntries(dry.plan.map((p) => [p.section, p]))
    expect(Object.keys(by).sort()).toEqual(['data_tables', 'decision_tables', 'email_templates', 'integrations', 'workflows'])
    expect(by.data_tables).toMatchObject({ action: 'skip', rows: 2 })
    expect(by.email_templates).toMatchObject({ action: 'skip', locally_modified: true })
    expect(by.integrations.note).toMatch(/references/)
    expect(dry.active_run_count).toBe(1)
    expect(dry.active_runs[0]).toMatchObject({ title: 'Invoice 42', status: 'waiting_for_event', workflow_name: 'Hist invoice approval' })
    expect(dry.blockers.join(' ')).toMatch(/still in progress/)

    // Missing data.delete: refused before anything is removed.
    const noDataDelete = ctx(D, ALL_BUT('data.delete'))
    const planned = await uninstallPackage(noDataDelete, installId, { dry_run: true, delete_data: true, force: true, cancel_runs: true })
    expect(planned.missing_permissions).toEqual(['data.delete'])
    await expect(uninstallPackage(noDataDelete, installId, { delete_data: true, force: true, cancel_runs: true })).rejects.toThrow(/Forbidden: .*data.delete/)
    let event = await latest()
    expect(event).toMatchObject({ action: 'uninstall', status: 'failed', from_version: '1.0.1' })
    expect(event.options).toMatchObject({ delete_data: true, force: true, cancel_runs: true })
    // Cancelling runs needs workflows.activate.
    expect((await uninstallPackage(ctx(D, ALL_BUT('workflows.activate')), installId, { dry_run: true, delete_data: true, force: true, cancel_runs: true })).missing_permissions).toEqual(['workflows.activate'])
    // packages.install itself.
    await expect(uninstallPackage(ctx(D, ['packages.view']), installId, {})).rejects.toThrow(/packages.install/)

    // Runs in progress block it.
    await expect(uninstallPackage(ctx(D), installId, { delete_data: true, force: true })).rejects.toThrow(/still in progress/)
    event = await latest()
    expect(event).toMatchObject({ action: 'uninstall', status: 'failed' })
    expect(event.plan.active_run_count).toBe(1)
    expect(await one('SELECT id FROM public.package_installs WHERE id = $1', [installId])).toBeTruthy()
    expect(await one('SELECT id FROM public.workflows WHERE id = $1', [workflow])).toBeTruthy()
  })

  it('remove everything: delete_data + force + cancel_runs removes every artifact, rows included, and records it', async () => {
    const local = {
      workflow: await localOf('workflows', IDS.workflow), decision: await localOf('decision_tables', IDS.decision), integration: await localOf('integrations', IDS.integration),
      table: await localOf('data_tables', IDS.table), template: await localOf('email_templates', IDS.template),
    }
    const done = await uninstallPackage(ctx(D, null, 'ui'), installId, { delete_data: true, force: true, cancel_runs: true })
    expect(done.errors).toEqual([])
    expect(done.runs_cancelled).toBe(1)
    expect(done.summary).toMatchObject({ delete: 5, skip: 0, rows: 2 })
    expect((await one('SELECT status, error FROM public.workflow_runs WHERE id = $1', [id(0x901)]))?.status ?? 'deleted').toMatch(/failed|deleted/)
    // Deleted now: the email template; through the deletion queue (processed inline for integrations, else by the
    // worker — the shared queue may hold other jobs first): integration (+ references), workflow, decision table, data table (+ rows).
    expect(await one('SELECT id FROM public.email_templates WHERE id = $1', [local.template])).toBeUndefined()
    const queued = (await rows('SELECT target_type, target_id FROM public.deletion_queue WHERE tenant_id = $1', [D])).map((r) => `${r.target_type}:${r.target_id}`)
    const TABLE: Record<string, string> = { workflow: 'workflows', decision_table: 'decision_tables', data_table: 'custom_tables', integration: 'integrations' }
    for (const [type, localId] of [['workflow', local.workflow], ['decision_table', local.decision], ['data_table', local.table], ['integration', local.integration]]) {
      const stillThere = await one(`SELECT id FROM public.${TABLE[type]} WHERE id = $1`, [localId])
      expect(!stillThere || queued.includes(`${type}:${localId}`)).toBe(true)
    }
    expect(await one('SELECT id FROM public.package_installs WHERE id = $1', [installId])).toBeUndefined()

    const event = await latest()
    expect(event).toMatchObject({ action: 'uninstall', status: 'succeeded', channel: 'ui', from_version: '1.0.1', to_version: null })
    expect(event.counts).toMatchObject({ removed: 5, skipped: 0, rows_deleted: 2, runs_cancelled: 1, errors: 0 })
    expect(event.plan.plan.map((p: any) => p.action)).toEqual(['delete', 'delete', 'delete', 'delete', 'delete'])
  })

  it('history: filters, detail with plan, CSV, tenant isolation; the install is gone but its history stays', async () => {
    const all = await listPackageEvents(ctx(D), {}, { limit: null, offset: 0 })
    expect(all.events.map((e: any) => e.action)).toEqual(['uninstall', 'uninstall', 'uninstall', 'downgrade', 'upgrade', 'reconfigure', 'install', 'install', 'install', 'install'])
    const bySlug = await listPackageEvents(ctx(D), { package: 'hist-invoice-approval' }, { limit: null, offset: 0 })
    expect(bySlug.total).toBe(9) // the corrupt file never named a package
    expect((await listPackageEvents(ctx(D), { package: installId }, { limit: null, offset: 0 })).total).toBe(7)
    expect((await listPackageEvents(ctx(D), { action: 'uninstall', status: 'failed' }, { limit: null, offset: 0 })).total).toBe(2)
    expect((await listPackageEvents(ctx(D), { channel: 'cli' }, { limit: null, offset: 0 })).total).toBe(2)
    expect((await listPackageEvents(ctx(D), { actor: ACTOR }, { limit: null, offset: 0 })).total).toBe(10)
    expect((await listPackageEvents(ctx(D), { actor: 'HIST-actor@example.test' }, { limit: null, offset: 0 })).total).toBe(10)
    expect(all.events[0].actor).toEqual({ id: ACTOR, name: 'Hist Actor', email: 'hist-actor@example.test' })
    expect((await listPackageEvents(ctx(D), { actor: 'nobody@example.test' }, { limit: null, offset: 0 })).total).toBe(0)
    const today = new Date().toISOString().slice(0, 10)
    expect((await listPackageEvents(ctx(D), { since: today, until: today }, { limit: null, offset: 0 })).total).toBe(10)
    expect((await listPackageEvents(ctx(D), { until: '2020-01-01' }, { limit: null, offset: 0 })).total).toBe(0)
    await expect(listPackageEvents(ctx(D), { action: 'explode' }, { limit: 10, offset: 0 })).rejects.toThrow(/Unknown action/)
    const page = await listPackageEvents(ctx(D), {}, { limit: 3, offset: 0 })
    expect(page.events).toHaveLength(3)
    expect(page.total).toBe(10)
    expect(page.events[0]).not.toHaveProperty('plan')

    const upgrade = all.events.find((e: any) => e.action === 'upgrade')!
    const detail = await getPackageEvent(ctx(D, ['packages.view']), upgrade.id)
    expect(detail.event.plan.plan.assets.length).toBeGreaterThan(0)
    await expect(getPackageEvent(ctx(C), upgrade.id)).rejects.toThrow(/not found/)
    expect((await listPackageEvents(ctx(C), {}, { limit: null, offset: 0 })).total).toBe(0)

    const csv = await packageEventsCsv(ctx(D), { action: 'upgrade,install' })
    const lines = csv.csv.trim().split('\n')
    expect(lines[0]).toMatch(/^created_at,package_name,package_slug,action,status,from_version,to_version,channel/)
    expect(lines).toHaveLength(1 + 5)
    expect(csv.rows).toBe(5)
  })

  it('the migration backfills earlier installs from the audit log, once', async () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261113000000_package_events.sql'), 'utf8')
    const auditId = id(0x701)
    await db.query(`INSERT INTO public.object_audit_log (id, tenant_id, actor_id, object_type, object_id, action, summary, metadata, created_at) VALUES
      ($1, $2, $3, 'package_install', $4, 'update', 'Upgraded 1.2.0 → package "Old vendor sync" 1.3.0', '{"version":"1.3.0","mode":"upgrade","signed":true,"via":"mcp"}', now() - interval '30 days'),
      ($5, $2, $3, 'package_install', $4, 'delete', 'Uninstalled package "Old vendor sync" 1.3.0: 4 removed, 1 kept', '{"removed":4,"kept":["data_tables:x"],"errors":0,"force":false,"delete_data":false,"via":"ui"}', now() - interval '29 days')`,
    [auditId, D, ACTOR, id(0x702), id(0x703)])
    await db.query(sql)
    await db.query(sql)
    const backfilled = await rows('SELECT action, status, from_version, to_version, channel, package_name, counts, options, backfilled FROM public.package_events WHERE tenant_id = $1 AND backfilled ORDER BY created_at', [D])
    expect(backfilled).toEqual([
      expect.objectContaining({ action: 'upgrade', status: 'succeeded', from_version: '1.2.0', to_version: '1.3.0', channel: 'mcp', package_name: 'Old vendor sync' }),
      expect.objectContaining({ action: 'uninstall', from_version: '1.3.0', to_version: null, channel: 'ui', counts: { removed: 4, skipped: 1, errors: 0 }, options: { force: false, delete_data: false } }),
    ])
    expect((await listPackageEvents(ctx(D), { since: '2000-01-01' }, { limit: null, offset: 0 })).total).toBe(12)
  })
})
