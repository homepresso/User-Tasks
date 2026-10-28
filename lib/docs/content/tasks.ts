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
    title: 'Task forms',
    description: 'Design a User Task form on a grid, reuse it from the Forms library, theme it, and use its values later in the workflow.',
    body: `
A task form is what the assignee fills in on a User Task: typed fields placed on a simple grid, with an optional theme. The same designer builds the start form of a workflow (its inputs) and declares the form fields a task trigger expects.

## The form designer

Open a **User Task** and choose **Form → Design form**. The dialog has three parts:

- **Palette** (left): text, long text, number, currency, email, phone, URL, date, date and time, checkbox, single select, multi-select, person, autocomplete / lookup, section heading and divider. Drag a type onto the grid, or select it and press Enter to add it in a new row.
- **Grid** (centre): rows of 1 to 4 columns. Choose the column count per row, add, move and remove rows, drag fields between cells, and set how many columns a field spans. Dropping onto a full row puts the field in a new row below it.
- **Properties** (right): the selected field's label, key, type, width, help text, placeholder, required, read-only, default value (expressions and the **Insert data** picker work), validation (min / max, length, pattern with a message, date range, selection count), options with values and labels (or loaded from a data table column when the task is created) and **Visible when** (show the field only when another field equals / doesn't equal / contains a value, or has a value). The **Form theme** tab styles the form.

**Preview** shows exactly what the assignee sees, in light or dark mode and at desktop or phone width, with **Check validation** to try the rules. On phones every row collapses to one column.

The designer has undo and redo (**Ctrl+Z**, **Ctrl+Shift+Z** or **Ctrl+Y** outside text boxes) and asks before closing with unsaved changes.

### Keyboard

Tab to a field on the grid. **Alt+←/→** moves it within its row, **Alt+↑/↓** moves it to the row above or below, **Delete** removes it and **Enter** selects it for the properties panel. Every palette item is a button.

## Keys and downstream data

Each field has a key, generated in snake_case from its label until you edit it. Keys are unique, lowercase and can't be reserved names (\`outcome\`, \`task_data\`, \`id\`…). After the task, every value is available to later steps as \`{{task_data.<key>}}\`, and the **Insert data** picker lists each field with its label and type. Values are typed: numbers and currency are numbers, checkboxes are true / false, dates are ISO strings and multi-selects are arrays.

Renaming a key that later steps use opens a list of those references (step, setting and count) and offers to update them to the new key or keep them as they are.

## Autocomplete lookup fields

An **Autocomplete / lookup** field suggests values as the assignee types, from a **data table** or an **API reference**, and stores the one they pick.

**Data table.** Choose the table, the **columns to search** (one or more, matched case-insensitively — *contains* or *starts with*), the **columns to show** (the first is the main text of a suggestion, the others its second line) and the column **stored as the value** (the row id by default). **Only rows where** adds fixed filters (column, operator, value); a value can use another field of the form (\`{{task_data.region}}\`), the task (\`{{task.title}}\`) or a workflow variable (resolved when the task is created). Set a sort, the maximum number of suggestions (default 10) and the minimum characters before searching (default 1).

**API reference.** Choose the integration and reference, then map its inputs: \`{{search}}\` is what the assignee types, \`{{task_data.<key>}}\` another field, or a fixed value. Pick the **results list** from the reference's response model (the same model the data picker uses — test the reference once to capture it), then the item fields to show and the field stored as the value. **Wait after typing** debounces calls (default 300 ms) and **Cache responses** reuses a response for the same inputs for up to an hour.

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

## Forms on their own page

Every reusable form has its own page, \`/f/<form id>\`, for signed-in members with **Submit forms** (every role by default): **Open form** and **Copy link** in the library. The page shows the header, the fields (lookups included), the theme and the buttons. Submissions are stored (\`form_submissions\`): **Submissions** in the library lists them (everyone sees their own; **Edit forms** sees all), shows one submission and exports CSV as a background job. A form can delete submissions older than a number of days (\`submission_retention_days\`). The API submits too: \`POST /api/v1/forms/{id}/submit\` (\`{ values, button_id, idempotency_key }\`), \`GET /api/v1/forms/{id}/submissions\`, \`GET /api/v1/form-submissions/{id}\`, MCP \`forms_submit\` / \`forms_submissions_list\` / \`forms_submission_get\` / \`forms_lookup\` and \`usertasks forms submit|submissions|lookup\`. Anonymous (public) submission is not offered yet.

## The Form submitted trigger

A workflow can start whenever a reusable form is submitted: **Form Submitted** trigger → choose the form (and optionally the buttons / outcomes that count). It fires for every submission — the form's page, the API and MCP, and a User Task whose form is linked to it (with \`{{form_outcome}}\` and \`{{task_id}}\`). Every field is available downstream, typed, as \`{{form.<key>}}\` (\`{{form.<key>_item}}\` for lookups), with \`{{submitted_by_name}}\`, \`{{submitted_at}}\`, \`{{form_button}}\`, \`{{form_version}}\` and \`{{form_submission_id}}\` — all in the data picker. Each submission is also a \`form.submitted\` event in the event stream (and so in log export destinations), without the values.

Used as a task form instead (a User Task linked to the form), the same form renders inside the task — header, theme and buttons included — and its values come back as \`{{task_data.<key>}}\`.

## Reusable forms

**Automations → Forms** is the library: search and filter by tag, create, edit, duplicate and delete forms, and see which workflow steps use each one. In the designer, **Save as reusable form** saves the form to the library and links the step to it; **Use a saved form** links an existing one.

- A linked step shows **Linked to form "…" vN**. Saving in the designer can create a new version of the form or **Detach and save here** (the step keeps a local copy). **Detach** on the step does the same without opening the designer.
- Every change to a form's fields, layout or theme creates a new version; name, description and tag changes don't.
- **Drafts follow the latest version** of a linked form. **Publishing pins** the version in use, so a published workflow keeps its form until you publish again.
- A form that workflows use can't be deleted; the error lists where it is used.

Forms need the **View forms**, **Edit forms** and **Delete forms** permissions (Owner, Admin and Manager have all three; Member and Viewer can view). They travel with config-as-code, GitHub sync and packages (a workflow that links a form brings it, and its saved theme, along), and have REST (\`/api/v1/forms\`, \`/api/v1/form-themes\`), MCP (\`forms_*\`, \`form_themes_*\`) and CLI (\`usertasks forms …\`) commands.

## Form themes

By default a form uses the workspace theme. The **Form theme** tab can instead set a small set of overrides, starting from any built-in theme preset:

- accent colour (buttons, focus ring, selection), background and text colour, separately for light and dark mode
- the page behind the form (a colour, or a gradient to a second colour — standalone form pages, the frame around a task form, the designer preview), the input background, border colour and primary button colour (derived from the accent unless you set one), per mode
- corner radius, font (from the workspace theme's fonts), density (comfortable or compact), label position (above or left of the input) and where the buttons sit (right, left or full width)
- an optional header with a title, subtitle, banner colour and the workspace logo

The theme covers the whole form: page, card, header banner, headings and dividers, inputs (background, border, focus ring, placeholder), help and error text, buttons, the autocomplete list and chips, checkboxes and radio buttons, the date picker's light / dark, messages, the success screen and the Cancel confirmation. Every text / background pair the form draws is kept legible — AA (4.5:1) for text, 3:1 for input borders and the focus ring; a mid-tone background on which neither white nor dark text would pass is nudged until one does. Contrast is checked against the workspace theme in both modes. Low-contrast pairs are listed with an **Auto-fix**, and the form always raises them when it is drawn, so text is never illegible. A theme whose own text and background are below 3:1 can't be saved. Without dark colours, dark mode keeps the workspace's dark palette with your accent.

Save a theme to reuse it (**Save as a reusable form theme**, or **Automations → Forms → Form themes**). Tasks keep the theme they were created with.

## Start forms and task triggers

- **Start form:** in the workflow settings (nothing selected on the canvas), **Design start form** edits the workflow inputs (text, number, checkbox, date, date and time, email, URL and single select) on a grid with a theme. The Run dialog and the form shown for API and CLI starts follow it. **From a saved form** copies a library form's fields as inputs.
- **Publish as form page:** a start form opens from **Run** and API / CLI starts; it has no page of its own. **Publish as form page** (the workflow page's **Form link** panel, the start form settings, or the trigger node's settings) gives it one: a reusable form named "<workflow> — start form" with the start form's fields, grid and theme, a header with the workflow's name, and a **Submit** button that **starts this workflow** with every field mapped to the matching input (numbers stay numbers, checkboxes booleans), run as the person who submits, then shows "Thanks — your request has been submitted" with the run reference. The workflow itself does not change: Run, API and CLI starts with inputs keep working. The workflow shows **Published as form page: /f/<id>** with Copy, Open and QR code; the form shows **Form page · starts <workflow>** in the Forms library. Publishing and updating need **Edit forms** and **Activate workflows** (the Start workflow action runs for whoever submits); unpublishing needs **Delete forms**.
- **Keeping it in sync:** the page follows the start form of the **published** version (the one runs use). When that start form changes, the panel asks **Start form changed — update form page?** and one click copies it again as a new form version. The update rewrites only what came from the start form (fields, grid, theme, the input mapping); the header, button labels and success screen stay as you edited them. If someone edited those copied parts on the form, it says so and never overwrites them without asking. **Unpublish** deletes the form (its versions and submissions); like any form, it can't be deleted while a workflow step uses it.
- **Export, import and packages:** the page travels with its workflow. Exporting a workflow with its dependencies brings its form page, and the link survives the import: the workflow id is remapped and the page is still linked and in sync.
- **Task triggers:** a task trigger's **Task form** declares the fields the triggering task carries, so they appear in the data picker as \`{{task.data.<key>}}\`.

## Form pages and QR codes

Every reusable form has a page at \`/f/<id>\`. Wherever its link appears (the workflow page's **Form link** panel, workflow list rows, the **Form submitted** trigger settings, a start form's form page and the Forms library) it is the absolute address on the instance's public app URL (\`APP_URL\`), with **Copy link**, **Open form** and **QR code**.

**QR code** opens a dialog with the code for the link: dark modules on a white card with a quiet zone in every theme (light, dark or custom), so it scans on screen and in print. **Download PNG** (at least 1024 px) or **Download SVG**, with or without the form's name and the link printed under the code, and **Copy link**. The code is drawn on the server; nothing extra is downloaded to the browser. Set \`APP_URL\` before you print codes: a code made on \`localhost\` only works on that machine.

## Validation is enforced on the server

Every way of saving or completing a task — the task screen, \`POST /api/v1/tasks/{id}/action\`, \`PATCH /api/v1/tasks/{id}\`, the MCP task tools and the CLI — checks the values against the form: types, required fields (hidden fields are skipped), ranges, lengths, patterns, options, people and lookup values. Read-only fields keep their value whatever is sent. Invalid values are refused with one message per field and nothing is recorded.

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

A form without \`form_layout\` renders as it always has. Opening it in the designer shows one field per row and doesn't change anything until you edit it.
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
