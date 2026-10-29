import type { McpContext } from './server'
import { mcpErr } from './server'
import { writeAudit, type AuditObjectType, type AuditAction } from '@/lib/audit-log'
import type { Permission } from '@/lib/permissions'

/**
 * Per-tool authorization + audit for the MCP surface.
 *
 * Enforced centrally in `McpToolServer.tool()` (lib/mcp/server.ts) so it applies
 * uniformly to all 200+ tools without editing every handler.
 *
 * Model:
 *  - Every MUTATING tool maps to the permission required to call it
 *    (TOOL_PERMISSIONS; these calls are audited).
 *  - Every READ tool maps to the matching *.view permission
 *    (READ_TOOL_PERMISSIONS; not audited). A tool in neither map is denied
 *    when gating is active, so new tools must be classified.
 *  - Enforcement only runs when `ctx.permissions` is a real array (the live route
 *    always sets one). When it is undefined (standalone/test construction), gating
 *    is a no-op so parity/normalization tests are unaffected.
 */

// Mutating tool name → required permission.
export const TOOL_PERMISSIONS: Record<string, Permission> = {
  // agents
  agents_create: 'agents.create',
  agents_update: 'agents.edit',
  agents_delete: 'agents.delete',
  agents_execute: 'agents.test',
  // api keys
  api_keys_create: 'settings.manage_api_keys',
  api_keys_revoke: 'settings.manage_api_keys',
  api_keys_delete: 'settings.manage_api_keys',
  // data
  data_tables_create: 'data.create',
  data_tables_update_schema: 'data.edit_schema',
  data_tables_delete: 'data.delete',
  data_rows_upsert: 'data.manage_rows',
  data_rows_delete: 'data.manage_rows',
  data_rows_bulk_delete: 'data.manage_rows',
  // decision tables (governed by workflow permissions)
  decision_tables_create: 'workflows.create',
  decision_tables_update: 'workflows.edit',
  decision_tables_delete: 'workflows.delete',
  decision_tables_import: 'workflows.create',
  // retention
  retention_policies_create: 'settings.edit',
  retention_policies_update: 'settings.edit',
  retention_policies_delete: 'settings.edit',
  retention_policies_assign: 'settings.edit',
  // extensibility
  workflow_activities_create: 'extensibility.create',
  workflow_activities_update: 'extensibility.edit',
  workflow_activities_delete: 'extensibility.delete',
  workflow_activities_import: 'extensibility.create',
  // email templates (governed by workflow permissions, as in the UI)
  email_templates_create: 'workflows.create',
  email_templates_update: 'workflows.edit',
  email_templates_delete: 'workflows.edit',
  // reusable task forms and form themes
  forms_create: 'forms.edit',
  forms_update: 'forms.edit',
  forms_duplicate: 'forms.edit',
  forms_delete: 'forms.delete',
  forms_submit: 'forms.submit',
  // Attachments uploads (the service checks the context: task, form or workflow start).
  files_upload: 'forms.submit',
  files_upload_init: 'forms.submit',
  files_upload_complete: 'forms.submit',
  form_themes_create: 'forms.edit',
  form_themes_update: 'forms.edit',
  form_themes_delete: 'forms.delete',
  // governance
  roles_manage: 'team.change_roles',
  // teams follow the team UI (and lib/services/teams): invite to add, remove to delete
  teams_create: 'team.invite',
  teams_update: 'team.invite',
  teams_delete: 'team.remove',
  teams_add_member: 'team.invite',
  users_manager_set: 'team.change_roles',
  teams_remove_member: 'team.remove',
  invitations_send: 'team.invite',
  invitations_revoke: 'team.invite',
  invitations_resend: 'team.invite',
  // integrations
  integrations_create: 'integrations.create',
  integrations_create_bundle: 'integrations.create',
  integrations_import_api_spec: 'integrations.create',
  integrations_update: 'integrations.edit',
  integrations_delete: 'integrations.delete',
  integrations_test: 'integrations.test',
  integrations_execute_reference: 'integrations.test',
  connectors_create: 'integrations.create',
  connectors_update: 'integrations.edit',
  connectors_delete: 'integrations.delete',
  connectors_test: 'integrations.test',
  references_create: 'integrations.manage_references',
  references_update: 'integrations.manage_references',
  references_delete: 'integrations.manage_references',
  references_bulk_delete: 'integrations.manage_references',
  objects_create: 'integrations.edit',
  objects_update: 'integrations.edit',
  objects_delete: 'integrations.delete',
  // reports
  reports_create: 'reports.create',
  reports_update: 'reports.edit_own',
  reports_delete: 'reports.delete',
  reports_import: 'reports.create',
  reports_remediate_config: 'reports.edit_own',
  // tasks
  tasks_create: 'tasks.create',
  tasks_escalate: 'tasks.escalate',
  tasks_redirect: 'tasks.redirect',
  tasks_complete: 'tasks.complete',
  tasks_update: 'tasks.manage_queue', // arbitrary mutation of any task's fields
  tasks_respond: 'tasks.complete', // accept/hold/reject in the caller's queue
  tasks_complete_workflow: 'tasks.complete',
  // workflows (the catalog has no finer 'run' permission; execution control is
  // gated with 'activate' rather than left ungated)
  workflows_create: 'workflows.create',
  workflows_update: 'workflows.edit',
  workflows_publish: 'workflows.activate',
  workflows_toggle: 'workflows.activate',
  workflows_delete: 'workflows.delete',
  // webhooks
  webhooks_create: 'settings.manage_webhooks',
  webhooks_update: 'settings.manage_webhooks',
  webhooks_delete: 'settings.manage_webhooks',
  webhooks_rotate: 'settings.manage_webhooks',
  workflows_start: 'workflows.activate',
  workflows_run_action: 'workflows.activate',
  workflows_instances_migrate: 'workflows.manage_runs',
  // log export destinations (the service also requires observability.view)
  directory_sync_connect: 'settings.edit',
  directory_sync_update: 'settings.edit',
  directory_sync_disconnect: 'settings.edit',
  directory_sync_test: 'settings.edit',
  directory_sync_start: 'settings.edit',
  scim_tokens_create: 'settings.edit',
  scim_tokens_rotate: 'settings.edit',
  scim_tokens_delete: 'settings.edit',
  log_destinations_create: 'settings.edit',
  log_destinations_update: 'settings.edit',
  log_destinations_delete: 'settings.edit',
  log_destinations_reset_cursor: 'settings.edit',
  log_destinations_test: 'settings.edit',
  // workspace theme (applies to every member)
  workspace_theme_update: 'settings.edit',
  workspace_theme_apply_preset: 'settings.edit',
  workspace_theme_font_upload: 'settings.edit',
  // config as code: every section is gated by its own create/edit permission in
  // lib/services/config (as POST /config/apply, which has no single permission)
  config_apply: 'tasks.view_own',
  // packages (each installed asset also needs its own create/edit permission, checked in lib/services/config)
  packages_create: 'packages.manage',
  packages_update: 'packages.manage',
  packages_delete: 'packages.manage',
  packages_build: 'packages.manage',
  packages_install: 'packages.install',
  packages_upgrade: 'packages.install',
  packages_complete_setup: 'packages.install',
  packages_uninstall: 'packages.install',
}

// Read tool name → required view permission (same keys as the matching
// /api/v1 GET endpoints and UI pages).
export const READ_TOOL_PERMISSIONS: Record<string, Permission> = {
  // tasks (the REST task reads need view_all; MCP keeps the UI's broader
  // "own tasks" floor so user-context keys can still read their queue)
  tasks_list: 'tasks.view_own',
  tasks_get: 'tasks.view_own',
  tasks_priority_summary: 'tasks.view_own',
  // Autocomplete / lookup suggestions for a task the caller can act on
  // (no write; the service checks the task and runs only the stored config).
  tasks_lookup: 'tasks.complete',
  // workflows
  workflows_catalog: 'workflows.view',
  workflows_preflight: 'workflows.view',
  workflows_resolve_dependencies: 'workflows.view',
  workflows_list: 'workflows.view',
  workflows_get: 'workflows.view',
  workflows_versions_list: 'workflows.view',
  workflows_version_get: 'workflows.view',
  workflows_get_definition: 'workflows.view',
  workflows_inputs_get: 'workflows.view',
  workflows_runs_list: 'workflows.view_runs',
  workflows_run_get: 'workflows.view_runs',
  workflows_instances_list: 'workflows.view_runs',
  trace_get: 'workflows.view_runs',
  // agents
  agents_list: 'agents.view',
  agents_get: 'agents.view',
  agents_runs_list: 'agents.view',
  agent_runs_list: 'agents.view',
  agent_runs_get: 'agents.view',
  // data
  data_tables_list: 'data.view',
  data_tables_get: 'data.view',
  data_rows_query: 'data.view',
  data_rows_search: 'data.view',
  data_rows_get: 'data.view',
  // reports
  reports_query: 'reports.view',
  reports_sources_list: 'reports.view',
  reports_source_get: 'reports.view',
  reports_preview: 'reports.view',
  reports_list: 'reports.view',
  reports_get: 'reports.view',
  reports_export: 'reports.view',
  // integrations
  connectors_list: 'integrations.view',
  connectors_get: 'integrations.view',
  connectors_list_installed: 'integrations.view',
  integrations_list: 'integrations.view',
  integrations_get: 'integrations.view',
  references_list: 'integrations.view',
  references_get: 'integrations.view',
  objects_list: 'integrations.view',
  objects_get: 'integrations.view',
  integration_calls_list: 'integrations.view',
  integration_calls_get: 'integrations.view',
  // governance
  users_list: 'team.view_members',
  users_manager_get: 'team.view_members',
  users_reports: 'team.view_members',
  roles_list: 'team.view_members',
  roles_get: 'team.view_members',
  team_members_list: 'team.view_members',
  teams_list: 'team.view_members',
  teams_get: 'team.view_members',
  audit_log_query: 'team.change_roles', // permission log, as on the governance page
  invitations_list: 'team.invite',
  api_keys_list: 'settings.manage_api_keys',
  object_audit_log_query: 'settings.view', // as the /activity feed
  // decision tables / email templates (workflow building blocks)
  decision_tables_list: 'workflows.view',
  decision_tables_get: 'workflows.view',
  decision_tables_export: 'workflows.view',
  decision_tables_test: 'workflows.view',
  email_templates_list: 'workflows.view',
  email_templates_get: 'workflows.view',
  email_templates_preview: 'workflows.view',
  // reusable task forms and form themes
  forms_list: 'forms.view',
  forms_get: 'forms.view',
  forms_versions: 'forms.view',
  forms_version_get: 'forms.view',
  forms_usages: 'forms.view',
  forms_submissions_list: 'forms.submit',
  forms_submission_get: 'forms.submit',
  forms_lookup: 'forms.submit',
  form_themes_list: 'forms.view',
  form_themes_get: 'forms.view',
  // extensibility
  workflow_activities_list: 'extensibility.view',
  workflow_activities_get: 'extensibility.view',
  workflow_activities_export: 'extensibility.view',
  // retention
  retention_policies_list: 'settings.view',
  retention_policies_list_assets: 'settings.view',
  retention_policies_get: 'settings.view',
  // event stream (audit/security categories also need settings.view, checked in lib/services/events)
  events_list: 'observability.view',
  directory_sync_list: 'settings.view',
  directory_sync_get: 'settings.view',
  directory_sync_runs_list: 'settings.view',
  scim_tokens_list: 'settings.view',
  log_destinations_list: 'observability.view',
  log_destinations_get: 'observability.view',
  log_destinations_status: 'observability.view',
  // webhooks (reads expose payload mappings and urls: same permission as writes)
  webhooks_list: 'settings.manage_webhooks',
  webhooks_get: 'settings.manage_webhooks',
  // workspace theme: readable by any member (REST needs no permission);
  // tasks.view_own is the floor every role holds
  workspace_theme_get: 'tasks.view_own',
  workspace_theme_presets_list: 'tasks.view_own',
  // config export: per-section view permissions are checked in lib/services/config
  config_export: 'tasks.view_own',
  // packages (dry runs: install plan, inspect)
  packages_list: 'packages.view',
  packages_get: 'packages.view',
  packages_preview: 'packages.view',
  packages_contents: 'packages.view',
  packages_assets_search: 'packages.view',
  packages_versions_list: 'packages.view',
  packages_version_get: 'packages.view',
  packages_download: 'packages.view',
  packages_inspect: 'packages.view',
  packages_installs_list: 'packages.view',
  packages_installs_get: 'packages.view',
  packages_install_plan: 'packages.view',
  packages_history: 'packages.view',
  packages_history_get: 'packages.view',
}

/** Permission a tool needs (mutation or read), or undefined for an unclassified tool. */
export function requiredToolPermission(toolName: string): Permission | undefined {
  return TOOL_PERMISSIONS[toolName] ?? READ_TOOL_PERMISSIONS[toolName]
}

// Tools whose service layer (lib/services/*) writes its own, richer audit row;
// auditToolCall skips them so each mutation is audited exactly once.
// Tests/executions are not audited by the services, so they stay here.
export const AUDITED_IN_SERVICE: ReadonlySet<string> = new Set([
  'packages_create',
  'packages_update',
  'packages_delete',
  'packages_build',
  'packages_install',
  'packages_upgrade',
  'packages_complete_setup',
  'packages_uninstall',
  'config_apply',
  'integrations_create',
  'integrations_create_bundle',
  'integrations_import_api_spec',
  'integrations_update',
  'integrations_delete',
  'connectors_create',
  'connectors_update',
  'connectors_delete',
  'references_create',
  'references_update',
  'references_delete',
  'objects_create',
  'objects_update',
  'references_bulk_delete',
  'objects_delete',
  'workflow_activities_create',
  'workflow_activities_update',
  'workflow_activities_delete',
  'workflow_activities_import',
  'email_templates_create',
  'email_templates_update',
  'email_templates_delete',
  'forms_create',
  'forms_update',
  'forms_duplicate',
  'forms_delete',
  'form_themes_create',
  'form_themes_update',
  'form_themes_delete',
  'decision_tables_create',
  'decision_tables_update',
  'decision_tables_delete',
  'decision_tables_import',
  'reports_import',
  'data_tables_create',
  'data_tables_update_schema',
  'data_tables_delete',
  'workflows_create',
  'workflows_update',
  'workflows_publish',
  'workflows_delete',
  'workflows_toggle',
  'roles_manage',
  'teams_create',
  'teams_update',
  'teams_delete',
  'teams_add_member',
  'users_manager_set',
  'teams_remove_member',
  'invitations_send',
  'invitations_revoke',
  'invitations_resend',
  'api_keys_create',
  'api_keys_revoke',
  'api_keys_delete',
  'webhooks_create',
  'webhooks_update',
  'webhooks_delete',
  'webhooks_rotate',
  'directory_sync_connect',
  'directory_sync_update',
  'directory_sync_disconnect',
  'scim_tokens_create',
  'scim_tokens_rotate',
  'scim_tokens_delete',
  'log_destinations_create',
  'log_destinations_update',
  'log_destinations_delete',
  'log_destinations_reset_cursor',
  'log_destinations_test',
  'workspace_theme_update',
  'workspace_theme_apply_preset',
  'workspace_theme_font_upload',
])

// Category prefix → audit object type (best-effort; some are cast strings that
// aren't in AuditObjectType but are still useful audit rows).
const CATEGORY_AUDIT_TYPE: Record<string, AuditObjectType | string> = {
  agents: 'agent',
  api: 'api_key',
  data: 'data_table',
  decision: 'decision_table',
  directory: 'directory_sync',
  scim: 'directory_sync',
  retention: 'retention_policy',
  workflow_activities: 'workflow_activity',
  email: 'email_template',
  forms: 'form',
  form: 'form_theme',
  roles: 'role',
  teams: 'team',
  invitations: 'team',
  integrations: 'integration',
  connectors: 'integration',
  references: 'integration_reference',
  objects: 'integration',
  reports: 'report',
  tasks: 'task',
  workflows: 'workflow',
}

function auditActionFor(toolName: string): AuditAction | string {
  if (toolName.includes('_delete')) return 'delete'
  if (toolName.includes('_publish')) return 'publish'
  if (toolName.includes('_toggle')) return 'toggle'
  if (toolName.includes('_execute') || toolName.includes('_run')) return 'execute'
  if (toolName.includes('_create') || toolName.includes('_import') || toolName.includes('_scaffold') || toolName.includes('_upload')) return 'create'
  if (toolName.includes('_revoke')) return 'revoke'
  if (toolName.includes('_send')) return 'create'
  return 'update'
}

function auditTypeFor(toolName: string): AuditObjectType | string {
  const prefix = toolName.split('_')[0]
  return CATEGORY_AUDIT_TYPE[toolName.startsWith('workflow_activities') ? 'workflow_activities' : prefix] ?? prefix
}

/** Best-effort object id: an *_id arg, an `id` arg, or an id parsed from the result. */
function extractObjectId(args: any, result: any): string {
  if (args && typeof args === 'object') {
    if (typeof args.id === 'string') return args.id
    for (const [k, v] of Object.entries(args)) {
      if (k.endsWith('_id') && typeof v === 'string' && v) return v as string
    }
  }
  try {
    const text = result?.content?.[0]?.text
    if (typeof text === 'string') {
      const parsed = JSON.parse(text)
      const found = findId(parsed)
      if (found) return found
    }
  } catch {
    /* result isn't JSON — ignore */
  }
  return 'unknown'
}

function findId(obj: any, depth = 0): string | null {
  if (!obj || typeof obj !== 'object' || depth > 3) return null
  if (typeof obj.id === 'string') return obj.id
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const nested = findId(v, depth + 1)
      if (nested) return nested
    }
  }
  return null
}

/** True when gating should run (live route sets a permissions array). */
function gatingActive(ctx: McpContext): boolean {
  return Array.isArray((ctx as any).permissions)
}

export function ctxHasPermission(ctx: McpContext, permission: Permission): boolean {
  const perms = (ctx as any).permissions as string[] | undefined
  if (!Array.isArray(perms)) return true // gating disabled
  return perms.includes(permission)
}

/**
 * Enforce the tool's required permission. Returns an mcpErr response to short-circuit
 * with, or null to proceed.
 */
export function checkToolPermission(ctx: McpContext, toolName: string): { content: any[]; isError: true } | null {
  if (!gatingActive(ctx)) return null
  const required = requiredToolPermission(toolName)
  if (!required) return mcpErr(`Forbidden: ${toolName} has no permission mapping`)
  if (ctxHasPermission(ctx, required)) return null
  return mcpErr(`Forbidden: this API key lacks the '${required}' permission required for ${toolName}`)
}

/** Emit a fire-and-forget audit row for a successful mutation. No-op for reads/standalone. */
export function auditToolCall(ctx: McpContext, toolName: string, args: any, result: any): void {
  if (!TOOL_PERMISSIONS[toolName]) return // only audit mutations
  if (AUDITED_IN_SERVICE.has(toolName)) return // the service already wrote the row
  if (result?.isError) return
  const supabase = (ctx as any).supabase
  if (!ctx?.tenantId || typeof supabase?.from !== 'function') return

  void writeAudit({
    supabase,
    tenantId: ctx.tenantId,
    actorId: ctx.actingUserId ?? null,
    objectType: auditTypeFor(toolName) as AuditObjectType,
    objectId: extractObjectId(args, result),
    action: auditActionFor(toolName),
    summary: `MCP: ${toolName}`,
    metadata: { via: 'mcp', tool: toolName, key_type: (ctx as any).keyType ?? null },
  })
}
