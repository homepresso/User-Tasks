import { z } from 'zod'
import { defineEndpoint } from './registry'
import { idParams, itemResponse, listResponse, looseObject } from './common'

/*
 * The form wizard (lib/services/form-wizard.ts): one call creates a form, a
 * data table for its responses, an optional review / approval workflow, a
 * results page and saved reports, linked together. The spec is
 * lib/forms/wizard/spec.ts (validated by the service; 400 lists every
 * problem).
 */

const SPEC_NOTE = 'The wizard spec: { name, description?, template? (request | survey | quiz | registration | feedback | incident | blank), questions: [{ id, kind (short_text, long_text, number, money, date, choice, choices, rating (stars), nps, yes_no, email, phone, file, heading, page_break, likert (agreement scale), matrix (grid of statements), slider, csat (smiley faces), ranking, image_choice (picture choice), yes_no_maybe), label, help?, required?, options? (choice / choices / likert scale points lowest first / matrix columns / ranking / image_choice), rows? (matrix: the statements), settings? { max (rating 2–10; slider highest), min, step, unit (slider), icon star|heart|thumb, half (rating), faces 3|5 (csat), bands (nps), low_label, high_label, multiple (image_choice), icons { <option>: <icon name> } (image_choice) }, currency? (money, ISO code), show_if? { question: <id of an earlier question>, op: is | is_not | contains | answered | not_answered | gt | lt, value? }, score? { correct: [answers], points? } (quizzes), key? (kept from an earlier create: the field and column key) }], look? { theme { kind: workspace } | { kind: saved, theme_id } | { kind: accent, color: #rrggbb }, header { show, logo, title?, subtitle? }, layout: single | steps | one_at_a_time, success { heading?, message? } }, audience? { internal, who: everyone | selected, role_ids, team_ids, show_in_menu, public_link (needs the workspace\'s anonymous forms switch), multiple_responses (false = one per signed-in person), opens_at?, closes_at? }, approval? { mode: none | single | manager | team | multi, stages: [{ id, name, assignee { kind: person, user_id } | { kind: manager, fallback_user_id } | { kind: team, team_id } | { kind: group, group_id, group_name? }, outcomes: [approve, decline?, changes?] }] (single / manager / team: 1 stage; multi: 2-5), notify_requester, due_days }, results? { charts, role_ids, team_ids } (who besides the owner opens the results page) }.'
const PERMISSION_NOTE = 'Needs forms.wizard only: the server creates exactly the wizard\'s objects, owned by the caller (no forms.edit / data.create / workflows.create needed). On a failure everything already created is removed.'

export const wizardCreateBody = z.object({
  spec: looseObject.describe(SPEC_NOTE),
  dry_run: z.boolean().optional().describe('Validate and describe what would be created (the plan) without creating anything'),
  project_id: z.string().uuid().optional().describe('A wizard draft of the caller to turn into the created form'),
})

export const wizardUpdateBody = z.object({
  spec: looseObject.describe(`${SPEC_NOTE} Send the questions with their ids (and keys) from the earlier create: kept questions keep their columns; new ones add columns; a removed question's column and data stay.`),
})

export const wizardResultsQuery = z.object({
  search: z.string().max(200).optional().describe('Responses containing this text'),
  status: z.string().max(40).optional().describe('Only responses with this status (Pending, Approved, Declined, Changes requested)'),
  sort: z.enum(['newest', 'oldest']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(5).max(100).optional(),
})

const tags = ['Form wizard']

export const createWizardFormEndpoint = defineEndpoint({
  method: 'POST', path: '/forms/wizard', operationId: 'createWizardForm', tags,
  summary: 'Create a form with the wizard: the form, a responses data table, an optional review / approval workflow and a results page',
  description: `${PERMISSION_NOTE} Returns the project (id for updates and the results page), the manifest of created ids (form_id, table_id, workflow_id, report_ids), links and the plan. With dry_run: only { plan, spec }.`,
  permission: 'forms.wizard', body: wizardCreateBody, successStatus: 201,
  response: looseObject,
  cli: { resource: 'forms', verb: 'wizard-create' },
})

export const listWizardFormsEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/wizard', operationId: 'listWizardForms', tags,
  summary: 'List the caller\'s wizard forms and drafts (newest first)', permission: 'forms.wizard',
  response: listResponse('projects'), listKey: 'projects',
  cli: { resource: 'forms', verb: 'wizard-list' },
})

export const getWizardFormEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/wizard/{id}', operationId: 'getWizardForm', tags,
  summary: 'Get a wizard form: its spec, the manifest of created objects and links (owner, or forms.edit)', permission: 'forms.wizard',
  params: idParams, response: itemResponse('project'),
  cli: { resource: 'forms', verb: 'wizard-get', positional: ['id'] },
})

export const updateWizardFormEndpoint = defineEndpoint({
  method: 'PATCH', path: '/forms/wizard/{id}', operationId: 'updateWizardForm', tags,
  summary: 'Update a wizard form and the objects it made (new columns are added, nothing is dropped; the workflow is published again)',
  description: `Owner, or forms.edit. ${PERMISSION_NOTE}`,
  permission: 'forms.wizard', params: idParams, body: wizardUpdateBody, response: looseObject,
  // `forms wizard-get <id> -o json > x.json` → edit → `forms wizard-update <id> -f x.json`.
  roundTrip: { normalize: (raw) => (raw && typeof raw === 'object' && 'project' in raw && (raw as { project?: { spec?: unknown } }).project?.spec ? { spec: (raw as { project: { spec: unknown } }).project.spec } : raw) },
  cli: { resource: 'forms', verb: 'wizard-update', positional: ['id'] },
})

export const getWizardResultsEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/wizard/{id}/results', operationId: 'getWizardResults', tags,
  summary: 'A wizard form\'s results: summary (counts, this week, approval rate), charts per question and a page of responses',
  description: 'The owner, the roles and teams chosen in the wizard\'s results step, or forms.edit; anyone else gets 404.',
  permission: null, params: idParams, query: wizardResultsQuery, response: looseObject,
  cli: { resource: 'forms', verb: 'wizard-results', positional: ['id'] },
})

export const formWizardEndpoints = [
  createWizardFormEndpoint, listWizardFormsEndpoint, getWizardFormEndpoint, updateWizardFormEndpoint, getWizardResultsEndpoint,
]
