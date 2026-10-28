import { describe, expect, it } from 'vitest'

import { createMcpServer } from '@/lib/mcp/server'

function parseToolResponse(result: any) {
  const text = result?.content?.[0]?.text
  expect(typeof text).toBe('string')
  return JSON.parse(text)
}

describe('MCP remediation tools', () => {
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

  it('remediates report configs through the MCP tool surface', async () => {
    const result = await server.callTool('reports_remediate_config', {
      config: JSON.stringify({
        source: 'workflow_runs',
        columns: ['workflow_runs._count', 'not_a_real_column'],
        filters: [{ field: 'workflow_runs._count', operator: 'gte', value: 2 }],
        sort: { field: 'not_a_real_column', direction: 'desc' },
        groupBy: ['status'],
        aggregations: [{ fn: 'COUNT', field: 'id' }],
      }),
    })

    expect(result?.isError).not.toBe(true)
    const payload = parseToolResponse(result)
    expect(payload.remediated).toBe(true)
    expect(payload.issues_before.length).toBeGreaterThan(0)
    expect(payload.fixes.length).toBeGreaterThan(0)
    expect(payload.issues_after).toEqual([])
    expect(payload.config.columns).toEqual(['COUNT_id'])
    expect(payload.config.filters[0].field).toBe('COUNT_id')
  })
})
