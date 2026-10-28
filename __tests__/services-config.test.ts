import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { writeAudit } from '@/lib/audit-log'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { PERMISSION_KEYS } from '@/lib/permissions'
import type { ServiceContext } from '@/lib/services/context'
import { applyConfig, CONFIG_LIMITS, exportConfig } from '@/lib/services/config'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const A = 'tenant-a'
const B = 'tenant-b'
const WF_A = 'a0000000-0000-4000-8000-000000000001'
const DT_A = 'a0000000-0000-4000-8000-000000000002'
const INT_A = 'a0000000-0000-4000-8000-000000000003'
const REF_A = 'a0000000-0000-4000-8000-000000000004'
const MCP_A = 'a0000000-0000-4000-8000-000000000005'
const AGENT_A = 'a0000000-0000-4000-8000-000000000006'
const WF_B = 'b0000000-0000-4000-8000-000000000001'
const DT_B = 'b0000000-0000-4000-8000-000000000002'

const SECRET_VALUES = ['plain-token-123', 'enc:v1:deadbeef', 'mcp-plain-secret', 'Bearer header-secret', 'pg-password', 'sk-agent-key']

function seed() {
  return createMemorySupabase({
    workflows: [
      {
        id: WF_A, tenant_id: A, name: 'Intake', description: null, trigger_type: 'manual', trigger_config: {}, is_active: false,
        nodes: [
          { id: 't1', type: 'manual', label: 'Manual Trigger', position: { x: 300, y: 20 }, config: {} },
          { id: 'n1', type: 'decision_table', label: 'Score', position: { x: 220, y: 160 }, config: { decision_table_id: DT_A } },
        ],
        edges: [{ id: 'e1', source: 't1', target: 'n1' }], user_variables: [], swimlanes: [],
        created_at: '2026-01-01', updated_at: '2026-01-02',
      },
      { id: WF_B, tenant_id: B, name: 'Foreign', description: null, trigger_type: 'manual', trigger_config: {}, nodes: [], edges: [], user_variables: [], swimlanes: [], is_active: false },
    ],
    decision_tables: [
      { id: DT_A, tenant_id: A, name: 'Risk', description: null, inputs: [{ key: 'amount' }], outputs: [{ key: 'tier' }], rules: [{ id: 'r1', outputs: { tier: 'gold' } }] },
      { id: DT_B, tenant_id: B, name: 'Foreign rules', description: null, inputs: [], outputs: [], rules: [] },
    ],
    integrations: [{
      id: INT_A, tenant_id: A, name: 'ERP', type: 'rest_api', is_active: true, tags: null,
      config: {
        base_url: 'https://erp.example',
        api_key: 'enc:v1:deadbeef',
        auth_config: { type: 'bearer', token: 'plain-token-123' },
        headers: { Authorization: 'Bearer header-secret', Accept: 'application/json' },
        db_config: { host: 'db', password: 'pg-password' },
      },
    }],
    integration_references: [{ id: REF_A, tenant_id: A, integration_id: INT_A, name: 'List orders', description: null, tags: null, request_config: { method: 'GET', path: '/orders' }, inputs: [], outputs: [] }],
    mcp_servers: [{ id: MCP_A, tenant_id: A, name: 'Docs MCP', url: 'https://mcp.example', auth_type: 'bearer', auth_config: { token: 'mcp-plain-secret' }, is_active: true }],
    agents: [{ id: AGENT_A, tenant_id: A, name: 'Helper', description: null, model: 'gpt-4o', system_prompt: 'Be nice', role: '', task: '', boundaries: '', tools: [REF_A], integration_id: null, output_config: { variables: [], openai_api_key: 'sk-agent-key' }, is_active: true }],
    roles: [
      { id: 'a0000000-0000-4000-8000-0000000000a1', tenant_id: A, name: 'Admin', slug: 'admin', description: null, permissions: [], is_system: true, retention_policy_id: null },
    ],
  }, { uuids: true })
}

type Db = ReturnType<typeof seed>

function ctx(db: Db, tenantId = A, permissions: readonly string[] = PERMISSION_KEYS): ServiceContext {
  return {
    supabase: db as unknown as ServiceContext['supabase'],
    tenantId,
    actorId: null,
    permissions: new Set(permissions),
    authKind: 'api_key',
    source: 'api',
  }
}

const allText = (files: Array<{ content: string }>) => files.map((f) => f.content).join('\n')

beforeEach(() => {
  vi.mocked(writeAudit).mockClear()
  vi.mocked(recordAssetChange).mockClear()
})

describe('exportConfig', () => {
  it('exports GitHub-sync layout files with every secret scrubbed', async () => {
    const result = await exportConfig(ctx(seed()))
    expect(result.skipped).toEqual([])
    const paths = result.files!.map((f) => f.path)
    expect(paths).toContain('manifest.json')
    expect(paths).toContain('workflows/intake-a0000000.json')
    expect(paths).toContain('references/list-orders-a0000000.json')
    const text = allText(result.files!)
    for (const secret of SECRET_VALUES) expect(text, secret).not.toContain(secret)
    expect(text).toContain('__SECRET__')
    expect(text).toContain('https://erp.example') // non-secret config survives
    expect(text).not.toContain('Foreign') // other tenant
    expect(text).not.toContain('"Admin"') // system roles never travel
  })

  it('intersects caller-supplied ids with the tenant', async () => {
    const db = seed()
    const result = await exportConfig(ctx(db), { ids: [WF_A, WF_B, DT_B, 'not-a-uuid'], format: 'manifest' })
    expect(result.manifest!.workflows.map((w: any) => w.id)).toEqual([WF_A])
    expect(result.manifest!.decision_tables).toBeUndefined()
    // Even when asked for directly by id, tenant B's assets stay invisible to tenant A.
    const foreign = await exportConfig(ctx(db), { ids: [WF_B, DT_B], format: 'manifest' })
    expect(Object.keys(foreign.manifest!)).toEqual(['format_version'])
  })

  it('filters by type and skips sections the caller cannot view', async () => {
    const result = await exportConfig(ctx(seed(), A, ['workflows.view']), { types: ['workflows', 'integrations', 'decision-tables'], format: 'manifest' })
    expect(result.skipped).toEqual([{ section: 'integrations', permission: 'integrations.view', reason: "missing permission 'integrations.view'" }])
    expect(Object.keys(result.manifest!).sort()).toEqual(['decision_tables', 'format_version', 'workflows'])
    await expect(exportConfig(ctx(seed()), { types: ['gizmos'] })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('limits resource-scoped keys to their allowlisted workflows', async () => {
    const scoped = { ...ctx(seed()), resourceScopes: { workflow_ids: ['a0000000-0000-4000-8000-00000000ffff'], table_ids: [] } }
    const result = await exportConfig(scoped, { types: ['workflows'], format: 'manifest' })
    expect(result.manifest!.workflows).toBeUndefined()
  })
})

async function exportFiles(db: Db, tenantId = A) {
  return (await exportConfig(ctx(db, tenantId))).files!
}

const rows = (db: Db, table: string, tenantId: string) => (db.tables[table] ?? []).filter((r) => r.tenant_id === tenantId)

describe('applyConfig', () => {
  it('re-applying a tenant export to the same tenant is all unchanged (self ids)', async () => {
    const db = seed()
    const files = await exportFiles(db)
    const plan = await applyConfig(ctx(db), { files, dry_run: true })
    // + the workspace theme (default on both sides)
    expect(plan.plan.summary).toEqual({ create: 0, update: 0, unchanged: 7, error: 0 })
    expect(plan.plan.assets.every((a) => a.matched_by === 'id')).toBe(true)
  })

  it('promotes between tenants: creates, records mappings, then updates instead of duplicating', async () => {
    const db = seed()
    const files = await exportFiles(db)

    const first = await applyConfig(ctx(db, B), { files, source_label: 'dev' })
    expect(first.plan.summary).toMatchObject({ create: 6, update: 0, error: 0 })
    expect(first.result!.errors).toEqual([])
    expect(rows(db, 'workflows', B).map((w) => w.name).sort()).toEqual(['Foreign', 'Intake'])
    const created = rows(db, 'workflows', B).find((w) => w.name === 'Intake')!
    const localDt = rows(db, 'decision_tables', B).find((d) => d.name === 'Risk')!
    // Cross-references are remapped to tenant B's new ids.
    expect(created.nodes[1].config.decision_table_id).toBe(localDt.id)
    const maps = db.tables.github_sync_asset_map.filter((m) => m.tenant_id === B)
    expect(maps.find((m) => m.source_id === WF_A)).toMatchObject({ asset_type: 'workflow', local_id: created.id, source_repo: 'cli:dev' })
    // Secrets were not carried over: the placeholder is dropped on create.
    expect(JSON.stringify(rows(db, 'integrations', B))).not.toContain('__SECRET__')

    const again = await applyConfig(ctx(db, B), { files, source_label: 'dev' })
    expect(again.plan.summary).toMatchObject({ create: 0, update: 0, unchanged: 7, error: 0 })
    expect(again.plan.assets.find((a) => a.section === 'workflows')).toMatchObject({ matched_by: 'mapping', local_id: created.id })
    expect(rows(db, 'workflows', B)).toHaveLength(2)
    expect(rows(db, 'integration_references', B)).toHaveLength(1)

    // Edit one file → exactly one update with a field diff, applied in place.
    const edited = files.map((f) => f.path.startsWith('decision-tables/')
      ? { ...f, content: f.content.replace('"gold"', '"platinum"') }
      : f)
    const diff = await applyConfig(ctx(db, B), { files: edited, dry_run: true })
    expect(diff.plan.summary).toMatchObject({ update: 1, unchanged: 6 })
    expect(diff.plan.assets.find((a) => a.action === 'update')).toMatchObject({ section: 'decision_tables', diffs: [{ path: 'rules[0].outputs.tier', before: 'gold', after: 'platinum' }] })
    await applyConfig(ctx(db, B), { files: edited })
    expect(rows(db, 'decision_tables', B).find((d) => d.name === 'Risk')!.rules[0].outputs.tier).toBe('platinum')
    expect(rows(db, 'decision_tables', B)).toHaveLength(2)
  })

  it('applies a rotated credential (e.g. from ${env:}) and keeps the stored one for __SECRET__', async () => {
    const db = seed()
    const files = (await exportFiles(db)).filter((f) => f.path.startsWith('integrations/') || f.path.startsWith('references/'))
    const withToken = (token: string, baseUrl = 'https://erp.example') => files.map((f) => f.path.startsWith('integrations/')
      ? { ...f, content: f.content.replace('"token": "__SECRET__"', `"token": ${JSON.stringify(token)}`).replace('https://erp.example', baseUrl) }
      : f)
    const stored = () => db.tables.integrations.find((i) => i.id === INT_A)!.config

    expect((await applyConfig(ctx(db), { files: withToken('plain-token-123'), dry_run: true })).plan.summary.update).toBe(0)
    const rotated = await applyConfig(ctx(db), { files: withToken('rotated-456') })
    expect(rotated.plan.assets.find((a) => a.section === 'integrations')).toMatchObject({ action: 'update', diffs: [{ path: 'config.auth_config.token', before: '__SECRET__', after: '__SECRET__' }] })
    expect(JSON.stringify(rotated)).not.toContain('rotated-456')
    expect(stored().auth_config.token).toBe('rotated-456')

    // Sentinel + another change: the stored credentials survive the update.
    await applyConfig(ctx(db), { files: withToken('__SECRET__', 'https://erp2.example') })
    expect(stored()).toMatchObject({ base_url: 'https://erp2.example', auth_config: { token: 'rotated-456' }, db_config: { password: 'pg-password' }, headers: { Authorization: 'Bearer header-secret' } })
  })

  it('adopt_by_name maps unmapped assets onto unique same-name local assets', async () => {
    const db = seed()
    const files = (await exportFiles(db)).filter((f) => f.path.startsWith('decision-tables/'))
    db.tables.decision_tables.push({ id: 'c0000000-0000-4000-8000-000000000001', tenant_id: B, name: 'Risk', description: null, inputs: [], outputs: [], rules: [] })

    const without = await applyConfig(ctx(db, B), { files, dry_run: true })
    expect(without.plan.assets[0].action).toBe('create')
    const adopted = await applyConfig(ctx(db, B), { files, adopt_by_name: true })
    expect(adopted.plan.assets[0]).toMatchObject({ action: 'update', matched_by: 'name', local_id: 'c0000000-0000-4000-8000-000000000001' })
    expect(rows(db, 'decision_tables', B).filter((d) => d.name === 'Risk')).toHaveLength(1)
    // The adoption is recorded, so later applies match without the flag.
    const later = await applyConfig(ctx(db, B), { files, dry_run: true })
    expect(later.plan.assets[0]).toMatchObject({ action: 'unchanged', matched_by: 'mapping' })
  })

  it('dry runs never write', async () => {
    const db = seed()
    const files = await exportFiles(db)
    const calls = db.calls.length
    vi.mocked(writeAudit).mockClear()
    await applyConfig(ctx(db, B), { files, dry_run: true })
    expect(db.calls.slice(calls)).toEqual([])
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it('refuses up front without view permission, and without create/edit on a real apply', async () => {
    const db = seed()
    const files = await exportFiles(db)
    await expect(applyConfig(ctx(db, B, ['workflows.view']), { files, dry_run: true })).rejects.toMatchObject({
      status: 403,
      details: { missing: expect.arrayContaining([{ section: 'integrations', permission: 'integrations.view' }]) },
    })
    const viewOnly = PERMISSION_KEYS.filter((p) => p.endsWith('.view') || p === 'team.view_members')
    const dry = await applyConfig(ctx(db, B, viewOnly), { files, dry_run: true })
    expect(dry.missing_permissions).toEqual(expect.arrayContaining([{ section: 'workflows', permission: 'workflows.create' }]))
    await expect(applyConfig(ctx(db, B, viewOnly), { files })).rejects.toMatchObject({ status: 403 })
    expect(rows(db, 'workflows', B)).toHaveLength(1)
  })

  it('rejects resource-scoped keys, oversized payloads and too many assets', async () => {
    const db = seed()
    const scoped = { ...ctx(db, B), resourceScopes: { workflow_ids: [WF_B], table_ids: [] } }
    await expect(applyConfig(scoped, { manifest: {} })).rejects.toMatchObject({ status: 403 })
    const huge = 'x'.repeat(CONFIG_LIMITS.maxBytes + 1)
    await expect(applyConfig(ctx(db, B), { files: [{ path: 'a.json', content: huge }] })).rejects.toMatchObject({ status: 413 })
    const many = Array.from({ length: CONFIG_LIMITS.maxAssets + 1 }, (_, i) => ({ id: `d${i}`, name: `t${i}` }))
    await expect(applyConfig(ctx(db, B), { manifest: { decision_tables: many } })).rejects.toMatchObject({ status: 413 })
    await expect(applyConfig(ctx(db, B), {})).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('reports malformed files and invalid assets as plan errors', async () => {
    const db = seed()
    const result = await applyConfig(ctx(db, B), {
      dry_run: true,
      files: [
        { path: 'workflows/broken.json', content: '{' },
        { path: 'workflows/no-id.json', content: JSON.stringify({ asset_type: 'workflows', asset: { name: 'No id' } }) },
      ],
    })
    expect(result.plan.summary.error).toBe(2)
    expect(result.plan.assets.map((a) => a.file)).toEqual(['workflows/broken.json', 'workflows/no-id.json'])
  })

  it('audits real applies and queues GitHub sync for changed assets when sync is on', async () => {
    const db = seed()
    db.tables.tenant_connectors = [{ id: 'c1', tenant_id: B, connector_key: 'github_sync', is_enabled: true, config: {} }]
    const files = (await exportFiles(db)).filter((f) => f.path.startsWith('decision-tables/') || f.path === 'manifest.json')
    await applyConfig(ctx(db, B), { files })
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: B, objectType: 'config', action: 'import' }))
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ tenantId: B, assetType: 'decision_table', assetName: 'Risk' }))
  })
})
