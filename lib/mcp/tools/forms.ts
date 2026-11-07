import type { McpToolServer } from '../server'
import type { McpContext } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { fromMcpContext } from '@/lib/services/context'
import * as forms from '@/lib/services/forms'
import { getFormGovernance, setFormLegalHold } from '@/lib/services/form-governance'
import * as wizard from '@/lib/services/form-wizard'
import { MCP_CORE_TOOL_DESCRIPTIONS } from '../descriptions'
import { messageOf } from './_util'

/*
 * Reusable task form and form theme tools. Thin wrappers over
 * lib/services/forms, which owns validation, versioning, the usage check on
 * delete, tenant filtering and audit (mutating tools are listed in
 * AUDITED_IN_SERVICE in ../authz). Reads need forms.view, create / update /
 * duplicate forms.edit, delete forms.delete.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const FIELDS_HELP = 'User Task field definitions: [{ key, label, type (text, textarea, number, currency, email, phone, url, date, datetime, boolean, choice, multi_choice, user, lookup, attachments, data_table, label, heading, divider, button, and the survey controls rating, nps, likert, matrix, slider, csat, ranking, image_choice, yes_no_maybe), required?, options?, display?, placeholder?, default?, help_text?, read_only?, min?, max?, min_length?, max_length?, pattern?, min_date?, max_date?, currency?, survey? (survey controls: rating { icon? star|heart|thumb, half?, low_label?, high_label? } with max = the scale 2–10 (default 5), value a number; nps { low_label?, high_label?, bands? }, value 0–10; likert: options = the scale points lowest first, value one of them; matrix { rows [{ key, label }] } with options = the columns, value { <row key>: <option> }; slider { step?, unit?, hide_value?, low_label?, high_label? } with min / max, value a number; csat { faces? 3|5 }, value 1…faces; ranking: options, value the options ordered best first; image_choice { multiple?, images? { <option>: "icon:<name>" | https URL }, columns? 2|3|4 }, value an option (a list when multiple); yes_no_maybe: options (default Yes, No, Maybe), value one of them), lookup? (type lookup: { source: table|reference, table_id?, search_columns?, match?, display_columns?, value_column? (default row_id), filters? [{ column, operator, value }], sort?, reference_id?, integration_id?, input_mappings? { <input>: "{{search}}" }, results_path?, display_fields?, value_field?, debounce_ms?, cache_ttl_s?, max_results?, min_chars?, multiple?, allow_free_text?, fill? [{ from, to }] }), attachments? (type attachments: { min_files?, max_files? (default 10), max_file_mb? (default 10), max_total_mb?, types? [documents|images|spreadsheets|pdf|any], custom_types? [".ext" | "mime/type"], camera? }; the value is a list of file objects; agents upload with files_upload and pass the file ids), data_table? (type data_table: { source: table|reference, mode: display|select|edit, table_id?, reference_id?, integration_id?, input_mappings? { <input>: "{{search}}|{{page}}|{{page_size}}|{{offset}}|{{sort}}|{{sort_dir}}|{{filter.<col>}}|{{form.<key>}}" }, results_path?, total_path?, columns [{ key, label, type text|number|date|choice|boolean, format? currency|percent|datetime, hidden?, sortable?, filterable?, read_only?, required?, options?, min?, max? }], key_column? (default row_id), base_filter? { match: all|any, conditions [{ column, operator, value }|group] } (values: constants, {{form.<key>}}, {{user.id|email|name}}, {{today}}, {{today-7d}}, {{now}}), sort? [{ column, direction }], page_size?, searchable?, multiple?, allow_add?, allow_delete?, max_rows?, open_access? }; select value = the selected rows; edit value = { added, updated [{ key, before, after, changed_fields }], deleted [{ key, before }] }), label_config? (type label — display text, never an input: { expression? (a formula in the {{= }} expression language without the braces, e.g. {{form.qty}} * {{form.price}}, SUMPRODUCT(control.lines.rows, "qty", "price"), SUMIF(control.lines.rows, "status", "open", "amount"), SUM(MAP(control.lines.rows, "qty * price")); control.<table>.rows = the rows of the table, edits applied, added_rows / changed_rows / deleted_rows / selected_rows), format? (a cell format: { kind: text|number|integer|currency|percent|date|datetime|badge|boolean, decimals?, currency? }), prefix?, suffix?, align?, size? sm|md|lg|xl, emphasis? normal|strong|muted, empty_text?, include? (store it with the submission — recomputed by the server, never taken as sent), hide_caption? }; without an expression, rules (Set values, API results) or the default fill it; rules react with event label_change and read {{control.<key>.value}}), dynamic? ({ <property>: binding } — options, default, min, max, min_date, max_date, placeholder, help_text, label, required, or props.<name> of a custom control; binding = { kind: expr, expr: "{{param.x}}|{{var.x}}|{{form.x}}" } | { kind: table, table_id, value?, label?, columns? [{ key, as? }], base_filter?, sort?, limit?, open_access?, anonymous_read?, restrict? } | { kind: reference, reference_id, input_mappings?, results_path?, value?, label?, columns?, base_filter?, sort?, limit?, anonymous_read? }; the static value is the fallback; the server re-resolves options / bounds on submit) }]'
const LAYOUT_HELP = 'Optional grid: { rows: [{ columns: 1-4, cells: [{ field_key, span }] }] }; null = one full-width row per field. Steps / tabs: { mode: "steps" | "tabs", pages: [{ id, title, description?, icon?, visible_when?, rows }], page_settings?, rows: [] } (each field on exactly one page). Optional rules: [{ id, name?, disabled?, event, target?, if?: { match: "all" | "any", conditions: [{ column, operator, value? }] }, then: [actions] }] — When [event] → If [conditions] → Then [actions] (show_hide, enable_disable, read_only, set_values, copy_values, clear_values, set_state, field_error, block_submit, validate, go_to_page, message, prompt, open_link, submit, refresh, run_lookup, call_reference, start_workflow, apply_table_changes…); message: { text, title?, tone? (success | warning | error), style? (banner | inline), duration? (auto | next_action | sticky), seconds? (2-60) }; prompt (ask a question): { text, title?, tone?, prompt: { id?, display (banner | dialog), preset (ok | ok_cancel | yes_no | yes_no_cancel | custom), buttons: [{ value, label, style?, then?: [actions], continue? }], escape? } } — steps after it wait for the answer; event message_answered (target = prompt id) reads {{event.response}}; read_only: { mode (read_only | editable | toggle), targets: ["field:<key>" | "section:<key>" | "row:<key>" | "page:<id>" | "form:*" (the whole form)] } — the value shows and is still submitted but cannot be changed by the person (rules still can) and is not required; a section, step / tab or form covers its controls; buttons are not affected (use enable_disable); event always = read only while the condition holds; {{event.row.<column>}}, {{event.value}}, {{user.email}} in templates'
const CONTEXT_HELP = '; params: form parameters [{ name, label?, type text|number|boolean|date|text_list, default?, required?, source url|context, query_name?, allowed?, pattern?, min?, max?, include? }] (from /f/<id>?name=value or the embedding context: a User Task\'s form_params mapping, the Run dialog); variables: [{ name, label?, type text|number|boolean|date|text_list|object, initial? { kind constant|param|expression, value }, include? }] set by the set_variable rule action ({ type: "set_variable", variable, variable_mode set|clear|reset, value }) or call_reference results mapped to "var.<name>"; read as {{param.<name>}} / {{var.<name>}} in rules, defaults, Data table base filters, lookup filters and API mappings (untrusted input: the server re-validates them; include: true stores the value with the submission); submitted_page: the optional Submitted page { enabled, icon (check_circle | party | mail_sent | calendar_check | thumbs_up | clipboard_check | badge_check | send | heart | star | trophy | rocket | upload | none), icon_url?, icon_alt?, icon_color? (success | primary | #hex), heading?, subheading?, summary_fields?, note?, submit_another { enabled, label? }, close { enabled, label? } } shown after a submission unless a button redirects, closes or shows its own success screen; form_actions: { favorite?: false, draft?: false } hides the favourite heart / Save draft icon in the form\'s top-right corner (absent = both shown); animation: { style?: none | expressive, confetti?: true } the form\'s animation style (absent = subtle, the default; confetti: a light burst on a success-tone Submitted page with expressive)'
const THEME_HELP = 'Theme reference: { source: "workspace" } (default), { source: "custom", overrides: {...} } or { source: "saved", theme_id: <form theme id> }'
const OVERRIDES_HELP = 'Mini-theme overrides: { colors?: { light?: { accent, background, text }, dark?: {...} }, radius? (0-24), font? { source: google|system, family }, density? compact|comfortable, label_position? top|left, button_placement? left|right|full, form_width? narrow|normal|wide|full|custom, form_width_pct? 40-100 (custom), header? { enabled, title?, subtitle?, banner_color? } }'

const BUTTONS_HELP = 'Button bar: [{ id, label, kind (submit | cancel | draft | outcome), style (primary | secondary | danger), outcome?, hidden?, actions? [{ type: message | success_screen | start_workflow | redirect | close, text?, title?, screen_button?, url?, workflow_id?, inputs? }] }]; null = Submit + Cancel'
const HEADER_HELP = 'Header: { enabled, image (default | workspace_logo | upload | none), image_url?, title?, subtitle? ({{field}} placeholders), align? (left | center), banner? }; null = none'

const AVAILABLE_HELP = 'Available forms: list the form in the sidebar Forms menu of people given explicit access to it (a grant for them, their team or their role) who can submit forms; a setting, no new version'

const jsonObject = z.record(z.string(), z.any())
const limitOf = (limit: number | undefined) => Math.max(1, Math.min(limit ?? 50, 100))

const SYSTEM_NAME_HELP = 'Friendly link name: /form/<system_name> on the workspace address. Lowercase a-z, 0-9 and hyphens, 3-60 characters; unique in the workspace. Omitted on create = suggested from the name. Renaming keeps the old name as a redirect; a setting (no new version).'

export function registerFormTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('forms_list', 'List reusable task forms (name, tags, version, field count, how many workflow steps use each). User Task nodes and task triggers link a form with config.form_id.', {
    search: z.string().optional().describe('Name or description contains'),
    tag: z.string().optional().describe('Only forms with this tag'),
    limit: z.number().optional().describe('Maximum results (default 50, hard cap 100)'),
    offset: z.number().optional().describe('Rows to skip'),
  }, async (args) => run(async () => {
    const { forms: rows, total } = await forms.listForms(svc(), { search: args.search, tag: args.tag }, { limit: limitOf(args.limit), offset: Math.max(0, args.offset ?? 0) })
    return { forms: rows, count: rows.length, total }
  }))

  server.tool('forms_get', 'Get a reusable form with its fields, grid layout, theme reference, current version and usages (workflow drafts follow the latest version; active published versions are pinned).', {
    form_id: z.string().describe('Form ID'),
  }, async (args) => run(async () => ({ form: await forms.getForm(svc(), args.form_id) })))

  server.tool('forms_create', 'Create a reusable task form (version 1). Link it from a user_task node with config.form_id (the designer keeps a cached copy of the fields on the node).', {
    name: z.string().describe('Form name (1-120 characters)'),
    description: z.string().optional().describe('Optional description'),
    tags: z.array(z.string()).optional().describe('Tags (lower-cased)'),
    fields: z.array(jsonObject).describe(FIELDS_HELP),
    layout: jsonObject.nullable().optional().describe(LAYOUT_HELP + CONTEXT_HELP),
    theme: jsonObject.optional().describe(THEME_HELP),
    buttons: z.array(jsonObject).nullable().optional().describe(BUTTONS_HELP),
    header: jsonObject.nullable().optional().describe(HEADER_HELP),
    available_in_menu: z.boolean().optional().describe(AVAILABLE_HELP),
    system_name: z.string().optional().describe(SYSTEM_NAME_HELP),
  }, async (args) => run(async () => ({ created: true, form: await forms.createForm(svc(), args) })))

  server.tool('forms_update', 'Update a reusable form. Supply only what changes. A change to fields, layout or theme creates a new version (published workflows stay pinned to theirs); name, description and tag edits do not.', {
    form_id: z.string().describe('Form ID'),
    name: z.string().optional().describe('New name'),
    description: z.string().nullable().optional().describe('New description (null clears it)'),
    tags: z.array(z.string()).optional().describe('Replacement tag list'),
    fields: z.array(jsonObject).optional().describe(FIELDS_HELP),
    layout: jsonObject.nullable().optional().describe(LAYOUT_HELP + CONTEXT_HELP),
    theme: jsonObject.optional().describe(THEME_HELP),
    buttons: z.array(jsonObject).nullable().optional().describe(BUTTONS_HELP),
    header: jsonObject.nullable().optional().describe(HEADER_HELP),
    available_in_menu: z.boolean().optional().describe(AVAILABLE_HELP),
    system_name: z.string().optional().describe(SYSTEM_NAME_HELP),
  }, async (args) => run(async () => {
    const { form_id: id, ...input } = args
    return { updated: true, form: await forms.updateForm(svc(), id, input) }
  }))

  server.tool('forms_wizard_create', MCP_CORE_TOOL_DESCRIPTIONS.forms_wizard_create, {
    spec: jsonObject.describe('The wizard spec: { name, description?, template?, questions [{ id, kind, label, help?, required?, options?, currency?, show_if? { question, op, value? }, score? { correct, points? } }], look? { theme, header, layout single | steps | one_at_a_time, success }, audience? { internal, who everyone | selected, role_ids, team_ids, show_in_menu, public_link, multiple_responses, opens_at?, closes_at? }, approval? { mode, stages [{ id, name, assignee { kind person, user_id } | { kind manager, fallback_user_id } | { kind team, team_id } | { kind group, group_id }, outcomes [approve, decline, changes] }], notify_requester, due_days }, results? { charts, role_ids, team_ids } }'),
    dry_run: z.boolean().optional().describe('Only validate and return the plan'),
  }, async (args) => run(async () => (args.dry_run ? wizard.planWizardForm(svc(), args.spec) : { created: true, ...(await wizard.createWizardForm(svc(), args.spec)) })))

  server.tool('forms_wizard_update', 'Update a wizard form (owner, or forms.edit): send the edited spec with the question ids (and keys) from forms_wizard_create / forms_wizard_list. New questions add table columns; existing columns and their data are never dropped; the form gets a new version and the workflow is rebuilt and published again.', {
    project_id: z.string().describe('Wizard project id'),
    spec: jsonObject.describe('The edited wizard spec (same shape as forms_wizard_create)'),
  }, async (args) => run(async () => ({ updated: true, ...(await wizard.updateWizardForm(svc(), args.project_id, args.spec)) })))

  server.tool('forms_wizard_list', 'List the acting person\'s wizard forms and drafts (spec, manifest of created ids), newest first.', {}, async () => run(async () => {
    const projects = await wizard.listWizardProjects(svc())
    return { projects, count: projects.length }
  }))

  server.tool('forms_wizard_get', 'Get one wizard form (owner, or forms.edit): its spec (questions with ids and keys, for forms_wizard_update), the manifest of created ids (form, data table, workflow, reports) and links.', {
    project_id: z.string().describe('Wizard project id'),
  }, async (args) => run(async () => ({ project: await wizard.getWizardProject(svc(), args.project_id) })))

  server.tool('forms_wizard_results', 'A wizard form\'s results: summary (total, this week, pending / approved / declined, approval rate, average quiz score), charts per question (counts, rating average, NPS) and a page of responses. The owner, the roles / teams chosen for results, or forms.edit.', {
    project_id: z.string().describe('Wizard project id'),
    search: z.string().optional().describe('Responses containing this text'),
    status: z.string().optional().describe('Only this status'),
    page: z.number().optional().describe('Page (1-based)'),
    page_size: z.number().optional().describe('Rows per page (5-100, default 25)'),
  }, async (args) => run(async () => wizard.getWizardResults(svc(), args.project_id, { search: args.search, status: args.status, page: args.page, page_size: args.page_size })))

  server.tool('forms_delete', 'Delete a reusable form and its versions. Refused (with the list of usages) while a workflow draft or an active published version still links it.', {
    form_id: z.string().describe('Form ID'),
  }, async (args) => run(() => forms.deleteForm(svc(), args.form_id)))

  server.tool('forms_duplicate', 'Copy a form (fields, layout, theme, tags) into a new form at version 1.', {
    form_id: z.string().describe('Form ID to copy'),
    name: z.string().optional().describe('Name of the copy (default "<name> (copy)")'),
  }, async (args) => run(async () => ({ created: true, form: await forms.duplicateForm(svc(), args.form_id, args.name) })))

  server.tool('forms_versions', 'List the versions of a form, newest first (number, name, author, date; no content). Use forms_version_get for one snapshot.', {
    form_id: z.string().describe('Form ID'),
    limit: z.number().optional().describe('Maximum results (default 50, hard cap 100)'),
    offset: z.number().optional().describe('Rows to skip'),
  }, async (args) => run(() => forms.listFormVersions(svc(), args.form_id, { limit: limitOf(args.limit), offset: Math.max(0, args.offset ?? 0) })))

  server.tool('forms_version_get', 'Get one immutable form version snapshot (fields, layout, theme) — what a published workflow pinned to that version shows.', {
    form_id: z.string().describe('Form ID'),
    version: z.number().int().describe('Version number'),
  }, async (args) => run(async () => ({ version: await forms.getFormVersion(svc(), args.form_id, args.version) })))

  server.tool('forms_usages', 'Where a form is used: workflow steps and start forms linking it, in drafts (follow the latest version) and active published versions (pinned version).', {
    form_id: z.string().describe('Form ID'),
  }, async (args) => run(async () => ({ usages: await forms.getFormUsages(svc(), args.form_id) })))

  server.tool('forms_governance_get', 'A form\'s governance: the retention policy governing its submissions (assign with retention_policies_assign, target_type form), its legal hold and its submission count. Grants on the form: object_permissions_list with object_type form.', {
    form_id: z.string().describe('Form ID'),
  }, async (args) => run(async () => ({ governance: await getFormGovernance(svc(), args.form_id) })))

  server.tool('forms_legal_hold', 'Place or release a legal hold on a form (team.change_roles). While held, no submission or stored file of the form is purged (retention policies, Keep submissions) and the form cannot be deleted. Audited.', {
    form_id: z.string().describe('Form ID'),
    hold: z.boolean().describe('true to place the hold, false to release it'),
    reason: z.string().max(500).optional().describe('Why the form is held (case or matter reference)'),
  }, async (args) => run(async () => ({ form: await setFormLegalHold(svc(), args.form_id, { hold: args.hold, reason: args.reason ?? null }) })))

  const anonymousSettings = z.object({
    per_ip_per_minute: z.number().int().min(1).max(60).optional().describe('Submissions per visitor IP per minute (1-60, default 10)'),
    daily_cap: z.number().int().min(1).max(10000).optional().describe('Anonymous submissions per rolling 24 hours (1-10000, default 500)'),
    min_fill_seconds: z.number().int().min(0).max(120).optional().describe('Seconds between opening the page and submitting (default 3)'),
    uploads: z.boolean().optional().describe('Attachments take files from anonymous visitors (default false)'),
    max_upload_mb: z.number().int().min(1).max(4).optional().describe('Largest anonymous upload, MB (1-4, default 2)'),
    max_files: z.number().int().min(1).max(10).optional().describe('Files per anonymous submission (1-10, default 3)'),
    allow_indexing: z.boolean().optional().describe('Let search engines index the page (default false)'),
    allow_friendly_link: z.boolean().optional().describe('Also open for visitors at /form/<system_name> on the workspace address (default false; system names are guessable)'),
  })

  server.tool('forms_links', 'A form\'s links: the friendly link (https://<subdomain>.<base domain>/form/<system_name>, when the workspace has an address), the /f/<id> form page and the anonymous /p/<token> link (when live).', {
    form_id: z.string().describe('Form ID'),
  }, async (args) => run(async () => ({ links: await (await import('@/lib/services/form-links')).getFormLinks(svc(), args.form_id) })))

  server.tool('forms_system_name_check', 'Check a form system name (the friendly /form/<name> link): format (a-z, 0-9, hyphens, 3-60) and whether another form of the workspace has it. Pass form_id when renaming.', {
    system_name: z.string().describe('The name to check'),
    form_id: z.string().optional().describe('The form being renamed (omit for a new form)'),
  }, async (args) => run(async () => (await import('@/lib/services/form-links')).checkFormSystemName(svc(), args.form_id ?? null, args.system_name)))

  server.tool('forms_anonymous_get', 'A form\'s public (anonymous) link: on / off, the token and path (/p/<token>), the visitor limits, whether the workspace allows anonymous forms, and warnings — what anonymous visitors would NOT get from this form (lookups / Data tables without "Allow anonymous read", server steps without "Allow for anonymous", uploads, custom-control capabilities, {{user.*}}).', {
    form_id: z.string().describe('Form ID'),
  }, async (args) => run(async () => ({ anonymous: await (await import('@/lib/services/anonymous-forms')).getFormAnonymousAccess(svc(), args.form_id) })))

  server.tool('forms_anonymous_update', 'Turn a form\'s anonymous responses on / off and set its visitor limits (forms.edit; turning on needs the workspace\'s "Allow anonymous forms"). On: anyone with the public link can fill in and submit the form without signing in — submissions are stored with source "anonymous" and no submitter, and "Form submitted" workflows run. Off stops the link immediately. Audited.', {
    form_id: z.string().describe('Form ID'),
    enabled: z.boolean().optional().describe('Allow anonymous responses'),
    settings: anonymousSettings.optional().describe('Visitor limits (clamped to the platform limits)'),
  }, async (args) => run(async () => ({ anonymous: await (await import('@/lib/services/anonymous-forms')).setFormAnonymousAccess(svc(), args.form_id, { enabled: args.enabled, settings: args.settings }) })))

  server.tool('forms_anonymous_regenerate', 'Make a new public link for a form (forms.edit): every earlier link stops working at once. Audited.', {
    form_id: z.string().describe('Form ID'),
  }, async (args) => run(async () => ({ anonymous: await (await import('@/lib/services/anonymous-forms')).regenerateFormAnonymousToken(svc(), args.form_id) })))

  server.tool('anonymous_forms_settings_get', 'The workspace\'s "Allow anonymous forms" switch and its optional bot protection (Turnstile / hCaptcha provider and site key; never the secret).', {},
    async () => run(async () => ({ settings: await (await import('@/lib/services/anonymous-forms')).getAnonymousWorkspaceSettings(svc()) })))

  server.tool('anonymous_forms_settings_update', 'Set the workspace\'s "Allow anonymous forms" switch (off stops every public form link at once) and the optional bot protection (settings.edit). The captcha secret is write-only and stored encrypted: omit it (or "__SECRET__") to keep the stored one; captcha null turns protection off. Audited.', {
    enabled: z.boolean().optional().describe('Allow anonymous forms in this workspace'),
    captcha: z.object({
      provider: z.enum(['turnstile', 'hcaptcha']).nullable().optional(),
      site_key: z.string().max(200).nullable().optional(),
      secret: z.string().max(500).nullable().optional(),
    }).nullable().optional().describe('Bot protection; null turns it off'),
  }, async (args) => run(async () => ({ settings: await (await import('@/lib/services/anonymous-forms')).setAnonymousWorkspaceSettings(svc(), { enabled: args.enabled, captcha: args.captcha }) })))

  server.tool('forms_submit', 'Submit a reusable form as the caller (forms.submit). Values are validated like a task form (types, required, rules, people, lookup values against their source); the button\'s start-workflow actions run (queued, attributed to the caller) and "Form submitted" triggers fire. Returns the submission, the effects the button shows and the started runs. Pass the same idempotency_key to retry safely.', {
    form_id: z.string().describe('Form ID'),
    values: jsonObject.optional().describe('Field values keyed by field key (forms_get → fields)'),
    button_id: z.string().optional().describe('Button pressed (default: the first submitting button)'),
    idempotency_key: z.string().optional().describe('8-100 characters; a repeat returns the first submission'),
    params: jsonObject.optional().describe('The form\'s parameters by name ({{param.<name>}}), like a link\'s ?name=value: untrusted, re-validated against the form\'s declarations (layout.params)'),
    variables: jsonObject.optional().describe('The form\'s variables by name ({{var.<name>}}): declared names only (layout.variables), typed and size-bounded'),
  }, async (args) => run(async () => {
    const { submitForm } = await import('@/lib/services/form-submissions')
    return submitForm(svc(), args.form_id, { values: args.values, button_id: args.button_id, idempotency_key: args.idempotency_key, params: args.params, variables: args.variables }, { source: 'api' })
  }))

  server.tool('forms_submissions_list', 'List submissions of a form, newest first (values, button, outcome, submitter, source standalone / api / task, and `submission`: the metadata workflows see as {{submission.*}} — id, reference, submitted_at, submitted_by { id, name, email }, form { id, name, version }, source page / run_dialog / api / task). Everyone sees their own; forms.edit sees all.', {
    form_id: z.string().describe('Form ID'),
    submitted_by: z.string().optional().describe('Only this submitter (user id)'),
    source: z.enum(['standalone', 'task', 'api', 'anonymous']).optional().describe('Where it was submitted (anonymous: a public form link)'),
    since: z.string().optional().describe('ISO 8601: submitted at or after'),
    limit: z.number().optional().describe('Maximum results (default 50, hard cap 100)'),
    offset: z.number().optional().describe('Rows to skip'),
  }, async (args) => run(async () => {
    const { listFormSubmissions } = await import('@/lib/services/form-submissions')
    const { submissions, total } = await listFormSubmissions(svc(), { form_id: args.form_id, submitted_by: args.submitted_by, source: args.source, since: args.since }, { limit: limitOf(args.limit), offset: Math.max(0, args.offset ?? 0) })
    return { submissions, count: submissions.length, total }
  }))

  server.tool('forms_submission_get', 'Get one form submission (values, button, outcome, the runs its button started, and the `submission` metadata: reference, submitted_by { id, name, email }, form version, source).', {
    submission_id: z.string().describe('Submission ID'),
  }, async (args) => run(async () => {
    const { getFormSubmission } = await import('@/lib/services/form-submissions')
    return { submission: await getFormSubmission(svc(), args.submission_id) }
  }))

  server.tool('forms_lookup', 'Suggestions for an Autocomplete / lookup field of a reusable form (before forms_submit). Runs only the lookup stored on the form; returns items { value, label, description?, fields }.', {
    form_id: z.string().describe('Form ID'),
    field_key: z.string().describe('Key of the lookup field'),
    query: z.string().optional().describe('Search text'),
    values: jsonObject.optional().describe('The form\'s current values, for {{task_data.<key>}} placeholders in filters / inputs'),
    params: jsonObject.optional().describe('The form\'s parameters by name ({{param.<name>}}), like a link\'s ?name=value: untrusted, re-validated against the form\'s declarations (layout.params)'),
    variables: jsonObject.optional().describe('The form\'s variables by name ({{var.<name>}}): declared names only (layout.variables), typed and size-bounded'),
  }, async (args) => run(async () => {
    const { lookupFormField } = await import('@/lib/services/form-lookup')
    return lookupFormField(svc(), args.form_id, { field_key: args.field_key, query: args.query, values: args.values, params: args.params, variables: args.variables })
  }))

  server.tool('forms_data_table', 'Rows of a Data table field of a reusable form (field type "data_table"): search, column filters (only filterable columns), sort (only sortable columns) and paging run on the server against the source stored on the form; the author\'s base filter always applies and only the selected columns are returned. Returns { rows [{ key, values }], total, page, page_size, applied_locally? }. Select rows by passing them (with their key column) as values.<field_key>; an editable table takes a change set { added, updated [{ key, after }], deleted [{ key }] }.', {
    form_id: z.string().describe('Form ID'),
    field_key: z.string().describe('Key of the Data table field'),
    query: jsonObject.optional().describe('{ search?, filters? [{ column, operator, value }], sort? [{ column, direction }], page?, page_size? }'),
    values: jsonObject.optional().describe('The form\'s current values, for {{form.<key>}} in the base filter / API inputs'),
    params: jsonObject.optional().describe('The form\'s parameters by name ({{param.<name>}}), like a link\'s ?name=value: untrusted, re-validated against the form\'s declarations (layout.params)'),
    variables: jsonObject.optional().describe('The form\'s variables by name ({{var.<name>}}): declared names only (layout.variables), typed and size-bounded'),
  }, async (args) => run(async () => {
    const { queryDataTable } = await import('@/lib/services/form-data-table')
    return queryDataTable(svc(), { form_id: args.form_id }, { field_key: args.field_key, query: args.query, values: args.values, params: args.params, variables: args.variables })
  }))

  server.tool('forms_check_accessibility', 'Check a reusable form against WCAG 2.2 AA: score (0-100, 100 = no findings), findings (severity, WCAG success criteria, field, message, how to fix, and a fix patch where one is safe: add label, apply autocomplete, add error message, auto-fix theme contrast, alt text), passed rules and the workspace policy (off / warn / block below min_score). Pass `definition` to check unsaved changes; apply fixes with forms_update.', {
    form_id: z.string().describe('Form ID'),
    definition: jsonObject.nullable().optional().describe('Unsaved definition to check instead of the latest version: { fields, layout?, theme?, buttons?, header? }'),
  }, async (args) => run(async () => {
    const { checkFormAccessibilityFor } = await import('@/lib/services/form-accessibility')
    return checkFormAccessibilityFor(svc(), args.form_id, { definition: args.definition ?? null })
  }))

  server.tool('form_themes_list', 'List saved form themes (reusable mini themes a form references with { source: "saved", theme_id }).', {
    search: z.string().optional().describe('Name contains'),
    limit: z.number().optional().describe('Maximum results (default 50, hard cap 100)'),
    offset: z.number().optional().describe('Rows to skip'),
  }, async (args) => run(async () => {
    const { form_themes: rows, total } = await forms.listFormThemes(svc(), { search: args.search }, { limit: limitOf(args.limit), offset: Math.max(0, args.offset ?? 0) })
    return { form_themes: rows, count: rows.length, total }
  }))

  server.tool('form_themes_get', 'Get a saved form theme with its overrides.', {
    form_theme_id: z.string().describe('Form theme ID'),
  }, async (args) => run(async () => ({ form_theme: await forms.getFormTheme(svc(), args.form_theme_id) })))

  server.tool('form_themes_create', 'Create a saved form theme: overrides on top of the workspace theme. A theme whose text/background contrast is below 3:1 is refused.', {
    name: z.string().describe('Theme name (1-120 characters)'),
    description: z.string().optional().describe('Optional description'),
    overrides: jsonObject.describe(OVERRIDES_HELP),
  }, async (args) => run(async () => ({ created: true, form_theme: await forms.createFormTheme(svc(), args) })))

  server.tool('form_themes_update', 'Update a saved form theme. Forms and steps using it pick the change up for new tasks.', {
    form_theme_id: z.string().describe('Form theme ID'),
    name: z.string().optional().describe('New name'),
    description: z.string().nullable().optional().describe('New description (null clears it)'),
    overrides: jsonObject.optional().describe(OVERRIDES_HELP),
  }, async (args) => run(async () => {
    const { form_theme_id: id, ...input } = args
    return { updated: true, form_theme: await forms.updateFormTheme(svc(), id, input) }
  }))

  server.tool('form_themes_delete', 'Delete a saved form theme. Refused while a form or a workflow step uses it.', {
    form_theme_id: z.string().describe('Form theme ID'),
  }, async (args) => run(() => forms.deleteFormTheme(svc(), args.form_theme_id)))
}
