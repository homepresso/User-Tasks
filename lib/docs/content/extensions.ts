import type { DocPageDef } from '../types'

/**
 * Developer docs for the platform extension framework (lib/extensions):
 * the model, the manifest, every contribution point and the example
 * extension (extensions/example-hello). Placed after "CLI, SDK and config".
 */

export const EXTENSION_PAGES: DocPageDef[] = [
  {
    slug: 'developers/extensions',
    title: 'Extensions',
    description: 'How UserTasks extensions work: versioned packages compiled into the build, switched on per workspace, licensed through one entitlement check.',
    body: `
An **extension** adds a whole capability to UserTasks — workflow steps and triggers, connectors, API endpoints, background jobs, menus, pages and settings — without forking core. Extensions are compiled into the app when it is built and switched on per workspace.

## Three tiers

| Tier | What | Who | Trust |
|---|---|---|---|
| T1 sandboxed | [Custom workflow actions](/docs/workflows/custom-actions) (QuickJS) and [custom form controls](/docs/tasks/custom-form-controls) (sandboxed iframes) | Anyone, uploaded at runtime | Isolated, capabilities approved by admins |
| T2 remote | Out-of-process apps over HTTPS (planned) | Third parties | Isolated by process and network |
| **T3 compiled** | **Extensions** (this section) | First-party and certified partners | Full trust: reviewed code only |

## Lifecycle

1. **Build.** \`USERTASKS_EXTENSIONS\` lists the extensions to compile in (npm package names or paths inside the repository). The build generates \`lib/extensions/generated/*\`, which imports each extension's entry points. With the variable unset the registry is empty and the build is the public one, unchanged. An extension whose \`engines.usertasks\` range does not accept this version fails the build.
2. **Boot.** Every manifest is validated (schema, cross references, compatibility). An invalid or incompatible extension does not run; Settings → Extensions says why. Its data stays.
3. **Migrate.** \`usertasks-admin ext migrate\` applies the extension's own database migrations (tables \`ext_<id>__*\`), with the same lock and per-file transactions as the core migrations.
4. **Enable per workspace.** Settings → Extensions (or \`POST /api/v1/extensions/{id}/enable\`, \`extensions_enable\`, \`usertasks extensions enable\`). Needs **Edit settings** and, for a paid extension, a licence. Enabling gives the workspace's system roles the extension's default permissions.
5. **Disable.** Menus, pages, API, tools, triggers and jobs stop for the workspace. Settings, secrets and data are kept, so enabling it again picks up where it left off.

## One access decision

Every surface asks the same question: *may this workspace use this extension (and feature) now?*

- the extension is in the build, compatible and built for this deployment mode;
- the workspace has it enabled;
- the **entitlement port** allows it: free extensions always, paid ones when a licence (or a cloud entitlement) covers the workspace and feature.

Denied API, MCP and public-route calls answer \`403 extension_disabled\`, \`402 extension_not_licensed\` or, more than 24 hours after a licence expired, \`402 extension_licence_expired\`; workflows using the extension's steps can't be published and new runs don't start; a running workflow that reaches one of its steps after the cutoff is paused there (retryable — resume it after renewal); other denied steps fail with the reason; menus and pages are hidden.

## Free and paid

The framework, the extension SDK and the licence verifier are open source (Apache-2.0) in the UserTasks repository. Paid extensions live in a private repository and are compiled into their own images only, the **editions** (such as the SharePoint edition), which licensed customers download through usertasks.com with their licence ([editions](/docs/self-hosting#editions)); core never imports them (a test enforces it). Without a licence an edition behaves exactly like the open-source image and lists its extensions as available but not licensed.

## Authoring rules

- Import only from \`@user-tasks/extension-sdk\` (and \`@user-tasks/extension-sdk/ui\` in custom pages), never from core paths.
- No CSS and no remote assets: core renders every contribution with its own components, so extensions follow every workspace theme and work air-gapped.
- Every inbound route, secret and table is declared in the manifest.

Next: [the manifest](/docs/developers/extensions/manifest), [contribution points](/docs/developers/extensions/contribution-points) and [the example extension](/docs/developers/extensions/example).
`,
  },
  {
    slug: 'developers/extensions/manifest',
    title: 'Extension manifest',
    description: 'usertasks-extension.json: id, version, publisher, engines, licence, capabilities, permissions and contributions.',
    body: `
Each extension has a \`usertasks-extension.json\` next to its entry modules. It is plain data: core validates it with a schema and renders everything it contributes.

\`\`\`json
{
  "manifest_version": 1,
  "id": "example-hello",
  "name": "Hello (example extension)",
  "version": "1.0.0",
  "publisher": { "id": "usertasks", "name": "UserTasks" },
  "engines": { "usertasks": ">=0.1.0 <2.0.0", "extension_sdk": "^1.0.0" },
  "licence": { "tier": "free", "features": ["greetings", "digest"] },
  "deployments": ["cloud", "self_hosted"],
  "capabilities": { "db": true, "inbound_public_routes": ["/ping", "/hooks/*"], "secrets": ["api_token"] },
  "permissions": [
    { "key": "view", "label": "View greetings", "implied_by": ["tasks.view_own"], "default_roles": ["owner", "admin", "member"] }
  ],
  "contributes": { "nodes": [], "triggers": [], "connectors": [], "ui": {} }
}
\`\`\`

## Fields

| Field | Rules |
|---|---|
| \`id\` | Lower-case slug (letters, digits, single hyphens), at most 41 characters. \`ut-\` is reserved for first-party extensions. Namespaces everything: node types \`ext.<id>.<key>\`, permissions \`ext.<id>.<key>\`, tables \`ext_<id>__*\` (hyphens become underscores), MCP tools \`ext_<id>_*\`, REST paths \`/api/v1/ext/<id>/…\` |
| \`version\` | Semver |
| \`engines.usertasks\` | Semver range of UserTasks versions; checked when building and at boot |
| \`engines.extension_sdk\` | Semver range of the SDK contract (core provides 1.0.0) |
| \`licence.tier\` | \`free\` or \`paid\`; paid needs \`sku\`. \`features\` names the licence features the extension checks |
| \`deployments\` | \`cloud\`, \`self_hosted\` or both |
| \`capabilities\` | \`db\` (owns \`ext_<id>__*\` tables), \`egress\` (hosts, always through the egress guard), \`inbound_public_routes\` (globs under \`/ext-public/<id>\`), \`secrets\` |
| \`permissions\` | Each becomes \`ext.<id>.<key>\`. \`implied_by\` lists core permissions that grant it automatically (existing roles never lose access); \`default_roles\` are given it when a workspace enables the extension |
| \`contributes\` | Nodes, triggers, connectors, directory sources, importers and UI ([contribution points](/docs/developers/extensions/contribution-points)) |

## Guards

Every UI entry may carry \`when\`, evaluated on the server and in the browser:

| Guard | Meaning |
|---|---|
| \`permission\` | All listed permissions (core keys or this extension's \`ext.<id>.<key>\`) |
| \`anyPermission\` | At least one |
| \`feature\` | A licence feature (entitlement port) |
| \`deployment\` | \`cloud\` or \`self_hosted\` only |
| \`instanceAdmin\` | Instance administrators only |
| \`managerOnly\` | People with a direct report |
| \`setting\` | A workspace setting: \`show_digest\`, \`mode == advanced\`, \`mode != off\` |

## Targets

Menu entries, nav items and row actions lead to one target: \`{ "page": "new" }\` (\`/x/<id>/new\`), \`{ "route": "/automations" }\`, \`{ "action": "greet_item", "confirm": "…" }\` (runs a UI action on the server), \`{ "settings": "general" }\` or \`{ "url": "https://…", "external": true }\`.

Validate a manifest with \`npm run extensions:gen\` (with \`USERTASKS_EXTENSIONS\` set): every problem is listed and the command fails.
`,
  },
  {
    slug: 'developers/extensions/contribution-points',
    title: 'Contribution points',
    description: 'Workflow nodes and triggers, connectors and transports, directory sources, importers, REST and public routes, jobs, events, MCP tools, permissions, migrations, settings and UI.',
    body: `
## Server

| Contribution | Declared in | Behaviour in the server module | Notes |
|---|---|---|---|
| Workflow node | \`contributes.nodes[]\` with typed \`inputs\` / \`outputs\` (the custom-action field model) | \`nodes.<key>({ ctx, inputs, node, run })\` returns the outputs | Type \`ext.<id>.<key>\`; the designer panel, palette entry, validation and data picker come from the declaration. Inputs are resolved and coerced before the handler runs. \`optionsFrom: { <input>: '<ui data source>' }\` gives an input design-time choices from the workspace (the source returns \`{ options: [{ value, label }] }\`; triggers can use it for their settings) |
| Workflow trigger | \`contributes.triggers[]\` with \`config\` and \`variables\` | \`triggers.<key>.matches(config, payload)\` (optional) | Start runs with \`ctx.workflows.trigger(key, payload, { dedupeKey })\`: one start per key and workspace. A setting of type \`array\` with \`options\` is a set of checkboxes. \`filters: { config, fieldsFrom }\` edits an object setting with the field-change filter builder; \`previewFrom\` adds "Test with the latest event" ([record-change triggers](#record-change-triggers)) |
| Connector | \`contributes.connectors[]\` + the definition in the manifest module | — | Same model as built-in connectors; key \`ext.<id>.<key>\` |
| Connector transport | \`transports.<key>\` | \`({ ctx, config }) => ({ fetch })\` | Selected with \`auth_config._transport = "ext.<id>.<key>"\`. Core keeps the egress guard, timeouts, retries and redirects; the transport performs one request (NTLM, Kerberos, a vendor JWT) |
| REST endpoint | — | \`endpoints[]: { endpoint: defineEndpoint({…}), feature?, handler }\` | Served at \`/api/v1/ext/<id>/…\` through the standard pipeline (bearer token, permission, validation, envelope); listed in the served OpenAPI document (\`x-usertasks-extension\`). \`feature\` names a licence feature the call needs (402 without it). Throw \`ExtensionError(code, message, status)\` for a 4xx / 5xx answer |
| Public route | \`capabilities.inbound_public_routes\` | \`publicRoutes[]: { path, methods, auth, handler, rateLimit? }\` | \`/ext-public/<id>/…\`; auth \`none\`, \`api_key\` or \`signature\` (HMAC-SHA256 of the body with a workspace secret). Rate limited (default 120 per minute and client; \`rateLimit: { max, windowMs }\` up to 6,000), 1 MB body cap, audited. With \`auth: none\` the handler proves the workspace itself (e.g. a secret in the URL) and then works in it through \`ctx.forWorkspace(tenantId)\` |
| Job | — | \`jobs[]: { name, cadence, scope, run }\` | Runs on the one-minute tick as \`ext.<id>.<name>\`, once per enabled workspace (or once per instance) |
| Event subscription | — | \`events[]: { pattern, handler }\` | Reads the event outbox after a cursor; \`ctx.events.emit(name, …)\` writes \`ext.<id>.<name>\` events |
| MCP tool | — | \`mcpTools[]: { name, description, schema, permission, mutates?, feature? }\` | Tool \`ext_<id>_<name>\`, gated by its permission (and licence feature), refused unless the workspace may use the extension; mutations audited. Schemas use the SDK's \`z\` |
| Directory source | \`contributes.directorySources[]: { key, label, description?, kind?, feature?, intervalMinutes?, seatLimit? }\` | \`directorySources.<key>: { sync({ ctx, mode, cursor, lastFullSyncAt, deadline }), enabled?({ ctx }) }\` returns people, groups and memberships | Core reconciles them through directory sync under \`ext.<id>.<key>\` ([directory sources](#directory-sources)) |
| Licence limit usage | — | \`usageCounters: { '<id>.<name>': ({ ctx, unit }) => count }\` | Shown in Settings → Licence; \`ctx.licence.limit\` / \`assertLimit\` count with it (instance-wide; with \`unit\`, the count as if that unit were added) |
| Permission | \`permissions[]\` | — | Dynamic \`ext.<id>.<key>\` keys; shown as a group in the role editor |
| Database | \`capabilities.db\` | \`migrations[]: { version, name, sql }\` | Linted: only \`ext_<id>__*\` tables, each with \`tenant_id\` and row-level security, policies through \`get_current_tenant_id()\` |
| Settings validation | — | \`settings.validate({ scope, page, values })\` | Extra checks after the schema passes |
| Lifecycle | — | \`lifecycle.onEnable / onDisable\` | Per workspace |
| Form data target | — | \`formTargets.<key>: { label, feature?, bindPermission?, identity?, prepare?, submit, check?, saved?, deleted? }\` | Reusable forms bound to records the extension provides (see Form data targets below) |
| Importer | \`contributes.importers[]: { key, label, description?, produces, accepts, multiple?, filesOptional?, feature?, preview?, options?, permission?, icon? }\` | \`importers.<key>: { detect?({ files }), analyze({ ctx, files, options }), import({ ctx, files, options }) }\` | Workflows / forms from another product's files, in the Import menus of Automations and Forms, \`/api/v1/importers\` and the MCP \`importers_*\` tools as \`ext.<id>.<key>\` ([importers](#importers)) |
| InfoPath hook | — | \`infopath: { feature?, enrich({ ctx, form, forms, hints, requestedBy, target }) }\` | Adjusts the forms the core InfoPath importer generated before they are stored (bind a list, live lookups); notes appear in the report |

## UI (declarative, rendered by core)

| Surface | \`contributes.ui\` | Rendered |
|---|---|---|
| Sidebar | \`navSections\`, \`navItems\` (group, \`order\` 0–1000, \`badge\`, \`mobile\`) | Core groups sit at Build 200, Operate 300, People 400, Govern 500; items at multiples of 100 within a group. Badges read a UI data source returning \`{ count }\` |
| "+ New" and ⌘K | \`createEntries\`, \`paletteEntries\` (\`navigate\` / \`actions\`) | The top bar's New menu and the command palette; nav items also appear under Pages |
| User menu | \`userMenu\` | The avatar menu |
| Row, toolbar and bulk actions | \`itemActions\` (\`objectTypes\`: task, workflow, form, data_table, data_row, report, run; \`placement\`; \`bulk\`; \`appliesWhen\`) | Task \`…\` menu, workflow and form row menus, data table and row bulk bars |
| Detail tabs | \`detailTabs\` | Task detail (a data source returns \`{ fields }\` or \`{ items }\`) |
| Home widgets | \`widgets\` (\`metric\`, \`list\`) | Home, under the customisable grid |
| Notifications | \`notificationTypes\` | \`ctx.notify({ userId, type, title, body, href })\`; the bell opens \`href\` |
| Settings | \`settingsPages\` (\`workspace\`, \`instance\`, \`user\` scope; typed fields incl. \`secret\` and \`certificate\`; action buttons) | Settings, in the declared group; validated on the server on every save; secrets encrypted and write-only |
| Embeddable pages | \`pages[].embeddable: true\` | Also served without the app shell at \`/embed/x/<id>/<path>\`, which only the sites an operator approved may frame ([trusted embedding](/docs/self-hosting#trusted-embedding)). Same checks as \`/x/\`; signed out, the workspace's [automatic sign-in](/docs/self-hosting#automatic-sign-in) signs the person in with SSO (inside a frame: silently in a hidden frame, else a small popup), otherwise the page offers to open UserTasks in a new tab. Action redirects stay in the frame when the target page is embeddable, else open a new tab |
| Custom pages | \`pages\` + the pages module | \`/x/<id>/<path>\`: React server components inside the app shell, using \`@user-tasks/extension-sdk/ui\`: cards, page header, empty state, stat cards, notices, badges, entity tables (\`Table\`, \`THead\`, \`TBody\`, \`TR\`, \`TH\`, \`TD\`), action buttons and forms (text, select, checkboxes, checkbox and hidden fields) and \`ApiReference\` |

UI actions (\`ui.actions\`) and data sources (\`ui.data\`) run on the server as the signed-in person, and only when an entry naming them is visible to that person.

## The host API

Every hook receives \`ctx\`: \`tenantId\`, \`actorId\`, \`appUrl\` (this instance's public address, for links other systems open), \`launchUrl(path)\` (a page path with the workspace as the sign-in hint, for buttons and links other systems open: signed-out visitors go straight to the workspace's SSO — a hint for which identity provider to ask, never an identity), \`forms\` (create / list / get / delete forms bound to the extension's form targets, \`setTags\`, \`editors\`, \`submissionStats({ formIds?, days })\` — submission counts per form and per day, never values), \`db\`, \`config.get()\` and \`config.secret(key)\`, \`http.fetch\` (egress guard), \`events.emit\`, \`workflows.trigger\` (with \`workflowId\`: start one chosen workflow, e.g. a person starting it on a record; \`byPerson\` records them as the starter and \`inputs\` passes the workflow's input parameters, validated server-side), \`workflows.inputs(id)\` (a workflow's input parameters — key, label, type, required, default, choices, help — to build a start form), \`workflows.triggerConfigs(key)\` (the settings of the active workflows on one of the extension's triggers — what a poller must watch) and \`workflows.create({ name, trigger: { key, config }, nodes?, edges? })\` (a draft workflow pre-bound to one of the extension's triggers, as the person, optionally with its steps; returns the designer path), \`workflows.list({ trigger? })\` / \`publish\` / \`setActive\` / \`delete\` / \`setTags(id, tags, { prefix })\` / \`runs({ match })\` (every workflow on the extension's triggers — drafts too — with status, runs and last editor, managed as the person; \`setTags\` replaces only the tags that start with the extension's prefix, a badge and filter in the Automations and Forms lists; \`runs\` lists recent runs for one record), \`workflows.history({ workflowIds?, status?, pick?, limit, offset })\` (paged run history across the extension's workflows — status group, duration, the step it waits on, open tasks — following the run-list visibility rule; assignees need View all runs or View all tasks) and \`workflows.stats({ workflowIds?, days })\` (counts, success rate, average / p95 duration, runs per day and runs running / waiting now, aggregated in the database over at most 90 days), \`elevate(reason)\` (the same person with full permissions, for an action the extension authorised against an outside system — every audit entry carries the reason), \`importers.infopath\` (the core InfoPath importer on a template the extension obtained), \`forWorkspace(tenantId)\` (instance-level contexts only: public routes without auth, instance jobs), \`users.findByEmail(emails)\` (workspace members by e-mail, to map an external system's user), \`users.current()\` (the signed-in person's account e-mail and name), \`notify\`, \`audit\`, \`connections\`, \`directory\`, \`can(permission)\` (the caller's permissions, implied ones included; check it in UI actions, which any page of the extension can run), \`licence\` and \`logger\`.

### Record-change triggers

A trigger that reports a record's values before and after a change (a list item, a CRM record) can offer typed field conditions without building its own UI:

\`\`\`json
{
  "key": "record_changed",
  "config": [
    { "name": "table", "type": "string", "required": true },
    { "name": "events", "type": "array", "items": { "type": "string" }, "options": [{ "value": "created" }, { "value": "updated" }] },
    { "name": "filters", "type": "object" }
  ],
  "optionsFrom": { "table": "tables" },
  "filters": { "config": "filters", "fieldsFrom": "record_fields" },
  "previewFrom": "record_preview"
}
\`\`\`

- \`fieldsFrom\` is a UI data source asked with the current settings (\`item.values\`); it returns \`{ fields: [{ name, label, type, choices? }] }\` with type \`string\`, \`number\`, \`date\`, \`boolean\`, \`choice\`, \`multichoice\`, \`user\` or \`lookup\`. The designer saves \`{ match: 'all' | 'any', rules: [{ field, op, value?, changed?, type }] }\`.
- Operators: *changes*, *changes to*, *changes from*, *is* / *is not*, greater / less than (numbers and dates), *contains*, *is empty*; a comparison can also require the field to change ("Amount is greater than 1000, only when it changes").
- Evaluate the saved filter in \`matches()\` with the SDK's \`evaluateFieldFilters(config.filters, { before, after, changed })\` (typed comparison; structured values such as people match on any part); \`fieldFilterFields(filters)\` lists the fields a workflow depends on.
- \`previewFrom\` returns \`{ payload?, matched?, message? }\` for the latest event, without starting anything.

The design-time sources are guarded for workflow editors and the trigger's licence feature.

**The record behind a run.** \`"record": { "variable": "after", "fieldsFrom": "record_fields", "label": "List item", "idFrom": ["list_id", "item_id"] }\` says run variable \`after\` holds the record's values by field key. \`fieldsFrom\` (asked with the trigger's settings, also for form editors) returns \`{ fields: FormTargetSourceField[] }\` — key, label, typeLabel, fieldTypes, choices, readOnly, group, \`valuePath\` for structured values (a lookup's \`value\`) and \`lookupSource\` for lookups — which the form designer offers as **Workflow data → List item** on a task's form. With \`triggers.<key>.readRecord({ ctx, config, ids })\` (ids = the run variables named in \`idFrom\`), core reads the record's current values when a prefilled task opens and refreshes the fields nobody has edited.

### Lookup sources

\`lookupSources: { <key>: { label, feature?, lists({ ctx }), query(input) } }\` on the server module makes lists of the connected system a source for a form's **Autocomplete** (lookup source \`extension\`) and **Dropdown** options (dynamic binding \`extension\`). \`lists\` returns \`[{ id, label, columns: [{ key, label, type? }], valueColumn?, labelColumn? }]\` for the designer; \`query\` gets \`{ listId, search, match, searchColumns, filters (values already resolved), sort, limit, offset, values?, valueColumn, columns }\` and returns \`{ rows, more? }\`. Core keeps only the requested columns, checks submitted values with \`values\` and runs the provider with no permissions of its own.

### Connections

\`ctx.connections\` reaches the workspace's connections (Integrations) of the extension's **own** connectors (\`ext.<id>.<key>\`); other integrations are invisible.

| Call | Does |
|---|---|
| \`list({ connector? })\`, \`get(id)\` | Name, connector, base URL, auth type, transport, a non-secret auth summary (mode, user name) — never passwords, tokens or keys |
| \`fetch(id, url, init?, { timeoutMs?, retry?, anonymous? })\` | One request with the connection: its transport (e.g. the core \`windows\` NTLM / Kerberos transport with CA bundle and proxy), auth and default headers, through the egress guard with core timeouts, retries and redirect rules. \`url\` is relative to the base URL or absolute on the same origin; other origins are refused. \`anonymous\` sends no credentials but keeps TLS trust and proxy (discovery probes) |

So an extension builds on a connection's transport without ever handling its credentials.

### Licence

\`ctx.licence.check(feature)\` returns the decision; \`assert(feature)\` throws the framework's 402 error; \`limit(key, { adding?, unit? })\` reports usage against a licence limit using the extension's usage counter, and \`assertLimit\` refuses an addition over it (402 \`extension_limit_reached\`). See [Licences](/docs/self-hosting/licensing).

### Form data targets

A reusable form can be bound to a record an extension provides — an item in another product's list, a row in a line-of-business system. The binding lives on the form's layout, \`layout.data_target = { extension, key, config, label? }\`, so it travels with versions, exports and packages; \`config\` is the provider's own small settings object (scalars and string lists). The extension implements \`formTargets.<key>\` and usually creates the form with \`ctx.forms.create({ name, fields, layout, target: { key, config, label } })\` (as the caller, validated like any form), then sends the person to the returned \`designerUrl\`, where it is edited like any other form.

| Hook | Runs | Does |
|---|---|---|
| \`prepare({ form, params, purpose })\` | The form page opens (\`render\`), and before a submission is checked (\`submit\`) | Loads the record the form's URL parameters name (\`/f/<id>?ItemId=12\`, declared as form parameters): initial \`values\`, a concurrency \`version\` (an ETag), the \`record\` shown above the fields and a \`notice\`; \`mode: 'display'\` makes it a display form (below), \`actions\` adds buttons (app paths or http(s) links, \`target\` self / top / blank) and \`files\` lists the record's files as links. May refresh field properties that live in the external system — \`options\`, \`option_labels\`, \`read_only\`, \`required\`, \`help_text\`, \`min\`, \`max\`, \`placeholder\` only |
| \`submit({ form, values, params, version, people, readFile })\` | After core validated the values (types, required, rules) | Writes the record and returns \`{ record, version?, message? }\`. Nothing is stored when it throws: \`ExtensionError\` with \`details.fields\` shows per-field errors, 409 / 412 is a conflict ("changed since you opened it") |
| \`remove({ form, params, version })\` | A **Delete record** button was pressed (after the person confirmed) | Deletes the record (check the person may) and returns \`{ record?, message?, returnUrl? }\`. Without it, bound forms show no Delete button; with it, a Delete button shows only when \`prepare\` said \`canDelete: true\` for the record |
| \`check({ form })\` | The designer opens a bound form | Problems (removed or changed external fields) shown above the canvas |
| \`saved\` / \`deleted\` | The form is created, saved (new version) or deleted | Bookkeeping, e.g. which external fields the form uses (drift warnings). Errors are logged, never block the save; they run after the response, so a save or publish never waits for them |
| \`identity(config)\` | Comparing a saved binding with the previous one | What makes two bindings the same (e.g. the list). Editing a bound form's fields changes its config; with the same identity that is an update (\`saved\` gets \`previousConfig\`, no \`bindPermission\` check), not \`deleted\` + \`saved\`. Without it, any config change counts as a new binding |

Core checks the workspace may use the extension (enabled, licensed, the target's \`feature\`) before every hook; adding or changing a binding needs the target's \`bindPermission\`; public form links never reach the provider (their submissions are refused). People cross the boundary as e-mail addresses: \`prepare\` may return \`{ email, name? }\` for Person fields (core maps them to members of the workspace and notes the others), and \`submit\` gets \`people\` (id, name, e-mail of the chosen members). \`readFile\` returns the bytes of this submission's uploaded files only. The REST submit endpoint takes \`target_version\` for API clients.

**Display forms.** A provider whose \`prepare\` answers \`mode: 'display'\` (for both purposes) turns the form into a read-only view of the record, like a list's display form: core marks every field read-only, the page hides the submit buttons and shows the provider's \`actions\` instead (e.g. **Edit** opening the record's edit form, \`/f/<edit form id>?ItemId=12\`), the record's \`files\` are links above the fields, and any submission is refused. The form stays an ordinary form in the designer. \`ctx.forms.delete(id)\` removes one of the extension's own bound forms as the caller (forms.delete, with the usual usage and legal-hold checks), e.g. when the extension manages a set of forms together. \`ctx.forms.update(id, { fields?, layout?, buttons?, name?, description?, target? })\` changes one of them as the caller (forms.edit, validated, a new version); \`target\` replaces only the binding's config — e.g. adding columns that appeared in the source system, when the person asks for it.

**Back to where the record lives.** \`prepare\` and \`submit\` (and \`remove\`) may return \`returnUrl\` — the page the record lives on, such as its list. A button redirect whose address is \`{{target.return_url}}\` goes there, so "save, then back to the list" is an ordinary, visible button rule the designer can change. Likewise \`urls: { edit: '/f/<id>?ItemId=12' }\` fills \`{{target.url.edit}}\` — e.g. a **Link** button (a button kind that only opens its redirect) "Edit item" on a display form. Validate the address yourself (e.g. only the connected site); core accepts only http(s) without credentials. \`ctx.forms.update(id, { buttons?, target? })\` can add such default rules to forms the extension generated earlier (\`ctx.forms.get\` returns the stored \`buttons\`).

**Forms inside another site.** \`/embed/f/<id>\` is the form page for trusted embedding: only the sites in \`EMBED_FRAME_ANCESTORS\` may frame it, and there the member's own session is used (unlike \`/f/<id>\`, which is always signed out in a frame from another site). It posts \`{ type: 'usertasks:resize', height }\` for auto-height and \`{ type: 'usertasks:form', event: 'submitted' | 'cancelled' | 'deleted' | 'closed' }\` after a submission, Cancel, Delete or a display form's Close, so the host page can go back the way its own forms do; the host must check the message origin. Signed out in the frame, it offers to sign in in a new tab.

### Directory sources

An extension can bring people and groups from its system into UserTasks (for example the site groups of a SharePoint site collection). It never writes core tables: it declares a source, returns a snapshot from \`sync\`, and core reconciles it with the same tables, runs and rules as Entra ID, Okta, LDAP, Google Workspace and SCIM.

\`\`\`ts
directorySources: {
  people: {
    enabled: async ({ ctx }) => (await countConnectedSites(ctx)) > 0,
    sync: async ({ ctx, mode, cursor }) => ({
      users: [{ externalId: 'jdoe@contoso.com', displayName: 'Jane Doe', email: 'jdoe@contoso.com',
                aliases: ['jane.doe@contoso.com'], claims: ['i:0#.w|contoso\\\\jdoe'] }],
      groups: [{ externalId: 'site-1:8', displayName: 'Approvers', label: 'SharePoint · Finance',
                 members: ['jdoe@contoso.com'],
                 nested: [{ directory: 'ldap', name: 'CONTOSO\\\\Finance', members: ['…'] }] }],
      complete: true,
      cursor: 'change-token',
    }),
  },
},
\`\`\`

| What core does | |
|---|---|
| Runs | \`directory_sync_runs\` with provider \`ext.<id>.<key>\`, run by the directory-sync worker. Queue one with \`ctx.directory.requestSync(key, { full?, ifDue?, intervalMinutes? })\` — from a scheduled job (\`ifDue\`: only when the last run is older than the interval and \`enabled\` says there is something to sync) or a "Refresh now" action. Admins: Settings → SSO & Directory, \`POST /api/v1/directory-sync/sources/{source}/sync\`. \`mode\` is \`full\` at least daily and on request; on \`delta\` the handler may reuse cached data when its own change log says nothing changed |
| People | Every person is a directory entry with the keys they are matched on (\`email\` and \`aliases\`, lower-cased). A person whose key is the e-mail of an **active member** of the workspace is linked at once. Everyone else is **pending**: no account, no membership, no licence seat, no e-mail |
| First sign-in | When someone signs in with SSO (a verified address; the UPN too when its domain is in \`allowedDomains\`) or LDAP bind and a pending entry has that key, core creates the account if needed (even when the identity provider has no \`jit\`), adds the workspace membership with the provisioning role, links the entry and adds the person to the source's groups. With \`seatLimit\`, a licence limit counting the accounts linked to the source, an entry over the limit stays pending |
| Origin badge | Every team says where it comes from (\`origin\` on team objects, the badge and filter chips in the assignee pickers). A source's teams take the manifest's \`kind\` (\`sharepoint\`, \`active_directory\`, \`ldap\`, \`entra\`, \`okta\`, \`google\` or \`extension\`); a snapshot group's own \`kind\` overrides it (e.g. an AD group a SharePoint source lists). Without \`kind\` the label decides ("SharePoint" → \`sharepoint\`), else \`extension\` |
| Groups | Each group becomes a **read-only team** (\`teams.source\`, \`source_label\`): rename, delete and member changes answer 409 \`source_managed\`; lead, colour, kind, parent and org unit stay editable. Members: the linked people of the group, plus the members of each \`nested\` group of a directory connected in core (the team LDAP sync keeps for that AD group), else the source's own expansion (\`members\`). Teams work everywhere teams do: task and workflow assignment (team tasks go to the current members), people pickers with teams, visibility and notifications |
| Removals | With \`complete: true\` (the default), people and groups the source no longer lists lose what it gave them at the next sync: team memberships at once, and the workspace membership of people who joined through the source (they are pending again). People who were members before keep their membership. A snapshot with nobody in it removes nobody |
| Lookups | \`ctx.directory.lookupUsers({ userIds?, emails?, externalIds?, claims? })\` maps workspace members and entries both ways (for example a person field value to the person's external login name); \`lookupGroups({ teamIds?, externalIds? })\` does the same for groups; \`status(key)\` returns the counts and last run. Only this workspace and this extension's sources |

People with an account are matched by e-mail, the same key SSO and LDAP use, so return in \`email\` the attribute the instance matches on (mail or UPN; see [Active Directory and AD FS](/docs/services/active-directory)) and other known addresses in \`aliases\`.

### Importers

An importer turns another product's export — a workflow definition, a form template — into UserTasks workflows and forms. The manifest lists it (what it makes, the file endings it reads, its licence feature and options); the server module analyses and imports:

\`\`\`ts
importers: {
  flow: {
    detect: ({ files }) => (files.some((f) => f.name.endsWith('.flow')) ? 0.9 : 0),
    analyze: async ({ ctx, files, options }) => buildReport(parse(files)),          // dry run: nothing stored
    import: async ({ ctx, files, options }) => {
      const report = buildReport(parse(files))
      const wf = await ctx.workflows.create({ name: report.title, trigger: { key: 'record_changed', config: { list } },
        nodes: [{ id: 'approve', type: 'user_task', label: 'Approve', config: { … } }],
        edges: [{ source: 'trigger', target: 'approve' }] })
      return { report, created: [{ kind: 'workflow', id: wf.workflowId, name: report.title, href: wf.path }] }
    },
  },
},
\`\`\`

| | |
|---|---|
| Report | \`{ title, source, summary?, items: [{ kind, name, status, mappedTo?, detail?, location? }], complexity: { score 0–100, factors }, warnings, outputs, preview? }\`. Status: \`mapped\`, \`partial\` (review), \`placeholder\` (a labelled placeholder step keeps the original), \`skipped\`, \`info\`. Core recomputes coverage (mapped + half of partial over the items that count), the complexity level and readiness (\`auto\`, \`review\`, \`rebuild\`) so every importer scores alike; \`importCoverage\`, \`importReadiness\` and \`importReportMarkdown\` are in the SDK |
| Workflows | \`ctx.workflows.create\` with \`nodes\` / \`edges\` / \`variables\` / \`tags\`: a draft (inactive) workflow whose trigger node (\`trigger\`) is one of the extension's triggers and whose steps are core node types or the extension's own. Unmapped source steps should become \`placeholder\` steps whose label says what they were and whose \`note\` keeps the original |
| Connection references | \`connectionReferences: { feature?, list({ ctx, connectionId }), run({ ctx, connectionId, methodId, inputs }) }\` — methods the extension generates for one of its connections. They appear (read-only, grouped) in Integrations → the connection → References and run from its Test dialog as the caller; a method that \`writes\` asks first, a \`destructive\` one also needs \`confirm: true\` among its inputs (never pre-filled) |
| Forms | \`ctx.forms.create\` (bound to a form target), or the core InfoPath importer through \`ctx.importers.infopath({ bytes, fileName, dryRun?, options?, target?, hints? })\` — the same analysis and forms as an upload, each form bound to \`target\` |
| Gates | Core checks the extension is enabled and licensed with the importer's \`feature\` (402 when not: importers lock when a licence lapses, imported workflows keep running), the permission (default \`workflows.create\` / \`forms.edit\`; a dry run the view permission), the file endings and size (\`IMPORT_MAX_MB\`, default 20 MB), and audits imports. Files are never stored |
| Surfaces | Automations → Import from…, Forms → Import, \`GET /api/v1/importers\`, \`POST /api/v1/importers/{importer}/analyze\` and \`/import\` (\`importer: auto\` uses \`detect\`), MCP \`importers_list\` / \`importers_analyze\` / \`importers_import\`, CLI \`usertasks importers …\`. An importer that reads its source itself (e.g. from a connected system) declares no \`accepts\` (or \`filesOptional: true\` when it takes either) and reads its options instead of files. \`ctx.archives.unpack(bytes)\` opens a zip or CAB (e.g. a SharePoint .wsp), bounded |

**InfoPath hook.** \`infopath.enrich\` runs inside the core InfoPath importer (uploads and \`ctx.importers.infopath\`), after the forms are generated and before anything is stored, for every extension usable in the workspace. It sees the template's data connections and the generated forms, and may replace a form's fields or merge layout keys; only the extension that asked for a binding (\`target\`) may complete it (\`layout.data_target.config\`). A hook that throws is logged and skipped.

### Event waits

A workflow step can pause its run until an event from the extension's own trigger pipeline arrives. For example, a "Wait for item update" step waits for a change pushed by a receiver or found by a poller.

- **Pausing:** the node handler returns \`ctx.runs.waitFor({ key, match, conditions?, timeoutMinutes?, onTimeout?, description })\`.
  - Core stores the wait with an indexed \`(extension, key, match)\` key and pauses the run like any other wait.
  - The process view shows the step as waiting, with the \`description\` ("Status = Approved on item 4").
- **Resuming:** the pipeline calls \`ctx.runs.resume({ key, match, data })\` when something changes. Core finds the waiters of that key in one indexed lookup, checks each one's conditions against \`data\`, and resumes the matching runs through the signed resume queue. There's no polling per run.
  - Conditions use the core rule operators: \`equals\`, \`not_equals\`, \`contains\`, \`gt\`, \`is_empty\`, and \`changed\` (compared with \`data._previous\`).
- **What the step gets:** \`event\` (the data) and \`timed_out\`.
- **Timeouts:** these use the timed-pause machinery. \`onTimeout\` decides what happens:
  - \`continue\`: the run continues, with \`timed_out: true\`;
  - \`fail\`: the step fails;
  - \`branch\`: the run follows the connections labelled **Timed out** (other connections are followed on an event).
- **Cleanup:** cancelling a run removes its waits. A wait whose run is no longer waiting is removed when an event finds it.

### Generated API references

An extension that turns a customer's resource into an API (for example one reference per connected list) describes it as an \`ApiReferenceDoc\` — groups of typed operations and schemas — renders it with \`ApiReference\` from \`@user-tasks/extension-sdk/ui\` and serves \`toOpenApiDocument(doc)\` for API clients.
`,
  },
  {
    slug: 'developers/extensions/example',
    title: 'Example extension',
    description: 'extensions/example-hello: a free extension that uses every contribution point, and how to build it in and test it.',
    body: `
\`extensions/example-hello\` in the repository is a small free extension that uses every contribution point. Build it in:

\`\`\`bash
USERTASKS_EXTENSIONS=./extensions/example-hello npm run build
npm run start
USERTASKS_EXTENSIONS=./extensions/example-hello npm run admin -- ext migrate
\`\`\`

The last command creates its greetings table. Then enable **Hello (example extension)** in Settings → Extensions.

## Layout

| File | Entry | Contents |
|---|---|---|
| \`usertasks-extension.json\` | — | The manifest |
| \`manifest.ts\` | \`defineExtension({ manifest, connectors })\` | Client-safe: the manifest and the Hello Echo connector |
| \`server.ts\` | \`defineServerExtension({ … })\` | Say Hello node, Greeting Received trigger, \`/greetings\` endpoints, \`/ping\` and \`/hooks/greeting\` public routes, an hourly digest job, a \`task.completed\` subscription, two MCP tools, the greetings migration, the loopback transport, UI actions and data sources, settings validation and lifecycle hooks |
| \`pages.tsx\` | \`definePages({ '': …, new: …, digest: … })\` | Custom pages |
| \`package.json\` | \`usertasks.extension\` | Names the entry modules |

## What to try

- The **Hello** section in the sidebar (badge: greetings today) and **Greeting digest** under Operate.
- **+ New → Greeting**, and ⌘K **Say hello to the team**.
- A task's \`…\` menu: **Say hello to assignee** (only when the task has an assignee) — the assignee gets a notification.
- The **Hello** tab on a task, and the two widgets on Home.
- Settings → Workspace → **Hello**: typed fields, an encrypted API token and certificate, **Test connection**.
- In the workflow designer, the **Hello** palette group: the **Greeting Received** trigger and the **Say Hello** step.
- \`POST /api/v1/ext/example-hello/greetings\` with an API key, and \`ext_example_hello_greet\` over MCP.

## Testing an extension

\`\`\`ts
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import definition from '@/extensions/example-hello/manifest'
import server from '@/extensions/example-hello/server'

beforeEach(() => registerExtensionsForTest({ definitions: [definition], servers: [server] }))
afterEach(() => resetExtensionsForTest())
\`\`\`

The framework's own tests (\`__tests__/extensions-*.test.ts\`) run every contribution point this way.

## Styles

Custom pages and UI may use any Tailwind utility class. The codegen writes \`lib/extensions/generated/extensions.css\` (imported by the global stylesheet, empty without extensions) with one Tailwind \`@source\` per extension directory, so classes used only inside an extension package — which Tailwind's automatic scan skips (\`node_modules\`, ignored paths) — are generated too.

## Developing an extension package

Production builds install the package (\`npm install <tarball | git URL | path>\`, a real directory in \`node_modules\`) and are built with \`USERTASKS_EXTENSIONS=<package> npm run build\`.

For development, link your working copy instead (a symlink, as \`npm link\` makes):

\`\`\`bash
cd /path/to/usertasks
mkdir -p node_modules/@usertasks-ext && ln -s /path/to/my-extension node_modules/@usertasks-ext/my-extension
USERTASKS_EXTENSIONS=@usertasks-ext/my-extension npm run dev
\`\`\`

Turbopack does not compile files outside the project, and a symlinked package would resolve its own imports (\`react/jsx-runtime\` …) from its real directory, where they are not installed. So the codegen detects a linked package and mirrors it into \`.usertasks-ext/<id>/\` (git-ignored; \`.git\`, \`node_modules\` and dot-directories left out); the generated registry imports the mirror, which resolves through the project's own \`node_modules\` for \`next dev\`, \`next build\` and \`tsc\` alike. While \`next dev\` runs, changed files are copied into the mirror as you save them (if a server-side change does not show, restart \`next dev\`). Regenerating without the package (\`npm run extensions:gen\`) removes the mirror. A real install (\`npm install --install-links /path/to/my-extension\`) works too and is what production uses.
`,
  },
]
