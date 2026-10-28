import { z } from 'zod'
import { defineEndpoint } from './registry'
import { deletedResponse, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

const FIELDS_NOTE = 'fields is the User Task field list (key, label, type, required, options, bounds, ...); layout is the optional grid ({ rows: [{ columns, cells: [{ field_key, span }] }] }); theme is { source: "workspace" } (default), { source: "custom", overrides } or { source: "saved", theme_id }.'
const VERSION_NOTE = 'A change to fields, layout or theme bumps version and stores an immutable snapshot (published workflow versions pin the version they were published with; drafts follow the latest). Name, description and tag edits do not.'
const BUTTONS_NOTE = 'The button bar: [{ id, label, kind (submit, cancel, draft, outcome), style (primary, secondary, danger), outcome? (outcome buttons: the task outcome), hidden? (cancel), actions? [{ type: message | success_screen | start_workflow | redirect | close, text?, title?, screen_button?, url?, workflow_id?, inputs? { <workflow input>: "{{field}}" } }] }]; null = Submit and Cancel. A start_workflow action needs workflows.activate to add.'
const HEADER_NOTE = 'Header: { enabled, image (default = the UserTasks mark, workspace_logo, upload, none), image_url? (an uploaded header image), title?, subtitle? ({{field}} placeholders), align? (left, center), banner? (the mini theme banner colour) }.'
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
})

export const formDuplicateBody = z.object({
  name: z.string().max(120).nullable().optional().describe('Name of the copy (default "<name> (copy)")'),
})

export const formThemeCreateBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  overrides: looseObject.describe('Mini-theme overrides: colors { light, dark: { accent, background, text } }, radius, font, density, label_position, header'),
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
  summary: 'Delete a form (409 with the usages while a workflow uses it)', permission: 'forms.delete',
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

export const formSubmitBody = z.object({
  values: z.record(z.string(), z.unknown()).optional().describe('Field values keyed by field key (validated like a task form: types, required, rules, people, lookup values against their source)'),
  button_id: z.string().max(40).optional().describe('The button pressed (default: the first submitting button); its start-workflow actions run'),
  idempotency_key: z.string().min(8).max(100).optional().describe('Repeating a key returns the first submission instead of submitting again'),
})

const submissionFilters = paginationQuery.extend({
  submitted_by: z.string().optional().describe('Only this submitter (user id)'),
  button_id: z.string().optional().describe('Only submissions with this button'),
  source: z.enum(['standalone', 'task', 'api']).optional().describe('Where it was submitted'),
  since: z.string().optional().describe('ISO 8601: submitted at or after'),
  until: z.string().optional().describe('ISO 8601: submitted at or before'),
})

const SUBMISSION_NOTE = 'Everyone sees their own submissions; forms.edit sees all of the workspace\'s.'

export const submitFormEndpoint = defineEndpoint({
  method: 'POST', path: '/forms/{id}/submit', operationId: 'submitForm', tags: subTags,
  summary: 'Submit a reusable form', permission: 'forms.submit',
  description: 'Validates the values on the server, records a submission, runs the button\'s start-workflow actions (queued, attributed to the caller) and fires "Form submitted" triggers. Returns the submission, the effects the button shows (messages, success screen, redirect) and the started runs.',
  params: idParams, body: formSubmitBody, successStatus: 201,
  response: z.looseObject({ submission: looseObject, effects: looseObject, runs: z.array(looseObject), replayed: z.boolean().optional() }),
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
  body: z.object({ field_key: z.string().min(1).max(64), query: z.string().max(500).optional(), values: z.record(z.string(), z.unknown()).optional() }),
  response: z.looseObject({ items: z.array(looseObject), truncated: z.boolean().optional(), cached: z.boolean().optional(), too_short: z.boolean().optional() }),
  cli: { resource: 'forms', verb: 'lookup', positional: ['id'] },
})

export const formEndpoints = [
  listFormsEndpoint, createFormEndpoint, getFormEndpoint, updateFormEndpoint, deleteFormEndpoint,
  duplicateFormEndpoint, listFormVersionsEndpoint, getFormVersionEndpoint, listFormUsagesEndpoint,
  listFormThemesEndpoint, createFormThemeEndpoint, getFormThemeEndpoint, updateFormThemeEndpoint, deleteFormThemeEndpoint,
  submitFormEndpoint, listFormSubmissionsEndpoint, getFormSubmissionEndpoint, lookupFormFieldEndpoint,
]
