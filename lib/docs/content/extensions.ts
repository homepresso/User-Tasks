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

The framework, the extension SDK and the licence verifier are open source (Apache-2.0) in the UserTasks repository. Paid extensions live in a private repository and are compiled into the Enterprise build only; core never imports them (a test enforces it). Without a licence an Enterprise build behaves exactly like the open-source one and lists its extensions as available but not licensed.

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
| \`contributes\` | Nodes, triggers, connectors and UI ([contribution points](/docs/developers/extensions/contribution-points)) |

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
    description: 'Workflow nodes and triggers, connectors and transports, REST and public routes, jobs, events, MCP tools, permissions, migrations, settings and UI.',
    body: `
## Server

| Contribution | Declared in | Behaviour in the server module | Notes |
|---|---|---|---|
| Workflow node | \`contributes.nodes[]\` with typed \`inputs\` / \`outputs\` (the custom-action field model) | \`nodes.<key>({ ctx, inputs, node, run })\` returns the outputs | Type \`ext.<id>.<key>\`; the designer panel, palette entry, validation and data picker come from the declaration. Inputs are resolved and coerced before the handler runs |
| Workflow trigger | \`contributes.triggers[]\` with \`config\` and \`variables\` | \`triggers.<key>.matches(config, payload)\` (optional) | Start runs with \`ctx.workflows.trigger(key, payload, { dedupeKey })\`: one start per key and workspace |
| Connector | \`contributes.connectors[]\` + the definition in the manifest module | — | Same model as built-in connectors; key \`ext.<id>.<key>\` |
| Connector transport | \`transports.<key>\` | \`({ ctx, config }) => ({ fetch })\` | Selected with \`auth_config._transport = "ext.<id>.<key>"\`. Core keeps the egress guard, timeouts, retries and redirects; the transport performs one request (NTLM, Kerberos, a vendor JWT) |
| REST endpoint | — | \`endpoints[]: { endpoint: defineEndpoint({…}), handler }\` | Served at \`/api/v1/ext/<id>/…\` through the standard pipeline (bearer token, permission, validation, envelope); listed in the served OpenAPI document (\`x-usertasks-extension\`) |
| Public route | \`capabilities.inbound_public_routes\` | \`publicRoutes[]: { path, methods, auth, handler }\` | \`/ext-public/<id>/…\`; auth \`none\`, \`api_key\` or \`signature\` (HMAC-SHA256 of the body with a workspace secret). Rate limited, 1 MB body cap, audited |
| Job | — | \`jobs[]: { name, cadence, scope, run }\` | Runs on the one-minute tick as \`ext.<id>.<name>\`, once per enabled workspace (or once per instance) |
| Event subscription | — | \`events[]: { pattern, handler }\` | Reads the event outbox after a cursor; \`ctx.events.emit(name, …)\` writes \`ext.<id>.<name>\` events |
| MCP tool | — | \`mcpTools[]: { name, description, schema, permission, mutates? }\` | Tool \`ext_<id>_<name>\`, gated by its permission, refused unless the workspace may use the extension; mutations audited |
| Permission | \`permissions[]\` | — | Dynamic \`ext.<id>.<key>\` keys; shown as a group in the role editor |
| Database | \`capabilities.db\` | \`migrations[]: { version, name, sql }\` | Linted: only \`ext_<id>__*\` tables, each with \`tenant_id\` and row-level security, policies through \`get_current_tenant_id()\` |
| Settings validation | — | \`settings.validate({ scope, page, values })\` | Extra checks after the schema passes |
| Lifecycle | — | \`lifecycle.onEnable / onDisable\` | Per workspace |

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
| Custom pages | \`pages\` + the pages module | \`/x/<id>/<path>\`: React server components inside the app shell, using \`@user-tasks/extension-sdk/ui\` |

UI actions (\`ui.actions\`) and data sources (\`ui.data\`) run on the server as the signed-in person, and only when an entry naming them is visible to that person.

## The host API

Every hook receives \`ctx\`: \`tenantId\`, \`actorId\`, \`db\`, \`config.get()\` and \`config.secret(key)\`, \`http.fetch\` (egress guard), \`events.emit\`, \`workflows.trigger\`, \`notify\`, \`audit\`, \`licence.check(feature)\` and \`logger\`.
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
`,
  },
]
