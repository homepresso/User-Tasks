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

## The editor

**Automations → Email templates → New email template** (or a template's **Edit**) opens a full-screen editor: the editor on the left, a live preview on the right.

- **HTML** — a code editor with syntax highlighting, line numbers, auto-closing tags, find and replace (⌘F / Ctrl+F), **Format**, and problems underlined as you type: unclosed or stray tags, markup common email clients drop (flexbox, grid, external stylesheets, scripts, forms, video, SVG), unknown variables and images without alt text. Type \`{{\` for variable suggestions.
- **Design** — build the email from blocks: header / logo, heading, text (bold, italic, underline, links, lists), button, image, two columns, divider, spacer and footer, with accent, background and text colours and the content width. Blocks produce email-safe HTML (table layout, inline styles, a button that works in Outlook, columns that stack on phones). The design is kept inside the HTML: once you edit the HTML by hand beyond what blocks can show, the Design tab becomes read-only and the HTML is what is saved (you can restore the last design or start a new one).
- **Plain text** — the text part, with **Generate from HTML** (headings, paragraphs, lists, links as "text (url)"). Left blank, it is generated when you save. User Task notifications use it.
- **Preview** — updates as you type, in a sandboxed frame (no scripts, no requests except images, which you can block). Switch **Desktop / Mobile**, **Light / Dark** (dark mode is simulated: the template's \`prefers-color-scheme: dark\` rules apply, or the colours are inverted the way Gmail and Outlook apps do), zoom, and show the inbox **subject and preheader**. Sample data comes from built-in examples or the fields of a form you pick.
- **Subject and preheader** sit above the editor; the preheader is the hidden inbox preview text.
- **Starters** — notification, approval request, digest and welcome templates, branded with your workspace's logo, accent colour and name.
- **Send test** — sends the current draft, with the preview's sample values, to your own address only (subject starts with *[Test]*). Needs workflow create or edit permission; limited to a few per 10 minutes; recorded in the activity log. If email is not set up — or the provider refuses, for example because the sending domain is not verified yet — the editor says why in plain words, with the provider's own message.
- **Save** (⌘S / Ctrl+S) — \`<style>\` rules are inlined onto the elements (turn this off under Settings); dark-mode and responsive \`@media\` rules stay in \`<style>\`. The editor warns before you close with unsaved changes. The size check warns when the HTML nears Gmail's 102 KB clipping limit.

## Variables

The **Variables** panel lists what a template can use; click one to insert it at the cursor (HTML, Design text, subject or plain text) or drag it into the editor.

| Group | Examples | Filled by |
|-------|----------|-----------|
| Task | \`{{user_task_title}}\`, \`{{user_task_description_html}}\`, \`{{outcome}}\` | the engine |
| Workflow | \`{{workflow_name}}\`, \`{{run_id}}\`, \`{{_title}}\` | the engine |
| Form | \`{{form_name}}\`, \`{{submitted_at}}\`, \`{{form.<field>}}\` | the run |
| Person | \`{{submitted_by_name}}\`, \`{{completed_by_email}}\` | the engine |
| Links | \`{{task_url}}\` (the task in UserTasks), \`{{app_url}}\` | the engine |
| Workspace | \`{{current_year}}\` | the engine |

Anything else — \`{{customer_name}}\`, \`{{amount}}\` — is the template's **own variable**. The editor flags undeclared ones; give each a label, type, sample value, description and *required* flag under **This template** (saved with the template). Workflows see every variable the template uses — the names are detected from the subject, HTML and text — with these details.

## Using a template in a workflow

- **Send Email** step: choose the template; recipients, sender and reply-to stay on the step.
- **User Task** step: **Assignment notification template** uses the template's subject and plain-text body for the in-app notification.

When a step uses a template, its variables appear in the step's settings as a **mapping table**: each of the template's own variables gets a value or expression from the data picker (form fields, task values, workflow variables, earlier steps' outputs, system values). Variables are **auto-mapped** to a same-named form field or variable when there is one. Built-in variables show as *filled automatically*. **Preview** renders the email with the mapped values.

- A variable the template marks **required** must be mapped before the workflow can be published.
- An unmapped variable reads a run value of the same name, as before (existing workflows keep working); the designer warns when nothing before the step sets it.

\`\`\`json
{ "type": "send_email", "config": {
  "to": "{{form.manager_email}}",
  "email_template_id": "<template id>",
  "template_variables": { "request_title": "{{form.title}}", "amount": "{{form.amount}}" }
} }
\`\`\`

A User Task maps its notification template with \`notification_template_variables\`.

\`\`\`bash
usertasks email-templates create --set name="Invoice approved" \\
  --set subject="Invoice {{invoice_number}} approved" --set html_body=@approved.html
usertasks email-templates preview <id> --set variables:='{"invoice_number":"INV-1042","amount":"$2,400.00"}'
\`\`\`

The API and CLI take and return \`variables\` (the declarations) on email templates. Templates are also a [config as code](/docs/config-as-code) asset.

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

## Views, cell controls and inline editing

The **Rows** tab shows a **view** of the table. **View settings** (needs Edit schema) lists the table's views — add, duplicate, rename, delete, pick the one the grid opens on — and, per view:

- **Columns** — which columns show and in what order, each column's header and width, and its **control**: text, multi-line text, number, currency, date, date & time, yes / no (checkbox or switch), dropdown, autocomplete, multi-select, people picker, lookup, signature pad, file, link, rich text, or a calculated / read-only display (an optional formula such as \`quantity * unit_price\`). The control is inferred from the column type until you pick another.
- **Options from a data table or an API** — a dropdown, autocomplete, multi-select or lookup can list a fixed set of choices or be **bound** to another data table or an API reference: filter (values may read the same row with \`{{row.<column>}}\`, so a Region dropdown can depend on the Country cell), sort, the column stored as the value (the id) and what people see (display columns or a template such as \`{{name}} ({{city}})\`). Autocompletes search on the server as people type; options are cached per binding (an API reference's cache time applies). Choose **A data table or API**, then **An API**: pick or create the API, **Test** it, and drag a field badge onto **What people see** and **What is stored** (the same steps as a form's Data table — see [Get rows from an API](/docs/tasks/forms#get-rows-from-an-api-step-by-step)).
- **Read-only / required** per column.
- **Allow inline editing (all rows)** — cells of editable columns edit in place: Enter, F2 or a double click starts editing; arrows move between cells; Tab and Enter save and move on; Escape cancels. Each cell saves on its own with an instant update that is rolled back if the server refuses it. If someone else changed the row since you opened it, your edit is not saved and the grid shows the latest values with a message. Also **Add rows**, **Delete rows** and **Rows per page**.

### Edit all rows at once

When a view allows inline editing, **Edit all** (or **Shift+E**) turns every row on the page into editable cells at once — like a spreadsheet — and you save them together:

1. Press **Edit all**. Editable cells show as fields; read-only, calculated and system columns stay flat with a lock. A bar above the rows shows **12 rows changed**, **Undo**, **Cancel** and **Save**.
2. Type straight into a cell (or press Enter / F2, or click it). **Tab** / **Shift+Tab** move across, **Enter** moves down, **arrows** move between cells, **Esc** puts a cell back. Each cell uses its column's control: currency, date, dropdown, a bound autocomplete, yes / no, people…
3. **Paste a block** copied from Excel or Google Sheets: it fills the cells from the focused one. Values are converted for each column (\`$1,234.50\` → 1234.5, \`11/30/2026\` → a date in your locale's order, TRUE / Yes → yes); a value that doesn't fit is marked on its cell and not pasted. **Ctrl/⌘+D** fills down, **Ctrl/⌘+Z** undoes, **Ctrl/⌘+C** copies the selected cells (Shift+arrows select). When the view allows adding rows, **Add row** adds one at the bottom, and a paste that runs past the last row adds rows.
4. **Save** (or **Ctrl/⌘+S**) sends all changed rows in one batch. The server checks every row as it checks a single edit. Rows that saved are done, and the ones it refused keep your edits with the reason on the cell, so you fix them and save again. If someone else changed a row since you started, the row shows **Keep mine** (your edits overwrite theirs on the next save) or **Take theirs**.

Changed cells are highlighted until saved. Your edits stay when you change page, so you can edit several pages and save once. Leaving the page with unsaved changes asks first. **Always open in edit mode** (View settings) opens the view in this mode. Each saved row fires the table's **updated** workflows once, exactly as a single edit does. Rows you didn't change, and rows that were refused, fire nothing. The batch is also available as \`PATCH /api/v1/data-tables/{id}/rows/cells\`, the MCP tool \`data_rows_write_cells_batch\` and \`usertasks rows cells-batch\`.

The server enforces the view: inline writes need the Manage rows permission, inline editing turned on and an editable column — read-only, hidden and calculated columns are refused even if a client sends them; values must fit the control, bound values must be options of their source, people must be in the workspace, and a new signature is stamped with who signed and when. Rows load a page at a time; long pages are drawn as you scroll.

The same column engine powers the **Data table** control on forms: in the form designer each column gets a **Cell control** (signature pad, dropdown bound to a table, autocomplete bound to an API reference, …) and **Allow inline editing (all rows)** turns on editing; edits are part of the form's value and written back by the form's rules on submit.

**API, CLI and MCP.** \`GET\` / \`PUT /api/v1/data-tables/{id}/views\` (\`usertasks tables views\` / \`tables set-views\`, MCP \`data_views_get\` / \`data_views_update\`); inline cell writes \`PATCH /api/v1/data-tables/{id}/rows/{rowId}/cells\` with \`view_id\`, \`cells\` and optionally \`expected_updated_at\` (409 when the row changed; \`usertasks rows cells\`, MCP \`data_rows_write_cells\`); a bound column's options \`POST /api/v1/data-tables/{id}/views/{viewId}/options\` (\`usertasks tables options\`, MCP \`data_views_options\`).

## Group rows

Group the grid's rows by a column to see them in sections, for example orders by **Status** and then by **Region**:

1. In the **Rows** toolbar pick **Group by** and a column. A second picker, **Then by**, adds a second level. Text, number, date, yes / no, choice and lookup columns can be grouped.
2. Each group header shows the value, the number of rows and the totals of the view's number and currency columns (for example **Amount: $12,480.00**). Rows with a blank cell are in the **(empty)** group.
3. Click a header to open or close the group. **Expand all** opens up to 50 groups at once and **Collapse all** closes them. A large group shows its first rows with **Show more**.

Groups are counted on the server over **every row that matches the search**, not only the rows on screen, so the counts and totals hold for the whole table. Sorting by the grouping column reverses the order of the groups, and any other sort orders the rows inside each group. Inline editing and **Edit all** work inside open groups. If you change the grouping column of a row, it moves to its new group when you save.

The grouping you pick applies straight away for you. To keep it, press **Save to view** (needs Edit schema), or set **Group rows by** / **Then by** in **View settings**. Which groups are open is remembered per person and view in your browser.

## Child records

A row can show related rows from another table underneath it, expandable in the grid, such as the order lines under each order.

1. In the child table, add a **Lookup** column whose source is the parent table. For example, **Order lines** gets an **Order** column that looks up **Orders** → **Order No**.
2. In the parent table's **Schema** tab, under **Child records**, press **Add child records** and pick the child table and the lookup column (**Order lines**, *linked by Order*). Give it an optional label, then **Save child records**. A table can have up to five relations.
3. In the **Rows** grid, each row now has an expander with its number of child rows. Expanding it loads the child rows inline, with the child table's own columns. You can edit a cell in place (double-click, or Enter), and **Add child** adds a row to the child table that is already linked to this row.

**Hierarchies.** Pick the table itself as the child table to nest rows under rows. For example, a **Tasks** table with a **Parent** lookup to Tasks → Title shows each task's sub-tasks, and their sub-tasks below them, indented. Tick **Only list top-level rows** to list only rows without a parent at the top of the grid. A row whose parent no longer exists still shows there. Rows that point at each other in a loop (A's parent is B and B's parent is A) don't appear at the top level, so clear one of the two parents to list them again. A row that is already shown higher up the same branch is not repeated (a loop is marked with ↺), and nesting stops after six levels.

A child belongs to a parent when its lookup cell holds the parent's value of the lookup's source column. Child rows are read with your own access, as any other read, and they load only when you expand a row. Which rows are expanded is remembered per person and view in your browser.

**API, CLI and MCP.**

- \`GET /api/v1/data-tables/{id}/rows/groups?group_by=status,region&sum=amount\` (also \`search\`, \`filters\` and \`group_order\`) returns the groups with their counts, totals and second-level groups. From the CLI it's \`usertasks rows groups <table-id> --group-by status\`, and over MCP it's \`data_rows_groups\`. To read a group's rows, call \`GET …/rows\` with an \`equals\` filter, or \`is_empty\` for the empty group.
- \`GET /api/v1/data-tables/{id}/rows/{rowId}/children?relation=<relation-id>\` returns the child rows with \`link_value\`, the value a new child stores in \`lookup_column\`. Without \`relation\` it returns the child count per relation. From the CLI it's \`usertasks rows children\`, and over MCP it's \`data_rows_children\`.
- Relations are saved as \`child_relations\` on \`PATCH /api/v1/data-tables/{id}\` (and MCP \`data_tables_update_schema\`), and a view's grouping as \`group_by\` on \`PUT …/views\`.

\`\`\`bash
usertasks rows groups <table-id> --group-by status,region --sum amount -o json
\`\`\`

Exact group counts need database migration \`20270119090000_data_table_grouping\`. Until it is applied, the grid counts groups from the newest 2,000 rows (and says so), and child records can't be saved.

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
usertasks reports preview -f runs-by-status.json
usertasks reports export <id> > report.json
\`\`\`

\`reports preview\` runs a definition without saving it; \`reports export\` writes a portable definition.

Aggregations run in the database, and exports are produced on the server, so large reports stay fast.

The workflow reports (hub, process overview, compare), app dashboard widgets and extension page stats read **per-day rollup tables** kept current as runs, tasks and submissions change — or real-time queries, per service, in **Settings → Query** ([Query settings](/docs/self-hosting/query-settings)). Counts are exact; percentiles are within 9.1%.

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

### Agents & AI usage

The **Agents & AI usage** source has one row per AI call of the workspace: every agent run (workflow Run Agent steps, the API, MCP, tests, apps) and every request of the in-product Agent, **PDF import AI assist** and **Redact Document** AI detection. Columns: when (\`occurred_at\`, plus \`day\`, \`week\` and \`month\` to group by), source, provider, model, agent, Agent profile, help group, workflow and workflow run, status, outcome (\`success\` / \`error\` / \`pending\`), error, \`error_percent\` (average it for an error rate), calls, model calls, input / output / cached / total tokens, cost, currency, **cost status** and duration (agent runs). Cost is the cost stored with the call (the price when it was made); a call recorded without one is costed at today's price when its model has one — cost status \`estimated\` — else it stays \`unknown\`.

It needs **View agents** (\`agents.view\`), like Agents → Costs & budgets. The person and team columns need **Manage the Agent** (\`assistants.manage\`); a report that uses them fails for anyone without it, even when shared. A report reads the newest 10,000 agent runs and 10,000 Agent requests; a date range or an \`occurred_at\` filter narrows what is read. Sums add amounts as they are — keep to one currency (filter on \`cost_currency\`) when prices use several.

**Reports → AI usage reports** offers ready-made reports — *AI spend by model*, *AI spend by profile*, *Agent usage over time*, *Top agents by cost*, *Token usage by source*, *AI errors* and *Cost per workflow run for AI steps* — each with summary charts. **Add report** saves one as your own report: edit it, share it, export it or show it in an app's report widget like any other. MCP \`reports_source_get\` lists the same configs as recipes.

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

Connect a provider as an AI [connector](/docs/integrations/connectors) — **OpenAI**, **Claude (Anthropic)**, **Azure OpenAI**, **Google Gemini**, **xAI Grok**, **Mistral AI**, **DeepSeek**, **Groq**, **Together AI**, **Baseten**, **Perplexity AI**, **Ollama (Local)** — or an integration whose base URL is any OpenAI-compatible Chat Completions server (vLLM, LM Studio, Amazon Bedrock's \`bedrock-runtime.<region>.amazonaws.com/openai/v1\`, a proxy). Agents call each provider's OpenAI-compatible endpoint with the right path and auth (Azure takes an \`api-key\` header; a local server needs no key). Pick the model (the provider's models are suggested), temperature — or the provider's default, which newer Claude and OpenAI reasoning models require — token and iteration limits (1–50).

**Baseten** connects either to **Model APIs** (Baseten-hosted open models such as DeepSeek, Kimi, GLM and GPT OSS at \`https://inference.baseten.co/v1\`: pick a model from the list or type any slug) or to a **dedicated deployment** of your own model (paste its deployment URL or model ID; UserTasks uses its OpenAI-compatible \`…/sync/v1\` route, and you enter the model name it serves). A dedicated deployment can also run on Baseten Self-hosted, in your own cloud account and VPC. Baseten is a cloud service, so it is not available on air-gapped installs. You use your own Baseten account and API key, and Baseten bills that usage to you. The key is stored encrypted and is never shown again or logged.

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
3. the built-in price list: the current chat models of OpenAI (GPT-4o to GPT-5.6), Azure OpenAI (the OpenAI prices, matched on a deployment named after its model), Anthropic (Claude Fable 5.1 to Haiku 4.5, with cache reads and writes), xAI Grok 4.3 to 4.7, Google Gemini (2.5 to 4, including announced price rises from their date), Mistral, Groq, DeepSeek, Together AI, Baseten Model APIs (with cached input), Perplexity Sonar and Amazon Bedrock Claude (global and geographic profiles). Each row names its source: the vendor's pricing page (OpenAI, Anthropic, xAI, Gemini, Baseten, checked 2026-11-21) or the LiteLLM price list (the others), checked 2026-11-07.

Each price is per provider and model (or any provider) with the date it applies from. Dated model ids match their model (\`claude-haiku-4-5-20251001\`, \`gpt-4.1-2025-04-14\`, Bedrock's \`…-v1:0\`). The built-in prices are list prices only — no discounts, batch or priority tiers, long-context surcharges (noted per row where a vendor has one), per-request or search fees, or taxes; replace them with your contract prices. A model with no price — other Azure deployment names, local models, Baseten dedicated deployments (billed per GPU minute, not per token), retired models — shows **cost unknown**, never a guessed or zero cost, and isn't counted in cost budgets (the usage view says how many runs that is); a provider that doesn't report token usage makes the run's cost unknown too.

### Cost breakdowns

**Agents → Costs & budgets → AI cost breakdown** shows every AI call of the workspace for a period — the last 7, 30 or 90 days, this month, last month or a custom range (UTC days, at most 366) — not only agent runs: the in-product Agent, PDF import AI assist and Redact Document AI detection too.

- **Totals**: cost (in the workspace budget currency, USD by default), calls, input / output / cached tokens and calls whose cost is unknown.
- **Charts**: cost per day stacked by model or by Agent profile, and each model's share of cost.
- **Tables** (sortable): **by model** (provider, calls, tokens, cost, share, cost per 1,000 tokens and a trend line; a model without a price says *cost unknown — add a price*, which adds a row for it to this workspace's prices), **by profile** (the Agent profile that chose the model, or *Default*, with the models used, calls per help group and the profile's monthly cap), **by source** (in-product Agent, workflow agents, other agent runs, PDF import, redaction AI), **by agent**, and **by person** for admins of the Agent (\`assistants.manage\`) only.
- Click a row or a chart mark to filter the whole breakdown by it (click again to remove it); **Export CSV** downloads the table shown.

Each call counts the cost stored when it was made. A call recorded without a cost (its model had no price then) is costed at today's price when there is one now and marked *estimated*; one with no price at all stays *cost unknown* — never guessed. The workspace budgets still count agent runs only; the in-product Agent has its own monthly cap (Settings → Agent; per profile in Settings → Agent → Profiles).

\`GET /api/v1/agents/usage\` (\`usertasks agents workspace-usage\`, MCP \`agents_workspace_usage_get\`) returns the same as \`breakdown\` with any of: \`group_by\` (comma-separated \`day\`, \`agent\`, \`model\`, \`profile\`, \`source\`, \`user\`), \`period\` (\`7d\`, \`30d\`, \`90d\`, \`this_month\`, \`last_month\`) or \`from\` / \`to\` (YYYY-MM-DD), and the filters \`provider\`, \`model\`, \`agent_profile\` (\`default\` = no profile matched), \`agent\`, \`source\` and \`user\` (\`user\` needs \`assistants.manage\`). Each group has calls, tokens, \`cost\` and \`estimated_cost\` per currency, \`unknown_calls\`, \`share\`, \`cost_per_1k\` and a per-day \`trend\`. With database migration \`20270126130000_ai_cost_breakdown\` the totals are grouped in the database; before it, from the newest 50,000 records per table (the answer says \`truncated\` when it had more).

The Reports section has the same data as the **Agents & AI usage** report source (Reports → Sources).

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
- **Use this workflow's data as context** (Run Agent, on for new steps): the agent gets the run's own data before the prompt — the workflow and run, the trigger and its data (the submitted form or the data-table row that started it), the variables, earlier steps' results, the related task / row / submission ids and who started it — and is told that this is the item to work on, so an "approve the claim" agent reviews *that* claim instead of querying the table for one. Secrets (credential-like keys, tokens, encrypted values), internal \`_\` keys and resume tokens are left out, files go as references, and the block is capped at about 20 KB (long values are cut with a \`… [truncated …]\` marker). **Which data → Only the fields I pick** passes just the variables you name (\`claim_id, form.amount\`). The run log, the step's output and the agent run page show that it was passed and its size. Steps saved before this option keep running without it until you tick the box.
- On demand: \`usertasks agents execute <id> --set message="Classify INV-1042"\` (add \`--set async:=true\` to queue it; poll \`usertasks agents job <job-id>\`), \`POST /api/v1/agents/{id}/execute\` (\`"stream": true\` streams Server-Sent Events: the reply as \`delta\` events, then \`done\`), or MCP \`agents_execute\` (queued).
- **Published workflows** run the agent version pinned when they were published (see Run Agent); drafts and Save & Test run the latest.
- **Streaming**: the test console, Save & Test (on the Run Agent step) and REST \`stream\` show the reply as the model writes it. Providers are streamed through their OpenAI-compatible Server-Sent Events (OpenAI, Azure, Claude's and Gemini's OpenAI compatibility, Mistral, DeepSeek, Groq, Together, Perplexity, Ollama, Bedrock's OpenAI endpoint), with Anthropic Messages events understood too; tool-call arguments are assembled from their pieces. A provider, model or gateway that refuses streaming gets a normal request instead; an error mid-stream retries the call (the partial reply is discarded). Workflows on the server get the final result as before.
- **Who can read runs**: a run's input, output, trace and tool calls (and test-suite runs and queue jobs) need \`agents.view\` — except your own runs: those the agent acted for you or that you started. Others get "not found". A workflow run still shows a Run Agent step's output to people who can view the run, but not the agent's trace.
- **Trace**: every run records each model call (latency, tokens, retries, finish reason) and tool call (arguments and results with credentials redacted, latency, status, approval) — the run page's Trace tab, \`GET /api/v1/agents/runs/{id}\`. Runs emit \`agent.run.*\` events (status, model, tokens, duration — prompts, outputs and tool payloads are **not** in exported events).

## Multi-agent workflows

Several **Run Agent** steps in one workflow can work together, one after another or at the same time.

- **Sequential handoff** — steps in a row: each agent gets the earlier agents' conversation turns and shared facts, and adds its own.
- **Parallel agents** — put Run Agent steps on the branches of a [Parallel](/docs/workflows/timing) node in \`parallel\` mode: the agents really run at the same time (three agents of 10 seconds each take about 10 seconds, not 30). A step after them — their join, or the Parallel node's **Done** edge — runs once all of them have finished, and sees every agent's results.
- **Shared context** — with **Share context with other agents** on (the default), steps share \`{{agent_context}}\`:
  - \`agent_context.messages\` — every agent's prompt and reply, each tagged with the agent (\`agent\`), its step (\`node_id\`) and its Parallel branch (\`branch\`), in the order they were written (the newest 200);
  - \`agent_context.facts\` — facts the agents wrote, and \`agent_context.fact_writers\` — who wrote each one (agent, step, branch, time).
  When agents of different branches finish, their copies are **merged**, never overwritten: all messages are kept, and for a fact two agents both wrote, the value written last wins (with its writer recorded).
- **Live facts** — while they run, agents share facts on the run's blackboard: \`write_shared_fact\` is visible at once to every other agent of the run, including those running at the same time on other branches or on the agent queue; \`read_shared_facts\` returns all facts so far and who wrote them; \`wait_for_shared_fact\` waits for a fact another agent will write (default 30 seconds, at most 120, never past the agent's own time limit), then returns \`found: false\` so two agents waiting on each other never hang.
- **Inline or queued** — inline agents run inside the run, one per branch at the same time. Queued agents (**Execution mode: Queued**) pause their branch and run on the agent queue; a queue worker runs up to 3 of them at the same time (\`AGENT_QUEUE_CONCURRENCY\`, 1–10), and each claims its own job, so none runs twice. Every result is applied: a completion that arrives while the run is resuming another branch is kept and applied in turn.
- **Errors** — a failing agent fails its own branch by the step's error setting: with *Stop* the run fails once the other branches have finished (they finish normally; their results aren't lost or mixed up), with *Continue* its branch carries on and the join still sees the other agents' results.
- **Seeing it in the run** — each Run Agent step's output has \`started_at\`, \`finished_at\` and \`branch\`, and the run log says which agents ran at the same time (\`Agent "Reviewer" started on branch B — running at the same time as Researcher\`).

Limits and tips:

- Give each parallel step its own **Output variable** (\`research_response\`, \`review_response\`): two branches setting the same variable leave the later branch's value after the join (agent_context is the exception — it is merged).
- Budgets are checked when each agent starts, so agents starting together can each pass a nearly spent budget; set **tokens per run** to bound one run.
- Facts: keys up to 100 characters, values up to 5,000 characters, at most 500 facts per run. Facts live with the run and are deleted with it.
- An agent's tools still act on their own: two agents updating the same data-table row at the same time both write — give agents separate work, or let one agent write and the others report through facts.
- To clear the context for later steps, set \`agent_context\` after the join, not inside a branch (branch values are merged).
- Queued agents only overlap when the queue runs them together: more queued agents than \`AGENT_QUEUE_CONCURRENCY\` wait their turn, and an agent waiting (\`wait_for_shared_fact\`) for one that hasn't started yet just times out. Inline agents always run together.
- Until the \`20270114000000_workflow_run_facts\` migration is applied, facts are shared between steps (through \`agent_context\`) but not live between agents running at the same time.

Rate limits apply per workspace. Permissions: \`agents.view\`, \`agents.create\`, \`agents.edit\` (also tests and restore), \`agents.test\` (run, run tests), \`agents.delete\`. Agents, runs and the queue are written only by the server; members read agents, and runs as above.
`,
  },
]
