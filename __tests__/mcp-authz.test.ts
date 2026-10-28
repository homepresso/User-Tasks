import { describe, expect, it } from 'vitest'

import { checkToolPermission, TOOL_PERMISSIONS } from '@/lib/mcp/authz'
import { createMcpServer, type McpContext } from '@/lib/mcp/server'
import { PERMISSION_KEYS } from '@/lib/permissions'

function textOf(result: any): string {
  return result?.content?.[0]?.text ?? ''
}

describe('MCP per-tool authorization', () => {
  it('blocks a mutating tool when the key lacks the required permission', () => {
    const ctx = { tenantId: 't1', supabase: {}, permissions: ['reports.view'] } as unknown as McpContext
    const denied = checkToolPermission(ctx, 'reports_create')
    expect(denied?.isError).toBe(true)
    expect(textOf(denied)).toContain('reports.create')
  })

  it('allows a mutating tool when the key holds the required permission', () => {
    const ctx = { tenantId: 't1', supabase: {}, permissions: ['reports.create'] } as unknown as McpContext
    expect(checkToolPermission(ctx, 'reports_create')).toBeNull()
  })

  it('gates read tools on their view permission', () => {
    const none = { tenantId: 't1', supabase: {}, permissions: [] } as unknown as McpContext
    expect(textOf(checkToolPermission(none, 'reports_list'))).toContain('reports.view')
    expect(textOf(checkToolPermission(none, 'workflows_get'))).toContain('workflows.view')
    const viewer = { tenantId: 't1', supabase: {}, permissions: ['reports.view', 'workflows.view'] } as unknown as McpContext
    expect(checkToolPermission(viewer, 'reports_list')).toBeNull()
    expect(checkToolPermission(viewer, 'workflows_get')).toBeNull()
  })

  it('denies a tool with no permission mapping when gating is active', () => {
    const ctx = { tenantId: 't1', supabase: {}, permissions: [...PERMISSION_KEYS] } as unknown as McpContext
    expect(checkToolPermission(ctx, 'brand_new_tool')?.isError).toBe(true)
  })

  it('disables gating when permissions are unset (standalone/test contexts)', () => {
    const ctx = { tenantId: 't1', supabase: {} } as unknown as McpContext
    expect(checkToolPermission(ctx, 'reports_delete')).toBeNull()
  })

  it('gates the highest-risk destructive/identity tools', () => {
    for (const tool of ['workflows_delete', 'workflows_publish', 'api_keys_create', 'data_rows_delete', 'roles_manage', 'reports_delete']) {
      expect(TOOL_PERMISSIONS[tool], `${tool} must be gated`).toBeTruthy()
    }
  })
})

describe('api_keys_create privilege-escalation guard', () => {
  function mockSupabase(captured: { insert?: any }) {
    return {
      from(table: string) {
        return {
          insert(row: any) {
            // Only capture the api_keys insert; ignore the fire-and-forget audit write.
            if (table === 'api_keys') captured.insert = row
            return {
              select() {
                return { single: async () => ({ data: { id: 'new-key', ...row }, error: null }) }
              },
            }
          },
        }
      },
    }
  }

  async function callCreate(ctx: McpContext, args: any) {
    const server = createMcpServer(ctx)
    return server.callTool('api_keys_create', args)
  }

  it('rejects a new key that asks for permissions the caller lacks', async () => {
    const captured: { insert?: any } = {}
    const ctx = {
      tenantId: 't1',
      supabase: mockSupabase(captured),
      keyType: 'tenant',
      permissions: ['settings.manage_api_keys', 'reports.view'],
    } as unknown as McpContext

    const result = await callCreate(ctx, {
      name: 'scoped',
      key_type: 'tenant',
      permissions: ['reports.view', 'workflows.delete', 'settings.manage_api_keys'],
    })

    // workflows.delete is not held by the caller: refused outright, nothing inserted.
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('workflows.delete')
    expect(captured.insert).toBeUndefined()

    const ok = await callCreate({ ...ctx, actingUserId: 'cap-test' } as McpContext, { name: 'scoped', key_type: 'tenant', permissions: ['reports.view'] })
    expect(ok.isError).toBeFalsy()
    expect(captured.insert.permissions).toEqual(['reports.view'])
  })

  it('a full-admin caller minting without an explicit list produces a legacy (null) full key', async () => {
    const captured: { insert?: any } = {}
    const ctx = {
      tenantId: 't1',
      supabase: mockSupabase(captured),
      keyType: 'tenant',
      permissions: [...PERMISSION_KEYS],
    } as unknown as McpContext

    const result = await callCreate(ctx, { name: 'admin', key_type: 'tenant' })
    expect(result.isError).toBeFalsy()
    expect(captured.insert.permissions).toBeNull()
  })

  it('rejects the call entirely when the caller lacks settings.manage_api_keys', async () => {
    const captured: { insert?: any } = {}
    const ctx = {
      tenantId: 't1',
      supabase: mockSupabase(captured),
      keyType: 'tenant',
      permissions: ['reports.view'],
    } as unknown as McpContext

    const result = await callCreate(ctx, { name: 'sneaky', key_type: 'tenant', permissions: [...PERMISSION_KEYS] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('settings.manage_api_keys')
    expect(captured.insert).toBeUndefined() // never reached the insert
  })
})
