/* eslint-disable @typescript-eslint/no-explicit-any -- specs are free-form JSON until validated */
import { z } from 'zod'
import {
  APP_ROLES, BUTTON_ACTION_KINDS, MAX_CHILDREN_PER_CONTAINER, MAX_FILTERS, MAX_LAYOUT_BYTES, MAX_PAGES, MAX_WIDGETS, PRINCIPAL_TYPES,
  appCreateSchema, appUpdateSchema, isWidgetType, nonDefaultOptions, WIDGET_CONFIG_SCHEMAS, normaliseMenu, pageFilterSchema, pageLayoutSchema, slugFrom, slugSchema, uniqueSlug, widgetIdSchema, widgetSchema,
  WIDGET_TYPES, type AppMenuItem, type AppNav, type AppPage, type AppWidget, type AudienceEntry, type PageFilter, type PageLayout, type WidgetType,
} from './schema'
import { ACTION_TYPES, RULE_TRIGGERS } from './rules'
import { catalogEntry, fitsContent, WIDGET_CATALOG } from './widgets'
import { PAGE_TEMPLATES, cloneWidgets, templateById } from './templates'
import { brokenPageLinks, type AppDocument } from './references'
import { pageChecks } from './lint'
import { BUILTIN_ICON_NAMES, canonicalIcon, isKnownIcon, similarIcons } from './icon-names'
export { BUILTIN_ICON_NAMES }
import { isBindingKey, type ParamDecl, type VariableDecl } from './variables'
import type { AppRule } from './rules'
import type { AppStyle } from './style'

/**
 * App specs (pure, client-safe; __tests__/app-spec.test.ts): ONE structured
 * proposal for a whole app — or for a change to an existing one — that the
 * AI Agent (lib/assistants), MCP clients (apps_plan / apps_apply_spec) and
 * REST callers (POST /apps/plan, /apps/apply) build and apply in one step.
 *
 *  - A spec names the app (new: `app.name`; existing: `app_id`), its pages
 *    (new pages, or `page` = an existing page's slug / id to change), each
 *    page's widgets (the whole list, or add / update / move / resize /
 *    remove), page filters, parameters, variables and rules, the app's
 *    menu, navigation, style, rules, audience and editors.
 *  - Widgets are written short: `{ type, title?, w?, h?, config? }` — the id
 *    and the default size come from the widget catalogue; every config is
 *    checked against that widget type's zod schema (never free-form).
 *  - `compileAppSpec` turns a spec (plus the existing app, when editing)
 *    into the exact service inputs (lib/services/apps.ts createApp /
 *    updateApp / createPage / updatePage / deletePage) and the app's final
 *    shape, or returns every problem as a plain-language line ("Page
 *    “Approvals” › widget 2 (chart) › group_by: use one of time, status,
 *    …") so a model can fix its spec and try again.
 *
 * Governance (who may bind what), names for the summary and applying the
 * result are server-side: lib/services/app-spec.ts.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = z.string().regex(UUID_RE, 'Must be a UUID')
const keyRef = z.string().trim().min(1).max(80)

/* ── The spec ────────────────────────────────────────────────────────── */

const widgetBaseSpec = {
  id: widgetIdSchema.optional(),
  type: z.string().min(1).max(40),
  title: z.string().trim().max(120).nullable().optional(),
  w: z.number().int().optional(),
  h: z.number().int().optional(),
  bleed: z.boolean().optional(),
  /** auto (lists, cards, people: grow / shrink to the content up to max_h rows) or fixed (exactly h). Lists default to auto. */
  height: z.enum(['auto', 'fixed']).optional(),
  max_h: z.number().int().optional(),
  style: z.unknown().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
}
export const widgetSpecSchema = z.object(widgetBaseSpec).strict()
export type WidgetSpec = z.infer<typeof widgetSpecSchema>

/** Where an added or moved widget goes: after / before another widget, or first / last. */
const placeSchema = { after: widgetIdSchema.optional(), before: widgetIdSchema.optional(), at: z.enum(['start', 'end']).optional() }

export const widgetAddSchema = z.object({ ...widgetBaseSpec, ...placeSchema }).strict()
export const widgetPatchSchema = z.object({
  id: widgetIdSchema,
  title: z.string().trim().max(120).nullable().optional(),
  w: z.number().int().optional(),
  h: z.number().int().optional(),
  bleed: z.boolean().optional(),
  height: z.enum(['auto', 'fixed']).optional(),
  max_h: z.number().int().optional(),
  style: z.unknown().optional(),
  /** Merged into the widget's config (a key set to null is removed); replace_config: true replaces it. */
  config: z.record(z.string(), z.unknown()).optional(),
  replace_config: z.boolean().optional(),
  move: z.object(placeSchema).strict().optional(),
}).strict()

export const pageSpecSchema = z.object({
  /** An existing page (slug or id) to change; omitted: a new page. */
  page: keyRef.optional(),
  title: z.string().trim().min(1).max(120).optional(),
  slug: slugSchema.optional(),
  icon: z.string().trim().max(60).nullable().optional(),
  /** Not in the menu (opened from buttons / panels only). */
  hidden: z.boolean().optional(),
  /** The lowest app role that may open the page. */
  min_role: z.enum(['viewer', 'contributor', 'editor']).optional(),
  /** Cards in a row line up (default true). */
  equal_rows: z.boolean().optional(),
  /** Start a NEW page from a starter template (its widgets and filters); widgets / add_widgets come after. */
  template: z.string().max(40).optional(),
  /** Page filters (replaced). */
  filters: z.array(z.unknown()).max(MAX_FILTERS).optional(),
  /** Every widget of the page in reading order (replaces the page's widgets). */
  widgets: z.array(z.unknown()).max(MAX_WIDGETS).optional(),
  add_widgets: z.array(z.unknown()).max(MAX_WIDGETS).optional(),
  update_widgets: z.array(z.unknown()).max(MAX_WIDGETS).optional(),
  remove_widgets: z.array(z.string().max(40)).max(MAX_WIDGETS).optional(),
  params: z.array(z.unknown()).optional(),
  variables: z.array(z.unknown()).optional(),
  rules: z.array(z.unknown()).optional(),
}).strict()
export type PageSpec = z.infer<typeof pageSpecSchema>

const APP_SETTING_KEYS = ['name', 'slug', 'subtitle', 'description', 'icon', 'color', 'nav', 'menu', 'params', 'variables', 'rules', 'style'] as const

export const appSpecSchema = z.object({
  /** An existing app (id or slug) to change; omitted: a new app (app.name required). */
  app_id: keyRef.optional(),
  /** App settings: name, slug, subtitle, description, icon, color, nav, menu, params, variables, rules, style. */
  app: z.record(z.string(), z.unknown()).optional(),
  pages: z.array(pageSpecSchema).max(MAX_PAGES).optional(),
  /** Existing pages (slugs or ids) to delete. */
  delete_pages: z.array(keyRef).max(MAX_PAGES).optional(),
  /** Pages (slugs) in menu order, first to last; pages not listed keep their order after them. */
  page_order: z.array(keyRef).max(MAX_PAGES).optional(),
  /** Who may open the app (replaced): users, teams and roles with viewer / contributor. */
  audience: z.array(z.object({ type: z.enum(PRINCIPAL_TYPES), id: uuid, role: z.enum(APP_ROLES).default('viewer') }).strict()).max(500).optional(),
  /** User ids who may edit the app (replaced; you stay an editor). */
  editors: z.array(uuid).max(50).optional(),
}).strict()
export type AppSpec = z.input<typeof appSpecSchema>

/** The JSON schema of a spec (for MCP / REST / the Agent's reference). */
export function appSpecJsonSchema(): unknown {
  try { return z.toJSONSchema(appSpecSchema, { io: 'input', unrepresentable: 'any' }) } catch { return null }
}

/* ── Plain-language errors ───────────────────────────────────────────── */

const KIND_OPTIONS: Array<[RegExp, readonly string[]]> = [
  [/(^|\.)(action)$/, BUTTON_ACTION_KINDS],
  [/(^|\.)actions\.\d+$/, ['detail', 'open_page', 'open_url', 'start_workflow', 'open_form']],
  [/(^|\.)target$/, ['form', 'page', 'report', 'table', 'url']],
  [/(^|\.)(menu|items)\.\d+$/, ['url', 'form', 'page', 'report', 'record', 'workflow', 'tasks', 'divider', 'heading', 'group']],
  [/(^|\.)then\.\d+$|(^|\.)else\.\d+$|on_error\.\d+$/, ACTION_TYPES],
  [/(^|\.)when$/, RULE_TRIGGERS],
]

const INPUT_HINTS: Record<string, string> = {
  assignee: '"me", a user id from apps_search, or { "filter": "<page filter id>" }',
  person: '"me", a user id from apps_search, or { "filter": "<page filter id>" }',
  team: '"my_teams", a team id from apps_search, or { "filter": "<page filter id>" }',
  form_id: 'a form id from apps_search (kind form), or { "filter": "<page filter id>" }',
  workflow_id: 'a workflow id from apps_search (kind workflow), or { "filter": "<page filter id>" }',
  table_id: 'a data table id from apps_search (kind table), or { "filter": "<page filter id>" }',
  report_id: 'a report id from apps_search (kind report)',
  reference_id: 'an API reference id from apps_search (kind reference)',
  agent_id: 'an agent id from apps_search (kind agent)',
  date_range: '{ "preset": "7d" | "30d" | "90d" | "365d" | "this_month" | "this_quarter" | "last_quarter" | "this_year" | "all" }, { "from", "to" }, or { "filter": "<page filter id>" }',
  status: '"open", "completed", "all", or { "filter": "<page filter id>" }',
}

function pathText(path: ReadonlyArray<PropertyKey>): string {
  return path.map(String).join('.') || 'value'
}

/** One zod issue → one sentence (with the allowed values / the setting names when that helps). */
export function issueText(issue: any, widgetType?: string | null): string {
  const path: PropertyKey[] = Array.isArray(issue?.path) ? issue.path : []
  const at = pathText(path)
  const last = String(path[path.length - 1] ?? '')
  switch (issue?.code) {
    case 'invalid_value':
      return `${at}: use one of ${(issue.values ?? []).map((v: unknown) => JSON.stringify(v)).join(', ')}`
    case 'unrecognized_keys': {
      const keys = (issue.keys ?? []).map((k: string) => `"${k}"`).join(', ')
      if (widgetType && isWidgetType(widgetType) && (path.length === 0 || (path.length === 1 && path[0] === 'config'))) {
        const allowed = settingsOf(widgetType)
        return `${at === 'value' ? 'config' : at}: ${keys} ${issue.keys?.length === 1 ? 'is not a setting' : 'are not settings'} of a ${widgetType} widget — its settings are ${allowed.join(', ') || '(none)'}`
      }
      return `${at}: ${keys} ${issue.keys?.length === 1 ? 'is not allowed here' : 'are not allowed here'}`
    }
    case 'invalid_union': {
      if (issue.note === 'No matching discriminator' || issue.discriminator) {
        const parent = pathText(path.slice(0, -1))
        const options = KIND_OPTIONS.find(([re]) => re.test(parent))?.[1]
        return `${at}: unknown ${issue.discriminator ?? 'kind'}${options ? ` — use one of ${options.join(', ')}` : ''}`
      }
      if (INPUT_HINTS[last]) return `${at}: use ${INPUT_HINTS[last]}`
      return `${at}: not a valid value`
    }
    case 'invalid_type':
      if (issue.input === undefined || /received undefined/.test(String(issue.message))) return `${at}: required (${issue.expected})`
      return `${at}: expected ${issue.expected}`
    case 'invalid_format':
      if (INPUT_HINTS[last]) return `${at}: use ${INPUT_HINTS[last]}`
      return `${at}: ${issue.message}`
    case 'too_big':
      return `${at}: at most ${issue.maximum}${issue.origin === 'string' ? ' characters' : issue.origin === 'array' ? ' items' : ''}`
    case 'too_small':
      return `${at}: at least ${issue.minimum}${issue.origin === 'string' ? ' characters' : issue.origin === 'array' ? ' items' : ''}`
    default:
      return `${at}: ${issue?.message ?? 'invalid'}`
  }
}

/** The config keys of a widget type (for "its settings are …"). */
function settingsOf(type: WidgetType): string[] {
  return Object.keys((WIDGET_CONFIG_SCHEMAS[type] as unknown as { shape?: Record<string, unknown> }).shape ?? {})
}

/* ── Compiling ───────────────────────────────────────────────────────── */

export interface ExistingApp {
  id: string
  slug: string
  name: string
  menu: AppMenuItem[]
  nav?: AppNav
  params?: ParamDecl[]
  variables?: VariableDecl[]
  rules?: AppRule[]
  style?: AppStyle
  audience: AudienceEntry[] | null
  editors: string[] | null
  pages: AppPage[]
}

export type PageOp =
  | { op: 'create'; slug: string; title: string; input: Record<string, any> }
  | { op: 'update'; page_id: string; slug: string; title: string; input: Record<string, any>; before: AppPage; changed: string[] }

export interface CompiledSpec {
  mode: 'create' | 'edit'
  /** createApp input (create) or updateApp patch (edit; null: no app setting changes). */
  app: Record<string, any> | null
  pages: PageOp[]
  /** Existing pages to delete (ids). */
  deletes: Array<{ id: string; slug: string; title: string }>
  /** Final menu order (slugs), when the spec sets one. */
  order: string[] | null
  /** The app as it will be (for governance, names and the summary). */
  doc: Omit<AppDocument, 'pages'> & { pages: Array<{ slug: string; title: string; icon?: string | null; layout: PageLayout; filters: PageFilter[] }> }
  /** Per page: widgets added / changed / removed (for the summary). */
  changes: Array<{ slug: string; title: string; created: boolean; added: AppWidget[]; updated: string[]; removed: string[]; resized: string[]; moved: string[] }>
  warnings: string[]
}

export type CompileResult = { ok: true; compiled: CompiledSpec } | { ok: false; errors: string[] }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function freshWidgetId(type: string, taken: Set<string>): string {
  const base = type.replace(/_/g, '-')
  let n = 1
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

function placeAt(list: AppWidget[], widget: AppWidget, place: { after?: string; before?: string; at?: 'start' | 'end' }, errors: string[], where: string): void {
  const idx = (id: string) => list.findIndex((w) => w.id === id)
  if (place.after) {
    const i = idx(place.after)
    if (i < 0) { errors.push(`${where}: after "${place.after}" — no widget with that id on the page`); list.push(widget); return }
    list.splice(i + 1, 0, widget)
  } else if (place.before) {
    const i = idx(place.before)
    if (i < 0) { errors.push(`${where}: before "${place.before}" — no widget with that id on the page`); list.push(widget); return }
    list.splice(i, 0, widget)
  } else if (place.at === 'start') list.unshift(widget)
  else list.push(widget)
}

/** A short widget spec → a full widget (defaults from the catalogue), or problems. */
function buildWidget(raw: unknown, taken: Set<string>, where: string, errors: string[], warnings: string[]): AppWidget | null {
  const shape = widgetAddSchema.safeParse(raw)
  if (!shape.success) {
    for (const issue of shape.error.issues) errors.push(`${where}: ${issueText(issue)}`)
    return null
  }
  const s = shape.data
  if (!isWidgetType(s.type)) {
    errors.push(`${where}: unknown widget type "${s.type}" — use one of ${WIDGET_TYPES.join(', ')} (apps_spec_reference lists them; its widget_types option gives their settings)`)
    return null
  }
  const e = catalogEntry(s.type)
  const label = `${where} (${s.type})`
  const id = s.id ?? freshWidgetId(s.type, taken)
  if (taken.has(id)) { errors.push(`${label}: the id "${id}" is already used on this page`); return null }
  const w = s.w ?? e.w
  const h = s.h ?? e.h
  const cw = clamp(w, e.minW, e.maxW)
  const ch = clamp(h, e.minH, e.maxH)
  if (cw !== w || ch !== h) warnings.push(`${label}: size ${w}×${h} adjusted to ${cw}×${ch} (a ${e.title} is ${e.minW}–${e.maxW} wide, ${e.minH}–${e.maxH} high)`)
  const candidate: Record<string, unknown> = { id, type: s.type, w: cw, h: ch, config: s.config ?? {} }
  if (s.title !== undefined) candidate.title = s.title
  if (s.bleed ?? e.bleed) candidate.bleed = true
  const height = s.height ?? (fitsContent(s.type) ? 'auto' : undefined)
  if (height) candidate.height = height
  if (s.max_h !== undefined) candidate.max_h = clamp(s.max_h, Math.max(2, e.minH), 30)
  if (s.style !== undefined && s.style !== null) candidate.style = s.style
  const parsed = widgetSchema.safeParse(candidate)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const p = issue.path[0] === 'config' ? issue.path.slice(1) : issue.path
      errors.push(`${label} › ${issueText({ ...issue, path: p }, s.type)}`)
    }
    return null
  }
  taken.add(id)
  return parsed.data as unknown as AppWidget
}

/** Widget inputs bound to page filters ({ filter: id }), click targets and filter actions → the filter ids they name. */
function filterRefs(value: unknown, out: Set<string> = new Set(), key = ''): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => filterRefs(v, out, key))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // { filter: "param.x" | "var.x" | "sys.…" } binds a parameter / variable / system value, not a page filter.
      if (k === 'filter' && typeof v === 'string' && v) { if (!isBindingKey(v)) out.add(v) }
      // open_page `filters` names the TARGET page's filters; params map names form parameters.
      else if (k !== 'filters') filterRefs(v, out, k)
    }
  } else if (typeof value === 'string' && key !== 'html') {
    for (const m of value.matchAll(/\{\{\s*filter[:.]([a-z][a-z0-9_]{0,39})\s*\}\}/g)) out.add(m[1])
  }
  return out
}

function pageLabel(spec: PageSpec, i: number, existing?: AppPage | null): string {
  const title = spec.title ?? existing?.title
  return `Page ${i + 1}${title ? ` “${title}”` : ''}`
}

/**
 * A spec (+ the existing app when editing) → service inputs and the app's
 * final shape, or every problem in plain language. Pure.
 */
export function compileAppSpec(rawSpec: unknown, existing: ExistingApp | null): CompileResult {
  const errors: string[] = []
  const warnings: string[] = []
  const top = appSpecSchema.safeParse(rawSpec)
  if (!top.success) return { ok: false, errors: top.error.issues.slice(0, 20).map((i) => `spec › ${issueText(i)}`) }
  const spec = top.data
  const mode: 'create' | 'edit' = existing ? 'edit' : 'create'
  if (!existing && spec.app_id) return { ok: false, errors: [`App “${spec.app_id}” not found (or you can't edit it)`] }

  // App settings.
  let app: Record<string, any> | null = null
  const settings = spec.app ?? {}
  const unknown = Object.keys(settings).filter((k) => !(APP_SETTING_KEYS as readonly string[]).includes(k))
  if (unknown.length) errors.push(`app: ${unknown.map((k) => `"${k}"`).join(', ')} ${unknown.length === 1 ? 'is not an app setting' : 'are not app settings'} — app settings are ${APP_SETTING_KEYS.join(', ')}${unknown.some((k) => k === 'audience' || k === 'editors') ? ' (audience and editors go at the top level of the spec)' : ''}`)
  const appInput = { ...Object.fromEntries(Object.entries(settings).filter(([k]) => (APP_SETTING_KEYS as readonly string[]).includes(k))), ...(spec.audience ? { audience: spec.audience } : {}), ...(spec.editors ? { editors: spec.editors } : {}) }
  if (mode === 'create') {
    if (!settings.name) errors.push('app.name: a new app needs a name (or give app_id to change an existing app)')
    const parsed = appCreateSchema.safeParse(appInput)
    if (!parsed.success) for (const issue of parsed.error.issues) errors.push(`app › ${issueText(issue)}`)
    else app = appInput
  } else if (Object.keys(appInput).length) {
    const parsed = appUpdateSchema.safeParse(appInput)
    if (!parsed.success) for (const issue of parsed.error.issues) errors.push(`app › ${issueText(issue)}`)
    else app = appInput
  }

  // Pages.
  const existingPages = existing?.pages ?? []
  const findPage = (key: string) => existingPages.find((p) => p.id === key || p.slug === key.toLowerCase())
  const deletes: CompiledSpec['deletes'] = []
  for (const key of spec.delete_pages ?? []) {
    const p = findPage(key)
    if (!p) errors.push(`delete_pages: no page “${key}” in this app`)
    else deletes.push({ id: p.id, slug: p.slug, title: p.title })
  }
  const deletedIds = new Set(deletes.map((d) => d.id))
  const takenSlugs = new Set(existingPages.filter((p) => !deletedIds.has(p.id)).map((p) => p.slug))
  const ops: PageOp[] = []
  const changes: CompiledSpec['changes'] = []
  const finalPages = new Map<string, { slug: string; title: string; icon?: string | null; layout: PageLayout; filters: PageFilter[]; position: number }>()
  existingPages.filter((p) => !deletedIds.has(p.id)).forEach((p) => finalPages.set(p.id, { slug: p.slug, title: p.title, icon: p.icon, layout: p.layout, filters: p.filters, position: p.position }))
  if (mode === 'create' && !(spec.pages ?? []).length) errors.push('pages: a new app needs at least one page (the first page is its home page)')
  const seenExisting = new Set<string>()

  ;(spec.pages ?? []).forEach((ps, i) => {
    const before = ps.page ? findPage(ps.page) ?? null : null
    const where = pageLabel(ps, i, before)
    if (ps.page && !before) { errors.push(`${where}: no page “${ps.page}” in this app${mode === 'create' ? ' (a new app has no pages yet — leave out "page")' : ''}`); return }
    if (before && deletedIds.has(before.id)) { errors.push(`${where}: it is also in delete_pages`); return }
    if (before && seenExisting.has(before.id)) { errors.push(`${where}: this page is listed twice`); return }
    if (before) seenExisting.add(before.id)
    if (!before && !ps.title) { errors.push(`${where}: a new page needs a title`); return }
    if (before && ps.template) errors.push(`${where}: a template only starts a NEW page — use widgets / add_widgets on an existing page`)
    if (ps.widgets && (ps.add_widgets || ps.update_widgets || ps.remove_widgets)) errors.push(`${where}: give either widgets (the whole list) or add_widgets / update_widgets / remove_widgets, not both`)

    const title = ps.title ?? before!.title
    // Slug: kept for an existing page unless given; new pages get one from the title.
    let slug = before?.slug ?? ''
    if (ps.slug && ps.slug !== before?.slug) {
      if (takenSlugs.has(ps.slug)) errors.push(`${where}: the slug "${ps.slug}" is already used by another page`)
      if (before) takenSlugs.delete(before.slug)
      slug = ps.slug
    } else if (!before) slug = uniqueSlug(slugFrom(title, 'page'), takenSlugs)
    takenSlugs.add(slug)

    // Filters.
    let filters: PageFilter[] = before?.filters ?? []
    const template = ps.template ? templateById(ps.template) : null
    if (ps.template && !template) errors.push(`${where}: unknown template "${ps.template}" — use one of ${PAGE_TEMPLATES.map((t) => t.id).join(', ')}`)
    if (template && !ps.filters) filters = template.filters
    if (ps.filters) {
      const list: PageFilter[] = []
      ps.filters.forEach((f, j) => {
        const parsed = pageFilterSchema.safeParse(f)
        if (!parsed.success) for (const issue of parsed.error.issues) errors.push(`${where} › filter ${j + 1} › ${issueText(issue)}`)
        else if (list.some((x) => x.id === parsed.data.id)) errors.push(`${where} › filter ${j + 1}: the id "${parsed.data.id}" is used twice`)
        else list.push(parsed.data)
      })
      filters = list
    }

    // Widgets.
    const added: AppWidget[] = []
    const updated: string[] = []
    const resized: string[] = []
    const moved: string[] = []
    let removed: string[] = []
    let widgets: AppWidget[] = before ? before.layout.widgets.map((w) => ({ ...w })) : []
    const taken = new Set<string>()
    if (template) {
      widgets = cloneWidgets(template.layout.widgets, [])
      widgets.forEach((w) => taken.add(w.id))
      added.push(...widgets)
    }
    if (ps.widgets) {
      removed = before ? before.layout.widgets.map((w) => w.id) : []
      widgets = []
      taken.clear()
      added.length = 0
      ps.widgets.forEach((raw, j) => {
        const wd = buildWidget(raw, taken, `${where} › widget ${j + 1}`, errors, warnings)
        if (wd) { widgets.push(wd); added.push(wd) }
      })
      // Same id as before: a change, not a removal.
      const kept = new Set(widgets.map((w) => w.id))
      const was = new Set(removed)
      removed = removed.filter((id) => !kept.has(id))
      for (const w of [...added]) if (was.has(w.id)) { updated.push(w.id); added.splice(added.indexOf(w), 1) }
    } else {
      widgets.forEach((w) => taken.add(w.id))
      for (const id of ps.remove_widgets ?? []) {
        if (!widgets.some((w) => w.id === id)) { errors.push(`${where} › remove_widgets: no widget "${id}" on this page`); continue }
        widgets = widgets.filter((w) => w.id !== id)
        removed.push(id)
      }
      ;(ps.update_widgets ?? []).forEach((raw, j) => {
        const label = `${where} › update_widgets ${j + 1}`
        const p = widgetPatchSchema.safeParse(raw)
        if (!p.success) { for (const issue of p.error.issues) errors.push(`${label}: ${issueText(issue)}`); return }
        const patch = p.data
        const at = widgets.findIndex((w) => w.id === patch.id)
        if (at < 0) { errors.push(`${label}: no widget "${patch.id}" on this page${before ? '' : ' (use widgets / add_widgets on a new page)'}`); return }
        const cur = widgets[at]
        const e = catalogEntry(cur.type)
        let config: Record<string, unknown> = { ...(cur.config as Record<string, unknown>) }
        if (patch.config) {
          if (patch.replace_config) config = { ...patch.config }
          else for (const [k, v] of Object.entries(patch.config)) { if (v === null) delete config[k]; else config[k] = v }
        }
        const w = patch.w ?? cur.w
        const h = patch.h ?? cur.h
        const cw = clamp(w, e.minW, e.maxW)
        const ch = clamp(h, e.minH, e.maxH)
        if (cw !== w || ch !== h) warnings.push(`${label} (${cur.type}): size ${w}×${h} adjusted to ${cw}×${ch}`)
        const candidate: Record<string, unknown> = { ...cur, w: cw, h: ch, config }
        if (patch.title !== undefined) candidate.title = patch.title
        if (patch.bleed !== undefined) candidate.bleed = patch.bleed
        if (patch.height !== undefined) candidate.height = patch.height
        if (patch.max_h !== undefined) candidate.max_h = clamp(patch.max_h, Math.max(2, e.minH), 30)
        if (patch.style !== undefined) { if (patch.style === null) delete candidate.style; else candidate.style = patch.style }
        const parsed = widgetSchema.safeParse(candidate)
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            const pp = issue.path[0] === 'config' ? issue.path.slice(1) : issue.path
            errors.push(`${label} (${cur.type} “${cur.id}”) › ${issueText({ ...issue, path: pp }, cur.type)}`)
          }
          return
        }
        const next = parsed.data as unknown as AppWidget
        if (cw !== cur.w || ch !== cur.h) resized.push(cur.id)
        if (patch.config || patch.title !== undefined || patch.style !== undefined || patch.bleed !== undefined || patch.height !== undefined || patch.max_h !== undefined) updated.push(cur.id)
        widgets[at] = next
        if (patch.move) {
          widgets.splice(at, 1)
          placeAt(widgets, next, patch.move, errors, label)
          moved.push(cur.id)
        }
      })
      ;(ps.add_widgets ?? []).forEach((raw, j) => {
        const label = `${where} › add_widgets ${j + 1}`
        const place = raw && typeof raw === 'object' ? raw as { after?: string; before?: string; at?: 'start' | 'end' } : {}
        const wd = buildWidget(raw, taken, label, errors, warnings)
        if (!wd) return
        placeAt(widgets, wd, place, errors, label)
        added.push(wd)
      })
    }
    if (widgets.length > MAX_WIDGETS) errors.push(`${where}: at most ${MAX_WIDGETS} widgets on a page (${widgets.length})`)

    // Containers name widgets of the page; inputs name filters of the page.
    const ids = new Set(widgets.map((w) => w.id))
    for (const w of widgets) {
      const children = w.type === 'tabs' ? (w.config as any).tabs.flatMap((t: any) => t.widgets ?? []) : w.type === 'section' ? (w.config as any).widgets : []
      for (const c of children) if (!ids.has(c)) errors.push(`${where} › ${w.type} “${w.id}”: it holds "${c}", which is not a widget on this page`)
      if (children.length > MAX_CHILDREN_PER_CONTAINER) errors.push(`${where} › ${w.type} “${w.id}”: at most ${MAX_CHILDREN_PER_CONTAINER} widgets`)
    }
    const filterIds = new Set(filters.map((f) => f.id))
    for (const w of widgets) {
      for (const f of filterRefs(w.config)) if (!filterIds.has(f)) errors.push(`${where} › ${w.type} “${w.id}”: it uses the page filter "${f}", which this page doesn't have — add it to the page's filters (${filterIds.size ? `it has ${[...filterIds].join(', ')}` : 'it has none'})`)
    }

    // Layout (with options, params, variables and rules).
    const options = { hidden: ps.hidden ?? before?.layout.options?.hidden ?? false, min_role: ps.min_role ?? before?.layout.options?.min_role ?? 'viewer', ...((ps.equal_rows ?? before?.layout.options?.equal_rows) === false ? { equal_rows: false } : {}) }
    const layoutRaw: Record<string, unknown> = { widgets }
    if (nonDefaultOptions(options)) layoutRaw.options = options
    const params = ps.params ?? before?.layout.params
    const variables = ps.variables ?? before?.layout.variables
    const rules = ps.rules ?? before?.layout.rules
    if (params?.length) layoutRaw.params = params
    if (variables?.length) layoutRaw.variables = variables
    if (rules?.length) layoutRaw.rules = rules
    const layoutParsed = pageLayoutSchema.safeParse(layoutRaw)
    if (!layoutParsed.success) {
      for (const issue of layoutParsed.error.issues) {
        if (issue.path[0] === 'widgets') continue // already reported per widget
        errors.push(`${where} › ${issueText(issue)}`)
      }
      return
    }
    const layout = layoutParsed.data as unknown as PageLayout
    if (JSON.stringify(layout).length > MAX_LAYOUT_BYTES) errors.push(`${where}: the page is too large (over ${MAX_LAYOUT_BYTES / 1024} KB) — split it into two pages`)

    if (before) {
      const input: Record<string, any> = {}
      const changed: string[] = []
      if (ps.title !== undefined && ps.title !== before.title) { input.title = ps.title; changed.push('title') }
      if (slug !== before.slug) { input.slug = slug; changed.push('slug') }
      if (ps.icon !== undefined && ps.icon !== before.icon) { input.icon = ps.icon; changed.push('icon') }
      if (ps.filters) { input.filters = filters; changed.push('filters') }
      const layoutChanged = JSON.stringify(layout) !== JSON.stringify(before.layout)
      if (layoutChanged) { input.layout = layout; changed.push('layout') }
      if (changed.length) ops.push({ op: 'update', page_id: before.id, slug, title, input, before, changed })
      finalPages.set(before.id, { slug, title, icon: ps.icon !== undefined ? ps.icon : before.icon, layout, filters, position: before.position })
    } else {
      const input: Record<string, any> = { title, slug, layout, filters }
      if (ps.icon !== undefined) input.icon = ps.icon
      ops.push({ op: 'create', slug, title, input })
      finalPages.set(`new:${slug}`, { slug, title, icon: ps.icon ?? null, layout, filters, position: 1000 + i })
    }
    changes.push({ slug, title, created: !before, added, updated: [...new Set(updated)], removed, resized: [...new Set(resized)], moved })
  })

  // Final order.
  let order: string[] | null = null
  const all = [...finalPages.values()].sort((a, b) => a.position - b.position)
  if (spec.page_order) {
    const slugs = new Set(all.map((p) => p.slug))
    const unknownOrder = spec.page_order.filter((s) => !slugs.has(s.toLowerCase()) && !existingPages.some((p) => p.id === s))
    if (unknownOrder.length) errors.push(`page_order: no page ${unknownOrder.map((s) => `“${s}”`).join(', ')} in the app`)
    order = spec.page_order.map((s) => existingPages.find((p) => p.id === s)?.slug ?? s.toLowerCase())
    const rank = new Map(order.map((s, i) => [s, i]))
    all.sort((a, b) => (rank.get(a.slug) ?? 1000 + a.position) - (rank.get(b.slug) ?? 1000 + b.position))
  }
  if (all.length > MAX_PAGES) errors.push(`An app can have at most ${MAX_PAGES} pages (${all.length})`)
  if (mode === 'edit' && !all.length) errors.push('delete_pages: an app needs at least one page')

  const menu = app?.menu !== undefined ? normaliseMenu(app.menu) : existing?.menu ?? []
  const doc = {
    icon: (app?.icon !== undefined ? app.icon : null) as string | null,
    menu,
    settings: {
      nav: app?.nav ?? existing?.nav,
      params: app?.params ?? existing?.params ?? [],
      variables: app?.variables ?? existing?.variables ?? [],
      rules: app?.rules ?? existing?.rules ?? [],
      style: app?.style ?? existing?.style,
    },
    pages: all.map((p) => ({ slug: p.slug, title: p.title, icon: p.icon ?? null, layout: p.layout, filters: p.filters })),
  }
  errors.push(...iconProblems(doc, new Set(ops.map((o) => o.slug)), !!app && ('icon' in app || 'menu' in app)))
  for (const ref of brokenPageLinks(doc)) errors.push(`${ref.where}: links to the page "${ref.id}", which is not in the app — use the slug of one of its pages (${doc.pages.map((p) => p.slug).join(', ')})`)
  if (!errors.length && !ops.length && !deletes.length && !app && !order) errors.push('The spec changes nothing — say what to add or change')
  if (errors.length) return { ok: false, errors: [...new Set(errors)].slice(0, 40) }
  return { ok: true, compiled: { mode, app, pages: ops, deletes, order, doc, changes, warnings: [...new Set([...warnings, ...designWarnings(doc)])] } }
}

/** Icon names the app can't draw (they would fall back to the grid icon), in plain language. */
function iconProblems(doc: CompiledSpec['doc'], pages: ReadonlySet<string>, appSettings: boolean): string[] {
  const out: string[] = []
  const check = (value: unknown, where: string) => {
    if (typeof value !== 'string' || !value.trim() || isKnownIcon(value)) return
    const exact = canonicalIcon(value)
    out.push(`${where}: "${value}" is not an icon${exact ? ` — write it as "${exact}"` : ` — use a built-in icon name such as ${similarIcons(value).join(', ')} (apps_spec_reference lists them all), or an uploaded icon (svg:<id>)`}`)
  }
  const walk = (value: unknown, where: string) => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${where}.${i}`))
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'icon') check(v, `${where}.icon`)
      else if (k !== 'html' && k !== 'style') walk(v, `${where}.${k}`)
    }
  }
  // Only what this spec writes: an existing app's untouched pages never block a change.
  if (appSettings) { check(doc.icon, 'app.icon'); walk(doc.menu, 'app.menu') }
  for (const p of doc.pages) {
    if (!pages.has(p.slug)) continue
    check(p.icon, `Page “${p.title}” › icon`)
    for (const w of p.layout.widgets) walk(w.config, `Page “${p.title}” › ${w.type} “${w.id}”`)
  }
  return out
}

/* ── Design checks (warnings, not errors) ────────────────────────────── */

const HEX = /#[0-9a-f]{6}\b/i

/** Gentle design feedback: raw colours, missing titles, crowded rows, empty pages. */
export function designWarnings(doc: CompiledSpec['doc']): string[] {
  const out: string[] = []
  for (const page of doc.pages) {
    const where = `Page “${page.title}”`
    if (!page.layout.widgets.length) out.push(`${where} has no widgets yet`)
    let row = 0
    for (const w of page.layout.widgets) {
      if (w.style && HEX.test(JSON.stringify(w.style))) out.push(`${where} › ${w.type} “${w.id}”: uses custom colours — keep the theme's colours unless the person asked for these`)
      const titled = !['heading', 'page_header', 'divider', 'spacer', 'nav_bar', 'actions', 'text', 'announcement', 'image', 'tabs', 'section'].includes(w.type)
      if (titled && !w.title) out.push(`${where} › ${w.type} “${w.id}”: add a title so people (and screen readers) know what it shows`)
      row += w.w
      if (row > 12) row = w.w
    }
    // The builder's design checks (lib/apps/lint.ts): placeholder labels, duplicate / redundant navigation, the page header's place.
    const nav = (doc.settings as { nav?: { style?: string } } | undefined)?.nav
    const checkApp = { nav: { style: (nav?.style ?? 'tabs') as AppNav['style'] }, menu: (doc.menu ?? []) as AppMenuItem[], pages: doc.pages.map((p) => ({ slug: p.slug, title: p.title, icon: p.icon ?? null, hidden: p.layout.options?.hidden })) }
    for (const c of pageChecks(checkApp, { title: page.title, widgets: page.layout.widgets })) {
      if (c.code === 'missing_title' || c.code === 'empty_page' || c.severity !== 'warning') continue
      out.push(`${where} › ${c.message}`)
    }
  }
  return [...new Set(out)].slice(0, 15)
}

/* ── Summary (the confirmation card) ─────────────────────────────────── */

export type NameLookup = (kind: string, id: string) => string | null

const WIDGET_TITLE = new Map(WIDGET_CATALOG.map((e) => [e.type, e.title]))

/** A widget in one short phrase: “Chart “Claims by status”” (with the object it shows, when known). */
export function widgetPhrase(w: AppWidget, name: NameLookup = () => null): string {
  const kind = WIDGET_TITLE.get(w.type) ?? w.type
  const c = w.config as Record<string, any>
  const obj = ['form_id', 'workflow_id', 'table_id', 'report_id', 'agent_id'].map((k) => (typeof c?.[k] === 'string' ? name(k, c[k]) : null)).find(Boolean)
  const buttons = w.type === 'actions' ? (c.buttons ?? []).map((b: any) => b.label).filter(Boolean) : []
  return `${kind}${w.title ? ` “${w.title}”` : ''}${buttons.length ? `: ${buttons.map((b: string) => `“${b}”`).join(', ')}` : ''}${obj ? ` (${obj})` : ''}`
}

export interface SpecSummary {
  title: string
  lines: string[]
  warnings: string[]
  preview: { columns: string[]; rows: string[][]; total: number; caption?: string }
}

export function summariseSpec(compiled: CompiledSpec, opts: { appName: string; name?: NameLookup; principal?: (type: string, id: string) => string | null }): SpecSummary {
  const name = opts.name ?? (() => null)
  const lines: string[] = []
  const creating = compiled.mode === 'create'
  const a = compiled.app ?? {}
  if (creating) {
    const nav = (a.nav as AppNav | undefined)?.style
    lines.push(`New app “${opts.appName}”${a.subtitle ? ` — ${a.subtitle}` : ''}${nav ? ` · ${nav} navigation` : ''}`)
  } else {
    const changed = Object.keys(a).filter((k) => k !== 'audience' && k !== 'editors')
    if (changed.length) lines.push(`App settings: ${changed.join(', ')}`)
  }
  for (const ch of compiled.changes) {
    if (ch.created) {
      lines.push(`${creating && compiled.changes[0] === ch ? 'Home page' : 'New page'} “${ch.title}” (/${ch.slug}): ${ch.added.length} widget${ch.added.length === 1 ? '' : 's'}`)
    } else {
      const parts = [
        ch.added.length ? `add ${ch.added.map((w) => widgetPhrase(w, name)).join(', ')}` : '',
        ch.updated.length ? `change ${ch.updated.map((id) => `“${id}”`).join(', ')}` : '',
        ch.resized.length ? `resize ${ch.resized.map((id) => `“${id}”`).join(', ')}` : '',
        ch.moved.length ? `move ${ch.moved.map((id) => `“${id}”`).join(', ')}` : '',
        ch.removed.length ? `remove ${ch.removed.map((id) => `“${id}”`).join(', ')}` : '',
      ].filter(Boolean)
      lines.push(`Page “${ch.title}”: ${parts.join('; ') || 'settings'}`)
    }
  }
  for (const d of compiled.deletes) lines.push(`Delete page “${d.title}” (/${d.slug})`)
  if (compiled.order) lines.push(`Menu order: ${compiled.order.join(' → ')}`)
  if (Array.isArray(a.menu)) lines.push(`Menu: ${a.menu.length} extra entr${a.menu.length === 1 ? 'y' : 'ies'}`)
  if (Array.isArray(a.rules)) lines.push(`App rules: ${a.rules.length}`)
  const pageRules = compiled.doc.pages.reduce((n, p) => n + (p.layout.rules?.length ?? 0), 0)
  if (pageRules) lines.push(`Page rules: ${pageRules}`)
  if (Array.isArray(a.audience)) {
    const who = (a.audience as AudienceEntry[]).map((e) => `${opts.principal?.(e.type, e.id) ?? e.type} (${e.role ?? 'viewer'})`)
    lines.push(who.length ? `Shared with: ${who.slice(0, 8).join(', ')}${who.length > 8 ? ` and ${who.length - 8} more` : ''}` : 'Shared with: nobody yet (only its editors and app builders see it)')
  } else if (creating) lines.push('Not shared yet: only you and app builders see it until you set the audience')
  if (Array.isArray(a.editors)) lines.push(`Editors: ${(a.editors as string[]).map((id) => opts.principal?.('user', id) ?? id).join(', ') || 'you'}`)

  const warnings = [...compiled.warnings]
  const removedCount = compiled.changes.reduce((n, c) => n + c.removed.length, 0)
  if (removedCount) warnings.unshift(`Removes ${removedCount} widget${removedCount === 1 ? '' : 's'}`)
  if (compiled.deletes.length) warnings.unshift(`Deletes ${compiled.deletes.length} page${compiled.deletes.length === 1 ? '' : 's'} with their widgets`)
  // Drafts vs live: lib/services/app-spec.ts adds the line (saved as a draft / publishes / live without drafts).

  const rows: string[][] = []
  for (const page of compiled.doc.pages) {
    const ch = compiled.changes.find((c) => c.slug === page.slug)
    const fresh = new Set(ch?.added.map((w) => w.id) ?? [])
    const changed = new Set([...(ch?.updated ?? []), ...(ch?.resized ?? []), ...(ch?.moved ?? [])])
    for (const w of page.layout.widgets) {
      if (ch && !ch.created && !fresh.has(w.id) && !changed.has(w.id)) continue
      if (!ch) continue
      rows.push([page.title, `${widgetPhrase(w, name)}${ch.created || fresh.has(w.id) ? '' : ' (changed)'}`, `${w.w}×${w.h}`])
    }
  }
  return {
    title: creating ? `Build app “${opts.appName}”` : `Update app “${opts.appName}”`,
    lines,
    warnings,
    preview: { columns: ['Page', 'Widget', 'Size'], rows: rows.slice(0, 40), total: rows.length, caption: `${creating ? 'Widgets' : 'New and changed widgets'} in reading order (size: columns of 12 × rows)` },
  }
}

/* ── Guide (for the Agent and MCP clients) ───────────────────────────── */

export const APP_DESIGN_GUIDE = [
  'Building apps: an app is pages of widgets on a 12-column grid (widgets flow left to right in reading order; w = columns 1–12, h = rows of ~40px), page filters that widget inputs bind to, a menu, an audience (viewers / contributors) and editors.',
  'Workflow: (1) discover real objects with apps_search (forms, workflows, data tables, reports, teams, people, roles, agents, API references, columns of a table) and read what you bind (forms_get for a form\'s fields and parameters, data_tables_get for columns, workflows_get for start parameters); never invent ids. If something the app needs does not exist (e.g. the claim form), build it first (build_plan / forms_create) and use its id. (2) Draft ONE complete spec and call apps_plan to check it — fix every error it lists (they say exactly what is wrong) and call again. (3) Call apps_apply_spec with the same spec: the person sees the plan and confirms; it is applied in one step (nothing is left half-built if a step fails). (4) Afterwards check apps_access_check; if people in the audience can\'t use a form or workflow the app shows, offer apps_access_grant (only grants the person may give, confirmed).',
  'Changes to an existing app: spec { app_id, pages: [{ page: "<slug>", add_widgets / update_widgets / remove_widgets }] } — add_widgets items take after / before / at to place them; update_widgets { id, config (merged), w, h, title, move }; read the page first (apps_page_get) to know the widget ids.',
  'Good defaults:',
  '- Page structure: a home page that answers "what do I need to do?" (buttons to start the main requests, the person\'s own items, their tasks), then one page per audience or job (e.g. "My claims", "Approvals" for managers with min_role contributor or hidden pages opened from buttons, "Insights" with charts). 2–5 pages; keep each page focused (4–10 widgets).',
  '- Layout: put the primary actions first (actions widget w 12 h 2, or tiles), then metrics in a row (3–4 kpi / metric widgets of w 3–4, h 3–4), then lists and charts side by side (w 6 each, h 7–10) or full width (w 12) for grids and Kanban boards. Rows add up to 12 (a short row is stretched to the edge). Use page_header or heading only as the FIRST widget, and only when the page needs an introduction — the app header already shows the app name.',
  '- One navigation: the app\'s own navigation (nav.style tabs / top / sidebar) lists the pages. Add a nav_bar widget only to replace it, and then list EVERY page in it (it hides the app tabs on that page); never show both, never list a page twice. Use nav_bar or menu entries for extra links / forms with real labels.',
  '- Labels: every menu entry, button, tile, tab and link gets a real label that says where it goes or what it does ("New claim", "Travel policy") — never "Link", "Page", "Form", "New tile" or "Tab 1".',
  '- Titles and sizes: give every data widget a short title ("My tasks", "Team queue", "Tasks by status"). Lists, cards and people widgets follow their content (height auto, the default) — omit h for them or give the most rows they may take as max_h; cards on the same row line up. Do not make a list tall for one or two rows.',
  '- Icons: give every page an icon (lucide name: House for home, ClipboardCheck for approvals, ChartColumn for insights); menu entries for pages use the page icon (omit their icon), and the app icon stays the app\'s own.',
  '- Sizes (w×h): actions 12×2 · kpi / metric 3×3 or 4×4 · chart 6×7 · sla 4×5 · task_list 6×8 · kanban 12×10 · data_grid 12×9 · my_submissions 6×6 · form_embed 7×12 · heading 12×2. Omit w / h to get the catalogue default.',
  '- Widgets for common asks: "New X" button → actions with { kind: "new_submission", form_id }; "my X" → my_submissions (form_id) or data_grid / filtered_list over the table with a filter; "approvals queue" → task_list { scope: "queue" } (or "team") with workflow_id; "SLA chart" → sla_trend / sla_breakdown / sla; counts → kpi / metric; trends → chart { group_by: "time" }; by status → chart { group_by: "status", chart: "donut" }.',
  '- Filters: add page filters (team, workflow, date_range, user, status, form, table, text) when several widgets should follow one input; bind with { "filter": "<id>" } and give a default (date_range { preset: "30d" }, team "my_teams").',
  '- Theme-aware: leave colours to the theme and app accent (app.color only if asked or to match a brand); never put raw colours in widget styles unless the person asked for specific colours. Use icons by lucide name (Receipt, ClipboardCheck, LayoutDashboard…).',
  '- Roles: audience entries are viewers (read-only: they never see submit / start / claim buttons) or contributors (may use the buttons, within their own permissions). Requesters who submit need contributor; managers who approve need contributor; leadership dashboards need viewer. Pages for one group: min_role or a button visibility { app_roles }.',
  '- Accessible: give every data widget a clear title, buttons short verb labels ("New claim"), headings in sentence case; never rely on colour alone.',
  '- Forms with parameters: pass them with params { <name>: { from: "system", key: "user_email" } | { from: "filter", filter } | { from: "static", value } | { from: "event", key } }.',
  '- Rules (apps_rule_types): only when the person asks for behaviour ("when a row is clicked open the claim in a panel"). Navigation, filters and buttons usually need no rules.',
].join('\n')

/** A worked example (ids are placeholders: look the real ones up with apps_search). */
export const APP_SPEC_EXAMPLE = {
  app: { name: 'Expense desk', subtitle: 'Claims for the finance team', icon: 'Receipt', nav: { style: 'tabs' } },
  pages: [
    {
      title: 'Home', icon: 'House',
      widgets: [
        { type: 'actions', w: 12, h: 2, config: { buttons: [{ label: 'New claim', icon: 'Plus', action: { kind: 'new_submission', form_id: '<expense claim form id>', open: 'drawer' } }, { label: 'Approvals', icon: 'ClipboardCheck', style: 'secondary', visibility: { app_roles: ['contributor', 'editor'] }, action: { kind: 'open_page', page_slug: 'approvals' } }] } },
        { type: 'kpi', title: 'Claims this month', w: 4, h: 3, config: { source: 'submissions', form_id: '<expense claim form id>', date_range: { preset: 'this_month' } } },
        { type: 'my_submissions', title: 'My claims', w: 8, max_h: 8, config: { form_id: '<expense claim form id>' } },
      ],
    },
    {
      title: 'Approvals', icon: 'ClipboardCheck', min_role: 'contributor',
      filters: [{ id: 'period', kind: 'date_range', label: 'Period', default: { preset: '30d' } }],
      widgets: [
        { type: 'task_list', title: 'Waiting for my approval', w: 7, max_h: 10, config: { scope: 'queue', workflow_id: '<expense approval workflow id>' } },
        { type: 'sla', title: 'Approval SLA', w: 5, h: 5, config: { workflow_id: '<expense approval workflow id>' } },
        { type: 'sla_trend', title: 'SLA over time', w: 12, h: 7, config: { workflow_id: '<expense approval workflow id>', date_range: { filter: 'period' } } },
      ],
    },
  ],
  audience: [{ type: 'team', id: '<finance team id>', role: 'contributor' }],
}

/** A short outline of an app and its open page (the Agent's context in the builder / on an app page). */
export function appOutline(app: { id: string; slug: string; name: string; pages: ReadonlyArray<{ slug: string; title: string; hidden?: boolean }> }, page: { slug: string; title: string; filters: ReadonlyArray<{ id: string; kind: string }>; layout: { widgets: readonly AppWidget[] } } | null, editing = false): string {
  const pages = app.pages.map((p) => `${p.title} (/${p.slug}${p.hidden ? ', hidden' : ''})`).join(', ')
  const lines = [`App “${app.name}” (app_id ${app.id}, slug ${app.slug})${editing ? ' — open in the builder' : ''}. Pages: ${pages || 'none'}.`]
  if (page) {
    lines.push(`Open page: “${page.title}” (page "${page.slug}")${page.filters.length ? `, filters: ${page.filters.map((f) => `${f.id} (${f.kind})`).join(', ')}` : ''}.`)
    lines.push(`Widgets in order: ${page.layout.widgets.slice(0, 40).map((w) => `${widgetPhrase(w)} [id ${w.id}, ${w.w}×${w.h}]`).join('; ') || 'none'}.`)
  }
  return lines.join('\n').slice(0, 3_800)
}
