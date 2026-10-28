/**
 * Package asset search (lib/services/package-assets) against a LOCAL
 * Supabase stack: a scratch tenant with assets of every type, walked page by
 * page in both sort orders (no repeats, nothing skipped, including rows
 * without updated_at), counts, filters, special characters, reference
 * matches, per-type permissions, tenant isolation, cursors and in_package.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/package-assets-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { searchPackageAssets, type AssetHit, type AssetSearchInput } from '@/lib/services/package-assets'
import { createPackage } from '@/lib/services/packages'
import type { ServiceContext } from '@/lib/services/context'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `e7c0f200-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa)
const B = id(0xb)
const IDS = { erp: id(0x301), erpRef: id(0x302), connectorIntegration: id(0x303), objects: id(0x304), connector: id(0x305), role: id(0x306), agent: id(0x307) }
const SPECIAL = ['Discount 50% off', 'snake_case_flow', 'back\\slash flow', 'say "hi" flow', 'a,b(c) flow', "O'Brien flow", 'Café órders']
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

describe.skipIf(!DB_URL)('package asset search (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (tenantId: string, permissions: string[] | null = null, actorId: string | null = null): ServiceContext => ({ supabase: admin, tenantId, actorId, permissions: permissions ? new Set(permissions) : null, authKind: 'api_key', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  let userId: string | null = null

  async function cleanup() {
    for (const t of [A, B]) {
      for (const table of ['packages', 'integration_references', 'tenant_connectors', 'agents', 'integrations', 'workflows', 'custom_tables', 'decision_tables', 'email_templates', 'reports', 'mcp_servers', 'retention_policies', 'log_destinations', 'roles', 'tag_definitions', 'object_audit_log', 'github_sync_asset_map']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t])
    }
  }

  /** Every expected asset of tenant A, computed from the database with the same visibility rules. */
  async function expectedKeys(): Promise<Set<string>> {
    const sql = `
      SELECT 'workflow:' || id FROM workflows WHERE tenant_id = $1
      UNION ALL SELECT 'data_table:' || id FROM custom_tables WHERE tenant_id = $1
      UNION ALL SELECT 'decision_table:' || id FROM decision_tables WHERE tenant_id = $1
      UNION ALL SELECT 'email_template:' || id FROM email_templates WHERE tenant_id = $1
      UNION ALL SELECT 'integration:' || id FROM integrations WHERE tenant_id = $1 AND name <> '__objects__' AND name NOT LIKE '%(Connector)'
      UNION ALL SELECT 'connector:' || id FROM tenant_connectors WHERE tenant_id = $1 AND display_name IS NOT NULL
      UNION ALL SELECT 'agent:' || id FROM agents WHERE tenant_id = $1
      UNION ALL SELECT 'report:' || id FROM reports WHERE tenant_id = $1
      UNION ALL SELECT 'role:' || id FROM roles WHERE tenant_id = $1 AND is_system = false
      UNION ALL SELECT 'mcp_server:' || id FROM mcp_servers WHERE tenant_id = $1
      UNION ALL SELECT 'retention_policy:' || id FROM retention_policies WHERE tenant_id = $1
      UNION ALL SELECT 'log_destination:' || id FROM log_destinations WHERE tenant_id = $1`
    return new Set((await db.query(sql, [A])).rows.map((r) => Object.values(r)[0] as string))
  }

  async function walk(input: AssetSearchInput, c = ctx(A)): Promise<AssetHit[]> {
    const out: AssetHit[] = []
    let after: string | undefined
    for (let guard = 0; guard < 100; guard++) {
      const page = await searchPackageAssets(c, { ...input, after })
      out.push(...page.assets)
      if (!page.next_cursor) return out
      expect(page.assets).toHaveLength(input.limit ?? 50)
      after = page.next_cursor
    }
    throw new Error('did not finish')
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    userId = (await db.query('SELECT id FROM public.users ORDER BY created_at LIMIT 1')).rows[0]?.id ?? null
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Asset search A', 'asset-search-a-test'), ($2, 'Asset search B', 'asset-search-b-test')`, [A, B])
    // 130 workflows with spread-out updated_at (some share a timestamp), every 3rd tagged.
    await db.query(`
      INSERT INTO public.workflows (tenant_id, name, description, trigger_type, trigger_config, nodes, edges, tags, created_by, updated_at)
      SELECT $1, 'Flow ' || lpad(g::text, 3, '0'), CASE WHEN g = 7 THEN 'Handles purchase orders' END, 'manual', '{}', '[]', '[]',
             CASE WHEN g % 3 = 0 THEN ARRAY['finance'] ELSE ARRAY[]::text[] END, CASE WHEN g % 10 = 0 THEN $2::uuid END,
             now() - ((g / 2) || ' hours')::interval
      FROM generate_series(1, 130) g`, [A, userId])
    for (const name of SPECIAL) await db.query(`INSERT INTO public.workflows (tenant_id, name, trigger_type, trigger_config, nodes, edges, updated_at) VALUES ($1, $2, 'manual', '{}', '[]', '[]', now() - interval '30 days')`, [A, name])
    await db.query(`INSERT INTO public.workflows (tenant_id, name, trigger_type, trigger_config, nodes, edges) VALUES ($1, 'Flow B-only', 'manual', '{}', '[]', '[]')`, [B])
    await db.query(`INSERT INTO public.custom_tables (tenant_id, name, slug, columns) SELECT $1, 'Vendors ' || g, 'vendors-' || g, '[]' FROM generate_series(1, 5) g`, [A])
    await db.query(`INSERT INTO public.decision_tables (tenant_id, name, inputs, outputs, rules) SELECT $1, 'Policy ' || g, '[]', '[]', '[]' FROM generate_series(1, 3) g`, [A])
    await db.query(`INSERT INTO public.integrations (id, tenant_id, name, type, config, tags) VALUES ($1, $2, 'ERP', 'rest_api', '{}', ARRAY['finance']), ($3, $2, 'Postgres (Connector)', 'rest_api', '{}', '{}'), ($4, $2, '__objects__', 'rest_api', '{}', '{}')`,
      [IDS.erp, A, IDS.connectorIntegration, IDS.objects])
    await db.query(`INSERT INTO public.integration_references (id, tenant_id, integration_id, name, request_config, inputs, outputs) VALUES ($1, $2, $3, 'Lookup supplier', '{}', '[]', '[]')`, [IDS.erpRef, A, IDS.erp])
    await db.query(`INSERT INTO public.tenant_connectors (id, tenant_id, connector_key, display_name, integration_id) VALUES ($1, $2, 'postgres', 'Warehouse DB', $3)`, [IDS.connector, A, IDS.connectorIntegration])
    await db.query(`INSERT INTO public.agents (id, tenant_id, name, description, updated_at) VALUES ($1, $2, 'Triage agent', 'Routes tickets', NULL)`, [IDS.agent, A])
    await db.query(`INSERT INTO public.reports (tenant_id, name, category) VALUES ($1, 'Spend by vendor', 'finance'), ($1, 'Open tasks', NULL)`, [A])
    await db.query(`INSERT INTO public.roles (id, tenant_id, name, slug, is_system, updated_at) VALUES ($1, $2, 'Approver', 'approver-test', false, NULL)`, [IDS.role, A])
    await db.query(`INSERT INTO public.mcp_servers (tenant_id, name, url) VALUES ($1, 'Docs MCP', 'https://mcp.example.test')`, [A])
    await db.query(`INSERT INTO public.retention_policies (tenant_id, name, policy_mode) VALUES ($1, 'Keep forever', 'keep_forever')`, [A])
    await db.query(`INSERT INTO public.log_destinations (tenant_id, name, type) VALUES ($1, 'Audit webhook', 'webhook')`, [A])
    await db.query(`INSERT INTO public.tag_definitions (tenant_id, name) VALUES ($1, 'finance')`, [A])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  it('counts every visible asset per type (system roles, connector-generated and object integrations hidden)', async () => {
    const expected = await expectedKeys()
    const page = await searchPackageAssets(ctx(A), { limit: 10 })
    expect(page.total).toBe(expected.size)
    expect(page.counts.workflow).toBe(130 + SPECIAL.length)
    expect(page.counts.role).toBe(1)
    expect(page.counts.integration).toBe(1)
    expect(page.counts.connector).toBe(1)
    expect(Object.values(page.counts).reduce((a, b) => a! + b!, 0)).toBe(page.total)
    expect(page.assets).toHaveLength(10)
    expect(page.next_cursor).toBeTruthy()
    expect(page.hidden_types).toEqual([])
    expect(page.facets?.tags).toEqual(['finance'])
  })

  it('walks every page A–Z without repeats or gaps, each type in database order', async () => {
    const all = await walk({ limit: 17 })
    const keys = all.map((hit) => `${hit.type}:${hit.id}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(keys)).toEqual(await expectedKeys())
    const flows = all.filter((hit) => hit.type === 'workflow' && hit.name.startsWith('Flow ')).map((hit) => hit.name)
    expect(flows).toEqual([...flows].sort())
  })

  it('walks every page newest first, rows without updated_at last', async () => {
    const all = await walk({ limit: 23, sort: 'updated' })
    const keys = all.map((hit) => `${hit.type}:${hit.id}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(keys)).toEqual(await expectedKeys())
    const dated = all.filter((hit) => hit.updated_at)
    for (let i = 1; i < dated.length; i++) expect(Date.parse(dated[i - 1].updated_at!)).toBeGreaterThanOrEqual(Date.parse(dated[i].updated_at!))
    const firstUndated = all.findIndex((hit) => !hit.updated_at)
    expect(firstUndated).toBeGreaterThan(0)
    expect(all.slice(firstUndated).every((hit) => !hit.updated_at)).toBe(true)
    expect(all.slice(firstUndated).map((hit) => hit.id)).toEqual(expect.arrayContaining([IDS.agent, IDS.role]))
  })

  it('matches special characters literally', async () => {
    for (const name of SPECIAL) {
      const page = await searchPackageAssets(ctx(A), { search: name })
      expect(page.assets.map((hit) => hit.name), name).toEqual([name])
      expect(page.total).toBe(1)
    }
    expect((await searchPackageAssets(ctx(A), { search: '%' })).assets.map((h) => h.name)).toEqual(['Discount 50% off'])
    expect((await searchPackageAssets(ctx(A), { search: '_' })).assets.map((h) => h.name)).toEqual(['snake_case_flow'])
    expect((await searchPackageAssets(ctx(A), { search: 'CAFÉ' })).total).toBe(1)
  })

  it('searches descriptions and integration references; filters by type', async () => {
    const byDescription = await searchPackageAssets(ctx(A), { search: 'purchase order' })
    expect(byDescription.assets.map((h) => h.name)).toEqual(['Flow 007'])
    const byReference = await searchPackageAssets(ctx(A), { search: 'supplier' })
    expect(byReference.assets).toEqual([expect.objectContaining({ type: 'integration', id: IDS.erp, matched_reference: 'Lookup supplier' })])
    const tables = await searchPackageAssets(ctx(A), { search: 'vendor', types: 'data_table,report' })
    expect(tables.counts).toEqual({ data_table: 5, report: 1 })
    expect(tables.assets.map((h) => h.type).sort()).toEqual(['data_table', 'data_table', 'data_table', 'data_table', 'data_table', 'report'])
    await expect(searchPackageAssets(ctx(A), { types: 'nope' })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('filters by tag / report category, owner and updated_since', async () => {
    const tagged = await walk({ tag: 'finance' })
    expect(tagged.filter((h) => h.type === 'workflow')).toHaveLength(43)
    expect(tagged.filter((h) => h.type !== 'workflow').map((h) => `${h.type}:${h.name}`).sort()).toEqual(['integration:ERP', 'report:Spend by vendor'])
    if (userId) {
      const mine = await searchPackageAssets(ctx(A, null, userId), { owner: 'me' })
      expect(mine.total).toBe(13)
      expect(mine.assets.every((h) => h.created_by === userId)).toBe(true)
      expect((await searchPackageAssets(ctx(A), { owner: userId })).total).toBe(13)
    }
    await expect(searchPackageAssets(ctx(A), { owner: 'me' })).rejects.toMatchObject({ code: 'validation_error' })
    const recent = await searchPackageAssets(ctx(A), { types: 'workflow', updated_since: '10h', search: 'Flow ' })
    expect(recent.total).toBeGreaterThanOrEqual(19)
    expect(recent.total).toBeLessThanOrEqual(21)
    await expect(searchPackageAssets(ctx(A), { updated_since: 'last tuesday' })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('only searches the types the caller may view', async () => {
    const limited = await searchPackageAssets(ctx(A, ['packages.view', 'workflows.view']), { limit: 5 })
    expect(limited.types.map((t) => t.type).sort()).toEqual(['decision_table', 'email_template', 'workflow'])
    expect(limited.hidden_types).toEqual(expect.arrayContaining(['data_table', 'agent', 'integration', 'role']))
    expect(Object.keys(limited.counts).sort()).toEqual(['decision_table', 'email_template', 'workflow'])
    const mixed = await searchPackageAssets(ctx(A, ['packages.view', 'workflows.view']), { types: 'workflow,agent', search: 'triage' })
    expect(mixed.total).toBe(0)
    expect(mixed.hidden_types).toEqual(['agent'])
    await expect(searchPackageAssets(ctx(A, ['packages.view', 'workflows.view']), { types: 'agent' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(searchPackageAssets(ctx(A, ['workflows.view']), {})).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('never returns another tenant’s assets', async () => {
    expect((await searchPackageAssets(ctx(A), { search: 'B-only' })).total).toBe(0)
    expect((await searchPackageAssets(ctx(B), { search: 'Flow', types: 'workflow' })).assets.map((h) => h.name)).toEqual(['Flow B-only'])
  })

  it('refuses cursors from another search or tampered ones', async () => {
    const page = await searchPackageAssets(ctx(A), { search: 'Flow', limit: 5 })
    await expect(searchPackageAssets(ctx(A), { search: 'Flo', limit: 5, after: page.next_cursor })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(searchPackageAssets(ctx(A), { search: 'Flow', sort: 'updated', after: page.next_cursor })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(searchPackageAssets(ctx(A), { after: 'not-a-cursor' })).rejects.toMatchObject({ code: 'validation_error' })
    const second = await searchPackageAssets(ctx(A), { search: 'Flow', limit: 5, after: page.next_cursor })
    expect(second.total).toBe(page.total)
    expect(second.facets).toBeUndefined()
  })

  it('marks what is already in a package', async () => {
    const [root] = (await db.query(`SELECT id FROM workflows WHERE tenant_id = $1 AND name = 'Flow 001'`, [A])).rows
    const { package: pkg } = await createPackage(ctx(A), { name: 'Search test', roots: [{ type: 'workflow', id: root.id }], items: [{ type: 'integration', id: IDS.erp }] })
    const page = await searchPackageAssets(ctx(A), { search: 'Flow 00', package: pkg.slug })
    expect(page.assets.find((h) => h.id === root.id)?.in_package).toBe('root')
    expect(page.assets.filter((h) => h.id !== root.id).every((h) => h.in_package === null)).toBe(true)
    expect((await searchPackageAssets(ctx(A), { search: 'ERP', package: pkg.id })).assets[0].in_package).toBe('manual')
  })
})
