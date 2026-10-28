import type { DocPageDef } from '../types'

export const BUILDING_BLOCK_PAGES: DocPageDef[] = [
  {
    slug: 'decision-tables',
    title: 'Decision tables',
    description: 'Ordered, typed business rules that return consistent outputs to workflows, applications and AI clients.',
    body: `
A decision table turns business policy into data that analysts can read and change without touching workflows. It has typed **inputs**, typed **outputs** and an ordered list of **rules**. The first enabled rule whose conditions all match wins and returns its outputs.

::image decision-table | The decision table editor | An approval policy: amount and vendor risk in, approver level and auto-approve out.

## Inputs and outputs

Fields have a \`key\`, a \`label\` and a type: \`text\`, \`number\`, \`boolean\` or \`date\`. Values are converted to the input's type before rules are compared.

## Conditions

Each rule has conditions on inputs with one of these operators: \`equals\`, \`not_equals\`, \`contains\`, \`not_contains\`, \`starts_with\`, \`ends_with\`, \`greater_than\`, \`greater_than_or_equal\`, \`less_than\`, \`less_than_or_equal\`, \`is_empty\`, \`is_not_empty\`. A rule with no conditions always matches — put it last as the default.

| # | amount | risk | → approver | auto_approve |
|---|---|---|---|---|
| 1 | less than 1 000 | equals low | none | true |
| 2 | less than 10 000 | | manager | false |
| 3 | less than 50 000 | | director | false |
| 4 | (any) | | cfo | false |

## Using a decision table

- **Workflows** — the **Decision Table** node maps variables to inputs and sets \`matched\`, \`rule_label\` and each output. Tables are read once per run, so evaluating one inside a loop is cheap.
- **Test** — try inputs in the editor, or \`usertasks decision-tables test <id> --set values:='{"amount":4200,"risk":"low"}'\`.
- **API / MCP** — \`POST /api/v1/decision-tables/{id}/test\`, \`decision_tables_*\` tools.
- **Move between workspaces** — \`decision-tables export\` / \`import\`, or [config as code](/docs/config-as-code).

Evaluations are recorded (report source \`business_rule_executions\`), so you can report on which rules fire.
`,
  },
  {
    slug: 'email-templates',
    title: 'Email templates',
    description: 'Reusable, sanitised HTML emails with variables, used by Send Email nodes and task notifications.',
    body: `
An email template has a name, a **subject**, an **HTML body** and an optional plain-text body (generated from the HTML when omitted). Subject and bodies accept the same [expressions](/docs/workflows/expressions) as workflow settings. HTML is sanitised before it is stored and rendered.

::image email-template | The email template editor with a live preview | Template editor with preview.

\`\`\`bash
usertasks email-templates create --set name="Invoice approved" \\
  --set subject="Invoice {{invoice_number}} approved" --set html_body=@approved.html
usertasks email-templates preview <id> --set variables:='{"invoice_number":"INV-1042"}'
\`\`\`

## Where templates are used

- **Send Email** nodes: pick a template with \`email_template_id\`; recipients, sender and reply-to stay on the node.
- **User Task notifications**: \`notification_template_id\` on the User Task node, or the workspace default (\`is_default\`).

Sending needs an email provider: set \`RESEND_API_KEY\` and \`EMAIL_FROM\` when self-hosting.
`,
  },
  {
    slug: 'custom-steps',
    title: 'Custom workflow steps',
    description: 'Package your own JavaScript as a typed workflow node with inputs, outputs, logging and versioning.',
    body: `
A custom workflow step (an *activity*) is a small JavaScript function with a typed manifest. Once active, it appears in the designer palette next to the built-in nodes, with a settings panel generated from its inputs.

::image custom-step | A custom workflow step with its manifest | A custom step: typed inputs and outputs, code, and a preview run.

## The contract

\`\`\`json title="manifest.json"
{
  "inputs": [
    { "name": "score", "label": "Score", "type": "number", "required": true },
    { "name": "customer_name", "label": "Customer name", "type": "string" }
  ],
  "outputs": [
    { "name": "score_band", "label": "Score band", "type": "string" },
    { "name": "evaluated_at", "label": "Evaluated at", "type": "string" }
  ]
}
\`\`\`

\`\`\`js title="workflow-activity.js"
async function run(inputs, context, helpers) {
  const score = Number(inputs.score ?? 0)
  const band = score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red'
  helpers.log('Scored', { score, band, runId: context.runId })
  return { outputs: { score_band: band, evaluated_at: helpers.now() } }
}
module.exports = run
\`\`\`

Download the [starter template](/downloads/workflow-activity-template.zip) (code, manifest and README).

## Lifecycle

Steps are \`draft\`, \`active\` or \`archived\` and carry a stable key and version. Export and import them as JSON (\`usertasks activities export|import\`) or move them with [config as code](/docs/config-as-code).

> [!WARNING]
> Custom step code runs **in the app process, without a sandbox**. It only executes when the server sets \`ENABLE_CUSTOM_ACTIVITY_CODE=true\`; leave it off unless every author is trusted.

Permissions: \`extensibility.view\`, \`extensibility.create\`, \`extensibility.edit\`, \`extensibility.delete\`.
`,
  },
  {
    slug: 'data-tables',
    title: 'Data tables and objects',
    description: 'Typed tables inside UserTasks with row events, workflow access, reports and an OData endpoint — plus business objects that span tables and APIs.',
    body: `
Data tables hold the reference data and records your processes need — vendors, cost centres, case records — without another database.

::image data-table | A data table with typed columns | The Vendors table.

## Columns

Column types: \`text\`, \`longtext\`, \`number\`, \`date\`, \`boolean\`, \`select\` (with options), \`file\` and \`lookup\` (a reference to a row in another table).

\`\`\`bash
usertasks tables create -f vendors.yaml
usertasks rows upsert <table-id> --set data:='{"vendor_id":"V-311","name":"Acme Paper","risk":"low"}'
usertasks rows list <table-id> --all -o json
\`\`\`

## Using tables

- **Workflows** — the **Data** node inserts, gets, updates, deletes and lists rows; **Data Table Event** triggers start a run when rows change (\`row\`, \`row_id\` and one variable per column).
- **Agents** — built-in tools query, insert and update rows of tables the agent may use.
- **Reports** — every table is a report source.
- **OData** — \`/api/odata\` exposes tables (and saved reports) as an OData service with \`$metadata\`, \`$filter\`, \`$select\`, \`$orderby\`, \`$top\` and \`$skip\`, so Excel, Power BI and other OData clients can read them with an API key.
- **Retention** — tables and individual rows can carry retention policies (see [Audit, retention and deletion](/docs/governance/audit-and-retention)).

API keys can be limited to specific tables (\`table_ids\`).

## Business objects

An **object** combines a primary source (a data table or a reference) with joined sources into one business entity — for example a Vendor that joins your Vendors table with live risk data from an API. Objects generate a reference that workflows, agents and reports use like any other (\`usertasks objects …\`).
`,
  },
  {
    slug: 'reports',
    title: 'Reports',
    description: 'Saved queries and charts over tasks, runs, rules, integrations and your data — in the app, the API, MCP and OData.',
    body: `
A report picks a **source**, columns, filters, joins, grouping and aggregates, and a visualization: \`table\`, \`bar\`, \`horizontal-bar\`, \`stacked-bar\`, \`line\`, \`area\`, \`pie\`, \`radar\`, \`scatter\` or \`funnel\`.

::image reports | A report with a chart | A saved report over workflow runs.

\`\`\`json title="A grouped report"
{
  "name": "Runs by status",
  "data_source": "workflow_runs",
  "columns": ["status", "COUNT_id"],
  "group_by": ["status"],
  "aggregations": [{ "field": "id", "fn": "COUNT" }],
  "visualization": "bar"
}
\`\`\`

\`\`\`bash
usertasks reports create -f runs-by-status.json
usertasks reports preview -f runs-by-status.json   # run a definition without saving it
usertasks reports export <id> > report.json      # portable definition
\`\`\`

Aggregations run in the database, and exports are produced on the server, so large reports stay fast.

## Sources

Built-in sources (generated from the report registry), plus one source per data table and per reference with outputs:

::report-sources

## Access

Reports have owners and sharing (\`reports.share\`). Read them in the app, with \`GET /api/v1/reports/{id}\`, through MCP (\`reports_*\` tools — AI clients can build and run reports), or as OData collections (\`SavedReports\`, \`SavedReportResults\`).
`,
  },
  {
    slug: 'agents',
    title: 'AI agents',
    description: 'Optional, governed AI agents with instructions, granted tools and structured outputs — as workflow steps or on demand.',
    body: `
Agents are optional. An agent is a model, instructions and a set of **granted tools**, with an output schema so workflows get structured results back. Nothing an agent does bypasses permissions: tools run with the agent's credentials and every run is traced.

## Models

Agents use any **OpenAI-compatible** chat-completions endpoint with tool calling — OpenAI, Azure OpenAI, Groq, Together, Ollama, or an Anthropic-compatible proxy. Connect the provider as an AI [connector](/docs/integrations/connectors) and choose the model, temperature, token and iteration limits.

## Instructions and outputs

Set the system prompt (or role, task and boundaries) and declare outputs. The agent's final answer is parsed into those outputs, which the **Run Agent** node writes to \`output_variable\`.

## Tools

Grant only what the agent needs:

- **References** — any integration reference, with its input schema;
- **Workflows** — start a workflow;
- **MCP servers** — tools from external MCP servers you register;
- **Built-in tools**:

::agent-tools

## Running agents

- In a workflow with **Run Agent**.
- On demand: \`usertasks agents execute <id> --set message="Classify INV-1042"\` (add \`--set async:=true\` to queue it), \`POST /api/v1/agents/{id}/execute\`, or MCP.
- Runs, steps, tool calls, token counts and errors are recorded and emitted as \`agent.run.*\` events. Prompts and model outputs are **not** included in exported events.

Rate limits apply per workspace. Permissions: \`agents.view\`, \`agents.create\`, \`agents.edit\`, \`agents.test\`, \`agents.delete\`.
`,
  },
]
