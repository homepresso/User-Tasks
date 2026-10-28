# Export and import coverage

Every artifact you build in UserTasks can be exported from one workspace and imported into another, on every surface: the app, the REST API, MCP, the CLI and config-as-code folders. Most types can also go into a package. This page lists what each type supports, what is left out on purpose and why, and the gaps closed in October 2026.

All surfaces use the same config-as-code service (`lib/services/config.ts`) and the same folder layout (`lib/github-sync/layout.ts`), so a file exported on one surface can be imported on any other:

- **Export**: `GET /api/v1/config/export`, MCP `config_export`, `usertasks config export`, or the **Export** button in the app. With no filter it exports the whole workspace. Pass `types` to export some sections, or `ids` to export single assets of any type. `with_dependencies` adds everything those assets need. `include_rows` adds the rows of the exported data tables.
- **Import**: `POST /api/v1/config/apply`, MCP `config_apply`, `usertasks config apply`, or the **Import** button in the app. Run a dry run (plan) first, then apply. Assets keep their ids, so applying the same file again updates assets instead of creating copies. Apply never deletes anything. `rows_mode` (`merge`, `replace` or `skip`) controls how data-table rows are written.

## Coverage matrix

"config" in the REST, MCP and CLI columns means the asset goes through config as code:

- REST: `GET /config/export?ids=<id>` and `POST /config/apply`
- MCP: `config_export { ids }` and `config_apply`
- CLI: `config export --ids <id>` and `config apply`

Per-type export routes are listed where they exist.

| Artifact | UI | REST | MCP | CLI | Config-as-code manifest | Packages |
|---|---|---|---|---|---|---|
| Workflows | Export on automation rows, for a selection, and in the designer header; Import on the automations list. The designer toolbar keeps its canvas JSON download and load (**Canvas** / **Load canvas**). | config | config | config | yes, `workflows/` | yes (Packages — see docs/packages) |
| Decision tables (business rules) | Export on rows and for a selection; Import on the business-rules list. The editor keeps its own JSON export and import, and the list Import accepts those files (wrapped or bare). | `GET /decision-tables/{id}/export`, `POST /decision-tables/import`, config | `decision_tables_export`, `decision_tables_import`, config | `decision-tables export` / `import`, config | yes, `decision-tables/` | yes (Packages — see docs/packages) |
| Workflow activities (custom steps) | Extensibility: the existing export and import are kept, and the generic Import is added | `GET /workflow-activities/{id}/export`, `POST /workflow-activities/import`, config | `workflow_activities_export`, `workflow_activities_import`, config | `activities export` / `import`, config | yes, `workflow-activities/` | yes (Packages — see docs/packages) |
| Data tables (schema) | Export on rows, for a selection and on the detail header, with an "Include table rows" option; Import on the list | config | config | config | yes, `data-tables/` | yes (Packages — see docs/packages) |
| Data-table rows | the "Include table rows" option on a data-table export; the Import plan lets you choose merge, replace or skip | config with `include_rows=true`; apply with `rows_mode` | `config_export { include_rows }`, `config_apply { rows_mode }` | `config export --include-rows`, `config apply --rows-mode` | opt-in `table_rows` section, `data-rows/` folder (up to 10,000 rows per table) | optional, as the package's data block |
| Integrations, with their references and objects | Export on the list and on the detail header; Import on the list | config (an integration brings its references and objects with it) | config | config | yes, `integrations/`, `references/`, `objects/` | yes (Packages — see docs/packages) |
| Connectors | Export in the connector's detail panel; Import on the Integrations page | config | config | config | yes, `connectors/` (credentials are never exported) | yes (Packages — see docs/packages) |
| Email templates | Export on rows; Import next to "New email template" | config | config | config | yes, `email-templates/` | yes (Packages — see docs/packages) |
| Reports | Export on rows, for a selection and on the report page ("Export definition"); Import in the Reports header | `GET /reports/{id}/export`, `POST /reports/import`, config | `reports_export`, `reports_import`, config | `reports export` / `import`, config | yes, `reports/` | yes (Packages — see docs/packages) |
| Agents | Export on rows, for a selection and in the designer header; Import on the list. The designer keeps its own agent JSON download and load (which now also reads config exports), and the list Import accepts the designer file too. | config | config | config | yes, `agents/` | yes (Packages — see docs/packages) |
| Retention policies | Settings → Governance → Retention: Export on each policy, Import in the header | config | config | config | yes, `retention-policies/` | yes (Packages — see docs/packages) |
| Custom roles | Settings → Governance → Roles: Export on each custom role, Import next to "Create Role" | config | config | config | yes, `roles/` (custom roles only; system roles are matched by slug) | yes (Packages — see docs/packages) |
| MCP servers | Settings → MCP (Export per server, Import next to "Add Server"); Export also on Integrations → MCP servers | config only (no separate CRUD endpoints) | config only | config only | yes, `mcp-servers/` | yes (Packages — see docs/packages) |
| Log destinations | Settings → Log export: Export on each destination, Import next to "Add destination" | config | config | config | yes, `log-destinations/` (credentials are never exported) | yes (Packages — see docs/packages) |
| Workspace theme | theme designer (presets); move it between workspaces with config export | `GET` / `PUT /workspace-theme` (the GET response can be sent back as the PUT body), config `types=workspace_theme` | `workspace_theme_get` / `workspace_theme_update`, config | `workspace-theme get` / `update`, `config export --types workspace_theme` | yes, `workspace-theme.json` (singleton) | no |

What the Import button accepts:

- a config manifest (`<name>.usertasks.json` from Export, or `format=manifest`)
- the files form (`{ files: [...] }`)
- a single GitHub-sync or config asset envelope (`{ asset_type, id, asset }`)
- the per-type export files: decision tables (REST `decision_table`, the editor's `decisionTable`, or a bare `{ inputs, outputs, rules }` table), reports, workflow activities, workflows and agent designer files

Parsing lives in `lib/portability/import-document.ts`. A package (`.utpkg`) file is refused with a pointer to Settings → Packages.

**GitHub sync** pushes and deploys every section above except `table_rows` and `workspace_theme`.

## How it works

- **Dependencies.** `with_dependencies` (UI: "Include dependencies") walks the exported asset JSON from the roots and adds everything they need (`lib/portability/dependencies.ts`): sub-workflows, custom activities, decision tables, data tables, integration references with their integration or the connector that generated them, email templates (including a user task's `notification_template_id`), agents with their tools and integration, custom roles, retention policies and MCP servers. Ids that cannot be found are reported as missing.
- **Id remapping.** On import, references between assets are rewritten to the target workspace's ids (`lib/portability/id-maps.ts`). Mappings are kept per source label, so applying the same file again updates the same assets.
- **Secrets.** Every secret is exported as `__SECRET__` and has to be entered again in the target workspace. In a CLI folder you can replace it with `${env:VAR}` or `${file:path}`. Sending `__SECRET__` back keeps the stored value. Connectors and log destinations that have no credentials in the target are created disabled, and the plan warns that they need credentials.
- **People.** User and team ids are never exported. Packages turn them into requirements. A config apply leaves them for you to reassign.
- **Rows.** Rows are exported as `{ id, data }`. The source row id identifies the row but is never used as the local primary key. `merge` (the default) updates rows imported before and inserts the rest. `replace` deletes the table's existing rows and then inserts all of them. `skip` writes no rows.

## Excluded by design

| Artifact | Why it is not exported | What to do instead |
|---|---|---|
| API keys | They are credentials. They can't be edited, and each environment needs its own. | Create new keys in each environment. |
| OAuth apps | Client secrets and redirect URIs differ per environment. | Register the app again in the target workspace. |
| Workflow webhook endpoints | Signing secrets are stored only as bcrypt hashes, and the inbound URLs differ per environment. | Create the webhook again in the target (and rotate the secret there). The webhook trigger panel can download a Postman collection for the new endpoint. |
| GitHub sync connection | It holds the repository token and is set up per environment. | Connect it in Settings → GitHub Sync in each workspace. |
| SSO and directory sync | Identity-provider settings and secrets differ per environment. | Configure them in each workspace. |
| Users, memberships, teams and user role assignments, invitations | People are different in each environment. | Invite people and assign roles in the target. Packages list the user and team references they need as requirements. |
| Tag definitions (tag names and colours) | They are not exported anywhere. Tags still travel as names on integrations, references and activities. | Create the tag definitions again if you want the colours. |
| Node favorites | They are personal to each user. | None. |
| Workflow versions (published history) | Import creates or updates the draft. | Publish in the target workspace (`workflows publish`). |
| Workspace theme font and logo files | Binary files are not part of the manifest. Uploaded fonts are referenced by file name. Logos from another workspace are dropped, with a warning. | Upload the font (`workspace-theme upload-font`) or logo in the target, then apply again. A missing font falls back to the default font, with a warning. |
| Tasks, workflow runs, notifications, events, audit log | They are runtime data, not configuration. | Use log export or the event stream to keep a history. |

## Gaps found and fixed

The surface-parity review (see [parity.md](parity.md), generated from `lib/surface-parity.ts`) recorded these export and import gaps and how they were closed:

- **Export coverage.** Workflows, data tables, integrations, connectors, email templates, agents, retention policies, roles and log destinations had no single-asset export or import on REST, MCP or the CLI. MCP had no config export or apply, the CLI could not export by id, and data-table rows could not be exported at all. Config export now takes `ids`, `with_dependencies` and `include_rows` (the `table_rows` section, written to the `data-rows/` folder), and config apply takes `rows_mode`, on every surface.
- **MCP config tools.** `config_export` and `config_apply` were added (single-manifest form).
- **Reports.** Export and import were MCP-only. They are now also on REST (`GET /reports/{id}/export`, `POST /reports/import`) and the CLI (`reports export|import`).
- **Decision tables.** REST and MCP had separate CRUD code. Both now use `lib/services/decision-tables`. The file formats are unified: the service accepts the editor's `decisionTable` file as well as `decision_table`, and the UI importers accept `decision_table`.
- **Workflows round trip.** `GET /workflows/{id}/definition` returns the author payload, which `PATCH /workflows/{id}` takes back.
- **Edit round trip.** Every update endpoint accepts its own GET response (the `{ <item>: {...} }` wrapper is unwrapped).
- **Email-template ids.** A user task's `notification_template_id` (and `notificationTemplateId`) is now remapped on import, so the notification template a node sends follows it into the target workspace.
- **Data-table rows.** Rows can be exported and imported, with merge, replace or skip.
- **UI.** Every type in the matrix has an Export button (with "Include dependencies", and "Include table rows" for data tables) and an Import button (dry-run plan, then apply).
- **Dependency closure.** `with_dependencies` on every surface, including the UI's "Include dependencies".
- **Retention-policy triggers.** A workflow trigger's `policy_ids` list is now remapped on import, so a "specific policies" trigger keeps watching the imported policies.
- **Import file errors.** An asset envelope that doesn't parse (for example, its `id` doesn't match the asset) is now reported instead of silently importing nothing, and `workspace-theme` envelopes are recognised by their file name.
