/**
 * Admin help: which admin tools exist, who gets each, and what is never a
 * tool (client-safe, pure — lib/assistants/tools/admin.ts builds the tools;
 * see its header for the guards).
 */
import { holdsPermission, type Permission } from '@/lib/permissions'

/** Never offered to anyone (the Owner included), whatever their permissions. */
export const ADMIN_HARD_EXCLUDED = [
  // secrets: create / reveal / rotate
  'api_keys_list', 'api_keys_create', 'api_keys_revoke', 'api_keys_delete',
  'scim_tokens_list', 'scim_tokens_create', 'scim_tokens_rotate', 'scim_tokens_delete',
  'webhooks_list', 'webhooks_get', 'webhooks_create', 'webhooks_update', 'webhooks_delete', 'webhooks_rotate',
  'log_destinations_create', 'log_destinations_update', 'log_destinations_delete', 'log_destinations_reset_cursor', 'log_destinations_test',
  'directory_sync_connect', 'directory_sync_update', 'directory_sync_disconnect', 'directory_sync_test', 'directory_sync_start',
  'document_ocr_get', 'document_ocr_update', 'document_ocr_remove_key', 'document_ocr_test',
  'workflow_activities_secrets_set',
  'integrations_create', 'integrations_create_bundle', 'integrations_update', 'integrations_delete',
  'connectors_create', 'connectors_update', 'connectors_delete',
  // the workspace address / domain, provider prices and budgets
  'workspace_address_set', 'agents_cost_settings_update',
  // unguarded governance (the guarded admin tools below replace them)
  'roles_manage', 'object_permissions_set', 'object_permissions_remove',
  // bulk / whole-workspace changes
  'config_apply', 'packages_install', 'packages_uninstall', 'teams_delete', 'org_unit_delete',
] as const

/** Read tools that are the MCP tool of the same name (permission: the MCP tool's own). */
export const ADMIN_MCP_READ_TOOLS = [
  'users_list', 'users_manager_get', 'users_reports', 'roles_list', 'roles_get', 'team_members_list', 'teams_list', 'teams_get',
  'invitations_list', 'audit_log_query', 'object_audit_log_query', 'object_permissions_list',
  'org_chart', 'org_units_list', 'org_unit_get', 'org_unit_members', 'org_person_get', 'org_manager_chain', 'org_subordinates', 'org_team_tree',
  'retention_policies_list', 'retention_policies_get', 'retention_policies_list_assets',
  'workspace_theme_get', 'workspace_theme_presets_list', 'form_sign_in_page_get', 'task_completion_settings_get',
  'agents_workspace_usage_get', 'events_list',
  'log_destinations_list', 'log_destinations_status', 'directory_sync_list', 'directory_sync_runs_list',
] as const

/**
 * Every admin tool → the permission it needs: for the MCP reads the MCP
 * tool's own (lib/mcp/authz READ_TOOL_PERMISSIONS — a test keeps them equal),
 * for the Agent's tools the permission of the MCP tool / service they call.
 */
export const ADMIN_TOOL_PERMISSIONS: Record<string, Permission> = {
  // MCP reads
  users_list: 'team.view_members', users_manager_get: 'team.view_members', users_reports: 'team.view_members',
  roles_list: 'team.view_members', roles_get: 'team.view_members', team_members_list: 'team.view_members',
  teams_list: 'team.view_members', teams_get: 'team.view_members',
  invitations_list: 'team.invite', audit_log_query: 'team.change_roles', object_audit_log_query: 'settings.view', object_permissions_list: 'team.change_roles',
  org_chart: 'org.view', org_units_list: 'org.view', org_unit_get: 'org.view', org_unit_members: 'org.view',
  org_person_get: 'tasks.view_own', org_manager_chain: 'tasks.view_own', org_subordinates: 'tasks.view_own', org_team_tree: 'org.view',
  retention_policies_list: 'settings.view', retention_policies_get: 'settings.view', retention_policies_list_assets: 'settings.view',
  workspace_theme_get: 'tasks.view_own', workspace_theme_presets_list: 'tasks.view_own', form_sign_in_page_get: 'tasks.view_own', task_completion_settings_get: 'tasks.view_own',
  agents_workspace_usage_get: 'agents.view', events_list: 'observability.view',
  log_destinations_list: 'observability.view', log_destinations_status: 'observability.view',
  directory_sync_list: 'settings.view', directory_sync_runs_list: 'settings.view',
  // reads
  explain_access: 'team.view_members',
  who_has_access: 'team.view_members',
  workspace_health: 'workflows.view_runs',
  agent_usage: 'assistants.manage',
  settings_overview: 'settings.view',
  // team and members
  invite_member: 'team.invite',
  add_team_member: 'team.invite',
  create_team: 'team.invite',
  remove_team_member: 'team.remove',
  deactivate_member: 'team.remove',
  // roles
  assign_role: 'team.change_roles',
  remove_role: 'team.change_roles',
  create_role: 'team.change_roles',
  update_role: 'team.change_roles',
  set_manager: 'team.change_roles',
  forms_legal_hold: 'team.change_roles',
  // organization
  org_person_update: 'org.manage',
  org_unit_create: 'org.manage',
  org_unit_update: 'org.manage',
  org_unit_member_add: 'org.manage',
  org_unit_member_remove: 'org.manage',
  org_import_csv: 'org.manage',
  // branding and settings with services
  workspace_theme_apply_preset: 'settings.edit',
  workspace_theme_update: 'settings.edit',
  form_sign_in_page_update: 'settings.edit',
  task_completion_settings_update: 'settings.edit',
  retention_policies_create: 'settings.edit',
  retention_policies_update: 'settings.edit',
  retention_policies_delete: 'settings.edit',
}

export const ADMIN_READ_TOOLS: readonly string[] = [...ADMIN_MCP_READ_TOOLS, 'explain_access', 'who_has_access', 'workspace_health', 'agent_usage', 'settings_overview']
export const ADMIN_WRITE_TOOLS: readonly string[] = Object.keys(ADMIN_TOOL_PERMISSIONS).filter((n) => !ADMIN_READ_TOOLS.includes(n))

const EXCLUDED = new Set<string>(ADMIN_HARD_EXCLUDED)

/** The admin tools this person's permissions allow (names), never an excluded one. */
export function allowedAdminToolNames(permissions: ReadonlySet<string>): string[] {
  const has = (p: string | undefined) => Boolean(p) && holdsPermission(permissions, p!)
  return [...ADMIN_READ_TOOLS, ...ADMIN_WRITE_TOOLS].filter((name) => {
    if (EXCLUDED.has(name)) return false
    return has(ADMIN_TOOL_PERMISSIONS[name])
  })
}

