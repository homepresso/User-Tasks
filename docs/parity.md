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
| list submissions | `GET /forms/{id}/submissions` | `forms_submissions_list` | `forms submissions` |  |
| get submission | `GET /form-submissions/{id}` | `forms_submission_get` | `form-submissions get` |  |
| lookup | `POST /forms/{id}/lookup` | `forms_lookup` | `forms lookup` |  |
| export | `GET /config/export` | `config_export` | `config export` | one form (with_dependencies adds its saved theme): config export with ids=<id> |
| import | `POST /config/apply` | `config_apply` | `config apply` | config apply of the exported form (dry run first) |

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
| execute | `POST /agents/{id}/execute` | `agents_execute` | `agents execute` |  |
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
| MCP | workflows_catalog, workflows_preflight, workflows_resolve_dependencies | prompt-authoring aids for agents (node catalog, dependency checks); REST/CLI users read the docs and get validation errors from create/update |
| MCP | integrations_create_bundle | creates an integration and its references in one prompt step; REST/CLI do it with integrations create + references create, or config apply |
| MCP | reports_query, reports_source_get, reports_remediate_config, data_rows_search | agent-oriented read helpers |
| MCP | integration_calls_*, agent_runs_*, trace_get, object_audit_log_query | observability reads, not configuration |
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

Verified end to end by `scripts/e2e-surfaces.ts` (create → get → edit file → update → get → delete per resource; workflows add a node and edge, publish, list versions and run the new version).
