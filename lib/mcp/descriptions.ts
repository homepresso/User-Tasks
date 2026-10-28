export const MCP_BUILD_ORDER = [
  'data tables first',
  'then business rules',
  'retention policies',
  'custom workflow activities',
  'and finally workflows',
] as const

export const MCP_BUILD_ORDER_SENTENCE = `When assembling a solution, MCP should think in this order: ${MCP_BUILD_ORDER.join(', ')}.`

export const MCP_REPORT_SCHEMA_GUIDANCE =
  'Use real source column keys for raw fields. For grouped outputs, use derived aggregate keys such as COUNT_id, SUM_amount, or AVG_duration_ms. Do not reference phantom source-prefixed aggregate columns such as workflow_runs._count.'

export const MCP_REPORT_EXAMPLES_GUIDANCE =
  'Canonical examples: raw table report => {"data_source":"workflow_runs","columns":["id","title","status","started_at","completed_at"],"filters":[{"field":"status","operator":"eq","value":"completed"}],"visualization":"table","sort":{"field":"started_at","direction":"desc"}}. Grouped aggregate report => {"data_source":"workflow_runs","columns":["status","COUNT_id"],"group_by":["status"],"aggregations":[{"field":"id","fn":"COUNT"}],"visualization":"bar","sort":{"field":"COUNT_id","direction":"desc"}}. Joined report => {"data_source":"tasks","columns":["title","status","assignee.display_name"],"joins":[{"source":"users","alias":"assignee","local_field":"assignee_id","foreign_field":"id","columns":["display_name"],"join_type":"left"}],"visualization":"table"}.'

export const MCP_WORKFLOW_RECIPES_GUIDANCE =
  'Prefer canonical workflow recipes for common automation patterns: data change to notification/action, approval with user_task branching, and middleware/webhook request-response flows with end_workflow.'

export const MCP_CORE_TOOL_DESCRIPTIONS = {
  workflows_preflight:
    'Validate a proposed workflow graph before creation or update. This checks node-level validation, middleware rules, trigger wiring, and whether referenced tables, retention policies, rules, references, teams, users, roles, custom activities, agents, and other workflow dependencies exist in the tenant.',
  retention_policies_create:
    'Create a centrally governed retention policy that can later be assigned to tables/lists, individual rows, and roles. Roles support review-style retention only.',
  workflow_activities_create:
    'Create a custom workflow activity asset. Provide uploaded or inline code, and declare typed inputs and outputs so it appears as a native custom activity node in workflows.',
  reports_remediate_config:
    `Inspect and automatically repair a custom report config before preview or save. This tool rewrites legacy aggregate aliases such as workflow_runs._count, removes invalid columns/filters/joins, seeds safe defaults, and returns both the issues found and the remediated config. ${MCP_REPORT_SCHEMA_GUIDANCE}`,
  reports_create:
    `Create a saved custom report. The config supports full custom-report authoring, including joins, filters, date ranges, grouping, aggregations, calculated columns, visualization, chart styling, drill targets, and row limits. Use reports_preview first when MCP is assembling a comprehensive report. ${MCP_REPORT_SCHEMA_GUIDANCE} ${MCP_REPORT_EXAMPLES_GUIDANCE}`,
} as const
