import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import {
  createMcpProtocolServer,
  getContextToolServer,
  getMcpToolCatalog,
  mcpToolCatalogBuildCount,
  registerAllTools,
  type McpContext,
} from '@/lib/mcp/server'

/**
 * The MCP endpoint builds tool definitions/JSON Schemas once per process and
 * only binds the caller's context per request. The per-request protocol
 * server must answer exactly as the SDK McpServer (with every tool registered
 * per request, as before) did.
 */

async function connect(server: Server | McpServer) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(clientTransport)
  return client
}

function legacyServer(ctx: McpContext) {
  const server = new McpServer({ name: 'UserTasks', version: '1.0.0' })
  registerAllTools(server, ctx)
  return server
}

const supabase = {}
const ctx = (overrides: Partial<McpContext> = {}): McpContext => ({
  tenantId: 'tenant-1',
  supabase,
  permissions: ['workflows.view'],
  scopes: { workflow_ids: [], table_ids: [] },
  ...overrides,
})

describe('MCP tool registry cache', () => {
  it('lists the same tools, schemas and capabilities as the per-request McpServer', async () => {
    const legacy = await connect(legacyServer(ctx()))
    const cached = await connect(createMcpProtocolServer(ctx()))
    const [before, after] = await Promise.all([legacy.listTools(), cached.listTools()])
    expect(after.tools.length).toBeGreaterThan(100)
    expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(JSON.stringify(before)))
    expect(cached.getServerCapabilities()).toEqual(legacy.getServerCapabilities())
  })

  it('builds the catalog once per process however many requests arrive', async () => {
    getMcpToolCatalog()
    const builds = mcpToolCatalogBuildCount()
    for (let i = 0; i < 5; i++) {
      const client = await connect(createMcpProtocolServer(ctx({ tenantId: `tenant-${i}` })))
      await client.listTools()
    }
    expect(mcpToolCatalogBuildCount()).toBe(builds)
    expect(builds).toBe(1)
  })

  it('reuses context-bound handlers only for an identical context and client', () => {
    const a = getContextToolServer(ctx())
    expect(getContextToolServer(ctx())).toBe(a)
    expect(getContextToolServer(ctx({ permissions: ['workflows.view', 'workflows.edit'] }))).not.toBe(a)
    expect(getContextToolServer(ctx({ tenantId: 'tenant-2' }))).not.toBe(a)
    expect(getContextToolServer(ctx({ supabase: {} }))).not.toBe(a)
  })

  it('returns the same tools/call errors as McpServer', async () => {
    const legacy = await connect(legacyServer(ctx()))
    const cached = await connect(createMcpProtocolServer(ctx()))
    for (const call of [
      { name: 'no_such_tool', arguments: {} },
      { name: 'workflows_get', arguments: { workflow_id: 42 } },
      { name: 'workflows_get', arguments: {} },
    ]) {
      const [before, after] = await Promise.all([legacy.callTool(call), cached.callTool(call)])
      expect(after).toEqual(before)
      expect(after.isError).toBe(true)
    }
  })

  it('still enforces per-tool permissions with the bound context', async () => {
    const client = await connect(createMcpProtocolServer(ctx({ permissions: [] })))
    const result = await client.callTool({ name: 'workflows_list', arguments: {} })
    expect(result.isError).toBe(true)
    expect((result.content as Array<{ text: string }>)[0].text).toContain('workflows.view')
  })
})
