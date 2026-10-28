import { MCP_CORE_TOOL_DESCRIPTIONS } from '@/lib/mcp/descriptions'

export const mcpDescriptionGolden = {
  workflows_preflight: MCP_CORE_TOOL_DESCRIPTIONS.workflows_preflight,
  retention_policies_create: MCP_CORE_TOOL_DESCRIPTIONS.retention_policies_create,
  workflow_activities_create: MCP_CORE_TOOL_DESCRIPTIONS.workflow_activities_create,
  reports_create: MCP_CORE_TOOL_DESCRIPTIONS.reports_create,
} as const
