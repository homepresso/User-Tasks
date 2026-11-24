import { z } from 'zod'
import { FORM_PARAMS_KEY, FORM_VARS_KEY } from '@/lib/forms/form-params'
import { resolveRuleTemplate, type RuleScope } from '@/lib/forms/form-rules'
import { evaluateLabelExpression } from '@/lib/forms/label-field'
import { pathValue } from '@/lib/forms/lookup'
import { extractFunctionExpressions } from '@/lib/expression-resolver'

/**
 * App parameters, variables and system variables (pure, isomorphic;
 * __tests__/apps-variables.test.ts).
 *
 *  - PARAMETERS are declared on the app and on a page (name, type, default,
 *    required). Values come from the URL (?p.<name>=…), from whatever opened
 *    the page (a button / tile / nav entry / rule opening it in a panel), or
 *    from the embed URL. Typed and validated here (`parseParam`); an invalid
 *    value is dropped (the default stands) and reported.
 *  - VARIABLES are declared on the app and on a page (name, type, default).
 *    Rules and widgets set them. A page variable marked `url` is kept in the
 *    URL (?v.<name>=…) so the view can be shared; everything else lives in
 *    memory for the session (app variables survive moving between pages).
 *  - SYSTEM variables are read-only and available everywhere: the viewer
 *    (id, name, email, avatar, teams, roles, manager, timezone), today / now /
 *    start of week / start and end of month in the viewer's timezone, the
 *    workspace, the app, the page, the URL's query, the device and the
 *    viewer's app role (`systemVariables`).
 *
 * One scope reads them all (`AppScope`), with the same paths everywhere —
 * widget bindings, page filter defaults, form parameter mapping, rule
 * conditions and actions, text and headings:
 *
 *   {{param.<name>}}  {{var.<name>}}  {{sys.user.name}}  {{sys.today}}
 *   {{filter.<id>}}   {{event.row.id}} (rules)  {{result.<path>}} (rules)
 *   {{= <expression>}} (the form label expression language)
 *
 * Templates and conditions go through the form rules engine
 * (lib/forms/form-rules.ts), expressions through the label expression
 * engine (lib/forms/label-field.ts), so app rules read like form rules.
 */

export const VAR_TYPES = ['text', 'number', 'boolean', 'date', 'list', 'record'] as const
export type VarType = (typeof VAR_TYPES)[number]
export const VAR_TYPE_LABELS: Record<VarType, string> = { text: 'Text', number: 'Number', boolean: 'Yes / no', date: 'Date', list: 'List', record: 'Record (object)' }

export const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/
export const MAX_PARAMS = 20
export const MAX_VARIABLES = 40
export const MAX_VALUE_BYTES = 8 * 1024
const name = z.string().regex(VAR_NAME_RE, 'Letters, numbers and _ (start with a letter or _), up to 40')
const defaultValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.array(z.union([z.string().max(400), z.number(), z.boolean()])).max(100), z.record(z.string().max(80), z.unknown())]).nullable().optional()

export const paramDeclSchema = z.object({
  name,
  type: z.enum(VAR_TYPES).default('text'),
  label: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(400).nullable().optional(),
  /** Used when nothing passes a value. A text default may be a template ({{sys.user.id}}). */
  default: defaultValue,
  required: z.boolean().default(false),
}).strict()
export type ParamDecl = z.output<typeof paramDeclSchema>

export const variableDeclSchema = z.object({
  name,
  type: z.enum(VAR_TYPES).default('text'),
  label: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(400).nullable().optional(),
  default: defaultValue,
  /** Page variables only: kept in the URL (?v.<name>=…) so the view can be shared. */
  url: z.boolean().default(false),
}).strict()
export type VariableDecl = z.output<typeof variableDeclSchema>

const unique = <T extends { name: string }>(list: T[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>()
  for (const p of list) {
    if (seen.has(p.name)) ctx.addIssue({ code: 'custom', message: `${p.name} is declared twice` })
    seen.add(p.name)
  }
}
export const paramsSchema = z.array(paramDeclSchema).max(MAX_PARAMS).superRefine(unique)
export const variablesSchema = z.array(variableDeclSchema).max(MAX_VARIABLES).superRefine(unique)

/** Stored declarations → the valid ones (invalid / duplicate entries dropped, never thrown). */
export function normaliseDecls<T extends { name: string }>(raw: unknown, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }, max: number): T[] {
  if (!Array.isArray(raw)) return []
  const out: T[] = []
  const seen = new Set<string>()
  for (const entry of raw.slice(0, max)) {
    const parsed = schema.safeParse(entry)
    const data = parsed.data as T | undefined
    if (!parsed.success || !data || seen.has(data.name)) continue
    seen.add(data.name)
    out.push(data)
  }
  return out
}
export const normaliseParams = (raw: unknown) => normaliseDecls<ParamDecl>(raw, paramDeclSchema, MAX_PARAMS)
export const normaliseVariables = (raw: unknown) => normaliseDecls<VariableDecl>(raw, variableDeclSchema, MAX_VARIABLES)

/* ── Typing ──────────────────────────────────────────────────────────── */

export type TypedValue = string | number | boolean | null | unknown[] | Record<string, unknown>

/**
 * Any value → the declared type, or `undefined` when it doesn't fit
 * (null / '' → null). Text from the URL is parsed: numbers, booleans
 * (true/false/yes/no/1/0), dates (YYYY-MM-DD or ISO), lists (JSON array or
 * comma-separated), records (JSON object).
 */
export function coerceValue(type: VarType, raw: unknown): TypedValue | undefined {
  if (raw === null || raw === undefined || raw === '') return null
  switch (type) {
    case 'text':
      if (typeof raw === 'string') return raw.slice(0, 2000)
      if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
      return undefined
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(raw) ? Number(raw) : NaN
      return Number.isFinite(n) ? n : undefined
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw
      const t = String(raw).trim().toLowerCase()
      if (['true', 'yes', '1', 'on'].includes(t)) return true
      if (['false', 'no', '0', 'off'].includes(t)) return false
      return undefined
    }
    case 'date': {
      if (typeof raw !== 'string') return undefined
      const s = raw.trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? undefined : s
      if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s))) return s
      return undefined
    }
    case 'list': {
      if (Array.isArray(raw)) return raw.slice(0, 500)
      if (typeof raw !== 'string') return [raw]
      const s = raw.trim()
      if (s.startsWith('[')) { try { const v = JSON.parse(s); return Array.isArray(v) ? v.slice(0, 500) : undefined } catch { return undefined } }
      return s.split(',').map((x) => x.trim()).filter(Boolean)
    }
    case 'record': {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
      if (typeof raw !== 'string') return undefined
      try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined } catch { return undefined }
    }
  }
}

/** A value within the size budget? (variables travel in URLs and requests) */
export function withinBudget(value: unknown): boolean {
  try { return JSON.stringify(value ?? null).length <= MAX_VALUE_BYTES } catch { return false }
}

/** A typed value as URL / request text. */
export function encodeValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return '' }
}

export interface ParamProblem { name: string; message: string }

/**
 * Parameter values for a page: given values (URL / opener / embed) typed
 * against the declarations; missing ones take their default (a text default
 * may be a template, resolved against `scope`); invalid ones are dropped
 * with a problem; required ones still missing are reported.
 */
export function resolveParamValues(decls: readonly ParamDecl[], given: Record<string, unknown>, scope?: AppScope): { values: Record<string, TypedValue>; problems: ParamProblem[] } {
  const values: Record<string, TypedValue> = {}
  const problems: ParamProblem[] = []
  for (const d of decls) {
    let v: TypedValue | undefined
    if (Object.hasOwn(given, d.name)) {
      v = coerceValue(d.type, given[d.name])
      if (v === undefined) problems.push({ name: d.name, message: `${d.label || d.name}: “${encodeValue(given[d.name]).slice(0, 40)}” is not a ${VAR_TYPE_LABELS[d.type].toLowerCase()}` })
    }
    if (v === undefined || v === null) {
      const def = typeof d.default === 'string' && scope ? resolveTemplate(d.default, scope) : d.default
      const typed = coerceValue(d.type, def)
      v = typed === undefined ? null : typed
    }
    if ((v === null || v === '') && d.required) problems.push({ name: d.name, message: `${d.label || d.name} is required` })
    values[d.name] = v
  }
  return { values, problems }
}

/** Initial variable values from their defaults (templates resolved against `scope`). */
export function initialVariables(decls: readonly VariableDecl[], scope?: AppScope): Record<string, TypedValue> {
  const out: Record<string, TypedValue> = {}
  for (const d of decls) {
    const def = typeof d.default === 'string' && scope ? resolveTemplate(d.default, scope) : d.default
    const v = coerceValue(d.type, def)
    out[d.name] = v === undefined ? null : v
  }
  return out
}

/* ── URL ─────────────────────────────────────────────────────────────── */

export const paramKey = (n: string) => `p.${n}`
export const varKey = (n: string) => `v.${n}`

/** Parameter values given in a query (?p.<name>=…), only declared names. */
export function paramsFromQuery(decls: readonly ParamDecl[], get: (k: string) => string | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of decls) { const v = get(paramKey(d.name)); if (v !== null) out[d.name] = v.slice(0, 2000) }
  return out
}

/** URL-persisted page variables from a query (?v.<name>=…), typed. */
export function urlVariablesFromQuery(decls: readonly VariableDecl[], get: (k: string) => string | null): Record<string, TypedValue> {
  const out: Record<string, TypedValue> = {}
  for (const d of decls) {
    if (!d.url) continue
    const raw = get(varKey(d.name))
    if (raw === null) continue
    const v = coerceValue(d.type, raw)
    if (v !== undefined) out[d.name] = v
  }
  return out
}

/* ── System variables ────────────────────────────────────────────────── */

export interface Viewer {
  id?: string | null
  name?: string | null
  email?: string | null
  avatar?: string | null
  teams?: Array<{ id: string; name: string }>
  roles?: Array<{ id: string; name: string }>
  manager?: { id: string; name: string | null; email: string | null } | null
  timezone?: string | null
}

export interface SystemInput {
  user?: Viewer | null
  workspace?: { id?: string | null; name?: string | null } | null
  app?: { id?: string | null; slug?: string | null; name?: string | null } | null
  page?: { id?: string | null; slug?: string | null; name?: string | null } | null
  query?: Record<string, string>
  mobile?: boolean
  app_role?: 'viewer' | 'contributor' | 'editor' | null
  now?: Date
  /** First day of the week: 1 Monday (default), 0 Sunday. */
  week_start?: 0 | 1
}

/** The calendar date (YYYY-MM-DD) of an instant in a timezone (invalid / missing timezone: UTC). */
export function dateInZone(now: Date, timezone?: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

const addDays = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }

/** today / start of week / start and end of month, as dates in the viewer's timezone. */
export function zonedDates(now: Date, timezone?: string | null, weekStart: 0 | 1 = 1): { today: string; start_of_week: string; start_of_month: string; end_of_month: string } {
  const today = dateInZone(now, timezone)
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
  const back = (dow - weekStart + 7) % 7
  const [y, m] = today.split('-').map(Number)
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { today, start_of_week: addDays(today, -back), start_of_month: `${today.slice(0, 7)}-01`, end_of_month: end }
}

export interface SystemVariables {
  user: { id: string | null; name: string | null; email: string | null; avatar: string | null; teams: string[]; team_ids: string[]; roles: string[]; role_ids: string[]; manager: { id: string; name: string | null; email: string | null } | null; timezone: string }
  today: string
  now: string
  start_of_week: string
  start_of_month: string
  end_of_month: string
  workspace: { id: string | null; name: string | null }
  app: { id: string | null; slug: string | null; name: string | null }
  page: { id: string | null; slug: string | null; name: string | null }
  url: Record<string, string>
  device: { mobile: boolean }
  app_role: 'viewer' | 'contributor' | 'editor'
}

/** Every system variable (read-only). */
export function systemVariables(input: SystemInput): SystemVariables {
  const now = input.now ?? new Date()
  const u = input.user ?? {}
  const timezone = u.timezone || 'UTC'
  return {
    user: {
      id: u.id ?? null, name: u.name ?? null, email: u.email ?? null, avatar: u.avatar ?? null,
      teams: (u.teams ?? []).map((t) => t.name), team_ids: (u.teams ?? []).map((t) => t.id),
      roles: (u.roles ?? []).map((r) => r.name), role_ids: (u.roles ?? []).map((r) => r.id),
      manager: u.manager ?? null, timezone,
    },
    ...zonedDates(now, timezone, input.week_start ?? 1),
    now: now.toISOString(),
    workspace: { id: input.workspace?.id ?? null, name: input.workspace?.name ?? null },
    app: { id: input.app?.id ?? null, slug: input.app?.slug ?? null, name: input.app?.name ?? null },
    page: { id: input.page?.id ?? null, slug: input.page?.slug ?? null, name: input.page?.name ?? null },
    url: { ...(input.query ?? {}) },
    device: { mobile: !!input.mobile },
    app_role: input.app_role ?? 'viewer',
  }
}

/** The system variable paths, for pickers and docs. */
export const SYSTEM_PATHS: ReadonlyArray<{ path: string; label: string; type: VarType }> = [
  { path: 'sys.user.id', label: 'Current user › ID', type: 'text' },
  { path: 'sys.user.name', label: 'Current user › Name', type: 'text' },
  { path: 'sys.user.email', label: 'Current user › Email', type: 'text' },
  { path: 'sys.user.avatar', label: 'Current user › Avatar', type: 'text' },
  { path: 'sys.user.teams', label: 'Current user › Teams (names)', type: 'list' },
  { path: 'sys.user.team_ids', label: 'Current user › Team IDs', type: 'list' },
  { path: 'sys.user.roles', label: 'Current user › Roles (names)', type: 'list' },
  { path: 'sys.user.role_ids', label: 'Current user › Role IDs', type: 'list' },
  { path: 'sys.user.manager.id', label: 'Current user › Manager ID', type: 'text' },
  { path: 'sys.user.manager.name', label: 'Current user › Manager name', type: 'text' },
  { path: 'sys.user.manager.email', label: 'Current user › Manager email', type: 'text' },
  { path: 'sys.user.timezone', label: 'Current user › Timezone', type: 'text' },
  { path: 'sys.today', label: 'Today', type: 'date' },
  { path: 'sys.now', label: 'Now', type: 'date' },
  { path: 'sys.start_of_week', label: 'Start of this week', type: 'date' },
  { path: 'sys.start_of_month', label: 'Start of this month', type: 'date' },
  { path: 'sys.end_of_month', label: 'End of this month', type: 'date' },
  { path: 'sys.workspace.id', label: 'Workspace › ID', type: 'text' },
  { path: 'sys.workspace.name', label: 'Workspace › Name', type: 'text' },
  { path: 'sys.app.id', label: 'App › ID', type: 'text' },
  { path: 'sys.app.slug', label: 'App › Slug', type: 'text' },
  { path: 'sys.app.name', label: 'App › Name', type: 'text' },
  { path: 'sys.page.id', label: 'Page › ID', type: 'text' },
  { path: 'sys.page.slug', label: 'Page › Slug', type: 'text' },
  { path: 'sys.page.name', label: 'Page › Name', type: 'text' },
  { path: 'sys.url.<name>', label: 'URL parameter', type: 'text' },
  { path: 'sys.device.mobile', label: 'Device › Is mobile', type: 'boolean' },
  { path: 'sys.app_role', label: 'Viewer’s app role (viewer / contributor / editor)', type: 'text' },
]

/* ── The scope ───────────────────────────────────────────────────────── */

export interface AppScope {
  param: Record<string, unknown>
  var: Record<string, unknown>
  sys: SystemVariables
  filter: Record<string, unknown>
  /** Rules: the event's payload. */
  event?: Record<string, unknown> | null
  /** Rules: the previous action's result (and results by action index). */
  result?: unknown
  results?: unknown[]
  /** Widget state: { <widget id>: { tab, selected, hidden, … } }. */
  widget?: Record<string, Record<string, unknown>>
}

/** The form-rules scope over an app scope (so ruleConditionsMet / resolveRuleTemplate read app paths). */
export function ruleScopeOf(scope: AppScope): RuleScope {
  const values: Record<string, unknown> = {
    [FORM_PARAMS_KEY]: scope.param, [FORM_VARS_KEY]: scope.var, sys: scope.sys, filter: scope.filter, widget: scope.widget ?? {},
    ...(scope.results ? { results: scope.results } : {}),
  }
  const event: Record<string, unknown> = { ...(scope.event ?? {}) }
  // {{result.*}} reads the previous action's result (form rules read it from the event).
  if (scope.result !== undefined) event.result = scope.result
  return { values, event, user: scope.sys.user as unknown as Record<string, unknown>, now: new Date(scope.sys.now) }
}

/** The plain object an expression reads (param.x, var.x, sys.user.name, filter.x, event.x, result.x, widget.x.y, user.x). */
export function expressionScope(scope: AppScope): Record<string, unknown> {
  return { param: scope.param, var: scope.var, sys: scope.sys, filter: scope.filter, event: scope.event ?? {}, result: scope.result ?? null, results: scope.results ?? [], widget: scope.widget ?? {}, user: scope.sys.user }
}

/** A path's value in the scope (param.x, var.x, sys.today, filter.x, event.row.id, result.x, widget.<id>.tab). */
export function scopeValue(path: string, scope: AppScope): unknown {
  const p = path.trim()
  if (p === 'result' || p.startsWith('result.')) return p === 'result' ? scope.result : pathValue(scope.result, p.slice(7))
  return pathValue(expressionScope(scope), p)
}

const EXPR_RE = /^\s*\{\{=([\s\S]*)\}\}\s*$/
const PLACEHOLDER_RE = /\{\{\s*([\w.\-[\]]+)\s*\}\}/g

/**
 * Functions an app expression may use although a form label may not: an app
 * page works its expressions out again on every read, so NOW() is the
 * current time (sys.now is the same instant as text).
 */
const APP_VOLATILE_ALLOWED: ReadonlySet<string> = new Set(['NOW'])

/** The `{{= … }}` expressions in a text (balanced braces, quotes respected). */
function expressionSegments(text: string): Array<{ start: number; end: number; expr: string }> {
  return text.includes('{{=') ? extractFunctionExpressions(text) : []
}

/** The text is exactly one `{{= … }}` (surrounding whitespace allowed): its body, else null. */
function wholeExpression(text: string): string | null {
  const segs = expressionSegments(text)
  if (segs.length !== 1) return null
  const [seg] = segs
  return text.slice(0, seg.start).trim() === '' && text.slice(seg.end).trim() === '' ? seg.expr : null
}

/** Evaluate an expression (label expression language; without or with {{= }}). Never throws. */
export function evaluateExpression(body: string, scope: AppScope): { value: unknown; error?: string } {
  const whole = wholeExpression(body)
  const m = whole === null ? EXPR_RE.exec(body) : null
  const r = evaluateLabelExpression(whole ?? (m ? m[1] : body), expressionScope(scope), { allow: APP_VOLATILE_ALLOWED })
  return r.error ? { value: null, error: r.error } : { value: r.value }
}

const asText = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** Fill the `{{path}}` placeholders of a plain stretch of text. */
function fillPlaceholders(text: string, scope: AppScope): string {
  return text.replace(PLACEHOLDER_RE, (_m, path: string) => {
    const v = scopeValue(path, scope)
    return asText(v === undefined ? resolveRuleTemplate(`{{${path}}}`, ruleScopeOf(scope)) : v)
  })
}

/**
 * A template → its value: `{{= expr}}` (the whole text) is an expression;
 * a single `{{path}}` gives the raw value (a number stays a number, a list a
 * list); mixed text fills each placeholder and each `{{= expr}}` as text.
 */
export function resolveTemplate(text: string, scope: AppScope): unknown {
  if (typeof text !== 'string') return text
  if (!text.includes('{{')) return text
  const whole = wholeExpression(text)
  if (whole !== null) return evaluateExpression(whole, scope).value
  const segs = expressionSegments(text)
  if (segs.length) {
    let out = ''
    let at = 0
    for (const seg of segs) {
      out += fillPlaceholders(text.slice(at, seg.start), scope)
      const v = evaluateExpression(seg.expr, scope).value
      out += Array.isArray(v) ? v.map(asText).join(', ') : asText(v)
      at = seg.end
    }
    return out + fillPlaceholders(text.slice(at), scope)
  }
  const single = /^\{\{\s*([\w.\-[\]]+)\s*\}\}$/.exec(text.trim())
  if (single) {
    const v = scopeValue(single[1], scope)
    return v === undefined ? resolveRuleTemplate(text, ruleScopeOf(scope)) : v
  }
  return fillPlaceholders(text, scope)
}

/** A template as display text. */
export function templateText(text: string, scope: AppScope): string {
  const v = resolveTemplate(text, scope)
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => (x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

/**
 * A rich-text (HTML) template: each `{{= expr}}` and `{{path}}` filled as
 * text passed through `escape`; the HTML around them is left as written.
 */
export function templateHtml(text: string, scope: AppScope, escape: (t: string) => string): string {
  if (!text.includes('{{')) return text
  const one = (t: string) => t.replace(PLACEHOLDER_RE, (m) => escape(templateText(m, scope)))
  let out = ''
  let at = 0
  for (const seg of expressionSegments(text)) {
    out += one(text.slice(at, seg.start)) + escape(templateText(text.slice(seg.start, seg.end), scope))
    at = seg.end
  }
  return out + one(text.slice(at))
}

/** Does a text use the scope (placeholders or an expression)? */
export const isTemplate = (text: unknown): text is string => typeof text === 'string' && text.includes('{{')

/** The param / var names a template or expression reads (for validation and "unknown variable" warnings). */
export function templateRefs(text: string): { params: string[]; vars: string[]; paths: string[] } {
  const paths = new Set<string>()
  const segs = expressionSegments(text)
  const exprs = segs.length ? segs.map((s) => s.expr) : EXPR_RE.test(text) ? [text] : []
  for (const e of exprs) for (const m of e.matchAll(/(?<![\w.])((?:param|var|sys|filter|event|result|widget)(?:\.[A-Za-z0-9_]+)+)/g)) paths.add(m[1])
  // Placeholders outside the expressions.
  let rest = text
  for (const s of [...segs].reverse()) rest = rest.slice(0, s.start) + ' ' + rest.slice(s.end)
  if (!segs.length && exprs.length) rest = ''
  for (const m of rest.matchAll(PLACEHOLDER_RE)) paths.add(m[1])
  const list = [...paths]
  const names = (prefix: string) => [...new Set(list.filter((p) => p.startsWith(`${prefix}.`)).map((p) => p.slice(prefix.length + 1).split(/[.[]/)[0]))]
  return { params: names('param'), vars: names('var'), paths: list }
}

/* ── Widget bindings ─────────────────────────────────────────────────── */

/**
 * Widget inputs bind to a page filter with { filter: '<id>' }. The same slot
 * binds to a parameter, a variable or a system variable with a scoped key:
 * { filter: 'param.customer' }, { filter: 'var.rowId' },
 * { filter: 'sys.user.id' }. The page runtime adds those keys' current
 * values to the filter values it sends for that widget (`bindingValues`),
 * so the widget data service resolves them like any filter — and the widget
 * reads again when a bound value changes.
 */
export const BINDING_RE = /^(param|var|sys)\.[A-Za-z0-9_.]{1,36}$/
export const isBindingKey = (key: string) => BINDING_RE.test(key)

/** Binding keys a widget config uses ({ filter: 'var.x' } anywhere, and {{filter:var.x}} in reference inputs). */
export function bindingKeys(config: unknown): string[] {
  const out = new Set<string>()
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node === 'string') { for (const m of node.matchAll(/\{\{\s*filter:((?:param|var|sys)\.[A-Za-z0-9_.]{1,36})\s*\}\}/g)) out.add(m[1]); return }
    if (!node || typeof node !== 'object') return
    const o = node as Record<string, unknown>
    if (Object.keys(o).length === 1 && typeof o.filter === 'string' && isBindingKey(o.filter)) { out.add(o.filter); return }
    Object.values(o).forEach(walk)
  }
  walk(config)
  return [...out]
}

/** Values for a widget's binding keys, as filter values (text, ≤200 chars; lists comma-joined; empty → null). */
export function bindingValues(keys: readonly string[], scope: AppScope): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const k of keys) {
    const v = scopeValue(k, scope)
    const text = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(',') : typeof v === 'object' ? JSON.stringify(v) : String(v)
    out[k] = text ? text.slice(0, 200) : null
  }
  return out
}
