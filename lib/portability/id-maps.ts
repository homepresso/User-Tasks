// Asset id maps and deep id-remapping used when importing manifests into a
// tenant.

export type AssetIdMaps = Record<'workflow' | 'workflow_activity' | 'data_table' | 'retention_policy' | 'integration' | 'agent' | 'decision_table' | 'reference' | 'report' | 'role' | 'mcp_server' | 'email_template' | 'connector' | 'log_destination' | 'form' | 'form_theme', Record<string, string>>

export function createEmptyAssetIdMaps(): AssetIdMaps {
  return {
    workflow: {},
    workflow_activity: {},
    data_table: {},
    retention_policy: {},
    integration: {},
    agent: {},
    decision_table: {},
    reference: {},
    report: {},
    role: {},
    mcp_server: {},
    email_template: {},
    connector: {},
    log_destination: {},
    form: {},
    form_theme: {},
  }
}

export const ID_KEY_TO_MAP: Record<string, keyof AssetIdMaps> = {
  workflow_id: 'workflow',
  workflowId: 'workflow',
  sub_workflow_id: 'workflow',
  table_id: 'data_table',
  tableId: 'data_table',
  data_table_id: 'data_table',
  dataTableId: 'data_table',
  sourceTableId: 'data_table',
  source_table_id: 'data_table',
  // Report configs use data_source / dataSource to point at the
  // underlying custom_table. Without these entries the stored
  // report config kept the manifest string (e.g. "tbl_tickets") and
  // the rendered report could never resolve the data. `source`
  // alone is intentionally NOT in the map — it's overloaded (also
  // used as a discriminator like source: 'custom_table').
  data_source: 'data_table',
  dataSource: 'data_table',
  retention_policy_id: 'retention_policy',
  integration_id: 'integration',
  agent_id: 'agent',
  decision_table_id: 'decision_table',
  decisionTableId: 'decision_table',
  custom_activity_id: 'workflow_activity',
  reference_id: 'reference',
  referenceId: 'reference',
  report_id: 'report',
  reportId: 'report',
  role_id: 'role',
  roleId: 'role',
  mcp_server_id: 'mcp_server',
  mcpServerId: 'mcp_server',
  // send_email / user_task nodes pick a tenant email template.
  email_template_id: 'email_template',
  emailTemplateId: 'email_template',
  // user_task nodes: the assignee notification template.
  notification_template_id: 'email_template',
  notificationTemplateId: 'email_template',
  // user_task nodes / task triggers (and trigger_config.start_form) link a
  // reusable form.
  form_id: 'form',
  // A saved form theme reference ({ source: 'saved', theme_id }) inside a
  // form's theme or a node's form_theme. The key is used for nothing else in
  // manifests, and only ids present in the form_theme map are rewritten.
  theme_id: 'form_theme',
}

export function remapKnownIds<T>(value: T, idMaps: AssetIdMaps): T {
  if (Array.isArray(value)) {
    return value.map((item) => remapKnownIds(item, idMaps)) as T
  }
  if (!value || typeof value !== 'object') return value

  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const mapName = ID_KEY_TO_MAP[key]
    if (mapName && typeof child === 'string' && idMaps[mapName][child]) {
      output[key] = idMaps[mapName][child]
      continue
    }

    // Log destination filters list the workflows they export.
    if (key === 'workflow_ids' && Array.isArray(child)) {
      output[key] = child.map((id) => typeof id === 'string' ? (idMaps.workflow[id] ?? id) : id)
      continue
    }

    // Retention-policy triggers list the policies they watch.
    if (key === 'policy_ids' && Array.isArray(child)) {
      output[key] = child.map((id) => typeof id === 'string' ? (idMaps.retention_policy[id] ?? id) : id)
      continue
    }

    if (key === 'tools' && Array.isArray(child)) {
      output[key] = child.map((toolId) => typeof toolId === 'string' ? (idMaps.reference[toolId] ?? toolId) : toolId)
      continue
    }

    output[key] = remapKnownIds(child, idMaps)
  }
  return output as T
}
