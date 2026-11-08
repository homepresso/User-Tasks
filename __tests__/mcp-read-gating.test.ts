import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { checkToolPermission, READ_TOOL_PERMISSIONS, TOOL_PERMISSIONS } from '@/lib/mcp/authz'
import { createMcpServer, type McpContext } from '@/lib/mcp/server'
import { IMPLIED_PERMISSIONS, PERMISSION_KEYS } from '@/lib/permissions'
import { createMemorySupabase } from './fixtures/supabase-memory'

/**
 * Every MCP read tool and the permission it needs. Changing a line here is a
 * permission change for MCP clients: update the release note
 * (docs/changes/cli-api.md) with it.
 */
const EXPECTED_READ_PERMISSIONS: Record<string, string> = {
  events_list: 'observability.view',
  directory_sync_list: 'settings.view',
  directory_sync_get: 'settings.view',
  directory_sync_runs_list: 'settings.view',
  directory_capabilities: 'workflows.view',
  directory_entra_groups_search: 'workflows.view',
  scim_tokens_list: 'settings.view',
  log_destinations_list: 'observability.view',
  log_destinations_get: 'observability.view',
  log_destinations_status: 'observability.view',
  tasks_list: 'tasks.view_own',
  tasks_get: 'tasks.view_own',
  tasks_attachments_list: 'tasks.view_own',
  tasks_attachments_download_url: 'tasks.view_own',
  tasks_following: 'tasks.view_own',
  tasks_priority_summary: 'tasks.view_own',
  tasks_lookup: 'tasks.complete',
  tasks_data_table: 'tasks.complete',
  workflows_catalog: 'workflows.view',
  workflows_preflight: 'workflows.view',
  workflows_validate: 'workflows.view',
  workflows_resolve_dependencies: 'workflows.view',
  workflows_list: 'workflows.view',
  workflows_get: 'workflows.view',
  workflows_versions_list: 'workflows.view',
  workflows_version_get: 'workflows.view',
  workflows_get_definition: 'workflows.view',
  workflows_inputs_get: 'workflows.view',
  workflows_runs_list: 'workflows.view_queue',
  workflows_run_get: 'workflows.view_queue',
  workflows_instances_list: 'workflows.view_queue',
  trace_get: 'workflows.view_runs',
  agents_list: 'agents.view',
  agents_get: 'agents.view',
  agents_runs_list: 'agents.view',
  agents_job_get: 'agents.view',
  agents_versions_list: 'agents.view',
  agents_eval_cases_list: 'agents.view',
  agents_eval_run_get: 'agents.view',
  agents_eval_runs_list: 'agents.view',
  agents_usage_get: 'agents.view',
  agents_workspace_usage_get: 'agents.view',
  agent_runs_list: 'agents.view',
  agent_runs_get: 'agents.view',
  data_tables_list: 'data.view',
  data_tables_get: 'data.view',
  data_rows_query: 'data.view',
  data_rows_search: 'data.view',
  data_rows_get: 'data.view',
  reports_query: 'reports.view',
  reports_sources_list: 'reports.view',
  reports_source_get: 'reports.view',
  reports_preview: 'reports.view',
  reports_list: 'reports.view',
  reports_get: 'reports.view',
  reports_export: 'reports.view',
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
  users_list: 'team.view_members',
  users_manager_get: 'team.view_members',
  users_reports: 'team.view_members',
  // organization (self-scoped reads at the floor; the service needs org.view for others)
  org_chart: 'org.view',
  org_units_list: 'org.view',
  org_unit_get: 'org.view',
  org_unit_members: 'org.view',
  org_team_tree: 'org.view',
  org_team_members: 'org.view',
  org_export: 'org.view',
  org_person_get: 'tasks.view_own',
  org_subordinates: 'tasks.view_own',
  org_manager_chain: 'tasks.view_own',
  org_peers: 'tasks.view_own',
  org_scope_resolve: 'tasks.view_own',
  projects_list: 'projects.view',
  projects_mine: 'tasks.view_own',
  projects_get: 'tasks.view_own',
  projects_members: 'tasks.view_own',
  roles_list: 'team.view_members',
  roles_get: 'team.view_members',
  team_members_list: 'team.view_members',
  teams_list: 'team.view_members',
  teams_get: 'team.view_members',
  audit_log_query: 'team.change_roles',
  invitations_list: 'team.invite',
  api_keys_list: 'settings.manage_api_keys',
  object_audit_log_query: 'settings.view',
  object_permissions_list: 'team.change_roles',
  decision_tables_list: 'workflows.view',
  decision_tables_get: 'workflows.view',
  decision_tables_export: 'workflows.view',
  decision_tables_test: 'workflows.view',
  email_templates_list: 'workflows.view',
  email_templates_get: 'workflows.view',
  email_templates_preview: 'workflows.view',
  forms_list: 'forms.view',
  forms_wizard_list: 'forms.wizard',
  forms_wizard_get: 'forms.wizard',
  forms_wizard_results: 'forms.submit',
  forms_get: 'forms.view',
  forms_versions: 'forms.view',
  home_favorite_forms: 'forms.submit',
  home_following: 'tasks.view_own',
  home_metrics: 'tasks.view_own',
  home_stats: 'tasks.view_own',
  home_queue: 'tasks.view_own',
  home_run_progress: 'tasks.view_own',
  home_submissions: 'forms.submit',
  home_tasks: 'tasks.view_own',
  forms_version_get: 'forms.view',
  forms_usages: 'forms.view',
  forms_governance_get: 'forms.view',
  forms_anonymous_get: 'forms.view',
  forms_links: 'forms.view',
  forms_system_name_check: 'forms.view',
  anonymous_forms_settings_get: 'settings.view',
  forms_check_accessibility: 'forms.view',
  forms_submissions_list: 'forms.submit',
  forms_submission_get: 'forms.submit',
  forms_lookup: 'forms.submit',
  forms_data_table: 'forms.submit',
  form_themes_list: 'forms.view',
  form_themes_get: 'forms.view',
  workflow_activities_list: 'extensibility.view',
  workflow_activities_get: 'extensibility.view',
  workflow_activities_export: 'extensibility.view',
  workflow_activities_usages: 'extensibility.view',
  workflow_activities_version_get: 'extensibility.view',
  form_controls_list: 'extensibility.view',
  form_controls_get: 'extensibility.view',
  form_controls_version_get: 'extensibility.view',
  form_controls_usages: 'extensibility.view',
  form_controls_export: 'extensibility.view',
  retention_policies_list: 'settings.view',
  retention_policies_list_assets: 'settings.view',
  retention_policies_get: 'settings.view',
  webhooks_list: 'settings.manage_webhooks',
  webhooks_get: 'settings.manage_webhooks',
  workspace_theme_get: 'tasks.view_own',
  workspace_address_get: 'tasks.view_own',
  workspace_address_check: 'tasks.view_own',
  task_completion_settings_get: 'tasks.view_own',
  form_sign_in_page_get: 'tasks.view_own',
  tasks_next_step: 'tasks.view_own',
  workspace_theme_presets_list: 'tasks.view_own',
  document_ocr_get: 'settings.view',
  config_export: 'tasks.view_own',
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

const textOf = (result: { content?: Array<{ text?: string }> } | null) => result?.content?.[0]?.text ?? ''

describe('MCP read tool gating', () => {
  const tools = createMcpServer({ tenantId: 't1', supabase: {} }).getRegisteredTools().map((tool) => tool.name)
  const reads = tools.filter((name) => !TOOL_PERMISSIONS[name])

  it('maps every read tool to the expected permission', () => {
    expect(Object.fromEntries(reads.sort().map((name) => [name, READ_TOOL_PERMISSIONS[name]])))
      .toEqual(Object.fromEntries(Object.entries(EXPECTED_READ_PERMISSIONS).sort(([a], [b]) => a.localeCompare(b))))
  })

  it('classifies every registered tool exactly once with a real permission key', () => {
    for (const name of tools) {
      const mapped = [TOOL_PERMISSIONS[name], READ_TOOL_PERMISSIONS[name]].filter(Boolean)
      expect(mapped, name).toHaveLength(1)
      expect(PERMISSION_KEYS as readonly string[], name).toContain(mapped[0])
    }
    expect(Object.keys(READ_TOOL_PERMISSIONS).filter((name) => !tools.includes(name))).toEqual([])
  })

  it.each(Object.entries(EXPECTED_READ_PERMISSIONS))('%s is denied without %s and allowed with it', (tool, permission) => {
    // Without the permission and without anything that implies it (view_runs ⊃ view_queue).
    const others = PERMISSION_KEYS.filter((p) => p !== permission && !(IMPLIED_PERMISSIONS[p] ?? []).includes(permission as never))
    const denied = checkToolPermission({ tenantId: 't1', supabase: {}, permissions: others } as McpContext, tool)
    expect(textOf(denied)).toContain(permission)
    expect(checkToolPermission({ tenantId: 't1', supabase: {}, permissions: [permission] } as McpContext, tool)).toBeNull()
  })

  it('stays ungated for standalone contexts without a permission list', () => {
    expect(checkToolPermission({ tenantId: 't1', supabase: {} } as McpContext, 'reports_list')).toBeNull()
  })
})

describe('MCP governance wrappers', () => {
  function server(permissions: string[]) {
    const supabase = createMemorySupabase({
      invitations: [{ id: 'inv-a', tenant_id: 't1', email: 'x@a.test', role: 'member', invited_by: 'u1', token: 'secret-token', accepted_at: null, expires_at: '2999-01-01T00:00:00Z' }],
      roles: [{ id: 'r-sys', tenant_id: 't1', name: 'Owner', slug: 'owner', permissions: [], is_system: true }],
    })
    return createMcpServer({ tenantId: 't1', supabase, actingUserId: 'u1', keyType: 'tenant', permissions })
  }

  it('invitations_list needs team.invite and never returns the token', async () => {
    expect((await server(['team.view_members']).callTool('invitations_list', {})).isError).toBe(true)
    const result = await server(['team.invite']).callTool('invitations_list', {})
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('inv-a')
    expect(textOf(result)).not.toContain('secret-token')
  })

  it('roles_manage cannot delete a system role', async () => {
    const result = await server(['team.change_roles']).callTool('roles_manage', { action: 'delete_role', role_id: 'r-sys' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('System roles cannot be deleted')
  })

  it('api_keys_create with an OAuth token lacking keys:write is refused', async () => {
    const supabase = createMemorySupabase({})
    const mcp = createMcpServer({
      tenantId: 't1', supabase, actingUserId: 'u1', keyType: 'user', permissions: [...PERMISSION_KEYS], oauthScopes: ['admin', 'mcp'],
    })
    const result = await mcp.callTool('api_keys_create', { name: 'x', expires_in_days: 7 })
    expect(textOf(result)).toContain('keys:write')
    expect(supabase.calls).toEqual([])
  })
})
