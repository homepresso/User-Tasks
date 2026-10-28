import { describe, expect, it } from 'vitest'

import { buildTenantExport } from '@/lib/portability/export'
import { importManifest, importTenantManifest } from '@/lib/portability/import'
import { ID_KEY_TO_MAP, createEmptyAssetIdMaps, remapKnownIds } from '@/lib/portability/id-maps'
import { SECRET_PLACEHOLDER } from '@/lib/portability/scrub'

const TENANT_ID = 'tenant-1'

// ─── read-only chainable stub for export (mirrors portability-tenant-export,
// but honors the select() column list so "column not exported" assertions
// mean what they say) ───
function makeExportSupabase(rows: Record<string, any[]>, queriedTables: string[] = []) {
  return {
    from(table: string) {
      queriedTables.push(table)
      let columns: string[] | null = null
      const app = (row: any) => {
        if (!columns) return row
        return Object.fromEntries(columns.filter((column) => column in row).map((column) => [column, row[column]]))
      }
      const b: any = {
        select: (cols?: string) => {
          columns = cols && cols !== '*' ? cols.split(',').map((column) => column.trim()) : null
          return b
        },
        eq: () => b,
        in: () => b,
        order: () => b,
        limit: () => b,
        then: (resolve: any, reject?: any) =>
          Promise.resolve({ data: (rows[table] ?? []).map(app), error: null }).then(resolve, reject),
      }
      return b
    },
  } as any
}

// ─── mutable table-backed stub for import (select/insert/update/delete) ───────
let idCounter = 0
function makeImportSupabase(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const rows = (tables[table] ??= [])
      const state: { action: 'select' | 'insert' | 'update' | 'delete'; payload?: any; filters: Array<[string, any]> } = {
        action: 'select',
        filters: [],
      }
      const matches = (row: any) => state.filters.every(([key, value]) => row[key] === value)
      const run = (): any[] => {
        if (state.action === 'insert') {
          const inserted = (Array.isArray(state.payload) ? state.payload : [state.payload])
            .map((payload: any) => ({ id: `gen-${++idCounter}`, ...payload }))
          rows.push(...inserted)
          return inserted
        }
        if (state.action === 'update') {
          const updated = rows.filter(matches)
          for (const row of updated) Object.assign(row, state.payload)
          return updated
        }
        if (state.action === 'delete') {
          const removed = rows.filter(matches)
          for (let i = rows.length - 1; i >= 0; i--) {
            if (matches(rows[i])) rows.splice(i, 1)
          }
          return removed
        }
        return rows.filter(matches)
      }
      const b: any = {
        select: () => b,
        order: () => b,
        limit: () => b,
        // .in is only used by rollback paths these tests never hit; treat it
        // as a pass-through filter that matches nothing to stay safe.
        in: (key: string, values: any[]) => {
          state.filters.push([`__in__${key}`, values])
          return b
        },
        eq: (key: string, value: any) => {
          state.filters.push([key, value])
          return b
        },
        insert: (payload: any) => {
          state.action = 'insert'
          state.payload = payload
          return b
        },
        update: (payload: any) => {
          state.action = 'update'
          state.payload = payload
          return b
        },
        delete: () => {
          state.action = 'delete'
          return b
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        single: async () => {
          const result = run()
          return { data: result[0] ?? null, error: result[0] ? null : { message: `no row in ${table}` } }
        },
        then: (resolve: any, reject?: any) => Promise.resolve({ data: run(), error: null }).then(resolve, reject),
      }
      return b
    },
  } as any
}

function makeExportRows(): Record<string, any[]> {
  return {
    roles: [
      {
        id: 'role-admin',
        tenant_id: TENANT_ID,
        name: 'Admin',
        slug: 'admin',
        description: 'Built-in admin',
        permissions: ['*'],
        is_system: true,
        retention_policy_id: null,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'role-approver',
        tenant_id: TENANT_ID,
        name: 'Approver',
        slug: 'approver',
        description: 'Can approve requests',
        permissions: ['tasks.approve', 'tasks.view'],
        is_system: false,
        retention_policy_id: 'pol-1',
        created_at: '2026-02-01T00:00:00Z',
      },
      {
        id: 'role-null-system',
        tenant_id: TENANT_ID,
        name: 'Auditor',
        slug: 'auditor',
        description: null,
        permissions: ['audit.view'],
        is_system: null,
        retention_policy_id: null,
        created_at: '2026-02-02T00:00:00Z',
      },
    ],
    mcp_servers: [
      {
        id: 'mcp-1',
        tenant_id: TENANT_ID,
        name: 'Jira MCP',
        url: 'https://mcp.example/jira',
        auth_type: 'bearer',
        auth_config: { token: 'super-secret-token' },
        is_active: true,
      },
      {
        id: 'mcp-2',
        tenant_id: TENANT_ID,
        name: 'Keyed MCP',
        url: 'https://mcp.example/keyed',
        auth_type: 'api_key',
        auth_config: { key_name: 'X-API-Key', key_value: 'super-secret-key' },
        is_active: false,
      },
    ],
  }
}

describe('tenant export: roles section', () => {
  it('exports only custom roles (is_system false or null) with the manifest shape', async () => {
    const manifest = await buildTenantExport(makeExportSupabase(makeExportRows()), TENANT_ID)

    expect(manifest.roles).toHaveLength(2)
    expect(manifest.roles.map((role: any) => role.slug)).toEqual(['approver', 'auditor'])
    // System roles never travel.
    expect(manifest.roles.find((role: any) => role.slug === 'admin')).toBeUndefined()

    const approver = manifest.roles[0]
    expect(approver).toEqual({
      id: 'role-approver',
      name: 'Approver',
      slug: 'approver',
      description: 'Can approve requests',
      permissions: ['tasks.approve', 'tasks.view'],
      retention_policy_id: 'pol-1',
    })
    expect(approver).not.toHaveProperty('tenant_id')
    expect(approver).not.toHaveProperty('created_at')
    expect(approver).not.toHaveProperty('is_system')
  })
})

describe('tenant export: mcp_servers section', () => {
  it('exports mcp servers with auth_config credentials scrubbed to the sentinel', async () => {
    const manifest = await buildTenantExport(makeExportSupabase(makeExportRows()), TENANT_ID)

    expect(manifest.mcp_servers).toHaveLength(2)
    const [bearer, keyed] = manifest.mcp_servers
    expect(bearer).toMatchObject({ id: 'mcp-1', name: 'Jira MCP', url: 'https://mcp.example/jira', auth_type: 'bearer', is_active: true })
    expect(bearer.auth_config.token).toBe(SECRET_PLACEHOLDER)
    expect(keyed.auth_config.key_value).toBe(SECRET_PLACEHOLDER)
    // The header NAME is not a secret and must survive for api_key auth.
    expect(keyed.auth_config.key_name).toBe('X-API-Key')
    expect(bearer).not.toHaveProperty('tenant_id')
  })

  it('scrubs auth_config even when the tenant-level scrub pass is opted out', async () => {
    const manifest = await buildTenantExport(makeExportSupabase(makeExportRows()), TENANT_ID, { scrubSecrets: false })
    expect(manifest.mcp_servers[0].auth_config.token).toBe(SECRET_PLACEHOLDER)
  })
})

describe('import: roles upsert matches by slug', () => {
  function makeLocalRoles() {
    return [
      {
        id: 'local-approver',
        tenant_id: TENANT_ID,
        name: 'Old Approver',
        slug: 'approver',
        description: 'old',
        permissions: ['tasks.view'],
        is_system: false,
        retention_policy_id: null,
      },
      {
        id: 'local-admin',
        tenant_id: TENANT_ID,
        name: 'Admin',
        slug: 'admin',
        description: 'Built-in admin',
        permissions: ['*'],
        is_system: true,
        retention_policy_id: null,
      },
    ]
  }

  it('updates the slug-matched custom role, inserts new roles, and never touches system roles', async () => {
    const tables: Record<string, any[]> = { roles: makeLocalRoles() }
    const written: Array<[string, string, string]> = []

    const result = await importManifest({
      supabase: makeImportSupabase(tables),
      tenantId: TENANT_ID,
      manifest: {
        roles: [
          { id: 'src-approver', name: 'Approver', slug: 'approver', description: 'Can approve', permissions: ['tasks.approve', 'tasks.view'] },
          { id: 'src-admin', name: 'Evil Admin', slug: 'admin', permissions: ['nothing'] },
          { id: 'src-reviewer', name: 'Reviewer', slug: 'reviewer', description: null, permissions: [] },
        ],
      },
      mode: 'upsert',
      onAssetWritten: (assetType, sourceId, localId) => written.push([assetType, sourceId, localId]),
    })

    // slug match → update in place, id preserved
    const approver = tables.roles.find((role) => role.slug === 'approver')!
    expect(approver.id).toBe('local-approver')
    expect(approver.name).toBe('Approver')
    expect(approver.description).toBe('Can approve')
    expect(approver.permissions).toEqual(['tasks.approve', 'tasks.view'])
    expect(approver.is_system).toBe(false)

    // system role with the same slug is left completely untouched
    const admin = tables.roles.find((role) => role.slug === 'admin')!
    expect(admin.name).toBe('Admin')
    expect(admin.permissions).toEqual(['*'])
    expect(admin.is_system).toBe(true)

    // unmatched role is inserted
    const reviewer = tables.roles.find((role) => role.slug === 'reviewer')!
    expect(reviewer).toBeTruthy()
    expect(reviewer.tenant_id).toBe(TENANT_ID)
    expect(reviewer.is_system).toBe(false)

    // bookkeeping: one update, one insert, no errors, mappings recorded
    expect((result as any).updated).toEqual({ role: 1 })
    expect((result as any).errors).toEqual([])
    expect(result.counts.roles).toBe(1)
    expect(result.id_map.role['src-approver']).toBe('local-approver')
    expect(result.id_map.role['src-reviewer']).toBe(reviewer.id)
    // onAssetWritten fires for inserts only
    expect(written).toEqual([['role', 'src-reviewer', reviewer.id]])
  })

  it('skips manifest rows flagged is_system instead of importing them', async () => {
    const tables: Record<string, any[]> = { roles: [] }
    const result = await importManifest({
      supabase: makeImportSupabase(tables),
      tenantId: TENANT_ID,
      manifest: { roles: [{ id: 'src-sys', name: 'Owner', slug: 'owner', permissions: ['*'], is_system: true }] },
      mode: 'upsert',
    })
    expect(tables.roles).toHaveLength(0)
    expect(result.counts.roles).toBe(0)
    expect((result as any).errors).toEqual([])
  })

  it('remaps retention_policy_id on the imported role via the retention policy map', async () => {
    const tables: Record<string, any[]> = { roles: [] }
    const idMapSeed = createEmptyAssetIdMaps()
    idMapSeed.retention_policy['src-pol'] = 'local-pol'

    await importManifest({
      supabase: makeImportSupabase(tables),
      tenantId: TENANT_ID,
      manifest: {
        roles: [{ id: 'src-role', name: 'Archivist', slug: 'archivist', permissions: [], retention_policy_id: 'src-pol' }],
      },
      mode: 'upsert',
      idMapSeed,
    })

    expect(tables.roles[0].retention_policy_id).toBe('local-pol')
  })
})

describe('import: mcp_servers', () => {
  it('upsert matches by name and restores __SECRET__ placeholders from the existing row', async () => {
    const tables: Record<string, any[]> = {
      mcp_servers: [
        {
          id: 'local-mcp',
          tenant_id: TENANT_ID,
          name: 'Jira MCP',
          url: 'https://old.example',
          auth_type: 'bearer',
          auth_config: { token: 'real-token' },
          is_active: true,
        },
      ],
    }

    const result = await importManifest({
      supabase: makeImportSupabase(tables),
      tenantId: TENANT_ID,
      manifest: {
        mcp_servers: [
          {
            id: 'src-mcp',
            name: 'Jira MCP',
            url: 'https://new.example',
            auth_type: 'bearer',
            auth_config: { token: SECRET_PLACEHOLDER },
            is_active: false,
          },
        ],
      },
      mode: 'upsert',
    })

    expect(tables.mcp_servers).toHaveLength(1)
    const server = tables.mcp_servers[0]
    expect(server.id).toBe('local-mcp')
    expect(server.url).toBe('https://new.example')
    expect(server.is_active).toBe(false)
    // sentinel resolved against the pre-update row at the same path
    expect(server.auth_config.token).toBe('real-token')
    expect((result as any).updated).toEqual({ mcp_server: 1 })
    expect(result.id_map.mcp_server['src-mcp']).toBe('local-mcp')
  })

  it('create-mode tenant import drops unresolvable __SECRET__ placeholders instead of persisting them', async () => {
    const tables: Record<string, any[]> = { mcp_servers: [] }

    await importTenantManifest({
      supabase: makeImportSupabase(tables),
      tenantId: TENANT_ID,
      manifest: {
        format_version: 3,
        mcp_servers: [
          {
            id: 'src-mcp',
            name: 'Jira MCP',
            url: 'https://mcp.example/jira',
            auth_type: 'bearer',
            auth_config: { token: SECRET_PLACEHOLDER },
          },
        ],
      },
      mode: 'create',
    })

    expect(tables.mcp_servers).toHaveLength(1)
    const server = tables.mcp_servers[0]
    expect(server.name).toBe('Jira MCP')
    expect(server.auth_config).toEqual({})
    expect(JSON.stringify(server)).not.toContain(SECRET_PLACEHOLDER)
  })
})

describe('id maps: role and mcp_server', () => {
  it('registers role_id and mcp_server_id in ID_KEY_TO_MAP and remaps them', () => {
    expect(ID_KEY_TO_MAP.role_id).toBe('role')
    expect(ID_KEY_TO_MAP.mcp_server_id).toBe('mcp_server')

    const idMaps = createEmptyAssetIdMaps()
    idMaps.role['src-role'] = 'local-role'
    idMaps.mcp_server['src-mcp'] = 'local-mcp'

    const remapped = remapKnownIds(
      { config: { role_id: 'src-role', mcp_server_id: 'src-mcp', other_id: 'untouched' } },
      idMaps,
    )
    expect(remapped.config.role_id).toBe('local-role')
    expect(remapped.config.mcp_server_id).toBe('local-mcp')
    expect(remapped.config.other_id).toBe('untouched')
  })
})
