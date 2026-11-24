import { z } from 'zod'
import { appCreateSchema, appUpdateSchema, pageCreateSchema, pageUpdateSchema } from '@/lib/apps/schema'
import { appSpecInputSchema, BUILDER_SEARCH_KINDS } from '@/lib/apps/spec-input'
import { deletedResponse, itemResponse, listResponse } from './common'
import { defineEndpoint } from './registry'

/**
 * Apps (app builder): apps with their pages (widget layouts and page
 * filters), menu, audience and editors. lib/services/apps.ts.
 * Reads need apps.view and access to the app (audience, editor or
 * apps.manage); creating and deleting apps need apps.manage; editing an app
 * and its pages needs edit access (an editor of the app, or apps.manage).
 */

const tags = ['Apps']
const appParams = z.object({ id: z.string().describe('App id or slug') })
const appVersionParams = z.object({ id: z.string().describe('App id or slug'), version: z.coerce.number().int().min(1).describe('Version number') })
const DRAFT_NOTE = 'Drafts: an app\'s rows are its working DRAFT — every write (PATCH /apps/{id}, the page endpoints, POST /apps/spec/apply, package upgrades of an app with unpublished changes) changes the draft. Its audience sees only the latest PUBLISHED version (POST /apps/{id}/publish) — pages, widgets, menu, rules and rule actions; an app never published is visible to its editors only. Not versioned (effective at once): the slug, the audience and the editors. Before the drafts migration (20270123090000) is applied the draft endpoints answer 409 and every save is live.'
const versionQuery = z.object({ version: z.enum(['draft', 'published']).optional().describe('Editors: draft (default for editors) or published. Everyone else always gets the published version.') })
const pageParams = z.object({ id: z.string().describe('App id or slug'), pageId: z.string().describe('Page id or slug') })

// Bodies strip unknown keys (a fetched app / page round-trips as an update); the service validates strictly.
const appCreateBody = z.object(appCreateSchema.shape)
const appUpdateBody = z.object(appUpdateSchema.shape)
const pageCreateBody = z.object(pageCreateSchema.shape)
const pageUpdateBody = z.object(pageUpdateSchema.shape)

export const listAppsEndpoint = defineEndpoint({
  method: 'GET', path: '/apps', operationId: 'listApps', tags,
  summary: 'List the apps you can open (or edit), by name',
  permission: 'apps.view',
  query: z.object({
    q: z.string().max(100).optional().describe('Name or description contains'),
    editable: z.enum(['true', 'false']).optional().describe('Only apps you can edit'),
    tag: z.string().max(60).optional().describe('Only apps carrying this tag'),
  }),
  response: listResponse('apps'), listKey: 'apps',
  cli: { resource: 'apps', verb: 'list' },
})

export const createAppEndpoint = defineEndpoint({
  method: 'POST', path: '/apps', operationId: 'createApp', tags,
  summary: 'Create an app (starts with one empty page, Home; you become an editor)',
  permission: 'apps.manage',
  body: appCreateBody, successStatus: 201, response: itemResponse('app'),
  cli: { resource: 'apps', verb: 'create' },
})

export const listAppWidgetTypesEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/widget-types', operationId: 'listAppWidgetTypes', tags,
  summary: 'The widget catalogue: each widget type with its sizes and config JSON schema',
  permission: 'apps.view',
  response: listResponse('widget_types'), listKey: 'widget_types',
  cli: { resource: 'apps', verb: 'widget-types' },
})

export const getAppEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/{id}', operationId: 'getApp', tags,
  summary: 'An app with its pages and menu (audience, editors and publish state for its builders)',
  description: `content says which version: draft, published or live. ${DRAFT_NOTE}`,
  permission: 'apps.view', params: appParams, query: versionQuery, response: itemResponse('app'),
  cli: { resource: 'apps', verb: 'get', positional: ['id'], flags: { version: 'content-version' } },
})

export const updateAppEndpoint = defineEndpoint({
  method: 'PATCH', path: '/apps/{id}', operationId: 'updateApp', tags,
  summary: 'Update an app: name, slug, description, icon, colour, menu, audience (replaced) and editors (replaced)',
  description: 'Edit access: an editor of the app or apps.manage.',
  permission: 'apps.view', params: appParams, body: appUpdateBody, response: itemResponse('app'),
  roundTrip: { unwrap: 'app' },
  cli: { resource: 'apps', verb: 'update', positional: ['id'] },
})

export const deleteAppEndpoint = defineEndpoint({
  method: 'DELETE', path: '/apps/{id}', operationId: 'deleteApp', tags,
  summary: 'Delete an app with its pages, audience and editors',
  permission: 'apps.manage', params: appParams, response: deletedResponse,
  cli: { resource: 'apps', verb: 'delete', positional: ['id'] },
})

export const listAppPagesEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/{id}/pages', operationId: 'listAppPages', tags,
  summary: 'The pages of an app in menu order, with their widgets and filters',
  description: DRAFT_NOTE,
  permission: 'apps.view', params: appParams, query: versionQuery, response: listResponse('pages'), listKey: 'pages',
  cli: { resource: 'apps', verb: 'pages', positional: ['id'], flags: { version: 'content-version' } },
})

export const createAppPageEndpoint = defineEndpoint({
  method: 'POST', path: '/apps/{id}/pages', operationId: 'createAppPage', tags,
  summary: 'Add a page to an app (edit access)',
  permission: 'apps.view', params: appParams, body: pageCreateBody, successStatus: 201, response: itemResponse('page'),
  cli: { resource: 'apps', verb: 'add-page', positional: ['id'] },
})

export const reorderAppPagesEndpoint = defineEndpoint({
  method: 'POST', path: '/apps/{id}/pages/reorder', operationId: 'reorderAppPages', tags,
  summary: 'Put the app\'s pages in this order (edit access)',
  permission: 'apps.view', params: appParams,
  body: z.object({ order: z.array(z.string().max(80)).min(1).max(100).describe('Page ids or slugs, first to last') }),
  response: listResponse('pages'),
  cli: { resource: 'apps', verb: 'reorder-pages', positional: ['id'] },
})

export const getAppPageEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/{id}/pages/{pageId}', operationId: 'getAppPage', tags,
  summary: 'One page of an app: its widgets (layout.widgets) and page filters',
  description: DRAFT_NOTE,
  permission: 'apps.view', params: pageParams, query: versionQuery, response: itemResponse('page'),
  cli: { resource: 'apps', verb: 'page', positional: ['id', 'pageId'], flags: { version: 'content-version' } },
})

export const updateAppPageEndpoint = defineEndpoint({
  method: 'PATCH', path: '/apps/{id}/pages/{pageId}', operationId: 'updateAppPage', tags,
  summary: 'Update a page: title, slug, icon, position, widgets (layout, replaced) and filters (replaced) (edit access)',
  permission: 'apps.view', params: pageParams, body: pageUpdateBody, response: itemResponse('page'),
  roundTrip: { unwrap: 'page' },
  cli: { resource: 'apps', verb: 'update-page', positional: ['id', 'pageId'] },
})

export const deleteAppPageEndpoint = defineEndpoint({
  method: 'DELETE', path: '/apps/{id}/pages/{pageId}', operationId: 'deleteAppPage', tags,
  summary: 'Delete a page of an app (edit access)',
  permission: 'apps.view', params: pageParams, response: deletedResponse,
  cli: { resource: 'apps', verb: 'delete-page', positional: ['id', 'pageId'] },
})

export const getAppAccessEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/{id}/access', operationId: 'getAppAccess', tags,
  summary: 'Access issues: who in the audience can\'t use what the app shows them, and how to fix it (edit access)',
  description: 'For each audience entry × form, workflow, data table or report the app uses: viewers need to see it, contributors also to submit / start it. Each gap has a fix: a form grant the caller can give (Manage roles) or whom to ask.',
  permission: 'apps.view', params: appParams, response: z.looseObject({ gaps: z.array(z.looseObject({})), grantable: z.number().int() }),
  cli: { resource: 'apps', verb: 'access', positional: ['id'] },
})

export const grantAppAccessEndpoint = defineEndpoint({
  method: 'POST', path: '/apps/{id}/access/grant', operationId: 'grantAppAccess', tags,
  summary: 'Fix access issues with form grants (View + Submit) through the object permissions service (edit access and team.change_roles)',
  permission: 'team.change_roles', params: appParams,
  body: z.object({
    keys: z.array(z.string().max(300)).max(500).optional().describe('Gap keys from GET /apps/{id}/access; omitted = every gap you can fix'),
  }),
  response: z.looseObject({ granted: z.number().int(), analysis: z.looseObject({}) }),
  cli: { resource: 'apps', verb: 'grant-access', positional: ['id'] },
})

const packageItem = z.object({ type: z.string().max(40).describe('Artifact type (form, workflow, data_table, report, integration, connector, agent, decision_table, email_template, app, …)'), id: z.string().max(64) })
const appPackageChoices = {
  excluded: z.array(packageItem).max(500).optional().describe('Dependencies to leave out (they must exist where the package is installed); default: the choices kept from the last package'),
  data_modes: z.record(z.string(), z.enum(['schema', 'rows'])).optional().describe('Per data table id: "schema" (default) or "rows" (sample data)'),
  content: z.enum(['published', 'draft']).optional().describe('published (default): the app\'s published version (its draft while never published); draft: the working draft ("Export draft")'),
}

export const previewAppPackageEndpoint = defineEndpoint({
  method: 'POST', path: '/apps/{id}/package/preview', operationId: 'previewAppPackage', tags,
  summary: 'What packaging the app would include: dependencies (and why), install requirements, embed sites (edit access)',
  description: 'The app with its pages, the uploaded icons it uses and everything it references — forms, workflows, data tables (with views), reports, API references with their integration (definitions only, never credentials), agents, other apps it links to — plus what those need. Audience, editors, the embed allow-list and usage data are never exported.',
  permission: 'packages.view', params: appParams, body: z.object(appPackageChoices),
  response: z.looseObject({ app: z.looseObject({}), package: z.looseObject({}).nullable(), contents: z.looseObject({}), embed_origins: z.array(z.string()), icons: z.number().int(), people: z.number().int() }),
  cli: { resource: 'apps', verb: 'package-preview', positional: ['id'] },
})

export const packageAppEndpoint = defineEndpoint({
  method: 'POST', path: '/apps/{id}/package', operationId: 'packageApp', tags,
  summary: 'Package / Export an app: build the next signed version of its package and return the .utpkg (edit access and packages.manage)',
  description: 'Creates the app\'s package on first use (root: the app) or updates its choices, builds a signed version and returns it base64-encoded. Install it anywhere with POST /package-installs (preview with /package-installs/plan). Audited on the app and the package.',
  permission: 'packages.manage', params: appParams, successStatus: 201,
  body: z.object({
    ...appPackageChoices,
    version: z.string().max(40).optional().describe('Exact semver; default: the next patch (1.0.0 first)'),
    notes: z.string().max(2000).nullable().optional().describe('Release notes for this version'),
    description: z.string().max(2000).nullable().optional(),
    readme: z.string().max(20_000).nullable().optional().describe('Markdown shown before install'),
  }),
  response: z.looseObject({ package: z.looseObject({ id: z.string(), slug: z.string(), name: z.string() }), version: z.looseObject({}), warnings: z.array(z.string()), file_name: z.string(), file_base64: z.string().optional() }),
  cli: { resource: 'apps', verb: 'package', positional: ['id'] },
})

export const getAppRuleTypesEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/rule-types', operationId: 'getAppRuleTypes', tags,
  summary: 'App rules reference: triggers (with their {{event.*}} payload), actions, system variables and the JSON schemas of a rule, parameters and variables',
  permission: 'apps.view',
  response: z.looseObject({ triggers: z.array(z.looseObject({})), actions: z.array(z.looseObject({})) }),
  cli: { resource: 'apps', verb: 'rule-types' },
})

export const runAppActionEndpoint = defineEndpoint({
  method: 'POST', path: '/apps/{id}/actions', operationId: 'runAppAction', tags,
  summary: 'Run an app rule\'s server action (call an API reference, look up / create / update data table rows, start a workflow) as the caller',
  description: 'The action is read from the SAVED app by rule id and path; only the values of its declared template slots are taken from the request. Governance is re-checked per action (app role, object permissions, data table RLS, API reference gate), rate limited and audited. A repeated idempotency_key replays the result.',
  permission: 'apps.view', params: appParams,
  body: z.object({
    page: z.string().max(80).nullable().optional().describe('Page id or slug (page rules); omit for app rules'),
    rule_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).describe('Rule id'),
    path: z.string().regex(/^(then\.\d{1,2}(\.(then|else)\.\d{1,2})?|on_error\.\d{1,2})$/).describe('Action path in the rule, e.g. then.2, then.1.then.0, on_error.0'),
    values: z.record(z.string().max(120), z.string().max(2000)).optional().describe('Values of the action\'s template slots: inputs.<name>, values.<column>, row_id, filter.<i>[.<j>]'),
    idempotency_key: z.string().min(8).max(100).describe('A key per run (a retry replays the result)'),
  }),
  response: z.looseObject({ type: z.string(), result: z.unknown() }),
  cli: { resource: 'apps', verb: 'run-action', positional: ['id'] },
})

/* ── App specs: build or change a whole app in one step (lib/services/app-spec.ts) ── */

export const searchAppObjectsEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/spec/search', operationId: 'searchAppObjects', tags,
  summary: 'Find objects to put in an app (forms, workflows, data tables, reports, teams, people, roles, agents, API references, table columns / views, pages): id, name, hint',
  description: 'Lists only what you may see. Without app it needs apps.manage; with app, edit access to that app (kind page needs it).',
  permission: 'apps.view',
  query: z.object({
    kind: z.enum(BUILDER_SEARCH_KINDS).describe('What to find'),
    q: z.string().max(100).optional().describe('Name contains'),
    app: z.string().max(80).optional().describe('The app being edited (id or slug)'),
    table: z.string().max(80).optional().describe('kind column / view: the data table id'),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    offset: z.coerce.number().int().min(0).max(10_000).optional(),
  }),
  response: z.looseObject({ items: z.array(z.looseObject({ id: z.string(), name: z.string() })), next: z.number().int().nullable() }),
  cli: { resource: 'apps', verb: 'search' },
})

export const getAppObjectDetailsEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/spec/object', operationId: 'getAppObjectDetails', tags,
  summary: 'What an app binds to: a form\'s fields and parameters, a data table\'s columns and views, a workflow\'s trigger and start form',
  permission: 'apps.view',
  query: z.object({ kind: z.enum(['form', 'table', 'workflow']), id: z.string().max(80).describe('Id from /apps/spec/search') }),
  response: z.looseObject({ kind: z.string(), id: z.string(), name: z.string() }),
  cli: { resource: 'apps', verb: 'object' },
})

export const getAppSpecReferenceEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/spec/reference', operationId: 'getAppSpecReference', tags,
  summary: 'The app spec format (JSON schema), design guidance, starter templates, the widget catalogue in one line each and a worked example',
  permission: 'apps.view',
  query: z.object({ widget_types: z.string().max(800).optional().describe('Comma-separated widget types whose full config schemas to include') }),
  response: z.looseObject({ guide: z.string(), spec_schema: z.unknown(), widgets: z.array(z.string()) }),
  cli: { resource: 'apps', verb: 'spec-reference' },
})

export const planAppSpecEndpoint = defineEndpoint({
  method: 'POST', path: '/apps/spec/plan', operationId: 'planAppSpec', tags,
  summary: 'Check an app spec without changing anything: plain-language errors to fix, design warnings and a summary of what would be built',
  description: 'A new app ({ app: { name, … }, pages }) or a change to one ({ app_id, pages: [{ page, add_widgets / update_widgets / remove_widgets }] }). Validates every widget config against the widget catalogue, page filters, page links, the objects you bind (they must exist and be visible to you) and the permissions some bindings need. Always 200: `valid` says whether it can be applied.',
  permission: 'apps.view', body: appSpecInputSchema,
  response: z.looseObject({ valid: z.boolean(), errors: z.array(z.string()), warnings: z.array(z.string()), summary: z.looseObject({}).nullable() }),
  cli: { resource: 'apps', verb: 'plan' },
})

export const applyAppSpecEndpoint = defineEndpoint({
  method: 'POST', path: '/apps/spec/apply', operationId: 'applyAppSpec', tags,
  summary: 'Build or change an app in one step from an app spec (checked again first; applied whole or not at all)',
  description: `A new app needs apps.manage; a change needs edit access. If a step fails nothing is kept: a new app is removed again, changes to an existing app are undone. Every change is audited as you. The result is saved to the app's draft (saved_as: draft — publish with POST /apps/{id}/publish); publish: true publishes right after. Returns the app, its links (preview_href: the draft as its audience would see it), the pages and the number of access issues (GET /apps/{id}/access). ${DRAFT_NOTE}`,
  permission: 'apps.view', body: appSpecInputSchema,
  response: z.looseObject({ applied: z.literal(true), app: z.looseObject({ id: z.string(), slug: z.string(), name: z.string() }), href: z.string() }),
  cli: { resource: 'apps', verb: 'apply' },
})

/* ── Drafts and publishing (lib/services/app-versions.ts) ── */

export const publishAppEndpoint = defineEndpoint({
  method: 'POST', path: '/apps/{id}/publish', operationId: 'publishApp', tags,
  summary: 'Publish the app\'s draft as its next version (edit access): its audience sees it from now on',
  description: `Refused (422) with the problems when the draft can't be published (no pages, invalid widgets); 409 when it matches the published version. Returns the version, what changed against the previous one (diff) and access issues as warnings. Audited. ${DRAFT_NOTE}`,
  permission: 'apps.view', params: appParams,
  body: z.object({ note: z.string().max(1000).nullable().optional().describe('Version note: what changed') }),
  response: z.looseObject({ version: z.number().int(), previous_version: z.number().int().nullable(), diff: z.looseObject({}).nullable() }),
  cli: { resource: 'apps', verb: 'publish', positional: ['id'] },
})

export const discardAppDraftEndpoint = defineEndpoint({
  method: 'DELETE', path: '/apps/{id}/draft', operationId: 'discardAppDraft', tags,
  summary: 'Discard the app\'s draft: back to its published version (edit access)',
  description: `409 for an app that was never published. Audited. ${DRAFT_NOTE}`,
  permission: 'apps.view', params: appParams,
  response: z.looseObject({ discarded: z.literal(true), version: z.number().int() }),
  cli: { resource: 'apps', verb: 'draft-discard', positional: ['id'] },
})

export const listAppVersionsEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/{id}/versions', operationId: 'listAppVersions', tags,
  summary: 'The published versions of an app, newest first: number, note, publisher, date, which one is live (edit access)',
  description: DRAFT_NOTE,
  permission: 'apps.view', params: appParams,
  query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional(), offset: z.coerce.number().int().min(0).optional() }),
  response: z.looseObject({ published_version: z.number().int().nullable(), has_draft_changes: z.boolean(), versions: z.array(z.looseObject({})) }), listKey: 'versions',
  cli: { resource: 'apps', verb: 'versions', positional: ['id'] },
})

export const getAppVersionEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/{id}/versions/{version}', operationId: 'getAppVersion', tags,
  summary: 'One published version of an app: its immutable snapshot (header, menu, settings, pages with layouts and filters) (edit access)',
  permission: 'apps.view', params: appVersionParams,
  response: z.looseObject({ version: z.number().int(), current: z.boolean(), snapshot: z.looseObject({}) }),
  cli: { resource: 'apps', verb: 'version', positional: ['id', 'version'] },
})

const compareSide = z.string().regex(/^(draft|published|[1-9][0-9]{0,8})$/).optional()
export const compareAppVersionsEndpoint = defineEndpoint({
  method: 'GET', path: '/apps/{id}/compare', operationId: 'compareAppVersions', tags,
  summary: 'Compare two versions of an app: pages, widgets, rules, menu, navigation and style changes with readable lines (edit access)',
  description: `from / to are draft, published or a version number; default published → draft (what publishing would change). publish_problems lists what would block publishing the draft. ${DRAFT_NOTE}`,
  permission: 'apps.view', params: appParams,
  query: z.object({ from: compareSide.describe('draft, published (default) or a version number'), to: compareSide.describe('draft (default), published or a version number') }),
  response: z.looseObject({ diff: z.looseObject({ lines: z.array(z.string()), unchanged: z.boolean() }), publish_problems: z.array(z.string()) }),
  cli: { resource: 'apps', verb: 'compare', positional: ['id'] },
})

export const restoreAppVersionEndpoint = defineEndpoint({
  method: 'POST', path: '/apps/{id}/versions/{version}/restore', operationId: 'restoreAppVersion', tags,
  summary: 'Restore a published version into the app\'s draft (edit access): nothing changes for its audience until it is published',
  description: `Replaces the draft. Audited. ${DRAFT_NOTE}`,
  permission: 'apps.view', params: appVersionParams,
  response: z.looseObject({ restored_version: z.number().int() }),
  cli: { resource: 'apps', verb: 'version-restore', positional: ['id', 'version'] },
})

export const appEndpoints = [
  listAppsEndpoint, createAppEndpoint, listAppWidgetTypesEndpoint, getAppEndpoint, updateAppEndpoint, deleteAppEndpoint,
  listAppPagesEndpoint, createAppPageEndpoint, reorderAppPagesEndpoint, getAppPageEndpoint, updateAppPageEndpoint, deleteAppPageEndpoint,
  getAppAccessEndpoint, grantAppAccessEndpoint, previewAppPackageEndpoint, packageAppEndpoint, getAppRuleTypesEndpoint, runAppActionEndpoint,
  searchAppObjectsEndpoint, getAppObjectDetailsEndpoint, getAppSpecReferenceEndpoint, planAppSpecEndpoint, applyAppSpecEndpoint,
  publishAppEndpoint, discardAppDraftEndpoint, listAppVersionsEndpoint, getAppVersionEndpoint, compareAppVersionsEndpoint, restoreAppVersionEndpoint,
]
