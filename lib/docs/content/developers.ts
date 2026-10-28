import type { DocPageDef } from '../types'
import { GALLERY_PACKAGES, GALLERY_SIGNING } from '@/lib/gallery/site'
import { GALLERY_CATEGORIES } from '@/lib/gallery/types'

export const API_PAGES: DocPageDef[] = [
  {
    slug: 'api',
    title: 'REST API',
    description: 'Authentication, the response envelope, pagination, errors and the OpenAPI document for /api/v1.',
    body: `
Everything in UserTasks is available under \`/api/v1\`. The API is described by an OpenAPI 3.1 document at [\`/api/v1/openapi.json\`](/api/v1/openapi.json) (public, no auth), which also generates the [SDK](/docs/sdk) types and the [CLI](/docs/cli) commands. Browse it interactively in the [API Explorer](/docs/api-explorer), or see the [endpoint list](/docs/api/endpoints).

## Authentication

Send an [API key](/docs/governance/api-keys) or an [OAuth access token](/docs/governance/oauth-apps) as a bearer token:

\`\`\`bash
curl -H "Authorization: Bearer $USERTASKS_API_KEY" https://tasks.example.com/api/v1/me
\`\`\`

\`GET /api/v1/me\` describes the credential: workspace, user, kind (API key or OAuth), permissions, scopes and expiry. Each endpoint requires one permission (listed in the [endpoint list](/docs/api/endpoints) and the OpenAPI document as \`x-permission\`).

## Envelope

Successful responses are wrapped:

\`\`\`json
{ "success": true, "data": { "workflows": [ … ], "total": 42 } }
\`\`\`

Errors keep the same shape with an HTTP status, a message, and optionally a machine-readable \`code\` and \`details\`:

\`\`\`json
{
  "success": false,
  "error": "Validation failed: name: Too small: expected string to have >=1 characters",
  "code": "validation_error",
  "details": [{ "path": "body.name", "message": "Too small: expected string to have >=1 characters", "code": "too_small" }]
}
\`\`\`

| Status | Meaning |
|---|---|
| 400 | Validation failed (\`details\` lists each problem) |
| 401 | Missing, invalid, expired or revoked credential |
| 403 | The credential lacks the permission or OAuth scope (\`insufficient_scope\` names the missing scope) |
| 404 | Not found in this workspace |
| 409 | Conflict (for example a duplicate name) |
| 429 | Rate limited (agent execution); honour \`Retry-After\` |
| 5xx | Server error — safe to retry idempotent requests |

## Pagination

List endpoints take \`limit\` (1–100, default 50; \`0\` for no limit) and \`offset\`, and return \`total\`. The event endpoints use a cursor instead (\`after\` / \`next_cursor\`). The SDK's \`client.paginate()\` and the CLI's \`--all\` fetch every page for you.

## Round-tripping resources

Update endpoints accept their own GET response as the body: read-only fields are ignored and \`__SECRET__\` keeps a stored credential. So \`GET\` → edit → \`PUT/PATCH\` works for every resource, and unchanged workflows, decision tables, objects and webhooks report \`changed: false\`.

## Starting work

\`\`\`bash
# start a workflow and wait for the result…
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" -H "Authorization: Bearer $USERTASKS_API_KEY" \\
  -H "Content-Type: application/json" -d '{"workflow_id":"<id>","variables":{"amount":1200}}'
# …or queue it and poll the run
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" … -d '{"workflow_id":"<id>","async":true}'
curl "$USERTASKS_URL/api/v1/workflows/runs/<run-id>" -H "Authorization: Bearer $USERTASKS_API_KEY"
\`\`\`

## Events

\`GET /api/v1/events\` and the Server-Sent Events stream \`GET /api/v1/events/stream\` expose the [event stream](/docs/observability).

## Same operations everywhere

REST, MCP and the CLI cover the same operations for every configurable resource; see [Surface parity](/docs/api/parity).
`,
  },
  {
    slug: 'api/endpoints',
    title: 'Endpoint list',
    description: 'Every /api/v1 operation with its method, path and required permission — generated from the API registry.',
    tocDepth: 2,
    body: `
::api-endpoints
`,
  },
  {
    slug: 'api/parity',
    title: 'Surface parity',
    description: 'How each resource maps across the REST API, MCP tools and CLI commands — generated from the parity table.',
    tocDepth: 2,
    body: `
::parity
`,
  },
  {
    slug: 'mcp',
    title: 'MCP server',
    description: 'Connect Claude, ChatGPT, Cursor and other MCP clients to UserTasks: setup, authentication and the full tool list.',
    tocDepth: 2,
    body: `
UserTasks runs a [Model Context Protocol](https://modelcontextprotocol.io) server at \`/api/mcp\` (streamable HTTP). AI assistants can list and start workflows, act on tasks, build workflows, decision tables and reports, read the event stream and administer the workspace — always within the credential's permissions.

## Connect a client

Use an API key (Settings → API Keys) as a bearer token:

\`\`\`json title="Claude Desktop / Cursor (mcpServers)"
{
  "mcpServers": {
    "usertasks": {
      "url": "https://tasks.example.com/api/mcp",
      "headers": { "Authorization": "Bearer <your-api-key>" }
    }
  }
}
\`\`\`

Clients that support MCP OAuth discover the authorization server from \`/.well-known/oauth-protected-resource\`, register themselves and send the user through consent; no key needed. Clients that can't send headers can use \`?key=\` when the server sets \`ALLOW_QUERY_KEY_AUTH=true\`. Browser-based clients must be listed in \`MCP_ALLOWED_ORIGINS\`.

Settings → MCP shows your server URL, ready-made client configuration and the tool groups available to you.

## Permissions

Each tool requires the permission listed below. With an OAuth token, the token's scopes must also grant it. Mutating tools are audited. A key limited to certain workflows or tables (\`workflow_ids\`, \`table_ids\`) only sees those.

## Good prompts

- "List my overdue tasks and complete the invoice approvals under 1 000 as Approved."
- "Build a workflow that triggers when a Vendors row is created, calls the ERP 'Get vendor' reference and assigns a review task to Accounts payable." (The \`workflows_catalog\` tool gives the assistant every node type and authoring recipes.)
- "Show failed runs in the last hour and the integration calls that caused them." (\`events_list\` with a trace id.)

## Tool reference

Generated from the MCP tool registry:

::mcp-tools
`,
  },
]

export const CLI_PAGES: DocPageDef[] = [
  {
    slug: 'cli',
    title: 'CLI',
    description: 'Install the usertasks CLI, log in with a browser or API key, use profiles and output formats, and script everything.',
    body: `
\`usertasks\` is the command-line interface for UserTasks. It talks only to the public REST API, so the server enforces exactly the same permissions as for any other client. Every REST operation has a command (generated from the OpenAPI document), plus hand-written commands for login, config as code and live logs.

::image cli-login | Terminal: logging in with an API key, whoami and listing workflows | Log in, check the credential, list workflows.

## Install

\`\`\`bash
npm install -g @usertasks/cli     # Node.js 20+
usertasks --version
\`\`\`

## Log in

\`\`\`bash
usertasks login --url https://tasks.example.com          # opens your browser (OAuth + PKCE, loopback redirect)
usertasks login --url https://tasks.example.com --api-key -  < key.txt   # or store an API key
usertasks whoami
\`\`\`

Browser logins refresh automatically and request every scope except \`keys:write\`; add it with \`--scopes …,keys:write\` if the CLI must create API keys (those keys must expire within 90 days). \`usertasks logout\` revokes the tokens.

**CI:** set \`USERTASKS_URL\` and \`USERTASKS_API_KEY\` — no login or profile needed. \`USERTASKS_API_KEY\` always overrides a stored credential.

## Profiles

Each login is saved as a profile (server URL and credential). Profiles live in \`$XDG_CONFIG_HOME/usertasks/config.json\` (\`~/.config/usertasks\`, or \`%APPDATA%\\usertasks\` on Windows); the folder is created with mode 0700 and the file 0600.

\`\`\`bash
usertasks login --url https://dev.example.com --profile dev
usertasks login --url https://tasks.example.com --profile prod
usertasks --profile dev workflows list
usertasks profiles use prod           # default from now on (or USERTASKS_PROFILE)
usertasks profiles list
\`\`\`

## Create, update, delete

Give a command a body with \`-f <file|->\` (JSON or YAML, \`-\` for stdin) or field by field with \`--set\`:

| Form | Sets |
|---|---|
| \`--set key=value\` | a string |
| \`--set key:=<json>\` | a JSON value (\`amount:=1200\`, \`tags:='["a","b"]'\`) |
| \`--set key=@file\` | the file's text |
| \`--set key:=@file\` | a parsed JSON or YAML file |

::image cli-crud | Terminal: creating, updating and deleting resources | Create, update and delete from the terminal.

\`\`\`bash
usertasks email-templates create --set name=Welcome --set subject="Hi {{first_name}}" --set html_body=@welcome.html
usertasks roles create -f role.yaml
usertasks roles get <id> -o json > role.json && $EDITOR role.json && usertasks roles update <id> -f role.json
usertasks roles delete <id> --yes
\`\`\`

\`<resource> get <id> -o json\` output is always accepted by \`<resource> update <id> -f\`: read-only fields are ignored and \`__SECRET__\` keeps stored credentials. Destructive commands ask for confirmation on a terminal; pass \`--yes\` in scripts.

## Monitor

\`\`\`bash
usertasks runs list --status failed
usertasks logs tail --category workflow,integration --severity warn
usertasks log-destinations status <id>
\`\`\`

::image cli-logs-tail | Terminal: usertasks logs tail streaming live workflow events | \`logs tail\` follows the event stream live and reconnects without gaps.

## Output

- \`-o table|json|yaml\` (default \`table\` on a terminal, \`json\` when piped; or \`USERTASKS_OUTPUT\`).
- \`--all\` fetches every page; \`--limit\` / \`--offset\` fetch one.
- \`--quiet\` hides informational messages; \`--debug\` logs HTTP requests to stderr.
- \`usertasks api GET /workflows -q limit=5\` calls any endpoint and prints raw JSON.

Exit codes are stable for scripts — see the [command reference](/docs/cli/commands#exit-codes).

## Shell completion

\`\`\`bash
usertasks completion bash > /etc/bash_completion.d/usertasks
usertasks completion zsh > "\${fpath[1]}/_usertasks"
usertasks completion fish > ~/.config/fish/completions/usertasks.fish
\`\`\`

Next: the full [command reference](/docs/cli/commands) and [recipes](/docs/cli/recipes).
`,
  },
  {
    slug: 'cli/commands',
    title: 'Command reference',
    description: 'Every usertasks command, option and exit code — generated from the CLI command table and the hand-written commands.',
    tocDepth: 2,
    body: `
Run \`usertasks <resource> --help\` or \`usertasks <resource> <verb> --help\` for the same information in your terminal.

::cli-commands
`,
  },
  {
    slug: 'cli/recipes',
    title: 'CLI recipes',
    description: 'Edit a workflow, promote configuration from dev to prod, gate CI on drift, monitor logs and ship them.',
    body: `
## Edit a workflow from your editor

\`\`\`bash
usertasks workflows definition <id> -o json > wf.json
# edit wf.json: add a node to "nodes" and an edge to "edges", change variables…
usertasks workflows update <id> -f wf.json          # saves the draft; changed: false if nothing differs
usertasks workflows publish <id> --set notes="Add CFO approval over 50k"
usertasks workflows versions <id>
\`\`\`

Runs keep using the previous version until you publish.

::image cli-edit-workflow | Terminal: workflow edit round trip | Export the draft, edit, update and publish.

## Promote configuration from dev to prod

\`\`\`bash
usertasks --profile dev config export ./config --format yaml
git add config && git commit -m "Invoice approval v2"
usertasks --profile prod config diff ./config --source-label dev
usertasks --profile prod config apply ./config --source-label dev
usertasks --profile prod config apply ./config --source-label dev   # again: everything unchanged
\`\`\`

Secrets are exported as \`__SECRET__\`. Replace them with \`\${env:VAR}\` or \`\${file:path}\`; the CLI substitutes them on your machine before upload. Apply never deletes. Use one \`--source-label\` per source workspace so ids map correctly.

::image cli-config-diff | Terminal: config export and diff | \`config diff\` shows exactly what an apply would create or update.

## Gate CI on drift

\`\`\`yaml title=".github/workflows/usertasks.yml"
name: usertasks config
on:
  pull_request:
  push:
    branches: [main]
jobs:
  config:
    runs-on: ubuntu-latest
    env:
      USERTASKS_URL: \${{ secrets.USERTASKS_URL }}
      USERTASKS_API_KEY: \${{ secrets.USERTASKS_API_KEY }}
      ERP_TOKEN: \${{ secrets.ERP_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install -g @usertasks/cli
      - run: usertasks config diff ./config --source-label dev --exit-code   # exit 7 = changes
        if: github.event_name == 'pull_request'
        continue-on-error: true
      - run: usertasks config apply ./config --source-label dev
        if: github.ref == 'refs/heads/main'
\`\`\`

## Watch production

\`\`\`bash
usertasks logs tail --severity error                       # everything that fails
usertasks logs tail --type 'workflow.run.*' --workflow <id>  # one workflow's runs
usertasks logs tail -o json | jq 'select(.type == "integration.call") | .attributes.status'
usertasks logs export --since 24h --category audit,security > audit.ndjson
\`\`\`

## Ship logs to Splunk

\`\`\`json title="splunk.json"
{
  "name": "Splunk production",
  "type": "splunk_hec",
  "config": { "url": "https://splunk.example.com:8088", "index": "usertasks" },
  "credentials": { "token": "\${env:SPLUNK_HEC_TOKEN}" },
  "filters": { "categories": ["workflow", "integration"], "min_severity": "info" }
}
\`\`\`

\`\`\`bash
usertasks log-destinations create -f splunk.json
usertasks log-destinations test <id>
usertasks log-destinations status <id>
\`\`\`

::image cli-log-destinations | Terminal: creating a Splunk destination and checking its status | Create a destination from a file, then check delivery and lag.

## Bulk operations with jq

\`\`\`bash
# complete every low-priority task assigned to me
usertasks tasks assigned --all -o json | jq -r '.[] | select(.priority == "low") | .id' |
  xargs -I{} usertasks tasks complete {} --outcome Approved --notes "Bulk approved"
\`\`\`
`,
  },
]

export const SDK_PAGES: DocPageDef[] = [
  {
    slug: 'sdk',
    title: 'TypeScript SDK',
    description: 'A typed client for the REST API, generated from the OpenAPI document, with retries, pagination, events and OAuth helpers.',
    body: `
\`@usertasks/sdk\` is a typed TypeScript client for \`/api/v1\`. Its types are generated from the server's OpenAPI 3.1 document, which ships with the package as \`@usertasks/sdk/openapi.json\`. It is ESM-only and runs on Node.js 20+ or any runtime with \`fetch\`.

\`\`\`bash
npm install @usertasks/sdk
\`\`\`

\`\`\`ts
import { apiKeyAuth, createClient, isUsertasksApiError } from '@usertasks/sdk'

const client = createClient({
  baseUrl: 'https://tasks.example.com',
  auth: apiKeyAuth(process.env.USERTASKS_API_KEY!),
})

// Typed by path and method; the { success, data } envelope is unwrapped.
const { workflows } = await client.GET('/workflows', { query: { limit: 10 } })

const run = await client.POST('/workflows/start', {
  body: { workflow_id: workflows[0].id, variables: { amount: 1200 }, async: true },
})

// Every page of a list endpoint
for await (const user of client.paginate('/users')) console.log(user.email)

try {
  await client.DELETE('/roles/{id}', { path: { id: 'system-role-id' } })
} catch (error) {
  if (isUsertasksApiError(error)) console.error(error.status, error.code, error.message, error.details)
}
\`\`\`

## Events

\`\`\`ts
for await (const event of client.events.stream({ category: 'workflow', severity: 'warn' })) {
  console.log(event.type, event.message)   // reconnects with Last-Event-ID, no gaps
}
\`\`\`

\`client.events.list()\` pages with a cursor and \`client.events.iterate()\` walks every page.

## Behaviour

- **Errors** — a failed request throws \`UsertasksApiError\` (\`status\`, \`code\`, \`details\`, \`requestId\`); a network failure throws \`UsertasksNetworkError\`.
- **Retries** — idempotent requests are retried on 429, 5xx and network errors with backoff that honours \`Retry-After\`.
- **Untyped calls** — \`client.request(method, path, options)\` calls any endpoint.
- **OAuth** — \`oauthAuth()\` refreshes tokens automatically (never twice at once, and with a lock if your token store provides one). Helpers cover PKCE (\`generateCodeVerifier\`, \`codeChallengeS256\`), discovery, code exchange, refresh, revocation and dynamic client registration.
- **Operation metadata** — \`OPERATIONS\` lists each operation's method, path, permission and CLI command.
`,
  },
  {
    slug: 'config-as-code',
    title: 'Config as code and GitHub sync',
    description: 'Export workspace configuration to files, review it in Git, diff and apply it across environments, or sync it with GitHub automatically.',
    body: `
Workflows, decision tables, custom steps, data-table schemas, integrations and references, objects, agents, reports, retention policies, roles, MCP servers, email templates, connectors, log destinations and the [workspace theme](/docs/governance/workspace-theme) can all be exported to files and applied to another workspace.

To ship a whole process — a workflow with everything it uses, signed and versioned, with the credentials each environment must supply asked for on install — build a [package](/docs/packages).

## The folder layout

\`\`\`text
config/
├── manifest.json                      # index: asset type, id, name, file
├── workflows/invoice-approval-6f1c2a9b.json
├── decision-tables/invoice-approval-policy-1d0e4c77.json
├── integrations/northwind-erp-8a2b11c0.json
├── references/get-vendor-03c9d1aa.json
├── email-templates/invoice-approved-5b7e9f12.json
├── log-destinations/splunk-production-2c4d6e8f.json
├── workspace-theme.json               # the one workspace theme (no id)
└── …
\`\`\`

The same layout is used by the CLI, the \`/api/v1/config/export\` and \`/api/v1/config/apply\` endpoints and GitHub sync. Files are JSON or YAML.

## Rules

- **Secrets** are always exported as \`__SECRET__\`. Put \`\${env:VAR}\` or \`\${file:path}\` in their place; the CLI substitutes them locally before upload. Sending \`__SECRET__\` keeps the stored value.
- **Apply never deletes.** Running the same apply twice reports everything unchanged.
- **Identity** — assets keep stable ids. Ids are mapped per \`--source-label\` (use one label per source workspace); \`--adopt-by-name\` links unmapped assets to existing ones with the same unique name.
- **Workspace theme** — \`workspace-theme.json\` replaces the target's theme (needs \`settings.edit\`). Uploaded fonts are matched by file name in the target workspace; logos from another workspace are dropped, with a warning. GitHub sync does not carry the theme.
- **Dependencies** — references between assets (a workflow's decision table, reference or agent) are rewritten to the target workspace's ids.

\`\`\`bash
usertasks config new workflow "Vendor onboarding" --dir ./config   # scaffold a file with a fresh id
usertasks config diff ./config --exit-code                          # exit 7 when apply would change something
usertasks config apply ./config --dry-run
\`\`\`

See the [CLI recipes](/docs/cli/recipes#promote-configuration-from-dev-to-prod) for a full dev → prod flow and a CI example.

## Export and import

Every list of artifacts in the app has an **Import** button, and each row or detail header has an **Export** button. This covers workflows, decision tables, custom steps, data tables, integrations, connectors, email templates, reports, agents, retention policies, custom roles, MCP servers and log destinations.

- **Export** downloads \`<name>.usertasks.json\`, a one-file config manifest. **Include dependencies** adds everything the asset uses: sub-workflows, activities, rules, data tables, integrations and connectors, email templates, agents and custom roles. For data tables, **Include table rows** adds up to 10,000 rows per table.
- **Import** accepts that file, a config folder's files, a single asset file or a per-type export (decision table, report, activity or agent designer file). It shows the dry-run plan first and then applies it. You choose how rows are written: \`merge\`, \`replace\` or \`skip\`.

The same export and import works on every other surface:

\`\`\`bash
usertasks config export ./out --ids <workflow-id> --with-dependencies     # one asset and what it needs
usertasks config export ./out --ids <table-id> --include-rows             # a data table with its rows
usertasks config apply ./out --dry-run && usertasks config apply ./out --rows-mode merge
\`\`\`

- **REST**: \`GET /api/v1/config/export?ids=…&with_dependencies=true&include_rows=true\` and \`POST /api/v1/config/apply\` (with \`rows_mode\`).
- **MCP**: \`config_export\` (\`ids\`, \`with_dependencies\`, \`include_rows\`) and \`config_apply\` (\`dry_run\`, \`rows_mode\`).

API keys, OAuth apps, webhooks, people and runtime data are never exported. [Export and import coverage](/docs/config-as-code/export-coverage) lists every artifact type by surface, what is left out on purpose and why.

## GitHub sync

**Settings → GitHub Sync** connects one repository (branch, path prefix, a token that can write) and keeps the workspace configuration there:

- **Push** — changes are queued and committed (manually, or automatically every minute), or run a full or scoped sync on demand.
- **Schedule** — hourly, daily or weekly full syncs in your time zone.
- **Deploy** — import a branch, ref or pinned commit into the workspace, with a dry run first.

\`\`\`bash
usertasks github-sync status
usertasks github-sync sync                     # full resync (or --set kind=commit for pending changes)
usertasks github-sync runs
usertasks github-sync deploy --set ref=main --set dry_run:=true
usertasks github-sync deployments
\`\`\`

Every sync and deployment runs in the background and returns an id to poll; results appear as \`system.sync.github.*\` events. Permissions: \`sync.view\`, \`sync.manage\`, \`sync.deploy\`.
`,
  },
  {
    slug: 'config-as-code/export-coverage',
    title: 'Export and import coverage',
    description: 'Which artifact types can be exported and imported from the app, REST, MCP, the CLI, config as code and packages — and what is excluded by design.',
    tocDepth: 2,
    body: `
::include docs/export-coverage.md
`,
  },
  {
    slug: 'packages',
    title: 'Packages',
    description: 'Bundle a workflow and everything it uses into a signed, versioned .utpkg, install it in other environments, finish incomplete setups and upgrade in place.',
    body: `
A **package** bundles a process — a workflow and everything it needs — into one signed, versioned file (\`.utpkg\`) that you install in other workspaces and environments: dev → test → prod, or from a vendor to its customers. Credentials never travel. When an install needs something the target environment must provide (database credentials, an API token, the URL of this environment's ERP), it asks for it — or installs **incomplete** and lets you finish the setup later.

Packages live in **Automations → Packages** (also under **Settings → Packages**), \`/api/v1/packages\`, \`/api/v1/package-installs\` and \`/api/v1/package-events\`, the MCP \`packages_*\` tools and \`usertasks packages …\`.

## Concepts

| | |
|---|---|
| **Package** | Root artifacts (usually a workflow) plus everything they use, found automatically: sub-workflows, custom steps, decision tables, data tables, integrations and their references and objects, connectors, email templates, agents, custom roles, retention policies, MCP servers. You can add items and leave items out. |
| **Version** | An immutable build of the package: \`1.0.0\`, \`1.1.0\`, … Each build exports the current state of every item, removes secrets, signs the result and stores it as a published version you can download again. |
| **Requirement** | Something an install has to supply: connector credentials, integration auth, other secrets, \`\${env:VAR}\` references, environment-specific URLs and hosts, assignees and roles. Generated at build time from what was removed or is environment-specific. |
| **Package library** | The packages installed in a workspace, with version, source, signer and status — **Complete** or **Incomplete** with a setup checklist. |
| **History** | Every install, upgrade, reinstall, downgrade, reconfigure (Complete setup) and uninstall in the workspace — failed attempts too — with the plan that was applied. |

What travels is the same configuration [config as code](/docs/config-as-code) exports (see [export coverage](/docs/config-as-code/export-coverage)); the workspace theme does not travel in packages.

::image packages-library-complete | Settings → Packages: an installed package with its setup checklist and installed assets | The package library: version, source, signer, status and what the package installed.

## Authoring a package

1. **Settings → Packages → New package**, then search for what the package **starts from** — a workflow or any other artifact. The picker searches every asset type on the server (so it stays fast with thousands of assets): filter by type, tag, last update or owner, pick several (↑↓ and Enter, Ctrl/⌘+Enter to add), and choose whether their dependencies come along. Assets already in the package are marked *In package* or *Dependency*.
2. Review the contents. Every item says why it is there (*root*, *used by the package*, *added*). Remove what should not travel — a removed dependency must then exist in the target workspace already.
3. For each data table choose **Schema only** (default) or **Schema + rows** (lookup tables, reference data — at most 10,000 rows per table).
4. Check **Asked for on install**: the requirements the package will generate.
5. **Build version**: pick a version (default: the next patch) and release notes. The \`.utpkg\` downloads and the version is kept in the workspace.

::image packages-editor | The package editor: contents with the reason each item is included, data modes and requirements | Contents are resolved from the workflow: its decision table, integration, email template and the Vendors table with rows.

From the CLI:

\`\`\`bash
usertasks packages assets invoice --type workflow          # search every packageable asset
usertasks packages create "Invoice approval" --from "Invoice approval" --readme README.md
usertasks packages add invoice-approval --search vendor --type data_table   # choose from the matches
usertasks packages set-data invoice-approval Vendors rows
usertasks packages update invoice-approval --set description="AP approvals" --set readme=@README.md
usertasks packages show invoice-approval                   # items, why each is included, data modes, requirements
usertasks packages build invoice-approval --bump minor --notes "Clearer approval step"
usertasks packages inspect invoice-approval-1.1.0.utpkg      # offline: checksum, file hashes, signature
\`\`\`

## Requirements

Requirements are derived from the package itself, so every secret becomes one — nothing secret is ever written to a package file (builds refuse to complete if one is found).

| Kind | Generated for | Fields |
|---|---|---|
| \`connector\` | every connector | its credential fields (secret, required) and connection settings such as host, port and database (optional, default = the source value) |
| \`integration_auth\` | integrations with credentials | tokens, passwords, API keys and credential headers (secret) plus base URL / database host (environment-specific, optional) |
| \`secret\` | any other removed secret | MCP server and log destination credentials, secrets inside workflow steps |
| \`env\` | \`\${env:VAR}\` and \`secret://…\` references | the value for this environment |
| \`user\` | assignees and teams in workflow steps | a user (id or email) in the target workspace — people never travel |
| \`role\` | built-in roles referenced by id | bound by slug (\`manager\`, …) automatically |

Each requirement has an id such as \`connector:connectors:<id>\` and fields such as \`credentials.password\`; values are given as \`{ "<requirement id>": { "<field key>": "value" } }\`.

## Importing (installing)

Open **Automations → Packages** and drag a \`.utpkg\` file onto the page — or choose **Import package** and pick one. With nothing installed yet the page is one large drop zone. The import wizard opens with the file:

1. **Package** — the file is verified (checksum, every file hash, signature) and its readme and contents are shown. A modified file is refused.
2. **Changes** — the dry-run plan: what is created, updated or unchanged, assets changed locally since the last install, assets no longer in this version, and the row mode per packaged table (**merge**, **replace** or **skip**).
3. **Configure** — the requirements form. Fill it in, or tick **Keep incomplete**.
4. **Done** — the result, and the library entry.

::image packages-wizard-changes | Install wizard, step 2: the plan of an upgrade with one updated workflow | Step 2 shows exactly what will change before anything is written.

::image packages-wizard-configure | Install wizard, step 3: the requirements form with the stored token kept | Step 3: requirement values. On an upgrade, values set before are kept (shown as *set*).

With the CLI, missing values are prompted for on a terminal (secrets without echo); in scripts pass them as flags or a file — \`\${env:VAR}\` and \`\${file:path}\` are substituted locally:

\`\`\`bash
usertasks packages install invoice-approval-1.1.0.utpkg --dry-run
usertasks packages install invoice-approval-1.1.0.utpkg \\
  --set 'integration_auth:integrations:<id>.config.auth_config.token=\${env:ERP_TOKEN}' \\
  --set 'integration_auth:integrations:<id>.config.base_url=https://erp.test.example' --yes
usertasks packages install invoice-approval-1.1.0.utpkg -f values.yaml --yes
\`\`\`

Without a terminal a missing required value fails the install (exit 6) and prints the \`--set\` to add — unless \`--keep-incomplete\`.

### Into another workspace

If you belong to more than one workspace, a package **authored here** can be installed into another one without downloading the file: on the package's card in **Authored here**, choose **Install in another workspace**, pick the workspace and the version, and the same wizard runs against that workspace — its permissions (you need \`packages.install\` there) and its requirement values. The library entry there shows the source as *library*.

## Incomplete installs and Complete setup

Installed with values missing, a package is **Incomplete**:

- connectors, integrations, MCP servers and log destinations that need configuration are created **disabled**;
- workflows that depend on them are installed **inactive** and cannot be activated or published until setup is complete — the designer says why;
- the library shows a checklist of what is missing.

::image packages-library-incomplete | An incomplete install with its checklist | Incomplete: the integration and the workflow that uses it need configuration.

::image packages-needs-configuration | The workflow designer explaining why the workflow cannot be activated | Activation is blocked with the reason.

**Complete setup** opens the same requirements form. Once every required value is set, the disabled items are enabled and the package's active workflows are published and activated.

::image packages-complete-setup | The Complete setup form | Complete setup: add the token now that it is available.

\`\`\`bash
usertasks packages installs
usertasks packages complete invoice-approval --set 'integration_auth:integrations:<id>.config.auth_config.token=\${env:ERP_TOKEN}'
\`\`\`

## Upgrades

Installing a newer version of an installed package **upgrades it in place**: every package asset maps onto what its earlier install created (\`package_install_assets\`), so nothing is duplicated.

- The plan comes first (wizard step 2, \`upgrade --dry-run\`): field diffs per asset.
- **Local connection details are kept**: credentials stay in the local rows, and non-secret requirement values (URLs, hosts, assignees) are stored with the install and reused. Only *new* requirements are asked for.
- Assets **changed in this workspace** since the last install are flagged; choose **Keep assets changed here** (\`--keep-local-changes\`) to leave them alone.
- Assets **no longer in the package** are flagged and kept — never deleted.
- Workflows that are active here are re-published so the new version goes live; inactive ones stay inactive.
- Data rows merge by default: rows installed before are updated, new ones added.

\`\`\`bash
usertasks packages upgrade invoice-approval-1.2.0.utpkg --dry-run
usertasks packages upgrade invoice-approval-1.2.0.utpkg --yes
\`\`\`

## Removing a package and its artifacts

**Uninstall** (the bin icon on an installed package, \`usertasks packages uninstall <install>\`) first shows the plan: **every artifact** the package installed and what will happen to it — **Remove**, **Keep** (with the reason) or **Gone** (already deleted by hand) — including how many rows each data table holds and what goes with an item (an integration takes its references and objects with it). Nothing changes until you confirm.

By default an uninstall is cautious:

| Kept unless you choose otherwise | Option | CLI / API |
|---|---|---|
| Data tables that hold rows | **Remove everything including data tables and their rows** — every table the package installed is deleted with all its rows, also rows added since install. You must type the package name to confirm. | \`--delete-data\` / \`delete_data\` |
| Items changed in this workspace since install | **Also remove items changed since install** — your edits are lost. | \`--force\` / \`force\` |

The workspace's default email template is never removed.

**Runs in progress.** Deleting a workflow deletes its runs, so unfinished runs (running, waiting on a task or timer, paused) of the package's workflows block the uninstall. The dialog lists them with links; tick **Cancel these runs** (\`--cancel-runs\`, \`cancel_runs\`) to cancel them — their open tasks are closed, as with **Cancel** on a run — and then uninstall. Cancelling needs \`workflows.activate\`.

**Permissions.** Besides \`packages.install\`, removing each item needs its section's delete permission (\`workflows.delete\` for workflows and decision tables, \`data.delete\` for data tables, \`integrations.delete\`, \`workflows.edit\` for email templates, …). A missing one is reported in the plan and the uninstall is refused before anything is removed.

When it is done you get a summary per artifact. Integrations, email templates and similar items are deleted immediately; workflows, decision tables and data tables are removed by the background deletion worker within a minute.

\`\`\`bash
usertasks packages uninstall invoice-approval --dry-run                       # the plan; exits 7 when something blocks it
usertasks packages uninstall invoice-approval --delete-data --force --cancel-runs --yes
\`\`\`

## History

The **History** tab (also **History** on an installed package) is the timeline of every install, upgrade, reinstall, downgrade, reconfigure (**Complete setup**) and uninstall in the workspace — including attempts that failed, such as a refused downgrade, a tampered file or an uninstall blocked by running workflows. Uninstalled packages keep their history.

Each entry records when and who, the channel (app, CLI, API or MCP), where the file came from, the version from → to, the signature status and signer fingerprint, the items created / updated / unchanged / removed / kept, rows written or deleted, runs cancelled, requirement changes (for example *ERP token: missing → met*), the options used and any errors. Filter by package, action, status, user and date; **Export CSV** downloads the filtered list. Click an entry for the detail drawer: everything above plus **the full plan / diff that was applied** — per artifact the action and field changes (credentials are never stored, only that they changed).

History needs \`packages.view\`. Installs from before history was introduced are reconstructed from the audit log (marked as such, without a plan).

\`\`\`bash
usertasks packages history                                   # newest first
usertasks packages history invoice-approval --action upgrade,uninstall --since 2026-10-01
usertasks packages history --status failed --user ada@northwind.example
usertasks package-events get <event id> -o json              # one event with its plan
\`\`\`

REST: \`GET /api/v1/package-events?package=&action=&status=&channel=&actor=&since=&until=\` and \`GET /api/v1/package-events/{id}\`; MCP: \`packages_history\`, \`packages_history_get\`.

## Gallery

The [package gallery](/gallery) is where the UserTasks community uploads and shares solutions. It has ${GALLERY_PACKAGES.length} **Official** packages in ${GALLERY_CATEGORIES.length} areas (${GALLERY_CATEGORIES.map((c) => c.title).join(', ')}), ${GALLERY_PACKAGES.filter((p) => p.native).length} of them marked **No integrations needed** (built-in features only: they install complete with nothing to configure), plus Workday, SAP S/4HANA, ServiceNow, Salesforce, Microsoft 365 and NetSuite flows with their system chips — and **Community** packages shared by users. Each is a complete workflow with its forms, decision tables, data tables and sample rows, REST integrations with response models and email templates. Each package page says how the process starts — **Starts from a form** (a themed start form, or a form page with its own /f/ link), **Headless / API**, **Scheduled** or **Event-driven** — what it needs, the forms people fill in, and the generated requirements.

\`\`\`bash
curl -fLO https://usertasks.com/gallery/expense-claims-1.0.0.utpkg
usertasks packages inspect expense-claims-1.0.0.utpkg
usertasks packages install expense-claims-1.0.0.utpkg --keep-incomplete --yes
\`\`\`

In the app, **Automations → Packages → Browse gallery** lists Official and Community packages (with their badges; filter by source or *No integrations needed*) and opens the import wizard with the package you pick. On a self-hosted instance the community entries come from the public index \`GALLERY_INDEX_URL\` (default \`https://usertasks.com/api/gallery/index\`, fetched and downloaded through the instance's own server; \`off\` for air-gapped installs). [\`/gallery/index.json\`](/gallery/index.json) lists every package with its version, file, size, SHA-256 and signer, for scripted installs. ${GALLERY_SIGNING.signed ? `Gallery packages are signed with the **${GALLERY_SIGNING.key_name}** ed25519 key, fingerprint \`${GALLERY_SIGNING.fingerprint}\`. Installs trust it automatically (*Signed by a trusted key*); instances on an older release can add it to \`PACKAGE_TRUSTED_FINGERPRINTS\`.` : `Gallery packages are signed with the **${GALLERY_SIGNING.key_name}** ed25519 key once it is published; until then the files are unsigned preview builds — compare the SHA-256 on each package page.`} Package sources live in the repository under \`gallery/packages/\` in the config-as-code layout; \`gallery/README.md\` explains how to author, build and verify one.

### Share your solution

Signed-in users share a package at [/gallery/share](/gallery/share): the \`.utpkg\` (up to 5 MB), a title, summary, description, category, tags, licence (Apache-2.0 by default), the author name and link to show, and up to six screenshots (SVGs are sanitised). The package is validated at once — package integrity, an optional signature, no secrets, placeholder hosts, real node types and settings, every path connected, valid forms and lookups, no raw HTTP or custom code — and queued. Nothing is public until an instance administrator approves it in **Settings → Gallery review**, where the file is re-validated and can be run headlessly in a scratch workspace (\`GALLERY_HEADLESS_VERIFY\`). The submitter is emailed the decision (with the reason when it is rejected). Approved packages are listed as **Community** with the author, licence, version history and download count, and every listing has **Report abuse**.

Official packages are contributed with a pull request to \`gallery/packages/\` in the repository: see the *Gallery packages* section of CONTRIBUTING.md.

## Signing and trust

Builds are signed with the instance's **ed25519** key: generated on first build and stored encrypted with \`ENCRYPTION_KEY\`, or provided as \`PACKAGE_SIGNING_KEY\` (PEM) from your secret store. Without either, packages are built unsigned.

The checksum is a SHA-256 over the canonical JSON of \`manifest.json\` (without \`checksum\` and \`signature\`), and \`manifest.json\` lists the SHA-256 of every other file — so any change to any file breaks verification, and re-signing needs the private key. Installs show **Signed by this instance**, **Signed by a trusted key** (fingerprints in \`PACKAGE_TRUSTED_FINGERPRINTS\`, and the [gallery](#gallery) key), **Signed by an unknown key** (installable; compare the fingerprint out of band) or **Unsigned**.

## The file format

A \`.utpkg\` is a ZIP archive:

| Path | |
|---|---|
| \`manifest.json\` | \`format_version\`, \`kind\`, \`package\` (stable id, name, slug, semver version, description, author, created_at, readme), \`data\` (mode per table), \`requirements\`, \`dependencies\` (\`{ package_slug, version_range }\`), \`files\` (path + sha256), \`checksum\`, \`signature\` |
| \`README.md\` | the readme |
| \`assets/…\` | one JSON file per asset in the [config-as-code layout](/docs/config-as-code) |
| \`data/<table>.ndjson\` | rows of tables packaged with rows |

\`dependencies\` name other packages that must be installed first (\`^1.0.0\`, \`~1.2\`, \`>=1 <2\`, …).

## Permissions

| To… | You need |
|---|---|
| See packages, versions, the library and the history; plan an install or uninstall | \`packages.view\` (OAuth \`packages:read\` or \`config:read\`) |
| Create and edit packages, build and download versions | \`packages.manage\` (OAuth \`packages:write\` or \`config:write\`) |
| Install, upgrade, complete setup | \`packages.install\` (OAuth \`packages:write\` or \`config:write\`) — and the create / edit permission of every section the package writes, as for config apply |
| Uninstall | \`packages.install\` and the delete permission of every section it removes (plus \`workflows.activate\` to cancel runs) |

Owner, Admin and Manager have all three by default.

## Promotion in CI

Build once in dev, promote the same signed file:

\`\`\`bash
# dev
usertasks --profile dev packages build invoice-approval --bump patch --out invoice-approval.utpkg
# test, then prod: plan, then install with this environment's values
usertasks --profile test packages install invoice-approval.utpkg --dry-run
usertasks --profile test packages install invoice-approval.utpkg -f env/test.values.yaml --yes
usertasks --profile prod packages install invoice-approval.utpkg -f env/prod.values.yaml --yes
\`\`\`

\`values.yaml\` maps requirement ids to fields; keep secrets out of it with \`\${env:…}\`:

\`\`\`yaml
"integration_auth:integrations:52deca14-…":
  config.auth_config.token: \${env:ERP_TOKEN}
  config.base_url: https://erp.prod.example
\`\`\`

A missing value exits 6 in CI, so a new requirement in a new version stops the pipeline instead of installing something half-configured.
`,
  },
]
