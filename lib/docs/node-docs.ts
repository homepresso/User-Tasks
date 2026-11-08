import type { NodeType } from '@/lib/workflow-schema'

/**
 * Hand-written notes for the generated node reference (/docs/workflows/nodes).
 * Labels, categories and descriptions come from NODE_CATALOG, required
 * settings from validateNode() and the canvas summary from
 * getNodeConfigSummary(), so only the parts the code cannot tell us live
 * here. Typed as Record<NodeType, …> and covered by __tests__/docs-reference.test.ts,
 * so a new node type fails the build until it is documented.
 */
export interface NodeDoc {
  /** Main settings, in prose (config keys in backticks). */
  settings: string
  /** Variables the node sets for later nodes. */
  outputs?: string
  /** Representative `config` object, shown as JSON with its canvas summary. */
  example?: Record<string, unknown>
}

const TASK_TRIGGER = 'Optional filters narrow which tasks start a run. The task is available as `{{task.*}}` (title, status, priority, assignee) and its fields as `{{task_data.*}}`. An optional **Task form** (`fields`, designed in the form designer or linked from the Forms library) declares the fields the task carries, so they appear in the data picker as `{{task.data.<key>}}`.'

export const NODE_DOCS: Record<NodeType, NodeDoc> = {
  // ─── Triggers ───
  task_created: { settings: TASK_TRIGGER, outputs: 'Trigger variables for the task: `task_id`, `task.*`, `task_data.*`.' },
  task_received: { settings: `Fires when a task is assigned (queued or added straight to the assignee's list). ${TASK_TRIGGER}`, outputs: 'Task trigger variables.' },
  task_submitted: { settings: `Fires when an assignee accepts a queued task. ${TASK_TRIGGER}`, outputs: 'Task trigger variables.' },
  task_updated: { settings: `Fires on task edits (status, priority, assignee, fields). ${TASK_TRIGGER}`, outputs: 'Task trigger variables plus the changed values.' },
  task_completed: { settings: `Fires when a task is completed. ${TASK_TRIGGER}`, outputs: 'Task trigger variables, `outcome` and `outcome_notes`.' },
  task_rejected: { settings: `Fires when an assignee declines a queued task. ${TASK_TRIGGER}`, outputs: 'Task trigger variables.' },
  workflow_error: {
    settings: '`error_scope` chooses any workflow or specific `workflow_ids`. Use it to build one central error handler that notifies, logs or retries.',
    outputs: '`error_workflow_id`, `error_workflow_name`, `error_run_id`, `error_message`, `error_node`, `error_timestamp`.',
    example: { error_scope: 'specific', workflow_ids: ['<workflow-id>'] },
  },
  workflow_sla: {
    settings: '`workflow_scope` / `workflow_ids` choose the workflows; `event_types` picks warning, breach or both.',
    outputs: 'The run, workflow, SLA label, due time and SLA status.',
  },
  retention_policy_review: {
    settings: '`policy_scope` / `policy_ids` choose which retention policies start a review run.',
    outputs: 'Policy id and name, the asset under review and its due date.',
  },
  retention_policy_executed: {
    settings: '`policy_scope` / `policy_ids` choose the policies; `action_types` filters purge, archive or other actions.',
    outputs: 'Policy, action type and affected asset.',
  },
  data_table_event: {
    settings: '`table_id` picks the data table (any table when empty) and `event_types` the row events (`created`, `updated`, `deleted`; all when empty).',
    outputs: '`data_event_type`, `data_table_id`, `data_table_name`, `row_id`, `row` (the row values) and one variable per column.',
    example: { table_id: '<table-id>', event_types: ['created', 'updated'] },
  },
  form_submitted: {
    settings: '`form_id` picks a reusable form (from the Forms library); `button_ids` optionally limits it to some buttons or outcomes (any when empty). Fires for every submission — the form\'s own page (`/f/<id>`), `POST /api/v1/forms/{id}/submit`, MCP `forms_submit`, and a User Task whose form is linked to it. A cached copy of the form\'s fields (`fields`) types the payload in the data picker — see /docs/tasks/forms.',
    outputs: '`form.<key>` for every field (typed; `form.<key>_item` for lookups), `form_id`, `form_name`, `form_version`, `form_submission_id`, `form_button`, `form_outcome`, `form_source` (standalone, api, task), `submitted_by`, `submitted_by_name`, `submitted_by_email`, `submitted_at` and `task_id` for task forms; `submission` — the submission metadata, set by the server: `submission.id`, `submission.reference` (the short reference people see), `submission.submitted_at`, `submission.submitted_by.id` / `.name` / `.email`, `submission.form.id` / `.name` / `.version`, `submission.source` (page, run_dialog, api, task, test), `submission.button`, `submission.outcome`, `submission.task_id` and `submission.url_params`.',
    example: { form_id: '<form-id>', form_name: 'Customer complaint', button_ids: ['submit'] },
  },
  middleware_received: {
    settings: 'Receives an inbound webhook and holds the HTTP response open until the run finishes, so the workflow can validate, enrich or route a request synchronously. Keep these runs short.',
    outputs: 'The request body (`_raw` and mapped fields); the final variables become the response.',
  },
  schedule: {
    settings: '`schedule_mode` is `every_minutes` (`interval_minutes`), `hourly` (`minute_of_hour`), `daily` / `weekly` / `monthly` (`time_of_day`, `day_of_week`, `day_of_month`) or `once` (`run_at`), with an IANA `timezone`. Each occurrence fires exactly once; a missed slot catches up only the most recent occurrence.',
    outputs: '`scheduled_at` and the workflow\'s variables.',
    example: { schedule_mode: 'daily', time_of_day: '06:30', timezone: 'Europe/London' },
  },
  webhook_received: {
    settings: 'Create an inbound webhook for the workflow (Settings → Webhooks or `usertasks webhooks create <workflow-id>`); callers POST JSON to `/api/webhooks/inbound?hook=<slug>` with the webhook\'s secret as a Bearer token. A payload mapping can rename fields into variables.',
    outputs: '`_raw` (the full body) and one variable per mapped field.',
  },

  esign_event: {
    settings: '`integration_id` — an e-signature connection (DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, SignNow or BoldSign; empty = any); `events` — any of `envelope_sent`, `recipient_viewed`, `recipient_signed`, `envelope_completed`, `envelope_declined`, `envelope_voided`, `envelope_expired` (empty = all). Fires on verified webhook deliveries (and when a Wait for signature poll sees an envelope finish). See /docs/integrations/e-signature.',
    outputs: '`esign_event`, `esign_provider`, `esign_integration_id`, `esign_envelope_id`, `esign_status`, `esign_recipient` (`name`, `email`, `role`, `status`, `signed_at`) and `esign_envelope` (status and recipients read back from the provider).',
    example: { integration_id: '<integration-id>', events: ['envelope_completed', 'envelope_declined'] },
  },

  // ─── Logic & flow ───
  condition: {
    settings: '`branches` is an ordered list of if / else-if branches, each with rules (`field`, `operator`, `value`) joined by AND/OR; `has_else` adds an Else path. Connect one edge per branch label. Operators: `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `in` (comma-separated list), `matches` (regular expression), `gt`, `gte`, `lt`, `lte` (also `greater_than`, `>=`, …), `is_empty`, `is_not_empty`, `is_true`, `is_false`. `is_true` / `is_false` need no value: `true`, `"true"`, `1`, `"1"`, `"yes"` and `"on"` are true; `false`, `"false"`, `0`, `"0"`, `""`, `"no"`, `"off"` and a missing value are false.',
    example: { branches: [{ label: 'Large', logic: 'and', rules: [{ field: '{{amount}}', operator: 'greater_than', value: '10000' }] }], has_else: true },
  },
  switch_case: {
    settings: '`field` is the value to test, `cases` the values (one outgoing edge each), `has_default` adds a fallback path.',
    example: { field: '{{region}}', cases: [{ value: 'EU' }, { value: 'US' }], has_default: true },
  },
  loop: {
    settings: '`items` is the collection to iterate (the field suggests every list available at that point, including a form\'s Attachments field — `{{task_data.<key>}}` / `{{form.<key>}}`); `item_var` (default `item`) and `index_var` (default `index`) name the loop variables. Nodes connected to the loop body run once per item, and the data picker shows the item\'s fields there as Current item (for files: `{{item.name}}`, `{{item.size}}`, `{{item.mime_type}}`, `{{item.url}}`).',
    outputs: '`{{item}}` and `{{index}}` inside the body.',
    example: { items: '{{vendors}}', item_var: 'vendor' },
  },
  loop_n_times: {
    settings: '`count` repetitions with `index_var` (default `i`).',
    outputs: '`{{i}}` inside the body.',
    example: { count: 3 },
  },
  delay: {
    settings: '`duration` and `unit` (`seconds`, `minutes`, `hours`, `days`). Waits of up to 30 seconds happen inline; longer waits pause the run (status `waiting_for_event`) and a queued `delay_resume` job continues it. `{ seconds: 5 }` (or `minutes` / `hours` / `days`) is read as `duration` + `unit`.',
    outputs: '`delay_ms`, `resume_at`.',
    example: { duration: 2, unit: 'hours' },
  },
  pause_until: {
    settings: '`date` is an ISO date/time or expression. The run pauses and resumes from the queue at that time.',
    example: { date: '{{=ADD_DAYS(NOW(), 1)}}' },
  },
  end_workflow: { settings: 'Stops the run immediately with status completed. Optional `reason` is written to the run log.' },
  goto_activity: {
    settings: '`target_node_id` is the activity to jump to; `input_overrides` can reset variables first. Useful for rework loops (send back to the requester, then re-approve).',
    example: { target_node_id: '<node-id>', target_node_label: 'Manager approval' },
  },
  parallel: {
    settings: '`branches` (two or more) and `mode`: `parallel` runs every branch at once, `sequential` one after another. Connect each branch with an edge labelled with its name. A step two or more branches lead to (the join) runs once, after every branch that can reach it has finished (arrived there, or ended on a path that skips it), with every branch\'s variables; on a variable more than one branch set, the later branch in the list wins. An edge labelled `Done` (or with no label) runs once, after every branch and join has finished, with all branch variables, like a loop\'s Done. Branches that never meet and have no Done edge each run to their own end; the run finishes when all have. A branch that waits (user task, long delay) pauses the run: the other branches carry on, and the join or Done step runs when the last branch resumes and reaches it. If a step in a branch fails and its On error is stop, the run fails once the other branches have finished, and the join and Done steps do not run; with continue, the branch carries on.',
    example: { mode: 'parallel', branches: [{ label: 'Notify finance' }, { label: 'Update ERP' }] },
  },

  // ─── Operations ───
  set_title: { settings: '`title` sets the run\'s display title (shown in run lists, reports and the task tracker). Expressions allowed.', example: { title: 'Invoice {{invoice_number}} — {{vendor.name}}' } },
  set_sla: {
    settings: '`mode` `relative` (`amount` + `unit`) or `exact` (`due_at`). `amount` and `warning_amount` accept a number or an expression (`{{sla_days}}`, `{{=ADD(base_days, 2)}}`), resolved when the node runs; a non-numeric or non-positive amount fails the node with a message naming the value; optional warning threshold (`warning_amount`/`warning_unit` or `warning_at`) and `sla_label`. SLA warnings and breaches fire `workflow_sla` triggers and appear in reports and the event stream.',
    example: { sla_label: 'Invoice approval', mode: 'relative', amount: 3, unit: 'days', warning_amount: 1, warning_unit: 'days' },
  },
  set_variable: {
    settings: '`assignments`: an ordered list of `{ name, expression }` rows, so one node can set several variables. Each value is resolved with the full expression syntax (a literal, `{{variable}}` or `{{=FUNCTION()}}`). Rows run top to bottom, so a later row can use a variable set by an earlier one. Names must be filled in and unique within the node. If a row fails to resolve, the node fails with an error naming that variable; rows above it stay set. The single form `{ name, expression }` (older workflows) still works.',
    outputs: 'Each variable by its name. The node output lists `assignments` (name and value per row).',
    example: { assignments: [{ name: 'needs_cfo', expression: '{{=IF(amount > 50000, true, false)}}' }, { name: 'approver_role', expression: '{{=IF(needs_cfo, "CFO", "Manager")}}' }] },
  },
  math: { settings: '`expression` is evaluated as arithmetic over variables (`+ - * / %`, parentheses); `output_var` (default `result`).', outputs: 'The number in `output_var`.', example: { expression: '{{subtotal}} * 1.2', output_var: 'total' } },
  modify_string: {
    settings: '`input` and `operation`: `uppercase`, `lowercase`, `trim`, `trim_start`, `trim_end`, `replace` (`search`, `replace_with`, `replace_all`), `substring` (`start`, `end`), `pad_start` / `pad_end` (`length`, `pad_char`), `reverse` or `slug`. `upper` / `lower` are read as `uppercase` / `lowercase`.',
    outputs: '`output_var`.',
    example: { input: '{{vendor.name}}', operation: 'slug', output_var: 'vendor_slug' },
  },
  text_template: { settings: '`template` with `{{variables}}` and inline functions; `output_var` (default `text`).', example: { template: 'Invoice {{invoice_number}} for {{=FORMAT_NUMBER(amount, 2)}} {{currency}}', output_var: 'summary' } },
  format_date: { settings: '`date` (default now) and `format`: `iso`, `date`, `time`, `datetime`, `short`, `relative` or `custom` with `custom_format` (tokens `YYYY` `YY` `MMMM` `MMM` `MM` `M` `DD` `D` `dddd` `ddd` `HH` `H` `hh` `h` `mm` `ss` `A`; text in `[brackets]` is kept); `output_var` (default `formatted_date`). A pattern given in `format` (`"YYYY-MM-DD"`) is treated as `custom`, and `input` is read as `date`.', example: { date: '{{due_date}}', format: 'custom', custom_format: 'DD/MM/YYYY' } },
  date_math: { settings: '`operation` `add` / `subtract` (`amount`, `unit` minutes … years) or `interval` between `date` and `date2` (returns ms, seconds, minutes, hours, days); `output_var`. `input` is read as `date`.', example: { date: '{{received_at}}', operation: 'add', amount: 30, unit: 'days', output_var: 'pay_by' } },
  regex: { settings: '`input`, `pattern`, `flags` (default `g`) and `operation`: `match`, `test`, `replace` (`replace_with`) or `split`. Patterns are checked for catastrophic backtracking before they run.', example: { input: '{{reference}}', pattern: 'INV-(\\d+)', operation: 'match', output_var: 'invoice_match' } },
  json_build_object: { settings: '`fields` (key/value pairs, values may be expressions); `source_var` merges into an existing object; `output_var` (default `json_object`).', example: { fields: [{ key: 'vendor', value: '{{vendor.id}}' }, { key: 'amount', value: '{{amount}}' }], output_var: 'payment' } },
  json_build_array: { settings: '`items` (`[{ value }]`, each value an expression; plain values are accepted too) builds a new array, or `source_var` pushes into an existing one; `output_var`.', example: { items: [{ value: '{{a}}' }, { value: '{{b}}' }], output_var: 'pair' } },
  json_add_to_array: { settings: '`array_var` is the array variable to append to; `fields` builds the object to push (or `value`).', example: { array_var: 'lines', fields: [{ key: 'sku', value: '{{item.sku}}' }] } },
  json_get_value: { settings: '`source` object or array and a dotted `path` (`items.0.price`); `output_var` (default `json_value`).', example: { source: '{{response}}', path: 'data.vendor.risk', output_var: 'risk' } },
  check_permission: { settings: '`user_id` and `permission` (a key from the permissions table). Branch on the result.', outputs: '`has_permission`, `permissions`.', example: { user_id: '{{task.assignee_id}}', permission: 'tasks.complete' } },

  // ─── Collections ───
  collection_count: { settings: '`collection`; `output_var` (default `count`).', example: { collection: '{{lines}}', output_var: 'line_count' } },
  collection_get: { settings: '`collection` and `by`: `index` (`index`), `last`, or `key` (`key_field` + `key`); `output_var`.', example: { collection: '{{vendors}}', by: 'key', key_field: 'id', key: '{{vendor_id}}', output_var: 'vendor' } },
  collection_filter: { settings: '`collection`, item `field`, `operator` and `value`; `output_var`.', example: { collection: '{{lines}}', field: 'amount', operator: 'greater_than', value: '0', output_var: 'billable' } },
  collection_sort: { settings: '`collection`, `field` and `direction` (`asc`/`desc`); `output_var`.', example: { collection: '{{lines}}', field: 'amount', direction: 'desc' } },
  collection_unique: { settings: '`collection` and optional `field` to deduplicate on; `output_var`.', example: { collection: '{{emails}}' } },
  collection_join: { settings: '`collection`, `separator` and optional `field` to join; `output_var`.', example: { collection: '{{lines}}', field: 'sku', separator: ', ' } },

  // ─── Actions ───
  update_task: { settings: '`field` (one of the workflow-updatable task fields such as `status`, `priority`, `due_date`, `assignee_id`, `title`) and `value`.', example: { field: 'priority', value: 'high' } },
  update_data_table: {
    settings: '`table_id` and `operation`: `insert`, `get`, `update`, `delete`, `list` (with `filters`, `sort_column`, `limit`, `offset`) or `set_retention`. Rows are matched by `row_id` or `match_column` + `match_value`; `column_values` / `field_mappings` supply values. Output variable names are configurable (`output_row_var`, `output_rows_var`, `output_count_var`, `output_row_id_var`). `get` writes the row to `output_row_var` (`{{row.status}}`) and each column as `{{<prefix>_<column>}}` (prefix: the output prefix or the node label in snake case). Columns are also copied to top-level variables for older workflows, except where the name is a workflow input or a run variable (`task_id`, `workflow_id`, `outcome`, `item`, …) — those are left unchanged and a warning is logged. Prefer `{{row.<column>}}`.',
    example: { table_id: '<vendors-table-id>', table_name: 'Vendors', operation: 'get', match_column: 'vendor_id', match_value: '{{vendor_id}}' },
  },
  retention_policies: { settings: '`operation`: `list_policies`, `create_policy` (`name`, `policy_mode`, `duration_value`/`duration_unit` or `exact_date`, `applies_to`), `delete_policy`, `list_assets` or `assign_policy` (`target_type` data_table / data_row / role, `target_id`).', outputs: '`policies`, `policy`, `assets`, counts.' },
  call_reference: {
    settings: '`reference_id` picks an integration reference (a saved REST/OData/database operation). `input_mappings` fill its inputs from variables; `output_mappings` copy response fields into variables and `custom_outputs` (`[{ name, path }]`, added with + in the response model tree) read any path of the response. `_ref_response_schema` is a snapshot of the reference\'s response model for the data picker. A file input (the `content` of a storage connector upload — S3, Azure Blob, SharePoint, OneDrive, Box, Google Drive) takes a file object such as `{{item}}` from a Loop over an Attachments field: its bytes and type are sent (multipart for Box and Google Drive), read for the workflow\'s workspace only. Calls are logged with redacted headers and appear in the event stream as `integration.call`. An HTTP error status (4xx/5xx) does not fail the step: the response and status are stored so a Condition can branch on them (for example `{{status}}` `gte` `400`). Only a transport failure (DNS, refused connection, timeout) fails the step, which then follows the node\'s *On error* setting.',
    outputs: '`response`, `status` (the HTTP status code; also `<prefix>_response` / `<prefix>_status`), mapped outputs, custom outputs, and file fields for binary responses. Pick fields with the data picker — see Reading values from an API response.',
    example: { reference_id: '<reference-id>', reference_name: 'Get vendor', reference_method: 'GET', input_mappings: { vendor_id: '{{vendor_id}}' } },
  },
  http_request: {
    settings: '`method`, `url`, `headers`, `params`, `body`, `content_type` (`json`, `form`, `text`, `none`, `multipart` — `multipart` parts `[{ key, value, type: "text" | "file" }]`, a file part sends a file object or each file of a list such as `{{item}}` / `{{task_data.<attachments>}}` — or `binary`, the body is one file\'s bytes) and `auth_type` (`bearer`, `basic`, `api_key`). `_response_schema` (captured from a pasted sample under Response model) makes the response pickable in later steps. Prefer an integration reference for anything reused: references keep credentials encrypted and calls governed. Like Call API / Reference, an HTTP error status (4xx/5xx) is stored rather than failing the step — branch on `{{<prefix>_status}}`; only a transport failure or timeout fails it.',
    outputs: '`response` (or `output_var`) and `<prefix>_status` (the HTTP status code), plus `file` / `file_url` for binary responses.',
    example: { method: 'POST', url: 'https://hooks.example.com/notify', body: '{"invoice":"{{invoice_number}}"}' },
  },
  custom_activity: {
    settings: '`custom_activity_id` (and `custom_activity_key`) picks an enabled [custom workflow action](/docs/workflows/custom-actions); `operation` picks its function; `input_mappings` fill the function\'s typed inputs. `timeout_ms`, `retry_attempts` (default 2, retryable failures only, with exponential backoff) and an optional pinned `custom_activity_version`. The code is always read from the workspace library and runs in the QuickJS WebAssembly sandbox.',
    outputs: 'The function\'s declared outputs as `{{<prefix>_<output>}}` and `{{<output>}}` (typed in the data picker); `<prefix>_outputs` holds them all.',
  },
  create_subtask: { settings: '`title`, optional `assignee` and `parent_task_id` (defaults to the workflow\'s task).', example: { title: 'Collect W-9 from {{vendor.name}}', assignee: '{{requester_id}}' } },
  add_task_attachment: {
    settings: '`file` (a file object from Download File, an HTTP Request, a document step or `{{item}}` in a Loop; a `storage://` reference; a URL; base64 or a data URL), `name`, `type` (e.g. Contract, Invoice, Receipt, Evidence, Image, Other) and `description` (expressions allowed), optional `file_name`, and `task_id` (defaults to the run\'s task, else the latest User Task\'s `{{user_task_id}}`). The file goes through the same checks as uploads (size, content type, blocked types, virus scan) and appears on the task\'s Attachments tab — see /docs/tasks/attachments.',
    outputs: '`attachment` and `<prefix>_attachment`: the attachment `{ id, name, type, description, file_name, mime, size, url, storage_ref, uploaded_by, created_at }`.',
    example: { task_id: '{{user_task_id}}', file: '{{doc_file}}', name: 'Signed contract', type: 'Contract', description: 'Generated by {{workflow_name}}' },
  },
  auto_action: { settings: 'Set the task\'s `status`, `outcome` (+ `outcome_notes`), `acceptance_status`, `priority` or `assignee_id` without a person acting; `target_task_id` defaults to the current task.', example: { status: 'completed', outcome: 'Auto-approved' } },
  log: { settings: '`message` (expressions allowed) is written to the run log and the event stream as `workflow.step.log`.', example: { message: 'Vendor {{vendor.id}} risk {{risk}}' } },
  send_email: {
    settings: '`to` (comma-separated, expressions allowed), `subject` and `body`, or an `email_template_id`; optional `from`, `reply_to` and `attachments` — a file or a list of files: a form\'s Attachments field (`{{task_data.<key>}}` attaches every file), `{{item}}` inside a Loop over them (one), or a generated document; several expressions separated by commas are all attached (up to 20 files, 25 MB). Sent through the configured email provider (Resend by default).',
    outputs: '`sent`, `email_id`, `to` and, with attachments, their names and sizes (never contents).',
    example: { to: '{{requester_email}}', email_template_id: '<template-id>', attachments: '{{task_data.receipts}}' },
  },
  call_sub_workflow: {
    settings: '`sub_workflow_id` and `input_mappings` (variables passed to the child). By default the parent waits for the child to finish (`executionMode: "sync"`); set the node to async to fire and forget.',
    outputs: '`status`, `results` (the child\'s variables) and `error`.',
    example: { sub_workflow_id: '<workflow-id>', sub_workflow_name: 'Vendor onboarding', input_mappings: { vendor_id: '{{vendor_id}}' } },
  },
  decision_table: {
    settings: '`decision_table_id` and `input_mappings` (one per table input). Rules are evaluated in order; the first enabled match wins.',
    outputs: '`matched`, `rule_id`, `rule_label` and `outputs` (each output column), also prefixed with the node\'s output prefix.',
    example: { decision_table_id: '<table-id>', decision_table_name: 'Invoice approval policy', input_mappings: { amount: '{{amount}}', risk: '{{risk}}' } },
  },
  user_task: {
    settings: '`task_title`, `task_description`, `outcomes` (each outcome is an outgoing edge label), a form: typed `fields` (text, long text, number, currency, email, phone, URL, date, date-time, checkbox, single and multi-select, person, autocomplete / lookup from a data table or API reference, attachments, heading, divider) with validation and `visible_when`, an optional grid `form_layout` and `form_theme`, `form_params` (values or workflow `{{variables}}` for the form\'s parameters, read as `{{param.<name>}}`), `field_values` (prefill: a field key → value or `{{expression}}` per field, resolved when the task is created over the field\'s default — e.g. `{ "full_name": "{{form.full_name}}" }` fills a read-only field of a linked form without changing the form), or a linked reusable form (`form_id`; drafts follow its latest version, publishing pins `form_version`) — see /docs/tasks/forms; assignment (`assignment_type` individual, team or aad_group, `assignee_id` or `assignee_variable`, `team_id`; for an Entra ID group `aad_group_id`, `aad_group_mode` claim or everyone and `aad_include_nested` — offered only when Entra ID directory sync is connected, see /docs/tasks/assignment-and-slas), `completion_rule` for multi-assignee tasks (first_response, all_complete, consensus, unanimous, custom), due date, `reminders`, escalation and redirect options, `queue_behaviour` (`rules`, default: follow the assignee\'s [task queue rules](/docs/tasks#task-queue-rules); `queue`: always Queued for the assignee to accept or decline; `add`: always added straight to their list), and an optional `notification_template_id`.',
    outputs: 'While waiting: `user_task_id`, `user_task_title`, `user_task_description` (plain text) and `user_task_description_html`. On resume: `outcome`, `outcome_notes`, `actioned_by` / `actioned_by_name` (who submitted it), `completed_by` / `completed_by_name` / `completed_by_email` and `completed_at` (who completed the task and when, set by the server), `actioned_on_behalf_of` / `actioned_on_behalf_of_name` and `on_behalf_note` (set when a manager acted for the assignee — see /docs/tasks/manager-view), `response_count`, `attachments` (the files on the task\'s Attachments tab — see /docs/tasks/attachments) and `task_data.<field>` for every field (typed: numbers, booleans, ISO dates, multi-select arrays, attachments as a list of file objects `{ id, name, size, mime_type, url, storage_ref, uploaded_by, uploaded_at, checksum_sha256 }`), plus `task_data.<field>_item` (the selected item) for each lookup field and `task_data.<field>_count` for each attachments field.',
    example: { task_title: 'Approve invoice {{invoice_number}}', outcomes: ['Approved', 'Rejected'], assignment_type: 'team', team_id: '<team-id>', fields: [{ key: 'cost_centre', label: 'Cost centre', type: 'choice', options: ['OPS', 'FIN'] }] },
  },
  placeholder: { settings: 'A no-op stand-in while you sketch a flow; `note` explains what goes here.', example: { note: 'Post to ERP once the API is ready' } },
  server_event: {
    settings: '`event_name` plus an optional outbound action: call an integration reference (`reference_id`) or write to a data table (`table_id`), with the payload built from variables.',
    outputs: '`event_id`, `event_name`.',
    example: { event_name: 'invoice.approved' },
  },
  run_agent: {
    settings: '`agent_id`, the prompt in `user_message`, optional `files` (a file or a list, e.g. `{{form.receipts}}` or `{{item}}`: up to 10; images go to vision models as images, PDFs as documents where the API takes them (OpenAI), other documents — and PDFs elsewhere — as extracted text (PDF, Word, Excel, PowerPoint, text); read for the run\'s workspace only; the agent also gets the `read_attached_file` tool; audio and video are not sent to the model: an agent with Media access transcribes them with its `transcribe_media` tool, or transcribe them first with Transcribe Audio / Video and put `{{transcript_text}}` in the prompt — see /docs/workflows/media), `execution_mode` (`inline`, default, or `queued`: the run pauses and resumes when the agent finishes), `act_as` (`initiator`, default: the person who started the run, nobody for schedules / webhooks / public forms; `owner`; `none`), `max_iterations` (1–50), `timeout_ms`, `share_context` and `output_variable`. The agent uses only the tools and references it was granted; a tool call on its approval list pauses the run until the reviewer\'s task is completed. **Version pin**: publishing the workflow stamps the step with `agent_version` (the agent\'s version at publish time) in the published version — runs of the published workflow (every trigger, REST, MCP, CLI) use that version, even after the agent is saved again or an older version restored; the designer shows "Pinned to v3 · newer v5 available" with **Update** (publishes a copy of the live version with the new pin, without the draft\'s changes). Drafts and Save & Test run the latest version (the test log says so), and Save & Test streams the agent\'s reply onto the step as it is written.',
    outputs: 'The response text in `output_variable` (default `agent_response`), plus `<output_variable>_status`, `_outputs` (all declared outputs), `_usage`, `_iterations`, `_tool_calls`, `_duration_ms` and `_files` (files its tools produced); each declared output as `{{name}}` and `{{<prefix>_name}}` (prefix: Output Prefix, else the agent\'s name); the step output carries `agent_run_id` (its trace — readable with `agents.view`, or by the person the run acted for or who started it; people who can only view the workflow run see the step\'s output, not the trace). With files, `files` lists each file\'s name, size and how it was sent (never contents).',
    example: { agent_id: '<agent-id>', agent_name: 'Invoice triage', user_message: 'Classify invoice {{invoice_number}}', files: '{{form.invoice_scan}}', output_variable: 'triage' },
  },
  add_user_to_role: { settings: '`user_id` and `role_id` or `role_name`. Audited as a permission change.', outputs: '`success`, `role_id`, `role_name`, `audited`.' },
  remove_user_from_role: { settings: '`user_id` and `role_id` or `role_name`. Audited as a permission change.', outputs: '`success`, `role_id`, `role_name`, `audited`.' },

  // ─── Files and documents ───
  file_to_base64: { settings: '`file_url` (task file, storage path or URL); `output_var`.', example: { file_url: '{{task.files.0.url}}', output_var: 'pdf_base64' } },
  base64_to_file: { settings: '`base64_data`, `file_name`, `content_type`; saves to storage; `output_var` receives the file URL.', example: { base64_data: '{{pdf_base64}}', file_name: 'invoice.pdf' } },
  download_file: { settings: '`url` and `file_name`; downloads into storage; `output_var`.', example: { url: '{{response.document_url}}', file_name: 'statement.pdf' } },
  read_file: { settings: '`file_url` and `encoding`; reads text content into `output_var`.', example: { file_url: '{{file_url}}' } },
  read_csv: { settings: '`mode` `read` (`file_url`, `delimiter`, `has_headers`) into `output_var`, or `write` (`data_var`, `file_name`) to produce a CSV file.', outputs: 'Rows, or `file` / `file_url` when writing.', example: { mode: 'read', file_url: '{{file_url}}', has_headers: true, output_var: 'rows' } },
  read_excel: { settings: '`mode` `read` (`file_url`, `sheet_name`, `has_headers`) or `write` (`data_var`, `file_name`).', outputs: 'Rows, or `file` / `file_url` when writing.', example: { mode: 'write', data_var: 'rows', file_name: 'payments.xlsx' } },
  doc_word: { settings: 'Template from a URL, a file object (an uploaded attachment such as `{{item}}` or the first file of `{{task_data.<key>}}`, or a generated file) or a data-table file (`template_url` or `source_mode: "table"`), `mode` such as `find_replace` with `replacements`, tables, lists or images; `output_var` receives the generated file. In `replacements` the `find` text is literal — `{{VENDOR}}` matches that placeholder as written — and only `replace` is resolved as an expression; an empty `find` is skipped with a warning, and a replacement that would grow a document part past 100 MB fails the node.', example: { template_url: '{{template_url}}', mode: 'find_replace', replacements: [{ find: '{{VENDOR}}', replace: '{{vendor.name}}' }], output_var: 'contract' } },
  doc_excel: { settings: 'Template source as for Word; update cells, find/replace or insert rows; `output_var`.', example: { template_url: '{{template_url}}', mode: 'find_replace', replacements: [{ find: '{{TOTAL}}', replace: '{{total}}' }] } },
  doc_powerpoint: { settings: 'Template source as for Word; find/replace, tables, lists and images in slides; `output_var`.', example: { template_url: '{{template_url}}', mode: 'find_replace', replacements: [{ find: '{{QUARTER}}', replace: 'Q3' }] } },

  // ─── Document actions (pages: /docs/workflows/documents) ───
  doc_read: {
    settings: '`source` — a file object (form attachment, a file from another step), a list (the first file), a `storage://` reference, a URL or text. Options: `pages` (PDF pages / slides, e.g. `2-5`), `sheet`, `range` (`B2:F40`), `header_row` (`auto`, `first`, `none` or a row number), `max_rows`, `max_chars`, `include_tables`, `include_images`, `tracked_changes` (`accept` or `show`), `ocr` (`off`, `auto` for pages without a text layer, `force`) and `ocr_languages`. See /docs/workflows/documents/read-document.',
    outputs: '`<output_var>` (default `document`): `text`, `markdown`, `html` (sanitised), `metadata` (title, author, created, modified, pages / slides / sheets, words, characters, reading time), `structure` (headings, links, tables, sheets, slides, pages, comments, tracked changes, front matter, outline, form fields, data) and `rows`; plus `<output_var>_text`, `<output_var>_rows` and `<output_var>_count`.',
    example: { source: '{{form.invoice}}', ocr: 'auto', output_var: 'invoice' },
  },
  doc_compare: {
    settings: '`original` and `revised` — files, text, lists of rows or JSON. `mode`: `auto`, `lines`, `words`, `characters`, `sentences`, `sheet` (rows matched on `key_columns`; `compare_columns`, `ignore_columns`, `numeric_tolerance`) or `json` (`array_key`). `ignore_whitespace`, `ignore_case`, `ignore_punctuation`; `redline` (`none`, `docx`, `pdf`, `both`; `redline_style` `formatting` or `tracked`) and `report` (`none`, `html`, `pdf`). See /docs/workflows/documents/compare-documents.',
    outputs: '`<output_var>` (default `comparison`): `identical`, `similarity` (0–100), `stats`, `changes`, `unified` (text diffs), `html` (report) and the files `redline_docx`, `redline_pdf`, `report`; plus `<output_var>_identical`, `_similarity`, `_html` and one variable per file.',
    example: { original: '{{contract_v1}}', revised: '{{contract_v2}}', mode: 'words', redline: 'docx', report: 'html', output_var: 'contract_diff' },
  },
  doc_convert: {
    settings: '`source` and `target` (`pdf`, `docx`, `html`, `markdown`, `text`, `csv`, `xlsx`, `json`); `engine` `auto` (the external converter for Office → PDF when DOCUMENT_CONVERTER_URL is set), `builtin` or `external`; `sheet`, `delimiter`, `page_size`, `title`, `output_name`. See /docs/workflows/documents/convert-document.',
    outputs: '`<output_var>` (default `converted_file`): a file object (`name`, `url`, `size`, `mime_type`, `storage_ref`, `checksum_sha256`); also `file` and `file_url`.',
    example: { source: '{{doc_file}}', target: 'pdf', output_name: 'Contract {{contract_number}}' },
  },
  doc_pdf: {
    settings: '`operation`: `merge` (`sources`: a list of PDFs), `split` (`ranges` such as `1-3; 4-6`, or `every_n`), `extract_pages` (`pages`), `page_count`, `watermark` (`text`, `position`, `font_size`, `opacity`, `angle`, `color`, `pages`), `rotate` (`degrees`, `pages`), `fill_form` (`fields` name/value pairs or `field_values`, `flatten`, `strict`) or `read_form`. See /docs/workflows/documents/pdf-tools.',
    outputs: '`<output_var>`: the new PDF file object (merge, extract, watermark, rotate, fill), a list of files (`split`), the page count, or `{ fields, values }` (`read_form`).',
    example: { operation: 'watermark', source: '{{converted_file}}', text: 'APPROVED {{=TODAY()}}', position: 'top-right', output_var: 'stamped' },
  },
  doc_extract: {
    settings: '`source`; `extract_tables` and `table_index` (a number or `all`); `patterns` (`name`, `pattern`, optional `group` and `all`); `finders` (`emails`, `urls`, `phones`, `dates`, `amounts`, `percentages`; `date_order` `DMY` or `MDY`); `to_table` with `table_id` and an optional `column_mapping` (`column` ← `field`) to insert the rows into a data table. See /docs/workflows/documents/extract.',
    outputs: '`<output_var>` (default `extracted`): `tables`, `rows`, `values` (one per pattern, also `<output_var>_<name>`), `found` and `table_rows_inserted`; plus `<output_var>_rows` and `<output_var>_count`.',
    example: { source: '{{form.invoice}}', patterns: [{ name: 'invoice_number', pattern: 'Invoice\\s*#?\\s*(\\w+)' }], finders: ['dates', 'amounts'] },
  },
  doc_redact: {
    settings: '`source`; `mode` `redact` (default) or `detect_only` (findings only, no copy); `info_types` (ids such as `us_ssn`, `date_of_birth`, `credit_card`, `nz_ird`, `uk_nhs`; `*` for all, `@high` for every type that can reach high confidence, `category:financial`), `regions` (`US`, `UK`, `CA`, `AU`, `NZ`, `EU`, `IN`, `SG`), `min_confidence` `low`, `medium` (default) or `high`; the older `presets` (`email`, `phone`, `credit_card`, `iban`, `ssn`, `ip_address`, `url`, `date`), `terms`, `patterns`; `replacement` `block` (█), `label` (`[SSN]`), `partial` (last 4 kept), `hash` (`[SSN:3f9a…]`) or `text` (`replacement_text`), and `styles` per type; `include_values`; `ai_detection` with `ai_agent_id` (names and addresses, off by default); `output` `same` (Word, PowerPoint and Excel redacted in place; text formats kept), `pdf`, `html` or `text`; `clear_author`. See /docs/workflows/documents/redact and /docs/workflows/documents/info-types.',
    outputs: '`<output_var>` (default `redacted`, or `detected` with `detect_only`): `file`, `text`, `counts` per kind, `counts_by_type`, `total` and `findings` (`type`, `label`, `category`, `confidence`, masked `text`, `page` / `slide` / `sheet` / `cell` / `paragraph` / `line`, `start`, `end`, `context_snippet`); plus `<output_var>_file`, `_text`, `_findings` and `_count`.',
    example: { source: '{{form.statement}}', info_types: ['us_ssn', 'date_of_birth', 'credit_card'], min_confidence: 'medium', replacement: 'label' },
  },
  doc_inspect: {
    settings: '`source`; `operation` `all`, `detect` (type from the content, not the name), `checksum` (`algorithms`: sha256, sha1, md5, sha512), `stats` or `search` (`query`, `regex`, `case_sensitive`, `whole_word`, `context_chars`). See /docs/workflows/documents/inspect-document.',
    outputs: '`<output_var>` (default `inspection`): `type` (format, MIME type, extension mismatch), `checksums`, `stats`, `metadata` and `search` (`count`, `matches` with line, page and context); plus `<output_var>_matches` and `_match_count`.',
    example: { source: '{{form.upload}}', operation: 'search', query: 'termination', whole_word: true },
  },

  // ─── Media actions (pages: /docs/workflows/media) ───
  media_transcribe: {
    settings: '`integration_id` — a media-capable connection (OpenAI, Google Gemini, Azure AI Speech, AWS, Deepgram, AssemblyAI or ElevenLabs); `source` — an audio or video file (form attachment, a file from another step, `storage://` reference, URL or base64). Options: `language` (empty = detect), `diarize` and `max_speakers`, `word_timestamps`, `prompt` (vocabulary hint), `formats` (`srt`, `vtt`, `txt`, `json`; default `srt`), `model`, `output_name` and `run_mode` (`auto`, `inline`, `background`). See /docs/workflows/media/transcribe.',
    outputs: '`<output_var>` (default `transcript`): `text`, `language`, `duration`, `segments` (start, end, text, speaker, words), `words`, `speakers`, `files` (srt / vtt / txt / json), `provider`, `model`, `chunks` and `cost`; plus `<output_var>_text`, `_segments`, `_files` and one variable per format (`<output_var>_srt`, …).',
    example: { integration_id: '<integration-id>', source: '{{form.recording}}', diarize: true, formats: ['srt', 'txt'], output_var: 'transcript' },
  },
  media_analyze_image: {
    settings: '`integration_id` and `source` (an image). `features`: `description`, `labels`, `objects`, `text`, `faces` (boxes only — never identification), `safety` (default description, labels, text); `prompt` (a question) with optional `fields` (`name`, `type`, `description`) for a structured answer; `max_results` (20), `model`. See /docs/workflows/media/analyze-image.',
    outputs: '`<output_var>` (default `image_analysis`): `description`, `labels`, `objects`, `text`, `ocr` (lines with boxes), `faces`, `face_count`, `safety`, `answer`, `width`, `height`, `provider`, `model`, `cost`; plus `<output_var>_description`, `_text`, `_labels` and `_answer`.',
    example: { integration_id: '<integration-id>', source: '{{form.photo}}', features: ['description', 'text'], prompt: 'Is there visible damage?', fields: [{ name: 'damaged', type: 'boolean' }] },
  },
  media_analyze_video: {
    settings: '`integration_id` and `source` (a video). `features`: `summary`, `scenes`, `labels`, `text` (default summary, scenes); `prompt` and `fields`; `max_frames` (12, at most 60 — frames sampled for providers that cannot watch a whole video; needs FFmpeg), `keyframes` (store key frames as images), `model`, `run_mode`. See /docs/workflows/media/analyze-video.',
    outputs: '`<output_var>` (default `video_analysis`): `summary`, `scenes` (start, end, title, description), `labels`, `text`, `keyframes`, `answer`, `duration`, `frames_analysed`, `method` (`native` or `frames`), `provider`, `model`, `cost`; plus `<output_var>_summary`, `_scenes`, `_keyframes` and `_answer`.',
    example: { integration_id: '<integration-id>', source: '{{form.video}}', features: ['summary', 'scenes'], keyframes: true },
  },
  media_redact_image: {
    settings: '`integration_id` (not needed when `targets` is only `custom`) and `source`. `mode` `redact` (default) or `detect_only`; `targets`: `faces`, `text_pii`, `plates`, `custom` (default faces, text_pii); for text: `info_types` (as Redact Document; default `@high`), `regions`, `min_confidence`, `terms`, `patterns`; `boxes` for `custom` (fractions `{x, y, width, height}` or pixels `{left, top, width, height}`); `style` `blur` (default), `pixelate` or `box` (`color`), `padding` (10 %), `output_format` `same`, `png` or `jpeg`. See /docs/workflows/media/redact-image.',
    outputs: '`<output_var>` (default `redacted_image`, or `image_findings` with `detect_only`): `file`, `findings` (type, label, source, masked text, confidence, box), `counts`, `total`, `width`, `height`, `provider`, `cost`; plus `<output_var>_file`, `_findings` and `_count`.',
    example: { integration_id: '<integration-id>', source: '{{form.photo}}', targets: ['faces', 'text_pii'], info_types: ['@high'], style: 'blur' },
  },
  media_redact_video: {
    settings: 'As Redact Image (`mode`, `targets`, `info_types`, `regions`, `min_confidence`, `terms`, `patterns`, `boxes` with optional `start` / `end` seconds, `style`, `padding`) plus `sample_interval` (seconds between analysed frames, default 1, at least 0.2), `audio` `none`, `bleep` or `mute` with `audio_info_types`, `audio_terms`, `transcribe_integration_id` (default: the main connection when it can transcribe) and an optional `transcript` from an earlier Transcribe step; `output_format` `mp4`, `webm` or `mov`; `run_mode`. Audio-only files work with `targets: []` and `audio: "bleep"` (then only a speech provider is needed). Needs FFmpeg. See /docs/workflows/media/redact-video.',
    outputs: '`<output_var>` (default `redacted_video`, or `video_findings` with `detect_only`): `file`, `findings` (with `start` / `end`), `counts`, `total`, `duration`, `frames_sampled`, `audio_segments`, `provider`, `cost`; plus `<output_var>_file`, `_findings` and `_count`.',
    example: { integration_id: '<integration-id>', source: '{{form.video}}', targets: ['faces', 'plates'], audio: 'bleep', audio_info_types: ['@high'] },
  },
  media_generate_image: {
    settings: '`integration_id` (OpenAI or Stability AI); `operation` `generate` (default) or `edit` (`source` — the image, optional `mask`, a PNG whose transparent pixels are changed); `prompt` (required), `size` (`auto`, `1024x1024`, or an aspect ratio such as `16:9`), `quality`, `count` (1–4), `format` (`png`, `jpeg`, `webp`), `negative_prompt`, `model`, `output_name`. See /docs/workflows/media/generate-image.',
    outputs: '`<output_var>` (default `generated_image`): `file`, `files`, `revised_prompt`, `provider`, `model`, `cost`; plus `<output_var>_file` (the first image) and `_files`.',
    example: { integration_id: '<integration-id>', prompt: 'A flat illustration of a delivery van', size: '1024x1024', format: 'png' },
  },
  media_tts: {
    settings: '`integration_id` (OpenAI, Azure AI Speech, Deepgram or ElevenLabs); `text` (required), `voice`, `format` (`mp3`, `wav`, `opus`, `aac`, `flac`), `speed`, `language`, `instructions` (speaking style), `model`, `output_name`. See /docs/workflows/media/text-to-speech.',
    outputs: '`<output_var>` (default `speech`): `file`, `characters`, `format`, `voice`, `provider`, `model`, `cost`; plus `<output_var>_file`.',
    example: { integration_id: '<integration-id>', text: 'Hello {{customer.first_name}}, your order has shipped.', format: 'mp3' },
  },
  media_tools: {
    settings: 'No AI provider: runs FFmpeg on the server (not available on Vercel). `operation`: `info`, `extract_audio` (`format` mp3, wav, m4a, ogg, flac), `frames` (`interval` seconds, `count` up to 100, `format` png or jpeg), `thumbnail` (`at`), `trim` (`start` / `end` in seconds or hh:mm:ss), `convert` (`format` mp4, webm, mov, gif or an audio format; `max_width`, `max_height`), `compress` (`quality` low, medium, high; `max_width`, `max_height`) or `burn_subtitles` (`subtitles`: an SRT / VTT file, SRT text or a transcript); `source`, `output_name`, `run_mode`. See /docs/workflows/media/utilities.',
    outputs: '`<output_var>`: media info (`duration`, `size`, `format`, `has_video`, `has_audio`, `video`, `audio`; default `media_info`), a list of frame images (default `frames`, plus `frames_count`) or the new file (default `media_file`).',
    example: { operation: 'trim', source: '{{form.video}}', start: '0:05', end: '0:30' },
  },

  // ─── E-signature (page: /docs/integrations/e-signature) ───
  esign_send: {
    settings: '`integration_id` — an e-signature connection; `source` `documents` (default: `documents` — file objects, a list, `storage://` refs or URLs; PDFs are merged for providers that take one file) or `template` (`template_id`, `prefill` rows `{ key, value }`); `recipients` rows `{ name, email, role, routing_order, kind: signer | cc, anchor }` and/or `recipients_expr` (a list from a variable); `subject`, `message`, `reminder_days`, `expires_in_days`, `embedded` (sign through a link instead of provider email), `use_text_tags`, `test_mode` (Dropbox Sign), `client_reference` (idempotency key; default derived from the run and step), `advanced` (provider request fields as JSON). A retry of the step never sends a second envelope.',
    outputs: '`<output_var>` (default `envelope`): `envelope_id`, `status`, `provider`, `recipients` (name, email, role, status), `signer_count`, `client_reference`, `replayed`; plus `<output_var>_id`.',
    example: { integration_id: '<integration-id>', source: 'documents', documents: '{{contract_pdf}}', recipients: [{ name: '{{form.name}}', email: '{{form.email}}', role: 'Signer', routing_order: 1, anchor: '/sn1/' }], subject: 'Please sign: {{form.title}}', reminder_days: 2, expires_in_days: 14 },
  },
  esign_envelope: {
    settings: '`integration_id`; `action` `status` (default), `download` (`document` combined, certificate or both; `file_name`), `cancel` (`reason`), `signing_url` (`recipient_email`, `recipient_name`, `return_url` — for a "Sign now" link; the envelope must have been sent with `embedded`) or `list_templates` (`search`); `envelope_id` for all but list_templates.',
    outputs: '`<output_var>` (default `esign_result`): the envelope (status, recipients), `{ file, certificate, files }` for downloads (stored workflow files), `{ url, expires_at }` for signing URLs, `{ templates, next_cursor }` for templates.',
    example: { integration_id: '<integration-id>', action: 'download', envelope_id: '{{envelope.envelope_id}}', document: 'both' },
  },
  esign_wait: {
    settings: '`integration_id`, `envelope_id` (e.g. `{{envelope.envelope_id}}`); `timeout_days` (default 30), `download` (default true: store the signed PDF when completed; `document` combined / certificate / both, `file_name`), `poll_minutes` (default 5 without webhooks; 30-minute safety net with them). Label outgoing edges Completed / Declined / Voided / Expired / Timeout to branch on the outcome (unlabelled edges always run).',
    outputs: '`<output_var>` (default `signature`): `outcome`, `status`, `recipients` (with `signed_at`, `declined_reason`), `completed_at`, `signed_document` and `certificate` (workflow files), `waited_ms`; plus `esign_outcome`.',
    example: { integration_id: '<integration-id>', envelope_id: '{{envelope.envelope_id}}', timeout_days: 14, download: true, document: 'both' },
  },

  // ─── Canvas tools ───
  section_group: { settings: 'A labelled, collapsible frame (`width`, `height`, `color`) for grouping activities on the canvas. It does not run.' },
  live_reference: {
    settings: '`reference_id`, `binding_name` and `input_mappings`. Instead of running once, the reference is called whenever an expression reads `{{<binding_name>.*}}`, so values are always fresh.',
    example: { reference_id: '<reference-id>', reference_name: 'Get exchange rate', binding_name: 'fx' },
  },
}
