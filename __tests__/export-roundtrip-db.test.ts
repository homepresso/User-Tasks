/**
 * Config export → apply round trip (lib/services/config) against a LOCAL
 * Supabase stack, through the service-role REST client:
 *  - tenant A is seeded with one asset of every exportable type (a workflow
 *    whose nodes point at a decision table, a custom activity, a data table,
 *    an integration reference and an email template; an agent, a report, a
 *    retention policy, a custom role, an MCP server and an Ollama connector);
 *  - with_dependencies from the workflow alone pulls in what it needs;
 *  - exporting everything (with rows) and applying it into tenant B, then
 *    re-exporting B, gives the same manifest modulo ids / timestamps / tenant;
 *  - a second dry run plans no creates or updates, a second real apply does
 *    not duplicate rows, and rows_mode replace / skip behave.
 *
 * No secrets are seeded, so it runs without ENCRYPTION_KEY.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/export-roundtrip-db.test.ts
 * API: LOCKDOWN_SUPABASE_URL / LOCKDOWN_SERVICE_ROLE_KEY, defaulting to the
 * standard local stack and its public demo key.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { applyConfig, exportConfig } from '@/lib/services/config'
import { createConnector } from '@/lib/services/connectors'
import { createEmailTemplate } from '@/lib/services/email-templates'
import { normalizeScaffoldDecisionTable, normalizeScaffoldReportConfig, normalizeScaffoldWorkflow } from '@/lib/portability/normalize'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `e7c0f000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const TENANT_A = id(0xa)
const TENANT_B = id(0xb)
const IDS = {
  workflow: id(0x101),
  decisionTable: id(0x102),
  activity: id(0x103),
  dataTable: id(0x104),
  integration: id(0x105),
  reference: id(0x106),
  agent: id(0x107),
  report: id(0x108),
  retention: id(0x109),
  role: id(0x10a),
  mcp: id(0x10b),
}
const ROW_IDS = [id(0x201), id(0x202), id(0x203)]
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

/** Volatile fields that legitimately differ between workspaces. */
const VOLATILE = new Set(['tenant_id', 'created_at', 'updated_at', 'created_by', 'updated_by'])

/** Replace every string equal to a B-local id with its A source id; drop volatile keys. */
function canonical(value: unknown, localToSource: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => canonical(item, localToSource))
  if (typeof value === 'string') return localToSource.get(value) ?? value
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (VOLATILE.has(key)) continue
    out[key] = canonical((value as Record<string, unknown>)[key], localToSource)
  }
  return out
}

/** Canonical manifest: sections sorted by id (rows by id too). */
function normaliseManifest(manifest: Record<string, any>, localToSource = new Map<string, string>()) {
  const out = canonical(manifest, localToSource) as Record<string, any>
  const byId = (a: any, b: any) => String(a?.id ?? a?.generated_reference_id ?? '').localeCompare(String(b?.id ?? b?.generated_reference_id ?? ''))
  for (const [section, list] of Object.entries(out)) {
    if (!Array.isArray(list)) continue
    list.sort(byId)
    if (section === 'table_rows') for (const set of list) set.rows?.sort(byId)
    if (section === 'connectors') for (const c of list) c.generated_references?.sort(byId)
  }
  return out
}

describe.skipIf(!DB_URL)('config export / apply round trip (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const prevEnv = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  const ctx = (tenantId: string): ServiceContext => ({ supabase: admin, tenantId, actorId: null, permissions: null, authKind: 'session', source: 'ui' })
  const seeded = { emailTemplate: '', connector: '', connectorIntegration: '', connectorReferences: [] as string[] }
  let sourceManifest: Record<string, any>

  async function cleanup() {
    for (const t of [TENANT_A, TENANT_B]) {
      for (const table of ['github_sync_asset_map', 'agents', 'tenant_connectors', 'workflow_versions', 'workflow_logs', 'object_audit_log']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      // Cascades to workflows, tables + rows, integrations + references, roles, …
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t])
    }
  }

  const count = async (sql: string, params: unknown[]) => Number((await db.query(sql, params)).rows[0].count)
  const rowCount = (tenantId: string) => count('SELECT count(*) FROM public.custom_table_rows WHERE tenant_id = $1', [tenantId])
  const allIdsA = () => [...Object.values(IDS), seeded.emailTemplate, seeded.connector]

  /** B-local id → A source id, from the recorded mappings (assets, generated ids, rows). */
  async function localToSourceB() {
    const { rows } = await db.query('SELECT source_id, local_id FROM public.github_sync_asset_map WHERE tenant_id = $1', [TENANT_B])
    return new Map<string, string>(rows.map((r) => [String(r.local_id), String(r.source_id)]))
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Roundtrip A', 'roundtrip-a-test'), ($2, 'Roundtrip B', 'roundtrip-b-test')`, [TENANT_A, TENANT_B])

    const a = ctx(TENANT_A)
    const template = await createEmailTemplate(a, { name: 'Roundtrip notice', description: 'Round-trip test', subject: 'Hello {{name}}', html_body: '<p>Hello {{name}}</p>', text_body: 'Hello {{name}}' })
    seeded.emailTemplate = template.id
    const connector: any = await createConnector(a, { connector_key: 'ollama', display_name: 'Roundtrip Ollama', config: { base_url: 'http://127.0.0.1:11434', default_model: 'llama3.1' } })
    const { rows: [conn] } = await db.query('SELECT id, integration_id FROM public.tenant_connectors WHERE tenant_id = $1', [TENANT_A])
    seeded.connector = String(conn?.id ?? connector?.id)
    seeded.connectorIntegration = String(conn.integration_id)
    seeded.connectorReferences = (await db.query('SELECT id FROM public.integration_references WHERE integration_id = $1', [conn.integration_id])).rows.map((r) => String(r.id))
    expect(seeded.connectorReferences.length).toBeGreaterThan(0)

    await db.query(
      `INSERT INTO public.custom_tables (id, tenant_id, name, slug, description, columns) VALUES ($1, $2, 'Roundtrip customers', 'roundtrip-customers', 'Customers', $3)`,
      [IDS.dataTable, TENANT_A, JSON.stringify([{ id: 'c1', key: 'name', name: 'Name', type: 'text' }, { id: 'c2', key: 'tier', name: 'Tier', type: 'text' }])],
    )
    for (const [index, rowId] of ROW_IDS.entries()) {
      await db.query(
        `INSERT INTO public.custom_table_rows (id, tenant_id, table_id, data, created_at) VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
        [rowId, TENANT_A, IDS.dataTable, JSON.stringify({ name: `Customer ${index + 1}`, tier: index === 0 ? 'gold' : 'silver' }), String(index)],
      )
    }

    const decision = normalizeScaffoldDecisionTable({
      inputs: [{ id: 'in-tier', key: 'tier', label: 'Tier', type: 'text' }],
      outputs: [{ id: 'out-discount', key: 'discount', label: 'Discount', type: 'number' }],
      rules: [{ id: 'rule-gold', label: 'Gold', enabled: true, conditions: [{ id: 'cond-1', inputKey: 'tier', operator: 'equals', value: 'gold' }], outputs: { discount: 10 } }],
    })
    await db.query(
      `INSERT INTO public.decision_tables (id, tenant_id, name, description, inputs, outputs, rules) VALUES ($1, $2, 'Roundtrip discounts', 'Discount by tier', $3, $4, $5)`,
      [IDS.decisionTable, TENANT_A, JSON.stringify(decision.inputs), JSON.stringify(decision.outputs), JSON.stringify(decision.rules)],
    )
    await db.query(
      `INSERT INTO public.custom_workflow_activities (id, tenant_id, name, description, key, status, source_code, manifest, tags)
       VALUES ($1, $2, 'Roundtrip score', 'Scores a customer', 'roundtrip_score', 'active', 'export default async () => ({ score: 1 })', $3, '{roundtrip}')`,
      [IDS.activity, TENANT_A, JSON.stringify({ inputs: [{ key: 'name', type: 'string' }], outputs: [{ key: 'score', type: 'number' }] })],
    )
    await db.query(
      `INSERT INTO public.integrations (id, tenant_id, name, type, config, tags) VALUES ($1, $2, 'Roundtrip API', 'rest_api', $3, '{roundtrip}')`,
      [IDS.integration, TENANT_A, JSON.stringify({ base_url: 'https://api.example.test', auth_type: 'none', auth_config: {} })],
    )
    await db.query(
      `INSERT INTO public.integration_references (id, tenant_id, integration_id, name, description, request_config, inputs, outputs)
       VALUES ($1, $2, $3, 'Lookup customer', 'GET a customer', $4, $5, $6)`,
      [IDS.reference, TENANT_A, IDS.integration, JSON.stringify({ method: 'GET', path: '/customers/{{name}}' }), JSON.stringify([{ name: 'name', type: 'string' }]), JSON.stringify([{ name: 'id', type: 'string' }])],
    )
    await db.query(
      `INSERT INTO public.retention_policies (id, tenant_id, name, description, policy_mode, duration_value, duration_unit, applies_to)
       VALUES ($1, $2, 'Roundtrip retention', 'Review yearly', 'review', 1, 'years', '{data_tables,roles}')`,
      [IDS.retention, TENANT_A],
    )
    await db.query(
      `INSERT INTO public.roles (id, tenant_id, name, slug, description, permissions, is_system, retention_policy_id)
       VALUES ($1, $2, 'Roundtrip auditor', 'roundtrip_auditor', 'Reads things', '{workflows.view,data.view}', false, $3)`,
      [IDS.role, TENANT_A, IDS.retention],
    )
    await db.query(
      `INSERT INTO public.mcp_servers (id, tenant_id, name, url, auth_type, auth_config) VALUES ($1, $2, 'Roundtrip MCP', 'https://mcp.example.test/sse', 'none', '{}')`,
      [IDS.mcp, TENANT_A],
    )
    await db.query(
      `INSERT INTO public.agents (id, tenant_id, name, description, model, system_prompt, role, task, boundaries, tools, integration_id, output_config)
       VALUES ($1, $2, 'Roundtrip agent', 'Looks customers up', 'gpt-4o', 'Be brief', 'Clerk', 'Find the customer', 'Read only', $3, $4, $5)`,
      [IDS.agent, TENANT_A, JSON.stringify([IDS.reference, seeded.connectorReferences[0]]), IDS.integration, JSON.stringify({ variables: [{ name: 'customer_id', type: 'string' }] })],
    )
    const reportConfig = normalizeScaffoldReportConfig({ data_source: IDS.dataTable, visualization: 'table', columns: ['name', 'tier'], row_limit: 50 })
    await db.query(
      `INSERT INTO public.reports (id, tenant_id, name, description, category, config, is_shared) VALUES ($1, $2, 'Roundtrip report', 'Customers by tier', 'sales', $3, true)`,
      [IDS.report, TENANT_A, JSON.stringify(reportConfig)],
    )
    const workflow = normalizeScaffoldWorkflow({
      name: 'Roundtrip workflow',
      trigger_type: 'manual',
      trigger_config: {},
      nodes: [
        { id: 'trigger', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} },
        { id: 'rules', type: 'decision_table', label: 'Discount', position: { x: 0, y: 100 }, config: { decision_table_id: IDS.decisionTable, input_mappings: { tier: '{{tier}}' } } },
        { id: 'score', type: 'custom_activity', label: 'Score', position: { x: 0, y: 200 }, config: { custom_activity_id: IDS.activity, custom_activity_key: 'roundtrip_score', input_mappings: { name: '{{name}}' } } },
        { id: 'save', type: 'update_data_table', label: 'Save', position: { x: 0, y: 300 }, config: { table_id: IDS.dataTable, operation: 'insert', column_values: { name: '{{name}}' } } },
        { id: 'lookup', type: 'call_reference', label: 'Lookup', position: { x: 0, y: 400 }, config: { reference_id: IDS.reference } },
        { id: 'mail', type: 'send_email', label: 'Mail', position: { x: 0, y: 500 }, config: { to: 'ops@example.test', email_template_id: seeded.emailTemplate } },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'rules' },
        { id: 'e2', source: 'rules', target: 'score' },
        { id: 'e3', source: 'score', target: 'save' },
        { id: 'e4', source: 'save', target: 'lookup' },
        { id: 'e5', source: 'lookup', target: 'mail' },
      ],
    })
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, description, trigger_type, trigger_config, nodes, edges, user_variables, swimlanes, is_active)
       VALUES ($1, $2, $3, 'Round trip', $4, $5, $6, $7, '[]', '[]', false)`,
      [IDS.workflow, TENANT_A, workflow.name, workflow.trigger_type, JSON.stringify(workflow.trigger_config ?? {}), JSON.stringify(workflow.nodes), JSON.stringify(workflow.edges)],
    )
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevEnv.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevEnv.key
  })

  it('with_dependencies from the workflow pulls in what its nodes reference', async () => {
    const { manifest, skipped } = await exportConfig(ctx(TENANT_A), { ids: [IDS.workflow], with_dependencies: true, format: 'manifest' })
    expect(skipped).toEqual([])
    const idsOf = (section: string) => ((manifest![section] ?? []) as any[]).map((asset) => asset.id).sort()
    expect(idsOf('workflows')).toEqual([IDS.workflow])
    expect(idsOf('decision_tables')).toEqual([IDS.decisionTable])
    expect(idsOf('workflow_activities')).toEqual([IDS.activity])
    expect(idsOf('data_tables')).toEqual([IDS.dataTable])
    expect(idsOf('integrations')).toEqual([IDS.integration])
    expect(idsOf('references')).toEqual([IDS.reference])
    expect(idsOf('email_templates')).toEqual([seeded.emailTemplate])
    // Unrelated assets stay out, and the theme only travels when named.
    for (const section of ['agents', 'reports', 'roles', 'mcp_servers', 'retention_policies', 'connectors']) expect(manifest![section]).toBeUndefined()
    expect(manifest!.workspace_theme).toBeUndefined()
  })

  it('exports every seeded asset with its rows', async () => {
    const { manifest, skipped } = await exportConfig(ctx(TENANT_A), { ids: allIdsA(), with_dependencies: true, include_rows: true, format: 'manifest' })
    expect(skipped).toEqual([])
    sourceManifest = manifest!
    const lengths = Object.fromEntries(Object.entries(sourceManifest).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as any[]).length]))
    expect(lengths).toEqual({
      workflows: 1, decision_tables: 1, workflow_activities: 1, data_tables: 1, integrations: 1, references: 1,
      agents: 1, reports: 1, retention_policies: 1, roles: 1, mcp_servers: 1, email_templates: 1, connectors: 1, table_rows: 1,
    })
    expect(sourceManifest.table_rows[0]).toMatchObject({ id: IDS.dataTable, name: 'Roundtrip customers rows' })
    expect(sourceManifest.table_rows[0].rows.map((r: any) => r.id)).toEqual(ROW_IDS)
    expect(sourceManifest.connectors[0]).toMatchObject({ connector_key: 'ollama', generated_integration_id: seeded.connectorIntegration })
  })

  it('applies into another workspace and re-exports identically (modulo ids)', async () => {
    const applied = await applyConfig(ctx(TENANT_B), { manifest: sourceManifest, source_label: 'roundtrip' })
    expect(applied.result!.errors).toEqual([])
    expect(applied.plan.summary.error).toBe(0)
    expect(applied.plan.assets.filter((a) => a.section !== 'table_rows').every((a) => a.action === 'create')).toBe(true)
    expect(applied.result!.rows).toEqual([expect.objectContaining({ table_id: IDS.dataTable, inserted: 3, updated: 0, deleted: 0 })])
    expect(await rowCount(TENANT_B)).toBe(3)

    const map = await localToSourceB()
    const localIds = [...map.keys()]
    const { manifest } = await exportConfig(ctx(TENANT_B), { ids: localIds, with_dependencies: true, include_rows: true, format: 'manifest' })
    // Nothing exported from B still carries an A id: everything was created anew
    // and every cross-reference was remapped (the id map below would hide a miss).
    expect(localIds.every((local) => !Object.values(IDS).includes(local))).toBe(true)
    const raw = JSON.stringify(manifest)
    for (const sourceId of [...Object.values(IDS), ...ROW_IDS, seeded.emailTemplate, seeded.connector, seeded.connectorIntegration, ...seeded.connectorReferences]) expect(raw).not.toContain(sourceId)
    expect(normaliseManifest(manifest!)).not.toEqual(normaliseManifest(sourceManifest))
    expect(normaliseManifest(manifest!, map)).toEqual(normaliseManifest(sourceManifest))
  })

  it('a second dry run plans no creates or updates', async () => {
    const dry = await applyConfig(ctx(TENANT_B), { manifest: sourceManifest, dry_run: true, source_label: 'roundtrip', rows_mode: 'skip' })
    const changed = dry.plan.assets.filter((a) => a.action !== 'unchanged')
    expect(changed).toEqual([])
    expect(dry.plan.summary).toMatchObject({ create: 0, update: 0, error: 0 })
    expect(dry.plan.assets.filter((a) => a.section !== 'table_rows').every((a) => a.matched_by === 'mapping')).toBe(true)

    // With rows the only pending work is the row set itself (rows are always rewritten).
    const withRows = await applyConfig(ctx(TENANT_B), { manifest: sourceManifest, dry_run: true, source_label: 'roundtrip' })
    expect(withRows.plan.summary).toMatchObject({ create: 0, update: 1, error: 0 })
    expect(withRows.plan.assets.filter((a) => a.action === 'update').map((a) => a.section)).toEqual(['table_rows'])
  })

  it('a second real apply (merge) updates rows in place instead of duplicating them', async () => {
    const before = (await db.query('SELECT id FROM public.custom_table_rows WHERE tenant_id = $1 ORDER BY id', [TENANT_B])).rows.map((r) => r.id)
    const applied = await applyConfig(ctx(TENANT_B), { manifest: sourceManifest, source_label: 'roundtrip', rows_mode: 'merge' })
    expect(applied.result!.errors).toEqual([])
    expect(applied.result!.created).toEqual({})
    expect(applied.result!.rows).toEqual([expect.objectContaining({ inserted: 0, updated: 3, deleted: 0 })])
    expect(await rowCount(TENANT_B)).toBe(await rowCount(TENANT_A))
    const after = (await db.query('SELECT id FROM public.custom_table_rows WHERE tenant_id = $1 ORDER BY id', [TENANT_B])).rows.map((r) => r.id)
    expect(after).toEqual(before)
    // Asset counts did not grow either.
    for (const table of ['workflows', 'decision_tables', 'custom_workflow_activities', 'custom_tables', 'agents', 'reports', 'retention_policies', 'mcp_servers', 'tenant_connectors']) {
      expect(await count(`SELECT count(*) FROM public.${table} WHERE tenant_id = $1`, [TENANT_B]), table).toBe(1)
    }
  })

  it("rows_mode 'replace' keeps the row count and 'skip' writes nothing", async () => {
    const replaced = await applyConfig(ctx(TENANT_B), { manifest: sourceManifest, source_label: 'roundtrip', rows_mode: 'replace' })
    expect(replaced.result!.rows).toEqual([expect.objectContaining({ inserted: 3, deleted: 3 })])
    expect(await rowCount(TENANT_B)).toBe(3)
    const snapshot = (await db.query('SELECT id, data, updated_at FROM public.custom_table_rows WHERE tenant_id = $1 ORDER BY id', [TENANT_B])).rows

    // Edit a row in B: skip must leave it alone.
    await db.query(`UPDATE public.custom_table_rows SET data = data || '{"tier":"edited"}' WHERE id = $1`, [snapshot[0].id])
    const skipped = await applyConfig(ctx(TENANT_B), { manifest: sourceManifest, source_label: 'roundtrip', rows_mode: 'skip' })
    expect(skipped.result!.rows).toBeUndefined()
    const afterSkip = (await db.query('SELECT id, data FROM public.custom_table_rows WHERE tenant_id = $1 ORDER BY id', [TENANT_B])).rows
    expect(afterSkip.map((r) => r.id)).toEqual(snapshot.map((r) => r.id))
    expect(afterSkip[0].data.tier).toBe('edited')

    // And merge after replace still maps onto the replaced rows.
    const merged = await applyConfig(ctx(TENANT_B), { manifest: sourceManifest, source_label: 'roundtrip' })
    expect(merged.result!.rows).toEqual([expect.objectContaining({ inserted: 0, updated: 3 })])
    expect(await rowCount(TENANT_B)).toBe(3)
  })
})
