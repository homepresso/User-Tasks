/**
 * Packaging an Agent-built solution against a LOCAL Supabase stack: the
 * items (parent / child tables, a config table, forms, a decision table, a
 * workflow, a report) become one package through the real package services
 * (create → build 1.0.0 → install in the same workspace), nothing is changed
 * by the self-install, and uninstalling the package removes every item.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/solution-package-db.test.ts
 */
import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { buildPackageVersion, createPackage, listPackages, updatePackage } from '@/lib/services/packages'
import { installPackage, uninstallPackage } from '@/lib/services/package-installs'
import { createDataTable } from '@/lib/services/data-tables'
import { createForm } from '@/lib/services/forms'
import { createDecisionTable } from '@/lib/services/decision-tables'
import { createWorkflow } from '@/lib/services/workflows'
import { packageItems } from '@/lib/assistants/tools/solution-package'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const T = 'e7c0f100-0000-4000-8000-0000000005c1'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

describe.skipIf(!DB_URL)('solution packages (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx: ServiceContext = { supabase: admin, tenantId: T, actorId: null, permissions: null, authKind: 'api_key', source: 'api' } as any
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, signing: process.env.PACKAGE_SIGNING_KEY }
  const items: Array<{ kind: string; id: string; name: string }> = []
  const calls: string[] = []
  const call = async (name: string, args: any) => {
    calls.push(name)
    try {
      switch (name) {
        case 'packages_list': return await listPackages(ctx, { limit: 100, offset: 0 })
        case 'packages_create': return await createPackage(ctx, args)
        case 'packages_update': { const { package_id, ...rest } = args; return await updatePackage(ctx, package_id, rest) }
        case 'packages_build': { const { package_id, ...rest } = args; return await buildPackageVersion(ctx, package_id, rest) }
        case 'packages_install': return await installPackage(ctx, { ...args, source: 'mcp' })
        default: return { error: `unexpected ${name}` }
      }
    } catch (error) { return { error: (error as Error).message } }
  }

  async function cleanup() {
    for (const table of ['package_installs', 'packages', 'workflow_runs', 'workflows', 'workflow_versions', 'forms', 'reports', 'decision_tables', 'custom_tables', 'object_audit_log', 'github_sync_asset_map', 'package_events', 'deletion_queue']) {
      await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [T]).catch(() => undefined)
    }
    await db.query('DELETE FROM public.tenants WHERE id = $1', [T])
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    process.env.PACKAGE_SIGNING_KEY = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Solution pkg', 'solution-pkg-test')`, [T])
    const parent = await createDataTable(ctx, { name: 'SP Purchase requests', columns: [{ name: 'Reference', type: 'text' }, { name: 'Title', type: 'text' }] as any })
    const child = await createDataTable(ctx, { name: 'SP Line items', columns: [{ name: 'Request', type: 'lookup', lookup: { sourceTableId: parent.id, sourceColumn: 'reference' } }, { name: 'Item', type: 'text' }] as any })
    const config = await createDataTable(ctx, { name: 'SP Categories', columns: [{ name: 'Name', type: 'text' }] as any })
    const start = await createForm(ctx, { name: 'SP Purchase request', fields: [{ key: 'title', label: 'Title', type: 'text' }] } as any)
    const adminForm = await createForm(ctx, { name: 'SP Manage categories', fields: [{ key: 'rows', label: 'Categories', type: 'data_table', data_table: { source: 'table', mode: 'edit', table_id: config.id, allow_add: true, columns: [{ key: 'name', label: 'Name', type: 'text' }] } }] } as any)
    const rules = await createDecisionTable(ctx, { name: 'SP Thresholds', inputs: [], outputs: [], rules: [] })
    const wf = await createWorkflow(ctx, {
      name: 'SP Approval', trigger_type: 'form_submitted', trigger_config: {},
      nodes: [
        { id: 'trigger', type: 'form_submitted', label: 'Submitted', position: { x: 0, y: 0 }, config: { form_id: start.id, form_name: start.name } },
        { id: 'save', type: 'update_data_table', label: 'Save', position: { x: 0, y: 100 }, config: { table_id: parent.id, operation: 'insert', column_values: { title: '{{form.title}}' } } },
      ] as any,
      edges: [{ id: 'e1', source: 'trigger', target: 'save' }] as any,
    })
    const workflowId = String(wf.workflow_id)
    const { rows: [report] } = await db.query(`INSERT INTO public.reports (tenant_id, name, config) VALUES ($1, 'SP Requests', $2) RETURNING id`, [T, JSON.stringify({ data_source: `custom_table_${parent.id}`, columns: ['data_title'], charts: [] })])
    items.push(
      { kind: 'data_table', id: parent.id, name: 'parent' }, { kind: 'data_table', id: child.id, name: 'child' }, { kind: 'data_table', id: config.id, name: 'config' },
      { kind: 'form', id: start.id, name: 'start' }, { kind: 'form', id: adminForm.id, name: 'admin' },
      { kind: 'decision_table', id: rules.id, name: 'rules' }, { kind: 'workflow', id: workflowId, name: 'workflow' }, { kind: 'report', id: report.id, name: 'report' },
    )
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
    process.env.PACKAGE_SIGNING_KEY = prev.signing
  })

  it('packages every item (1.0.0), registers it as installed here without changing anything, and uninstall removes them all', async () => {
    const before = await db.query('SELECT id, version FROM public.forms WHERE tenant_id = $1 ORDER BY id', [T])
    const r = await packageItems(items, { name: 'SP Purchase requests' }, { call, access: { manage: true, install: true, share: false } })
    expect(r.status).toBe('packaged')
    expect(r.installed).toBe(true)
    expect(r.package?.version).toBe('1.0.0')
    expect(calls).toEqual(['packages_create', 'packages_build', 'packages_install'])
    // The self-install changed nothing (no new form versions, nothing created).
    expect((await db.query('SELECT id, version FROM public.forms WHERE tenant_id = $1 ORDER BY id', [T])).rows).toEqual(before.rows)
    const owned = await db.query('SELECT section, local_id FROM public.package_install_assets WHERE tenant_id = $1', [T])
    for (const it of items) expect(owned.rows.map((x: any) => x.local_id)).toContain(it.id)

    const dry: any = await uninstallPackage(ctx, r.install_id!, { dry_run: true })
    const deletes = dry.plan.filter((p: any) => p.action === 'delete').map((p: any) => p.local_id)
    for (const it of items) expect(deletes).toContain(it.id)
    const done: any = await uninstallPackage(ctx, r.install_id!, {})
    expect(done.errors).toEqual([])
    expect((await db.query('SELECT count(*)::int AS n FROM public.forms WHERE tenant_id = $1', [T])).rows[0].n).toBe(0)
    // Workflows and data tables go through the deletion queue (hard-deleted by the processor).
    const queued = (await db.query('SELECT target_type, target_id FROM public.deletion_queue WHERE tenant_id = $1', [T])).rows.map((x: any) => x.target_id)
    for (const it of items.filter((i) => i.kind === 'workflow' || i.kind === 'data_table')) expect(queued).toContain(it.id)
    expect((await db.query('SELECT count(*)::int AS n FROM public.reports WHERE tenant_id = $1', [T])).rows[0].n).toBe(0)
  }, 60_000)
})
