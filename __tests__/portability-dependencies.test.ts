/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/portability/export', () => ({ buildManifestExport: vi.fn() }))

import { buildManifestExport } from '@/lib/portability/export'
import { resolveDependencyClosure, scanAssetReferences } from '@/lib/portability/dependencies'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('scanAssetReferences', () => {
  it('finds ids under ID_KEY_TO_MAP keys, including nested workflow node data, with paths', () => {
    const workflow = {
      id: u(1),
      name: 'Intake',
      nodes: [
        { id: 'n1', type: 'sub_workflow', data: { sub_workflow_id: u(2) } },
        { id: 'n2', type: 'decision', data: { config: { decisionTableId: u(3) } } },
        { id: 'n3', type: 'query', data: { table_id: u(4), dataSource: u(5) } },
        { id: 'n4', type: 'send_email', data: { email_template_id: u(6), role_id: u(7), mcp_server_id: u(8) } },
      ],
    }
    const { refs } = scanAssetReferences(workflow)
    expect(refs).toEqual([
      { type: 'workflow', id: u(2), path: ['nodes', 0, 'data', 'sub_workflow_id'] },
      { type: 'decision_table', id: u(3), path: ['nodes', 1, 'data', 'config', 'decisionTableId'] },
      { type: 'data_table', id: u(4), path: ['nodes', 2, 'data', 'table_id'] },
      { type: 'data_table', id: u(5), path: ['nodes', 2, 'data', 'dataSource'] },
      { type: 'email_template', id: u(6), path: ['nodes', 3, 'data', 'email_template_id'] },
      { type: 'role', id: u(7), path: ['nodes', 3, 'data', 'role_id'] },
      { type: 'mcp_server', id: u(8), path: ['nodes', 3, 'data', 'mcp_server_id'] },
    ])
  })

  it('reports reference ids, custom activity keys and id arrays', () => {
    const { refs, activityKeys } = scanAssetReferences({
      data: { reference_id: u(10), custom_activity_key: '  enrich_lead ', custom_activity_id: u(11) },
      tools: [u(12), 'not-a-uuid', u(13)],
      filters: { workflow_ids: [u(14)] },
      trigger: { policy_ids: [u(15), 7] },
    })
    expect(refs).toEqual([
      { type: 'reference', id: u(10), path: ['data', 'reference_id'] },
      { type: 'workflow_activity', id: u(11), path: ['data', 'custom_activity_id'] },
      { type: 'reference', id: u(12), path: ['tools', 0] },
      { type: 'reference', id: u(13), path: ['tools', 2] },
      { type: 'workflow', id: u(14), path: ['filters', 'workflow_ids', 0] },
      { type: 'retention_policy', id: u(15), path: ['trigger', 'policy_ids', 0] },
    ])
    expect(activityKeys).toEqual(['enrich_lead'])
  })

  it('reports user and team keys as people, not refs', () => {
    const { refs, people } = scanAssetReferences({
      nodes: [{ data: { assignee_id: u(20), team_id: u(21), escalation_user_id: u(22), assign_to_team_id: u(23) } }],
    })
    expect(refs).toEqual([])
    expect(people).toEqual([
      { kind: 'user', id: u(20), path: ['nodes', 0, 'data', 'assignee_id'] },
      { kind: 'team', id: u(21), path: ['nodes', 0, 'data', 'team_id'] },
      { kind: 'user', id: u(22), path: ['nodes', 0, 'data', 'escalation_user_id'] },
      { kind: 'team', id: u(23), path: ['nodes', 0, 'data', 'assign_to_team_id'] },
    ])
  })

  it('ignores non-uuid strings, unmapped keys, empty activity keys and non-objects', () => {
    const result = scanAssetReferences({
      id: u(30),
      workflow_id: 'wf-intake',
      table_id: 'tbl_tickets',
      assignee_id: '{{ trigger.user }}',
      other_id: u(31),
      custom_activity_key: '   ',
      tools: 'not-an-array',
    })
    expect(result).toEqual({ refs: [], activityKeys: [], people: [] })
    expect(scanAssetReferences(null)).toEqual({ refs: [], activityKeys: [], people: [] })
    expect(scanAssetReferences('x')).toEqual({ refs: [], activityKeys: [], people: [] })
  })
})

/** Minimal chainable supabase fake: every query resolves to `tables[name]`. */
function fakeSupabase(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const result = { data: tables[table] ?? [], error: null }
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
      }
      return chain
    },
  }
}

describe('resolveDependencyClosure', () => {
  const exportMock = vi.mocked(buildManifestExport)
  beforeEach(() => { exportMock.mockReset() })

  it('walks workflow → sub-workflow, decision table and reference → integration; reports missing ids and people', async () => {
    const assets: Record<string, Record<string, any>> = {
      [`workflow:${u(1)}`]: { section: 'workflows', asset: { id: u(1), name: 'Root', nodes: [{ data: { sub_workflow_id: u(2), reference_id: u(50), assignee_id: u(90) } }] } },
      [`workflow:${u(2)}`]: { section: 'workflows', asset: { id: u(2), name: 'Child', nodes: [{ data: { decision_table_id: u(3), report_id: u(99) } }] } },
      [`decision_table:${u(3)}`]: { section: 'decision_tables', asset: { id: u(3), name: 'Rates' } },
      [`integration:${u(60)}`]: { section: 'integrations', asset: { id: u(60), name: 'ERP' } },
    }
    exportMock.mockImplementation(async (_supabase, _tenant, idsByType) => {
      const manifest: Record<string, any[]> = {}
      for (const [type, ids] of Object.entries(idsByType)) {
        for (const id of ids ?? []) {
          const hit = assets[`${type}:${id}`]
          if (hit) (manifest[hit.section] ??= []).push(hit.asset)
        }
      }
      return manifest as any
    })
    const supabase = fakeSupabase({
      tenant_connectors: [],
      integration_references: [{ id: u(50), integration_id: u(60) }],
      custom_workflow_activities: [],
      roles: [],
    })

    const closure = await resolveDependencyClosure(supabase, 't1', [{ type: 'workflow', id: u(1) }])
    expect(closure.items).toEqual([
      { type: 'workflow', id: u(1), name: 'Root', required_by: 'root' },
      { type: 'workflow', id: u(2), name: 'Child', required_by: { type: 'workflow', id: u(1) } },
      { type: 'integration', id: u(60), name: 'ERP', required_by: { type: 'workflow', id: u(1) } },
      { type: 'decision_table', id: u(3), name: 'Rates', required_by: { type: 'workflow', id: u(2) } },
    ])
    expect(closure.missing).toEqual([{ type: 'report', id: u(99), required_by: { type: 'workflow', id: u(2) } }])
    expect(closure.people).toEqual([{ kind: 'user', id: u(90), section: 'workflows', asset_id: u(1), path: ['nodes', 0, 'data', 'assignee_id'] }])
    expect(closure.system_roles).toEqual([])
  })

  it('pulls in a workflow\'s linked forms, their saved themes (also a start form\'s) and option-source tables', async () => {
    const assets: Record<string, Record<string, any>> = {
      [`workflow:${u(1)}`]: {
        section: 'workflows',
        asset: {
          id: u(1), name: 'Intake',
          nodes: [
            { id: 't', type: 'manual', config: { start_form: { layout: null, theme: { source: 'saved', theme_id: u(31) } } } },
            { id: 'n1', type: 'user_task', config: { form_id: u(20), form_name: 'Review', fields: [] } },
          ],
        },
      },
      [`form:${u(20)}`]: { section: 'forms', asset: { id: u(20), name: 'Review', fields: [{ key: 'c', type: 'choice', options_source: { table_id: u(40), column: 'name' } }], theme: { source: 'saved', theme_id: u(30) } } },
      [`form_theme:${u(30)}`]: { section: 'form_themes', asset: { id: u(30), name: 'Brand', overrides: {} } },
      [`form_theme:${u(31)}`]: { section: 'form_themes', asset: { id: u(31), name: 'Start', overrides: {} } },
      [`data_table:${u(40)}`]: { section: 'data_tables', asset: { id: u(40), name: 'Vendors' } },
    }
    exportMock.mockImplementation(async (_supabase, _tenant, idsByType) => {
      const manifest: Record<string, any[]> = {}
      for (const [type, ids] of Object.entries(idsByType)) {
        for (const id of ids ?? []) {
          const hit = assets[`${type}:${id}`]
          if (hit) (manifest[hit.section] ??= []).push(hit.asset)
        }
      }
      return manifest as any
    })
    const closure = await resolveDependencyClosure(fakeSupabase({ tenant_connectors: [], integration_references: [], custom_workflow_activities: [], roles: [] }), 't1', [{ type: 'workflow', id: u(1) }])
    expect(closure.items.map(({ type, id, required_by }) => ({ type, id, by: required_by === 'root' ? 'root' : required_by.id }))).toEqual(expect.arrayContaining([
      { type: 'form', id: u(20), by: u(1) },
      { type: 'form_theme', id: u(31), by: u(1) },
      { type: 'form_theme', id: u(30), by: u(20) },
      { type: 'data_table', id: u(40), by: u(20) },
    ]))
    expect(closure.items).toHaveLength(5)
    expect(closure.missing).toEqual([])
  })

  it('brings a workflow\'s form page (the form links to the workflow, not the other way round)', async () => {
    const page = { id: u(21), name: 'Intake — start form', fields: [], buttons: [{ id: 'submit', kind: 'submit', label: 'Submit', actions: [{ type: 'start_workflow', workflow_id: u(1), start_form_page: { key: 'aaaaaaaaaaaaaaaa' } }] }] }
    const plain = { id: u(22), name: 'Other', fields: [], buttons: [{ id: 'submit', kind: 'submit', label: 'Submit', actions: [{ type: 'start_workflow', workflow_id: u(1) }] }] }
    exportMock.mockImplementation(async (_s, _t, idsByType) => {
      const manifest: Record<string, any[]> = {}
      if (idsByType.workflow?.includes(u(1))) manifest.workflows = [{ id: u(1), name: 'Intake', nodes: [] }]
      if (idsByType.form?.includes(u(21))) manifest.forms = [page]
      return manifest as any
    })
    const closure = await resolveDependencyClosure(fakeSupabase({ forms: [page, plain] }), 't1', [{ type: 'workflow', id: u(1) }])
    expect(closure.items).toEqual([
      { type: 'workflow', id: u(1), name: 'Intake', required_by: 'root' },
      { type: 'form', id: u(21), name: 'Intake — start form', required_by: { type: 'workflow', id: u(1) } },
    ])
  })

  it('stops at excluded assets', async () => {
    exportMock.mockImplementation(async (_s, _t, idsByType) => (idsByType.workflow?.includes(u(1))
      ? { workflows: [{ id: u(1), name: 'Root', nodes: [{ data: { sub_workflow_id: u(2) } }] }] }
      : {}) as any)
    const closure = await resolveDependencyClosure(fakeSupabase({}), 't1', [{ type: 'workflow', id: u(1) }], { exclude: new Set([`workflow:${u(2)}`]) })
    expect(closure.items.map((i) => i.id)).toEqual([u(1)])
    expect(closure.missing).toEqual([])
    expect(exportMock).toHaveBeenCalledTimes(1)
  })
})
