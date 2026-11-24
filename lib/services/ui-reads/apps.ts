import { z } from 'zod'
import { getDb, hasPerm, ServiceError, type ServiceContext } from '../context'
import * as apps from '../apps'
import { getWidgetData } from '../app-widgets'
import { pickerSearchSchema, searchPicker } from '../app-search'
import { quickSearch } from '../app-widget-actions'
import { badgeCounts } from '../app-widgets-more'
import { compareAppVersions, getAppVersion, listAppVersions } from '../app-versions'
import { BADGE_SOURCES } from '@/lib/apps/schema'
import { defineRead, id, type UiRead } from './define'

/* eslint-disable @typescript-eslint/no-explicit-any -- picker rows */

/**
 * Apps (app builder): the Apps menu list, an app page, widget data and the
 * builder's pickers. Gated on apps.view / apps.manage (as the /apps pages);
 * which apps and pages is the app's audience and editors (lib/services/apps.ts); widget data is read as the
 * viewer (lib/services/app-widgets.ts).
 */

const key = z.string().min(1).max(80)
/** The /apps pages need Use apps or Build apps (lib/route-permissions.ts); the service then checks the app's audience / editors. */
const PERM = ['apps.view', 'apps.manage'] as const
const filterValue = z.union([
  z.string().max(200),
  z.object({ preset: z.string().max(20) }).strict(),
  z.object({ from: z.string().max(10).nullable().optional(), to: z.string().max(10).nullable().optional() }).strict(),
  z.null(),
])

/** Builder pickers: names of the things a widget can point at, as the builder sees them (RLS). */
async function pickerOptions(ctx: ServiceContext, appKey: string) {
  if ((await apps.getAppAccess(ctx, appKey)) !== 'edit') throw ServiceError.notFound('App not found')
  const db = getDb(ctx) as any
  const t = ctx.tenantId
  const [forms, workflows, tables, reports, teams, roles, members] = await Promise.all([
    db.from('forms').select('id, name').eq('tenant_id', t).order('name').limit(500),
    db.from('workflows').select('id, name').eq('tenant_id', t).order('name').limit(500),
    db.from('custom_tables').select('id, name, columns').eq('tenant_id', t).order('name').limit(500),
    db.from('reports').select('id, name').eq('tenant_id', t).order('name').limit(500),
    db.from('teams').select('id, name').eq('tenant_id', t).order('name').limit(500),
    db.from('roles').select('id, name').eq('tenant_id', t).order('name').limit(200),
    db.from('user_memberships').select('user_id, user:users(id, display_name, email)').eq('tenant_id', t).eq('is_active', true).limit(1000),
  ])
  const list = (r: any) => ((r.data ?? []) as any[]).map((x) => ({ id: String(x.id), name: String(x.name ?? 'Untitled') }))
  return {
    forms: list(forms),
    workflows: list(workflows),
    tables: ((tables.data ?? []) as any[]).map((x) => ({
      id: String(x.id), name: String(x.name ?? 'Table'),
      columns: ((Array.isArray(x.columns) ? x.columns : []) as any[]).filter((c) => c?.key).map((c) => ({ key: String(c.key), name: String(c.name ?? c.key), type: String(c.type ?? 'text') })),
    })),
    reports: list(reports),
    teams: list(teams),
    roles: list(roles),
    users: ((members.data ?? []) as any[]).filter((m) => m.user).map((m) => ({
      id: String(m.user_id), name: String(m.user.display_name || (m.user.email ? String(m.user.email).split('@')[0] : 'Someone')), email: m.user.email ?? null,
    })).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/**
 * Options for a page's filter bar, for anyone who can open the app — only
 * what the viewer may see anyway: forms and data tables through RLS and
 * their permissions, workflows with workflows.view, every team and person
 * with team.view_members (otherwise their own teams and themselves).
 */
async function filterOptions(ctx: ServiceContext, appKey: string) {
  if (!(await apps.getAppAccess(ctx, appKey))) throw ServiceError.notFound('App not found')
  const db = getDb(ctx) as any
  const t = ctx.tenantId
  const people = hasPerm(ctx, 'team.view_members')
  const none = Promise.resolve({ data: [] })
  const [forms, workflows, tables, teams, members] = await Promise.all([
    hasPerm(ctx, 'forms.submit') || hasPerm(ctx, 'forms.view') ? db.from('forms').select('id, name').eq('tenant_id', t).order('name').limit(500) : none,
    hasPerm(ctx, 'workflows.view') ? db.from('workflows').select('id, name').eq('tenant_id', t).order('name').limit(500) : none,
    hasPerm(ctx, 'data.view') ? db.from('custom_tables').select('id, name').eq('tenant_id', t).order('name').limit(500) : none,
    people
      ? db.from('teams').select('id, name').eq('tenant_id', t).order('name').limit(500)
      : db.from('user_teams').select('team:teams!inner(id, name, tenant_id)').eq('user_id', ctx.actorId).eq('team.tenant_id', t),
    people ? db.from('user_memberships').select('user_id, user:users(id, display_name, email)').eq('tenant_id', t).eq('is_active', true).limit(1000) : none,
  ])
  const list = (r: any) => ((r.data ?? []) as any[]).map((x) => ({ id: String(x.id), name: String(x.name ?? 'Untitled') }))
  return {
    forms: list(forms),
    workflows: list(workflows),
    tables: list(tables),
    teams: people ? list(teams) : ((teams.data ?? []) as any[]).filter((x) => x.team).map((x) => ({ id: String(x.team.id), name: String(x.team.name ?? 'Team') })),
    users: ((members.data ?? []) as any[]).filter((m) => m.user).map((m) => ({
      id: String(m.user_id), name: String(m.user.display_name || (m.user.email ? String(m.user.email).split('@')[0] : 'Someone')),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export const reads = {
  /** The apps the signed-in person can open (Apps menu); editable: only the ones they can edit. */
  'apps.mine': defineRead({
    args: z.object({ editable: z.boolean().optional() }).optional(),
    perm: PERM,
    run: async (ctx, args) => apps.listApps(ctx, { editable: args?.editable }),
  }),
  'apps.get': defineRead({
    perm: PERM,
    args: z.object({ app: key, version: z.enum(['draft', 'published']).nullable().optional() }),
    run: async (ctx, { app, version }) => apps.getApp(ctx, app, { version: version ?? null }),
  }),
  /**
   * An app and one page (the first when `page` is omitted): the published
   * version as the viewer may see it (view), the draft as stored for the
   * builder (edit, editors only), or the draft as the audience would see it
   * (preview, editors only; `as_role` previews as a viewer / contributor).
   */
  'apps.page': defineRead({
    perm: PERM,
    args: z.object({ app: key, page: key.nullable().optional(), mode: z.enum(['view', 'edit', 'preview']).optional(), as_role: z.enum(['viewer', 'contributor']).nullable().optional() }),
    run: async (ctx, { app, page, mode, as_role }) => apps.getAppPageView(ctx, app, page ?? null, mode ?? 'view', { as_role: as_role ?? null }),
  }),
  /** App settings → Share: the friendly /app/<slug> link, the embed and the in-app address. */
  'apps.links': defineRead({
    perm: PERM,
    args: z.object({ app: key }),
    run: async (ctx, { app }) => apps.getAppLinks(ctx, app),
  }),
  /** Version history (editors): published versions, newest first. */
  'apps.versions': defineRead({
    perm: PERM,
    args: z.object({ app: key, limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).max(10_000).optional() }),
    run: async (ctx, { app, limit, offset }) => listAppVersions(ctx, app, { limit, offset }),
  }),
  /** One published version's snapshot (editors). */
  'apps.version': defineRead({
    perm: PERM,
    args: z.object({ app: key, version: z.number().int().min(1) }),
    run: async (ctx, { app, version }) => getAppVersion(ctx, app, version),
  }),
  /** Compare two versions (draft, published or a number; default published → draft) with publish problems (editors). */
  'apps.compare': defineRead({
    perm: PERM,
    args: z.object({ app: key, from: z.union([z.enum(['draft', 'published']), z.number().int().min(1)]).nullable().optional(), to: z.union([z.enum(['draft', 'published']), z.number().int().min(1)]).nullable().optional() }),
    run: async (ctx, { app, from, to }) => compareAppVersions(ctx, app, { from, to }),
  }),
  /** Access issues for the builder (editors): the saved app, or with an unsaved page / audience / menu. */
  'apps.access': defineRead({
    perm: PERM,
    args: z.object({
      app: key,
      page_id: key.nullable().optional(),
      layout: z.unknown().optional(),
      audience: z.array(z.object({ type: z.enum(['user', 'team', 'role']), id, role: z.enum(['viewer', 'contributor']).optional() })).max(500).nullable().optional(),
      menu: z.unknown().optional(),
      rules: z.unknown().optional(),
    }),
    run: async (ctx, { app, ...draft }) => apps.getAppAccessAnalysis(ctx, app, draft as Parameters<typeof apps.getAppAccessAnalysis>[2]),
  }),
  /** The viewer's own profile for system variables (name, email, avatar, teams, roles, manager, timezone, workspace). */
  'apps.viewer': defineRead({
    perm: PERM,
    args: z.object({ app: key }),
    run: async (ctx, { app }) => (await import('../app-viewer')).appViewerProfile(ctx, app),
  }),
  'apps.pages': defineRead({
    perm: PERM,
    args: z.object({ app: key }),
    run: async (ctx, { app }) => apps.listPages(ctx, app),
  }),
  'apps.widget': defineRead({
    perm: PERM,
    args: z.object({
      app: key,
      page: key,
      widget_id: id,
      filters: z.record(z.string().max(40), filterValue).optional(),
      preview: z.object({ type: z.string().max(40), config: z.unknown() }).nullable().optional(),
      /** Editors: the widget of the DRAFT page (Preview), optionally as a lower app role. */
      draft: z.boolean().nullable().optional(),
      as_role: z.enum(['viewer', 'contributor']).nullable().optional(),
      params: z.object({ q: z.string().max(200).optional(), page: z.number().int().min(0).max(1000).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), row: z.string().max(80).optional(), tab: z.number().int().min(0).max(7).optional(),
        /** Data grid: the viewer's sort, columns shown and "equals" filters (lib/apps/grid-views.ts). */
        sort: z.string().max(80).optional(), dir: z.enum(['asc', 'desc']).optional(),
        cols: z.array(z.string().max(80)).max(30).optional(),
        eq: z.array(z.object({ column: z.string().max(80), value: z.string().max(200) }).strict()).max(5).optional(),
      }).strict().optional(),
    }),
    run: async (ctx, args) => getWidgetData(ctx, args as Parameters<typeof getWidgetData>[1]),
  }),
  /** Quick search widget: the app's pages and the objects its pages show the viewer, plus their tasks. */
  'apps.quickSearch': defineRead({
    perm: PERM,
    args: z.object({ app: key, q: z.string().max(100), include: z.array(z.enum(['pages', 'forms', 'workflows', 'tables', 'reports', 'tasks'])).max(6), draft: z.boolean().nullable().optional(), as_role: z.enum(['viewer', 'contributor']).nullable().optional() }),
    run: async (ctx, args) => quickSearch(ctx, args),
  }),
  /** Live badge counts for menu entries / nav bar items (as the viewer; counts they can't read are left out). */
  'apps.badges': defineRead({
    perm: PERM,
    args: z.object({ app: key, sources: z.array(z.enum(BADGE_SOURCES)).max(5) }),
    run: async (ctx, { app, sources }) => {
      if (!(await apps.getAppAccess(ctx, app))) throw ServiceError.notFound('App not found')
      return badgeCounts(ctx, sources)
    },
  }),
  /** Sites Embed widgets may frame (the builder's preview checks addresses against it). */
  'apps.embedOrigins': defineRead({
    perm: PERM,
    args: z.object({ app: key }),
    run: async (ctx, { app }) => {
      if ((await apps.getAppAccess(ctx, app)) !== 'edit') throw ServiceError.notFound('App not found')
      const { loadAppEmbedOrigins } = await import('../tenant-settings')
      return { origins: await loadAppEmbedOrigins(ctx) }
    },
  }),
  /** The workspace's uploaded app icons (custom SVG library). */
  'apps.icons': defineRead({
    perm: PERM,
    args: z.object({}).optional(),
    run: async (ctx) => (await import('../app-icons')).listAppIcons(ctx),
  }),
  /** A form's declared parameters and variables (the builder's mapping table), for a designer who can see the form. */
  'apps.formParams': defineRead({
    perm: PERM,
    args: z.object({ app: key, form: id }),
    run: async (ctx, { app, form }) => {
      if ((await apps.getAppAccess(ctx, app)) !== 'edit') throw ServiceError.notFound('App not found')
      if (!hasPerm(ctx, 'forms.view') && !hasPerm(ctx, 'forms.edit') && !hasPerm(ctx, 'forms.submit')) return { params: [], variables: [] }
      const { data } = await (getDb(ctx) as any).from('forms').select('id, layout').eq('tenant_id', ctx.tenantId).eq('id', form).maybeSingle()
      if (!data) return { params: [], variables: [] }
      const { layoutFormParams, layoutFormVariables } = await import('@/lib/forms/form-params')
      const params = layoutFormParams(data.layout).map((p) => ({ name: p.name, label: p.label ?? null, type: p.type, required: !!p.required, default: p.default ?? null, source: p.source }))
      const variables = layoutFormVariables(data.layout).map((v) => ({ name: v.name, label: v.label ?? null, type: v.type, initial: v.initial?.kind ?? 'none' }))
      return { params, variables }
    },
  }),
  'apps.filterOptions': defineRead({
    perm: PERM,
    args: z.object({ app: key }),
    run: async (ctx, { app }) => filterOptions(ctx, app),
  }),
  /** Searchable pickers (builder: what the designer can see; filter bar: what the viewer can see), paged. */
  'apps.search': defineRead({
    perm: PERM,
    args: pickerSearchSchema,
    run: async (ctx, args) => searchPicker(ctx, args),
  }),
  'apps.pickers': defineRead({
    perm: PERM,
    args: z.object({ app: key }),
    run: async (ctx, { app }) => pickerOptions(ctx, app),
  }),
} satisfies Record<string, UiRead>
