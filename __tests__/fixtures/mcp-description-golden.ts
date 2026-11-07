import { MCP_CORE_TOOL_DESCRIPTIONS } from '@/lib/mcp/descriptions'

export const mcpDescriptionGolden = {
  workflows_preflight: MCP_CORE_TOOL_DESCRIPTIONS.workflows_preflight,
  retention_policies_create: MCP_CORE_TOOL_DESCRIPTIONS.retention_policies_create,
  workflow_activities_create: MCP_CORE_TOOL_DESCRIPTIONS.workflow_activities_create,
  reports_create: MCP_CORE_TOOL_DESCRIPTIONS.reports_create,
  org_scope_resolve: MCP_CORE_TOOL_DESCRIPTIONS.org_scope_resolve,
  projects_members: MCP_CORE_TOOL_DESCRIPTIONS.projects_members,
  tasks_follow: MCP_CORE_TOOL_DESCRIPTIONS.tasks_follow,
  tasks_following: MCP_CORE_TOOL_DESCRIPTIONS.tasks_following,
  forms_wizard_create: MCP_CORE_TOOL_DESCRIPTIONS.forms_wizard_create,
} as const
