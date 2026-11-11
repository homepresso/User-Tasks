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
    title: 'Inline workflow steps',
    description: 'Script activities written in the Extensibility editor: a JavaScript function with typed inputs and outputs, now run in the custom action sandbox. For new work, build a packaged custom workflow action.',
    body: `
An *inline* workflow step (a script activity) is a small JavaScript function with typed inputs and outputs, written in the **Extensibility → Workflow actions** editor or created with \`POST /api/v1/workflow-activities\`. Once active, it appears in the designer palette with a settings panel generated from its inputs.

> [!TIP]
> For anything new, build a **packaged** [custom workflow action](/docs/workflows/custom-actions): several functions per action, richer field types, capabilities for HTTP, data tables, files and secrets, a starter kit with a local test harness, signed and immutable versions — or install one of the [official actions](/docs/workflows/official-actions).

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

The function receives \`inputs\`, \`context\` (tenant, run, task, variables, node) and \`helpers\` (\`resolveExpression\`, \`getVariable\`, \`setVariable\`, \`log\`, \`uuid\`, \`now\`). Download the [starter template](/downloads/workflow-activity-template.zip) (code, manifest and README).

## Sandbox

Inline steps run in the same QuickJS WebAssembly sandbox as packaged actions, with the same [limits](/docs/workflows/custom-actions#limits) and [kill switches](/docs/workflows/custom-actions#kill-switches): no \`require\`, \`fetch\`, \`process.env\` or timers, and no capabilities. Code that needs an API or a secret belongs in a packaged action — see [Migrating legacy activities](/docs/workflows/custom-actions#migrating-legacy-activities). The old \`ENABLE_CUSTOM_ACTIVITY_CODE\` switch is no longer needed and is ignored; \`CUSTOM_ACTIONS_DISABLED=true\` turns all custom code off on a server.

## Lifecycle

Steps are \`draft\`, \`active\` or \`archived\` and carry a stable key and version. Export and import them as JSON (\`usertasks activities export|import\`) or move them with [config as code](/docs/config-as-code).

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

## Import from CSV or Excel

Fill a table straight from a file — for example a SharePoint list exported to CSV or Excel.

- **Import** on a table's page adds rows to that table.
- **Create from file** (in **New table**) makes a new table with columns inferred from the file, then imports its rows.

**Files and limits:** \`.csv\`, \`.tsv\` and \`.xlsx\`, up to 10 MB, 50,000 rows and 200 columns. CSV files may have a byte-order mark, quoted cells with line breaks, and comma, semicolon or tab delimiters (detected); text is read as UTF-8, UTF-16 or Windows-1252. For a workbook you pick the sheet. Older \`.xls\` files must be saved as \`.xlsx\` or CSV first.

**Columns.** File headers are matched to columns by name, ignoring case, spaces and underscores (\`Order No\`, \`order_no\` and \`ORDERNO\` all match). Change any match, skip a column, or create a new column from it (that needs \`data.edit_schema\`). The system **ID** and **Date Created** columns are filled by the table. When a table is created from a file, each column's type is inferred from its values:

| Values look like | Column type |
|---|---|
| \`1,234.50\`, \`$1,200.00\`, \`USD 35.50\`, \`(12.00)\` | Number (currency symbols are dropped) |
| \`2026-03-31\`, \`03/31/2026\`, \`31 Mar 2026\` | Date (stored as YYYY-MM-DD) |
| Dates with a time | Text (the original value) |
| \`yes\` / \`no\`, \`true\` / \`false\` | Yes / no |
| A few values that repeat | Choice (select, with those options) |
| Emails, URLs | Text |
| Long values or line breaks | Long text |

From 20 values on, a column keeps its type when up to 5% of its values don't fit (\`TBC\` in an amount column): those cells are reported as row errors instead of turning the whole column into text.

**Options.**

- **Mode:** *insert* adds every row; *upsert* updates the rows whose key column matches (cells not in the file are kept) and adds the rest; *replace* deletes every existing row first. Replace asks you to type the table name and is recorded in the audit log.
- **Dates:** the day / month order of dates like \`03/04/2026\` is detected from the values; override it when every date is ambiguous.
- **Trim whitespace** (on by default), and **empty cells**: clear the column, or leave it unchanged (useful with upsert).
- **Run workflows:** on by default, as for rows added through the API — created and updated rows fire **Data Table Event** workflows. Turn it off to load data without starting workflows. With *replace*, the deleted rows go through the deletion queue, which removes their stored files and, when workflows run, fires the \`deleted\` event.

**Validation before anything is written.** Every row is checked: numbers, dates, yes / no values, choices and required columns. Errors list the row number (the header is row 1), the column and the reason. Import the valid rows only, or cancel and fix the file; **Download error rows** gives you a CSV of the rows that failed.

**Importing.** Rows are written in batches of 500 by a background job, so a large file never times out; follow its progress in the Jobs panel. The summary shows rows **inserted**, **updated**, **skipped** and **failed** (failed rows are listed in a downloadable error report). Each import is audited.

Values are stored as plain text, numbers, dates and yes / no — a cell like \`=SUM(A1:A9)\` is kept as that text and never evaluated. Exported error reports prefix cells that start with \`=\`, \`+\`, \`-\` or \`@\` with \`'\` so a spreadsheet does not run them.

**API, CLI and MCP.** \`POST /api/v1/data-tables/{id}/rows/import\` takes the file as multipart \`file\` or as \`file_base64\` + \`file_name\`, with the same options (\`mapping\`, \`new_columns\`, \`mode\`, \`key_column\`, \`confirm_replace\`, \`date_order\`, \`trim\`, \`empty_cells\`, \`skip_invalid\`, \`fire_triggers\`, \`dry_run\`). Send \`dry_run=true\` first to see the mapping, counts and row errors. Above 5,000 rows add \`?async=true\` (or \`Prefer: respond-async\`) and follow the job (\`GET /api/v1/jobs/{id}\`).

\`\`\`bash
curl -X POST "$USERTASKS_URL/api/v1/data-tables/<table-id>/rows/import?async=true" \\
  -H "Authorization: Bearer $USERTASKS_API_KEY" \\
  -F file=@orders.csv -F mode=upsert -F key_column=order_no

usertasks rows import <table-id> --set file_name=orders.csv --set file_base64=@@orders.csv \\
  --set mode=upsert --set key_column=order_no
\`\`\`

The CLI waits for the job and prints the summary. MCP clients and the Agent use \`data_rows_import\`, which also accepts \`csv_text\` (for example data pasted into a chat); the Agent shows a preview of what will be imported and waits for your confirmation.

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

## Summary charts

A report can also have up to **8 summary charts**: a row of number cards and a grid of chart cards above its table (or main chart). Each one counts or totals the report's own rows — the same source, filters, joins and date range, and the same permissions — so "Total responses", "Responses over time" or "Average score by status" always agree with the table. In the builder, open **Charts**, pick a starting point (*Count of rows by day*, *by day of the week*, *by hour of the day*, a day × hour heatmap, *Count of rows by <column>*, *Average of <column>*), then change what it shows:

| Setting | Choices |
|---------|---------|
| **Chart** | number card, line, area, columns, bars, donut, pie, day × hour heatmap |
| **Show** | count of rows, or the total, average, lowest, highest or Net Promoter Score of a number column |
| **Split by** | a column's values (largest first, or the N largest with the rest as *Other*), or a date column grouped by day, week (from Monday), month, day of the week or hour of the day |
| **Only the last … days** | a rolling window on the date column |

Charts can be reordered and removed; one that no longer fits the report (a removed column) is flagged and left out. The numbers are worked out on the server from up to the newest 10,000 matching rows (the card says so when there are more) and only the chart values reach the browser. Days, weeks and hours are in **your time zone** (the browser's; the API uses \`?timezone=\`, else your profile's, else UTC). Every card has a **Table** button with the same numbers, and the cards print with the report (**Export → Print / PDF**).

\`\`\`json title="Summary charts in a report config"
{
  "charts": [
    { "id": "total", "title": "Total responses", "type": "number", "measure": { "fn": "count" } },
    { "id": "over_time", "title": "Responses over time", "type": "area",
      "dimension": { "field": "created_at", "bucket": "day" }, "measure": { "fn": "count" }, "range_days": 90 },
    { "id": "by_status", "title": "Average score by status", "type": "bar",
      "dimension": { "field": "data_status" }, "measure": { "fn": "avg", "field": "data_score" }, "top_n": 8 }
  ]
}
\`\`\`

\`POST /api/v1/reports/preview\` (\`usertasks reports preview\`) and MCP \`reports_preview\` return each chart's series (\`charts\`: \`value\` for number cards, \`points\` in display order, \`cells\` for a heatmap). Reports without \`charts\` are unchanged. Edit a saved report with **Edit** on its page: the builder opens it, and **Save** updates it (someone else's report is saved as your own copy).

## Sources

Built-in sources (generated from the report registry), plus one source per data table and per reference with outputs:

::report-sources

## Workflow variables

Pick **Workflow runs** as the source, then a **Workflow**: the report lists only that workflow's runs, and its variables become columns you can show, filter, sort, group by and aggregate (sum, average, min and max on number columns), chart and export:

| Column | What it is |
|--------|-----------|
| \`vars.<name>\` | a workflow input (start form field / user variable), a Set Variable, or a step's scalar output (\`score\`, \`total\`, \`outcome\`, \`<step>_status\`) |
| \`vars.task_data.<key>\` | a field of a User Task's form, as last submitted (attachments as \`<key>_count\`, a lookup's selected item as \`<key>_item.<field>\`) |
| \`vars.form.<key>\` | a field of the form that started the run (**Form submitted**), with \`vars.submitted_by_email\`, \`vars.submitted_at\`, \`vars.form_outcome\` |

Columns are typed (number, date, yes/no, text) from the workflow's definition — the draft and its recent published versions — and from the values stored on recent runs, so a variable a step sets dynamically appears too. Pickers group them by where they come from (Workflow inputs, a task's form, a step).

\`\`\`json title="Approved amount by region"
{
  "data_source": "workflow_runs",
  "source_inputs": { "workflow_id": "<workflow id>" },
  "columns": ["vars.region", "SUM_vars.task_data.approved_amount"],
  "filters": [{ "field": "vars.amount", "operator": "gt", "value": "100" }],
  "group_by": ["vars.region"],
  "aggregations": [{ "field": "vars.task_data.approved_amount", "fn": "SUM" }],
  "visualization": "bar"
}
\`\`\`

- **What is stored**: when a run completes, fails or pauses, the engine stores a bounded copy of its variables on the run (\`workflow_runs.variables\`). It leaves out engine keys (ids, who started it, steps' resume tokens), anything under a credential-like name (\`password\`, \`*_token\`, \`api_key\`, \`secret\`…) and secret-looking values, file contents and file lists (their counts are kept), nesting deeper than three levels, text beyond 500 characters and lists beyond 25 values; a run keeps at most about 32 KB. Runs that finished before this was added have no stored variables, so their variable columns are blank.
- **Who sees values**: variable columns need **View workflows** (\`workflows.view\`) as well as \`reports.view\` — the permission that opens a workflow's runs. Without it the builder doesn't offer them and the API refuses the report.
- **Tasks**: pick **Tasks** and a workflow to report on the tasks that workflow created; their form fields are \`fields.<key>\` columns.
- **Without a workflow**, \`vars.<name>\` columns still work across all your workflows' runs (untyped).
- **API, CLI and MCP**: \`GET /api/v1/reports/sources?workflow_id=<id>\` (\`usertasks reports sources --workflow-id <id>\`) and MCP \`reports_source_get\` with \`workflow_id\` list the columns; reports carry the workflow in \`source_inputs\`. OData's \`SavedReportResults\` includes the variable values of saved reports.
- A workflow's **process overview** (Reports → Workflows → a workflow) shows its first three inputs on each instance and links to a report on them.

## Access

Reports have owners and sharing (\`reports.share\`). Read them in the app, with \`GET /api/v1/reports/{id}\`, through MCP (\`reports_*\` tools — AI clients can build and run reports), or as OData collections (\`SavedReports\`, \`SavedReportResults\`).
`,
  },
  {
    slug: 'agents',
    title: 'AI agents',
    description: 'Optional, governed AI agents with instructions, granted tools, typed outputs, approvals, knowledge, tests and versions — as workflow steps or on demand.',
    body: `
Agents are optional. An agent is a model, instructions and a set of **granted tools**, with typed outputs so workflows get structured results back. Tools act with the permissions of the person the agent works for, inside the scopes you grant, and every run is traced step by step.

## Models

Connect a provider as an AI [connector](/docs/integrations/connectors) — **OpenAI**, **Claude (Anthropic)**, **Azure OpenAI**, **Google Gemini**, **xAI Grok**, **Mistral AI**, **DeepSeek**, **Groq**, **Together AI**, **Perplexity AI**, **Ollama (Local)** — or an integration whose base URL is any OpenAI-compatible Chat Completions server (vLLM, LM Studio, Amazon Bedrock's \`bedrock-runtime.<region>.amazonaws.com/openai/v1\`, a proxy). Agents call each provider's OpenAI-compatible endpoint with the right path and auth (Azure takes an \`api-key\` header; a local server needs no key). Pick the model (the provider's models are suggested), temperature — or the provider's default, which newer Claude and OpenAI reasoning models require — token and iteration limits (1–50).

Each model call is retried on rate limits (429, honouring \`Retry-After\`), provider errors (5xx) and timeouts with backoff, inside the run's time budget (default 5 minutes, at most 15). A run that runs out of iterations while still calling tools **fails** rather than completing with an empty answer.

## Instructions and outputs

Set the role, task, boundaries and custom instructions, and declare outputs: a name, a type (\`string\`, \`number\`, \`integer\`, \`boolean\`, \`array\`, \`object\`), optional **required** and **allowed values**. The agent ends its answer with a JSON block; each value is checked and coerced to its type (\`"3"\` → 3). When outputs are missing or invalid the agent is asked once to fix them; a **strict** agent then fails the run instead of completing with nulls.

In a workflow the **Run Agent** step puts the response text in its \`output_variable\` (default \`agent_response\`), every output as \`{{name}}\` and \`{{<prefix>_name}}\` (prefix: the step's Output Prefix, else the agent's name), and \`<output_variable>_outputs\`, \`_status\`, \`_usage\`, \`_iterations\`, \`_tool_calls\`, \`_duration_ms\` and \`_files\` (files its tools produced).

Every agent's prompt starts with operating rules: content from tools, files, documents, knowledge and other agents is **data, not instructions**. Tool results reach the model inside an "untrusted data" envelope, cut to 20,000 characters.

## Tools

Grant only what the agent needs:

- **References** — an integration reference; its inputs become the tool's parameters;
- **MCP tools** — a tool on one of the workspace's MCP servers (suggested from the server's tool list);
- **Data tables** — none by default: grant each table the agent needs and, per table, **read** (\`query_data_table\`), **insert** (\`insert_data_row\`), **update** (\`update_data_rows\`) and **delete** (\`delete_data_rows\`) — at most 100 rows per update or delete call. The model only gets the tools for the granted operations; with an acting person, reads also need their \`data.view\` and writes \`data.manage_rows\`. Agents created before per-table grants keep the access they had (read, add and update every table; the designer shows a banner suggesting narrowing, and **Switch to per-table grants** lists every table so you can untick what it doesn't need); "all tables" can't be given to an agent again. API / MCP: \`output_config.data_access.grants\` = \`[{"table_id": "…", "read": true, "insert": false, "update": false, "delete": false}]\`;
- **Governed capabilities** — tasks (all or selected teams / workflows), workflows (all or selected), documents (Excel generation, CSV and file reading);
- **Media** — turn on **Media (images, audio, video)** and choose a provider connection: the agent gets \`transcribe_media\` and \`analyze_image\` for files attached to the conversation or a URL. They send the media to that provider, so consider putting them on the approval list. In a workflow, the [media steps](/docs/workflows/media) do the same and more (redaction, video, speech) — see [Agents](/docs/workflows/media#agents);
- **Knowledge** — upload documents (PDF, Word, Excel, PowerPoint, text, Markdown, CSV, JSON, HTML, XML; up to 20 MB each) and pick data tables; the agent gets \`search_knowledge\` (ranked passages and rows, read-only) and \`read_knowledge_document\`;
- **Built-in tools**:

::agent-tools

References and MCP servers must belong to the agent's workspace. URL tools (\`http_get\`, \`http_post\`, downloads) go through the platform's egress guard on every redirect: private, loopback and cloud-metadata addresses are refused. **Outbound hosts** limits them to the hosts you list (\`api.example.com\`, \`*.example.org\`).

## Who the agent acts for

Task and workflow tools act with a person's permissions — the same ones the app checks (\`tasks.complete\`, \`workflows.activate\`, …), and for workflow tasks the assignee / manager-on-behalf rule:

- in the test console, REST, CLI and MCP: the signed-in person or the credential's user (a tenant API key has none);
- in a **Run Agent** step: the person who started the run (\`{{workflow_initiator_user_id}}\`) — nobody for schedules, webhooks and public forms — unless the step is set to act as the **workflow owner** or as nobody.

With nobody to act for, the agent keeps its own scope: it can read tasks and runs and use its data tables, but task and workflow **writes are refused**.

## Approvals

List tools that need a person's approval (or all except read-only built-ins), and a reviewer (a person or a team; default the agent's creator). When the model calls one, the run pauses (status \`awaiting_approval\`) and the reviewer gets a task with the tool and its arguments and the outcomes **Approve** / **Reject**. Completing it — in the app, \`POST /api/v1/tasks/{id}/action\` or MCP — continues the run on the agent queue: an approved call runs; a rejected one is reported to the model with the reviewer's note. A Run Agent step waits the whole time and resumes with the agent's variables.

## Limits, budgets and cost

Per agent: tokens per run and tool calls per run, and **budgets** per day (the last 24 hours) and per month (the calendar month, UTC) in tokens and in **cost** (a currency, default USD). Per workspace (**Agents → Costs & budgets**, \`settings.edit\` to change): the same four budgets over all its agents. A run is refused once a budget is spent. The agent's Settings tab shows the last 24 hours and this month against its budgets and tokens or cost per day; \`GET /api/v1/agents/{id}/usage\` (\`usertasks agents usage <id>\`, MCP \`agents_usage_get\`) and \`GET /api/v1/agents/usage\` for the workspace (\`usertasks agents workspace-usage\`, MCP \`agents_workspace_usage_get\`) return the same, with cost per currency.

**Cost** is computed when a run is recorded, from the model's price per 1M input, output, cached-input (cache read) and cache-write tokens, and stored with the price used — later price changes never rewrite past runs. The run page, its trace (per model call), the runs list and the usage charts show it; the in-app Agent's cost cap uses the same prices. Prices come from, first match wins:

1. the workspace's prices (Agents → Costs & budgets; \`PUT /api/v1/agents/cost-settings\`, MCP \`agents_cost_settings_update\`),
2. the instance's prices (Settings → Infrastructure → AI model prices, instance administrators; the \`instance.ai_model_prices\` instance setting),
3. the built-in price list: the current chat models of OpenAI (GPT-4o to GPT-5.6), Azure OpenAI (the OpenAI prices, matched on a deployment named after its model), Anthropic (Claude Fable 5.1 to Haiku 4.5, with cache reads and writes), xAI Grok 4.3 to 4.7, Google Gemini (2.5 to 4, including announced price rises from their date), Mistral, Groq, DeepSeek, Together AI, Perplexity Sonar and Amazon Bedrock Claude (global and geographic profiles). Each row names its source: the vendor's pricing page (OpenAI, Anthropic, xAI, Gemini) or the LiteLLM price list (the others), checked 2026-11-07.

Each price is per provider and model (or any provider) with the date it applies from. Dated model ids match their model (\`claude-haiku-4-5-20251001\`, \`gpt-4.1-2025-04-14\`, Bedrock's \`…-v1:0\`). The built-in prices are list prices only — no discounts, batch or priority tiers, long-context surcharges (noted per row where a vendor has one), per-request or search fees, or taxes; replace them with your contract prices. A model with no price — other Azure deployment names, local models, retired models — shows **cost unknown**, never a guessed or zero cost, and isn't counted in cost budgets (the usage view says how many runs that is); a provider that doesn't report token usage makes the run's cost unknown too.

### Fetch latest pricing

**Agents → Costs & budgets → Model prices → Fetch latest pricing** (\`settings.edit\`) downloads a maintained public price list on the server — by default the [LiteLLM model price list](https://github.com/BerriAI/litellm) (MIT), which covers OpenAI, Azure, Anthropic, xAI, Gemini, Mistral, Groq, DeepSeek, Together AI, Perplexity and Bedrock — and shows a preview per provider: new models, changed prices and how many are unchanged. Changed prices start selected, new models don't. **Save selected prices** stores them as this workspace's prices, with the source and the date; nothing changes before that. A price you entered or edited by hand is never replaced unless you tick it. Each update is in the audit log.

The download goes through the instance's egress guard, with a 20-second timeout and a 20 MB limit. Set the source with the \`instance.ai_price_feed_url\` instance setting or the \`AI_PRICE_FEED_URL\` environment variable — a mirror of the same JSON format for air-gapped installs — or \`off\` to turn the button off (prices are then entered by hand).

## Testing

- The **test console** (Test) is a multi-turn conversation with the saved agent: the reply **streams** token by token, tool calls show as they happen, then outputs, tokens, cost and a link to the trace; **Stop** cancels the run.
- **Tests**: cases with an input and expectations — phrases the answer must or must not contain, output values, tools it must call, and an optional **rubric**. Tools it must not call, a token ceiling and an expected status can be set through the API graded by the agent's own model. Running the suite uses the saved agent in evaluation mode: tools that change data or call out are **simulated**, approvals never wait, so a run changes nothing. Results show every check per case with a link to its trace (\`usertasks agents eval <id>\`, \`POST /api/v1/agents/{id}/evals/runs\`, MCP \`agents_eval_run\`).

## Versions

Every save is a new version (the **History** tab, \`GET /api/v1/agents/{id}/versions\`). Restoring one saves its settings as the newest version, so a restore can be undone — and a published workflow pinned to a version keeps running that version. Restoring a version from before per-table grants keeps the agent's current data grants rather than re-opening every table. Exports and packages carry each agent's version and data grants, and each published workflow's pins (\`published_agent_pins\`); an import pins again when the workflow is published.

## Running agents

- In a workflow with **Run Agent** — in the step (the run waits), or on the **agent queue** (the run pauses and resumes when the agent finishes; suited to long agents).
- On demand: \`usertasks agents execute <id> --set message="Classify INV-1042"\` (add \`--set async:=true\` to queue it; poll \`usertasks agents job <job-id>\`), \`POST /api/v1/agents/{id}/execute\` (\`"stream": true\` streams Server-Sent Events: the reply as \`delta\` events, then \`done\`), or MCP \`agents_execute\` (queued).
- **Published workflows** run the agent version pinned when they were published (see Run Agent); drafts and Save & Test run the latest.
- **Streaming**: the test console, Save & Test (on the Run Agent step) and REST \`stream\` show the reply as the model writes it. Providers are streamed through their OpenAI-compatible Server-Sent Events (OpenAI, Azure, Claude's and Gemini's OpenAI compatibility, Mistral, DeepSeek, Groq, Together, Perplexity, Ollama, Bedrock's OpenAI endpoint), with Anthropic Messages events understood too; tool-call arguments are assembled from their pieces. A provider, model or gateway that refuses streaming gets a normal request instead; an error mid-stream retries the call (the partial reply is discarded). Workflows on the server get the final result as before.
- **Who can read runs**: a run's input, output, trace and tool calls (and test-suite runs and queue jobs) need \`agents.view\` — except your own runs: those the agent acted for you or that you started. Others get "not found". A workflow run still shows a Run Agent step's output to people who can view the run, but not the agent's trace.
- **Trace**: every run records each model call (latency, tokens, retries, finish reason) and tool call (arguments and results with credentials redacted, latency, status, approval) — the run page's Trace tab, \`GET /api/v1/agents/runs/{id}\`. Runs emit \`agent.run.*\` events (status, model, tokens, duration — prompts, outputs and tool payloads are **not** in exported events).

Rate limits apply per workspace. Permissions: \`agents.view\`, \`agents.create\`, \`agents.edit\` (also tests and restore), \`agents.test\` (run, run tests), \`agents.delete\`. Agents, runs and the queue are written only by the server; members read agents, and runs as above.
`,
  },
]
