import { describe, expect, it } from 'vitest'

import { buildTenantExport } from '@/lib/portability/export'

// ─── minimal chainable supabase stub ───
function makeSupabase(rows: Record<string, any[]>, queriedTables: string[]) {
  return {
    from(table: string) {
      queriedTables.push(table)
      const b: any = {
        select: () => b,
        eq: () => b,
        in: () => b,
        order: () => b,
        limit: () => b,
        then: (resolve: any, reject?: any) =>
          Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve, reject),
      }
      return b
    },
  } as any
}

const TENANT_ID = 'tenant-1'

function makeRows(): Record<string, any[]> {
  return {
    workflows: [
      {
        id: 'wf-1',
        name: 'Ticket Intake',
        description: null,
        trigger_type: 'manual',
        trigger_config: {},
        nodes: [],
        edges: [],
        user_variables: [],
        swimlanes: [],
        is_active: true,
      },
    ],
    custom_tables: [
      { id: 'tbl-1', name: 'Tickets', description: null, columns: [{ key: 'title', name: 'Title', type: 'text' }] },
    ],
    integrations: [
      {
        id: 'int-1',
        name: 'ERP',
        type: 'rest_api',
        is_active: true,
        tags: null,
        config: {
          base_url: 'https://erp.example',
          api_key: 'enc:v1:deadbeef',
          auth_config: { type: 'bearer', token: 'plain-token' },
        },
      },
    ],
    integration_references: [
      {
        id: 'ref-1',
        integration_id: 'int-1',
        name: 'List Orders',
        description: null,
        tags: null,
        request_config: { method: 'GET', path: '/orders' },
        inputs: [],
        outputs: [],
      },
    ],
    spaces: [
      {
        id: 'space-1',
        name: 'Operations',
        slug: 'operations',
        description: null,
        purpose: 'internal',
        icon: null,
        color: null,
        landing_asset_type: 'workflow',
        landing_asset_id: 'wf-1',
        navigation: [],
        dashboard_config: {},
        settings: {},
        is_active: true,
      },
    ],
    space_assets: [
      {
        space_id: 'space-1',
        asset_type: 'workflow',
        asset_id: 'wf-1',
        label: 'Ticket Intake',
        nav_group: null,
        sort_order: 0,
        is_featured: true,
        menu_config: { icon: 'Workflow' },
      },
    ],
  }
}

describe('buildTenantExport', () => {
  it('produces a format_version 3 manifest with v2 sections intact', async () => {
    const queried: string[] = []
    const manifest = await buildTenantExport(makeSupabase(makeRows(), queried), TENANT_ID)

    expect(manifest.format_version).toBe(3)
    expect(manifest.tenant_id).toBe(TENANT_ID)
    expect(manifest.export_options).toMatchObject({
      include_table_rows: false,
    })

    // v2 sections keep their v2 shape
    expect(manifest.workflows).toHaveLength(1)
    expect(manifest.workflows[0]).toMatchObject({ id: 'wf-1', name: 'Ticket Intake', trigger_type: 'manual' })
    expect(manifest.data_tables).toHaveLength(1)
    expect(manifest.data_tables[0]).toMatchObject({ id: 'tbl-1', name: 'Tickets' })
    expect(manifest.integrations).toHaveLength(1)
    expect(manifest.references).toHaveLength(1)
    expect(manifest.references[0]).toMatchObject({ id: 'ref-1', integration_id: 'int-1' })
  })

  it('omits retired sections (kanban, spaces, documents)', async () => {
    const queried: string[] = []
    const manifest = await buildTenantExport(makeSupabase(makeRows(), queried), TENANT_ID)

    expect(manifest.kanban_boards).toBeUndefined()
    expect(queried).not.toContain('kanban_boards')

    expect(manifest.document_metadata_templates).toBeUndefined()
    expect(manifest.documents).toBeUndefined()
    expect(queried).not.toContain('documents')
    expect(queried).not.toContain('document_metadata_templates')

    // Spaces were retired — exports no longer emit
    // a spaces section and never touch the dropped tables.
    expect(manifest.spaces).toBeUndefined()
    expect(queried).not.toContain('spaces')
    expect(queried).not.toContain('space_assets')
    expect(queried).not.toContain('space_memberships')
  })

  it('never queries custom_table_rows', async () => {
    const queried: string[] = []
    await buildTenantExport(makeSupabase(makeRows(), queried), TENANT_ID)

    expect(queried).not.toContain('custom_table_rows')
  })

  it('scrubs integration credentials to the __SECRET__ sentinel by default', async () => {
    const queried: string[] = []
    const manifest = await buildTenantExport(makeSupabase(makeRows(), queried), TENANT_ID)

    const config = manifest.integrations[0].config
    // enc:v1: value under a sensitive key → sentinel
    expect(config.api_key).toBe('__SECRET__')
    // the v2 blocklist keys become the sentinel too (so upsert imports keep
    // the stored credential instead of wiping it)
    expect(config.auth_config.token).toBe('__SECRET__')
    // non-secret config stays readable
    expect(config.base_url).toBe('https://erp.example')
  })

  it('omits empty sections instead of emitting empty arrays for v2 asset types', async () => {
    const queried: string[] = []
    const rows = makeRows()
    delete rows.workflows
    const manifest = await buildTenantExport(makeSupabase(rows, queried), TENANT_ID)

    expect(manifest.workflows).toBeUndefined()
  })
})
