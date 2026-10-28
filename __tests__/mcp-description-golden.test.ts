import { describe, expect, it } from 'vitest'

import { mcpDescriptionGolden } from './fixtures/mcp-description-golden'

import { buildMcpInfoPayload } from '@/lib/mcp/metadata'
import { createMcpServer } from '@/lib/mcp/server'

describe('MCP description golden set', () => {
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

  it('keeps the curated high-value tool descriptions stable', () => {
    const payload = buildMcpInfoPayload(server)
    const toolsByName = new Map(payload.tools.map((tool) => [tool.name, tool.description]))

    for (const [toolName, expectedDescription] of Object.entries(mcpDescriptionGolden)) {
      expect(toolsByName.has(toolName), `${toolName} should exist in the MCP payload`).toBe(true)
      expect(toolsByName.get(toolName)).toBe(expectedDescription)
    }
  })
})
