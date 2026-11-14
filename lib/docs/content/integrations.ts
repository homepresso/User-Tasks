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

\`auth_type\` is \`none\`, \`api_key\` (header or query key), \`bearer\`, \`basic\`, \`oauth2\` (authorization code with PKCE and automatic token refresh; see [OAuth connections](/docs/integrations/oauth)) or \`windows\` (NTLMv2 or Kerberos with a service account, for on-premises services such as SharePoint Server; see [Windows authentication](/docs/integrations/windows-auth)). Credentials are encrypted at rest with \`ENCRYPTION_KEY\` and are **write-only**: the API and exports return \`__SECRET__\` in their place, and sending \`__SECRET__\` back on an update keeps the stored value.

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

- **Egress guard** — outbound calls to private, loopback and cloud-metadata addresses are blocked. A self-hosted server opens the on-premises systems it needs with \`EGRESS_PRIVATE_ALLOW\` (hostnames, \`*.domain\` wildcards, CIDRs) and allows plain \`http://\` for specific hosts with \`EGRESS_HTTP_ALLOW\`; metadata endpoints stay blocked. See [Connecting to on-premises systems](/docs/self-hosting#connecting-to-on-premises-systems).
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
- **Load sample** in the designers that bind a reference to a list (a form's Data table and lookup fields, the workflow Loop, the Call reference step's response model) runs the reference once and merges the response into the model, so a model can be captured where you need it. Connector models only name the top-level fields of the response; a test or a sample fills in the rest (for S3, the fields of each item of \`contents\`), and regenerating a connector's references keeps a captured model.
- References created before models existed derive one from their outputs' paths until their next test (several outputs with no path are read as top-level fields of that name).

It is stored at \`request_config.response_schema\` and returned as \`response_schema\` by \`GET /api/v1/references/{id}\` and MCP \`references_get\`. Set it with \`response_schema\` on create/update (\`null\` clears it), or capture it from a call: \`POST /api/v1/references/{id}/execute\` with \`"capture_schema": true\` (MCP \`integrations_execute_reference\`, \`usertasks references execute <id> --set capture_schema:=true\`).

\`\`\`json title="A response model"
{ "source": "sample", "root": { "type": "object", "fields": [
  { "name": "data", "type": "array", "items": { "type": "object", "fields": [
    { "name": "email", "type": "string", "example": "ada@example.com" }
  ] } }
] } }
\`\`\`

Object fields are a list of \`{ name, … }\` (not a JSON Schema \`properties\` map), and examples are never kept for credential-shaped field names.

## Pick a list from a nested response

Where a reference feeds a list — a form's **Data table** rows, a **lookup**'s results, a workflow **Loop** — the designer shows the response model as a tree and lets you pick the list at any depth: the response itself, \`contents\`, \`data.result.items\`, \`value[0].children\`, or \`orders[].lines\` (every order's lines, one after the other). Lists show their item count and a preview of the first item; **Search keys** filters the tree; a typed path is checked against the model. When the response holds exactly one list of objects it is picked for you. **Load sample** runs the reference once (needs **Test integrations**; saved on the reference with **Manage references**) when there is no model yet or it doesn't describe the items.

::image forms-data-table-collections | The Rows list picker on an S3 list-objects reference: contents (list of 3 items) chosen, with the item fields key, size, last_modified, etag and storage_class | S3's list-objects response: \`contents\` is picked and its items' fields are ready to use.

Paths are relative to the response body the reference returns — what Data tables, lookups and Loops read at run time (a model that was captured with a \`{ status, headers, data }\` envelope is shown from \`data\` down). In a workflow the Loop's items become \`{{<step>_response.contents}}\`, and the data picker drills into the items (\`contents[] › key\`).

## Custom references

Generated references mirror the API one operation at a time, with every input and the whole response. A **custom reference** is a tidy, reusable one you build yourself: pick the operation (or a database table or view), declare the inputs callers give, choose the columns that come back, and add filters, sort, distinct and paging. Workflows, forms, agents, reports, MCP, the API and the CLI see only what you chose.

On an integration's page, **Manage References → New custom reference** opens the builder. **Duplicate as custom** on a generated reference is a quick way to start from it.

::image integrations-custom-reference | The custom reference builder: name and kind (List), source "List objects", a Fixed bucket input and an asked prefix input, the operation parameters, "Where it runs" (the prefix filter at the API; filter, sort, columns and paging on the server) and a Test result with key, size and last_modified | A List reference over S3-style list-objects: \`bucket\` is fixed, \`prefix\` is asked, and only three columns come back.

The builder has these parts:

- **Kind.** A **List** returns rows (an array, or \`{ rows, total }\` with **Return { rows, total }**). A **Read** returns one record or \`null\`. You pick its key input, the field the key matches, and whether "not found" returns \`null\` or fails with 404.
- **Source.** One of these:
  - one of the integration's references;
  - a connector catalogue operation;
  - an operation from the imported OpenAPI file (all of them are kept, even when you start empty);
  - a method and path on the integration;
  - for database integrations, a **table or view**.

  The server copies the request from the source when you save. Calls only ever go to the integration's own base URL, with its credentials and egress rules.
- **Inputs.** Each input has a type (string, number, integer, boolean, date, list or object) and one of two modes:
  - **Ask callers** (the default): callers provide the value. It can be required, have a default and a description.
  - **Fixed value**: a constant kept inside the reference, or one of the integration's own settings. Fixed inputs are not in the reference's input list, so the Call reference step, form mappings, agent tools and the API/MCP/CLI never ask for them. A value a caller sends anyway is ignored.

  A secret must come from the integration's credentials (pick it as an integration setting). A secret-looking name typed in plain text is refused. A credential-backed input can be sent to the API but not used in a server-side filter.

  Inputs are validated against their types, and inputs the reference doesn't declare are dropped.
- **Operation parameters.** For each of the operation's own parameters, give a constant, \`{{input.name}}\`, or leave it empty to use its default.
- **Rows and columns.** **Load sample** runs the source once with the sample values. You then pick the rows list with the same tree as the Data table field, add fields as columns, and rename them. Nested paths (\`Owner.DisplayName\`) can be up to 3 levels deep.
- **Filter.** Conditions are a field, an operator and a value, combined in AND / OR groups. The operators are equals, does not equal, greater/less (or equal), contains, starts/ends with, is one of, is not one of, and is (not) empty. A value is a constant or \`{{input.name}}\`, and a blank optional input skips its condition.
- **Sort, distinct and paging.** Sort on several columns, each with a direction. **Distinct** keeps one row per distinct value of the selected columns, ordered by them unless you sort. Paging has a page size and max rows (up to 1,000), and you can optionally expose \`page\` / \`limit\` inputs.

**Where it runs.** The builder's **Where it runs** panel shows which parts the API or database does and which the server applies:

- **REST:** a top-level AND condition can be sent to an operation parameter (*at the API → prefix*). Sort and paging can be mapped to parameters too. Everything else is applied by the server to at most 1,000 fetched rows, within a time limit.
- **Tables and views:** filter, distinct, sort, columns and limit compile to **one parameterised SQL query**. Column names must be ones read from the table and are quoted. Every value is a bound parameter.

The server runs every call in this order: source call → rows → filter → distinct → sort → columns → page.

**Test** runs the draft through the real executor (permissions, egress guard, call log). It shows the shaped result, the timing and how many rows were fetched, matched and returned. Saving stores the response model from the columns and their types, so the workflow data picker, Data table columns, lookups and Loops offer exactly those fields. Custom references are tagged **Custom** in reference pickers.

### Worked example: recent documents

An S3-style list-objects operation returns \`{ Name, Prefix, Contents: [{ Key, Size, LastModified, ETag, StorageClass, Owner }] }\`. To build a reference that returns only the files under a folder, newest first:

1. **Source**: *List objects*. **Kind**: List.
2. **Inputs**: \`bucket\` as a **Fixed value** \`docs\`, and \`prefix\` as **Ask callers** (string, "Only keys under this folder").
3. **Operation parameters**: \`bucket\` = \`{{input.bucket}}\`, \`list-type\` = \`2\`.
4. **Load sample**, then pick \`Contents\` as the rows. Add \`Key\` → \`key\`, \`Size\` → \`size\`, \`LastModified\` → \`last_modified\`.
5. **Filter**: \`Key\` *starts with* \`{{input.prefix}}\`, run *at the API → prefix* (S3 filters by prefix itself). Add \`Size\` *greater than* \`0\` on the server.
6. **Sort**: \`last_modified\` descending.

Callers now see one input (\`prefix\`) and three columns:

\`\`\`json title="Test with prefix = invoices/"
[
  { "key": "invoices/2026/inv-0102.pdf", "size": 51877, "last_modified": "2026-10-21T11:20:45.000Z" },
  { "key": "invoices/2026/inv-0101.pdf", "size": 48213, "last_modified": "2026-10-03T09:12:01.000Z" }
]
\`\`\`

Changing the fixed \`bucket\` later changes every workflow, form and agent that uses the reference. Nothing that uses it needs editing.

### Worked example: distinct countries

For a country picker, use a customer list (\`{ value: [{ id, company, country, … }] }\`). Pick \`value\` as the rows and \`country\` as the only column, then tick **Only distinct values**. The result is \`[{ "country": "Argentina" }, { "country": "Germany" }, …]\`, sorted and one row per country, ready for a form lookup.

### Write references: Create, Update, Upsert, Delete and Execute

Custom references also cover writes. Pick the **Kind**:

| Kind | What it does | REST default | Database |
| --- | --- | --- | --- |
| **Create** | Adds one record and returns it | \`POST\` | \`INSERT\` |
| **Update** | Changes the record(s) a key or conditions pick | \`PATCH\` (or \`PUT\`) | \`UPDATE … WHERE\` |
| **Upsert** | Creates the record, or updates it when its key exists | \`PUT\` | see below |
| **Delete** | Removes the record(s) a key or conditions pick | \`DELETE\` | \`DELETE … WHERE\` |
| **Execute** | Runs an action | \`POST\` with a body | a stored procedure or function |

You can change the REST method. Inputs work as for reads: typed, **Ask callers** or **Fixed value** (credential-backed Fixed values included). Write references show a **Writes data** badge in the builder and in every picker: the workflow Call reference step, form rule actions and Buttons, "For each changed row" rules and agent tools.

::image integrations-custom-reference-write | The custom reference builder for an Update on a database table: kind Update with the Writes data badge, SET status from {{input.status}}, WHERE key order_id = {{input.order_id}}, Return the written row, max affected rows 1, and a dry run that shows the UPDATE … RETURNING statement with bound parameters, "Would affect 1 row" and the record | "Update order status": key-based, at most one row, and a dry run that was rolled back.

**REST request body.** For a REST write, choose what the body is:

- **Build the body**: a list of fields. Each has a JSON path (dotted paths such as \`ticket.requester.email\` build nested objects) and a value: \`{{input.x}}\`, text with inputs in it, or a constant. A value can also be typed as string, number, boolean, JSON or null. A whole \`{{input.x}}\` keeps the input's type, and a blank optional input leaves its field out.
- **Send the whole input object**: every input as a JSON object, except credentials and the idempotency key.
- **The operation's own body**: the source's body template, filled by its parameters.
- **No body**.

Path and query placeholders are the operation parameters, as for reads. **Request preview** shows the method, the path and the JSON body with the Test sample values while you edit. Values are always data: a caller's \`{{…}}\` is sent as text and never filled in.

**Database writes.** For a table, choose:

- the columns to write, each from an input or a constant (**Create**, **Update**, **Upsert**);
- the **key** columns: for Update and Delete the \`WHERE column = value\` (ANDed with any filter conditions); for Upsert the columns that decide insert or update (they need a unique constraint);
- **Return the written row**, with RETURNING on PostgreSQL and OUTPUT on SQL Server, projected through the column picker. Other databases return the values written.

Column names must be ones read from the table and are quoted for the database. Every value is a bound driver parameter, so neither a value nor a column name can change the statement. Upsert is written the way each database does it:

| Database | Upsert |
| --- | --- |
| PostgreSQL | \`INSERT … ON CONFLICT (key) DO UPDATE SET …\` |
| MySQL | \`INSERT … ON DUPLICATE KEY UPDATE …\` |
| SQL Server | \`MERGE … WITH (HOLDLOCK) … WHEN MATCHED / NOT MATCHED\` |
| Oracle, Snowflake | \`MERGE … WHEN MATCHED / NOT MATCHED\` |

**Execute on a database.** Pick a stored procedure or function from the database's own list. Its parameters come from the database, and each is mapped from an input, a constant or left empty (NULL). Free-form SQL is not allowed. The server checks the procedure and its parameter names against the database again when you save. Supported:

| Database | Execute |
| --- | --- |
| PostgreSQL | functions (\`SELECT * FROM fn(…)\`) and procedures (\`CALL\`) |
| SQL Server | procedures (\`EXEC … @param = …\`) and scalar functions |
| MySQL | procedures (\`CALL\`) and functions, without OUT parameters |
| Oracle | procedures (\`BEGIN … END;\`, named parameters) and functions, without OUT parameters |
| Snowflake | not yet |

**Output.** Every write returns \`{ status, affected_rows, id, record }\`:

- \`status\`: the HTTP status, or 200 for the database;
- \`affected_rows\`: rows written;
- \`id\`: the **Id field** of the record, else its \`id\`, else the first key value;
- \`record\`: the written record, projected through the columns (for REST: at **Record path** in the response).

Execute on a database also returns \`rows\`. These are the outputs the workflow data picker and form result mappings offer. Success is HTTP **200-299** unless you set **Success statuses** (for example \`200,201,204\`). For **Update** and **Delete**, when nothing matched, choose **fail the call (404)** (the default) or **succeed — no-op**.

#### Safety

- **No unbounded writes.** Update and Delete need a WHERE: key columns or filter conditions on a table, or a parameter that identifies the record on a REST operation (a path parameter such as \`/tickets/{{id}}\`). Saving without one is refused. At run time, a blank key value, or a WHERE whose conditions were all skipped, refuses the call before anything is sent.
- **Max affected rows** (Update, Upsert and Delete on a table): 1 by default, up to 1,000. The statement runs in a transaction. If more rows would change, it is rolled back and the call fails with 409.
- **Dry run.** **Test** on a database write runs the statement in a transaction that is always rolled back. It shows the SQL with its bound parameters (credentials masked), the rows it would affect, whether a real run would go over the cap, and the record.
- **Send for real.** **Test** on a REST write first shows the request that would be sent (method, URL, headers without credentials, body). It is only sent when you choose **Send for real** and confirm the warning. Every real send is in the integration's call log. **Load sample** is not offered for writes.
- **Idempotency.** For **Create** and **Execute**, pick an input as the **Idempotency key**. REST sends it as the \`Idempotency-Key\` header (or a header you name). The server also keeps a 24-hour ledger: a retry with the same key gets the first call's result instead of writing again. This covers a retried workflow step or a double-clicked button. A failed call releases the key so a retry can run.
- **Permissions.** Creating or editing any custom reference needs **Manage references**. Running one follows the usual reference rules.
- **Where they run.** A write reference runs from the workflow Call reference step, form rule actions and Buttons (on the server), "For each changed row" rules, agents, MCP, the API and the CLI. It never runs as a read: Data tables, lookups, Live Reference steps, report sources and the browser's reference endpoint refuse it. The egress guard, credential masking and the Fixed-input rules all apply as for reads.

**In forms.** The Data table and lookup pickers leave write references out. A rule action or Button step that calls one shows *Writes data — it runs on the server, for real, every time this rule fires*. In a **For each changed row** rule, an Update, Upsert or Delete reference is a natural per-row target. Choose **API call**, pick the reference and use **Map row columns to inputs of the same name** (for example \`order_id ← {{row.OrderID}}\`). **Agents**: a write reference is a side-effecting tool, and adding one turns on **Requires approval** until you turn it off.

### Worked example: update order status

A key-based update on the \`orders\` table, at most one row:

1. **Kind**: Update. **Source**: *A table or view* → \`sales.orders\`.
2. **Inputs**: \`order_id\` (integer, required), \`status\` (string, required).
3. **SET**: \`status\` ← \`{{input.status}}\`. **WHERE key**: \`order_id\` = \`{{input.order_id}}\`. **Max affected rows**: 1. **Nothing matched**: fail (404). Tick **Return the written row**.
4. **Dry run** with \`order_id = 10248\`, \`status = shipped\`:

\`\`\`json title="Dry run (rolled back)"
{
  "dry_run": true, "rolled_back": true,
  "sql": "UPDATE \"sales\".\"orders\" SET \"status\" = $1 WHERE \"order_id\" = $2 RETURNING \"order_id\", \"status\"",
  "params": ["shipped", 10248],
  "affected_rows": 1, "max_affected_rows": 1, "would_exceed": false,
  "record": { "order_id": 10248, "status": "shipped" }
}
\`\`\`

In a form, a **For each changed row** rule on an editable Data table of orders calls it once per changed row, with \`order_id ← {{row.order_id}}\` and \`status ← {{row.status}}\`.

### Worked example: create ticket

A REST POST with a mapped body and an idempotency key:

1. **Kind**: Create. **Source**: *An endpoint* \`POST /tickets\` (or the helpdesk's catalogue operation).
2. **Inputs**: \`subject\` and \`description\` (required), \`priority\` (integer), \`requester_email\`, and \`request_id\` (string, the idempotency key). Add \`channel\` as a **Fixed value** \`portal\`.
3. **Body**: *Build the body*:
   - \`ticket.subject\` ← \`{{input.subject}}\`
   - \`ticket.comment.body\` ← \`{{input.description}}\`
   - \`ticket.priority\` ← \`{{input.priority}}\`
   - \`ticket.requester.email\` ← \`{{input.requester_email}}\`
   - \`ticket.via\` ← \`{{input.channel}}\`
4. **Idempotency key**: \`request_id\`, sent as \`Idempotency-Key\`. In a workflow, map it to a value that stays the same when the step is retried, such as the request's own id or \`{{task_id}}-ticket\`. A retried step then cannot open a second ticket.
5. **Record path**: \`ticket\`. Columns: \`id\`, \`status\`.

**Request preview**:

\`\`\`json title="POST /tickets"
{ "ticket": { "subject": "Printer on fire", "comment": { "body": "Floor 3" }, "priority": 2,
              "requester": { "email": "ann@example.com" }, "via": "portal" } }
\`\`\`

**Test** shows this request without sending it. **Send for real** sends it and returns \`{ "status": 201, "affected_rows": 1, "id": 4711, "record": { "id": 4711, "status": "new" } }\`.

### Worked example: execute a stored procedure

On PostgreSQL, a function \`shop.cancel_order(p_order integer, p_reason text) RETURNS TABLE(order_id integer, status text)\`:

1. **Kind**: Execute. **Source**: *A stored procedure or function…* → \`Function · shop.cancel_order\`.
2. **Inputs**: \`order_id\` (integer), \`reason\` (string). The parameters are filled in from the database: \`p_order\` ← \`{{input.order_id}}\`, \`p_reason\` ← \`{{input.reason}}\`.
3. **Dry run** shows \`SELECT * FROM "shop"."cancel_order"($1, $2)\` with \`[10248, "duplicate"]\`, the result rows and the record, all rolled back.

On SQL Server the same reference runs \`EXEC [shop].[cancel_order] @p_order = @_in1, @p_reason = @_in2\`.

### API, MCP and CLI

A custom reference is a reference whose \`request_config\` is \`{ "origin": "custom", "custom": { … } }\`. Create or update it with \`POST /api/v1/integrations/{id}/references\` / \`PATCH /api/v1/references/{id}\`, MCP \`references_create\` / \`references_update\`, or \`usertasks references create\`. The server builds the request, the public inputs, the outputs and the model.

A write reference adds \`kind\` (\`create\`, \`update\`, \`upsert\`, \`delete\` or \`execute\`) and \`write\`. It can hold \`method\`, \`body\` (\`{ mode, fields: [{ path, value, type? }] }\`), \`idempotency\` (\`{ input, header? }\`), \`success_statuses\`, \`set\` / \`key\` (\`[{ column, value }]\`), \`returning\`, \`procedure\` (\`{ schema, name, params: [{ name, value }] }\`), \`max_affected\` and \`not_found\` (\`error\` or \`noop\`).

\`\`\`json title="request_config of a custom reference (abridged)"
{
  "origin": "custom",
  "custom": {
    "kind": "list",
    "source": { "type": "operation", "reference_id": "<a reference of this integration>",
                "params": [{ "name": "bucket", "value": "{{input.bucket}}" }] },
    "inputs": [
      { "name": "bucket", "type": "string", "mode": "fixed", "fixed_value": "docs" },
      { "name": "prefix", "type": "string", "mode": "ask" }
    ],
    "rows_path": "Contents",
    "columns": [{ "path": "Key", "alias": "key" }, { "path": "Size", "alias": "size" }],
    "filter": { "op": "and", "conditions": [{ "field": "Key", "operator": "starts_with", "value": "{{input.prefix}}", "api_param": "prefix" }] },
    "sort": [{ "field": "last_modified", "direction": "desc" }]
  }
}
\`\`\`

The config travels in \`request_config\`, so export/import, packages, config-as-code and GitHub sync carry it. **Regenerate references** on a connector never changes or deletes custom references.

## Choosing which references to create

When you enable a connector or import an OpenAPI/Postman file, you choose:

- **Generate all**: one reference per operation, as before.
- **Start empty**: build custom references yourself.
- **Generate selected**: search and tick the operations you need.

The API takes \`reference_mode\` (\`all\`, \`none\` or \`selected\`) and \`reference_template_keys\` on \`POST /api/v1/connectors\` (keys are listed in the catalogue's \`reference_templates\`), and \`selected_reference_indexes\` (\`[]\` = start empty) on \`POST /api/v1/integrations/import-openapi\`.

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
A connector is a pre-configured integration for a known service. It asks only for that service's settings and credentials, tests the connection with a service-specific probe, and creates ready-made references. Connectors can be enabled, disabled and tested like any integration. \`connectors catalog\` lists what is available:

\`\`\`bash
usertasks connectors catalog
usertasks connectors create -f slack.yaml
usertasks connectors test <id>
\`\`\`

## Database connectors

PostgreSQL, SQL Server and MySQL drivers are always installed. The Snowflake (\`snowflake-sdk\`), Oracle (\`oracledb\`) and MongoDB (\`mongodb\`) drivers are optional when self-hosting: \`npm ci\` installs them, the Docker image needs \`--build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true\`, and **Test connection** says which package to install when one is missing. See [Optional drivers](/docs/self-hosting/optional-drivers) for installing them, and for the [Snowflake](/docs/self-hosting/optional-drivers#snowflake), [Oracle](/docs/self-hosting/optional-drivers#oracle) and [MongoDB](/docs/self-hosting/optional-drivers#mongodb) connection details (account identifiers, thin mode, SRV and TLS, proxies and private networks).

### Database safety

- Values reach the database as driver parameters, for every dialect. Inputs that name tables, columns or clauses are validated, and any other \`{{input}}\` in your own SQL is bound as a value, not pasted in as SQL text.
- PostgreSQL runs one statement per call. The list and get templates run in a read-only transaction on PostgreSQL, MySQL and Oracle.
- Results are capped at \`DB_MAX_ROWS\` rows (default 5000), and the call's timeout is passed to the driver.
- New PostgreSQL connectors verify the server certificate (\`verify-full\`; paste a CA for private CAs). Existing connectors keep their TLS mode.
- MongoDB refuses \`$where\`, \`$function\`, \`$out\` and \`$merge\`. **Delete many** and **Update many** refuse an empty filter unless \`allow_all\` is true.
- Snowflake connectors can sign in with a key pair, which is the default for new connectors.
- A database or SFTP host on a private network must be listed in \`EGRESS_PRIVATE_ALLOW\` on a self-hosted server (by hostname or CIDR). The host is checked on every call, not only in **Test connection**.

## SFTP

The SFTP connector pins the server's host key. Run **Test connection**: it shows the server's SHA-256 fingerprint. Check it with your server administrator, then paste it into **Host key fingerprint**. Every file operation stays under **Default remote path**. Transfers are limited to \`SFTP_MAX_BYTES\` (default 25 MB).

## How connector calls behave

- **Retries:** a 429 answer is retried after the provider's \`Retry-After\`. 502, 503 and 504 answers are retried only for reads and for writes that carry an idempotency key; Stripe calls always carry one. All attempts share the call's timeout.
- **Errors:** a call that the provider answers with an error still returns its status and body. \`error_message\` holds the provider's message, and a workflow can branch on the status.
- **Files:** a binary answer, such as a download or a PDF, is stored as a workflow file, up to 50 MB.
- **Paging:** list references return the provider's cursor. References whose provider returns a next-page URL have a \`next_link\` input: pass the link back to get the next page.
- **Tokens:** Microsoft, Google service-account, Box and refresh-token connectors get short-lived tokens when they run. A revoked OAuth authorization marks the connector **Reconnect**.
- **Regenerate references** updates the generated references in place and keeps their IDs. A generated reference that nobody has edited follows connector fixes automatically. References generated before November 2026 need one regeneration to get them.

## Catalog

The catalog below is generated from the connector registry.

::connectors
`,
  },
  {
    slug: 'integrations/e-signature',
    title: 'E-signature',
    description: 'DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, SignNow and BoldSign: send documents or templates for signature, wait for the signature, store the signed PDF.',
    tocDepth: 2,
    body: `
Six e-signature providers are connectors with the **same actions**, so a workflow looks the same whichever one a workspace uses. The provider's envelope, agreement, signature request or document is called an **envelope** here.

| Provider | Connector | Auth | Field placement | Embedded signing | Certificate | Webhooks verified by |
|---|---|---|---|---|---|---|
| DocuSign (eSignature REST v2.1) | \`docusign\` | Authorization Code (access + refresh token or **Connect**), JWT Grant | Anchor text (\`/sn1/\`) | Yes (recipient view) | Yes | Connect HMAC (\`X-DocuSign-Signature-1\`) |
| Adobe Acrobat Sign (REST v6) | \`adobe_sign\` | Integration key, OAuth (access + refresh token or **Connect**) | Text tags | Yes (signing URLs) | Audit report | Client ID echo + URL token |
| Dropbox Sign (API v3) | \`dropbox_sign\` | API key, OAuth | Text tags | Yes (needs an API app client ID) | In the signed PDF | Event hash (HMAC with the API key) |
| PandaDoc | \`pandadoc\` | API key, OAuth | Field tags | Yes (document session) | In the signed PDF | HMAC (\`?signature=\`) |
| SignNow | \`signnow\` | Service user (password grant), OAuth | Text tags → roles | Yes (embedded invites) | Signed PDF with history | HMAC (\`X-SignNow-Signature\`) |
| BoldSign | \`boldsign\` | API key | Text tags | Yes | Audit log | Timestamped HMAC (\`X-BoldSign-Signature\`) |

## Workflow steps

- **Send for Signature** (\`esign_send\`) — documents (form attachments, files from Word / PDF steps, \`storage://\` references or URLs; one or many) **or** a provider template. Recipients have a name, email, role, signing order, type (signer or copy) and, for DocuSign, an anchor text for the signature field. Subject, message, reminders and expiry where the provider supports them, **Embedded signing**, **text tags**, Dropbox Sign **test mode**, and an **Advanced** JSON object merged into the provider request. Providers that take one file per envelope (PandaDoc, SignNow) get the PDFs merged first. Output \`{{envelope.envelope_id}}\`, \`{{envelope.status}}\`, \`{{envelope.recipients}}\`.
- **Wait for Signature** (\`esign_wait\`) — pauses the run until the envelope is **completed**, **declined**, **voided** or **expired** (or the timeout passes, default 30 days), then continues with \`{{signature.outcome}}\`, the recipients (with \`signed_at\` and \`declined_reason\`) and — by default — the signed PDF stored as a workflow file in \`{{signature.signed_document}}\` (and \`{{signature.certificate}}\` with **Both**). Label its outgoing connections *Completed*, *Declined*, *Voided*, *Expired* or *Timeout* to branch; unlabelled connections always run. An envelope that is already final continues at once.
- **E-signature Envelope** (\`esign_envelope\`) — **Get status** (normalized envelope and per-recipient status), **Download signed document** (combined PDF, certificate / audit trail, or both, stored through the storage provider — Supabase Storage, S3, Azure, GCS or local disk), **Void / cancel**, **Embedded signing URL** for a "Sign now" link in a User Task (send with Embedded signing on; DocuSign links last 5 minutes) and **List templates**.
- **E-signature Event** trigger (\`esign_event\`) — starts a workflow when an envelope is sent, viewed, signed by a recipient, completed, declined, voided or expires; filter by connection and events. Variables: \`{{esign_event}}\`, \`{{esign_envelope_id}}\`, \`{{esign_status}}\`, \`{{esign_recipient}}\`, \`{{esign_envelope}}\`. It needs the provider's webhook (below).

In **Send for Signature → From a template**, the template picker searches the provider's templates and shows their roles; each recipient fills the role named in **Role**, and **Prefill** sets template fields (DocuSign text tabs, Acrobat Sign merge fields, Dropbox Sign custom fields, PandaDoc tokens, SignNow prefill texts, BoldSign form fields).

The same seven actions are connector references (\`send_documents\`, \`send_template\`, \`get_status\`, \`download_signed\`, \`cancel_envelope\`, \`signing_url\`, \`search_templates\`), so **Call API / Reference**, AI agents, MCP (\`references_execute\`), the REST API and the CLI can use them too:

\`\`\`bash
usertasks references execute <send_documents reference id> \\
  --set inputs:='{"documents":"storage://task-files/workflow-files/…/contract.pdf","subject":"Please sign","recipients":[{"name":"Ada Lovelace","email":"ada@example.com"}]}'
\`\`\`

## Safety and reliability

- **No duplicate envelopes.** Every send claims its **client reference** first (default: derived from the run, the step and the request; set your own in Advanced). A retried step gets the envelope it already sent (\`replayed: true\`) instead of sending a second one; the reference is also stored on the envelope (DocuSign custom field, Acrobat Sign external ID, metadata elsewhere).
- **Credentials** are encrypted at rest and never appear in step outputs, logs or call logs. Tokens are refreshed when they expire (DocuSign and SignNow authenticate the client with HTTP Basic; Acrobat Sign refreshes at \`/oauth/v2/refresh\`), and a 401 drops the cached token and retries once.
- **Rate limits and outages:** 429 answers are retried after \`Retry-After\`; 5xx answers to reads are retried with backoff. Errors carry the provider's message, a code (\`unauthorized\`, \`not_found\`, \`rate_limited\`, \`validation\`…) and whether a retry may help.
- **Egress:** every call passes the egress guard. **API base URL override** (sandboxes, regional hosts, a mock server) is still guarded.

## Webhooks

Each connection has its own webhook URL:

\`\`\`text
https://<your app>/api/webhooks/esign/<provider>/<integration id>
\`\`\`

with \`<provider>\` one of \`docusign\`, \`adobe-sign\`, \`dropbox-sign\`, \`pandadoc\`, \`signnow\`, \`boldsign\` (the Event trigger's settings show the full URL). The workspace and connection come from the URL, never from the payload; every delivery is verified with the connection's **Webhook secret** before it is read; a delivery seen before is acknowledged and ignored, and deliveries older than seven days (five minutes for BoldSign) are refused. Only the envelope ID is taken from the payload — its status is read back from the provider before a run resumes or a trigger fires.

Without webhooks, **Wait for Signature** polls the envelope (every 5 minutes by default; the \`esign-poll\` scheduler job). With a webhook secret set, polling is a 30-minute safety net.

## DocuSign

1. Create a developer account at [developers.docusign.com](https://developers.docusign.com) and an app in **Apps and Keys**: note the **integration key** and, for refresh tokens, add a **secret key**.
2. **Authorization Code Grant:** add the redirect URI \`https://<your app>/api/connectors/oauth/callback\`, scopes \`signature extended\`. Either paste an access token, refresh token, integration key and secret into the connector, or open the integration, choose **OAuth 2.0** (prefilled for the demo environment — use \`account.docusign.com\` URLs for production) and click **Connect**.
3. **JWT Grant** (unattended service integrations): add an RSA key pair to the app, choose **JWT Grant**, paste the integration key, the **user ID** (API username GUID) and the private key. The user grants consent once by opening \`https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=<integration key>&redirect_uri=<a registered redirect URI>\` (\`account.docusign.com\` in production).
4. **Environment:** *Demo* uses \`account-d.docusign.com\` and \`demo.docusign.net\`; *Production* uses \`account.docusign.com\` and your account's base URI. **Account base URI → Auto-detect** reads it from \`/oauth/userinfo\`; **Account ID** picks one account when the user has several (empty = the default).
5. **Webhooks:** Settings → **Connect** → Add configuration (Custom): URL = the webhook URL, data format **JSON (REST v2.1)**, events Envelope Sent / Delivered / Completed / Declined / Voided and Recipient Signed / Declined, **Include HMAC signature** on; paste the HMAC key into the connector's **Webhook secret**.
6. Anchor text: put e.g. \`/sn1/\` (in white text) where the signature goes and give the recipient that anchor.

## Adobe Acrobat Sign

1. Create a free developer account at [acrobat.adobe.com/developer](https://www.adobe.com/go/esign-developer). Note your **shard** (\`na1\`, \`na2\`, \`eu1\`, \`eu2\`, \`jp1\`, \`au1\`, \`in1\` …) from the account URL.
2. **Integration key:** Account → Acrobat Sign API → API Information → Integration key, with the scopes below; paste it as the token.
3. **OAuth:** Account → Acrobat Sign API → API Applications → create an application, **Configure OAuth**: redirect URI \`https://<your app>/api/connectors/oauth/callback\`, scopes \`user_read user_login agreement_read agreement_write agreement_send library_read webhook_read webhook_write webhook_retention\` (\`:account\` modifier). Paste the client ID, secret and refresh token, or use **Connect** (the authorize URL is \`https://secure.<shard>.adobesign.com/public/oauth/v2\`, tokens at \`https://api.<shard>.adobesign.com/oauth/v2/token\`, refresh at \`/oauth/v2/refresh\`).
4. The API access point is discovered with \`GET /api/rest/v6/baseUris\`.
5. **Webhooks:** register a webhook (Account → Webhooks or the API) for **AGREEMENT** events with the URL \`<webhook URL>?token=<webhook secret>\`. Acrobat Sign verifies the URL by sending your client ID in \`X-AdobeSign-ClientId\`; UserTasks echoes it back only when it matches the connector's **OAuth Client ID** and the token matches.
6. Field placement: Acrobat Sign text tags such as \`{{Sig_es_:signer1:signature}}\` in the document.

## Dropbox Sign

1. Create an account at [sign.dropbox.com](https://sign.dropbox.com); test mode is free on every plan. **Settings → API → API key**: paste it (it is sent as the HTTP Basic user name).
2. Leave **Test mode** on until your account has a paid API plan — test requests are watermarked and not legally binding.
3. **Embedded signing:** create an **API app**, add your domain, paste its **client ID**. The signing URL must be opened with the [hellosign-embedded](https://github.com/hellosign/hellosign-embedded) library on that domain.
4. **OAuth** (acting for other Dropbox Sign accounts): enable OAuth on the API app, callback \`https://<your app>/api/connectors/oauth/callback\`.
5. **Callbacks:** Settings → API → **Account callback** (or the API app's event callback) = the webhook URL. Callbacks are verified with the API key (\`event_hash\`); OAuth connectors put the app owner's API key into **Webhook secret**. UserTasks answers \`Hello API Event Received\`.
6. Text tags such as \`[sig|req|signer1]\` place fields.

## PandaDoc

1. **Settings → Integrations → API**: generate a **Sandbox** key for testing (watermarked, 10 requests/minute) and a **Production** key once API access is enabled. Paste it (sent as \`Authorization: API-Key …\`).
2. **OAuth:** create an application in the PandaDoc developer dashboard with redirect URI \`https://<your app>/api/connectors/oauth/callback\` and scope \`read+write\`.
3. **Webhooks:** Settings → Integrations → **Webhooks** → Create: URL = the webhook URL, events *Document state changed* and *Recipient completed*; copy the **shared key** into **Webhook secret**.
4. PandaDoc processes an uploaded file before it can be sent; the step waits up to 30 seconds for the draft and sends it. Field tags such as \`{signature:Client}\` place fields.
5. PandaDoc has no void: **Void / cancel** sets the document to *Voided*.

## SignNow

1. Create a developer sandbox at [signnow.com/developers](https://www.signnow.com/developers) (\`app-eval.signnow.com\`, API \`api-eval.signnow.com\`) and an **API application**: copy its client ID and client secret.
2. **Service user:** choose *Service user (password grant)* and enter the user's email and password; or **OAuth** with redirect URI \`https://<your app>/api/connectors/oauth/callback\`.
3. Set **Environment** to *Sandbox* while testing, *Production* afterwards; **Sender email** is the invites' "from" address (default: the signed-in user).
4. Text tags such as \`{{t:s;r:y;o:"Signer 1";}}\` create fields with roles; recipients are matched to roles by name, then by order. A document without roles can go to one signer (free-form invite).
5. **Events:** create event subscriptions (\`document.complete\`, \`document.fieldinvite.signed\`, \`document.fieldinvite.decline\`) with callback = the webhook URL and a **secret key**; paste the secret into **Webhook secret**.

## BoldSign

1. Create an account at [boldsign.com](https://boldsign.com); **API → API Key**: generate a sandbox key for testing (documents are not binding) and a live key for production. Choose **Region** EU for \`api-eu.boldsign.com\`.
2. **Webhooks:** API → **Webhooks** → Add: URL = the webhook URL, events Sent, Viewed, Signed, Completed, Declined, Revoked, Expired; copy the **signing secret** into **Webhook secret**. BoldSign's verification ping is answered automatically.
3. Text tags such as \`{{sign|1|*|Signer 1|sig1}}\` place fields.

## Database

Migration \`20261206000000_esign.sql\` adds \`esign_envelopes\` (the send ledger), \`esign_waits\` (paused runs and their next poll) and \`esign_events\` (delivery keys for replay protection), all service-role only, and the \`esign-poll\` probe key.
`,
  },
  {
    slug: 'integrations/openapi-import',
    title: 'OpenAPI and Postman import',
    description: 'Turn an OpenAPI 2/3 or Postman document into an integration with one reference per operation.',
    body: `
Import an API description instead of defining references by hand. UserTasks reads OpenAPI 2 (Swagger), OpenAPI 3 or a Postman collection (JSON or YAML), creates an integration from the first server URL and security scheme, and one reference per operation with typed inputs from its parameters and request body.

Send the document as the body:

\`\`\`bash
usertasks integrations import-openapi -f petstore.yaml
\`\`\`

Or wrap it to choose the name, base URL, auth and a subset of operations:

\`\`\`bash
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
    slug: 'integrations/windows-auth',
    title: 'Windows authentication (NTLM and Kerberos)',
    description: 'Call on-premises Windows services (SharePoint Server, IIS, Exchange, SSRS) with a service account over NTLMv2 or Kerberos, with channel binding, an internal CA and a proxy.',
    body: `
Integrations with \`auth_type: windows\` sign in to on-premises services that use Windows integrated authentication: SharePoint Server, IIS sites and web services, Reporting Services, Exchange. UserTasks uses a **service account**; there is no per-user delegation.

\`\`\`yaml title="sharepoint-onprem.yaml"
name: SharePoint (on-premises)
type: rest_api
config:
  base_url: https://sharepoint.contoso.com/sites/finance
  auth_type: windows
  auth_config:
    mode: negotiate              # negotiate (default) | ntlm | kerberos
    username: CONTOSO\\svc-usertasks   # or svc-usertasks@contoso.com
    password: \${env:SP_SERVICE_PASSWORD}
    # spn: HTTP/sharepoint.contoso.com   # Kerberos only; default HTTP/<base_url host>
    # ca_bundle: |                        # internal CA (PEM), added to the public roots
    #   -----BEGIN CERTIFICATE-----
    #   …
    # proxy_url: http://proxy.contoso.com:8080
\`\`\`

In the app, pick **Windows (NTLM / Kerberos)** under **Authentication** when you create or edit an integration. The password is encrypted at rest and write-only: the form never shows it (leave it blank to keep the stored one), and the API and exports return \`__SECRET__\`.

## Modes

| \`mode\` | What happens | Needs |
|---|---|---|
| \`negotiate\` (default) | Kerberos when a ticket can be had, otherwise NTLMv2, as Windows clients do | Nothing extra for NTLM; Kerberos as below |
| \`ntlm\` | NTLMv2 only | User and password |
| \`kerberos\` | Kerberos only; fails with an explanation when no ticket is available | The \`kerberos\` package and a keytab or ticket cache |

Only **NTLMv2** is spoken: LM and NTLMv1 are never sent, and a server that offers only those is refused. Each response carries the server's timestamp and a message integrity code (MIC), and over HTTPS a channel binding (below).

## How calls are made

- **Connection-bound.** NTLM authenticates a TCP connection, not a request, so the handshake runs on one keep-alive connection, which is then reused (no handshake per call). UserTasks keeps up to 4 authenticated connections per integration and re-authenticates when the server closes one or answers 401.
- **Bodies are sent once.** A POST or PUT starts the handshake with an empty body and sends the real body with the final step, so large uploads are not sent twice. Note that the first step is an empty request with the same method: a service that allows anonymous access would receive it.
- **Redirects.** Redirects within the integration's origin stay signed in; a redirect to any other origin is followed without credentials.
- **Safety rules still apply.** Every call goes through the egress guard, the timeout budget, retries and call logging like any other integration. On-premises hosts resolve to private addresses, so a self-hosted server lists them in \`EGRESS_PRIVATE_ALLOW\` (for example \`*.contoso.local\` or \`10.0.0.0/8\`; cloud metadata addresses stay blocked). A farm published only over \`http://\` also needs its host in \`EGRESS_HTTP_ALLOW\`; HTTPS with your internal CA (the **CA bundle** field) is recommended. The guard also checks the address actually dialled, and the proxy's.
- **Proxies and load balancers** between UserTasks and the server must keep connections end to end (NTLM fails if a request lands on a different back-end connection). With \`proxy_url\` set, UserTasks opens a CONNECT tunnel through the proxy for HTTP and HTTPS alike, so the proxy must allow CONNECT to the server's port. Proxy authentication is not supported.

## HTTPS, internal CAs and Extended Protection

- **Certificates are always verified.** For a server whose certificate comes from an internal CA, paste the CA certificate(s) as PEM in **CA certificates** (\`ca_bundle\`). They are trusted for this integration in addition to the public roots. There is no "allow self-signed" switch. Alternatively, trust the CA for the whole server with \`NODE_EXTRA_CA_CERTS\` (a per-integration bundle takes the place of \`NODE_EXTRA_CA_CERTS\` for that integration).
- **Extended Protection for Authentication (EPA).** Over HTTPS, the NTLM response is bound to the server's certificate (\`tls-server-end-point\` channel binding, as Windows clients send), so IIS sites with Extended Protection set to *Accept* or *Require* work. A TLS-inspecting proxy or load balancer in between breaks this binding when EPA is *Require*: terminate TLS on the server itself or set EPA to *Accept* there.
- **Plain HTTP** works on loopback only; integration base URLs must be HTTPS elsewhere.

## Kerberos (self-hosted)

Node.js has no Kerberos library built in. UserTasks loads the optional [\`kerberos\`](https://www.npmjs.com/package/kerberos) package (Apache-2.0, native) when it is installed on the server; it is **not** bundled, so the build and the hosted service never depend on it. Without it, \`negotiate\` uses NTLM and \`kerberos\` fails with instructions.

1. Install the system library (Debian / Ubuntu shown; on RHEL \`krb5-devel krb5-workstation\`), then the package in the UserTasks directory, and restart:

   \`\`\`bash
   sudo apt-get install -y libkrb5-dev krb5-user
   npm install kerberos
   \`\`\`

   In a Docker image, add both to your Dockerfile (the package compiles against MIT krb5).

2. Configure the realm in \`/etc/krb5.conf\` (\`default_realm\`, and \`kdc\` entries unless DNS SRV records are published).

3. Create a keytab for the service account (on a domain controller, or with \`ktutil\` from its password), copy it to the server, readable only by the UserTasks user, and point MIT krb5 at it:

   On Windows, as a domain admin:

   \`\`\`powershell
   ktpass /princ svc-usertasks@CONTOSO.COM /mapuser CONTOSO\\svc-usertasks /pass * /ptype KRB5_NT_PRINCIPAL /crypto AES256-SHA1 /out svc-usertasks.keytab
   \`\`\`

   On the UserTasks server, in its environment:

   \`\`\`bash
   export KRB5_CLIENT_KTNAME=/etc/usertasks/svc-usertasks.keytab
   \`\`\`

   MIT krb5 then gets and renews tickets on its own; nothing runs \`kinit\`. A ticket cache (\`KRB5CCNAME\`, filled by \`kinit\` or a sidecar) works too.

4. Use the account's **UPN** as \`username\` (\`svc-usertasks@contoso.com\`) so the right principal is picked when the keytab holds several; with \`DOMAIN\\user\` the keytab's default principal is used. The password is not used for Kerberos (keep it set for NTLM fallback in \`negotiate\` mode).

5. The target needs an SPN: \`HTTP/<host>\` registered on the account its application pool runs as (\`setspn -S HTTP/sharepoint.contoso.com CONTOSO\\sp-apppool\`). Set \`spn\` when the base URL host differs from the registered name (an alias or a load-balanced name).

Kerberos uses the hosts' clocks: keep the UserTasks server within 5 minutes of the domain controllers.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 401 on every call | Wrong user or password, the account is locked, or the site does not allow Windows authentication |
| "closed the connection during the Windows authentication handshake" | A proxy or load balancer without connection affinity, or \`Connection: close\` from the server |
| "does not offer Windows authentication" | The site only offers other schemes (Basic, forms): use those auth types instead |
| \`certificate\` errors | The server's CA is not trusted: add it to \`ca_bundle\` |
| 401 over HTTPS but not HTTP | Extended Protection with a TLS-terminating device in between (see above) |
| "Kerberos needs the optional kerberos package" / "could not get a service ticket" | Install the package; check \`KRB5_CLIENT_KTNAME\`, the SPN, the realm in \`krb5.conf\` and that the KDC is reachable on port 88 |
| "is not allowed: … private address" | Add the host or its network to \`EGRESS_PRIVATE_ALLOW\` on a self-hosted server (\`usertasks-admin egress allow-private\`) |
| "plain http:// is not allowed" | Use \`https://\`, or add the host to \`EGRESS_HTTP_ALLOW\` on a self-hosted server |
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
\`\`\`

This returns the webhook and its secret once — store it. Callers then POST to it:

\`\`\`bash
curl -X POST "$USERTASKS_URL/api/webhooks/inbound?hook=<slug>" \\
  -H "Authorization: Bearer <secret>" -H "Content-Type: application/json" -d @invoice.json
\`\`\`

Rotating issues a new secret; the old one stops working:

\`\`\`bash
usertasks webhooks rotate <webhook-id>
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
