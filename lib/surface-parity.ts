/**
 * Surface parity matrix: for every configurable resource, the REST endpoint,
 * MCP tool and CLI command behind each operation. __tests__/surface-parity
 * checks every entry against the endpoint registry, the registered MCP tools
 * and the generated CLI command table, and that docs/parity.md is this
 * matrix rendered (regenerate with `npm run openapi:gen`).
 *
 * null = deliberately not offered on that surface; `note` says why.
 */

export interface SurfaceOp {
  /** list, get, create, update, delete, or a resource-specific operation. */
  op: string
  /** `METHOD /path` relative to /api/v1. */
  rest: string | null
  /** MCP tool name. */
  mcp: string | null
  /** `usertasks <resource> <verb>`, without the `usertasks`. */
  cli: string | null
  note?: string
}

export interface SurfaceResource {
  resource: string
  ops: SurfaceOp[]
}

const op = (name: string, rest: string | null, mcp: string | null, cli: string | null, note?: string): SurfaceOp =>
  ({ op: name, rest, mcp, cli, ...(note ? { note } : {}) })

/**
 * Single-asset export / import through config as code (every type): export
 * with `ids` (optionally `with_dependencies`, `include_rows`), apply the
 * result anywhere — identity is kept, so re-applying updates instead of
 * duplicating.
 */
const configExport = (what: string) => op('export', 'GET /config/export', 'config_export', 'config export', `one ${what}: config export with ids=<id>`)
const configImport = (what: string) => op('import', 'POST /config/apply', 'config_apply', 'config apply', `config apply of the exported ${what.split(' (')[0]} (dry run first)`)

/** The CRUD operations every resource must cover unless a note explains the exception. */
export const CRUD_OPS = ['list', 'get', 'create', 'update', 'delete'] as const

export const SURFACE_PARITY: SurfaceResource[] = [
  {
    resource: 'workflows',
    ops: [
      op('list', 'GET /workflows', 'workflows_list', 'workflows list'),
      op('get', 'GET /workflows/{id}', 'workflows_get', 'workflows get'),
      op('get definition', 'GET /workflows/{id}/definition', 'workflows_get_definition', 'workflows definition'),
      op('create', 'POST /workflows', 'workflows_create', 'workflows create'),
      op('update', 'PATCH /workflows/{id}', 'workflows_update', 'workflows update'),
      op('delete', 'DELETE /workflows/{id}', 'workflows_delete', 'workflows delete'),
      op('publish', 'POST /workflows/{id}/publish', 'workflows_publish', 'workflows publish'),
      op('activate', 'POST /workflows/{id}/activate', 'workflows_toggle', 'workflows activate'),
      op('deactivate', 'POST /workflows/{id}/deactivate', 'workflows_toggle', 'workflows deactivate'),
      op('list versions', 'GET /workflows/{id}/versions', 'workflows_versions_list', 'workflows versions'),
      op('get version', 'GET /workflows/{id}/versions/{versionId}', 'workflows_version_get', 'workflows version'),
      op('start', 'POST /workflows/start', 'workflows_start', 'workflows start'),
      op('get inputs', 'GET /workflows/{id}/inputs', 'workflows_inputs_get', 'workflows inputs'),
      op('list runs', 'GET /workflows/runs', 'workflows_runs_list', 'runs list'),
      op('get run', 'GET /workflows/runs/{id}', 'workflows_run_get', 'runs get'),
      op('run action', 'POST /workflows/runs/{id}/action', 'workflows_run_action', 'runs action'),
      op('list live instances', 'GET /workflows/{id}/instances', 'workflows_instances_list', 'workflows instances'),
      op('migrate live instances', 'POST /workflows/{id}/instances/migrate', 'workflows_instances_migrate', 'workflows migrate-instances'),
      configExport('workflow'),
      configImport('workflow'),
    ],
  },
  {
    resource: 'webhooks',
    ops: [
      op('list', 'GET /workflows/{id}/webhooks', 'webhooks_list', 'webhooks list'),
      op('get', 'GET /webhooks/{id}', 'webhooks_get', 'webhooks get'),
      op('create', 'POST /workflows/{id}/webhooks', 'webhooks_create', 'webhooks create'),
      op('update', 'PATCH /webhooks/{id}', 'webhooks_update', 'webhooks update'),
      op('delete', 'DELETE /webhooks/{id}', 'webhooks_delete', 'webhooks delete'),
      op('rotate secret', 'POST /webhooks/{id}/rotate', 'webhooks_rotate', 'webhooks rotate'),
    ],
  },
  {
    resource: 'integrations',
    ops: [
      op('list', 'GET /integrations', 'integrations_list', 'integrations list'),
      op('get', 'GET /integrations/{id}', 'integrations_get', 'integrations get'),
      op('create', 'POST /integrations', 'integrations_create', 'integrations create'),
      op('update', 'PATCH /integrations/{id}', 'integrations_update', 'integrations update'),
      op('delete', 'DELETE /integrations/{id}', 'integrations_delete', 'integrations delete'),
      op('test', 'POST /integrations/{id}/test', 'integrations_test', 'integrations test'),
      op('import OpenAPI', 'POST /integrations/import-openapi', 'integrations_import_api_spec', 'integrations import-openapi'),
      configExport('integration (with its references and objects)'),
      configImport('integration (with its references and objects)'),
    ],
  },
  {
    resource: 'references',
    ops: [
      op('list', 'GET /integrations/{id}/references', 'references_list', 'references list'),
      op('get', 'GET /references/{id}', 'references_get', 'references get'),
      op('create', 'POST /integrations/{id}/references', 'references_create', 'references create'),
      op('update', 'PATCH /references/{id}', 'references_update', 'references update'),
      op('delete', 'DELETE /references/{id}', 'references_delete', 'references delete'),
      op('bulk delete', 'POST /references/bulk-delete', 'references_bulk_delete', 'references bulk-delete'),
      op('execute', 'POST /references/{id}/execute', 'integrations_execute_reference', 'references execute'),
    ],
  },
  {
    resource: 'objects',
    ops: [
      op('list', 'GET /objects', 'objects_list', 'objects list'),
      op('get', 'GET /objects/{id}', 'objects_get', 'objects get'),
      op('create', 'POST /objects', 'objects_create', 'objects create'),
      op('update', 'PATCH /objects/{id}', 'objects_update', 'objects update'),
      op('delete', 'DELETE /objects/{id}', 'objects_delete', 'objects delete'),
    ],
  },
  {
    resource: 'connectors',
    ops: [
      op('catalog', 'GET /connectors/catalog', 'connectors_list', 'connectors catalog'),
      op('list', 'GET /connectors', 'connectors_list_installed', 'connectors list'),
      op('get', 'GET /connectors/{id}', 'connectors_get', 'connectors get'),
      op('create', 'POST /connectors', 'connectors_create', 'connectors create'),
      op('update', 'PATCH /connectors/{id}', 'connectors_update', 'connectors update'),
      op('delete', 'DELETE /connectors/{id}', 'connectors_delete', 'connectors delete'),
      op('test', 'POST /connectors/{id}/test', 'connectors_test', 'connectors test'),
      op('enable', 'POST /connectors/{id}/enable', 'connectors_update', 'connectors enable', 'MCP: connectors_update { enabled: true }'),
      op('disable', 'POST /connectors/{id}/disable', 'connectors_update', 'connectors disable', 'MCP: connectors_update { enabled: false }'),
      op('regenerate references', 'POST /connectors/{id}/regenerate-references', 'connectors_update', 'connectors regenerate-references', 'MCP: connectors_update { regenerate_references: true }'),
      configExport('connector (credentials never travel)'),
      configImport('connector (credentials never travel)'),
    ],
  },
  {
    resource: 'decision tables',
    ops: [
      op('list', 'GET /decision-tables', 'decision_tables_list', 'decision-tables list'),
      op('get', 'GET /decision-tables/{id}', 'decision_tables_get', 'decision-tables get'),
      op('create', 'POST /decision-tables', 'decision_tables_create', 'decision-tables create'),
      op('update', 'PUT /decision-tables/{id}', 'decision_tables_update', 'decision-tables update', 'PATCH is accepted too'),
      op('delete', 'DELETE /decision-tables/{id}', 'decision_tables_delete', 'decision-tables delete'),
      op('test', 'POST /decision-tables/{id}/test', 'decision_tables_test', 'decision-tables test'),
      op('export', 'GET /decision-tables/{id}/export', 'decision_tables_export', 'decision-tables export'),
      op('import', 'POST /decision-tables/import', 'decision_tables_import', 'decision-tables import'),
    ],
  },
  {
    resource: 'email templates',
    ops: [
      op('list', 'GET /email-templates', 'email_templates_list', 'email-templates list'),
      op('get', 'GET /email-templates/{id}', 'email_templates_get', 'email-templates get'),
      op('create', 'POST /email-templates', 'email_templates_create', 'email-templates create'),
      op('update', 'PATCH /email-templates/{id}', 'email_templates_update', 'email-templates update'),
      op('delete', 'DELETE /email-templates/{id}', 'email_templates_delete', 'email-templates delete'),
      op('preview', 'POST /email-templates/{id}/preview', 'email_templates_preview', 'email-templates preview'),
      configExport('email template'),
      configImport('email template'),
    ],
  },
  {
    resource: 'forms',
    ops: [
      op('list', 'GET /forms', 'forms_list', 'forms list'),
      op('get', 'GET /forms/{id}', 'forms_get', 'forms get'),
      op('create', 'POST /forms', 'forms_create', 'forms create'),
      op('update', 'PATCH /forms/{id}', 'forms_update', 'forms update'),
      op('delete', 'DELETE /forms/{id}', 'forms_delete', 'forms delete'),
      op('duplicate', 'POST /forms/{id}/duplicate', 'forms_duplicate', 'forms duplicate'),
      op('list versions', 'GET /forms/{id}/versions', 'forms_versions', 'forms versions'),
      op('get version', 'GET /forms/{id}/versions/{version}', 'forms_version_get', 'forms version'),
      op('usages', 'GET /forms/{id}/usages', 'forms_usages', 'forms usages'),
      op('submit', 'POST /forms/{id}/submit', 'forms_submit', 'forms submit'),
      op('list submissions', 'GET /forms/{id}/submissions', 'forms_submissions_list', 'forms submissions'),
      op('get submission', 'GET /form-submissions/{id}', 'forms_submission_get', 'form-submissions get'),
      op('lookup', 'POST /forms/{id}/lookup', 'forms_lookup', 'forms lookup'),
      configExport('form (with_dependencies adds its saved theme)'),
      configImport('form'),
    ],
  },
  {
    resource: 'files',
    ops: [
      op('list', null, null, null, 'uploads are reached through the field value that holds them (task data, submission values, run variables)'),
      op('get', null, null, null, 'downloads go through the file object\'s url (/attachments/<id>), authorised per signed-in user'),
      op('create', 'POST /files/uploads', 'files_upload', 'files upload-init', 'upload into a task / form / workflow start context; `usertasks files upload <path>` and `--file field=path` wrap it'),
      op('update', null, null, null, 'files are immutable; upload a new one'),
      op('delete', null, null, null, 'unused uploads expire after 24 h; submitted files go with their task / submission / run'),
      op('start direct upload', 'POST /files/uploads', 'files_upload_init', 'files upload-init'),
      op('complete direct upload', 'POST /files/uploads/{id}/complete', 'files_upload_complete', 'files upload-complete'),
    ],
  },
  {
    resource: 'form themes',
    ops: [
      op('list', 'GET /form-themes', 'form_themes_list', 'form-themes list'),
      op('get', 'GET /form-themes/{id}', 'form_themes_get', 'form-themes get'),
      op('create', 'POST /form-themes', 'form_themes_create', 'form-themes create'),
      op('update', 'PATCH /form-themes/{id}', 'form_themes_update', 'form-themes update'),
      op('delete', 'DELETE /form-themes/{id}', 'form_themes_delete', 'form-themes delete'),
      configExport('form theme'),
      configImport('form theme'),
    ],
  },
  {
    resource: 'workflow activities',
    ops: [
      op('list', 'GET /workflow-activities', 'workflow_activities_list', 'activities list'),
      op('get', 'GET /workflow-activities/{id}', 'workflow_activities_get', 'activities get'),
      op('create', 'POST /workflow-activities', 'workflow_activities_create', 'activities create'),
      op('update', 'PATCH /workflow-activities/{id}', 'workflow_activities_update', 'activities update'),
      op('delete', 'DELETE /workflow-activities/{id}', 'workflow_activities_delete', 'activities delete'),
      op('export', 'GET /workflow-activities/{id}/export', 'workflow_activities_export', 'activities export'),
      op('import', 'POST /workflow-activities/import', 'workflow_activities_import', 'activities import'),
    ],
  },
  {
    resource: 'data tables',
    ops: [
      op('list', 'GET /data-tables', 'data_tables_list', 'tables list'),
      op('get', 'GET /data-tables/{id}', 'data_tables_get', 'tables get'),
      op('create', 'POST /data-tables', 'data_tables_create', 'tables create'),
      op('update', 'PATCH /data-tables/{id}', 'data_tables_update_schema', 'tables update'),
      op('delete', 'DELETE /data-tables/{id}', 'data_tables_delete', 'tables delete'),
      configExport('data table (include_rows for its rows)'),
      configImport('data table (include_rows for its rows)'),
    ],
  },
  {
    resource: 'data rows',
    ops: [
      op('list', 'GET /data-tables/{id}/rows', 'data_rows_query', 'rows list'),
      op('get', 'GET /data-tables/{id}/rows/{rowId}', 'data_rows_get', 'rows get'),
      op('create', 'POST /data-tables/{id}/rows', 'data_rows_upsert', 'rows upsert', 'insert or update (row_id) in one call'),
      op('update', 'PATCH /data-tables/{id}/rows/{rowId}', 'data_rows_upsert', 'rows update', 'MCP: data_rows_upsert { row_id }'),
      op('delete', 'DELETE /data-tables/{id}/rows/{rowId}', 'data_rows_delete', 'rows delete'),
      op('bulk delete', 'POST /data-tables/{id}/rows/bulk-delete', 'data_rows_bulk_delete', 'rows bulk-delete'),
    ],
  },
  {
    resource: 'reports',
    ops: [
      op('list', 'GET /reports', 'reports_list', 'reports list'),
      op('get', 'GET /reports/{id}', 'reports_get', 'reports get'),
      op('create', 'POST /reports', 'reports_create', 'reports create'),
      op('update', 'PUT /reports/{id}', 'reports_update', 'reports update', 'PATCH is accepted too'),
      op('delete', 'DELETE /reports/{id}', 'reports_delete', 'reports delete'),
      op('preview', 'POST /reports/preview', 'reports_preview', 'reports preview'),
      op('sources', 'GET /reports/sources', 'reports_sources_list', 'reports sources'),
      op('export', 'GET /reports/{id}/export', 'reports_export', 'reports export'),
      op('import', 'POST /reports/import', 'reports_import', 'reports import'),
    ],
  },
  {
    resource: 'agents',
    ops: [
      op('list', 'GET /agents', 'agents_list', 'agents list'),
      op('get', 'GET /agents/{id}', 'agents_get', 'agents get'),
      op('create', 'POST /agents', 'agents_create', 'agents create'),
      op('update', 'PUT /agents/{id}', 'agents_update', 'agents update', 'PATCH is accepted too'),
      op('delete', 'DELETE /agents/{id}', 'agents_delete', 'agents delete'),
      op('execute', 'POST /agents/{id}/execute', 'agents_execute', 'agents execute'),
      configExport('agent'),
      configImport('agent'),
    ],
  },
  {
    resource: 'retention policies',
    ops: [
      op('list', 'GET /retention-policies', 'retention_policies_list', 'retention list'),
      op('get', 'GET /retention-policies/{id}', 'retention_policies_get', 'retention get'),
      op('create', 'POST /retention-policies', 'retention_policies_create', 'retention create'),
      op('update', 'PUT /retention-policies/{id}', 'retention_policies_update', 'retention update', 'PATCH is accepted too'),
      op('delete', 'DELETE /retention-policies/{id}', 'retention_policies_delete', 'retention delete'),
      op('list assets', 'GET /retention-policies/{id}/assets', 'retention_policies_list_assets', 'retention assets'),
      op('assign', 'POST /retention-policies/assign', 'retention_policies_assign', 'retention assign'),
      configExport('retention policy'),
      configImport('retention policy'),
    ],
  },
  {
    resource: 'roles',
    ops: [
      op('list', 'GET /roles', 'roles_list', 'roles list'),
      op('get', 'GET /roles/{id}', 'roles_get', 'roles get'),
      op('create', 'POST /roles', 'roles_manage', 'roles create', 'MCP: roles_manage { action: create_role }'),
      op('update', 'PATCH /roles/{id}', 'roles_manage', 'roles update', 'MCP: roles_manage { action: update_role }'),
      op('delete', 'DELETE /roles/{id}', 'roles_manage', 'roles delete', 'MCP: roles_manage { action: delete_role }'),
      op('assign to user', 'PUT /users/{id}/roles/{roleId}', 'roles_manage', 'users add-role', 'MCP: roles_manage { action: assign_role }'),
      op('remove from user', 'DELETE /users/{id}/roles/{roleId}', 'roles_manage', 'users remove-role', 'MCP: roles_manage { action: remove_role }'),
      configExport('custom role'),
      configImport('custom role'),
    ],
  },
  {
    resource: 'teams',
    ops: [
      op('list', 'GET /teams', 'teams_list', 'teams list'),
      op('get', 'GET /teams/{id}', 'teams_get', 'teams get'),
      op('create', 'POST /teams', 'teams_create', 'teams create'),
      op('update', 'PATCH /teams/{id}', 'teams_update', 'teams update'),
      op('delete', 'DELETE /teams/{id}', 'teams_delete', 'teams delete'),
      op('add member', 'PUT /teams/{id}/members/{userId}', 'teams_add_member', 'teams add-member'),
      op('remove member', 'DELETE /teams/{id}/members/{userId}', 'teams_remove_member', 'teams remove-member'),
    ],
  },
  {
    resource: 'invitations',
    ops: [
      op('list', 'GET /invitations', 'invitations_list', 'invitations list'),
      op('get', null, null, null, 'the list returns every field; there is nothing more to fetch per invitation'),
      op('create', 'POST /invitations', 'invitations_send', 'invitations send'),
      op('update', null, null, null, 'invitations are immutable: revoke and send again (resend refreshes the link)'),
      op('delete', 'DELETE /invitations/{id}', 'invitations_revoke', 'invitations revoke'),
      op('resend', 'POST /invitations/{id}/resend', 'invitations_resend', 'invitations resend'),
    ],
  },
  {
    resource: 'api keys',
    ops: [
      op('list', 'GET /api-keys', 'api_keys_list', 'api-keys list'),
      op('get', null, null, null, 'the list returns every stored field; the key itself is only shown at creation'),
      op('create', 'POST /api-keys', 'api_keys_create', 'api-keys create'),
      op('update', null, null, null, 'credentials are immutable by design: create a new key with the new permissions/scopes and revoke the old one'),
      op('delete', 'DELETE /api-keys/{id}', 'api_keys_delete', 'api-keys delete'),
      op('revoke', 'POST /api-keys/{id}/revoke', 'api_keys_revoke', 'api-keys revoke'),
    ],
  },
  {
    resource: 'log destinations',
    ops: [
      op('list', 'GET /log-destinations', 'log_destinations_list', 'log-destinations list'),
      op('get', 'GET /log-destinations/{id}', 'log_destinations_get', 'log-destinations get'),
      op('create', 'POST /log-destinations', 'log_destinations_create', 'log-destinations create'),
      op('update', 'PATCH /log-destinations/{id}', 'log_destinations_update', 'log-destinations update'),
      op('delete', 'DELETE /log-destinations/{id}', 'log_destinations_delete', 'log-destinations delete'),
      op('status', 'GET /log-destinations/{id}/status', 'log_destinations_status', 'log-destinations status'),
      op('reset cursor', 'POST /log-destinations/{id}/reset-cursor', 'log_destinations_reset_cursor', 'log-destinations reset-cursor'),
      op('test', 'POST /log-destinations/{id}/test', 'log_destinations_test', 'log-destinations test'),
      configExport('log destination (no credentials)'),
      configImport('log destination (no credentials)'),
    ],
  },
  {
    resource: 'directory connections',
    ops: [
      op('list', 'GET /directory-sync/connections', 'directory_sync_list', 'directory-sync list'),
      op('get', 'GET /directory-sync/connections/{provider}', 'directory_sync_get', 'directory-sync get'),
      op('create', 'POST /directory-sync/connections', 'directory_sync_connect', 'directory-sync connect', 'verified before it is saved'),
      op('update', 'PATCH /directory-sync/connections/{provider}', 'directory_sync_update', 'directory-sync update'),
      op('delete', 'DELETE /directory-sync/connections/{provider}', 'directory_sync_disconnect', 'directory-sync disconnect', 'links and accounts are kept'),
      op('test', 'POST /directory-sync/connections/{provider}/test', 'directory_sync_test', 'directory-sync test'),
      op('sync now', 'POST /directory-sync/connections/{provider}/sync', 'directory_sync_start', 'directory-sync sync'),
      op('list runs', 'GET /directory-sync/runs', 'directory_sync_runs_list', 'directory-sync runs'),
    ],
  },
  {
    resource: 'scim tokens',
    ops: [
      op('list', 'GET /directory-sync/scim-tokens', 'scim_tokens_list', 'scim-tokens list'),
      op('get', null, null, null, 'the list returns every stored field; the token itself is only shown at creation and rotation'),
      op('create', 'POST /directory-sync/scim-tokens', 'scim_tokens_create', 'scim-tokens create'),
      op('update', null, null, null, 'tokens are immutable: rotate for a new secret, or create one with other scopes'),
      op('delete', 'DELETE /directory-sync/scim-tokens/{id}', 'scim_tokens_delete', 'scim-tokens delete'),
      op('rotate', 'POST /directory-sync/scim-tokens/{id}/rotate', 'scim_tokens_rotate', 'scim-tokens rotate'),
    ],
  },
  {
    resource: 'workspace theme',
    ops: [
      op('list', null, null, null, 'one theme per workspace: get returns it'),
      op('get', 'GET /workspace-theme', 'workspace_theme_get', 'workspace-theme get'),
      op('create', null, null, null, 'every workspace always has a theme (new workspaces start from the default template)'),
      op('update', 'PUT /workspace-theme', 'workspace_theme_update', 'workspace-theme update'),
      op('delete', null, null, null, 'a theme cannot be removed; apply a template to reset it'),
      op('list presets', 'GET /workspace-theme/presets', 'workspace_theme_presets_list', 'workspace-theme presets'),
      op('apply preset', 'POST /workspace-theme/apply-preset', 'workspace_theme_apply_preset', 'workspace-theme apply-preset'),
      op('upload font', 'POST /workspace-theme/fonts', 'workspace_theme_font_upload', 'workspace-theme upload-font'),
    ],
  },
  {
    resource: 'packages',
    ops: [
      op('list', 'GET /packages', 'packages_list', 'packages list'),
      op('get', 'GET /packages/{id}', 'packages_get', 'packages get', 'CLI also: packages show (metadata, items and dependencies)'),
      op('create', 'POST /packages', 'packages_create', 'packages create'),
      op('update', 'PATCH /packages/{id}', 'packages_update', 'packages update', 'CLI also: packages add / remove <type:id>… (or --search), packages set-data <table> rows|schema'),
      op('delete', 'DELETE /packages/{id}', 'packages_delete', 'packages delete'),
      op('preview contents', 'POST /packages/preview', 'packages_preview', 'packages preview'),
      op('contents', 'GET /packages/{id}/contents', 'packages_contents', 'packages contents'),
      op('search assets', 'GET /packages/assets', 'packages_assets_search', 'packages assets', 'every packageable type, cursor-paged with counts; CLI also: packages add --search'),
      op('list versions', 'GET /packages/{id}/versions', 'packages_versions_list', 'packages versions'),
      op('build version', 'POST /packages/{id}/versions', 'packages_build', 'packages build', 'CLI saves the .utpkg (--out)'),
      op('get version', 'GET /packages/{id}/versions/{versionId}', 'packages_version_get', 'packages version'),
      op('download version', 'GET /packages/{id}/versions/{versionId}/download', 'packages_download', 'packages download'),
      op('inspect file', 'POST /packages/inspect', 'packages_inspect', 'packages inspect', 'the CLI verifies offline'),
    ],
  },
  {
    resource: 'package installs',
    ops: [
      op('list', 'GET /package-installs', 'packages_installs_list', 'packages installs'),
      op('get', 'GET /package-installs/{id}', 'packages_installs_get', 'package-installs get'),
      op('create', 'POST /package-installs', 'packages_install', 'packages install', 'install; upgrades in place when installed already'),
      op('update', 'POST /package-installs/{id}/upgrade', 'packages_upgrade', 'packages upgrade'),
      op('delete', 'POST /package-installs/{id}/uninstall', 'packages_uninstall', 'packages uninstall', 'dry_run lists what is removed'),
      op('plan (dry run)', 'POST /package-installs/plan', 'packages_install_plan', 'packages install', 'CLI: packages install --dry-run'),
      op('complete setup', 'POST /package-installs/{id}/complete', 'packages_complete_setup', 'packages complete'),
    ],
  },
  {
    resource: 'package history',
    ops: [
      op('list', 'GET /package-events', 'packages_history', 'packages history', 'filters: package, action, status, channel, actor, since / until; CSV export in the app'),
      op('get', 'GET /package-events/{id}', 'packages_history_get', 'package-events get', 'with the applied plan / diff'),
      op('create', null, null, null, 'events are recorded by installs, upgrades, complete setup and uninstalls (failed attempts too)'),
      op('update', null, null, null, 'the history is append-only'),
      op('delete', null, null, null, 'the history is append-only; events go with the workspace'),
    ],
  },
  {
    resource: 'events',
    ops: [
      op('list', 'GET /events', 'events_list', 'events list', 'cursor paged (after / next_cursor); audit and security also need settings.view'),
      op('get', null, null, null, 'events are immutable and the list carries every field; filter by run_id / task_id / trace_id'),
      op('create', null, null, null, 'events are written by the platform (database triggers), never by callers'),
      op('update', null, null, null, 'the event stream is append-only'),
      op('delete', null, null, null, 'events expire with the stream retention (72h default)'),
    ],
  },
]

/** Workflow-adjacent operations that live on one surface only, on purpose. */
export const SURFACE_ONLY_NOTES: ReadonlyArray<{ surface: 'REST' | 'MCP' | 'CLI'; what: string; why: string }> = [
  { surface: 'MCP', what: 'workflows_catalog, workflows_preflight, workflows_resolve_dependencies', why: 'prompt-authoring aids for agents (node catalog, dependency checks); REST/CLI users read the docs and get validation errors from create/update' },
  { surface: 'MCP', what: 'integrations_create_bundle', why: 'creates an integration and its references in one prompt step; REST/CLI do it with integrations create + references create, or config apply' },
  { surface: 'MCP', what: 'reports_query, reports_source_get, reports_remediate_config, data_rows_search', why: 'agent-oriented read helpers' },
  { surface: 'MCP', what: 'integration_calls_*, agent_runs_*, trace_get, object_audit_log_query', why: 'observability reads, not configuration' },
  { surface: 'CLI', what: 'config diff / new', why: 'folder helpers over POST /config/apply (dry run) and local scaffolding; config export / apply themselves are on every surface (MCP: config_export / config_apply, single-manifest form)' },
  { surface: 'CLI', what: 'tasks complete', why: 'ergonomic wrapper over POST /tasks/{id}/action' },
  { surface: 'CLI', what: 'logs tail, logs export', why: 'live tail over the SSE endpoint GET /events/stream (auto-reconnect, NDJSON with -o json) and cursor export over GET /events; MCP clients poll events_list with `after`' },
]

/** Gaps found when the matrix was first drawn up (Oct 2026), and how each was closed. */
export const GAPS_CLOSED: ReadonlyArray<{ gap: string; fix: string }> = [
  { gap: 'Export coverage (Oct 2026): no single-asset export/import for workflows, data tables, integrations, connectors, email templates, agents, retention policies, roles or log destinations on REST/MCP/CLI; no MCP config export/apply; CLI config export without ids; data-table rows exportable nowhere', fix: 'config export ids + with_dependencies + include_rows (table_rows section, data-rows/ folder) and config apply rows_mode on every surface (MCP config_export / config_apply, CLI --ids / --with-dependencies / --include-rows / --rows-mode); see docs/export-coverage.md' },
  { gap: 'Workflows: GET /workflows/{id} output could not be sent back to update (different shape, id in the body, no trigger_config/description; REST stripped unknown node keys)', fix: 'GET /workflows/{id}/definition returns the author payload; PATCH /workflows/{id} takes it (and the include_definition GET response); nodes/edges are loose; MCP workflows_get_definition + workflows_update { definition }' },
  { gap: 'Workflows: no REST/CLI publish; three different publish implementations (UI, REST author flag, MCP)', fix: 'POST /workflows/{id}/publish and `workflows publish`; REST and MCP share lib/services/workflows (audit, sync, workflows.activate)' },
  { gap: 'Workflows: MCP could not read one published version', fix: 'workflows_version_get' },
  { gap: 'Webhooks: no MCP tools; no get/update on any surface', fix: 'webhooks_* MCP tools; GET/PATCH /webhooks/{id}; service getWebhook/updateWebhook' },
  { gap: 'Objects: no update on any surface', fix: 'updateObject service, PATCH /objects/{id}, objects_update, `objects update`' },
  { gap: 'Connectors: MCP could only list the catalog, not installed connectors', fix: 'connectors_list_installed' },
  { gap: 'References: no MCP bulk delete', fix: 'references_bulk_delete' },
  { gap: 'Data tables / rows: no MCP table delete, row get or bulk row delete; a fetched schema (with system columns) was rejected on update', fix: 'data_tables_delete, data_rows_get, data_rows_bulk_delete; system columns in an update are ignored' },
  { gap: 'Decision tables: REST and MCP had separate CRUD code (REST unaudited, hard delete, required ids)', fix: 'lib/services/decision-tables CRUD + test used by both; PATCH alias; ids generated when missing' },
  { gap: 'Reports: export/import were MCP-only', fix: 'GET /reports/{id}/export, POST /reports/import (lib/services/reports), `reports export|import`' },
  { gap: 'Agents, reports, retention: PUT only, and a GET response sent back was silently ignored (no fields matched)', fix: 'PATCH accepted too; the `{ agent|report|retention_policy: {...} }` wrapper is unwrapped' },
  { gap: 'Integrations: MCP integrations_get hid the config, so MCP could not edit it from a read', fix: 'masked config returned (as REST)' },
  { gap: 'Every update: the `{ <item>: {...} }` GET wrapper and null optional fields were rejected or silently ignored', fix: 'roundTrip handling in apiRoute (prepareRoundTripBody) for every update endpoint' },
  { gap: 'API keys / roles / teams: no MCP delete (keys) or get (roles, teams)', fix: 'api_keys_delete, roles_get, teams_get' },
]

function cell(value: string | null) {
  return value ? `\`${value}\`` : '—'
}

export function renderParityMarkdown(): string {
  const lines: string[] = [
    '# Surface parity: REST, MCP and CLI',
    '',
    '<!-- Generated from lib/surface-parity.ts by `npm run openapi:gen`; __tests__/surface-parity.test.ts fails when it drifts. -->',
    '',
    'Every configurable resource can be listed, read, created, edited and deleted from all three surfaces, and each resource\'s key extra operations are available everywhere. MCP tools and REST routes call the same service in `lib/services`; the CLI commands are generated from the REST registry. `—` marks an operation that is deliberately not offered (see Notes).',
    '',
    '**Edit round trip.** Every update endpoint accepts its own GET response as the body: `usertasks <resource> get <id> -o json > x.json`, edit, `usertasks <resource> update <id> -f x.json`. The `{ <item>: {...} }` wrapper is unwrapped, read-only fields (ids, timestamps, counts) are ignored, `null` for a field that cannot be null means "unchanged" and `__SECRET__` keeps a stored credential. Workflows, decision tables, objects and webhooks report `changed: false` when nothing differs. For workflows, `GET /workflows/{id}/definition` returns exactly the author payload; edits save the draft and `publish` makes them live.',
    '',
  ]
  for (const resource of SURFACE_PARITY) {
    lines.push(`## ${resource.resource[0].toUpperCase()}${resource.resource.slice(1)}`, '')
    lines.push('| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |', '|---|---|---|---|---|')
    for (const entry of resource.ops) {
      lines.push(`| ${entry.op} | ${cell(entry.rest)} | ${cell(entry.mcp)} | ${cell(entry.cli)} | ${entry.note ?? ''} |`)
    }
    lines.push('')
  }
  lines.push('## Single-surface operations', '', '| Surface | Operations | Why |', '|---|---|---|')
  for (const note of SURFACE_ONLY_NOTES) lines.push(`| ${note.surface} | ${note.what} | ${note.why} |`)
  lines.push('', '## Gaps closed (October 2026)', '', '| Gap | Fix |', '|---|---|')
  for (const entry of GAPS_CLOSED) lines.push(`| ${entry.gap} | ${entry.fix} |`)
  lines.push('', 'Verified end to end by `scripts/e2e-surfaces.ts` (create → get → edit file → update → get → delete per resource; workflows add a node and edge, publish, list versions and run the new version).', '')
  return lines.join('\n')
}
