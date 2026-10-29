import type { McpToolServer } from '../server'
import type { McpContext } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { fromMcpContext } from '@/lib/services/context'
import * as forms from '@/lib/services/forms'
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

const FIELDS_HELP = 'User Task field definitions: [{ key, label, type (text, textarea, number, currency, email, phone, url, date, datetime, boolean, choice, multi_choice, user, lookup, attachments, heading, divider), required?, options?, display?, placeholder?, default?, help_text?, read_only?, min?, max?, min_length?, max_length?, pattern?, min_date?, max_date?, currency?, lookup? (type lookup: { source: table|reference, table_id?, search_columns?, match?, display_columns?, value_column? (default row_id), filters? [{ column, operator, value }], sort?, reference_id?, integration_id?, input_mappings? { <input>: "{{search}}" }, results_path?, display_fields?, value_field?, debounce_ms?, cache_ttl_s?, max_results?, min_chars?, multiple?, allow_free_text?, fill? [{ from, to }] }), attachments? (type attachments: { min_files?, max_files? (default 10), max_file_mb? (default 10), max_total_mb?, types? [documents|images|spreadsheets|pdf|any], custom_types? [".ext" | "mime/type"], camera? }; the value is a list of file objects; agents upload with files_upload and pass the file ids) }]'
const LAYOUT_HELP = 'Optional grid: { rows: [{ columns: 1-4, cells: [{ field_key, span }] }] }; null = one full-width row per field'
const THEME_HELP = 'Theme reference: { source: "workspace" } (default), { source: "custom", overrides: {...} } or { source: "saved", theme_id: <form theme id> }'
const OVERRIDES_HELP = 'Mini-theme overrides: { colors?: { light?: { accent, background, text }, dark?: {...} }, radius? (0-24), font? { source: google|system, family }, density? compact|comfortable, label_position? top|left, header? { enabled, title?, subtitle?, banner_color? } }'

const BUTTONS_HELP = 'Button bar: [{ id, label, kind (submit | cancel | draft | outcome), style (primary | secondary | danger), outcome?, hidden?, actions? [{ type: message | success_screen | start_workflow | redirect | close, text?, title?, screen_button?, url?, workflow_id?, inputs? }] }]; null = Submit + Cancel'
const HEADER_HELP = 'Header: { enabled, image (default | workspace_logo | upload | none), image_url?, title?, subtitle? ({{field}} placeholders), align? (left | center), banner? }; null = none'

const jsonObject = z.record(z.string(), z.any())
const limitOf = (limit: number | undefined) => Math.max(1, Math.min(limit ?? 50, 100))

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
    layout: jsonObject.nullable().optional().describe(LAYOUT_HELP),
    theme: jsonObject.optional().describe(THEME_HELP),
    buttons: z.array(jsonObject).nullable().optional().describe(BUTTONS_HELP),
    header: jsonObject.nullable().optional().describe(HEADER_HELP),
  }, async (args) => run(async () => ({ created: true, form: await forms.createForm(svc(), args) })))

  server.tool('forms_update', 'Update a reusable form. Supply only what changes. A change to fields, layout or theme creates a new version (published workflows stay pinned to theirs); name, description and tag edits do not.', {
    form_id: z.string().describe('Form ID'),
    name: z.string().optional().describe('New name'),
    description: z.string().nullable().optional().describe('New description (null clears it)'),
    tags: z.array(z.string()).optional().describe('Replacement tag list'),
    fields: z.array(jsonObject).optional().describe(FIELDS_HELP),
    layout: jsonObject.nullable().optional().describe(LAYOUT_HELP),
    theme: jsonObject.optional().describe(THEME_HELP),
    buttons: z.array(jsonObject).nullable().optional().describe(BUTTONS_HELP),
    header: jsonObject.nullable().optional().describe(HEADER_HELP),
  }, async (args) => run(async () => {
    const { form_id: id, ...input } = args
    return { updated: true, form: await forms.updateForm(svc(), id, input) }
  }))

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

  server.tool('forms_submit', 'Submit a reusable form as the caller (forms.submit). Values are validated like a task form (types, required, rules, people, lookup values against their source); the button\'s start-workflow actions run (queued, attributed to the caller) and "Form submitted" triggers fire. Returns the submission, the effects the button shows and the started runs. Pass the same idempotency_key to retry safely.', {
    form_id: z.string().describe('Form ID'),
    values: jsonObject.optional().describe('Field values keyed by field key (forms_get → fields)'),
    button_id: z.string().optional().describe('Button pressed (default: the first submitting button)'),
    idempotency_key: z.string().optional().describe('8-100 characters; a repeat returns the first submission'),
  }, async (args) => run(async () => {
    const { submitForm } = await import('@/lib/services/form-submissions')
    return submitForm(svc(), args.form_id, { values: args.values, button_id: args.button_id, idempotency_key: args.idempotency_key }, { source: 'api' })
  }))

  server.tool('forms_submissions_list', 'List submissions of a form, newest first (values, button, outcome, submitter, source standalone / api / task). Everyone sees their own; forms.edit sees all.', {
    form_id: z.string().describe('Form ID'),
    submitted_by: z.string().optional().describe('Only this submitter (user id)'),
    source: z.enum(['standalone', 'task', 'api']).optional().describe('Where it was submitted'),
    since: z.string().optional().describe('ISO 8601: submitted at or after'),
    limit: z.number().optional().describe('Maximum results (default 50, hard cap 100)'),
    offset: z.number().optional().describe('Rows to skip'),
  }, async (args) => run(async () => {
    const { listFormSubmissions } = await import('@/lib/services/form-submissions')
    const { submissions, total } = await listFormSubmissions(svc(), { form_id: args.form_id, submitted_by: args.submitted_by, source: args.source, since: args.since }, { limit: limitOf(args.limit), offset: Math.max(0, args.offset ?? 0) })
    return { submissions, count: submissions.length, total }
  }))

  server.tool('forms_submission_get', 'Get one form submission (values, button, outcome, the runs its button started).', {
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
  }, async (args) => run(async () => {
    const { lookupFormField } = await import('@/lib/services/form-lookup')
    return lookupFormField(svc(), args.form_id, { field_key: args.field_key, query: args.query, values: args.values })
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
