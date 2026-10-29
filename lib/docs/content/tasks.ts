import type { DocPageDef } from '../types'

export const TASK_PAGES: DocPageDef[] = [
  {
    slug: 'tasks',
    title: 'Tasks',
    description: 'Human work inside automated processes: assignment, queues, lifecycle, outcomes and the task list — or your own front end.',
    body: `
A task is a unit of work for a person. Most tasks are created by **User Task** nodes, which pause a run until the task is completed; tasks can also be created by hand, by the API, or ingested from another workflow engine.

::image task-detail | A task with typed fields and Approve / Reject outcome buttons | Task detail: the request, typed fields to fill in, and one button per outcome.

## Where people work

- **Tasks** — the signed-in user's list (assigned to me, my teams, created by me), with filters and saved views.
- **Queue** — tasks waiting for someone on a team to accept them.
- **My team** — for managers: the open tasks of the people who report to you (see [Manager view](/docs/tasks/manager-view)).
- **Task detail** — description, fields, outcome buttons, notes, files, subtasks and history.

Because UserTasks is headless, you can also build your own task inbox: list tasks with \`GET /api/v1/tasks/assigned\` and complete them with \`POST /api/v1/tasks/{id}/action\` (see [Completing tasks by API](/docs/tasks/api)).

## Descriptions: plain text or HTML

A description can be plain text or HTML. The app renders HTML formatting on the task detail page. Lists and queues show a plain-text excerpt. The **New task** form has a **Preview** toggle.

HTML is sanitised on every save, and again when it is displayed. These elements are allowed: \`p\`, \`br\`, \`div\`, \`span\`, \`hr\`, \`strong\`/\`b\`, \`em\`/\`i\`, \`u\`, \`s\`, \`sub\`, \`sup\`, \`a\`, \`ul\`, \`ol\`, \`li\`, \`h1\`–\`h4\`, \`blockquote\`, \`code\`, \`pre\`, \`table\`, \`thead\`, \`tbody\`, \`tr\`, \`th\`, \`td\` and \`img\`.

- Links may be \`http(s)\`, \`mailto\` or relative. They always open in a new tab with \`rel="noopener noreferrer"\`.
- Images need an absolute \`https\` URL.
- Everything else is removed: scripts, styles, \`style\`/\`class\`/\`id\` and \`on*\` attributes, iframes, forms, SVG and MathML, and \`javascript:\` or \`data:\` URLs.
- Text that only looks like a tag, such as \`<customer name>\`, stays as text.

In a User Task \`task_description\` template, values interpolated into HTML are escaped, so a variable cannot add markup.

## Lifecycle

| Status | Meaning |
|---|---|
| \`draft\` | Created but not yet issued |
| \`todo\` | Waiting to be worked on |
| \`in_progress\` | Accepted or started |
| \`blocked\` | Waiting on something else |
| \`completed\` | Done, with an outcome |
| \`cancelled\` | No longer needed |

Actions on a task — **accept**, **hold**, **reject**, **complete**, **escalate**, **redirect** — are recorded as lifecycle events, feed the event stream (\`task.*\`) and can start workflows through task triggers.

## Who can action a workflow task

A task a workflow is waiting on (a **User Task**) is actioned by its **assignee only** — on the task screen, the form buttons, the API, MCP, the CLI and agent tools alike:

- the individual assignee, or a collaborator on a collaborative task;
- for a task assigned to a **team** (no individual assignee yet): a member of that team;
- the assignee's **manager**, acting [on their behalf](/docs/tasks/manager-view) with a reason;
- a holder of **Complete any task (break-glass)** (\`tasks.complete_any\`, Owner only by default), also on behalf and with a reason, recorded as break-glass.

Everyone else — admins included — sees the task read-only. Standard tasks you create by hand keep the usual rule (anyone with **Complete tasks** in the workspace).

## Queues and acceptance

Assign a User Task to a **team** to put it in that team's queue. Members accept it (it becomes theirs) or reject it; a rejected task fires **Task Rejected** triggers so a workflow can reroute it.

::image tasks-queue | The task list | The task list with priorities, due dates and SLA state.

## Subtasks and dependencies

Tasks can have subtasks (created by hand, by the **Create Subtask** node, or in the ingest payload) with their own assignees and completion state.

## Tasks from other systems

\`POST /api/v1/tasks/ingest\` (\`usertasks tasks ingest\`) creates a task from another engine with an optional \`callback_url\` and \`idempotency_key\`, so UserTasks can be the human-task inbox for workflows that run elsewhere.
`,
  },
  {
    slug: 'tasks/fields-and-outcomes',
    title: 'Fields and outcomes',
    description: 'Collect typed values on a task and route the workflow by the outcome the person chooses.',
    body: `
## Outcomes

A User Task lists its \`outcomes\`, for example **Approved** and **Rejected**. Each outcome is a button on the task and an outgoing edge on the canvas with the same label. When the task is completed, the run resumes on the matching edge and \`{{outcome}}\` and \`{{outcome_notes}}\` are set.

## Fields

\`fields\` define what the person fills in. Design them in the [form designer](/docs/tasks/forms) (**Design form** on the User Task), which also places them on a grid and themes the form. The field types:

| Type | Stored as | Notes |
|---|---|---|
| \`text\`, \`textarea\` (long text) | string | \`placeholder\`, \`min_length\` / \`max_length\`, \`pattern\` |
| \`email\`, \`phone\`, \`url\` | string | checked for the format |
| \`number\`, \`currency\` | number | \`min\` / \`max\`; currency has a \`currency\` code |
| \`date\` | \`YYYY-MM-DD\` | \`min_date\` / \`max_date\` |
| \`datetime\` | ISO 8601 (UTC) | |
| \`boolean\` | true / false | a required checkbox must be ticked |
| \`choice\` | string | \`options\` (or \`options_source\` from a data table column), dropdown or radio |
| \`multi_choice\` | array of strings | \`options\`; \`min\` / \`max\` selections |
| \`user\` | user id | a person in the workspace |
| \`lookup\` (autocomplete) | string (array when \`multiple\`) | suggestions from a data table or an API reference; the selected item is \`{{task_data.<key>_item}}\` — see [Autocomplete / lookup fields](/docs/tasks/forms#autocomplete-lookup-fields) |
| \`attachments\` | array of file objects | uploaded files; \`attachments\` sets counts, sizes and types; the number of files is \`{{task_data.<key>_count}}\` — see [Attachments](/docs/tasks/forms#attachments) |
| \`heading\`, \`divider\` | (no value) | layout only |

Each field has a \`key\` (defaults to the label in snake_case), a \`label\`, \`required\`, optional \`help_text\`, \`read_only\` and \`visible_when\`. Keys must be unique in the task and can't be reserved names such as \`outcome\` or \`task_data\`. After completion the values are available as \`{{task_data.<key>}}\` (also \`{{task.data.<key>}}\`).

\`\`\`json title="User Task config"
{
  "task_title": "Approve invoice {{invoice_number}}",
  "task_description": "{{vendor.name}} · {{=FORMAT_NUMBER(amount, 2)}} {{currency}}",
  "outcomes": ["Approved", "Rejected"],
  "fields": [
    { "key": "amount", "label": "Approved amount", "type": "number", "required": true, "default": "{{amount}}" },
    { "key": "cost_centre", "label": "Cost centre", "type": "choice", "options": ["OPS", "FIN", "IT"], "required": true },
    { "key": "comment", "label": "Comment", "type": "text" }
  ]
}
\`\`\`

## Several assignees

When a task is assigned to several people, \`completion_rule\` decides when it is done:

| Rule | Completes when |
|---|---|
| \`first_response\` | the first person responds (their outcome wins) |
| \`all_complete\` | everyone has responded (the most common outcome wins) |
| \`consensus\` | at least \`min_responses\` people agree |
| \`unanimous\` | everyone chooses the same outcome |
| \`custom\` | \`custom_rule_expression\` evaluates true |

Every response is kept (\`{{task.responses}}\`, \`{{task.outcome_counts}}\`), and the rule is applied the same way whether people respond in the app, through the API or through an agent.
`,
  },
  {
    slug: 'tasks/forms',
    title: 'Forms',
    description: 'Design grid forms for User Tasks, workflow starts and standalone form pages: every field type, lookups, attachments, buttons, headers, themes, QR codes, the Form submitted trigger and testing.',
    body: `
A form is a set of typed fields placed on a grid, with an optional header, buttons and theme. The same designer builds four kinds of form:

- **Task forms** — what the assignee fills in on a User Task. Values come back as \`{{task_data.<key>}}\`.
- **Reusable forms** — saved in the Forms library, versioned, linked from any number of User Tasks, and published on their own page (\`/f/<id>\`, with a QR code). Submitting one fires the **Form submitted** trigger (\`{{form.<key>}}\`).
- **Start forms** — a workflow's inputs on a grid with a theme, shown by the Run dialog and **Save & Test**; **Publish as form page** gives one its own page.
- **Task trigger forms** — the fields a triggering task carries (\`{{task.data.<key>}}\`).

::image forms-designer | The form designer: field palette on the left, a grid of rows with one to four columns, and the Attachments field's settings on the right | The designer: drag types from the palette onto a grid of 1–4 column rows; the selected field's settings are on the right.

## Build your first form in 5 minutes

1. **Create it.** Open **Automations → Forms → New form**, name it (for example *Customer return*) and choose **Continue to designer**.
2. **Add fields.** Drag **Text**, **Email**, **Currency**, **Single select** and **Attachments** from the palette onto the grid (or select one and press **Enter**). Set each field's label; the key follows it in snake_case (\`contact_email\`).
3. **Lay it out.** Give a row 2 or 3 columns with the buttons beside **ROW n**, then drag fields side by side. Set **Width** on a field to span columns. Add **Section heading** and **Divider** for structure.
4. **Validate.** Tick **Required**, set min / max, a pattern with a message, or **Visible when** on the fields that need it. **Preview → Check validation** tries the rules; **Phone** shows the one-column mobile layout.
5. **Buttons and look.** In **Buttons & header**, turn on the header, rename **Submit** and add **Show success screen**. In **Form theme**, pick **Custom** and set an accent colour. Choose **Create form**.
6. **Use it.** **Open form** (or **QR code**) in the library to share its page; add a **Form submitted** trigger to a workflow to run it on every submission, or link the form from a User Task with **Use a saved form**. Every field is in the workflow's **Data** panel as \`{{form.<key>}}\` / \`{{task_data.<key>}}\`.

Prefer code? \`usertasks forms create -f customer-return.json\` (or \`POST /api/v1/forms\`) takes the same \`fields\`, \`layout\`, \`theme\`, \`header\` and \`buttons\` — see [Reusable forms](#reusable-forms).

## The form designer

Open a **User Task** and choose **Form → Design form**. The dialog has three parts:

- **Palette** (left): text, long text, number, currency, email, phone, URL, date, date and time, checkbox, single select, multi-select, person, autocomplete / lookup, attachments, section heading and divider. Drag a type onto the grid, or select it and press Enter to add it in a new row.
- **Grid** (centre): rows of 1 to 4 columns. Choose the column count per row, add, move and remove rows, drag fields between cells, and set how many columns a field spans. Dropping onto a full row puts the field in a new row below it.
- **Properties** (right): the selected field's label, key, type, width, help text, placeholder, required, read-only, default value (expressions and the **Insert data** picker work), validation (min / max, length, pattern with a message, date range, selection count), options with values and labels (or loaded from a data table column when the task is created) and **Visible when** (show the field only when another field equals / doesn't equal / contains a value, or has a value). The **Form theme** tab styles the form.

**Preview** shows exactly what the assignee sees, in light or dark mode and at desktop or phone width, with **Check validation** to try the rules. On phones every row collapses to one column.

The designer has undo and redo (**Ctrl+Z**, **Ctrl+Shift+Z** or **Ctrl+Y** outside text boxes) and asks before closing with unsaved changes.

### Keyboard

Tab to a field on the grid. **Alt+←/→** moves it within its row, **Alt+↑/↓** moves it to the row above or below, **Delete** removes it and **Enter** selects it for the properties panel. Every palette item is a button.

## Grid layout

A form is a list of **rows**. Each row has 1 to 4 **columns**, and each field in it a **span** (how many of the row's columns it covers: 1/2, 1/3, 2/3, full…). Dropping a field onto a full row puts it in a new row below.

- **ROW n · 1 2 3 4** sets the row's columns; the arrows move the row, **+** inserts one below and the bin removes it.
- Drag a field by its handle to another cell, or onto **Drop here for a new row** (the **+ 1 col** … **+ 4 cols** buttons add an empty row).
- **Width** in the field's properties sets its span within the row.
- **Section heading** and **Divider** are layout-only fields: they take a cell (usually a full row) and hold no value.
- **On phones** (and narrow task panes) every row collapses to one column in the field order, so a form designed on a desktop works on a phone without a second layout. **Preview → Phone** shows it.

The layout is stored next to the fields as \`form_layout\` (on a User Task) or \`layout\` (on a reusable form):

\`\`\`json title="User Task config with a grid"
{
  "task_title": "Review expense claim",
  "outcomes": ["Approved", "Rejected"],
  "fields": [
    { "key": "employee_name", "label": "Employee name", "type": "text", "required": true },
    { "key": "amount", "label": "Amount", "type": "currency", "currency": "USD", "min": 0 },
    { "key": "category", "label": "Category", "type": "choice", "options": ["Travel", "Meals", "Equipment"] },
    { "key": "expense_date", "label": "Expense date", "type": "date" }
  ],
  "form_layout": { "rows": [
    { "columns": 2, "cells": [{ "field_key": "employee_name", "span": 1 }, { "field_key": "amount", "span": 1 }] },
    { "columns": 2, "cells": [{ "field_key": "category", "span": 1 }, { "field_key": "expense_date", "span": 1 }] }
  ] }
}
\`\`\`

A form without a layout renders one field per row, as it always has. Opening it in the designer shows one field per row and doesn't change anything until you edit it.

## Field types

Every field has \`key\`, \`label\`, \`type\`, and optionally \`required\`, \`help_text\`, \`placeholder\`, \`default\` (expressions allowed), \`read_only\` and \`visible_when\` (\`equals\`, \`not_equals\`, \`contains\`, \`is_set\`, \`is_not_set\` on another field). The type adds its own settings:

| Palette | \`type\` | Settings | Value | Also downstream |
|---|---|---|---|---|
| Text | \`text\` | \`min_length\`, \`max_length\`, \`pattern\`, \`pattern_message\` | string | — |
| Long text | \`textarea\` | as Text | string | — |
| Email | \`email\` | as Text; format checked | string | — |
| Phone | \`phone\` | as Text; format checked | string | — |
| URL | \`url\` | as Text; http(s) only | string | — |
| Number | \`number\` | \`min\`, \`max\` | number | — |
| Currency | \`currency\` | \`currency\` (ISO 4217, default USD), \`min\`, \`max\` | number | — |
| Date | \`date\` | \`min_date\`, \`max_date\` | \`YYYY-MM-DD\` | — |
| Date & time | \`datetime\` | \`min_date\`, \`max_date\` | ISO 8601 (UTC) | — |
| Checkbox (yes/no) | \`boolean\` | required means it must be ticked | true / false | — |
| Single select | \`choice\` | \`options\`, \`option_labels\`, \`options_source\` (a data table column), \`display\` (\`dropdown\` or \`radio\`) | string | — |
| Multi-select | \`multi_choice\` | \`options\`, \`option_labels\`, \`options_source\`, \`min\` / \`max\` selections | array of strings | — |
| Person | \`user\` | — | user id | — |
| Autocomplete / lookup | \`lookup\` | \`lookup\`: a data table or API reference, search, shown and stored fields, filters, fill-ins, several / free text | string (array when several) | \`<key>_item\`: the selected item |
| Attachments | \`attachments\` | \`attachments\`: \`min_files\`, \`max_files\`, \`max_file_mb\`, \`max_total_mb\`, \`types\`, \`custom_types\`, \`camera\` | array of file objects | \`<key>_count\`: the number of files |
| Section heading | \`heading\` | — | none | — |
| Divider | \`divider\` | — | none | — |

Every value field is \`{{task_data.<key>}}\` after a User Task, and the same field is \`{{form.<key>}}\` in a workflow started by **Form submitted**, \`{{task.data.<key>}}\` after a task trigger and \`{{<key>}}\` for a start form's inputs. A start form takes text, number, checkbox, date, date and time, email, URL, single select and attachments.

## Keys and downstream data

Each field has a key, generated in snake_case from its label until you edit it. Keys are unique, lowercase and can't be reserved names (\`outcome\`, \`task_data\`, \`id\`…). After the task, every value is available to later steps as \`{{task_data.<key>}}\`, and the **Insert data** picker lists each field with its label and type. Values are typed: numbers and currency are numbers, checkboxes are true / false, dates are ISO strings and multi-selects are arrays.

Renaming a key that later steps use opens a list of those references (step, setting and count) and offers to update them to the new key or keep them as they are.

## Autocomplete lookup fields

An **Autocomplete / lookup** field suggests values as the assignee types, from a **data table** or an **API reference**, and stores the one they pick.

**Data table.** Choose the table, the **columns to search** (one or more, matched case-insensitively — *contains* or *starts with*), the **columns to show** (the first is the main text of a suggestion, the others its second line) and the column **stored as the value** (the row id by default). **Only rows where** adds fixed filters (column, operator, value); a value can use another field of the form (\`{{task_data.region}}\`), the task (\`{{task.title}}\`) or a workflow variable (resolved when the task is created). Set a sort, the maximum number of suggestions (default 10) and the minimum characters before searching (default 1).

**API reference.** Choose the integration and reference, then map its inputs: \`{{search}}\` is what the assignee types, \`{{task_data.<key>}}\` another field, or a fixed value. Pick the **results list** from the reference's response model (the same model the data picker uses — test the reference once to capture it), then the item fields to show and the field stored as the value. **Wait after typing** debounces calls (default 300 ms) and **Cache responses** reuses a response for the same inputs for up to an hour.

::image forms-lookup | Preview of a form with the Customer lookup open, suggesting two customers with their city and country | **Preview** runs the real lookup: suggestions from the Customers table, with the city and country on the second line.

Both sources can **allow several** selections (chips), **allow free text** (a value that isn't a suggestion) and **fill other fields** from the selected item — choosing a customer can fill their email and phone (the assignee can still edit them). **Preview** in the designer runs the real lookup.

The selected value is \`{{task_data.<key>}}\` (an array when several are allowed), and \`{{task_data.<key>_item}}\` is the selected item with its shown, value and fill fields (an array of them for several) — both in the data picker with the item's fields. A field can't use the key \`<key>_item\` of a lookup.

\`\`\`json title="A customer lookup that fills email and phone"
{
  "key": "customer", "label": "Customer", "type": "lookup", "required": true,
  "lookup": {
    "source": "table", "table_id": "<customers table id>",
    "search_columns": ["company_name", "contact_name"], "display_columns": ["company_name", "city"],
    "filters": [{ "column": "country", "operator": "eq", "value": "{{task_data.country}}" }],
    "sort": { "column": "company_name", "direction": "asc" },
    "fill": [{ "from": "email", "to": "contact_email" }, { "from": "phone", "to": "contact_phone" }]
  }
}
\`\`\`

### Security

Suggestions are authorised by the **task**, not by data-table or integration permissions: the caller needs **Complete tasks** and must be able to act on that open task (its assignee, a collaborator, a member of its team, or a queue manager — a tenant-wide API key acts on any task of its workspace). The server reads the lookup from the task's stored form and runs only that query — the configured table or reference, columns and filters; nothing in the request can change them. Results contain only the shown, value and fill fields, integration credentials never reach the browser, lookups are rate limited per user (120 a minute) and time out with a friendly message. On completion the value is checked again against the source with the same configuration (re-queried by value, or matched with what the API returned to this task) unless free text is allowed, and \`<key>_item\` is computed on the server. Lookups travel with exports and packages: the table, reference and integration are dependencies and their ids are remapped on install.

API clients completing a task can ask for suggestions with \`POST /api/v1/tasks/{id}/lookup\` (\`{ "field_key", "query", "values" }\`), the MCP tool \`tasks_lookup\` or \`usertasks tasks lookup <id>\`.

## Attachments

An **Attachments** field (palette group **Files**) takes one or more uploaded files. It works everywhere a form does: task forms, a reusable form's own page (\`/f/<id>\`), a workflow that starts from a form (the Run dialog and **Save & Test**), a workflow's own start form (an attachments input — see below), **Publish as form page**, the Test runner's User Tasks, and the grid and themes.

**Settings** (Properties → Files): at least / at most so many files (default at most 10; **Required** means at least one), the largest single file (default 10 MB) and all files together, the allowed types — **Documents** (PDF, Word, OpenDocument, RTF, text, Markdown, PowerPoint), **Images** (PNG, JPEG, GIF, WebP, HEIC, BMP, TIFF, SVG), **Spreadsheets** (Excel, OpenDocument, CSV, TSV), **PDF only** or **Any (safe) file**, plus extra extensions or MIME types (\`.dwg\`, \`application/zip\`, \`image/*\`) — and **Offer the camera on phones** when images are allowed. The instance caps every file at \`FORM_ATTACHMENT_MAX_MB\` (default 25 MB, at most 45).

**Uploading:** drag files onto the drop zone, **Browse…**, or paste (focus the drop zone and press Ctrl+V / ⌘V). Several files upload at once, each with its own progress bar, **Cancel** while it uploads, **Retry** after a failure and **Remove** afterwards; images show a thumbnail, other files an icon with name and size, and the arrow buttons reorder them. Everything works with the keyboard (Enter or Space on the drop zone opens the file picker) and progress is announced to screen readers. Files that are too large, of a type the field doesn't allow, or over the count are refused before they upload, with the reason.

**The value** is a list of file objects, newest last in the order shown:

\`\`\`json title="{{task_data.receipts}}"
[
  {
    "id": "6f1c…", "name": "taxi.pdf", "size": 48213, "mime_type": "application/pdf",
    "url": "https://tasks.example.com/attachments/6f1c…",
    "storage_ref": "storage://form-files/<workspace>/task-<task>/6f1c…/taxi.pdf",
    "uploaded_by": "<user id>", "uploaded_at": "2026-11-20T09:14:03.000Z",
    "checksum_sha256": "9b74…"
  }
]
\`\`\`

\`{{task_data.<key>}}\` after a User Task, \`{{form.<key>}}\` in a **Form submitted** workflow, plus \`<key>_count\` (the number of files). In the data picker the field is a list with the file's fields (name, size, MIME type, URL…): **Loop For Each** offers it under **Items to loop through** (or drop it there), and inside the loop \`{{item.name}}\`, \`{{item.size}}\`, \`{{item.url}}\` are the current file. \`{{=FILE_NAMES(task_data.receipts)}}\` lists the names, \`{{=FILES_TOTAL_SIZE(task_data.receipts)}}\` adds up the sizes, \`{{=COUNT(task_data.receipts)}}\` counts them. See [Loops over files](/docs/workflows/api-responses#loops-over-files).

**Steps that take files** accept one file object or a list: **Send Email → Attachments** (\`{{task_data.<key>}}\` attaches them all, \`{{item}}\` one), **HTTP Request** (body **Multipart form (files)** or **Binary (one file)**), **Call Reference** file inputs such as storage connector uploads (S3, Azure Blob, SharePoint, OneDrive, Box, Google Drive), **Word / Excel / PowerPoint** templates, and **Read File / Read CSV / Read Excel / Download File / File to Base64**.

\`\`\`json title="Worked example: log each receipt, post it to an archive, then email them all"
{
  "nodes": [
    { "id": "claim", "type": "user_task", "config": { "task_title": "Expense receipts", "outcomes": ["Submitted"],
      "fields": [{ "key": "receipts", "label": "Receipts", "type": "attachments", "required": true,
                   "attachments": { "max_files": 5, "max_file_mb": 10, "types": ["documents", "images"] } }] } },
    { "id": "each", "type": "loop", "config": { "items": "{{task_data.receipts}}" } },
    { "id": "log", "type": "log", "config": { "message": "Receipt {{item.name}} — {{item.size}} bytes ({{item.mime_type}})" } },
    { "id": "archive", "type": "http_request", "config": { "method": "POST", "url": "https://archive.example.com/upload", "content_type": "multipart",
      "multipart": [{ "key": "name", "value": "{{item.name}}", "type": "text" }, { "key": "file", "value": "{{item}}", "type": "file" }] } },
    { "id": "mail", "type": "send_email", "config": { "to": "finance@example.com", "subject": "{{task_data.receipts_count}} receipts",
      "body": "{{=FILE_NAMES(task_data.receipts)}}", "attachments": "{{task_data.receipts}}" } }
  ],
  "edges": [
    { "source": "claim", "target": "each", "label": "Submitted" },
    { "source": "each", "target": "log", "label": "Each Item" },
    { "source": "log", "target": "archive" },
    { "source": "each", "target": "mail", "label": "Done" }
  ]
}
\`\`\`

**Start forms:** **Design start form** offers Attachments too: the workflow input becomes \`{ "type": "array", "format": "attachments", "attachments": { … } }\` and the run gets \`{{<input>}}\` (the list of files) and \`{{<input>_count}}\`. The Run dialog uploads into the workflow's start context (needs **Activate workflows**), **Save & Test** into a test context (deleted after 24 hours), and the server rebuilds the list from the uploads of the person starting the run; the files then belong to the run and are deleted with it.

**API, MCP and CLI:** upload first, then pass the file ids as the field's value. \`POST /api/v1/files/uploads\` with \`task_id\`, \`form_id\` or \`workflow_id\` (a start form), \`field_key\`, \`name\` and either \`content_base64\` (small files; also multipart \`file=@…\`) or \`size\` — then PUT the bytes to the returned signed URL and \`POST /api/v1/files/uploads/{id}/complete\`. Use the ids in \`POST /tasks/{id}/action\` (\`values.<key>: ["<id>", …]\`), \`POST /forms/{id}/submit\` or \`POST /workflows/start\` (\`variables.<input>\`). Same checks as the browser; ids of files someone else uploaded, or uploaded elsewhere, are refused; a personal API key or OAuth is needed (uploads belong to a person). MCP: \`files_upload\` (base64, up to 5 MB), \`files_upload_init\` / \`files_upload_complete\`. CLI: \`usertasks files upload <path> --field receipts --task <id>\`, or \`--attach receipts=./taxi.pdf\` on \`tasks complete\`, \`forms submit\` and \`workflows start\` (repeat it for several files). SDK: \`client.uploadFile({ task_id, field_key }, { name, bytes })\`.

**AI agents:** a **Run Agent** step's **Files** (\`{{form.receipts}}\`, \`{{item}}\`) are given to the model — images as images to vision models (OpenAI, Azure OpenAI, Claude, Gemini), PDFs as documents where the API takes them (OpenAI) and otherwise, like Word, Excel and PowerPoint files, as extracted text — and the agent can read them again with its \`read_attached_file\` tool. Up to 10 files, 5 MB per image, 100 PDF pages, 100,000 characters of text per file; only names and sizes are logged.

**Downloads:** the task screen, the submission view (Forms → Submissions) and completed tasks list the files with a download link. \`url\` (\`/attachments/<id>\`) works for signed-in people who may see the file — the uploader; for a task's files the people who can see the task (assignee, collaborators, team members, their managers, **View all tasks** and queue managers); for a submission's files its submitter and **Edit forms** — and hands the browser a link signed for five minutes. It is never public: in an email to someone outside the workspace, attach the file instead of linking it.

### How files are kept safe

- **How a file travels.** With a storage provider that signs uploads (Supabase, S3 / MinIO, Azure Blob, Google Cloud Storage) the browser sends each file straight to the store through a signed URL valid for one object and \`FORM_ATTACHMENT_UPLOAD_WINDOW_MINUTES\` (15), and the server then reads it back and verifies it before it can be used — so big files work on any host, Vercel included. With local-disk storage files go through the app, up to \`FORM_UPLOAD_MAX_BODY_MB\` (50; 4 on Vercel). Reverse-proxy settings: [Self-hosting → File uploads and request size limits](/docs/self-hosting#file-uploads-and-request-size-limits).
- **Private storage.** Files are stored by the configured storage provider in a private \`form-files\` bucket (\`<workspace>/<form or task>/<uuid>/<name>\`). The bucket is never served by \`/files\`; every download is authorised by \`/attachments/<id>\` and served with \`Content-Disposition: attachment\` (only PNG / JPEG / GIF / WebP thumbnails are shown inline), \`X-Content-Type-Options: nosniff\`, a sandboxing Content-Security-Policy and no shared caching.
- **Checked content.** The server checks the size against the field and the instance cap, and the type by its **content** (magic bytes), not the name or what the browser says: a .pdf must be a PDF, a .docx a Word document without macros, a .png a PNG, a .csv UTF-8 text. Programs and installers (Windows, Linux and macOS executables), scripts, shortcuts, macro-enabled Office files, disk images and web pages are refused whatever they are called. SVG images are sanitised (scripts, event handlers and external references removed). File names are cleaned (no paths, control or direction-override characters) and stored with a SHA-256 checksum.
- **Virus scanning (optional).** \`FORM_ATTACHMENT_SCANNER=clamav\` scans every upload with clamd (\`CLAMAV_HOST\`, \`CLAMAV_PORT\` 3310) before it is stored; infected files are refused, and a scanner outage refuses uploads unless \`FORM_ATTACHMENT_SCAN_FAIL_OPEN=true\`. Off by default.
- **Pending until submitted.** An upload belongs to the person who uploaded it and to that form or task field. It stays *pending* until the form is submitted or the task saved, and is deleted if that doesn't happen within \`FORM_ATTACHMENT_PENDING_HOURS\` (24). On submit the server rebuilds the field's value from its own records: only files this person uploaded into this form (or into this task) are accepted, so a value naming someone else's file, another workspace's file or a made-up reference is refused, and names, sizes and links always come from the server. Counts, sizes and types are checked again.
- **Workflows read files for their own workspace only.** The engine reads an attachment's bytes through the storage provider with the run's workspace; a value naming another workspace's file is "not found". Run details and logs show file names and sizes, never contents.
- **Deleting.** Deleting a task or a submission (by hand or by a retention policy) deletes its files; the \`form-files-cleanup\` job (every 15 minutes) removes them and expired pending uploads, rows and stored objects.

Exports, packages and GitHub sync carry the field's settings; uploaded files never travel.

## Header

**Buttons & header** in the designer turns on a header above the fields: an image — the UserTasks mark (default), the workspace logo, an uploaded image (PNG, JPEG, SVG or WebP up to 1 MB; SVGs are sanitised; stored in the workspace's storage and served through \`/files\`) or none — a title and a subtitle, left or centred, optionally on the form theme's banner colour (kept legible). Titles and subtitles can use the form's values (\`{{task_data.customer}}\`, \`{{form.amount}}\`), the task (\`{{task.title}}\`) and workflow variables (resolved when the task is created). New forms start with a header; existing forms have none until you turn it on. A form header replaces the mini theme's header.

## Buttons and behaviours

Every form has a button bar — by default **Submit** and **Cancel**. In **Buttons & header** you can rename them, pick a style (primary, secondary, danger), hide Cancel, reorder them and add **outcome buttons** (task forms: each completes the task with one of the step's outcomes, so Approve / Reject work as buttons), a **Save draft** button (task forms) or more submit buttons. Placement — left, right or full width — is part of the form theme. Submit buttons validate the form first; Cancel discards what was typed (asking first).

After a click a button runs its steps in order:

| Step | What happens |
|---|---|
| **Show message** | a message under the form; \`{{field}}\` placeholders are filled |
| **Show success screen** | the form is replaced by a title, text and a **Submit another**, **Close** or link button |
| **Start workflow** | starts a workflow with form values mapped to its inputs (\`{{field}}\`, \`{{customer_item}}\`…); queued on the server; later texts can show \`{{run_reference}}\` |
| **Redirect** | goes to an app page (\`/tasks\`) or an address on the allow list (\`FORM_REDIRECT_ALLOWLIST\`) |
| **Close form** | closes the form |

Typical chains: *Submit → Show message → Start workflow*, or *Submit → Start workflow → Show success screen* (with the run reference). **Start workflow** runs on the server, never in the browser: adding one needs **Activate workflows** (the right to start workflows), and it then runs as a system action in the workspace, attributed to the person who submitted (\`workflow_started_by\`, \`form_submission_id\`) and audited on the form — the submitter needs no workflow permission. A failed start is reported in the message; the submission stands. Submitting twice (a double-click) records one submission. The designer's **Preview** runs the buttons without starting anything (\`{{run_reference}}\` shows PREVIEW).

A task form shows its button bar only when the step's form has buttons configured; otherwise the task keeps its usual outcome buttons.

::image forms-buttons | The Buttons & header tab: header with the workspace logo, title and subtitle, and a Submit return button whose click shows a success screen | **Buttons & header**: a header with the workspace logo, and a submit button that shows a success screen with the submitted values.

## Forms on their own page

Every reusable form has its own page, \`/f/<form id>\`, for signed-in members with **Submit forms** (every role by default): **Open form** and **Copy link** in the library. The page shows the header, the fields (lookups included), the theme and the buttons. Submissions are stored (\`form_submissions\`): **Submissions** in the library lists them (everyone sees their own; **Edit forms** sees all), shows one submission and exports CSV as a background job. A form can delete submissions older than a number of days (\`submission_retention_days\`). The API submits too: \`POST /api/v1/forms/{id}/submit\` (\`{ values, button_id, idempotency_key }\`), \`GET /api/v1/forms/{id}/submissions\`, \`GET /api/v1/form-submissions/{id}\`, MCP \`forms_submit\` / \`forms_submissions_list\` / \`forms_submission_get\` / \`forms_lookup\` and \`usertasks forms submit|submissions|lookup\`. Anonymous (public) submission is not offered yet.

::image forms-page | A standalone form page with a header, three-column rows, a customer lookup that filled the email and phone, and three uploaded files | A form page (\`/f/<id>\`): header, grid, a lookup that filled the contact fields, and three uploaded files.

## The Form submitted trigger

A workflow can start whenever a reusable form is submitted: **Form Submitted** trigger → choose the form (and optionally the buttons / outcomes that count). It fires for every submission — the form's page, the API and MCP, and a User Task whose form is linked to it (with \`{{form_outcome}}\` and \`{{task_id}}\`). Every field is available downstream, typed, as \`{{form.<key>}}\` (\`{{form.<key>_item}}\` for lookups), with \`{{submitted_by_name}}\`, \`{{submitted_at}}\`, \`{{form_button}}\`, \`{{form_version}}\` and \`{{form_submission_id}}\` — all in the data picker. Each submission is also a \`form.submitted\` event in the event stream (and so in log export destinations), without the values.

Used as a task form instead (a User Task linked to the form), the same form renders inside the task — header, theme and buttons included — and its values come back as \`{{task_data.<key>}}\`.

::image forms-trigger | A Form submitted trigger linked to the Customer return form, with its form page link, Copy link, Open form and QR code, and the list of form variables | The **Form submitted** trigger: the form, its page link with **QR code**, and every field available downstream.

## Use the values downstream: the Data panel and drag and drop

Form fields are the first thing every picker offers, labelled and typed:

- **Data panel.** **Data** in the settings panel's header (or **Alt+D**) docks a panel beside the selected step listing everything available at that step: **Form submitted › <form>** (\`{{form.<key>}}\`, then who submitted it and when), a task trigger's **Task form** (\`{{task.data.<key>}}\`), **Start form › Workflow inputs**, and each earlier User Task's **Form** (\`{{task_data.<key>}}\`, with \`<key>_item\` for lookups and \`<key>_count\` for attachments), then step outputs. Search matches labels and keys; a **Recently used** group keeps your last picks. The panel stays open as you move between steps.
- **Drag and drop.** Drag any row from the Data panel, the **Variables** panel or **Insert data** onto a setting: it is inserted where you drop it (a caret shows where), or replaces an empty field. Dropping a list (attachments, a multi-select, a lookup with several values) asks for the first item, an index, a find, the count or a loop; dropping it on a Loop's **Items to loop through** sets it. Click or **Enter** still inserts at the last place you typed.
- **Chips.** In expression inputs a field shows as a chip with its label (*Order number*); hover for the key.
- **Typing** \`{{\` lists the step's form fields first, with labels.

::image forms-data-picker | The Data panel docked beside a Log step, listing the Customer return form's fields with their keys and types | The Data panel at a later step: each form field with its label, \`{{form.<key>}}\` path and type, ready to drag into a setting.

## Test with the real form: Save & Test and Run

When a workflow starts from a form, testing and running it uses that form, not a list of variables:

- **Save & Test** with a **Form submitted** trigger draws the linked form exactly as its page does — header, grid, theme, lookups with real suggestions, validation and its buttons. Pressing a button sends a *test* submission: the server checks it like a real one (per-field errors come back on the form) and starts a test run with the same \`{{form.<key>}}\` payload, \`form_source\` = \`test\`. Nothing is stored — no submission, no \`form.submitted\` event, no other workflow started; the log says what the button would have done.
- With a **start form**, Save & Test shows its grid and theme over the inputs.
- **Test cases** remember each form's values and button: selecting a case refills the form, **Duplicate Selected** copies it, **Run Selected** shows the form and waits for its button, and **Run All (saved values)** reruns each case's last accepted submission (cases never submitted are skipped as *Needs form input*). **Show as fields** switches to the raw values.
- **Run** (workflow list and page) opens the same form. For a Form submitted workflow, submitting it is a real submission — stored, attributed to you, with its button behaviours — that starts the workflow through its trigger. For a start form it is a normal manual run.

## Reusable forms

**Automations → Forms** is the library: search and filter by tag, create, edit, duplicate and delete forms, and see which workflow steps use each one. In the designer, **Save as reusable form** saves the form to the library and links the step to it; **Use a saved form** links an existing one.

- A linked step shows **Linked to form "…" vN**. Saving in the designer can create a new version of the form or **Detach and save here** (the step keeps a local copy). **Detach** on the step does the same without opening the designer.
- Every change to a form's fields, layout or theme creates a new version; name, description and tag changes don't.
- **Drafts follow the latest version** of a linked form. **Publishing pins** the version in use, so a published workflow keeps its form until you publish again.
- A form that workflows use can't be deleted; the error lists where it is used.

Forms need the **View forms**, **Edit forms** and **Delete forms** permissions (Owner, Admin and Manager have all three; Member and Viewer can view). They travel with config-as-code, GitHub sync and packages (a workflow that links a form brings it, and its saved theme, along), and have REST (\`/api/v1/forms\`, \`/api/v1/form-themes\`), MCP (\`forms_*\`, \`form_themes_*\`) and CLI (\`usertasks forms …\`) commands.

## Themes: the workspace theme and mini themes

By default a form uses the [workspace theme](/docs/governance/workspace-theme) — the full theme of the app, in light and dark. The **Form theme** tab can instead give the form a **mini theme**: a small set of overrides laid on top of the workspace theme (**Custom**, or a **Saved theme**), starting from any built-in preset:

- accent colour (buttons, focus ring, selection), background and text colour, separately for light and dark mode
- the page behind the form (a colour, or a gradient to a second colour — standalone form pages, the frame around a task form, the designer preview), the input background, border colour and primary button colour (derived from the accent unless you set one), per mode
- corner radius, font (from the workspace theme's fonts), density (comfortable or compact), label position (above or left of the input) and where the buttons sit (right, left or full width)
- an optional header with a title, subtitle, banner colour and the workspace logo

The theme covers the whole form: page, card, header banner, headings and dividers, inputs (background, border, focus ring, placeholder), help and error text, buttons, the autocomplete list and chips, checkboxes and radio buttons, the date picker's light / dark, messages, the success screen and the Cancel confirmation. Every text / background pair the form draws is kept legible — AA (4.5:1) for text, 3:1 for input borders and the focus ring; a mid-tone background on which neither white nor dark text would pass is nudged until one does. Contrast is checked against the workspace theme in both modes. Low-contrast pairs are listed with an **Auto-fix**, and the form always raises them when it is drawn, so text is never illegible. A theme whose own text and background are below 3:1 can't be saved. Without dark colours, dark mode keeps the workspace's dark palette with your accent.

Save a theme to reuse it (**Save as a reusable form theme**, or **Automations → Forms → Form themes**). Tasks keep the theme they were created with.

::image forms-theme | The designer preview at phone width with a custom mini theme: bronze accent, cream page background and the header with the workspace logo | A mini theme in **Preview → Phone**: the page background, accent and header apply everywhere the form is shown.

## Start forms and task triggers

- **Start form:** in the workflow settings (nothing selected on the canvas), **Design start form** edits the workflow inputs (text, number, checkbox, date, date and time, email, URL, single select and attachments) on a grid with a theme. The Run dialog and the form shown for API and CLI starts follow it. **From a saved form** copies a library form's fields as inputs.
- **Publish as form page:** a start form opens from **Run** and API / CLI starts; it has no page of its own. **Publish as form page** (the workflow page's **Form link** panel, the start form settings, or the trigger node's settings) gives it one: a reusable form named "<workflow> — start form" with the start form's fields, grid and theme, a header with the workflow's name, and a **Submit** button that **starts this workflow** with every field mapped to the matching input (numbers stay numbers, checkboxes booleans), run as the person who submits, then shows "Thanks — your request has been submitted" with the run reference. The workflow itself does not change: Run, API and CLI starts with inputs keep working. The workflow shows **Published as form page: /f/<id>** with Copy, Open and QR code; the form shows **Form page · starts <workflow>** in the Forms library. Publishing and updating need **Edit forms** and **Activate workflows** (the Start workflow action runs for whoever submits); unpublishing needs **Delete forms**.
- **Keeping it in sync:** the page follows the start form of the **published** version (the one runs use). When that start form changes, the panel asks **Start form changed — update form page?** and one click copies it again as a new form version. The update rewrites only what came from the start form (fields, grid, theme, the input mapping); the header, button labels and success screen stay as you edited them. If someone edited those copied parts on the form, it says so and never overwrites them without asking. **Unpublish** deletes the form (its versions and submissions); like any form, it can't be deleted while a workflow step uses it.
- **Export, import and packages:** the page travels with its workflow. Exporting a workflow with its dependencies brings its form page, and the link survives the import: the workflow id is remapped and the page is still linked and in sync.
- **Task triggers:** a task trigger's **Task form** declares the fields the triggering task carries, so they appear in the data picker as \`{{task.data.<key>}}\`.

## Form pages and QR codes

Every reusable form has a page at \`/f/<id>\`. Wherever its link appears (the workflow page's **Form link** panel, workflow list rows, the **Form submitted** trigger settings, a start form's form page and the Forms library) it is the absolute address on the instance's public app URL (\`APP_URL\`), with **Copy link**, **Open form** and **QR code**.

**QR code** opens a dialog with the code for the link: dark modules on a white card with a quiet zone in every theme (light, dark or custom), so it scans on screen and in print. **Download PNG** (at least 1024 px) or **Download SVG**, with or without the form's name and the link printed under the code, and **Copy link**. The code is drawn on the server; nothing extra is downloaded to the browser. Set \`APP_URL\` before you print codes: a code made on \`localhost\` only works on that machine.

## Validation is enforced on the server

Every way of saving or completing a task — the task screen, \`POST /api/v1/tasks/{id}/action\`, \`PATCH /api/v1/tasks/{id}\`, the MCP task tools and the CLI — checks the values against the form: types, required fields (hidden fields are skipped), ranges, lengths, patterns, options, people, lookup values and attachments (only files uploaded into that task, re-read from the server's records). Read-only fields keep their value whatever is sent. Invalid values are refused with one message per field and nothing is recorded. Form pages, the Run dialog, Save & Test and \`POST /api/v1/forms/{id}/submit\` go through the same checks.

## Related

- [Fields and outcomes](/docs/tasks/fields-and-outcomes) — outcomes as buttons and edges, several assignees
- [Triggers](/docs/workflows/triggers) — Form submitted and task triggers
- [The data picker](/docs/workflows/api-responses#the-data-picker) and [Loops over files](/docs/workflows/api-responses#loops-over-files)
- [Document actions](/docs/workflows/documents) — read, compare, convert and redact the files an Attachments field collects
- [Workspace theme](/docs/governance/workspace-theme) — the full theme forms build on
- [Packages](/docs/packages) — forms travel with the workflows that use them
`,
  },
  {
    slug: 'tasks/assignment-and-slas',
    title: 'Assignment, SLAs and escalation',
    description: 'Assign tasks to people or teams, set due dates, send reminders, escalate overdue work and allow redirects.',
    body: `
## Assignment

- **Individual** — \`assignee_id\`, or \`assignee_variable\` to take the user id from a variable (for example the requester's manager returned by an integration).
- **Team** — \`team_id\`: the task goes to the team's queue.

## Due dates

\`due_date_mode\` sets an exact \`due_date\` or an offset from creation (\`due_offset_amount\` + \`due_offset_unit\`). Overdue tasks are flagged in lists and reports (\`task.is_overdue\`).

## Reminders

\`reminders\` send notifications before or after the due date. The reminder sweep runs every 5 minutes.

## Escalation

With \`escalation_enabled\`, a task that is still open after \`escalate_after_minutes\` is escalated to a user (\`escalation_user_id\`), a team (\`escalation_team_id\`) or the assignee's manager. Escalations are recorded (\`task.escalated\` events) and visible on the task.

## Redirects

\`allow_redirect\` lets the assignee hand the task to someone else. Options:

- \`redirect_assignment_mode\` \`single\` or \`many\` recipients, with an optional cap (\`redirect_recipient_limit_mode\`, \`redirect_recipient_limit\`);
- \`allow_invite_on_redirect\` invites a person by email if they are not yet a member (with \`redirect_invite_role\`).

## Notifications

Assignment notifications use the workspace default, or an [email template](/docs/email-templates) chosen with \`notification_template_id\`.
`,
  },
  {
    slug: 'tasks/manager-view',
    title: 'Manager view and acting on behalf',
    description: 'Managers see their reports\' open tasks with workload per person, act on a task on the assignee\'s behalf with a note, and reassign work.',
    body: `
## Reporting lines

Each workspace member can have a **manager** in that workspace. Set it on the **Team** page (**Reporting lines**: pick a manager per member; needs **Manage roles**), with \`PUT /api/v1/users/{id}/manager\`, MCP \`users_manager_set\` or \`usertasks users set-manager <id> --set manager_user_id=<manager-id>\` (\`--set manager_user_id:=null\` clears it); \`usertasks users reports me\` lists your reports. A member cannot manage themselves and loops are refused.

Directory sync fills reporting lines from the directory's manager attribute:

| Directory | Attribute |
|---|---|
| Microsoft Entra ID | \`manager\` (Graph \`$expand=manager\`) |
| Okta | \`profile.managerId\` (an Okta id, login or email) |
| Google Workspace | \`relations\` of type \`manager\` (an email) |
| LDAP / Active Directory | \`manager\` (a DN; change it under the attribute mapping) |
| SCIM | enterprise extension \`manager.value\` (the manager's SCIM id) |

A line the directory sets is marked **From directory sync** and replaced on the next sync; a manager the directory names but who is not synced into the workspace leaves the line as it is.

Anyone with at least one direct report is a **manager**. Indirect reports are their reports' reports, up to 10 levels.

## My team

**Tasks → My team** appears for managers only. It lists the open tasks of your direct reports (tick **Include indirect reports** for every level) with:

- **workload** per person — open, overdue and SLA-breached counts (click a person to filter);
- filters for person, status, priority, workflow, **Overdue** and **SLA breached** (the waiting run's SLA is breached or the task's escalation fired);
- grouping by person, overdue due dates highlighted;
- **Act on behalf** and **Reassign** on each task.

On a phone the list is read-only.

The same view is \`GET /api/v1/tasks?scope=reports\` (\`indirect\`, \`assignee_id\`, \`status\`, \`priority\`, \`workflow_id\`, \`overdue\`, \`sla_breached\`), MCP \`tasks_list\` with \`scope: "reports"\` and \`usertasks tasks team\`. It returns \`reports\` (workload per person) and \`tasks\`, and needs a user (a user-bound key or OAuth token) and **View own tasks**.

## Acting on behalf

Open a report's task. A banner says you are acting on behalf of the assignee and asks for a **reason**; the outcome buttons, form buttons and **Save** then act for them. What happens:

- the response counts as the assignee's (completion rules are unchanged);
- the task records \`actioned_by\` = you and \`actioned_on_behalf_of\` = the assignee;
- the history shows *on behalf of …* on the event, the lifecycle event carries \`on_behalf_of\`, \`on_behalf_note\` and \`acted_as\` (\`on_behalf\` or \`break_glass\`) — so do the event stream (\`task.task_response\`) and log export;
- an audit row (\`act_on_behalf\` / \`break_glass\` on the task) is written;
- the assignee gets a notification and an email with your reason;
- the resumed workflow sees \`{{actioned_by}}\`, \`{{actioned_on_behalf_of}}\`, \`{{actioned_on_behalf_of_name}}\` and \`{{on_behalf_note}}\`, and \`{{task.actioned_on_behalf_of}}\` is set on the task.

By API: \`POST /api/v1/tasks/{id}/action\` with \`"on_behalf": true\` and \`"on_behalf_note"\` (MCP \`tasks_complete_workflow\` / \`tasks_respond\` with \`on_behalf\`, CLI \`usertasks tasks complete <id> --on-behalf --note "…"\`). Without \`on_behalf\` a manager gets 403, as does anyone outside the assignee's manager chain.

## Reassigning a report's task

**Reassign** moves a report's open task to another of your reports or to yourself (**Take it myself**), with an optional comment; both people are notified. It needs **Assign tasks**, and a workflow task only moves when its step allows redirects.

## Permissions

| Action | Needs |
|---|---|
| See **My team** | at least one direct report, and **View own tasks** |
| Act on behalf | be in the assignee's manager chain, and **Complete tasks** |
| Act on anyone's task (break-glass) | **Complete any task (break-glass)** — Owner only by default |
| Reassign a report's task | **Assign tasks** |
| Edit reporting lines | **Manage roles** |
`,
  },
  {
    slug: 'tasks/api',
    title: 'Completing tasks by API, MCP and CLI',
    description: 'List assigned tasks and complete them with an outcome and field values from your own application, an AI client or a script.',
    body: `
Completing a task from outside the app does exactly what the outcome button does: field values are validated and saved, the completion rule is applied, and a waiting workflow resumes on the outcome's path (asynchronously, through the queue).

## REST

\`\`\`bash
# tasks assigned to the calling user (user-context key or OAuth token)
curl -H "Authorization: Bearer $USERTASKS_API_KEY" "$USERTASKS_URL/api/v1/tasks/assigned"

# complete one
curl -X POST "$USERTASKS_URL/api/v1/tasks/<task-id>/action" \\
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \\
  -d '{"action":"complete","outcome":"Approved","outcome_notes":"Within budget","values":{"cost_centre":"OPS","amount":12400}}'
# → { "success": true, "data": { "action": "completed", "outcome": "Approved", "workflow_resumed": true, "workflow_status": "queued", "run_id": "…" } }
\`\`\`

\`action\` is one of \`accept\`, \`hold\`, \`reject\`, \`complete\`, \`escalate\` or \`redirect\` (with \`target_user_id(s)\` or \`target_email(s)\`). On a multi-assignee task, \`complete\` may return \`{ "action": "waiting", "responses": 1, "needed": 2 }\` until the completion rule is met.

A workflow task is actioned by its assignee only. A manager adds \`"on_behalf": true, "on_behalf_note": "…"\` (see [Manager view](/docs/tasks/manager-view)). Errors: 403 when you are not the assignee (or not in their manager chain), 404 for a task of another workspace, 409 once the task is closed. A tenant-wide API key has no user, so it needs **Complete any task (break-glass)** to complete a workflow task. Resuming a user task's event directly (\`POST /api/v1/workflows/events/{id}/complete\`) is refused with 409 — complete the task instead.

## Descriptions in API responses

Task responses keep \`description\` as stored (sanitised HTML or plain text) and add \`description_text\` (plain text). If your client cannot render HTML, add \`?strip_html=true\` to \`GET /tasks\`, \`/tasks/assigned\` or \`/tasks/{id}\`, and \`description\` comes back as plain text. MCP \`tasks_get\` takes \`strip_html: true\`. The CLI always asks for plain text; pass \`--html\` to see the stored HTML.

## CLI

\`\`\`bash
usertasks tasks assigned
usertasks tasks complete <task-id> --outcome Approved --notes "Within budget" --set cost_centre=OPS --set amount:=12400
\`\`\`

## MCP

AI clients use \`tasks_list\`, \`tasks_get\`, \`tasks_respond\`, \`tasks_complete_workflow\` (complete with an outcome and field values), \`tasks_redirect\` and \`tasks_escalate\`. The same permissions apply: \`tasks.complete\` to act, and a user-context credential can only act on tasks that user can see.

## SDK

\`\`\`ts
await client.POST('/tasks/{id}/action', {
  path: { id: taskId },
  body: { action: 'complete', outcome: 'Approved', values: { cost_centre: 'OPS' } },
})
\`\`\`
`,
  },
]
