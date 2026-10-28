import type { DocPageDef } from '../types'

export const INTEGRATION_PAGES: DocPageDef[] = [
  {
    slug: 'integrations',
    title: 'Integrations',
    description: 'Connect REST and OData APIs, webhooks and databases once, with encrypted credentials, and reuse their operations everywhere.',
    body: `
An **integration** is a connection to one external system: its type, base URL or database settings, authentication and shared headers. Its operations are saved as [references](/docs/integrations/references) that workflows, agents, reports and MCP clients call by name — nobody pastes URLs or tokens into individual workflows.

::image integrations | The integrations page | Integrations and their references; every call is tested, logged and governed.

## Types

| Type | Use it for | Notes |
|---|---|---|
| \`rest_api\` | Any HTTP/JSON API | Methods GET, POST, PUT, PATCH, DELETE; path, query, header and body templates |
| \`odata\` | OData v2/v4 services | Service root plus entity paths and standard query options |
| \`webhook\` | Outbound callbacks | Send governed notifications to another system |
| \`database\` | Postgres, SQL Server, MySQL, Oracle, MongoDB, Snowflake | Oracle, MongoDB and Snowflake drivers are [optional installs](/docs/self-hosting/optional-drivers) when self-hosting |

## Authentication

\`auth_type\` is \`none\`, \`api_key\` (header or query key), \`bearer\`, \`basic\` or \`oauth2\` (authorization code with PKCE and automatic token refresh; see [OAuth connections](/docs/integrations/oauth)). Credentials are encrypted at rest with \`ENCRYPTION_KEY\` and are **write-only**: the API and exports return \`__SECRET__\` in their place, and sending \`__SECRET__\` back on an update keeps the stored value.

## Creating one

In the app: **Integrations → New integration**, or start from a [connector](/docs/integrations/connectors) or an [OpenAPI document](/docs/integrations/openapi-import). From a terminal:

\`\`\`yaml title="erp.yaml"
name: Northwind ERP
type: rest_api
config:
  base_url: https://erp.example.com/api
  auth_type: bearer
  auth_config:
    token: \${env:ERP_TOKEN}
\`\`\`

\`\`\`bash
usertasks integrations create -f erp.yaml
usertasks integrations test <id>
\`\`\`

## Safety

- **Egress guard** — outbound calls to private, loopback and cloud-metadata addresses are blocked unless a self-hosted server sets \`ALLOW_PRIVATE_EGRESS=true\` (metadata endpoints stay blocked).
- **Call logs** — every call records method, host, path, status and duration with headers redacted, and emits an \`integration.call\` event (warn on 4xx, error on 5xx) for [log export](/docs/observability).
- **Permissions** — \`integrations.view\`, \`integrations.create\`, \`integrations.edit\`, \`integrations.test\`, \`integrations.delete\` and \`integrations.manage_references\` are separate, so you can let designers use references without seeing or changing connections.
`,
  },
  {
    slug: 'integrations/references',
    title: 'References',
    description: 'Saved, typed operations on an integration — inputs, request templates and output mappings — callable from workflows, agents, reports and MCP.',
    body: `
A reference is one operation: method, path template, query parameters, headers, body template, typed **inputs** and **outputs**. Callers supply inputs; the reference builds the request, calls the integration with its stored credentials and maps the response to named outputs.

An object or list given to an input is sent as JSON: in a body template \`{{customer}}\` — or a quoted \`"{{customer}}"\` — becomes the JSON value itself, and in a query parameter, header or path it becomes the JSON text (\`?filter={"status":"open"}\`, URL-encoded). A file reference sends its URL. A custom JSON body in the Call Reference node inserts object and list variables as JSON the same way.

\`\`\`json title="A reference"
{
  "name": "Get vendor",
  "method": "GET",
  "path_template": "/vendors/{{vendor_id}}",
  "inputs": [{ "name": "vendor_id", "type": "string", "required": true }],
  "outputs": [
    { "name": "vendor_name", "path": "name", "type": "string" },
    { "name": "risk", "path": "risk.rating", "type": "string" }
  ]
}
\`\`\`

## Using references

- **Workflows** — the **Call API / Reference** node maps variables to inputs and outputs to variables; a **Live Reference** binds one so expressions always read fresh data.
- **AI agents** — grant a reference as a tool; the agent sees its name, description and input schema.
- **Reports** — references with outputs can be report sources.
- **MCP and API** — \`references_execute\` / \`POST /api/v1/references/{id}/execute\` (\`usertasks references execute <id> --set inputs:='{"vendor_id":"V-311"}'\`).

## Testing

Run a reference from its page with sample inputs and see the request (secrets redacted), status, timing and mapped outputs. Calls made by tests are logged like any other.

## Response model

Each reference has a **response model**: the shape of its response (nested objects, lists with their item fields, types, descriptions and example values). Workflows browse it in the [data picker](/docs/workflows/api-responses), so designers click \`response › data[] › email\` instead of writing JSON paths.

- **OpenAPI/Swagger import** fills it from the 2xx response schema (\`$ref\`s resolved); **database** references from the table columns; **connectors** from their declared outputs.
- **Test** in the reference builder captures it from the real response when the reference has no model yet (or only an inferred one); **Capture from test response** merges another sample. The stored sample keeps up to 20 items of each list (fewer if it would exceed about 48 KB), with long strings shortened and credential fields masked. The builder shows the model as a tree, and **+** on a field adds a named output with the right path.
- References created before models existed derive one from their outputs' paths until their next test.

It is stored at \`request_config.response_schema\` and returned as \`response_schema\` by \`GET /api/v1/references/{id}\` and MCP \`references_get\`. Set it with \`response_schema\` on create/update (\`null\` clears it), or capture it from a call: \`POST /api/v1/references/{id}/execute\` with \`"capture_schema": true\` (MCP \`integrations_execute_reference\`, \`usertasks references execute <id> --set capture_schema:=true\`).

\`\`\`json title="A response model"
{ "source": "sample", "root": { "type": "object", "fields": [
  { "name": "data", "type": "array", "items": { "type": "object", "fields": [
    { "name": "email", "type": "string", "example": "ada@example.com" }
  ] } }
] } }
\`\`\`

Object fields are a list of \`{ name, … }\` (not a JSON Schema \`properties\` map), and examples are never kept for credential-shaped field names.

## Bulk operations

\`usertasks references bulk-delete --set ids:='["…","…"]'\` removes many references at once; connectors can regenerate their ready-made references with \`usertasks connectors regenerate-references <id>\`.
`,
  },
  {
    slug: 'integrations/connectors',
    title: 'Connectors',
    description: 'Pre-built integrations for AI providers, communication, cloud storage, databases, payments and productivity tools.',
    tocDepth: 2,
    body: `
A connector is a pre-configured integration for a known service. It asks only for that service's settings and credentials, tests the connection with a service-specific probe, and creates ready-made references. Connectors can be enabled, disabled and tested like any integration:

\`\`\`bash
usertasks connectors catalog            # what is available
usertasks connectors create -f slack.yaml
usertasks connectors test <id>
\`\`\`

## Database connectors

PostgreSQL, SQL Server and MySQL drivers are always installed. The Snowflake (\`snowflake-sdk\`), Oracle (\`oracledb\`) and MongoDB (\`mongodb\`) drivers are optional when self-hosting: \`npm ci\` installs them, the Docker image needs \`--build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true\`, and **Test connection** says which package to install when one is missing. See [Optional drivers](/docs/self-hosting/optional-drivers) for installing them, and for the [Snowflake](/docs/self-hosting/optional-drivers#snowflake), [Oracle](/docs/self-hosting/optional-drivers#oracle) and [MongoDB](/docs/self-hosting/optional-drivers#mongodb) connection details (account identifiers, thin mode, SRV and TLS, proxies and private networks).

## Catalog

The catalog below is generated from the connector registry.

::connectors
`,
  },
  {
    slug: 'integrations/openapi-import',
    title: 'OpenAPI and Postman import',
    description: 'Turn an OpenAPI 2/3 or Postman document into an integration with one reference per operation.',
    body: `
Import an API description instead of defining references by hand. UserTasks reads OpenAPI 2 (Swagger), OpenAPI 3 or a Postman collection (JSON or YAML), creates an integration from the first server URL and security scheme, and one reference per operation with typed inputs from its parameters and request body.

\`\`\`bash
# send the document as the body…
usertasks integrations import-openapi -f petstore.yaml
# …or wrap it to choose the name, base URL, auth and a subset of operations
usertasks integrations import-openapi --set spec=@petstore.yaml --set name="Pet store" \\
  --set base_url=https://petstore.example.com/v2 --set selected_reference_indexes:='[0,2,5]'
\`\`\`

In the app, **Integrations → Import** previews every operation before anything is created. Credentials are never taken from the document; add them to the integration afterwards.
`,
  },
  {
    slug: 'integrations/oauth',
    title: 'OAuth connections',
    description: 'Connect services that use OAuth 2.0: authorization code with PKCE, encrypted tokens and automatic refresh.',
    body: `
For services that require OAuth 2.0, an integration or connector with \`auth_type: oauth2\` stores the client id and secret, authorize and token URLs and scopes (connectors prefill these). An administrator clicks **Connect**, consents at the provider, and UserTasks stores the access and refresh tokens encrypted.

- Tokens are refreshed automatically before they expire, and a background job (\`oauth-refresh\`, every 10 minutes) keeps idle connections fresh.
- Token write-back is race-free: an interactive call and the background job can refresh at the same time without losing the refresh token.
- Disconnecting revokes and deletes the stored tokens.

> [!NOTE]
> This page is about UserTasks calling **other** services. To let other applications call **UserTasks** with OAuth, see [OAuth apps and scopes](/docs/governance/oauth-apps).
`,
  },
  {
    slug: 'integrations/webhooks',
    title: 'Webhooks',
    description: 'Receive webhooks that start workflows (or answer synchronously), and send governed outbound callbacks.',
    body: `
## Inbound

An inbound webhook belongs to a workflow with a **Webhook** or **Middleware** trigger. Each has a slug and a secret (stored only as a bcrypt hash):

\`\`\`bash
usertasks webhooks create <workflow-id> --set slug=invoice-intake
# returns the webhook and its secret once — store it
curl -X POST "$USERTASKS_URL/api/webhooks/inbound?hook=<slug>" \\
  -H "Authorization: Bearer <secret>" -H "Content-Type: application/json" -d @invoice.json
usertasks webhooks rotate <webhook-id>     # new secret; the old one stops working
\`\`\`

- **Webhook** trigger — responds as soon as the run is queued.
- **Middleware** trigger — keeps the request open until the run finishes and returns the run's variables, so a workflow can validate or enrich a request in line.

A payload mapping turns fields of the body into variables; the whole body is always \`{{_raw}}\`. Callers that cannot send an \`Authorization\` header can pass the key as \`?key=\`.

## Outbound

Use a \`webhook\` integration (or an HTTP Request node) to call other systems. Failed outbound deliveries are retried and, if they keep failing, dead-lettered with an \`integration.webhook.dead_letter\` event.

## Log export webhooks

To stream UserTasks events to your own endpoint with HMAC signatures, use a [log destination](/docs/observability/destinations#webhook-signatures) instead.
`,
  },
]
