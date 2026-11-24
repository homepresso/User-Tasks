import { z } from 'zod'
import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import { appCreateSchema, appUpdateSchema, pageCreateSchema, pageUpdateSchema } from '@/lib/apps/schema'
import { messageOf } from './_util'
import { APP_SPEC_SHAPE, BUILDER_SEARCH_KINDS } from '@/lib/apps/spec-input'

/*
 * App builder tools: thin wrappers over lib/services/apps (apps, pages,
 * audience, editors). The service owns access checks (audience / editors /
 * apps.manage), tenant filtering and audit (mutating tools are in
 * AUDITED_IN_SERVICE in ../authz).
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const appId = z.string().describe('App id or slug')
const pageId = z.string().describe('Page id or slug')
const versionArg = z.enum(['draft', 'published']).optional().describe('Editors: draft (default for editors — what apps_update / apps_page_* / apps_apply_spec change) or published (what the audience sees). Everyone else always gets the published version.')
/** Drafts: what every app tool description can rely on. */
const DRAFT_HELP = 'Apps have a working draft and published versions: every write (apps_update, apps_page_*, apps_apply_spec) changes the DRAFT; the audience sees only the published version until apps_publish. An app never published is visible to its editors only. Slug, audience and editors are not versioned (they apply at once).'
const side = z.union([z.enum(['draft', 'published']), z.number().int().min(1)])

export function registerAppTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)
  const load = () => import('@/lib/services/apps')

  server.tool('apps_list', 'List the apps the caller can open (or edit) with slug, icon, colour, access (view / edit) and first page. Filter by name or description.', {
    q: z.string().max(100).optional().describe('Name or description contains'),
    editable: z.boolean().optional().describe('Only apps the caller can edit'),
  }, async (args) => run(async () => (await load()).listApps(svc(), { search: args.q ?? null, editable: args.editable })))

  server.tool('apps_get', `One app with its pages (menu order) and menu; its builders also get the audience (users, teams, roles), editors and publish_state (published_version, has_draft_changes). content says which version it is. ${DRAFT_HELP}`, {
    app_id: appId,
    version: versionArg,
  }, async (args) => run(async () => (await load()).getApp(svc(), args.app_id, { version: args.version ?? null })))

  server.tool('apps_widget_types', 'The app widget catalogue: every widget type (buttons, tiles, task list, Kanban, calendar, workload, SLA and performance, workflow run widgets, form embed and analytics, data grid, card view, pivot, metrics, KPI, gauge, charts, heatmap, people, activity, content, layout containers, nav bar, agent chat) with group, default size and config JSON schema. Inputs can bind to page filters with { "filter": "<id>" }; click targets set filters with { "filter": "<id>", "page": "<slug>" }.', {}, async () => run(async () => (await load()).listWidgetTypes()))

  server.tool('apps_create', 'Create an app (needs Build apps). It starts with one empty page, Home; the caller becomes an editor. Set the audience to share it.', appCreateSchema.shape,
    async (args) => run(async () => (await load()).createApp(svc(), args as never)))

  server.tool('apps_update', 'Update an app: name, slug, description, icon, colour, menu, audience (replaced) and editors (replaced). Needs edit access (an editor of the app, or Build apps).', {
    app_id: appId,
    ...appUpdateSchema.shape,
  }, async ({ app_id, ...rest }) => run(async () => (await load()).updateApp(svc(), app_id, rest as never)))

  server.tool('apps_delete', 'Delete an app with its pages, audience and editors (needs Build apps).', {
    app_id: appId,
  }, async (args) => run(async () => (await load()).deleteApp(svc(), args.app_id)))

  server.tool('apps_pages_list', 'The pages of an app in menu order, each with its widgets (layout.widgets) and page filters (editors: the draft by default).', {
    app_id: appId,
    version: versionArg,
  }, async (args) => run(async () => (await load()).listPages(svc(), args.app_id, { version: args.version ?? null })))

  server.tool('apps_page_get', 'One page of an app: its widgets (layout.widgets: id, type, w, h, title, config) and page filters (editors: the draft by default).', {
    app_id: appId,
    page_id: pageId,
    version: versionArg,
  }, async (args) => run(async () => (await load()).getPage(svc(), args.app_id, args.page_id, { version: args.version ?? null })))

  /* ── Drafts and publishing (lib/services/app-versions.ts) ── */

  server.tool('apps_publish', `Publish an app's draft as its next version: everyone in its audience sees it from now on. Edit access. Refused with the problems when the draft can't be published (no pages, invalid widgets) or matches the published version already. Returns the version, what changed (diff.lines) and access issues as warnings. Audited. ${DRAFT_HELP}`, {
    app_id: appId,
    note: z.string().max(1000).optional().describe('Version note: what changed'),
  }, async (args) => run(async () => (await import('@/lib/services/app-versions')).publishApp(svc(), args.app_id, { note: args.note ?? null })))

  server.tool('apps_draft_discard', `Discard an app's draft: every unpublished change is thrown away and the app goes back to its published version (refused for an app never published). Edit access; audited. ${DRAFT_HELP}`, {
    app_id: appId,
  }, async (args) => run(async () => (await import('@/lib/services/app-versions')).discardAppDraft(svc(), args.app_id)))

  server.tool('apps_versions', `The published versions of an app, newest first: number, note, who published it and when, which one is live (edit access). ${DRAFT_HELP}`, {
    app_id: appId,
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }, async (args) => run(async () => (await import('@/lib/services/app-versions')).listAppVersions(svc(), args.app_id, { limit: args.limit, offset: args.offset })))

  server.tool('apps_version_get', 'One published version of an app: its immutable snapshot (header, menu, settings, every page with its layout and filters). Edit access.', {
    app_id: appId,
    version: z.number().int().min(1),
  }, async (args) => run(async () => (await import('@/lib/services/app-versions')).getAppVersion(svc(), args.app_id, args.version)))

  server.tool('apps_compare', `Compare two versions of an app (edit access): from / to are draft, published or a version number — by default published → draft ("what publishing would change"). Returns pages added / removed / changed (widgets, rules, settings), app rules, menu, navigation and style changes, readable lines, and publish_problems for the draft. ${DRAFT_HELP}`, {
    app_id: appId,
    from: side.optional().describe('draft, published (default) or a version number'),
    to: side.optional().describe('draft (default), published or a version number'),
  }, async (args) => run(async () => (await import('@/lib/services/app-versions')).compareAppVersions(svc(), args.app_id, { from: args.from, to: args.to })))

  server.tool('apps_version_restore', `Restore a published version of an app into its draft (replacing the draft): nothing changes for the audience until apps_publish. Edit access; audited. ${DRAFT_HELP}`, {
    app_id: appId,
    version: z.number().int().min(1),
  }, async (args) => run(async () => (await import('@/lib/services/app-versions')).restoreAppVersion(svc(), args.app_id, args.version)))

  server.tool('apps_page_create', 'Add a page to an app (edit access). See apps_widget_types for widget configs.', {
    app_id: appId,
    ...pageCreateSchema.shape,
  }, async ({ app_id, ...rest }) => run(async () => (await load()).createPage(svc(), app_id, rest as never)))

  server.tool('apps_page_update', 'Update a page of an app: title, slug, icon, position, widgets (layout, replaced) and filters (replaced). Needs edit access.', {
    app_id: appId,
    page_id: pageId,
    ...pageUpdateSchema.shape,
  }, async ({ app_id, page_id, ...rest }) => run(async () => (await load()).updatePage(svc(), app_id, page_id, rest as never)))

  server.tool('apps_page_delete', 'Delete a page of an app (edit access).', {
    app_id: appId,
    page_id: pageId,
  }, async (args) => run(async () => (await load()).deletePage(svc(), args.app_id, args.page_id)))

  server.tool('apps_access_check', 'Access issues of an app (edit access): for each audience entry and each form, workflow, data table or report the app uses, who can\'t see it (viewers) or submit / start it (contributors), why, and the fix — a form grant you can give or whom to ask. An app never grants access by itself.', {
    app_id: appId,
  }, async (args) => run(async () => (await load()).getAppAccessAnalysis(svc(), args.app_id)))

  server.tool('apps_access_grant', 'Fix access issues of an app with form grants (View + Submit, the minimum to submit), through the object permissions service: needs edit access to the app and Manage roles (team.change_roles); each grant is audited on the form. Keys come from apps_access_check; omit them to fix every gap you can.', {
    app_id: appId,
    keys: z.array(z.string().max(300)).max(500).optional().describe('Gap keys from apps_access_check (omitted: all you can fix)'),
  }, async (args) => run(async () => (await load()).grantAppAccess(svc(), args.app_id, args.keys?.length ? args.keys : 'all')))

  const choices = {
    excluded: z.array(z.object({ type: z.string().max(40), id: z.string().max(64) })).max(500).optional().describe('Dependencies to leave out ({ type, id }); default: the choices kept from the last package'),
    data_modes: z.record(z.string(), z.enum(['schema', 'rows'])).optional().describe('Per data table id: schema (default) or rows (sample data)'),
    content: z.enum(['published', 'draft']).optional().describe('published (default): the app\'s published version (its draft while never published); draft: the working draft'),
  }
  server.tool('apps_package_preview', 'What packaging an app would include (edit access): the app (pages, menu, settings, uploaded icons) and every form, workflow, data table, report, API reference + integration (definitions only, never credentials), agent and linked app it uses, the install requirements and the sites its Embed widgets need. Audience, editors and usage data are never exported.', {
    app_id: appId,
    ...choices,
  }, async (args) => run(async () => (await import('@/lib/services/app-packages')).previewAppPackage(svc(), args.app_id, { excluded: args.excluded, data_modes: args.data_modes, content: args.content })))

  server.tool('apps_package', 'Package / Export an app (edit access and packages.manage): keep its package (root: the app) with these choices, build the next signed version and return the .utpkg as base64 (file_base64). Install it in any workspace with packages_install (preview first with packages_install_plan).', {
    app_id: appId,
    ...choices,
    version: z.string().max(40).optional().describe('Exact semver; default: next patch (1.0.0 first)'),
    notes: z.string().max(2000).optional().describe('Release notes'),
  }, async (args) => run(async () => (await import('@/lib/services/app-packages')).packageApp(svc(), args.app_id, { excluded: args.excluded, data_modes: args.data_modes, version: args.version, notes: args.notes ?? null, content: args.content })))

  server.tool('apps_rule_types', 'App rules reference: triggers (page loaded, parameter / variable changes, filter changed, button / row / card / chart segment clicked, tab changed, form submitted, panel closed, timer, API reference returned) with their {{event.*}} payload, actions (set variables, filters, open targets in a mode passing values, close panel, navigate, refresh / show / hide widgets, enable / disable buttons, messages, confirm, call an API reference, data table look up / create / update, start a workflow, copy, download), system variables and the JSON schemas of a rule, a parameter and a variable. Rules go in a page layout (layout.rules) or the app (rules); parameters / variables in layout.params / layout.variables or the app.', {}, async () => run(async () => (await load()).listRuleTypes()))

  server.tool('apps_run_rule_action', 'Run an app rule\'s server action as the caller (call an API reference, look up / create / update data table rows, start a workflow). The action comes from the PUBLISHED app (its draft only while never published, for its editors) by rule id and path; only its template slot values are taken. Governed per action (app role, object permissions, data RLS, API reference gate), rate limited and audited.', {
    app_id: appId,
    page: z.string().max(80).nullable().optional().describe('Page id or slug (page rules); omit for app rules'),
    rule_id: z.string().max(40).describe('Rule id'),
    path: z.string().max(40).describe('Action path, e.g. then.2'),
    values: z.record(z.string().max(120), z.string().max(2000)).optional().describe('Template slot values: inputs.<name>, values.<column>, row_id, filter.<i>'),
    idempotency_key: z.string().min(8).max(100),
  }, async (args) => run(async () => (await import('@/lib/services/app-rule-actions')).runAppRuleAction(svc(), args.app_id, { page: args.page ?? null, rule_id: args.rule_id, path: args.path, values: args.values, idempotency_key: args.idempotency_key })))

  server.tool('apps_pages_reorder', 'Put the pages of an app in this order (page ids or slugs, first to last; edit access).', {
    app_id: appId,
    order: z.array(z.string().max(80)).min(1).max(100).describe('Page ids or slugs, first to last'),
  }, async (args) => run(async () => (await load()).reorderPages(svc(), args.app_id, args.order)))
  /* ── Building a whole app in one step (lib/services/app-spec.ts) ── */

  server.tool('apps_search', 'Find real objects to put in an app: forms, workflows, data tables, reports, teams, people, roles, agents, API references — and the columns / views of a data table (kind column / view with table) or the pages of an app (kind page with app). Returns id, name and a hint (status, owner, counts). Lists only what the caller may see. Without app it needs Build apps; with app, edit access to it.', {
    kind: z.enum(BUILDER_SEARCH_KINDS).describe('What to find'),
    q: z.string().max(100).optional().describe('Name contains'),
    app: z.string().max(80).nullable().optional().describe('The app being edited (id or slug); needed for kind page'),
    table: z.string().max(80).nullable().optional().describe('kind column / view: the data table id'),
    ids: z.array(z.string().max(80)).max(50).optional().describe('Resolve these ids to names instead of searching'),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).max(10_000).optional(),
  }, async (args) => run(async () => (await import('@/lib/services/app-search')).searchForBuilder(svc(), args)))

  server.tool('apps_object_details', 'What an app binds to: a form\'s fields and declared parameters (to pass with params), a data table\'s columns and views, or a workflow\'s trigger and start form.', {
    kind: z.enum(['form', 'table', 'workflow']),
    id: z.string().max(80).describe('Id from apps_search'),
  }, async (args) => run(async () => (await import('@/lib/services/app-spec')).describeAppObject(svc(), args)))

  server.tool('apps_spec_reference', 'How to build an app in one step: the app spec format (JSON schema), design guidance (page structure, layout and sizes on the 12-column grid, widgets for common asks, filters, theme, viewer / contributor roles, accessibility), the starter page templates, the widget catalogue in one line each, and a worked example. Read this before apps_plan / apps_apply_spec; the full config schema of a widget type comes from apps_widget_types.', {
    widget_types: z.array(z.string().max(40)).max(20).optional().describe('Also return the full config schemas of these widget types'),
  }, async (args) => run(async () => (await import('@/lib/services/app-spec')).appSpecReference(args.widget_types ?? [])))

  server.tool('apps_plan', 'Check an app spec without changing anything: a new app ({ app: { name, … }, pages: [ … ] }) or a change to one ({ app_id, pages: [{ page: "<slug>", add_widgets / update_widgets / remove_widgets }] }). Returns valid, plain-language errors to fix (unknown widget types, invalid settings with the allowed values, missing page filters, broken page links, objects that don\'t exist or you can\'t see, permissions), design warnings and a readable summary of what would be built. Call it until valid, then apps_apply_spec with the same spec.', APP_SPEC_SHAPE,
    async (args) => run(async () => (await import('@/lib/services/app-spec')).planAppSpec(svc(), args)))

  server.tool('apps_apply_spec', 'Build or change an app in one step from an app spec (same format as apps_plan; checked again first). A new app needs Build apps; a change needs edit access. Applied whole: if a step fails, nothing is kept (a new app is removed, changes are undone). The result is saved to the app\'s DRAFT (saved_as: draft): a new app is visible to its editors only and a changed app\'s audience keeps the published version until apps_publish; publish: true publishes right after (only when the person explicitly asked to make it live). Returns the app, links (preview_href: the draft as the audience would see it), pages and the number of access issues (fix with apps_access_check / apps_access_grant).', APP_SPEC_SHAPE,
    async (args) => run(async () => (await import('@/lib/services/app-spec')).applyAppSpec(svc(), args)))
}
