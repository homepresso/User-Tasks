# Release notes: CLI, complete REST API and MCP permission changes

This release adds the `usertasks` CLI (`@usertasks/cli`) and TypeScript SDK
(`@usertasks/sdk`), extends `/api/v1` to cover everything the UI can
configure, and moves REST, MCP and most server actions onto one shared
service layer (`lib/services/*`). The API is described by the OpenAPI 3.1
document at `GET /api/v1/openapi.json`.

Most changes only add things. The ones below can change what an existing
API key, OAuth token or MCP client is allowed to do. Check them before you
upgrade.

## Breaking: MCP read tools now need a view permission

Until now, MCP tools that only read data had no permission check. Tenant
scoping was the only limit. Read tools now need the same `*.view` permission
as the matching REST endpoint or UI page. A key or token without that
permission gets `Forbidden: … lacks the '<permission>' permission`.

| Read tools | Permission |
|---|---|
| `tasks_list`, `tasks_get`, `tasks_priority_summary` | `tasks.view_own` |
| `workflows_list`, `workflows_get`, `workflows_catalog`, `workflows_preflight`, `workflows_resolve_dependencies`, `workflows_versions_list` | `workflows.view` |
| `workflows_runs_list`, `workflows_run_get`, `trace_get` | `workflows.view_runs` |
| `agents_list`, `agents_get`, `agents_runs_list`, `agent_runs_list`, `agent_runs_get` | `agents.view` |
| `data_tables_list`, `data_tables_get`, `data_rows_query`, `data_rows_search` | `data.view` |
| `reports_*` reads (`list`, `get`, `query`, `preview`, `export`, `sources_list`, `source_get`) | `reports.view` |
| `integrations_list/get`, `references_list/get`, `objects_list/get`, `connectors_list/get`, `integration_calls_list/get` | `integrations.view` |
| `decision_tables_list/get/export/test`, `email_templates_list/get/preview` | `workflows.view` |
| `workflow_activities_list/get/export` | `extensibility.view` |
| `users_list`, `roles_list`, `team_members_list`, `teams_list` | `team.view_members` |
| `audit_log_query` (governance log) | `team.change_roles` |
| `object_audit_log_query` | `settings.view` |
| `invitations_list` | `team.invite` |
| `api_keys_list` | `settings.manage_api_keys` |
| `retention_policies_list`, `retention_policies_get`, `retention_policies_list_assets` | `settings.view` |

Legacy tenant keys, which have no stored permission list, still resolve to
every permission, so they are not affected. Least-privilege keys, user keys
and OAuth tokens are affected: their reads are now limited to what their
permissions allow. Any tool that is missing from the permission maps is now
refused, so every new tool must be given a permission.
`__tests__/mcp-read-gating.test.ts` lists the expected permission for each
tool.

## Breaking: OData needs data permissions (phase 1)

`/api/odata` now checks permissions as well as the table allowlists. Reads
need `data.view`, writes need `data.manage_rows`, and report collections need
`reports.view`.

## Other MCP behaviour changes

### Phases 4 to 8: tools moved onto the service layer

These tools keep the same names, arguments and response shapes:

- **Integration, reference, object and connector tools.**
  - Secrets come back masked as `__SECRET__`. If you send `__SECRET__` back on
    an update, the stored value is kept.
  - Outbound URLs go through the egress guard.
  - Each change writes one detailed audit row from the service. Before, the
    MCP layer wrote a generic `MCP: <tool>` row.
- **`workflow_activities_*`.** Sources and manifests are validated, and a
  duplicate key returns an error. Deletes are queued, and changes are captured
  for GitHub sync.
- **New `email_templates_*` tools** (list, get, create, update, delete,
  preview).
  - HTML is sanitised.
  - The workspace default template cannot be deleted.
  - These tools use the `workflows.*` permissions.
- **`decision_tables_export` / `decision_tables_import`.** Imports are
  audited and captured for GitHub sync.
- **`data_tables_*` and `data_rows_*`** (`data_rows_search` excepted).
  - Cells are checked against the table's columns and stored under canonical
    column keys.
  - `ID` and `Date Created` are filled in automatically.
  - Creates and updates now fire `data_table_event` workflows.
  - Deletes are queued.
  - Table resource scopes are enforced.
- **`workflows_delete`.** The delete is queued, and the workflow's versions,
  runs and spawned tasks are deleted with it.
- **`workflows_toggle` and `workflows_versions_list`.** These run through the
  workflow service and are audited there.

### Phase 9: governance and API keys

- **Team tools now use the team UI's permissions.**
  - `teams_create`, `teams_update` and `teams_add_member` need `team.invite`.
  - `teams_delete` and `teams_remove_member` need `team.remove`.
  - Before, all of them needed `team.change_roles`.
  - Teams, users and parent teams must all belong to the workspace.
- **`roles_manage`.**
  - System roles cannot be renamed or deleted.
  - Unknown permission keys are dropped.
  - Assigning a role checks that both the role and the user belong to the
    workspace.
- **Invitations.**
  - `invitations_list` and `invitations_send` no longer return the acceptance
    token.
  - `invitations_send` now sends the invitation email. It checks the email
    address and the role (`owner`, `admin`, `manager`, `member` or `viewer`)
    and refuses existing members and duplicate invitations.
  - New tool: `invitations_resend`.
- **`api_keys_create` is hardened.** See "API keys" below. A request for
  permissions the caller lacks is now **refused**. Before, those permissions
  were silently dropped.

### Surface parity: workflow authoring, decision tables, reports

REST, MCP and the CLI now cover the same operations for every configurable
resource (matrix: `docs/parity.md`, enforced by `__tests__/surface-parity.test.ts`).

- **Publishing needs `workflows.activate` everywhere.** `POST /workflows/author`
  and `PUT /workflows/author` with `publish: true`, and `workflows_update`
  with `publish: true`, now need `workflows.activate` (as the editor and
  `workflows_publish` always did). Changing `is_active` through an update
  also needs `workflows.activate`. Before, `workflows.edit` was enough.
- **Workflow authoring is one service.** `/workflows/author`,
  `workflows_create`, `workflows_update` and `workflows_publish` share
  `lib/services/workflows`: they are audited and queued for GitHub sync,
  every edge must point at an existing node (before, REST checked this only
  when nodes and edges were both sent), node ids must be unique, the
  middleware rules apply to REST too, and the published snapshot includes
  `sections`. Updates report `changed` and only the fields that differ in
  `updated_fields`; an update that changes nothing no longer marks the
  workflow as having unpublished changes. Nodes, edges and variables keep
  properties the schema doesn't name (they used to be stripped by REST), and
  REST create/update accept `description`, `trigger_config` and `tags`.
- **`workflows_update`** accepts `definition` (the `workflows_get_definition`
  payload, or `workflows_get` output) and `publish` / `publish_notes`.
- **Decision tables** (`/decision-tables*`, `decision_tables_*`) share
  `lib/services/decision-tables`: create/update/delete are audited and synced,
  delete goes through the deletion queue (as in the UI), missing field / rule
  / condition ids are generated on REST too, and condition values are stored
  as strings. REST create accepts `workflows.create` or `workflows.edit`.
- **`integrations_get`** now returns the config with credentials masked as
  `__SECRET__` (as `GET /integrations/{id}` does), so it can be edited and sent
  back to `integrations_update`.
- **Data tables:** an update's `columns` may include the system columns
  (`id`, `date_created`) a GET returns; they are ignored. Before, they were
  rejected.
- **`reports_import`** normalises the config as report create does, and is
  audited.
- **Every update accepts its GET response as the body** (`{ <item>: {...} }`
  is unwrapped, read-only fields are ignored, `null` for a non-nullable
  field means unchanged). Agents, reports and retention policies accept
  `PATCH` as well as `PUT`.
- **New MCP tools:** `workflows_get_definition`, `workflows_version_get`,
  `webhooks_list|get|create|update|delete|rotate`, `objects_update`,
  `references_bulk_delete`, `connectors_list_installed`,
  `data_tables_delete`, `data_rows_get`, `data_rows_bulk_delete`,
  `api_keys_delete`, `roles_get`, `teams_get`. Webhook reads need
  `settings.manage_webhooks`.

## API keys: new limits on creation

These rules apply to REST, MCP and the settings UI:

- **Permissions.** A new key's permissions must be a subset of the caller's.
  If you omit them, the key gets the caller's permissions. A caller with every
  permission still gets a legacy full key. Keys created in the UI by users
  without every permission now get exactly that user's permissions. Before,
  they were full-access keys.
- **User keys.** A user key's permissions must also be within the bound
  user's role permissions.
- **Resource scopes.** If the caller is limited to certain workflows or data
  tables, the new key's `workflow_ids` / `table_ids` must be within those
  limits. If you omit them, the key gets the caller's limits.
- **User callers.** A caller acting as a user (a user key or an OAuth user
  token) cannot create tenant-wide keys. It can only create user keys for
  itself.
- **OAuth callers** need the first-party `keys:write` scope to create, revoke
  or delete keys. Without it they get `403` with code `insufficient_scope`.
  Keys created with an OAuth token must set `expires_in_days` (at most 90).
  - When this happens, the CLI suggests the fix, for example:
    `re-run: usertasks login --scopes <current>,keys:write`.
- **Rate limits.** Each caller can create 10 keys per hour, and each tenant
  50 per hour. Over the limit, the request fails with `429 rate_limited`.
- **Audit.** Every create, revoke and delete is audited.
- **Key format.** New keys look like `ut_<64 hex>`. The key is returned once.
  Only a bcrypt hash and an 8-character prefix are stored.

## Webhooks

`/api/webhooks/create-key`, the endpoint the workflow editor uses, now:

- takes the tenant from the signed-in session instead of the request body;
- checks that the workflow belongs to that tenant;
- requires `settings.manage_webhooks`;
- generates the secret on the server.

Before, any signed-in user could create or rotate a webhook for any tenant.
Editors without `settings.manage_webhooks`, such as the seeded Manager role,
can no longer create webhook endpoints from the workflow editor. The inbound
endpoint `/api/webhooks/inbound` works as before.

## New REST endpoints (`/api/v1`)

| Area | Endpoints |
|---|---|
| Identity | `GET /me`, `GET /openapi.json` |
| Integrations | `GET,POST /integrations`; `GET,PATCH,DELETE /integrations/{id}`; `POST /integrations/{id}/test`; `POST /integrations/import-openapi` |
| References | `GET,POST /integrations/{id}/references`; `GET,PATCH,DELETE /references/{id}`; `POST /references/bulk-delete`; `POST /references/{id}/execute` |
| Objects | `GET,POST /objects`; `GET,PATCH,DELETE /objects/{id}` |
| Connectors | `GET /connectors/catalog`; `GET,POST /connectors`; `GET,PATCH,DELETE /connectors/{id}`; `POST /connectors/{id}/{test,enable,disable,regenerate-references}` |
| Email templates | `GET,POST /email-templates`; `GET,PATCH,DELETE /email-templates/{id}`; `POST /email-templates/{id}/preview` |
| Workflow activities | `GET,POST /workflow-activities`; `GET,PATCH,DELETE /workflow-activities/{id}`; `GET /workflow-activities/{id}/export`; `POST /workflow-activities/import` |
| Decision tables | `PATCH /decision-tables/{id}`; `GET /decision-tables/{id}/export`; `POST /decision-tables/import` |
| Reports | `GET /reports/{id}/export`; `POST /reports/import`; `PATCH /reports/{id}` |
| Agents, retention | `PATCH /agents/{id}`, `PATCH /retention-policies/{id}` (same as `PUT`) |
| Data tables | `GET,POST /data-tables`; `GET,PATCH,DELETE /data-tables/{id}`; `GET,POST /data-tables/{id}/rows`; `GET,PATCH,DELETE /data-tables/{id}/rows/{rowId}`; `POST /data-tables/{id}/rows/bulk-delete` |
| Workflows | `GET /workflows/{id}/definition`; `PATCH,DELETE /workflows/{id}`; `POST /workflows/{id}/publish`; `POST /workflows/{id}/activate`, `/deactivate`; `GET /workflows/{id}/versions[/{versionId}]` |
| Tasks | `PATCH /tasks/{id}` |
| Roles & users | `GET,POST /roles`; `GET,PATCH,DELETE /roles/{id}`; `GET /users`; `PUT,DELETE /users/{id}/roles/{roleId}` |
| Teams | `GET,POST /teams`; `GET,PATCH,DELETE /teams/{id}`; `PUT,DELETE /teams/{id}/members/{userId}` |
| Invitations | `GET,POST /invitations`; `DELETE /invitations/{id}`; `POST /invitations/{id}/resend` |
| Audit log | `GET /audit-log` (`object_type`, `object_id`, `actor_id`, `action`, `from`, `to`, `limit`/`offset`) |
| API keys | `GET,POST /api-keys`; `POST /api-keys/{id}/revoke`; `DELETE /api-keys/{id}` |
| Webhooks | `GET,POST /workflows/{id}/webhooks`; `GET,PATCH,DELETE /webhooks/{id}`; `POST /webhooks/{id}/rotate` (the secret is shown once) |
| Config as code | `GET /config/export`; `POST /config/apply` (`dry_run`, `adopt_by_name`, `source_label`) |

Error responses keep the `{ success: false, error }` shape. They can now
also include a machine-readable `code` (`validation_error`, `forbidden`,
`insufficient_scope`, `not_found`, `conflict`, `rate_limited`, …) and
`details`.
