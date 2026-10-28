import { describe, expect, it } from 'vitest'

import { MCP_CORE_TOOL_DESCRIPTIONS, MCP_REPORT_EXAMPLES_GUIDANCE, MCP_REPORT_SCHEMA_GUIDANCE } from '@/lib/mcp/descriptions'
import { buildMcpInfoPayload } from '@/lib/mcp/metadata'
import { MCP_TOOL_CATEGORIES } from '@/lib/mcp/server'
import { createMcpServer } from '@/lib/mcp/server'

describe('MCP info payload', () => {
  const server = createMcpServer({
    tenantId: 'test-tenant',
    supabase: {},
    actingUserId: 'test-user',
    keyType: 'tenant',
    scopes: {
      workflow_ids: [],
      table_ids: [],
    },
  })

  it('builds the public MCP info payload from registered tools', () => {
    const payload = buildMcpInfoPayload(server)

    expect(payload.name).toBe('UserTasks MCP Server')
    expect(payload.version).toBe('1.0.0')
    expect(payload.transport).toBe('streamable-http')
    expect(payload.authentication).toEqual(['bearer-api-key', 'oauth2'])
    expect(payload.capabilities).toEqual(['tools'])
    expect(payload.registration_errors).toEqual([])
    expect(payload.tool_count).toBe(payload.tools.length)
    expect(payload.tool_count).toBeGreaterThan(100)
  })

  it('includes high-value MCP-first tools in the exported info payload', () => {
    const payload = buildMcpInfoPayload(server)
    const toolsByName = new Map(payload.tools.map((tool) => [tool.name, tool]))

    expect(toolsByName.has('retention_policies_create')).toBe(true)
    expect(toolsByName.has('workflow_activities_create')).toBe(true)
    expect(toolsByName.has('reports_remediate_config')).toBe(true)
    expect(toolsByName.has('reports_create')).toBe(true)
    expect(toolsByName.has('workflows_preflight')).toBe(true)
    expect(toolsByName.has('workflows_catalog')).toBe(true)
  })

  it('exports the stronger discoverability copy for key tools', () => {
    const payload = buildMcpInfoPayload(server)
    const toolsByName = new Map(payload.tools.map((tool) => [tool.name, tool]))

    expect(toolsByName.get('workflows_preflight')?.description).toBe(MCP_CORE_TOOL_DESCRIPTIONS.workflows_preflight)
    expect(toolsByName.get('reports_remediate_config')?.description).toBe(MCP_CORE_TOOL_DESCRIPTIONS.reports_remediate_config)
    expect(toolsByName.get('reports_create')?.description).toContain(MCP_REPORT_SCHEMA_GUIDANCE)
    expect(toolsByName.get('reports_create')?.description).toContain(MCP_REPORT_EXAMPLES_GUIDANCE)
  })

  it('does not expose duplicate tool names in the info payload', () => {
    const payload = buildMcpInfoPayload(server)
    const toolNames = payload.tools.map((tool) => tool.name)
    expect(new Set(toolNames).size).toBe(toolNames.length)
  })

  it('includes category metadata for discoverability', () => {
    const payload = buildMcpInfoPayload(server)
    const validCategories = new Set(MCP_TOOL_CATEGORIES)

    for (const tool of payload.tools) {
      expect(tool.category).toBeTruthy()
      expect(validCategories.has(tool.category), `${tool.name} should expose a valid category`).toBe(true)
    }
  })
})
