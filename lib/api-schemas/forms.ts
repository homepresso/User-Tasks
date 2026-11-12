import { z } from 'zod'
import { defineEndpoint } from './registry'
import { deletedResponse, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

const FIELDS_NOTE = 'fields is the User Task field list (key, label, type, required, options, bounds, ...; type image = one picture the person provides: image { max_mb? (default 10, max 20), camera?, types? [png|jpeg|webp|gif], default_file? { name, url } }, its value ONE file object (uploaded like an attachment; EXIF / GPS stripped); type signature = an electronic signature (not a cryptographic digital signature): signature { mode? draw|type|both, statement?, capture_audit?, resign_on_change? }, its value { file (PNG), method, typed_name?, signed_at, user_id?, user_name?, ip?, user_agent? } with the person, time and audit details set by the server; type display_image = a static picture, no value: display_image { src (https or an uploaded form image), alt (required), width? sm|md|lg|full, align? left|center|right }; type rich_text = formatted text: rich_text { max_length? (characters, default 20000), toolbar? basic|full }, its value sanitised HTML (p, br, strong, em, u, s, ul, ol, li, h3, h4, blockquote, code, a href https/mailto) with the plain text stored as <key>_text; type text_list = a list of text items: text_list { style? bulleted|numbered|plain, min_items?, max_items? (default 50), item_max_length? (default 500) }, its value an array of strings; type url takes url_config { text_field?, link_text?, new_tab? } (link text for read-only views; the value stays the http(s) / mailto URL); type user takes user_config { multiple?, allow_teams?, max? } — the value stays one user id unless multiple / allow_teams is set, then an array of { kind: user|team, id, name } (ids checked against the workspace, names set by the server); multi_choice display? checkboxes|listbox; type repeating_section = InfoPath\'s repeating section: a group of ANY controls (every type but data_table, custom and signature; nested list / repeating_section up to 3 levels) repeated per item, each item a card with Add / Remove / Move / Collapse — repeating_section { fields [field definitions; inner keys are unique over the whole form], layout? { rows [{ columns 1-4, cells [{ field_key: <inner key>, span }] }], sections?, rules? [form rules run in each item: {{item.<key>}} / {{row.<key>}} = this item, {{parent.<key>}} = the item holding a nested section, {{form.<key>}} = the form] }, add_label?, item_title? ({{index}} 1-based, {{item.<key>}}), min_items?, max_items? (default 50, max 200), start_items?, allow_remove? (default true), allow_reorder? (default true), collapsible? (default true), confirm_remove?, totals? [{ field, fn sum|avg|count, label? }] }; its value is an array of item objects keyed by the inner keys (the List shape: loop over it), with <key>_count and <key>_total_<field> / <key>_avg_<field> / <key>_count_<field> stored beside it; item errors come back at paths like expenses[1].amount; a bound dropdown inside an item may filter on {{item.<key>}} (a cascade within the item); the List rule actions (add_list_row, new_row, set_row_values, update_list_row, remove_list_row, clear_list, commit_row) and data / API outputs (to: <key>, columns) accept it as their List. type list = repeating rows kept in the submission: list { columns [{ key, label, type text|textarea|number|currency|date|choice|boolean|email|calculated|list, required?, options?, min?, max?, formula?, validations? [{ if: { match, conditions [{ column: row.<column>|parent.<column>|form.<field>|user.roles, operator, value }] }, message }] (an error on the cell while the condition holds, checked on the server too), list? (type list: a nested List { columns, totals?, min_rows?, max_rows?, row_validations? } — up to 3 levels; its rows sit in each row: [{ customer, lines: [{ sku, qty }] }]; list steps take child: <column> and parent_row: current|selected|<n>) }], min_rows?, max_rows?, row_validations? [{ if, message, column? }] (a row-level error), row_styles? [{ if, style { tone? success|warning|danger|info|neutral|accent, background?, text?, bold?, italic?, underline?, strike?, border?, icon? }, column? }] (conditional styling of the row or one cell while if holds; any level; presentation only), entry_mode? inline (absent = the list view, filled by rules), totals? [{ column, fn sum|avg|count }], display? auto|table|cards, row_editing? inline|popout|both (default both: cells in place plus Open row / Add in form opening the row as a form in a dialog, one column below 768px, two from 768px), row_form? { title? ("Expense: {{row.description}}"), layout? [{ column } | { section }], hide_view_icon? (read-only Lists otherwise show View row, the row read-only with formatted values) } }, its value an array of row objects; rows are added by the rule action add_list_row { list_field, values { <column>: "{{<input>}}" }, require?, clear_fields? }, with remove_list_row { list_field, row? } and clear_list { list_field }); layout is the optional grid ({ rows: [{ columns, cells: [{ field_key, span }] }] }), or steps / tabs ({ mode: "steps" | "tabs", pages: [{ id, title, description?, icon?, visible_when?, load?, preload?, rows }], page_settings?: { indicator, next_label, back_label, allow_skip, review, review_title, resume }, rows: [] }; each field on one page; values stay flat); layout.rules is the optional list of form rules [{ id, name?, disabled?, event (always, form_load, value_change, focus, blur, button_click, row_click, row_select, row_deselect, row_double_click, cell_edit, row_add, row_delete, item_select, page_change, before_submit, after_submit, flag_change, message_answered, section_change, label_change, part_loaded), target?, if?: { match: all | any, conditions: [{ column, operator, value? } | group] }, then: [actions] }] (When → If → Then; server actions run from the saved form — call_reference { reference_id, inputs, wait?, timeout_ms?, rows_path?, filter?, sort?, limit?, outputs?, on_success?, on_failure? } and the data table steps table_read / table_list / table_create / table_update / table_delete { table_id, row_id?, filter?, sort?, limit?, column_values?, outputs [{ path, to, as?: options, mode?, columns?, value_path?, label_path? }], open_access?, on_success?, on_failure? }; list steps add_list_row, edit_list_row, cancel_list_edit, update_list_row, remove_list_row, clear_list (list columns may be type lookup or read_only — read-only when editing; list.selectable single | multiple, row "selected", confirm_text, empty_text); editable table steps on a List or an editable Data table new_row, set_row_values, commit_row { commit_mode? stage | save_now, on_failure? }, discard_row, revert_row, delete_row, refresh_table, open_row_form (opens a row in its pop-out form; row current | selected | new | first | last | <n>; child?, parent_row?) (field: <key>; row current | selected | <n>; list / data_table on_submit_pending block | exclude | commit, row_commit_controls; events row_created, row_values_changed, row_committed, row_commit_failed, cell_change); event list_row_button for a List’s row buttons ({{row.*}}); a message action has style banner | inline, tone, title, duration and seconds; set_style (event always only) { targets: ["field:<key>" | "section:<key>"], style: { tone?, background?, text?, bold?, italic?, underline?, strike?, border?, icon? } } styles its targets with theme tones while the condition holds (presentation only); a prompt action asks a question — prompt: { id, display banner | dialog, preset, buttons [{ value, label, style, then, continue }], escape } — and each answer runs its own actions); layout.sections is the optional list of sections [{ key, title, description?, optional?, collapsible?, collapsed?, style?: bordered | plain, add_label?, visible_when?, load?, preload? }] and a row joins one with rows[].section = <key> (targets section:<key>; the fields of an optional section are kept only when <key>_included is true, which the submission records); layout.choice_groups is the optional list of choice groups [{ key, label, sections: [2-6 section keys on one page], default?, display? radio | tabs | dropdown }] — one alternative section shows at a time, the chosen section key is submitted as <key> (refused unless it is one of the sections; rules read {{form.<key>}}) and the fields of the other alternatives are not required and stored empty; rule conditions may test user.roles / user.teams (role / team names and ids; contains = has, neq = has not; judged on the server with its own view of the person); the load of a page or section is when it loads in the browser — eager (default, on form open), visible (when first shown) or rule (when a load_part rule action runs; targets section:<key> / page:<id>) — with preload: true to warm a lazy part once the form is idle (presentation only: values, defaults and validation are unchanged); layout.params is the optional list of form parameters [{ name, label?, type (text, number, boolean, date, text_list), default?, required?, source (url | context), query_name?, allowed?, pattern?, min?, max?, include? }] and layout.variables the form variables [{ name, label?, type (text, number, boolean, date, text_list, object), initial? { kind: constant | param | expression, value }, include? }] — {{param.<name>}} / {{var.<name>}} in rules, defaults, Data table base filters, lookup filters and API mappings; layout.submitted_page is the optional Submitted page shown after a submission { enabled, icon (check_circle, party, mail_sent, calendar_check, thumbs_up, clipboard_check, badge_check, send, heart, star, trophy, rocket, upload, none), icon_url?, icon_alt?, icon_color? (success | primary | #hex), heading?, subheading?, summary_fields? [field keys], note?, submit_another { enabled, label? }, close { enabled, label? } } (placeholders as in button texts; a button redirect, close or own success screen wins; not used for task forms); layout.form_actions turns off the icons in the top-right corner of a form where a person fills it in — { favorite?: false, draft?: false } (absent = both on: the favourite heart and the Save draft icon); layout.animation is the form’s animation style — { style?: none | expressive, confetti?: true } (absent = subtle, the default: short fades and rises; expressive moves more and, with confetti: true, adds a light confetti burst to a success-tone Submitted page; reduced motion is always respected); theme is { source: "workspace" } (default), { source: "custom", overrides } or { source: "saved", theme_id }.'
const VERSION_NOTE = 'A change to fields, layout or theme bumps version and stores an immutable snapshot (published workflow versions pin the version they were published with; drafts follow the latest). Name, description and tag edits do not.'
const BUTTONS_NOTE = 'The button bar: [{ id, label, kind (submit, cancel, draft, outcome), style (primary, secondary, danger), outcome? (outcome buttons: the task outcome), hidden? (cancel), actions? [{ type: message | success_screen | start_workflow | redirect | close, text?, title?, screen_button?, url?, workflow_id?, inputs? { <workflow input>: "{{field}}" } }] }]; null = Submit and Cancel. A start_workflow action needs workflows.activate to add.'
const HEADER_NOTE = 'Header: { enabled, image (default = the UserTasks mark, workspace_logo, upload, none), image_url? (an uploaded header image), title?, subtitle? ({{field}} placeholders), align? (left, center), banner? (the mini theme banner colour) }.'
const AVAILABLE_NOTE = 'Available forms: list the form in the sidebar Forms menu of people given explicit access to it (a grant for them, a team they belong to or a role they hold) who can submit forms. A setting: no new version (default false).'
const SYSTEM_NAME_NOTE = 'Friendly link name: /form/<system_name> on the workspace address (https://<subdomain>.<base domain>/form/<system_name>). Lowercase a-z, 0-9 and hyphens, 3-60 characters, no leading, trailing or double hyphen; unique in the workspace (409 when taken). A setting: no new version. Renaming keeps the old name as a redirect.'
const systemNameField = z.string().min(3).max(60).regex(/^[a-z0-9-]+$/)
const USAGE_NOTE = 'Usages are the workflow steps (and start forms) linking the form: draft links follow the latest version, active published versions are pinned.'

export const formCreateBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).nullable().optional().describe('Tags (lower-cased, de-duplicated)'),
  fields: z.array(looseObject).max(200).describe('Field definitions (at least one)'),
  layout: looseObject.nullable().optional().describe('Grid layout; omitted or null = one full-width row per field'),
  theme: looseObject.nullable().optional().describe('Theme reference (default { source: "workspace" })'),
  buttons: z.array(looseObject).max(8).nullable().optional().describe(BUTTONS_NOTE),
  header: looseObject.nullable().optional().describe(HEADER_NOTE),
  submission_retention_days: z.number().int().min(1).max(3650).nullable().optional().describe('Delete submissions older than this many days (null = keep)'),
  available_in_menu: z.boolean().nullable().optional().describe(AVAILABLE_NOTE),
  system_name: systemNameField.nullable().optional().describe(`${SYSTEM_NAME_NOTE} Omitted = suggested from the name ("Employee onboarding" → employee-onboarding, then -2, -3, …).`),
})

export const formUpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).nullable().optional(),
  fields: z.array(looseObject).max(200).optional().describe('New field list (a content change: new version)'),
  layout: looseObject.nullable().optional().describe('New grid layout; null = classic one-field-per-row'),
  theme: looseObject.nullable().optional().describe('New theme reference'),
  buttons: z.array(looseObject).max(8).nullable().optional().describe(`New buttons (a content change). ${BUTTONS_NOTE}`),
  header: looseObject.nullable().optional().describe(`New header (a content change); null = none. ${HEADER_NOTE}`),
  submission_retention_days: z.number().int().min(1).max(3650).nullable().optional().describe('Delete submissions older than this many days (null = keep)'),
  available_in_menu: z.boolean().nullable().optional().describe(AVAILABLE_NOTE),
  system_name: systemNameField.optional().describe(SYSTEM_NAME_NOTE),
})

export const formDuplicateBody = z.object({
  name: z.string().max(120).nullable().optional().describe('Name of the copy (default "<name> (copy)")'),
})

export const formThemeCreateBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  overrides: looseObject.describe('Mini-theme overrides: colors { light, dark: { accent, background, text, page, page_to, input, border, button } }, radius, font, heading_font, button_shape (square | rounded | pill), shadow (none | subtle | medium | strong), field_style (outlined | filled | underline), appearance (workspace | system | light | dark), density, label_position, button_placement, form_width (narrow | normal | wide | full | custom), form_width_pct (40-100, custom only), header'),
})

export const formThemeUpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  overrides: looseObject.optional(),
})

const formVersionParams = z.object({
  id: z.string().describe('Form id'),
  version: z.coerce.number().int().min(1).describe('Version number'),
})

const tags = ['Forms']
const themeTags = ['Form themes']

export const listFormsEndpoint = defineEndpoint({
  method: 'GET', path: '/forms', operationId: 'listForms', tags,
  summary: 'List reusable task forms (with field and usage counts)', permission: 'forms.view',
  query: paginationQuery.extend({
    search: z.string().optional().describe('Name or description contains'),
    tag: z.string().optional().describe('Only forms with this tag'),
  }),
  response: listResponse('forms'), listKey: 'forms',
  cli: { resource: 'forms', verb: 'list' },
})

export const createFormEndpoint = defineEndpoint({
  method: 'POST', path: '/forms', operationId: 'createForm', tags,
  summary: 'Create a reusable task form (version 1)', description: FIELDS_NOTE,
  permission: 'forms.edit', body: formCreateBody, successStatus: 201,
  response: itemResponse('form'),
  cli: { resource: 'forms', verb: 'create' },
})

export const getFormEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/{id}', operationId: 'getForm', tags,
  summary: 'Get a form with its fields, layout, theme and usages', description: USAGE_NOTE,
  permission: 'forms.view', params: idParams, response: itemResponse('form'),
  cli: { resource: 'forms', verb: 'get', positional: ['id'] },
})

export const updateFormEndpoint = defineEndpoint({
  method: 'PATCH', path: '/forms/{id}', operationId: 'updateForm', tags,
  summary: 'Update a form', description: `${VERSION_NOTE} ${FIELDS_NOTE}`,
  permission: 'forms.edit', params: idParams, body: formUpdateBody,
  response: itemResponse('form'),
  roundTrip: { unwrap: 'form' },
  cli: { resource: 'forms', verb: 'update', positional: ['id'] },
})

export const deleteFormEndpoint = defineEndpoint({
  method: 'DELETE', path: '/forms/{id}', operationId: 'deleteForm', tags,
  summary: 'Delete a form with its versions, submissions, stored files and grants (409 with the usages while a workflow uses it, or while it is on legal hold)', permission: 'forms.delete',
  params: idParams, response: deletedResponse,
  cli: { resource: 'forms', verb: 'delete', positional: ['id'] },
})

export const duplicateFormEndpoint = defineEndpoint({
  method: 'POST', path: '/forms/{id}/duplicate', operationId: 'duplicateForm', tags,
  summary: 'Copy a form into a new form (version 1)', permission: 'forms.edit',
  params: idParams, body: formDuplicateBody, successStatus: 201, response: itemResponse('form'),
  cli: { resource: 'forms', verb: 'duplicate', positional: ['id'] },
})

export const listFormVersionsEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/{id}/versions', operationId: 'listFormVersions', tags,
  summary: 'List a form\'s versions (newest first, without content)', description: VERSION_NOTE,
  permission: 'forms.view', params: idParams, query: paginationQuery,
  response: listResponse('versions'), listKey: 'versions',
  cli: { resource: 'forms', verb: 'versions', positional: ['id'] },
})

export const getFormVersionEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/{id}/versions/{version}', operationId: 'getFormVersion', tags,
  summary: 'Get one form version snapshot (fields, layout, theme)', permission: 'forms.view',
  params: formVersionParams, response: itemResponse('version'),
  cli: { resource: 'forms', verb: 'version', positional: ['id', 'version'] },
})

export const listFormUsagesEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/{id}/usages', operationId: 'listFormUsages', tags,
  summary: 'Where a form is used (workflow drafts and active published versions)', description: USAGE_NOTE,
  permission: 'forms.view', params: idParams,
  response: z.looseObject({ usages: z.array(looseObject) }), listKey: 'usages',
  cli: { resource: 'forms', verb: 'usages', positional: ['id'] },
})

const GOVERNANCE_NOTE = 'Governance: the retention policy assigned to the form governs its submissions (assign it with POST /retention-policies/assign, target_type form; purge modes delete due submissions and their stored files), and a legal hold keeps every submission and file and blocks deleting the form. Grants on the form (View, Submit) are managed with /object-permissions (object_type form).'

export const formLegalHoldBody = z.object({
  hold: z.boolean().describe('true places the form on legal hold, false releases it'),
  reason: z.string().max(500).nullable().optional().describe('Why the form is held (case or matter reference)'),
})

export const getFormGovernanceEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/{id}/governance', operationId: 'getFormGovernance', tags,
  summary: 'A form\'s retention policy, legal hold and submission count', description: GOVERNANCE_NOTE,
  permission: 'forms.view', params: idParams, response: itemResponse('governance'),
  cli: { resource: 'forms', verb: 'governance', positional: ['id'] },
})

export const setFormLegalHoldEndpoint = defineEndpoint({
  method: 'POST', path: '/forms/{id}/legal-hold', operationId: 'setFormLegalHold', tags,
  summary: 'Place or release a legal hold on a form (nothing of it is purged or deleted while held)', description: GOVERNANCE_NOTE,
  permission: 'team.change_roles', params: idParams, body: formLegalHoldBody, response: itemResponse('form'),
  cli: { resource: 'forms', verb: 'legal-hold', positional: ['id'] },
})

export const listFormThemesEndpoint = defineEndpoint({
  method: 'GET', path: '/form-themes', operationId: 'listFormThemes', tags: themeTags,
  summary: 'List saved form themes', permission: 'forms.view',
  query: paginationQuery.extend({ search: z.string().optional().describe('Name contains') }),
  response: listResponse('form_themes'), listKey: 'form_themes',
  cli: { resource: 'form-themes', verb: 'list' },
})

export const createFormThemeEndpoint = defineEndpoint({
  method: 'POST', path: '/form-themes', operationId: 'createFormTheme', tags: themeTags,
  summary: 'Create a saved form theme', description: 'Overrides are validated; a theme whose own text/background contrast is below 3:1 is refused.',
  permission: 'forms.edit', body: formThemeCreateBody, successStatus: 201,
  response: itemResponse('form_theme'),
  cli: { resource: 'form-themes', verb: 'create' },
})

export const getFormThemeEndpoint = defineEndpoint({
  method: 'GET', path: '/form-themes/{id}', operationId: 'getFormTheme', tags: themeTags,
  summary: 'Get a saved form theme', permission: 'forms.view',
  params: idParams, response: itemResponse('form_theme'),
  cli: { resource: 'form-themes', verb: 'get', positional: ['id'] },
})

export const updateFormThemeEndpoint = defineEndpoint({
  method: 'PATCH', path: '/form-themes/{id}', operationId: 'updateFormTheme', tags: themeTags,
  summary: 'Update a saved form theme (forms using it pick the change up)', permission: 'forms.edit',
  params: idParams, body: formThemeUpdateBody, response: itemResponse('form_theme'),
  roundTrip: { unwrap: 'form_theme' },
  cli: { resource: 'form-themes', verb: 'update', positional: ['id'] },
})

export const deleteFormThemeEndpoint = defineEndpoint({
  method: 'DELETE', path: '/form-themes/{id}', operationId: 'deleteFormTheme', tags: themeTags,
  summary: 'Delete a saved form theme (409 while a form or step uses it)', permission: 'forms.delete',
  params: idParams, response: deletedResponse,
  cli: { resource: 'form-themes', verb: 'delete', positional: ['id'] },
})

const subTags = ['Form submissions']

/** Form parameters / variables in a request: untrusted input, re-validated against the saved declarations. */
export const formParamsField = z.record(z.string(), z.unknown()).optional().describe('The form\'s parameters by name ({{param.<name>}}), as a link would pass them (/f/<id>?customer=ALFKI). Unknown names are ignored; values are coerced to the declared type and validated; defaults fill the rest. Untrusted: they only fill placeholders in the saved form, so they can narrow a base filter but never widen it')
export const formVariablesField = z.record(z.string(), z.unknown()).optional().describe('The form\'s variables by name ({{var.<name>}}): declared names only, typed and size-bounded; initial values fill the rest')

export const formSubmitBody = z.object({
  values: z.record(z.string(), z.unknown()).optional().describe('Field values keyed by field key (validated like a task form: types, required, rules, people, lookup values against their source; a list field takes an array of row objects keyed by its column keys)'),
  button_id: z.string().max(40).optional().describe('The button pressed (default: the first submitting button); its start-workflow actions run'),
  idempotency_key: z.string().min(8).max(100).optional().describe('Repeating a key returns the first submission instead of submitting again'),
  params: formParamsField,
  variables: formVariablesField,
})

const submissionFilters = paginationQuery.extend({
  submitted_by: z.string().optional().describe('Only this submitter (user id)'),
  button_id: z.string().optional().describe('Only submissions with this button'),
  source: z.enum(['standalone', 'task', 'api', 'anonymous']).optional().describe('Where it was submitted (anonymous: a public form link)'),
  since: z.string().optional().describe('ISO 8601: submitted at or after'),
  until: z.string().optional().describe('ISO 8601: submitted at or before'),
})

const SUBMISSION_NOTE = 'Everyone sees their own submissions; forms.edit sees all of the workspace\'s. Each submission carries `submission`, the metadata workflows see as {{submission.*}}: id, reference (the short reference people see), submitted_at, submitted_by { id, name, email }, form { id, name, version }, source (page, run_dialog, api or task), button, outcome, task_id, url_params (always {} here: URL parameters are not stored).'

export const submitFormEndpoint = defineEndpoint({
  method: 'POST', path: '/forms/{id}/submit', operationId: 'submitForm', tags: subTags,
  summary: 'Submit a reusable form', permission: 'forms.submit',
  description: 'Validates the values on the server, records a submission, runs the button\'s start-workflow actions (queued, attributed to the caller) and fires "Form submitted" triggers. Returns the submission, the effects the button shows (messages, success screen, redirect) and the started runs.',
  params: idParams, body: formSubmitBody, successStatus: 201,
  response: z.looseObject({ submission: looseObject, effects: looseObject, runs: z.array(looseObject), table_changes: z.array(looseObject).optional().describe('"For each changed row" rules the button ran: { field, target, total, succeeded, failed, skipped, text, results [{ kind, key, action, status, error?, id?, http_status? }] }'), replayed: z.boolean().optional() }),
  cli: { resource: 'forms', verb: 'submit', positional: ['id'] },
})

export const listFormSubmissionsEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/{id}/submissions', operationId: 'listFormSubmissions', tags: subTags,
  summary: 'List a form\'s submissions (newest first)', description: SUBMISSION_NOTE, permission: 'forms.submit',
  params: idParams, query: submissionFilters,
  response: listResponse('submissions'), listKey: 'submissions',
  cli: { resource: 'forms', verb: 'submissions', positional: ['id'] },
})

export const getFormSubmissionEndpoint = defineEndpoint({
  method: 'GET', path: '/form-submissions/{id}', operationId: 'getFormSubmission', tags: subTags,
  summary: 'Get one form submission (values, button, runs started)', description: SUBMISSION_NOTE, permission: 'forms.submit',
  params: idParams, response: itemResponse('submission'),
  cli: { resource: 'form-submissions', verb: 'get', positional: ['id'] },
})

export const lookupFormFieldEndpoint = defineEndpoint({
  method: 'POST', path: '/forms/{id}/lookup', operationId: 'lookupFormField', tags: subTags,
  summary: 'Suggestions for an Autocomplete / lookup field of a reusable form', permission: 'forms.submit',
  description: 'Runs the lookup stored on the form (latest version) — never a config from the request — with the configured columns / fields only. Rate limited per user (429).',
  params: idParams,
  body: z.object({ field_key: z.string().min(1).max(64), query: z.string().max(500).optional(), values: z.record(z.string(), z.unknown()).optional(), resolve: z.array(z.string().max(1000)).max(50).optional().describe('Resolve these stored values to their items (display labels) instead of searching'), params: formParamsField, variables: formVariablesField }),
  response: z.looseObject({ items: z.array(looseObject), truncated: z.boolean().optional(), cached: z.boolean().optional(), too_short: z.boolean().optional() }),
  cli: { resource: 'forms', verb: 'lookup', positional: ['id'] },
})

const ACCESSIBILITY_NOTE = 'Runs the WCAG 2.2 AA checker (labels, instructions, error messages, focus order, headings, language, input purpose / autocomplete, steps, timing, header image alt text, buttons, custom controls, target size, and colour contrast of the form theme on the workspace theme in light and dark). Returns score (0-100, 100 = no findings), findings [{ id, rule, severity (critical, serious, moderate, minor, review), wcag [success criteria], level, field_key?, mode?, message, help, fix? { kind, label, field_key?, patch, prompt? } }], summary counts, passed rules and the workspace policy ({ mode: off | warn | block, min_score, passes }). With mode block, saving a form below min_score is refused.'

export const checkFormAccessibilityEndpoint = defineEndpoint({
  method: 'POST', path: '/forms/{id}/accessibility', operationId: 'checkFormAccessibility', tags,
  summary: 'Check a form against WCAG 2.2 AA (score, findings, fixes)', description: ACCESSIBILITY_NOTE,
  permission: 'forms.view', params: idParams,
  body: z.object({
    definition: looseObject.nullable().optional().describe('An unsaved definition to check instead of the latest version: { fields, layout?, theme?, buttons?, header? }'),
  }).optional(),
  response: z.looseObject({
    form_id: z.string(), form_version: z.number(), checked: z.enum(['saved', 'definition']),
    score: z.number(), findings: z.array(looseObject), summary: looseObject, passed: z.array(looseObject), policy: looseObject,
  }),
  cli: { resource: 'forms', verb: 'check-accessibility', positional: ['id'] },
})


/** Body of the Data table query endpoints (forms and tasks). */
export const dataTableQueryBody = z.object({
  field_key: z.string().min(1).max(64).describe('Key of a Data table field of the form'),
  query: z.object({
    search: z.string().max(200).optional().describe('Search text (matched against the visible text / choice columns)'),
    filters: z.array(z.object({
      column: z.string().max(200),
      operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'in', 'is_set', 'is_not_set']),
      value: z.string().max(200).optional(),
    })).max(10).optional().describe('Column filters — only on columns the author marked filterable; they narrow the author\'s base filter, never widen it'),
    sort: z.array(z.object({ column: z.string().max(200), direction: z.enum(['asc', 'desc']).optional() })).max(3).optional().describe('Only on columns the author marked sortable (default: the field\'s sort)'),
    page: z.number().int().min(1).max(1000).optional(),
    page_size: z.number().int().min(1).max(100).optional().describe('At most the field\'s page size'),
  }).optional(),
  values: z.record(z.string(), z.unknown()).optional().describe('The form\'s current values, for {{form.<key>}} in the base filter / API inputs'),
  params: formParamsField.describe('Reusable forms: the form\'s parameters by name ({{param.<name>}} in the base filter / API inputs), re-validated against the declarations; a task form uses the parameters its workflow step passed and ignores these'),
  variables: formVariablesField,
})

export const dataTableQueryResponse = z.object({
  rows: z.array(z.object({ key: z.string().describe('The row key (key column)'), values: z.record(z.string(), z.unknown()).describe('The selected columns only') })),
  total: z.number().nullable().describe('Matching rows (null: the API does not say)'),
  page: z.number(), page_size: z.number(),
  has_more: z.boolean().optional(),
  applied_locally: z.array(z.string()).optional().describe('API sources: what the server applied to the fetched rows (search, filters, sort, page) because the API does not'),
  truncated: z.boolean().optional(),
})

const DATA_TABLE_NOTE = 'Runs the query stored on the form\'s Data table field — the source (data table or API reference), selected columns, base filter, sort and page size come from the saved definition, never from the request. Column filters and sorts are accepted only on the columns the author allows and are ANDed onto the base filter. Only the selected columns are returned. Data table sources need data.view (the caller\'s own access applies) unless the author turned on open access. Rate limited per user (429).'

export const queryFormDataTableEndpoint = defineEndpoint({
  method: 'POST', path: '/forms/{id}/data-table', operationId: 'queryFormDataTable', tags: subTags,
  summary: 'Rows of a Data table field of a reusable form (search, filters, sort, page)', permission: 'forms.submit',
  description: DATA_TABLE_NOTE,
  params: idParams, body: dataTableQueryBody, response: dataTableQueryResponse,
  cli: { resource: 'forms', verb: 'data-table', positional: ['id'] },
})

export const checkFormSystemNameEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/system-name-check', operationId: 'checkFormSystemName', tags,
  summary: 'Check a form system name (format and availability)',
  description: `${SYSTEM_NAME_NOTE} Pass form_id when renaming a form (its own name is available to it). redirects_from_form is set when another form's shared links still redirect from this name (taking it moves those links to this form).`,
  permission: 'forms.view',
  query: z.object({
    system_name: z.string().max(200).describe('The name to check'),
    form_id: z.string().optional().describe('The form being renamed (omit for a new form)'),
  }),
  response: z.object({
    system_name: z.string(),
    available: z.boolean(),
    reason: z.string().nullable().describe('Why not, when not available'),
    redirects_from_form: z.string().nullable(),
  }),
  cli: { resource: 'forms', verb: 'check-system-name', positional: ['system_name'] },
})

export const getFormLinksEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/{id}/links', operationId: 'getFormLinks', tags,
  summary: 'The links of a form: friendly link, form page and public link',
  description: 'friendly_url is https://<subdomain>.<base domain>/form/<system_name> when the workspace has an address (null otherwise); form_url is the /f/<id> page; public_url is the anonymous /p/<token> link when anonymous responses are live.',
  permission: 'forms.view', params: idParams,
  response: z.object({
    friendly_url: z.string().nullable(),
    system_name: z.string().nullable(),
    workspace_url: z.string().nullable(),
    form_url: z.string(),
    public_url: z.string().nullable(),
  }),
  cli: { resource: 'forms', verb: 'links', positional: ['id'] },
})

const boolish = z.union([z.boolean(), z.enum(['true', 'false', '1', '0', 'on', 'off'])]).transform((v) => v === true || v === 'true' || v === '1' || v === 'on')
const listish = z.union([z.array(z.string().max(200)).max(40), z.string().max(4000)]).transform((v) => (Array.isArray(v) ? v : v.split(',').map((x) => x.trim()).filter(Boolean)))

export const infopathImportBody = z.object({
  file_base64: z.string().min(1).describe('The InfoPath form template (.xsn), or a .zip of its extracted source files, base64. With multipart/form-data: the `file` field.'),
  file_name: z.string().max(200).optional().describe('The file name (default form.xsn); re-imports are matched by it'),
  dry_run: boolish.optional().describe('true = analyse only: the report and the forms that would be made; nothing is stored'),
  mode: z.enum(['per_view', 'combined']).optional().describe('per_view (default): one form per InfoPath view, "<Form> — <View>"; combined: one form with each view as a step'),
  pages: z.enum(['steps', 'tabs']).optional().describe('With mode combined: the views as steps (default) or as tabs'),
  views: listish.optional().describe('Views to import (names; default all)'),
  name: z.string().max(100).optional().describe('Base form name (default the InfoPath form\'s title)'),
  tag: z.string().max(40).optional().describe('An extra tag (the form name and "infopath" are always added)'),
  existing: z.enum(['new', 'update']).optional().describe('Forms an earlier import of this file made (matched by file name + view): update them (a new version each) or create new forms (default)'),
  create_table: boolish.optional().describe('Also create a data table for the submissions (a child table per repeating table) and a draft "save submissions" workflow (data.create and workflows.create / edit)'),
  available_in_menu: boolish.optional().describe(AVAILABLE_NOTE),
})

export const importInfoPathEndpoint = defineEndpoint({
  method: 'POST', path: '/forms/import/infopath', operationId: 'importInfoPathForm', tags: ['Forms'],
  summary: 'Import an InfoPath form (.xsn): analyse it (dry_run) or create one UserTasks form per view, with its rules and validation',
  description: 'Reads the .xsn (a CAB archive; MSZIP or uncompressed — LZX is refused with a message) or a .zip of its source files: views, controls, labels, repeating tables (→ List fields), sections, defaults, rules (→ form rules), data validation, calculations, conditional formatting, data connections, buttons and roles. Anything that cannot be converted is kept as a disabled rule with the original XPath in its notes and listed in the report (report.items; report_markdown). The file is never stored. Up to 20 MB (INFOPATH_MAX_MB); hosted instances accept request bodies up to about 4.5 MB. Created forms carry layout.source { kind: infopath, file_name, view, hash } so a re-import can update them (existing: update). dry_run needs forms.view; an import needs forms.edit.',
  permission: 'forms.view',
  body: infopathImportBody, successStatus: 200,
  multipart: { files: { file: { name: 'file_name', content: 'file_base64' } } },
  response: z.looseObject({
    file_name: z.string(), hash: z.string(), report: looseObject, forms: z.array(looseObject), existing: z.array(looseObject), markdown: z.string(),
    created: z.array(looseObject).optional(), updated: z.array(looseObject).optional(), table: looseObject.optional(), workflow: looseObject.nullable().optional(), warnings: z.array(z.string()).optional(),
  }),
  cli: { resource: 'forms', verb: 'import-infopath' },
})

export const formEndpoints = [
  listFormsEndpoint, createFormEndpoint, getFormEndpoint, updateFormEndpoint, deleteFormEndpoint,
  duplicateFormEndpoint, listFormVersionsEndpoint, getFormVersionEndpoint, listFormUsagesEndpoint,
  getFormGovernanceEndpoint, setFormLegalHoldEndpoint,
  listFormThemesEndpoint, createFormThemeEndpoint, getFormThemeEndpoint, updateFormThemeEndpoint, deleteFormThemeEndpoint,
  submitFormEndpoint, listFormSubmissionsEndpoint, getFormSubmissionEndpoint, lookupFormFieldEndpoint, queryFormDataTableEndpoint,
  checkFormAccessibilityEndpoint, checkFormSystemNameEndpoint, getFormLinksEndpoint, importInfoPathEndpoint,
]
