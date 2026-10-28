import { describe, expect, it } from 'vitest'

import { MCP_TOOL_CATEGORIES, createMcpServer } from '@/lib/mcp/server'

describe('MCP metadata', () => {
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

  const tools = server.getRegisteredTools()

  it('registers all tool modules without registration errors', () => {
    expect(server.getRegistrationErrors()).toEqual([])
    expect(tools.length).toBeGreaterThan(100)
  })

  it('registers unique tool names', () => {
    const names = tools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps every tool description populated and readable', () => {
    for (const tool of tools) {
      expect(tool.description.trim().length, `${tool.name} should have a meaningful description`).toBeGreaterThan(20)
      const condensed = tool.description
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
      expect(condensed, `${tool.name} description should not contain accidental double spaces`).not.toContain('  ')
    }
  })

  it('keeps every input property documented', () => {
    for (const tool of tools) {
      const properties = tool.inputSchema?.properties ?? {}
      for (const [propertyName, propertySchema] of Object.entries(properties)) {
        const description = String((propertySchema as Record<string, unknown>).description ?? '').trim()
        expect(description.length, `${tool.name}.${propertyName} should have a description`).toBeGreaterThan(0)
      }
    }
  })

  it('exposes the core MCP-first building surfaces', () => {
    const names = new Set(tools.map((tool) => tool.name))
    expect(names.has('retention_policies_create')).toBe(true)
    expect(names.has('workflow_activities_create')).toBe(true)
    expect(names.has('reports_remediate_config')).toBe(true)
    expect(names.has('reports_create')).toBe(true)
    expect(names.has('workflows_preflight')).toBe(true)
  })

  it('assigns every tool to exactly one valid MCP category', () => {
    const validCategories = new Set(MCP_TOOL_CATEGORIES)

    for (const tool of tools) {
      expect(tool.category, `${tool.name} should have a category`).toBeTruthy()
      expect(validCategories.has(tool.category), `${tool.name} should use a valid MCP category`).toBe(true)
    }
  })
})
