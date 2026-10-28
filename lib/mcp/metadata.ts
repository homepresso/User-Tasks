import { createMcpServer, type McpContext, type McpToolServer } from './server'

export function buildMcpCategorySummary(toolServer: McpToolServer | null) {
  const tools = toolServer?.getRegisteredTools() ?? []
  const counts = new Map<string, number>()

  for (const tool of tools) {
    counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => left.category.localeCompare(right.category))
}

export function buildStaticMcpCategorySummary() {
  const toolServer = createMcpServer({
    tenantId: 'metadata-preview',
    supabase: {},
    actingUserId: 'metadata-preview',
    keyType: 'tenant',
    scopes: {
      workflow_ids: [],
      table_ids: [],
    },
  } satisfies McpContext)

  return buildMcpCategorySummary(toolServer)
}

export function buildMcpInfoPayload(toolServer: McpToolServer | null) {
  const tools = toolServer?.getRegisteredTools() ?? []
  const registrationErrors = toolServer?.getRegistrationErrors() ?? []
  const categories = buildMcpCategorySummary(toolServer)

  return {
    name: 'UserTasks MCP Server',
    version: '1.0.0',
    description: 'Control your UserTasks tenant via MCP. Authenticate with a Bearer API key or OAuth 2.0 access token.',
    capabilities: ['tools'],
    transport: 'streamable-http',
    authentication: ['bearer-api-key', 'oauth2'],
    tool_count: tools.length,
    categories,
    tools,
    registration_errors: registrationErrors,
  }
}
