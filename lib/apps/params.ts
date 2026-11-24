import { z } from 'zod'
import { resolveTemplate, scopeValue, type AppScope } from './variables'

/**
 * App parameter / variable values (pure; __tests__/apps-params.test.ts) —
 * one typed model for "where does this value come from" used wherever an
 * app hands values to something it opens: a form's declared parameters
 * (form widget, buttons, menu and nav entries, tab targets, card actions).
 *
 *  - static: a fixed text
 *  - filter: a page filter's current value
 *  - variable: an app / page variable (lib/apps/variables.ts; rules and
 *    widgets set them)
 *  - param: an app / page parameter
 *  - system: the viewer (id, name, email, avatar, teams, roles, manager,
 *    timezone), today / now / start of week / start and end of month (in the
 *    viewer's timezone), the workspace, the app, the page, a URL query
 *    parameter, the device, the viewer's app role
 *  - expression: a template ({{var.rowId}}, "Order {{param.order}}") or an
 *    expression ({{= var.qty * 2 }}) over all of the above
 *  - event: a field of the clicked row / card (when opened from a list, card
 *    or grid event)
 *
 * Values are only ever hints: the form validates them against its own
 * declarations (types, allowed values, patterns) and the server recomputes
 * anything it relies on.
 */

export const SYSTEM_KEYS = [
  'user_id', 'user_name', 'user_email', 'team_id', 'today', 'now', 'app', 'page', 'url_param',
  'user_avatar', 'user_teams', 'user_roles', 'user_manager', 'user_timezone', 'start_of_week', 'start_of_month', 'end_of_month',
  'workspace_id', 'workspace_name', 'app_id', 'app_name', 'page_id', 'page_name', 'is_mobile', 'app_role',
] as const
export type SystemKey = (typeof SYSTEM_KEYS)[number]

/** Each system key → its path in the app scope (lib/apps/variables.ts). */
export const SYSTEM_KEY_PATHS: Record<SystemKey, string> = {
  user_id: 'sys.user.id', user_name: 'sys.user.name', user_email: 'sys.user.email', team_id: 'sys.user.team_ids.0', today: 'sys.today', now: 'sys.now',
  app: 'sys.app.slug', page: 'sys.page.slug', url_param: 'sys.url', user_avatar: 'sys.user.avatar', user_teams: 'sys.user.teams', user_roles: 'sys.user.roles',
  user_manager: 'sys.user.manager.id', user_timezone: 'sys.user.timezone', start_of_week: 'sys.start_of_week', start_of_month: 'sys.start_of_month', end_of_month: 'sys.end_of_month',
  workspace_id: 'sys.workspace.id', workspace_name: 'sys.workspace.name', app_id: 'sys.app.id', app_name: 'sys.app.name', page_id: 'sys.page.id', page_name: 'sys.page.name',
  is_mobile: 'sys.device.mobile', app_role: 'sys.app_role',
}

export const valueSourceSchema = z.discriminatedUnion('from', [
  z.object({ from: z.literal('static'), value: z.string().max(400) }).strict(),
  z.object({ from: z.literal('filter'), filter: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/) }).strict(),
  z.object({ from: z.literal('variable'), name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/) }).strict(),
  z.object({ from: z.literal('param'), name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/) }).strict(),
  z.object({ from: z.literal('expression'), expr: z.string().max(1000) }).strict(),
  z.object({ from: z.literal('system'), key: z.enum(SYSTEM_KEYS), param: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional() }).strict(),
  z.object({ from: z.literal('event'), key: z.string().min(1).max(80) }).strict(),
])
export type ValueSource = z.infer<typeof valueSourceSchema>

/** A form's parameters → their value sources ({ <param name>: source }). */
export const paramMapSchema = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), valueSourceSchema)
  .refine((m) => Object.keys(m).length <= 30, 'At most 30 parameters').optional()
export type ParamMap = z.infer<typeof paramMapSchema>

export interface ValueContext {
  filters: Record<string, unknown>
  /** App / page variables (merged, page over app). */
  variables?: Record<string, unknown>
  /** The full app scope (params, variables, system variables): when given, variable / param / system / expression read it. */
  scope?: AppScope
  user?: { id?: string | null; name?: string | null; email?: string | null; team?: string | null }
  app?: string
  page?: string
  /** The page URL's query. */
  query?: Record<string, string>
  /** The clicked row / card's values. */
  event?: Record<string, string>
  now?: Date
}

/** One source's value as text (null: nothing to pass). */
export function resolveValue(source: ValueSource, ctx: ValueContext): string | null {
  const text = (v: unknown) => (v === null || v === undefined || v === '' ? null : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null)
  const any = (v: unknown) => (Array.isArray(v) ? text(v.join(',')) : v && typeof v === 'object' ? JSON.stringify(v) : text(v))
  if (ctx.scope) {
    const s = ctx.scope
    if (source.from === 'variable') return any(s.var[source.name])
    if (source.from === 'param') return any(s.param[source.name])
    if (source.from === 'expression') return any(resolveTemplate(source.expr, { ...s, event: { ...(s.event ?? {}), ...(ctx.event ?? {}) } }))
    if (source.from === 'system') return source.key === 'url_param' ? (source.param ? text(s.sys.url[source.param]) : null) : any(scopeValue(SYSTEM_KEY_PATHS[source.key], s))
  }
  switch (source.from) {
    case 'static': return text(source.value)
    case 'filter': return text(ctx.filters[source.filter])
    case 'variable': return text(ctx.variables?.[source.name])
    case 'param': return null
    case 'expression': return null
    case 'event': return text(ctx.event?.[source.key])
    case 'system': {
      const now = ctx.now ?? new Date()
      switch (source.key) {
        case 'user_id': return text(ctx.user?.id)
        case 'user_name': return text(ctx.user?.name)
        case 'user_email': return text(ctx.user?.email)
        case 'team_id': return text(ctx.user?.team)
        case 'today': return now.toISOString().slice(0, 10)
        case 'now': return now.toISOString()
        case 'app': return text(ctx.app)
        case 'page': return text(ctx.page)
        case 'url_param': return source.param ? text(ctx.query?.[source.param]) : null
        default: return null
      }
    }
  }
}

/** A whole map → { name: value } (unresolved entries left out), each capped. */
export function resolveParams(map: ParamMap | null | undefined, ctx: ValueContext): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, source] of Object.entries(map ?? {})) {
    const v = resolveValue(source, ctx)
    if (v !== null) out[name] = v.slice(0, 400)
  }
  return out
}

/** Required parameters a map leaves unmapped (for the builder's warnings). */
export function unmappedRequired(declared: ReadonlyArray<{ name: string; required?: boolean; default?: string }>, map: ParamMap | null | undefined): string[] {
  return declared.filter((p) => p.required && !p.default && !map?.[p.name]).map((p) => p.name)
}

/** Does a map need the viewer's profile (name / email / team)? */
export function needsUser(map: ParamMap | null | undefined): boolean {
  return Object.values(map ?? {}).some((s) => (s.from === 'system' && s.key !== 'today' && s.key !== 'now' && s.key !== 'app' && s.key !== 'page' && s.key !== 'url_param' && s.key !== 'user_id') || s.from === 'expression')
}
