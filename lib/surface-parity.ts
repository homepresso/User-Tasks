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
      op('create with the wizard', 'POST /forms/wizard', 'forms_wizard_create', 'forms wizard-create', 'forms.wizard; form + responses table + optional approval workflow + results page; dry_run returns the plan'),
      op('list wizard forms', 'GET /forms/wizard', 'forms_wizard_list', 'forms wizard-list'),
      op('get wizard form', 'GET /forms/wizard/{id}', 'forms_wizard_get', 'forms wizard-get'),
      op('update with the wizard', 'PATCH /forms/wizard/{id}', 'forms_wizard_update', 'forms wizard-update', 'adds columns, never drops data; republishes the workflow'),
      op('wizard results', 'GET /forms/wizard/{id}/results', 'forms_wizard_results', 'forms wizard-results', 'owner, chosen roles / teams, or forms.edit'),
      op('list submissions', 'GET /forms/{id}/submissions', 'forms_submissions_list', 'forms submissions'),
      op('get submission', 'GET /form-submissions/{id}', 'forms_submission_get', 'form-submissions get'),
      op('lookup', 'POST /forms/{id}/lookup', 'forms_lookup', 'forms lookup'),
      op('data table rows', 'POST /forms/{id}/data-table', 'forms_data_table', 'forms data-table'),
      op('check accessibility', 'POST /forms/{id}/accessibility', 'forms_check_accessibility', 'forms check-accessibility'),
      op('governance', 'GET /forms/{id}/governance', 'forms_governance_get', 'forms governance', 'retention policy, legal hold and submission count'),
      op('legal hold', 'POST /forms/{id}/legal-hold', 'forms_legal_hold', 'forms legal-hold', 'team.change_roles; while held nothing of the form is purged or deleted'),
      op('anonymous link', 'GET /forms/{id}/anonymous', 'forms_anonymous_get', 'forms anonymous', 'the public link (/p/<token>), limits and what anonymous visitors would not get'),
      op('anonymous on / off and limits', 'PATCH /forms/{id}/anonymous', 'forms_anonymous_update', 'forms anonymous-set', 'forms.edit; turning on needs the workspace switch'),
      op('regenerate anonymous link', 'POST /forms/{id}/anonymous/regenerate', 'forms_anonymous_regenerate', 'forms anonymous-regenerate', 'earlier links stop working'),
      op('links', 'GET /forms/{id}/links', 'forms_links', 'forms links', 'the friendly link (/form/<system_name> on the workspace address), /f/<id> and the public /p/<token> link'),
      op('check system name', 'GET /forms/system-name-check', 'forms_system_name_check', 'forms check-system-name', 'set system_name with update (a rename keeps the old name as a redirect)'),
      op('anonymous forms workspace settings', 'GET /anonymous-forms', 'anonymous_forms_settings_get', 'anonymous-forms get', 'the switch and bot protection (never the secret)'),
      op('update anonymous forms workspace settings', 'PATCH /anonymous-forms', 'anonymous_forms_settings_update', 'anonymous-forms update', 'settings.edit; the captcha secret is write-only'),
      op('assign retention policy', 'POST /retention-policies/assign', 'retention_policies_assign', 'retention assign', 'target_type form: the policy governs the submissions (purge modes delete due submissions and their files)'),
      op('list grants', 'GET /object-permissions', 'object_permissions_list', 'object-permissions list', 'object_type form; View and Submit'),
      op('set grant', 'POST /object-permissions', 'object_permissions_set', 'object-permissions set', 'object_type form; can_execute is Submit'),
      op('remove grant', 'DELETE /object-permissions/{id}', 'object_permissions_remove', 'object-permissions remove'),
      op('audit history', 'GET /audit-log', 'object_audit_log_query', 'audit-log list', 'object_type=form (create, update, toggle, grant, revoke, retention, purge, legal_hold, delete)'),
      configExport('form (with_dependencies adds its saved theme and retention policy)'),
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
    resource: 'task attachments',
    ops: [
      op('list', 'GET /tasks/{id}/attachments', 'tasks_attachments_list', 'tasks attachments', 'readers of the task'),
      op('get', 'GET /tasks/{id}/attachments/{attachmentId}/download', 'tasks_attachments_download_url', 'tasks attachment-download', 'a 5-minute signed link plus the attachment (audited); the list carries every field'),
      op('create', 'POST /tasks/{id}/attachments', 'tasks_attachments_add', 'tasks attachment-add', 'base64 inline, or size for a direct upload; `usertasks tasks attach <id> <path>` wraps both'),
      op('update', null, null, null, 'attachments are immutable; delete and attach again'),
      op('delete', 'DELETE /tasks/{id}/attachments/{attachmentId}', 'tasks_attachments_delete', 'tasks attachment-delete', 'uploader or tasks.delete; refused under the form\'s legal hold (audited)'),
      op('start direct upload', 'POST /tasks/{id}/attachments', 'tasks_attachments_add_init', 'tasks attachment-add'),
      op('complete direct upload', 'POST /tasks/{id}/attachments/{attachmentId}/complete', 'tasks_attachments_complete', 'tasks attachment-complete'),
    ],
  },
  {
    resource: 'task follows',
    ops: [
      op('list', 'GET /tasks/following', 'tasks_following', 'tasks following', 'the caller\'s own (Task tracker → Following); visibility re-checked on every read'),
      op('get', null, null, null, 'a follow has no fields of its own: the list carries each task with followed_at'),
      op('create', 'PUT /tasks/{id}/follow', 'tasks_follow', 'tasks follow', 'only a task the caller can see; idempotent'),
      op('update', null, null, null, 'a follow has nothing to change'),
      op('delete', 'DELETE /tasks/{id}/follow', 'tasks_unfollow', 'tasks unfollow', 'idempotent'),
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
      op('upload', 'POST /workflow-activities/upload', 'workflow_activities_upload', 'activities upload', 'a packaged action (manifest v1 + ES module); same key adds a version'),
      op('usages', 'GET /workflow-activities/{id}/usages', 'workflow_activities_usages', 'activities usages'),
      op('get version', 'GET /workflow-activities/{id}/versions/{version}', 'workflow_activities_version_get', 'activities version'),
      op('set secrets', 'PUT /workflow-activities/{id}/secrets', 'workflow_activities_secrets_set', 'activities secrets'),
      op('test', 'POST /workflow-activities/{id}/test', 'workflow_activities_test', 'activities test'),
    ],
  },
  {
    resource: 'form controls',
    ops: [
      op('list', 'GET /form-controls', 'form_controls_list', 'form-controls list'),
      op('get', 'GET /form-controls/{id}', 'form_controls_get', 'form-controls get'),
      op('get version', 'GET /form-controls/{id}/versions/{version}', 'form_controls_version_get', 'form-controls version'),
      op('create', 'POST /form-controls', 'form_controls_create', 'form-controls create', 'upload a zip / module + manifest, or import from a URL; a new tag creates the control, an existing one adds a version'),
      op('update', 'PATCH /form-controls/{id}', 'form_controls_update', 'form-controls update', 'enable / disable, rename, approve network hosts; trusted (no sandbox) is UI-only for instance admins'),
      op('delete', 'DELETE /form-controls/{id}', 'form_controls_delete', 'form-controls delete'),
      op('usages', 'GET /form-controls/{id}/usages', 'form_controls_usages', 'form-controls usages'),
      op('export', 'GET /form-controls/{id}/export', 'form_controls_export', 'form-controls export'),
      op('import', 'POST /form-controls/import', 'form_controls_import', 'form-controls import'),
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
      op('execute', 'POST /agents/{id}/execute', 'agents_execute', 'agents execute', 'MCP always queues (poll agents_job_get); REST / CLI run sync unless async; REST streams with stream: true'),
      op('get job', 'GET /agents/queue/{id}', 'agents_job_get', 'agents job'),
      op('list runs', 'GET /agents/runs', 'agents_runs_list', 'agents runs'),
      op('get run', 'GET /agents/runs/{id}', 'agent_runs_get', 'agents run', 'with the step trace'),
      op('usage', 'GET /agents/{id}/usage', 'agents_usage_get', 'agents usage', 'tokens and cost'),
      op('workspace usage', 'GET /agents/usage', 'agents_workspace_usage_get', 'agents workspace-usage', 'tokens, cost, budgets, prices'),
      op('set prices / budgets', 'PUT /agents/cost-settings', 'agents_cost_settings_update', 'agents cost-settings'),
      op('list versions', 'GET /agents/{id}/versions', 'agents_versions_list', 'agents versions'),
      op('restore version', 'POST /agents/{id}/versions/{version}/restore', 'agents_version_restore', 'agents restore'),
      op('list test cases', 'GET /agents/{id}/evals/cases', 'agents_eval_cases_list', 'agents cases'),
      op('create test case', 'POST /agents/{id}/evals/cases', 'agents_eval_case_save', 'agents case-create'),
      op('update test case', 'PUT /agents/{id}/evals/cases/{caseId}', 'agents_eval_case_save', 'agents case-update', 'MCP: agents_eval_case_save with case_id'),
      op('delete test case', 'DELETE /agents/{id}/evals/cases/{caseId}', 'agents_eval_case_delete', 'agents case-delete'),
      op('run evaluation', 'POST /agents/{id}/evals/runs', 'agents_eval_run', 'agents eval'),
      op('list evaluation runs', 'GET /agents/{id}/evals/runs', 'agents_eval_runs_list', 'agents eval-runs'),
      op('get evaluation run', 'GET /agents/{id}/evals/runs/{runId}', 'agents_eval_run_get', 'agents eval-run'),
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
    resource: 'object permissions',
    ops: [
      op('list', 'GET /object-permissions', 'object_permissions_list', 'object-permissions list', 'the grants on one object (object_type + object_id)'),
      op('get', null, null, null, 'the list of one object carries every field of each grant'),
      op('create', 'POST /object-permissions', 'object_permissions_set', 'object-permissions set', 'adds the grantee\'s grant, or changes it when they already have one'),
      op('update', 'POST /object-permissions', 'object_permissions_set', 'object-permissions set', 'same call as create'),
      op('delete', 'DELETE /object-permissions/{id}', 'object_permissions_remove', 'object-permissions remove'),
    ],
  },
  {
    resource: 'audit log',
    ops: [
      op('list', 'GET /audit-log', 'object_audit_log_query', 'audit-log list', 'filters: object_type (e.g. form), object_id, actor, action, from / to'),
      op('get', null, null, null, 'entries are immutable and the list carries every field'),
      op('create', null, null, null, 'entries are written by the services as changes happen, never by callers'),
      op('update', null, null, null, 'the audit log is append-only'),
      op('delete', null, null, null, 'entries expire with the workspace log retention'),
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
      op('team tree', 'GET /org/teams', 'org_team_tree', 'org team-tree', 'lead, org unit, counts with sub-teams, member preview, projects'),
      op('members with sub-teams', 'GET /org/teams/{id}/members', 'org_team_members', 'org team-members', 'recursive=true adds sub-teams\' members'),
    ],
  },
  {
    resource: 'organization (people)',
    ops: [
      op('list', 'GET /org/chart', 'org_chart', 'org chart', 'every active member with manager, attributes and report counts'),
      op('get', 'GET /org/people/{id}', 'org_person_get', 'org person', '`me` for yourself'),
      op('create', null, null, null, 'people join by invitation or directory sync (invitations send, directory-sync)'),
      op('update', 'PATCH /org/people/{id}', 'org_person_update', 'org update-person', 'attributes need org.manage; directory-owned ones need a detach first'),
      op('delete', null, null, null, 'members leave through Settings → Members or directory sync; their org data goes with them'),
      op('detach from directory', 'POST /org/people/{id}/detach', 'org_person_detach', 'org detach-person'),
      op('subordinates', 'GET /org/people/{id}/subordinates', 'org_subordinates', 'org reports', 'depth=all for every level (capped at 10)'),
      op('manager chain', 'GET /org/people/{id}/manager-chain', 'org_manager_chain', 'org manager-chain'),
      op('peers', 'GET /org/people/{id}/peers', 'org_peers', 'org peers'),
      op('projects of a person', 'GET /org/people/{id}/projects', 'projects_mine', 'org projects'),
      op('resolve a people scope', 'GET /org/scope', 'org_scope_resolve', 'org scope', 'me, direct_reports, all_reports, team, org_unit, project'),
      op('export CSV', 'GET /org/export', 'org_export', 'org export', 'format=csv returns the file'),
      op('import CSV', 'POST /org/import', 'org_import', 'org import', 'dry run by default'),
    ],
  },
  {
    resource: 'org units',
    ops: [
      op('list', 'GET /org/units', 'org_units_list', 'org-units list'),
      op('get', 'GET /org/units/{id}', 'org_unit_get', 'org-units get'),
      op('create', 'POST /org/units', 'org_unit_create', 'org-units create'),
      op('update', 'PATCH /org/units/{id}', 'org_unit_update', 'org-units update', 'parent_id moves it; imported units need a detach first'),
      op('delete', 'DELETE /org/units/{id}', 'org_unit_delete', 'org-units delete', 'sub-units move up to its parent'),
      op('detach from source', 'POST /org/units/{id}/detach', 'org_unit_detach', 'org-units detach'),
      op('list members', 'GET /org/units/{id}/members', 'org_unit_members', 'org-units members', 'recursive=true adds the units below'),
      op('add member', 'PUT /org/units/{id}/members/{userId}', 'org_unit_member_add', 'org-units add-member'),
      op('remove member', 'DELETE /org/units/{id}/members/{userId}', 'org_unit_member_remove', 'org-units remove-member'),
    ],
  },
  {
    resource: 'projects',
    ops: [
      op('list', 'GET /projects', 'projects_list', 'projects list'),
      op('get', 'GET /projects/{id}', 'projects_get', 'projects get'),
      op('create', 'POST /projects', 'projects_create', 'projects create'),
      op('update', 'PATCH /projects/{id}', 'projects_update', 'projects update'),
      op('delete', 'DELETE /projects/{id}', 'projects_delete', 'projects delete'),
      op('archive', 'POST /projects/{id}/archive', 'projects_archive', 'projects archive', 'archived=false restores'),
      op('list people', 'GET /projects/{id}/members', 'projects_members', 'projects members', 'direct members ∪ attached teams\' members'),
      op('add member', 'PUT /projects/{id}/members/{userId}', 'projects_member_add', 'projects add-member'),
      op('remove member', 'DELETE /projects/{id}/members/{userId}', 'projects_member_remove', 'projects remove-member'),
      op('attach team', 'PUT /projects/{id}/teams/{teamId}', 'projects_team_attach', 'projects attach-team'),
      op('detach team', 'DELETE /projects/{id}/teams/{teamId}', 'projects_team_detach', 'projects detach-team'),
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
      op('capabilities', 'GET /directory-sync/capabilities', 'directory_capabilities', 'directory-sync capabilities', 'AAD group task assignment'),
      op('search entra groups', 'GET /directory-sync/entra/groups', 'directory_entra_groups_search', 'directory-sync groups', 'AAD group task assignment'),
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
    resource: 'workspace address',
    ops: [
      op('list', null, null, null, 'one address per workspace: get returns it'),
      op('get', 'GET /workspace/address', 'workspace_address_get', 'workspace-address get'),
      op('create', null, null, null, 'set creates it: every workspace has at most one address'),
      op('update', 'PATCH /workspace/address', 'workspace_address_set', 'workspace-address set', 'settings.edit; the old address redirects for a year'),
      op('delete', 'PATCH /workspace/address', 'workspace_address_set', 'workspace-address set', 'subdomain null removes the address'),
      op('check', 'GET /workspace/address/check', 'workspace_address_check', 'workspace-address check'),
    ],
  },
  {
    resource: 'task completed screen',
    ops: [
      op('list', null, null, null, 'one setting per workspace: get returns it'),
      op('get', 'GET /workspace/task-completion', 'task_completion_settings_get', 'task-completion get'),
      op('create', null, null, null, 'every workspace has it (the defaults until changed)'),
      op('update', 'PATCH /workspace/task-completion', 'task_completion_settings_update', 'task-completion update', 'settings.edit; task forms override it in layout.task_completed'),
      op('delete', null, null, null, 'set enabled false to turn the screen off'),
      op('next step', 'GET /tasks/{id}/next', 'tasks_next_step', 'tasks next', 'completing a task (REST / MCP) returns the same summary as `next`'),
    ],
  },
  {
    resource: 'form sign-in page',
    ops: [
      op('list', null, null, null, 'one setting per workspace: get returns it'),
      op('get', 'GET /workspace/form-sign-in-page', 'form_sign_in_page_get', 'form-sign-in-page get'),
      op('create', null, null, null, 'every workspace has it (the defaults until changed)'),
      op('update', 'PATCH /workspace/form-sign-in-page', 'form_sign_in_page_update', 'form-sign-in-page update', 'settings.edit; the logo is uploaded in Settings → Forms'),
      op('delete', null, null, null, 'update back to the defaults (the settings card has Reset to defaults)'),
    ],
  },
  {
    resource: 'document OCR',
    ops: [
      op('list', null, null, null, 'one OCR setting per workspace: get returns it'),
      op('get', 'GET /document-ocr', 'document_ocr_get', 'document-ocr get'),
      op('create', null, null, null, 'every workspace has a setting (instance default until changed): update sets it'),
      op('update', 'PUT /document-ocr', 'document_ocr_update', 'document-ocr update', 'the Azure key is write-only: "__SECRET__" or omitted keeps it'),
      op('delete', 'DELETE /document-ocr', 'document_ocr_remove_key', 'document-ocr remove-key', 'removes the Azure endpoint and key'),
      op('test', 'POST /document-ocr/test', 'document_ocr_test', 'document-ocr test'),
      op('export', 'GET /config/export', 'config_export', 'config export', 'config export with types=document_ocr (the key is never exported)'),
      op('import', 'POST /config/apply', 'config_apply', 'config apply', 'the Azure key must be entered again after an import'),
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
  { surface: 'MCP', what: 'integration_calls_*, agent_runs_*, trace_get', why: 'observability reads, not configuration' },
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
  { gap: 'Governance (Nov 2026): object grants were UI-only and unaudited; forms had no retention policy, legal hold or governance read on any surface; the audit log was missing from the matrix', fix: 'lib/services/object-permissions (GET/POST/DELETE /object-permissions, object_permissions_*, `object-permissions list|set|remove`, audited grant / revoke); retention assign target_type form; GET /forms/{id}/governance, POST /forms/{id}/legal-hold (forms_governance_get, forms_legal_hold, `forms governance|legal-hold`); audit log row' },
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
