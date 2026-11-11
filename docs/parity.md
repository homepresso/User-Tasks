# Surface parity: REST, MCP and CLI

<!-- Generated from lib/surface-parity.ts by `npm run openapi:gen`; __tests__/surface-parity.test.ts fails when it drifts. -->

Every configurable resource can be listed, read, created, edited and deleted from all three surfaces, and each resource's key extra operations are available everywhere. MCP tools and REST routes call the same service in `lib/services`; the CLI commands are generated from the REST registry. `—` marks an operation that is deliberately not offered (see Notes).

**Edit round trip.** Every update endpoint accepts its own GET response as the body: `usertasks <resource> get <id> -o json > x.json`, edit, `usertasks <resource> update <id> -f x.json`. The `{ <item>: {...} }` wrapper is unwrapped, read-only fields (ids, timestamps, counts) are ignored, `null` for a field that cannot be null means "unchanged" and `__SECRET__` keeps a stored credential. Workflows, decision tables, objects and webhooks report `changed: false` when nothing differs. For workflows, `GET /workflows/{id}/definition` returns exactly the author payload; edits save the draft and `publish` makes them live.

## Workflows

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /workflows` | `workflows_list` | `workflows list` |  |
| get | `GET /workflows/{id}` | `workflows_get` | `workflows get` |  |
| get definition | `GET /workflows/{id}/definition` | `workflows_get_definition` | `workflows definition` |  |
| create | `POST /workflows` | `workflows_create` | `workflows create` |  |
| update | `PATCH /workflows/{id}` | `workflows_update` | `workflows update` |  |
| delete | `DELETE /workflows/{id}` | `workflows_delete` | `workflows delete` |  |
| publish | `POST /workflows/{id}/publish` | `workflows_publish` | `workflows publish` |  |
| activate | `POST /workflows/{id}/activate` | `workflows_toggle` | `workflows activate` |  |
| deactivate | `POST /workflows/{id}/deactivate` | `workflows_toggle` | `workflows deactivate` |  |
| list versions | `GET /workflows/{id}/versions` | `workflows_versions_list` | `workflows versions` |  |
| get version | `GET /workflows/{id}/versions/{versionId}` | `workflows_version_get` | `workflows version` |  |
| start | `POST /workflows/start` | `workflows_start` | `workflows start` |  |
| get inputs | `GET /workflows/{id}/inputs` | `workflows_inputs_get` | `workflows inputs` |  |
| list runs | `GET /workflows/runs` | `workflows_runs_list` | `runs list` |  |
| get run | `GET /workflows/runs/{id}` | `workflows_run_get` | `runs get` |  |
| run action | `POST /workflows/runs/{id}/action` | `workflows_run_action` | `runs action` |  |
| list live instances | `GET /workflows/{id}/instances` | `workflows_instances_list` | `workflows instances` |  |
| migrate live instances | `POST /workflows/{id}/instances/migrate` | `workflows_instances_migrate` | `workflows migrate-instances` |  |
| export | `GET /config/export` | `config_export` | `config export` | one workflow: config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported workflow (dry run first) |

## Webhooks

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /workflows/{id}/webhooks` | `webhooks_list` | `webhooks list` |  |
| get | `GET /webhooks/{id}` | `webhooks_get` | `webhooks get` |  |
| create | `POST /workflows/{id}/webhooks` | `webhooks_create` | `webhooks create` |  |
| update | `PATCH /webhooks/{id}` | `webhooks_update` | `webhooks update` |  |
| delete | `DELETE /webhooks/{id}` | `webhooks_delete` | `webhooks delete` |  |
| rotate secret | `POST /webhooks/{id}/rotate` | `webhooks_rotate` | `webhooks rotate` |  |

## Integrations

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /integrations` | `integrations_list` | `integrations list` |  |
| get | `GET /integrations/{id}` | `integrations_get` | `integrations get` |  |
| create | `POST /integrations` | `integrations_create` | `integrations create` |  |
| update | `PATCH /integrations/{id}` | `integrations_update` | `integrations update` |  |
| delete | `DELETE /integrations/{id}` | `integrations_delete` | `integrations delete` |  |
| test | `POST /integrations/{id}/test` | `integrations_test` | `integrations test` |  |
| import OpenAPI | `POST /integrations/import-openapi` | `integrations_import_api_spec` | `integrations import-openapi` |  |
| export | `GET /config/export` | `config_export` | `config export` | one integration (with its references and objects): config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported integration (dry run first) |

## References

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /integrations/{id}/references` | `references_list` | `references list` |  |
| get | `GET /references/{id}` | `references_get` | `references get` |  |
| create | `POST /integrations/{id}/references` | `references_create` | `references create` |  |
| update | `PATCH /references/{id}` | `references_update` | `references update` |  |
| delete | `DELETE /references/{id}` | `references_delete` | `references delete` |  |
| bulk delete | `POST /references/bulk-delete` | `references_bulk_delete` | `references bulk-delete` |  |
| execute | `POST /references/{id}/execute` | `integrations_execute_reference` | `references execute` |  |

## Objects

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /objects` | `objects_list` | `objects list` |  |
| get | `GET /objects/{id}` | `objects_get` | `objects get` |  |
| create | `POST /objects` | `objects_create` | `objects create` |  |
| update | `PATCH /objects/{id}` | `objects_update` | `objects update` |  |
| delete | `DELETE /objects/{id}` | `objects_delete` | `objects delete` |  |

## Connectors

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| catalog | `GET /connectors/catalog` | `connectors_list` | `connectors catalog` |  |
| list | `GET /connectors` | `connectors_list_installed` | `connectors list` |  |
| get | `GET /connectors/{id}` | `connectors_get` | `connectors get` |  |
| create | `POST /connectors` | `connectors_create` | `connectors create` |  |
| update | `PATCH /connectors/{id}` | `connectors_update` | `connectors update` |  |
| delete | `DELETE /connectors/{id}` | `connectors_delete` | `connectors delete` |  |
| test | `POST /connectors/{id}/test` | `connectors_test` | `connectors test` |  |
| enable | `POST /connectors/{id}/enable` | `connectors_update` | `connectors enable` | MCP: connectors_update { enabled: true } |
| disable | `POST /connectors/{id}/disable` | `connectors_update` | `connectors disable` | MCP: connectors_update { enabled: false } |
| regenerate references | `POST /connectors/{id}/regenerate-references` | `connectors_update` | `connectors regenerate-references` | MCP: connectors_update { regenerate_references: true } |
| export | `GET /config/export` | `config_export` | `config export` | one connector (credentials never travel): config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported connector (dry run first) |

## Decision tables

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /decision-tables` | `decision_tables_list` | `decision-tables list` |  |
| get | `GET /decision-tables/{id}` | `decision_tables_get` | `decision-tables get` |  |
| create | `POST /decision-tables` | `decision_tables_create` | `decision-tables create` |  |
| update | `PUT /decision-tables/{id}` | `decision_tables_update` | `decision-tables update` | PATCH is accepted too |
| delete | `DELETE /decision-tables/{id}` | `decision_tables_delete` | `decision-tables delete` |  |
| test | `POST /decision-tables/{id}/test` | `decision_tables_test` | `decision-tables test` |  |
| export | `GET /decision-tables/{id}/export` | `decision_tables_export` | `decision-tables export` |  |
| import | `POST /decision-tables/import` | `decision_tables_import` | `decision-tables import` |  |

## Email templates

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /email-templates` | `email_templates_list` | `email-templates list` |  |
| get | `GET /email-templates/{id}` | `email_templates_get` | `email-templates get` |  |
| create | `POST /email-templates` | `email_templates_create` | `email-templates create` |  |
| update | `PATCH /email-templates/{id}` | `email_templates_update` | `email-templates update` |  |
| delete | `DELETE /email-templates/{id}` | `email_templates_delete` | `email-templates delete` |  |
| preview | `POST /email-templates/{id}/preview` | `email_templates_preview` | `email-templates preview` |  |
| export | `GET /config/export` | `config_export` | `config export` | one email template: config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported email template (dry run first) |

## Forms

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /forms` | `forms_list` | `forms list` |  |
| get | `GET /forms/{id}` | `forms_get` | `forms get` |  |
| create | `POST /forms` | `forms_create` | `forms create` |  |
| update | `PATCH /forms/{id}` | `forms_update` | `forms update` |  |
| delete | `DELETE /forms/{id}` | `forms_delete` | `forms delete` |  |
| duplicate | `POST /forms/{id}/duplicate` | `forms_duplicate` | `forms duplicate` |  |
| list versions | `GET /forms/{id}/versions` | `forms_versions` | `forms versions` |  |
| get version | `GET /forms/{id}/versions/{version}` | `forms_version_get` | `forms version` |  |
| usages | `GET /forms/{id}/usages` | `forms_usages` | `forms usages` |  |
| submit | `POST /forms/{id}/submit` | `forms_submit` | `forms submit` |  |
| create with the wizard | `POST /forms/wizard` | `forms_wizard_create` | `forms wizard-create` | forms.wizard; form + responses table + optional approval workflow + results page; dry_run returns the plan |
| list wizard forms | `GET /forms/wizard` | `forms_wizard_list` | `forms wizard-list` |  |
| get wizard form | `GET /forms/wizard/{id}` | `forms_wizard_get` | `forms wizard-get` |  |
| update with the wizard | `PATCH /forms/wizard/{id}` | `forms_wizard_update` | `forms wizard-update` | adds columns, never drops data; republishes the workflow |
| wizard results | `GET /forms/wizard/{id}/results` | `forms_wizard_results` | `forms wizard-results` | owner, chosen roles / teams, or forms.edit |
| list submissions | `GET /forms/{id}/submissions` | `forms_submissions_list` | `forms submissions` |  |
| get submission | `GET /form-submissions/{id}` | `forms_submission_get` | `form-submissions get` |  |
| lookup | `POST /forms/{id}/lookup` | `forms_lookup` | `forms lookup` |  |
| data table rows | `POST /forms/{id}/data-table` | `forms_data_table` | `forms data-table` |  |
| check accessibility | `POST /forms/{id}/accessibility` | `forms_check_accessibility` | `forms check-accessibility` |  |
| import InfoPath | `POST /forms/import/infopath` | `forms_import_infopath` | `forms import-infopath` | an .xsn → one form per view (or views as steps); dry_run returns the analysis report |
| governance | `GET /forms/{id}/governance` | `forms_governance_get` | `forms governance` | retention policy, legal hold and submission count |
| legal hold | `POST /forms/{id}/legal-hold` | `forms_legal_hold` | `forms legal-hold` | team.change_roles; while held nothing of the form is purged or deleted |
| anonymous link | `GET /forms/{id}/anonymous` | `forms_anonymous_get` | `forms anonymous` | the public link (/p/<token>), limits and what anonymous visitors would not get |
| anonymous on / off and limits | `PATCH /forms/{id}/anonymous` | `forms_anonymous_update` | `forms anonymous-set` | forms.edit; turning on needs the workspace switch |
| regenerate anonymous link | `POST /forms/{id}/anonymous/regenerate` | `forms_anonymous_regenerate` | `forms anonymous-regenerate` | earlier links stop working |
| links | `GET /forms/{id}/links` | `forms_links` | `forms links` | the friendly link (/form/<system_name> on the workspace address), /f/<id> and the public /p/<token> link |
| check system name | `GET /forms/system-name-check` | `forms_system_name_check` | `forms check-system-name` | set system_name with update (a rename keeps the old name as a redirect) |
| anonymous forms workspace settings | `GET /anonymous-forms` | `anonymous_forms_settings_get` | `anonymous-forms get` | the switch and bot protection (never the secret) |
| update anonymous forms workspace settings | `PATCH /anonymous-forms` | `anonymous_forms_settings_update` | `anonymous-forms update` | settings.edit; the captcha secret is write-only |
| assign retention policy | `POST /retention-policies/assign` | `retention_policies_assign` | `retention assign` | target_type form: the policy governs the submissions (purge modes delete due submissions and their files) |
| list grants | `GET /object-permissions` | `object_permissions_list` | `object-permissions list` | object_type form; View and Submit |
| set grant | `POST /object-permissions` | `object_permissions_set` | `object-permissions set` | object_type form; can_execute is Submit |
| remove grant | `DELETE /object-permissions/{id}` | `object_permissions_remove` | `object-permissions remove` |  |
| audit history | `GET /audit-log` | `object_audit_log_query` | `audit-log list` | object_type=form (create, update, toggle, grant, revoke, retention, purge, legal_hold, delete) |
| export | `GET /config/export` | `config_export` | `config export` | one form (with_dependencies adds its saved theme and retention policy): config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported form (dry run first) |

## Files

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | — | — | — | uploads are reached through the field value that holds them (task data, submission values, run variables) |
| get | — | — | — | downloads go through the file object's url (/attachments/<id>), authorised per signed-in user |
| create | `POST /files/uploads` | `files_upload` | `files upload-init` | upload into a task / form / workflow start context; `usertasks files upload <path>` and `--file field=path` wrap it |
| update | — | — | — | files are immutable; upload a new one |
| delete | — | — | — | unused uploads expire after 24 h; submitted files go with their task / submission / run |
| start direct upload | `POST /files/uploads` | `files_upload_init` | `files upload-init` |  |
| complete direct upload | `POST /files/uploads/{id}/complete` | `files_upload_complete` | `files upload-complete` |  |

## Task attachments

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /tasks/{id}/attachments` | `tasks_attachments_list` | `tasks attachments` | readers of the task |
| get | `GET /tasks/{id}/attachments/{attachmentId}/download` | `tasks_attachments_download_url` | `tasks attachment-download` | a 5-minute signed link plus the attachment (audited); the list carries every field |
| create | `POST /tasks/{id}/attachments` | `tasks_attachments_add` | `tasks attachment-add` | base64 inline, or size for a direct upload; `usertasks tasks attach <id> <path>` wraps both |
| update | — | — | — | attachments are immutable; delete and attach again |
| delete | `DELETE /tasks/{id}/attachments/{attachmentId}` | `tasks_attachments_delete` | `tasks attachment-delete` | uploader or tasks.delete; refused under the form's legal hold (audited) |
| start direct upload | `POST /tasks/{id}/attachments` | `tasks_attachments_add_init` | `tasks attachment-add` |  |
| complete direct upload | `POST /tasks/{id}/attachments/{attachmentId}/complete` | `tasks_attachments_complete` | `tasks attachment-complete` |  |

## Subtasks

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /tasks/{id}/subtasks` | `tasks_subtasks_list` | `tasks subtasks` | direct subtasks in order, with can_add |
| get | `GET /tasks/{id}` | `tasks_get` | `tasks get` | a subtask is a task |
| create | `POST /tasks/{id}/subtasks` | `tasks_add_subtask` | `tasks add-subtask` | anyone who can work on the open task (workflow tasks included); title + optional subtitle, description, estimate, due date, priority, tags |
| update | `PATCH /tasks/{id}/subtasks/{subtaskId}` | `tasks_update_subtask` | `tasks update-subtask` | only the fields sent change |
| delete | — | — | — | subtasks are cancelled (status), not deleted: PATCH /tasks/{id} status cancelled |

## Task follows

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /tasks/following` | `tasks_following` | `tasks following` | the caller's own (Task tracker → Following); visibility re-checked on every read |
| get | — | — | — | a follow has no fields of its own: the list carries each task with followed_at |
| create | `PUT /tasks/{id}/follow` | `tasks_follow` | `tasks follow` | only a task the caller can see; idempotent |
| update | — | — | — | a follow has nothing to change |
| delete | `DELETE /tasks/{id}/follow` | `tasks_unfollow` | `tasks unfollow` | idempotent |

## Task viewers (invite, read only)

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /tasks/{id}/viewers` | `tasks_viewers_list` | `tasks viewers` | anyone who can see the task; can_manage says who may change them |
| get | — | — | — | an invite has no detail beyond the list row |
| create | `POST /tasks/{id}/viewers` | `tasks_viewers_add` | `tasks viewers-add` | people, teams or roles; the people working on the task, its assigner, their managers, a manager of the workflow or tasks.complete_any |
| update | — | — | — | remove the invite and invite again |
| delete | `DELETE /tasks/{id}/viewers/{viewerId}` | `tasks_viewers_remove` | `tasks viewers-remove` |  |

## Timelines (read only)

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | — | — | — | a timeline belongs to one run or task: read it from the run or the task |
| get | `GET /workflows/runs/{id}/timeline` | `workflows_run_timeline` | `runs timeline` | a run in plain words; only what the caller may see |
| get task timeline | `GET /tasks/{id}/timeline` | `tasks_timeline` | `tasks timeline` | its run's timeline when the run is visible, else the task's own history |
| create | — | — | — | built from the run, its tasks and their history as things happen |
| update | — | — | — | read only: comment on the task, or act on it, to add to it |
| delete | — | — | — | follows the run and its tasks (retention) |

## Form themes

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /form-themes` | `form_themes_list` | `form-themes list` |  |
| get | `GET /form-themes/{id}` | `form_themes_get` | `form-themes get` |  |
| create | `POST /form-themes` | `form_themes_create` | `form-themes create` |  |
| update | `PATCH /form-themes/{id}` | `form_themes_update` | `form-themes update` |  |
| delete | `DELETE /form-themes/{id}` | `form_themes_delete` | `form-themes delete` |  |
| export | `GET /config/export` | `config_export` | `config export` | one form theme: config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported form theme (dry run first) |

## Workflow activities

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /workflow-activities` | `workflow_activities_list` | `activities list` |  |
| get | `GET /workflow-activities/{id}` | `workflow_activities_get` | `activities get` |  |
| create | `POST /workflow-activities` | `workflow_activities_create` | `activities create` |  |
| update | `PATCH /workflow-activities/{id}` | `workflow_activities_update` | `activities update` |  |
| delete | `DELETE /workflow-activities/{id}` | `workflow_activities_delete` | `activities delete` |  |
| export | `GET /workflow-activities/{id}/export` | `workflow_activities_export` | `activities export` |  |
| import | `POST /workflow-activities/import` | `workflow_activities_import` | `activities import` |  |
| upload | `POST /workflow-activities/upload` | `workflow_activities_upload` | `activities upload` | a packaged action (manifest v1 + ES module); same key adds a version |
| usages | `GET /workflow-activities/{id}/usages` | `workflow_activities_usages` | `activities usages` |  |
| get version | `GET /workflow-activities/{id}/versions/{version}` | `workflow_activities_version_get` | `activities version` |  |
| set secrets | `PUT /workflow-activities/{id}/secrets` | `workflow_activities_secrets_set` | `activities secrets` |  |
| test | `POST /workflow-activities/{id}/test` | `workflow_activities_test` | `activities test` |  |

## Form controls

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /form-controls` | `form_controls_list` | `form-controls list` |  |
| get | `GET /form-controls/{id}` | `form_controls_get` | `form-controls get` |  |
| get version | `GET /form-controls/{id}/versions/{version}` | `form_controls_version_get` | `form-controls version` |  |
| create | `POST /form-controls` | `form_controls_create` | `form-controls create` | upload a zip / module + manifest, or import from a URL; a new tag creates the control, an existing one adds a version |
| update | `PATCH /form-controls/{id}` | `form_controls_update` | `form-controls update` | enable / disable, rename, approve network hosts; trusted (no sandbox) is UI-only for instance admins |
| delete | `DELETE /form-controls/{id}` | `form_controls_delete` | `form-controls delete` |  |
| usages | `GET /form-controls/{id}/usages` | `form_controls_usages` | `form-controls usages` |  |
| export | `GET /form-controls/{id}/export` | `form_controls_export` | `form-controls export` |  |
| import | `POST /form-controls/import` | `form_controls_import` | `form-controls import` |  |

## Data tables

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /data-tables` | `data_tables_list` | `tables list` |  |
| get | `GET /data-tables/{id}` | `data_tables_get` | `tables get` |  |
| create | `POST /data-tables` | `data_tables_create` | `tables create` |  |
| update | `PATCH /data-tables/{id}` | `data_tables_update_schema` | `tables update` |  |
| delete | `DELETE /data-tables/{id}` | `data_tables_delete` | `tables delete` |  |
| export | `GET /config/export` | `config_export` | `config export` | one data table (include_rows for its rows): config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported data table (dry run first) |

## Data rows

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /data-tables/{id}/rows` | `data_rows_query` | `rows list` |  |
| get | `GET /data-tables/{id}/rows/{rowId}` | `data_rows_get` | `rows get` |  |
| create | `POST /data-tables/{id}/rows` | `data_rows_upsert` | `rows upsert` | insert or update (row_id) in one call |
| update | `PATCH /data-tables/{id}/rows/{rowId}` | `data_rows_upsert` | `rows update` | MCP: data_rows_upsert { row_id } |
| delete | `DELETE /data-tables/{id}/rows/{rowId}` | `data_rows_delete` | `rows delete` |  |
| bulk delete | `POST /data-tables/{id}/rows/bulk-delete` | `data_rows_bulk_delete` | `rows bulk-delete` |  |
| import | `POST /data-tables/{id}/rows/import` | `data_rows_import` | `rows import` | CSV / TSV / .xlsx: insert, upsert or replace; dry_run validates; MCP also takes csv_text |

## Reports

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /reports` | `reports_list` | `reports list` |  |
| get | `GET /reports/{id}` | `reports_get` | `reports get` |  |
| create | `POST /reports` | `reports_create` | `reports create` |  |
| update | `PUT /reports/{id}` | `reports_update` | `reports update` | PATCH is accepted too |
| delete | `DELETE /reports/{id}` | `reports_delete` | `reports delete` |  |
| preview | `POST /reports/preview` | `reports_preview` | `reports preview` |  |
| sources | `GET /reports/sources` | `reports_sources_list` | `reports sources` |  |
| export | `GET /reports/{id}/export` | `reports_export` | `reports export` |  |
| import | `POST /reports/import` | `reports_import` | `reports import` |  |

## Agents

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /agents` | `agents_list` | `agents list` |  |
| get | `GET /agents/{id}` | `agents_get` | `agents get` |  |
| create | `POST /agents` | `agents_create` | `agents create` |  |
| update | `PUT /agents/{id}` | `agents_update` | `agents update` | PATCH is accepted too |
| delete | `DELETE /agents/{id}` | `agents_delete` | `agents delete` |  |
| execute | `POST /agents/{id}/execute` | `agents_execute` | `agents execute` | MCP always queues (poll agents_job_get); REST / CLI run sync unless async; REST streams with stream: true |
| get job | `GET /agents/queue/{id}` | `agents_job_get` | `agents job` |  |
| list runs | `GET /agents/runs` | `agents_runs_list` | `agents runs` |  |
| get run | `GET /agents/runs/{id}` | `agent_runs_get` | `agents run` | with the step trace |
| usage | `GET /agents/{id}/usage` | `agents_usage_get` | `agents usage` | tokens and cost |
| workspace usage | `GET /agents/usage` | `agents_workspace_usage_get` | `agents workspace-usage` | tokens, cost, budgets, prices |
| set prices / budgets | `PUT /agents/cost-settings` | `agents_cost_settings_update` | `agents cost-settings` |  |
| list versions | `GET /agents/{id}/versions` | `agents_versions_list` | `agents versions` |  |
| restore version | `POST /agents/{id}/versions/{version}/restore` | `agents_version_restore` | `agents restore` |  |
| list test cases | `GET /agents/{id}/evals/cases` | `agents_eval_cases_list` | `agents cases` |  |
| create test case | `POST /agents/{id}/evals/cases` | `agents_eval_case_save` | `agents case-create` |  |
| update test case | `PUT /agents/{id}/evals/cases/{caseId}` | `agents_eval_case_save` | `agents case-update` | MCP: agents_eval_case_save with case_id |
| delete test case | `DELETE /agents/{id}/evals/cases/{caseId}` | `agents_eval_case_delete` | `agents case-delete` |  |
| run evaluation | `POST /agents/{id}/evals/runs` | `agents_eval_run` | `agents eval` |  |
| list evaluation runs | `GET /agents/{id}/evals/runs` | `agents_eval_runs_list` | `agents eval-runs` |  |
| get evaluation run | `GET /agents/{id}/evals/runs/{runId}` | `agents_eval_run_get` | `agents eval-run` |  |
| export | `GET /config/export` | `config_export` | `config export` | one agent: config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported agent (dry run first) |

## Retention policies

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /retention-policies` | `retention_policies_list` | `retention list` |  |
| get | `GET /retention-policies/{id}` | `retention_policies_get` | `retention get` |  |
| create | `POST /retention-policies` | `retention_policies_create` | `retention create` |  |
| update | `PUT /retention-policies/{id}` | `retention_policies_update` | `retention update` | PATCH is accepted too |
| delete | `DELETE /retention-policies/{id}` | `retention_policies_delete` | `retention delete` |  |
| list assets | `GET /retention-policies/{id}/assets` | `retention_policies_list_assets` | `retention assets` |  |
| assign | `POST /retention-policies/assign` | `retention_policies_assign` | `retention assign` |  |
| export | `GET /config/export` | `config_export` | `config export` | one retention policy: config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported retention policy (dry run first) |

## Object permissions

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /object-permissions` | `object_permissions_list` | `object-permissions list` | the grants on one object (object_type + object_id) |
| get | — | — | — | the list of one object carries every field of each grant |
| create | `POST /object-permissions` | `object_permissions_set` | `object-permissions set` | adds the grantee's grant, or changes it when they already have one |
| update | `POST /object-permissions` | `object_permissions_set` | `object-permissions set` | same call as create |
| delete | `DELETE /object-permissions/{id}` | `object_permissions_remove` | `object-permissions remove` |  |

## Audit log

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /audit-log` | `object_audit_log_query` | `audit-log list` | filters: object_type (e.g. form), object_id, actor, action, from / to |
| get | — | — | — | entries are immutable and the list carries every field |
| create | — | — | — | entries are written by the services as changes happen, never by callers |
| update | — | — | — | the audit log is append-only |
| delete | — | — | — | entries expire with the workspace log retention |

## Roles

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /roles` | `roles_list` | `roles list` |  |
| get | `GET /roles/{id}` | `roles_get` | `roles get` |  |
| create | `POST /roles` | `roles_manage` | `roles create` | MCP: roles_manage { action: create_role } |
| update | `PATCH /roles/{id}` | `roles_manage` | `roles update` | MCP: roles_manage { action: update_role } |
| delete | `DELETE /roles/{id}` | `roles_manage` | `roles delete` | MCP: roles_manage { action: delete_role } |
| assign to user | `PUT /users/{id}/roles/{roleId}` | `roles_manage` | `users add-role` | MCP: roles_manage { action: assign_role } |
| remove from user | `DELETE /users/{id}/roles/{roleId}` | `roles_manage` | `users remove-role` | MCP: roles_manage { action: remove_role } |
| export | `GET /config/export` | `config_export` | `config export` | one custom role: config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported custom role (dry run first) |

## Teams

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /teams` | `teams_list` | `teams list` |  |
| get | `GET /teams/{id}` | `teams_get` | `teams get` |  |
| create | `POST /teams` | `teams_create` | `teams create` |  |
| update | `PATCH /teams/{id}` | `teams_update` | `teams update` |  |
| delete | `DELETE /teams/{id}` | `teams_delete` | `teams delete` |  |
| add member | `PUT /teams/{id}/members/{userId}` | `teams_add_member` | `teams add-member` |  |
| remove member | `DELETE /teams/{id}/members/{userId}` | `teams_remove_member` | `teams remove-member` |  |
| team tree | `GET /org/teams` | `org_team_tree` | `org team-tree` | lead, org unit, counts with sub-teams, member preview, projects |
| members with sub-teams | `GET /org/teams/{id}/members` | `org_team_members` | `org team-members` | recursive=true adds sub-teams' members |

## Organization (people)

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /org/chart` | `org_chart` | `org chart` | every active member with manager, attributes and report counts |
| get | `GET /org/people/{id}` | `org_person_get` | `org person` | `me` for yourself |
| create | — | — | — | people join by invitation or directory sync (invitations send, directory-sync) |
| update | `PATCH /org/people/{id}` | `org_person_update` | `org update-person` | attributes need org.manage; directory-owned ones need a detach first |
| delete | — | — | — | members leave through Settings → Members or directory sync; their org data goes with them |
| detach from directory | `POST /org/people/{id}/detach` | `org_person_detach` | `org detach-person` |  |
| subordinates | `GET /org/people/{id}/subordinates` | `org_subordinates` | `org reports` | depth=all for every level (capped at 10) |
| manager chain | `GET /org/people/{id}/manager-chain` | `org_manager_chain` | `org manager-chain` |  |
| peers | `GET /org/people/{id}/peers` | `org_peers` | `org peers` |  |
| projects of a person | `GET /org/people/{id}/projects` | `projects_mine` | `org projects` |  |
| resolve a people scope | `GET /org/scope` | `org_scope_resolve` | `org scope` | me, direct_reports, all_reports, team, org_unit, project |
| export CSV | `GET /org/export` | `org_export` | `org export` | format=csv returns the file |
| import CSV | `POST /org/import` | `org_import` | `org import` | dry run by default |

## Org units

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /org/units` | `org_units_list` | `org-units list` |  |
| get | `GET /org/units/{id}` | `org_unit_get` | `org-units get` |  |
| create | `POST /org/units` | `org_unit_create` | `org-units create` |  |
| update | `PATCH /org/units/{id}` | `org_unit_update` | `org-units update` | parent_id moves it; imported units need a detach first |
| delete | `DELETE /org/units/{id}` | `org_unit_delete` | `org-units delete` | sub-units move up to its parent |
| detach from source | `POST /org/units/{id}/detach` | `org_unit_detach` | `org-units detach` |  |
| list members | `GET /org/units/{id}/members` | `org_unit_members` | `org-units members` | recursive=true adds the units below |
| add member | `PUT /org/units/{id}/members/{userId}` | `org_unit_member_add` | `org-units add-member` |  |
| remove member | `DELETE /org/units/{id}/members/{userId}` | `org_unit_member_remove` | `org-units remove-member` |  |

## Projects

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /projects` | `projects_list` | `projects list` |  |
| get | `GET /projects/{id}` | `projects_get` | `projects get` |  |
| create | `POST /projects` | `projects_create` | `projects create` |  |
| update | `PATCH /projects/{id}` | `projects_update` | `projects update` |  |
| delete | `DELETE /projects/{id}` | `projects_delete` | `projects delete` |  |
| archive | `POST /projects/{id}/archive` | `projects_archive` | `projects archive` | archived=false restores |
| list people | `GET /projects/{id}/members` | `projects_members` | `projects members` | direct members ∪ attached teams' members |
| add member | `PUT /projects/{id}/members/{userId}` | `projects_member_add` | `projects add-member` |  |
| remove member | `DELETE /projects/{id}/members/{userId}` | `projects_member_remove` | `projects remove-member` |  |
| attach team | `PUT /projects/{id}/teams/{teamId}` | `projects_team_attach` | `projects attach-team` |  |
| detach team | `DELETE /projects/{id}/teams/{teamId}` | `projects_team_detach` | `projects detach-team` |  |

## Invitations

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /invitations` | `invitations_list` | `invitations list` |  |
| get | — | — | — | the list returns every field; there is nothing more to fetch per invitation |
| create | `POST /invitations` | `invitations_send` | `invitations send` |  |
| update | — | — | — | invitations are immutable: revoke and send again (resend refreshes the link) |
| delete | `DELETE /invitations/{id}` | `invitations_revoke` | `invitations revoke` |  |
| resend | `POST /invitations/{id}/resend` | `invitations_resend` | `invitations resend` |  |

## Api keys

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /api-keys` | `api_keys_list` | `api-keys list` |  |
| get | — | — | — | the list returns every stored field; the key itself is only shown at creation |
| create | `POST /api-keys` | `api_keys_create` | `api-keys create` |  |
| update | — | — | — | credentials are immutable by design: create a new key with the new permissions/scopes and revoke the old one |
| delete | `DELETE /api-keys/{id}` | `api_keys_delete` | `api-keys delete` |  |
| revoke | `POST /api-keys/{id}/revoke` | `api_keys_revoke` | `api-keys revoke` |  |

## Log destinations

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /log-destinations` | `log_destinations_list` | `log-destinations list` |  |
| get | `GET /log-destinations/{id}` | `log_destinations_get` | `log-destinations get` |  |
| create | `POST /log-destinations` | `log_destinations_create` | `log-destinations create` |  |
| update | `PATCH /log-destinations/{id}` | `log_destinations_update` | `log-destinations update` |  |
| delete | `DELETE /log-destinations/{id}` | `log_destinations_delete` | `log-destinations delete` |  |
| status | `GET /log-destinations/{id}/status` | `log_destinations_status` | `log-destinations status` |  |
| reset cursor | `POST /log-destinations/{id}/reset-cursor` | `log_destinations_reset_cursor` | `log-destinations reset-cursor` |  |
| test | `POST /log-destinations/{id}/test` | `log_destinations_test` | `log-destinations test` |  |
| export | `GET /config/export` | `config_export` | `config export` | one log destination (no credentials): config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported log destination (dry run first) |

## Directory connections

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /directory-sync/connections` | `directory_sync_list` | `directory-sync list` |  |
| get | `GET /directory-sync/connections/{provider}` | `directory_sync_get` | `directory-sync get` |  |
| create | `POST /directory-sync/connections` | `directory_sync_connect` | `directory-sync connect` | verified before it is saved |
| update | `PATCH /directory-sync/connections/{provider}` | `directory_sync_update` | `directory-sync update` |  |
| delete | `DELETE /directory-sync/connections/{provider}` | `directory_sync_disconnect` | `directory-sync disconnect` | links and accounts are kept |
| test | `POST /directory-sync/connections/{provider}/test` | `directory_sync_test` | `directory-sync test` |  |
| sync now | `POST /directory-sync/connections/{provider}/sync` | `directory_sync_start` | `directory-sync sync` |  |
| list runs | `GET /directory-sync/runs` | `directory_sync_runs_list` | `directory-sync runs` |  |
| capabilities | `GET /directory-sync/capabilities` | `directory_capabilities` | `directory-sync capabilities` | AAD group task assignment |
| search entra groups | `GET /directory-sync/entra/groups` | `directory_entra_groups_search` | `directory-sync groups` | AAD group task assignment |

## Scim tokens

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /directory-sync/scim-tokens` | `scim_tokens_list` | `scim-tokens list` |  |
| get | — | — | — | the list returns every stored field; the token itself is only shown at creation and rotation |
| create | `POST /directory-sync/scim-tokens` | `scim_tokens_create` | `scim-tokens create` |  |
| update | — | — | — | tokens are immutable: rotate for a new secret, or create one with other scopes |
| delete | `DELETE /directory-sync/scim-tokens/{id}` | `scim_tokens_delete` | `scim-tokens delete` |  |
| rotate | `POST /directory-sync/scim-tokens/{id}/rotate` | `scim_tokens_rotate` | `scim-tokens rotate` |  |

## Workspace theme

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | — | — | — | one theme per workspace: get returns it |
| get | `GET /workspace-theme` | `workspace_theme_get` | `workspace-theme get` |  |
| create | — | — | — | every workspace always has a theme (new workspaces start from the default template) |
| update | `PUT /workspace-theme` | `workspace_theme_update` | `workspace-theme update` |  |
| delete | — | — | — | a theme cannot be removed; apply a template to reset it |
| list presets | `GET /workspace-theme/presets` | `workspace_theme_presets_list` | `workspace-theme presets` |  |
| apply preset | `POST /workspace-theme/apply-preset` | `workspace_theme_apply_preset` | `workspace-theme apply-preset` |  |
| upload font | `POST /workspace-theme/fonts` | `workspace_theme_font_upload` | `workspace-theme upload-font` |  |

## Workspace address

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | — | — | — | one address per workspace: get returns it |
| get | `GET /workspace/address` | `workspace_address_get` | `workspace-address get` |  |
| create | — | — | — | set creates it: every workspace has at most one address |
| update | `PATCH /workspace/address` | `workspace_address_set` | `workspace-address set` | settings.edit; the old address redirects for a year |
| delete | `PATCH /workspace/address` | `workspace_address_set` | `workspace-address set` | subdomain null removes the address |
| check | `GET /workspace/address/check` | `workspace_address_check` | `workspace-address check` |  |

## Task completed screen

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | — | — | — | one setting per workspace: get returns it |
| get | `GET /workspace/task-completion` | `task_completion_settings_get` | `task-completion get` |  |
| create | — | — | — | every workspace has it (the defaults until changed) |
| update | `PATCH /workspace/task-completion` | `task_completion_settings_update` | `task-completion update` | settings.edit; task forms override it in layout.task_completed |
| delete | — | — | — | set enabled false to turn the screen off |
| next step | `GET /tasks/{id}/next` | `tasks_next_step` | `tasks next` | completing a task (REST / MCP) returns the same summary as `next` |

## Form sign-in page

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | — | — | — | one setting per workspace: get returns it |
| get | `GET /workspace/form-sign-in-page` | `form_sign_in_page_get` | `form-sign-in-page get` |  |
| create | — | — | — | every workspace has it (the defaults until changed) |
| update | `PATCH /workspace/form-sign-in-page` | `form_sign_in_page_update` | `form-sign-in-page update` | settings.edit; the logo is uploaded in Settings → Forms |
| delete | — | — | — | update back to the defaults (the settings card has Reset to defaults) |

## Document OCR

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | — | — | — | one OCR setting per workspace: get returns it |
| get | `GET /document-ocr` | `document_ocr_get` | `document-ocr get` |  |
| create | — | — | — | every workspace has a setting (instance default until changed): update sets it |
| update | `PUT /document-ocr` | `document_ocr_update` | `document-ocr update` | the Azure key is write-only: "__SECRET__" or omitted keeps it |
| delete | `DELETE /document-ocr` | `document_ocr_remove_key` | `document-ocr remove-key` | removes the Azure endpoint and key |
| test | `POST /document-ocr/test` | `document_ocr_test` | `document-ocr test` |  |
| export | `GET /config/export` | `config_export` | `config export` | config export with types=document_ocr (the key is never exported) |
| import | `POST /config/apply` | `config_apply` | `config apply` | the Azure key must be entered again after an import |

## Packages

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /packages` | `packages_list` | `packages list` |  |
| get | `GET /packages/{id}` | `packages_get` | `packages get` | CLI also: packages show (metadata, items and dependencies) |
| create | `POST /packages` | `packages_create` | `packages create` |  |
| update | `PATCH /packages/{id}` | `packages_update` | `packages update` | CLI also: packages add / remove <type:id>… (or --search), packages set-data <table> rows|schema |
| delete | `DELETE /packages/{id}` | `packages_delete` | `packages delete` |  |
| preview contents | `POST /packages/preview` | `packages_preview` | `packages preview` |  |
| contents | `GET /packages/{id}/contents` | `packages_contents` | `packages contents` |  |
| search assets | `GET /packages/assets` | `packages_assets_search` | `packages assets` | every packageable type, cursor-paged with counts; CLI also: packages add --search |
| list versions | `GET /packages/{id}/versions` | `packages_versions_list` | `packages versions` |  |
| build version | `POST /packages/{id}/versions` | `packages_build` | `packages build` | CLI saves the .utpkg (--out) |
| get version | `GET /packages/{id}/versions/{versionId}` | `packages_version_get` | `packages version` |  |
| download version | `GET /packages/{id}/versions/{versionId}/download` | `packages_download` | `packages download` |  |
| inspect file | `POST /packages/inspect` | `packages_inspect` | `packages inspect` | the CLI verifies offline |
| list items | `GET /packages/{id}/items` | `packages_items_list` | `packages items` | grouped by type, uses / used by, unpublished changes since the last build |
| add items | `POST /packages/{id}/items` | `packages_items_add` | `packages add-items` | dry_run lists the dependencies they bring in; with_dependencies (default true) |
| remove items | `POST /packages/{id}/items/remove` | `packages_items_remove` | `packages remove-items` | 409 while other items use them unless force; dry_run lists the dependents |

## Package installs

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /package-installs` | `packages_installs_list` | `packages installs` |  |
| get | `GET /package-installs/{id}` | `packages_installs_get` | `package-installs get` |  |
| create | `POST /package-installs` | `packages_install` | `packages install` | install; upgrades in place when installed already |
| update | `POST /package-installs/{id}/upgrade` | `packages_upgrade` | `packages upgrade` |  |
| delete | `POST /package-installs/{id}/uninstall` | `packages_uninstall` | `packages uninstall` | dry_run lists what is removed |
| plan (dry run) | `POST /package-installs/plan` | `packages_install_plan` | `packages install` | CLI: packages install --dry-run |
| complete setup | `POST /package-installs/{id}/complete` | `packages_complete_setup` | `packages complete` |  |
| detach items | `POST /package-installs/{id}/detach` | `packages_install_detach` | `package-installs detach` | uninstall keeps them; any install |
| adopt items | `POST /package-installs/{id}/adopt` | `packages_install_adopt` | `package-installs adopt` | uninstall removes them; packages authored here only |

## Package history

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /package-events` | `packages_history` | `packages history` | filters: package, action, status, channel, actor, since / until; CSV export in the app |
| get | `GET /package-events/{id}` | `packages_history_get` | `package-events get` | with the applied plan / diff |
| create | — | — | — | events are recorded by installs, upgrades, complete setup and uninstalls (failed attempts too) |
| update | — | — | — | the history is append-only |
| delete | — | — | — | the history is append-only; events go with the workspace |

## Events

| Operation | REST (`/api/v1`) | MCP tool | CLI (`usertasks …`) | Notes |
|---|---|---|---|---|
| list | `GET /events` | `events_list` | `events list` | cursor paged (after / next_cursor); audit and security also need settings.view |
| get | — | — | — | events are immutable and the list carries every field; filter by run_id / task_id / trace_id |
| create | — | — | — | events are written by the platform (database triggers), never by callers |
| update | — | — | — | the event stream is append-only |
| delete | — | — | — | events expire with the stream retention (72h default) |

## Single-surface operations

| Surface | Operations | Why |
|---|---|---|
| MCP | workflows_catalog, workflows_preflight, workflows_validate, workflows_resolve_dependencies | prompt-authoring aids for agents (node catalog, dependency and wiring checks); REST/CLI users read the docs and get validation errors and wiring warnings from create/update |
| MCP | integrations_create_bundle | creates an integration and its references in one prompt step; REST/CLI do it with integrations create + references create, or config apply |
| MCP | reports_query, reports_source_get, reports_remediate_config, data_rows_search | agent-oriented read helpers |
| MCP | data_rows_create, data_rows_update (row_ids or capped filters), data_rows_bulk_delete filters | agent-oriented row helpers (the in-app Agent and MCP clients); REST / CLI create many with POST /data-tables/{id}/rows { rows } and update / delete by id |
| MCP | integration_calls_*, agent_runs_*, trace_get | observability reads, not configuration |
| CLI | config diff / new | folder helpers over POST /config/apply (dry run) and local scaffolding; config export / apply themselves are on every surface (MCP: config_export / config_apply, single-manifest form) |
| CLI | tasks complete | ergonomic wrapper over POST /tasks/{id}/action |
| CLI | logs tail, logs export | live tail over the SSE endpoint GET /events/stream (auto-reconnect, NDJSON with -o json) and cursor export over GET /events; MCP clients poll events_list with `after` |

## Gaps closed (October 2026)

| Gap | Fix |
|---|---|
| Export coverage (Oct 2026): no single-asset export/import for workflows, data tables, integrations, connectors, email templates, agents, retention policies, roles or log destinations on REST/MCP/CLI; no MCP config export/apply; CLI config export without ids; data-table rows exportable nowhere | config export ids + with_dependencies + include_rows (table_rows section, data-rows/ folder) and config apply rows_mode on every surface (MCP config_export / config_apply, CLI --ids / --with-dependencies / --include-rows / --rows-mode); see docs/export-coverage.md |
| Workflows: GET /workflows/{id} output could not be sent back to update (different shape, id in the body, no trigger_config/description; REST stripped unknown node keys) | GET /workflows/{id}/definition returns the author payload; PATCH /workflows/{id} takes it (and the include_definition GET response); nodes/edges are loose; MCP workflows_get_definition + workflows_update { definition } |
| Workflows: no REST/CLI publish; three different publish implementations (UI, REST author flag, MCP) | POST /workflows/{id}/publish and `workflows publish`; REST and MCP share lib/services/workflows (audit, sync, workflows.activate) |
| Workflows: MCP could not read one published version | workflows_version_get |
| Webhooks: no MCP tools; no get/update on any surface | webhooks_* MCP tools; GET/PATCH /webhooks/{id}; service getWebhook/updateWebhook |
| Objects: no update on any surface | updateObject service, PATCH /objects/{id}, objects_update, `objects update` |
| Connectors: MCP could only list the catalog, not installed connectors | connectors_list_installed |
| References: no MCP bulk delete | references_bulk_delete |
| Data tables / rows: no MCP table delete, row get or bulk row delete; a fetched schema (with system columns) was rejected on update | data_tables_delete, data_rows_get, data_rows_bulk_delete; system columns in an update are ignored |
| Decision tables: REST and MCP had separate CRUD code (REST unaudited, hard delete, required ids) | lib/services/decision-tables CRUD + test used by both; PATCH alias; ids generated when missing |
| Reports: export/import were MCP-only | GET /reports/{id}/export, POST /reports/import (lib/services/reports), `reports export|import` |
| Agents, reports, retention: PUT only, and a GET response sent back was silently ignored (no fields matched) | PATCH accepted too; the `{ agent|report|retention_policy: {...} }` wrapper is unwrapped |
| Integrations: MCP integrations_get hid the config, so MCP could not edit it from a read | masked config returned (as REST) |
| Every update: the `{ <item>: {...} }` GET wrapper and null optional fields were rejected or silently ignored | roundTrip handling in apiRoute (prepareRoundTripBody) for every update endpoint |
| API keys / roles / teams: no MCP delete (keys) or get (roles, teams) | api_keys_delete, roles_get, teams_get |
| Governance (Nov 2026): object grants were UI-only and unaudited; forms had no retention policy, legal hold or governance read on any surface; the audit log was missing from the matrix | lib/services/object-permissions (GET/POST/DELETE /object-permissions, object_permissions_*, `object-permissions list|set|remove`, audited grant / revoke); retention assign target_type form; GET /forms/{id}/governance, POST /forms/{id}/legal-hold (forms_governance_get, forms_legal_hold, `forms governance|legal-hold`); audit log row |

Verified end to end by `scripts/e2e-surfaces.ts` (create → get → edit file → update → get → delete per resource; workflows add a node and edge, publish, list versions and run the new version).
