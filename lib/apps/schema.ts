import { z } from 'zod'
import { INSTANCE_DATASETS, INSTANCE_FACT_DATASETS } from '@/lib/instance-admin/schema'
import { paramMapSchema } from './params'
import { normaliseRules, rulesSchema, type AppRule } from './rules'
import { appStyleSchema, buttonColorsSchema, normaliseAppStyle, widgetStyleSchema, type AppStyle, type WidgetStyle } from './style'
import { normaliseParams, normaliseVariables, paramsSchema, variablesSchema, type ParamDecl, type VariableDecl } from './variables'

/**
 * App builder model (pure, client-safe; unit-tested in __tests__/apps-schema.test.ts).
 *
 *  - An app: name, slug (its URL, /apps/<slug>), description, icon (a nav
 *    icon name), accent colour, its menu (extra links beside its pages) and
 *    an audience (users, teams, roles) plus editors.
 *  - A page: slug, title, icon, position, the widget layout (an ordered list
 *    of widgets, each { id, type, w, h, title?, config }) and page filters —
 *    page-level inputs (user, team, form, workflow, data table, date range,
 *    status) that widget inputs bind to with { filter: '<id>' }, so one input
 *    drives several widgets.
 *
 * Every widget config is a zod schema here (WIDGET_CONFIG_SCHEMAS). Stored
 * values are parsed with `normalisePageLayout` (unknown widget types and
 * invalid configs are dropped, never thrown), so a page saved by a later
 * release still opens.
 */

export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/
export const MAX_PAGES = 30
export const MAX_WIDGETS = 60
export const MAX_FILTERS = 8
export const MAX_MENU_ITEMS = 20
export const MAX_AUDIENCE = 500
export const MAX_EDITORS = 50
/** Largest stored page layout (bytes of JSON). */
export const MAX_LAYOUT_BYTES = 128 * 1024
/** Widgets one tabs / section container can hold. */
export const MAX_CHILDREN_PER_CONTAINER = 20

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Must be a UUID')
export const slugSchema = z.string().regex(SLUG_RE, 'Lowercase letters, numbers and dashes (1–64), not starting or ending with a dash')
const shortText = (max: number) => z.string().trim().max(max)

/* ── Inputs and page filters ─────────────────────────────────────────── */

/** A widget input taken from a page filter (by the filter's id). */
export const filterRefSchema = z.object({ filter: z.string().min(1).max(40) }).strict()
export type FilterRef = z.infer<typeof filterRefSchema>

export const DATE_PRESETS = ['7d', '30d', '90d', '365d', 'this_month', 'this_quarter', 'last_quarter', 'this_year', 'all'] as const
export type DatePreset = (typeof DATE_PRESETS)[number]
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'ISO date (YYYY-MM-DD)')
export const dateRangeValueSchema = z.union([
  z.object({ preset: z.enum(DATE_PRESETS) }).strict(),
  z.object({ from: isoDate.nullable().optional(), to: isoDate.nullable().optional() }).strict(),
])
export type DateRangeValue = z.infer<typeof dateRangeValueSchema>

/** A person: 'me' (the viewer), a user id, or a page filter. */
export const userInputSchema = z.union([z.literal('me'), uuid, filterRefSchema]).nullable().optional()
/** A team: 'my_teams' (every team the viewer is in), a team id, or a page filter. */
export const teamInputSchema = z.union([z.literal('my_teams'), uuid, filterRefSchema]).nullable().optional()
/** A form / workflow / data table / report: an id, or a page filter. */
export const idInputSchema = z.union([uuid, filterRefSchema]).nullable().optional()
export const dateRangeInputSchema = z.union([dateRangeValueSchema, filterRefSchema]).nullable().optional()
export const STATUS_VALUES = ['open', 'completed', 'all'] as const
export const statusInputSchema = z.union([z.enum(STATUS_VALUES), filterRefSchema]).nullable().optional()

/** A free value (a search term or a column value), or a page filter. */
export const textInputSchema = z.union([z.string().trim().max(200), filterRefSchema]).nullable().optional()

export const FILTER_KINDS = ['user', 'team', 'form', 'workflow', 'table', 'date_range', 'status', 'text'] as const
export type FilterKind = (typeof FILTER_KINDS)[number]

export const pageFilterSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Lowercase letters, numbers and _ (start with a letter)'),
  kind: z.enum(FILTER_KINDS),
  label: shortText(60).min(1),
  /** Initial value: 'me' / 'my_teams' / an id / a status / a date range. */
  default: z.union([z.string().max(64), dateRangeValueSchema]).nullable().optional(),
  /** Text filters: the values to choose from (a dropdown with Any) instead of a free text box. */
  options: z.array(shortText(80).min(1)).max(50).optional(),
}).strict()
export type PageFilter = z.infer<typeof pageFilterSchema>

/* ── Widgets ─────────────────────────────────────────────────────────── */

/** `instance`: the built-in "UserTasks instance" source (instance admins only; lib/services/instance-admin). */
export const SOURCES = ['tasks', 'runs', 'submissions', 'table_rows', 'instance'] as const
export const CHART_KINDS = ['bar', 'horizontal_bar', 'line', 'area', 'pie', 'donut', 'stacked_bar', 'combo', 'funnel', 'scatter'] as const
export const GROUP_BYS = ['time', 'status', 'workflow', 'form', 'assignee', 'field'] as const
export type DataSource = (typeof SOURCES)[number]

const scopeInputs = {
  assignee: userInputSchema,
  team: teamInputSchema,
  form_id: idInputSchema,
  workflow_id: idInputSchema,
  table_id: idInputSchema,
  status: statusInputSchema,
  date_range: dateRangeInputSchema,
}

const safeUrl = z.string().trim().max(2000).refine((u) => /^(https:\/\/|mailto:|\/(?!\/))/i.test(u), 'Use an https:// address, mailto: or a path starting with /')

const filterIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)
/** Filter values to pass when opening a page: { <filter id>: value }. A value may be a literal, 'me', or '{{filter:<id>}}' (this page's filter). */
const passFiltersSchema = z.record(filterIdSchema, z.string().max(200)).refine((r) => Object.keys(r).length <= 8, 'At most 8 filters').optional()

export const buttonActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new_submission'), form_id: uuid, open: z.enum(['modal', 'drawer', 'page', 'tab']).default('modal'), params: paramMapSchema }).strict(),
  z.object({ kind: z.literal('start_workflow'), workflow_id: uuid }).strict(),
  z.object({ kind: z.literal('open_page'), page_slug: slugSchema, filters: passFiltersSchema, /** The page's parameters → value sources (lib/apps/variables.ts). */ params: paramMapSchema }).strict(),
  z.object({ kind: z.literal('open_url'), url: safeUrl, new_tab: z.boolean().default(true) }).strict(),
  z.object({ kind: z.literal('open_report'), report_id: uuid }).strict(),
  z.object({ kind: z.literal('download_report'), report_id: uuid }).strict(),
  z.object({ kind: z.literal('open_record'), table_id: uuid, row_id: z.string().max(80).nullable().optional() }).strict(),
  z.object({ kind: z.literal('claim_next'), team: z.union([z.literal('my_teams'), uuid]).default('my_teams') }).strict(),
  z.object({ kind: z.literal('copy_link'), target: z.union([z.literal('this_page'), safeUrl]).default('this_page') }).strict(),
  z.object({ kind: z.literal('set_filter'), filter: filterIdSchema, value: z.string().max(200).nullable() }).strict(),
  /** Nothing of its own: the page's / app's rules for this button (When button clicked) do the work. */
  z.object({ kind: z.literal('run_rules') }).strict(),
])
export type ButtonAction = z.infer<typeof buttonActionSchema>
export const BUTTON_ACTION_KINDS = ['new_submission', 'start_workflow', 'open_page', 'open_url', 'open_report', 'download_report', 'open_record', 'claim_next', 'copy_link', 'set_filter', 'run_rules'] as const

/** Live counts a button or menu entry can show as a badge (read as the viewer). */
export const BADGE_SOURCES = ['my_tasks', 'queue', 'overdue', 'my_submissions', 'running_runs'] as const
export type BadgeSource = (typeof BADGE_SOURCES)[number]

/** Who sees a button / menu entry, beyond governance: app roles, and optionally only some teams / roles. Empty = everyone. */
export const visibilitySchema = z.object({
  app_roles: z.array(z.enum(['viewer', 'contributor', 'editor'])).max(3).default([]),
  teams: z.array(uuid).max(20).default([]),
  roles: z.array(uuid).max(20).default([]),
}).strict()
export type Visibility = z.output<typeof visibilitySchema>

export { normaliseAppStyle }
export { OPEN_MODES, openModeSchema, type OpenModeKind, type OpenMode } from './schema-base'
import { openModeSchema } from './schema-base'

export const BUTTON_VARIANTS = ['primary', 'secondary', 'outline', 'ghost', 'link', 'danger'] as const
export const BUTTON_COLORS = ['theme', 'app', 'success', 'warning', 'danger', 'info'] as const

export const actionButtonSchema = z.object({
  label: shortText(60).min(1),
  icon: shortText(40).nullable().optional(),
  icon_position: z.enum(['left', 'right', 'only']).default('left'),
  /** Phase 1 values: primary / secondary. */
  style: z.enum(BUTTON_VARIANTS).default('primary'),
  color: z.enum(BUTTON_COLORS).default('theme'),
  /** Custom colours for this button (lib/apps/style.ts; each optional, light / dark). */
  colors: buttonColorsSchema.nullable().optional(),
  size: z.enum(['sm', 'md', 'lg', 'xl']).default('md'),
  shape: z.enum(['rounded', 'pill', 'square']).default('rounded'),
  full_width: z.boolean().default(false),
  description: shortText(160).nullable().optional(),
  badge: z.enum(BADGE_SOURCES).nullable().optional(),
  /** Shown disabled with this reason as its tooltip. */
  disabled_reason: shortText(160).nullable().optional(),
  confirm: z.object({ title: shortText(120).min(1), message: shortText(400).default('') }).strict().nullable().optional(),
  /** A single key (with Alt / Shift) that presses it, e.g. "alt+n". */
  shortcut: z.string().regex(/^((alt|shift)\+)*[a-z0-9]$/i, 'e.g. alt+n').nullable().optional(),
  visibility: visibilitySchema.nullable().optional(),
  /** How the target opens (forms, pages, reports, records, workflow start forms). Default: the action's own (a form's `open`, a page: navigate). */
  open_mode: openModeSchema.nullable().optional(),
  action: buttonActionSchema,
}).strict()
export type ActionButton = z.infer<typeof actionButtonSchema>

/** Click-through: clicking a segment / row / group sets a page filter, or opens a page with that filter set. */
export const clickSchema = z.object({
  filter: filterIdSchema.nullable().optional(),
  page: slugSchema.nullable().optional(),
}).strict().nullable().optional()
export type ClickTarget = z.infer<typeof clickSchema>

/** A data table / report / API reference column, or a config text with {{column}} placeholders. */
const colKey = shortText(80)

/** How a card field's value shows: as written (default), a number, money, a percentage (0–100), a date, or a progress bar (value of `max`, default 100). */
export const CARD_FIELD_FORMATS = ['text', 'number', 'currency', 'percent', 'date', 'progress'] as const
export type CardFieldFormat = (typeof CARD_FIELD_FORMATS)[number]
export const cardFieldSchema = z.object({
  key: colKey.min(1),
  label: shortText(60).nullable().optional(),
  icon: shortText(40).nullable().optional(),
  format: z.enum(CARD_FIELD_FORMATS).optional(),
  /** Currency format: the ISO code (default: the column's currency, else USD). */
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  /** Number / currency / percent: decimal places. */
  decimals: z.number().int().min(0).max(6).optional(),
  /** Progress: the value that fills the bar (default 100). */
  max: z.number().positive().optional(),
}).strict()
export type CardField = z.output<typeof cardFieldSchema>
/** A data grid column / record card field format: the card field formats without key, label and icon. */
export const columnFormatSchema = cardFieldSchema.omit({ key: true, label: true, icon: true })
export type ColumnFormat = z.output<typeof columnFormatSchema>
/** Formats by column key (data grid, record card): columns not listed show as written. */
const columnFormats = z.record(colKey.min(1), columnFormatSchema).refine((r) => Object.keys(r).length <= 30, 'At most 30 column formats').nullable().optional()

/** Card template (Card view widget). */
export const cardTemplateSchema = z.object({
  title: colKey.default(''),
  subtitle: colKey.nullable().optional(),
  description: colKey.nullable().optional(),
  image: colKey.nullable().optional(),
  image_style: z.enum(['cover', 'avatar', 'none']).default('none'),
  badge: colKey.nullable().optional(),
  /** Badge colour by value: { value → tone }. */
  badge_colors: z.array(z.object({ value: shortText(80), tone: z.enum(['neutral', 'info', 'success', 'warning', 'danger', 'accent']) }).strict()).max(20).default([]),
  fields: z.array(cardFieldSchema).max(8).default([]),
  footer: colKey.nullable().optional(),
  /** How the footer value shows (as a field's format: a date, money, …); default as written. */
  footer_format: z.enum(CARD_FIELD_FORMATS).optional(),
}).strict()
export type CardTemplate = z.output<typeof cardTemplateSchema>

export const cardActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('detail'), label: shortText(40).default('Details') }).strict(),
  z.object({ kind: z.literal('open_page'), label: shortText(40).min(1), page_slug: slugSchema, filter: filterIdSchema, value_key: colKey.min(1) }).strict(),
  z.object({ kind: z.literal('open_url'), label: shortText(40).min(1), url: shortText(2000).min(1) }).strict(),
  z.object({ kind: z.literal('start_workflow'), label: shortText(40).min(1), workflow_id: uuid }).strict(),
  z.object({ kind: z.literal('open_form'), label: shortText(40).min(1), form_id: uuid, prefill: z.array(z.object({ field: shortText(80).min(1), key: colKey.min(1) }).strict()).max(20).default([]), params: paramMapSchema }).strict(),
])
export type CardAction = z.infer<typeof cardActionSchema>

/** Form embed prefill: a form field ← 'me' (the viewer's id / email / name), a page filter, or a fixed value. */
export const prefillSchema = z.object({
  field: shortText(80).min(1),
  from: z.enum(['me_id', 'me_email', 'me_name', 'filter', 'value']),
  filter: filterIdSchema.nullable().optional(),
  value: shortText(400).nullable().optional(),
}).strict()
export type Prefill = z.infer<typeof prefillSchema>

/** A tab's direct target: a form (filled edge to edge), an app page, a report, a data table (optionally a view) or an external URL (embed allow-list). */
export const tabTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('form'), form_id: uuid, hide_header: z.boolean().default(true), params: paramMapSchema }).strict(),
  z.object({ kind: z.literal('page'), page_slug: slugSchema, filters: passFiltersSchema, params: paramMapSchema }).strict(),
  z.object({ kind: z.literal('report'), report_id: uuid }).strict(),
  z.object({ kind: z.literal('table'), table_id: uuid, view_id: z.string().max(80).nullable().optional() }).strict(),
  z.object({ kind: z.literal('url'), url: z.string().trim().max(2000).refine((u) => /^https:\/\//i.test(u), 'Use an https:// address') }).strict(),
])
export type TabTarget = z.infer<typeof tabTargetSchema>

const widgetIds = z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/i)).max(MAX_CHILDREN_PER_CONTAINER)
const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'completed', 'cancelled'] as const
const taskScope = z.enum(['mine', 'team', 'all']).default('mine')
const intervalSchema = z.enum(['day', 'week', 'month']).default('week')
const numberFormat = { format: z.enum(['number', 'currency', 'percent']).default('number'), currency: z.string().regex(/^[A-Z]{3}$/).default('USD') }
/**
 * Data table rows only: conditions every row must meet (AND). A condition
 * whose value is empty — e.g. bound to a page filter nobody set — is skipped,
 * so one filter can cross-filter several widgets. Values may bind to a page
 * filter, parameter, variable or system value ({ filter: "sys.user.name" }).
 */
export const ROW_CONDITION_OPS = ['equals', 'not_equals', 'contains', 'starts_with', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'not_empty'] as const
export const rowConditionSchema = z.object({
  column: z.string().trim().min(1).max(80),
  op: z.enum(ROW_CONDITION_OPS).default('equals'),
  value: z.union([z.string().trim().max(200), z.number(), z.boolean(), filterRefSchema]).nullable().optional(),
}).strict()
export type RowCondition = z.output<typeof rowConditionSchema>
const rowWhere = { where: z.array(rowConditionSchema).max(10).nullable().optional() }
/** Data table rows: where (above) and the date column that time grouping and the date range use (default: when the row was created). */
/**
 * The built-in "UserTasks instance" source (source: 'instance'): which fact
 * dataset, optionally one workspace (an id or a page filter / param). Read
 * for instance admins only; everyone else sees an access message.
 */
const instanceFactInputs = {
  dataset: z.enum(INSTANCE_FACT_DATASETS).nullable().optional(),
  instance_workspace: idInputSchema,
}
const rowScope = { ...rowWhere, date_field: z.string().trim().max(80).nullable().optional(), ...instanceFactInputs }

/**
 * Lists from the "UserTasks instance" source (data grid / card view with
 * source 'instance'): the dataset and its parameters (literal values, or
 * {{filter:<id>}} / {{param.<name>}} page filters and params).
 */
const instanceListInputs = {
  instance_dataset: z.enum(INSTANCE_DATASETS).nullable().optional(),
  instance_params: z.partialRecord(z.enum(['q', 'workspace_id', 'user_id', 'status', 'plan', 'days']), z.union([z.string().max(200), filterRefSchema])).nullable().optional(),
}

const metricCore = {
  source: z.enum(SOURCES).default('tasks'),
  aggregate: z.enum(['count', 'sum', 'avg']).default('count'),
  field: shortText(80).nullable().optional(),
  ...scopeInputs,
  ...numberFormat,
  ...rowScope,
}

/**
 * Extra app-menu entries beside the pages: a link (URL / path), a form opened
 * from the menu, a page of the app (with filter values), a divider, or a
 * group (a labelled section / one level of nested entries). Entries may show
 * a live badge and carry visibility rules; every entry is governance-filtered.
 */
const menuCommon = {
  label: shortText(60).min(1),
  icon: shortText(40).nullable().optional(),
  badge: z.enum(BADGE_SOURCES).nullable().optional(),
  visibility: visibilitySchema.nullable().optional(),
}
const menuLeafSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), ...menuCommon, url: safeUrl, new_tab: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal('form'), ...menuCommon, form_id: uuid, open: z.enum(['modal', 'page']).default('modal'), open_mode: openModeSchema.nullable().optional(), params: paramMapSchema }).strict(),
  z.object({ kind: z.literal('page'), ...menuCommon, page_slug: slugSchema, filters: passFiltersSchema, params: paramMapSchema, open_mode: openModeSchema.nullable().optional() }).strict(),
  z.object({ kind: z.literal('report'), ...menuCommon, report_id: uuid, open_mode: openModeSchema.nullable().optional() }).strict(),
  z.object({ kind: z.literal('record'), ...menuCommon, table_id: uuid, row_id: z.string().max(80).nullable().optional(), open_mode: openModeSchema.nullable().optional() }).strict(),
  z.object({ kind: z.literal('workflow'), ...menuCommon, workflow_id: uuid, open_mode: openModeSchema.nullable().optional() }).strict(),
  /** A tasks view of the product (/tasks?view=…). */
  z.object({ kind: z.literal('tasks'), ...menuCommon, view: z.enum(['mine', 'queue', 'team', 'all']).default('mine') }).strict(),
  z.object({ kind: z.literal('divider'), label: shortText(60).default('') }).strict(),
  z.object({ kind: z.literal('heading'), label: shortText(60).min(1) }).strict(),
])
export type AppMenuLeaf = z.infer<typeof menuLeafSchema>
const menuSubgroupSchema = z.object({ kind: z.literal('group'), ...menuCommon, items: z.array(menuLeafSchema).max(MAX_MENU_ITEMS).default([]) }).strict()
export type AppMenuSubgroup = z.infer<typeof menuSubgroupSchema>
/** A group: a labelled section with entries and (one more level) sub-groups. */
export const menuGroupSchema = z.object({ kind: z.literal('group'), ...menuCommon, items: z.array(z.union([menuLeafSchema, menuSubgroupSchema])).max(MAX_MENU_ITEMS).default([]), collapsed: z.boolean().default(false) }).strict()
export type AppMenuGroup = z.infer<typeof menuGroupSchema>
export const menuItemSchema = z.union([menuLeafSchema, menuGroupSchema])
export type AppMenuItem = z.infer<typeof menuItemSchema>

export const WIDGET_CONFIG_SCHEMAS = {
  actions: z.object({
    buttons: z.array(actionButtonSchema).max(12).default([]),
    /** row, column, grid tiles, or split (first button + a menu of the rest). */
    layout: z.enum(['row', 'column', 'grid', 'split']).default('row'),
    align: z.enum(['start', 'center', 'end', 'between']).default('start'),
    gap: z.enum(['sm', 'md', 'lg']).default('md'),
    split_label: shortText(40).nullable().optional(),
  }).strict(),
  task_list: z.object({
    /** mine: assigned to me; queue: waiting for me or my teams to claim / accept; team: a team's tasks; all: any visible task. */
    scope: z.enum(['mine', 'queue', 'team', 'all']).default('mine'),
    ...scopeInputs,
    limit: z.number().int().min(1).max(50).default(10),
    show_claim: z.boolean().default(true),
    /** Open a task in the quick-view drawer (default) or its own page. */
    open_in: z.enum(['drawer', 'page']).default('drawer'),
  }).strict(),
  sla: z.object({
    source: z.enum(['tasks', 'runs']).default('tasks'),
    ...scopeInputs,
    /** Due within this many hours = at risk. */
    at_risk_hours: z.number().int().min(1).max(720).default(24),
  }).strict(),
  metric: z.object({
    source: z.enum(SOURCES).default('tasks'),
    aggregate: z.enum(['count', 'sum', 'avg']).default('count'),
    /** Data table column for sum / avg. */
    field: shortText(80).nullable().optional(),
    ...scopeInputs,
    compare_previous: z.boolean().default(false),
    /** Optional icon chip (soft tint of the accent) beside the label. */
    icon: shortText(60).nullable().optional(),
    accent: z.enum(['blue', 'violet', 'teal', 'amber', 'rose', 'green']).nullable().optional(),
    click: clickSchema,
    /** Value the click sets the filter to (e.g. a status); empty: clear it. */
    click_value: z.string().max(200).nullable().optional(),
    format: z.enum(['number', 'currency', 'percent']).default('number'),
    /** Currency code for format currency (USD by default). */
    currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
    ...rowScope,
  }).strict(),
  chart: z.object({
    source: z.enum(SOURCES).default('tasks'),
    chart: z.enum(CHART_KINDS).default('bar'),
    group_by: z.enum(GROUP_BYS).default('time'),
    /** stacked_bar / combo: the second dimension (series). */
    series_by: z.enum(['none', ...GROUP_BYS]).default('none'),
    /** scatter: the Y column (data table rows); value_field is X. */
    y_field: shortText(80).nullable().optional(),
    click: clickSchema,
    /** Data table column for group_by field. */
    field: shortText(80).nullable().optional(),
    interval: z.enum(['day', 'week', 'month']).default('day'),
    aggregate: z.enum(['count', 'sum', 'avg']).default('count'),
    value_field: shortText(80).nullable().optional(),
    ...scopeInputs,
    max_groups: z.number().int().min(2).max(24).default(8),
    /** Order of field groups: largest first (default), or the column's choices in order (stages, a funnel). */
    sort_by: z.enum(['value', 'choices']).optional(),
    ...rowScope,
    /** stacked_bar / combo with series_by field: the series column (default: `field`, so group and series need different columns). */
    series_field: shortText(80).nullable().optional(),
    /** combo with a series: this series is drawn as a line (e.g. Planned), the others as bars (no Total line). */
    line_series: shortText(80).nullable().optional(),
  }).strict(),
  table_view: z.object({
    kind: z.enum(['report', 'data_table']).default('data_table'),
    report_id: idInputSchema,
    table_id: idInputSchema,
    columns: z.array(shortText(80)).max(20).default([]),
    limit: z.number().int().min(1).max(100).default(20),
    ...rowWhere,
  }).strict(),
  recent: z.object({
    source: z.enum(['submissions', 'runs']).default('submissions'),
    form_id: idInputSchema,
    workflow_id: idInputSchema,
    /** Submitted / started by. */
    person: userInputSchema,
    date_range: dateRangeInputSchema,
    limit: z.number().int().min(1).max(50).default(10),
  }).strict(),
  text: z.object({ html: z.string().max(20_000).default('') }).strict(),
  heading: z.object({
    text: shortText(200).default(''),
    subtitle: shortText(400).nullable().optional(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  }).strict(),
  image: z.object({
    url: z.string().trim().max(2000).refine((u) => u === '' || /^(https:\/\/|\/(?!\/))/i.test(u), 'Use an https:// address or a path starting with /').default(''),
    alt: shortText(300).default(''),
    fit: z.enum(['cover', 'contain']).default('cover'),
    link: safeUrl.nullable().optional(),
  }).strict(),
  links: z.object({
    links: z.array(z.object({ label: shortText(80).min(1), url: safeUrl, description: shortText(200).nullable().optional() }).strict()).max(30).default([]),
  }).strict(),

  /* ── Phase 2: tasks ── */
  kanban: z.object({
    scope: taskScope,
    assignee: userInputSchema, team: teamInputSchema, workflow_id: idInputSchema, date_range: dateRangeInputSchema,
    columns: z.array(z.enum(TASK_STATUSES)).min(1).max(5).default(['todo', 'in_progress', 'blocked', 'completed']),
    /** Drag a card to another column to change its status (contributors with Complete tasks only; table source: Manage rows). */
    allow_drag: z.boolean().default(true),
    per_column: z.number().int().min(1).max(50).default(20),
    /** tasks (default): tasks in columns by status. table: data table rows in lanes by a column's value — dragging a card writes that column. */
    source: z.enum(['tasks', 'table']).optional(),
    table_id: idInputSchema,
    /** Table source: the column whose value puts a row in a lane (usually a choice column)… */
    lane_column: colKey.nullable().optional(),
    /** …and the lanes, in order (default: the column's choices). */
    lanes: z.array(shortText(80).min(1)).max(10).optional(),
    /** Table source: what each card shows (the Card view template). */
    template: cardTemplateSchema.nullable().optional(),
    /** Table source: a number column totalled in each lane's header (e.g. the amount). */
    sum_field: colKey.nullable().optional(),
    sum_format: z.enum(['number', 'currency']).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    sort: colKey.nullable().optional(),
    sort_dir: z.enum(['asc', 'desc']).optional(),
    ...rowWhere,
  }).strict(),
  task_calendar: z.object({
    scope: taskScope,
    assignee: userInputSchema, team: teamInputSchema, workflow_id: idInputSchema, status: statusInputSchema,
    view: z.enum(['month', 'week']).default('month'),
  }).strict(),
  my_workload: z.object({
    at_risk_hours: z.number().int().min(1).max(720).default(24),
    click: clickSchema,
  }).strict(),
  overdue_list: z.object({
    scope: z.enum(['mine', 'team', 'all']).default('all'),
    assignee: userInputSchema, team: teamInputSchema, workflow_id: idInputSchema,
    limit: z.number().int().min(1).max(50).default(10),
    open_in: z.enum(['drawer', 'page']).default('drawer'),
  }).strict(),
  team_workload: z.object({
    team: teamInputSchema,
    workflow_id: idInputSchema,
    limit: z.number().int().min(1).max(50).default(12),
    /** Clicking a person sets this (person) filter. */
    click: clickSchema,
  }).strict(),

  /* ── Phase 2: SLA & performance ── */
  sla_trend: z.object({
    source: z.enum(['tasks', 'runs']).default('tasks'),
    assignee: userInputSchema, team: teamInputSchema, workflow_id: idInputSchema, date_range: dateRangeInputSchema,
    interval: intervalSchema,
  }).strict(),
  sla_breakdown: z.object({
    source: z.enum(['tasks', 'runs']).default('tasks'),
    by: z.enum(['workflow', 'team', 'assignee', 'form']).default('workflow'),
    workflow_id: idInputSchema, team: teamInputSchema, date_range: dateRangeInputSchema,
    at_risk_hours: z.number().int().min(1).max(720).default(24),
    limit: z.number().int().min(1).max(30).default(10),
    click: clickSchema,
  }).strict(),
  cycle_time: z.object({
    source: z.enum(['tasks', 'runs']).default('tasks'),
    assignee: userInputSchema, team: teamInputSchema, workflow_id: idInputSchema, date_range: dateRangeInputSchema,
    interval: intervalSchema,
  }).strict(),
  bottleneck: z.object({
    workflow_id: idInputSchema,
    team: teamInputSchema,
    limit: z.number().int().min(1).max(20).default(8),
  }).strict(),
  throughput: z.object({
    source: z.enum(['tasks', 'runs']).default('tasks'),
    assignee: userInputSchema, team: teamInputSchema, workflow_id: idInputSchema, date_range: dateRangeInputSchema,
    interval: intervalSchema,
  }).strict(),

  /* ── Phase 2: workflows ── */
  run_status: z.object({
    workflow_id: idInputSchema, person: userInputSchema, date_range: dateRangeInputSchema,
    click: clickSchema,
  }).strict(),
  recent_failures: z.object({
    workflow_id: idInputSchema, date_range: dateRangeInputSchema,
    limit: z.number().int().min(1).max(50).default(8),
  }).strict(),
  run_timeline: z.object({
    workflow_id: idInputSchema,
    /** Started by (default: the viewer). */
    person: userInputSchema,
  }).strict(),
  start_workflow: z.object({
    workflow_id: idInputSchema,
    button_label: shortText(60).default('Start'),
    description: shortText(400).nullable().optional(),
  }).strict(),

  /* ── Phase 2: forms ── */
  submission_trend: z.object({
    form_id: idInputSchema, person: userInputSchema, date_range: dateRangeInputSchema,
    interval: intervalSchema,
  }).strict(),
  form_embed: z.object({
    form_id: idInputSchema,
    prefill: z.array(prefillSchema).max(20).default([]),
    /** The form's declared parameters → value sources (lib/apps/params.ts). */
    params: paramMapSchema,
    after_submit: z.enum(['thank_you', 'reset', 'page', 'message']).default('thank_you'),
    after_page: slugSchema.nullable().optional(),
    after_message: shortText(400).nullable().optional(),
    hide_header: z.boolean().default(false),
    /** Viewers (read-only app role) or people who can't submit: show nothing, or a short notice. */
    unavailable: z.enum(['hide', 'notice']).default('hide'),
  }).strict(),
  my_submissions: z.object({
    form_id: idInputSchema, date_range: dateRangeInputSchema,
    limit: z.number().int().min(1).max(50).default(10),
  }).strict(),
  field_analytics: z.object({
    form_id: idInputSchema,
    /** Choice field key (empty: every choice field). */
    field: shortText(80).nullable().optional(),
    date_range: dateRangeInputSchema,
  }).strict(),

  /* ── Phase 2: data ── */
  data_grid: z.object({
    /** table (default): a data table; instance: the built-in "UserTasks instance" source (read-only, instance admins only). */
    source: z.enum(['table', 'instance']).optional(),
    ...instanceListInputs,
    table_id: idInputSchema,
    view_id: shortText(80).nullable().optional(),
    columns: z.array(colKey).max(30).default([]),
    search: textInputSchema,
    /** Contributors with Manage rows can edit cells in place. */
    editable: z.boolean().default(false),
    group_by: colKey.nullable().optional(),
    page_size: z.number().int().min(5).max(100).default(25),
    /** Select rows and delete them (contributors with Manage rows; off by default). */
    allow_delete: z.boolean().optional(),
    /** Buttons for the selected rows: each runs the page's "Grid row action" rules once per selected row (event.row, event.label). */
    row_actions: z.array(z.object({ label: shortText(40).min(1) }).strict()).max(4).optional(),
    /** How column values show, by column key: number, currency, percent, date or a progress bar (editing keeps the raw value). */
    formats: columnFormats,
    /** The order rows open in (a column; default: newest first). Viewers re-sort by clicking a column header. */
    sort: colKey.nullable().optional(),
    sort_dir: z.enum(['asc', 'desc']).optional(),
    /** Viewers may save the grid's sort, search, columns and filters as their own named views (kept per person; lib/apps/grid-views.ts). */
    personal_views: z.boolean().optional(),
    ...rowWhere,
  }).strict(),
  record_card: z.object({
    table_id: idInputSchema,
    /** A row id, or a page filter (text) holding one. */
    row_id: textInputSchema,
    fields: z.array(colKey).max(30).default([]),
    /** How field values show, by column key (as data grid formats). */
    formats: columnFormats,
    /** Under the fields: the record's change history (tables that record field changes; lib/services/data-table-audit.ts). */
    show_history: z.boolean().optional(),
  }).strict(),
  filtered_list: z.object({
    table_id: idInputSchema,
    view_id: shortText(80).nullable().optional(),
    title_column: colKey.nullable().optional(),
    subtitle_column: colKey.nullable().optional(),
    search: textInputSchema,
    show_search: z.boolean().default(true),
    limit: z.number().int().min(1).max(100).default(20),
    click: clickSchema,
    click_column: colKey.nullable().optional(),
    ...rowWhere,
  }).strict(),
  pivot: z.object({
    source: z.enum(SOURCES).default('tasks'),
    table_id: idInputSchema,
    rows: z.enum(GROUP_BYS).default('status'),
    row_field: colKey.nullable().optional(),
    columns: z.enum(['none', ...GROUP_BYS]).default('none'),
    column_field: colKey.nullable().optional(),
    interval: z.enum(['day', 'week', 'month']).default('month'),
    aggregate: z.enum(['count', 'sum', 'avg']).default('count'),
    value_field: colKey.nullable().optional(),
    /** Shade each cell by its value (a heat map), lightest = lowest. */
    heat: z.boolean().optional(),
    /** Show the Total row and column (default on). */
    totals: z.boolean().optional(),
    assignee: userInputSchema, team: teamInputSchema, workflow_id: idInputSchema, form_id: idInputSchema, status: statusInputSchema, date_range: dateRangeInputSchema,
    click: clickSchema,
    /** How cell values show (currency uses `currency`). */
    format: z.enum(['number', 'currency', 'percent']).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    ...rowScope,
  }).strict(),
  card_view: z.object({
    source: z.enum(['table', 'report', 'reference', 'instance']).default('table'),
    ...instanceListInputs,
    table_id: idInputSchema,
    view_id: shortText(80).nullable().optional(),
    report_id: idInputSchema,
    reference_id: idInputSchema,
    /** Declared reference inputs only: { input name → literal, me_email, me_id or {{filter:<id>}} }. */
    reference_inputs: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/), z.string().max(400)).refine((r) => Object.keys(r).length <= 20, 'At most 20 inputs').default({}),
    /** Path to the array of records in the response (e.g. data.items). */
    results_path: z.string().regex(/^[A-Za-z0-9_.[\]-]{0,200}$/).nullable().optional(),
    /** A designer with Manage references allows app viewers (without integration access) to see this API data. */
    allow_viewers: z.boolean().default(false),
    cache_ttl_s: z.number().int().min(0).max(3600).default(60),
    template: cardTemplateSchema.default({ title: '', image_style: 'none', badge_colors: [], fields: [] }),
    actions: z.array(cardActionSchema).max(4).default([]),
    layout: z.enum(['grid', 'list', 'compact']).default('grid'),
    card_size: z.enum(['sm', 'md', 'lg']).default('md'),
    sort: colKey.nullable().optional(),
    sort_dir: z.enum(['asc', 'desc']).default('asc'),
    search: textInputSchema,
    show_search: z.boolean().default(true),
    page_size: z.number().int().min(1).max(60).default(12),
    empty_text: shortText(200).nullable().optional(),
    click: clickSchema,
    click_key: colKey.nullable().optional(),
    /** Table source only. */
    ...rowWhere,
  }).strict(),

  /* ── Phase 2: charts ── */
  kpi: z.object({ ...metricCore, interval: intervalSchema, target: z.number().nullable().optional(), icon: shortText(60).nullable().optional(), accent: z.enum(['blue', 'violet', 'teal', 'amber', 'rose', 'green']).nullable().optional(), click: clickSchema }).strict(),
  goal: z.object({ ...metricCore, target: z.number().positive().default(100), target_label: shortText(80).nullable().optional() }).strict(),
  gauge: z.object({ ...metricCore, min: z.number().default(0), max: z.number().default(100), warn_at: z.number().nullable().optional(), danger_at: z.number().nullable().optional(), higher_is_better: z.boolean().default(true) }).strict(),
  heatmap: z.object({
    source: z.enum(['tasks', 'runs', 'submissions']).default('tasks'),
    /** tasks: created or completed. */
    event: z.enum(['created', 'completed']).default('created'),
    assignee: userInputSchema, team: teamInputSchema, workflow_id: idInputSchema, form_id: idInputSchema, date_range: dateRangeInputSchema,
  }).strict(),

  /* ── Phase 2: people & org ── */
  team_members: z.object({
    team: teamInputSchema,
    show_workload: z.boolean().default(true),
    show_presence: z.boolean().default(true),
    limit: z.number().int().min(1).max(100).default(20),
    click: clickSchema,
  }).strict(),
  org_chart: z.object({
    /** Whose part of the org chart (default: the viewer). */
    person: userInputSchema,
    depth: z.number().int().min(1).max(3).default(1),
  }).strict(),
  people_directory: z.object({
    team: teamInputSchema,
    limit: z.number().int().min(5).max(100).default(24),
  }).strict(),

  /* ── Phase 2: activity & content ── */
  activity_feed: z.object({
    sources: z.array(z.enum(['tasks', 'runs', 'submissions', 'audit'])).min(1).max(4).default(['tasks', 'runs', 'submissions']),
    workflow_id: idInputSchema, person: userInputSchema, date_range: dateRangeInputSchema,
    limit: z.number().int().min(1).max(50).default(15),
  }).strict(),
  announcement: z.object({
    html: z.string().max(20_000).default(''),
    tone: z.enum(['info', 'success', 'warning', 'danger', 'neutral']).default('info'),
    /** Shown only from / until these dates (ISO, inclusive). */
    starts_on: isoDate.nullable().optional(),
    ends_on: isoDate.nullable().optional(),
  }).strict(),
  embed: z.object({
    url: z.string().trim().max(2000).refine((u) => u === '' || /^https:\/\//i.test(u), 'Use an https:// address').default(''),
    title: shortText(120).default('Embedded content'),
    allow_fullscreen: z.boolean().default(true),
  }).strict(),
  video: z.object({
    url: z.string().trim().max(2000).refine((u) => u === '' || /^https:\/\//i.test(u), 'Use an https:// address').default(''),
    caption: shortText(300).nullable().optional(),
  }).strict(),
  divider: z.object({ label: shortText(80).nullable().optional() }).strict(),
  spacer: z.object({}).strict(),
  tabs: z.object({
    tabs: z.array(z.object({
      label: shortText(40).min(1),
      icon: shortText(60).nullable().optional(),
      badge: z.enum(BADGE_SOURCES).nullable().optional(),
      /** Widgets of the page shown on this tab… */
      widgets: widgetIds.default([]),
      /** …or a target shown directly in it (then `widgets` is ignored). */
      target: tabTargetSchema.nullable().optional(),
    }).strict()).max(8).default([{ label: 'Tab 1', widgets: [] }]),
    style: z.enum(['underline', 'pills', 'segmented', 'vertical']).default('underline'),
    /** Load a tab's content the first time it is opened. */
    lazy: z.boolean().default(true),
    /** Reopen the tab the person last used (kept per person and in the URL). */
    remember: z.boolean().default(true),
  }).strict(),
  section: z.object({
    label: shortText(80).default('Section'),
    widgets: widgetIds.default([]),
    collapsible: z.boolean().default(true),
    collapsed: z.boolean().default(false),
  }).strict(),

  /* ── Phase 2: navigation ── */
  tiles: z.object({
    tiles: z.array(z.object({ label: shortText(60).min(1), description: shortText(160).nullable().optional(), icon: shortText(40).nullable().optional(), open_mode: openModeSchema.nullable().optional(), action: buttonActionSchema }).strict()).max(24).default([]),
    columns: z.number().int().min(1).max(6).default(3),
  }).strict(),
  page_header: z.object({
    show_icon: z.boolean().default(true),
    show_breadcrumb: z.boolean().default(true),
    subtitle: shortText(300).nullable().optional(),
  }).strict(),
  quick_search: z.object({
    placeholder: shortText(80).default('Search this app…'),
    include: z.array(z.enum(['pages', 'forms', 'workflows', 'tables', 'reports', 'tasks'])).min(1).max(6).default(['pages', 'forms', 'tasks']),
  }).strict(),

  nav_bar: z.object({
    /** Docked flush to this edge of the page (one bar per edge). */
    edge: z.enum(['left', 'right', 'top']).default('left'),
    items: z.array(menuItemSchema).max(MAX_MENU_ITEMS * 2).default([]),
    show_search: z.boolean().default(false),
    /** The app's own navigation (tabs / top bar) on pages with this bar: hidden (the bar replaces it — one navigation) or shown as well. */
    app_nav: z.enum(['hide', 'show']).default('hide'),
    /** The search box also finds the app's objects (Quick search). */
    search_objects: z.boolean().default(false),
    collapsible: z.boolean().default(true),
    background: z.enum(['surface', 'app', 'dark']).default('surface'),
    /** Width (left / right, px) or height (top, px). */
    size: z.number().int().min(40).max(400).default(240),
    density: z.enum(['comfortable', 'compact']).default('comfortable'),
    icon_size: z.enum(['sm', 'md', 'lg']).default('md'),
    show_labels: z.boolean().default(true),
    footer_profile: z.boolean().default(false),
    footer_help_url: safeUrl.nullable().optional(),
  }).strict(),

  /* ── Phase 2: agents ── */
  agent_chat: z.object({
    agent_id: idInputSchema,
    greeting: shortText(400).nullable().optional(),
    placeholder: shortText(120).default('Ask a question…'),
  }).strict(),
} as const

export type WidgetType = keyof typeof WIDGET_CONFIG_SCHEMAS
export const WIDGET_TYPES = Object.keys(WIDGET_CONFIG_SCHEMAS) as WidgetType[]
export type WidgetConfig<T extends WidgetType = WidgetType> = z.output<(typeof WIDGET_CONFIG_SCHEMAS)[T]>

export function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === 'string' && Object.hasOwn(WIDGET_CONFIG_SCHEMAS, value)
}

export const widgetIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/i, 'Widget id: letters, numbers, - and _')

const widgetBase = {
  id: widgetIdSchema,
  title: shortText(120).nullable().optional(),
  /** Chromeless ("bleed"): no card, border, padding or title bar — the content fills the widget area. */
  bleed: z.boolean().optional(),
  /** Style overrides of the theme for this widget (lib/apps/style.ts). */
  style: widgetStyleSchema.optional(),
  /** Settings → Query per-widget override (honoured only when the workspace allows per-widget overrides). */
  data_source: z.enum(['inherit', 'auto', 'rollup', 'live']).optional(),
  /** auto: the card grows / shrinks to its content (lists, cards, people), up to max_h rows, then scrolls inside; fixed: exactly h rows. Unset (saved before auto height): lists fit their content, never taller than h. */
  height: z.enum(['auto', 'fixed']).optional(),
  /** Auto height: the most rows it may take (default: the catalogue's cap, 14). */
  max_h: z.number().int().min(2).max(30).optional(),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(30),
}

/** One widget: its type picks the config schema. */
export const widgetSchema = z.discriminatedUnion('type', WIDGET_TYPES.map((type) =>
  z.object({ ...widgetBase, type: z.literal(type), config: z.preprocess((v) => v ?? {}, WIDGET_CONFIG_SCHEMAS[type] as z.ZodType) }).strict(),
) as unknown as [z.ZodObject<z.ZodRawShape>, ...z.ZodObject<z.ZodRawShape>[]])

export interface AppWidget<T extends WidgetType = WidgetType> {
  id: string
  type: T
  title?: string | null
  bleed?: boolean
  style?: WidgetStyle
  data_source?: 'inherit' | 'auto' | 'rollup' | 'live'
  height?: 'auto' | 'fixed'
  max_h?: number
  w: number
  h: number
  config: WidgetConfig<T>
}

/** Page options (stored with the layout): hidden from the menu (opened from buttons / panels only) and the lowest app role that may open it. */
export const pageOptionsSchema = z.object({
  hidden: z.boolean().default(false),
  min_role: z.enum(['viewer', 'contributor', 'editor']).default('viewer'),
  /** Cards that start on the same row line up (shrunk ones grow back to the row's tallest, never past their own size). */
  equal_rows: z.boolean().optional(),
}).strict()
export type PageOptions = z.output<typeof pageOptionsSchema>
export const DEFAULT_PAGE_OPTIONS: PageOptions = { hidden: false, min_role: 'viewer' }
/** Page options worth storing (anything but the defaults). */
export function nonDefaultOptions(o: PageOptions | undefined): boolean {
  return !!o && (o.hidden || o.min_role !== 'viewer' || o.equal_rows === false)
}

export const pageLayoutSchema = z.object({
  widgets: z.array(widgetSchema).max(MAX_WIDGETS),
  options: pageOptionsSchema.optional(),
  /** Page parameters (filled from ?p.<name>=, the opener or the embed URL) — lib/apps/variables.ts. */
  params: paramsSchema.optional(),
  /** Page variables (set by rules and widgets; `url` ones kept in ?v.<name>=). */
  variables: variablesSchema.optional(),
  /** Page rules: When … If … Then … (lib/apps/rules.ts). */
  rules: rulesSchema.optional(),
}).strict().superRefine((value, ctx) => {
  const ids = value.widgets.map((w) => (w as { id: string }).id)
  const dup = ids.find((id, i) => ids.indexOf(id) !== i)
  if (dup) ctx.addIssue({ code: 'custom', message: `Widget id ${dup} appears more than once` })
})
export interface PageLayout { widgets: AppWidget[]; options?: PageOptions; params?: ParamDecl[]; variables?: VariableDecl[]; rules?: AppRule[] }

/**
 * A stored layout → a valid one: widgets with an unknown type, a duplicate id
 * or an invalid config are dropped; sizes are clamped. Never throws.
 */
export function normalisePageLayout(raw: unknown): PageLayout {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { widgets?: unknown }).widgets) ? (raw as { widgets: unknown[] }).widgets : []
  const seen = new Set<string>()
  const widgets: AppWidget[] = []
  for (const entry of list.slice(0, MAX_WIDGETS)) {
    const parsed = widgetSchema.safeParse(entry)
    if (!parsed.success) continue
    const widget = parsed.data as unknown as AppWidget
    if (seen.has(widget.id)) continue
    seen.add(widget.id)
    widgets.push(widget)
  }
  const r = (raw ?? {}) as { options?: unknown; params?: unknown; variables?: unknown; rules?: unknown }
  const options = pageOptionsSchema.safeParse(r.options ?? {})
  const out: PageLayout = options.success && nonDefaultOptions(options.data) ? { widgets, options: options.data } : { widgets }
  const params = normaliseParams(r.params)
  const variables = normaliseVariables(r.variables)
  const rules = normaliseRules(r.rules)
  if (params.length) out.params = params
  if (variables.length) out.variables = variables
  if (rules.length) out.rules = rules
  return out
}

/** May an app role open a page with these options? (editor > contributor > viewer) */
export function pageAllowed(options: PageOptions | undefined, role: 'editor' | AppRole): boolean {
  const rank = { viewer: 0, contributor: 1, editor: 2 } as const
  return rank[role] >= rank[options?.min_role ?? 'viewer']
}

/** Stored filters → the valid ones (unique ids). */
export function normalisePageFilters(raw: unknown): PageFilter[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: PageFilter[] = []
  for (const entry of raw.slice(0, MAX_FILTERS)) {
    const parsed = pageFilterSchema.safeParse(entry)
    if (!parsed.success || seen.has(parsed.data.id)) continue
    seen.add(parsed.data.id)
    out.push(parsed.data)
  }
  return out
}

/* ── App menu ────────────────────────────────────────────────────────── */

export function normaliseMenu(raw: unknown): AppMenuItem[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_MENU_ITEMS).flatMap((entry) => {
    const parsed = menuItemSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

/* ── App navigation and header (app settings) ────────────────────────── */

export const NAV_STYLES = ['top', 'sidebar', 'drawer', 'tabs', 'bottom', 'mega', 'none'] as const
export type NavStyle = (typeof NAV_STYLES)[number]
export const appNavSchema = z.object({
  /** top bar (overflow to More), left sidebar (collapsible), hamburger drawer, page tabs, bottom tab bar (phones), mega-menu (groups as columns), none. Phones fall back to the drawer (bottom stays a bottom bar). */
  style: z.enum(NAV_STYLES).default('tabs'),
  sidebar_collapsed: z.boolean().default(false),
  show_icon: z.boolean().default(true),
  show_title: z.boolean().default(true),
  show_subtitle: z.boolean().default(true),
  header_style: z.enum(['plain', 'colored', 'banner']).default('plain'),
  banner_url: z.string().trim().max(2000).refine((u) => u === '' || /^(https:\/\/|\/(?!\/))/i.test(u), 'Use an https:// address or a path').nullable().optional(),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  /** full: inside the UserTasks shell; app_only: the app fills the window. */
  shell: z.enum(['full', 'app_only']).default('full'),
  /** Fold the UserTasks side menu to its icon rail while this app is open (lib/apps/shell-collapse.ts). */
  collapse_shell_menu: z.boolean().default(true),
}).strict()
export type AppNav = z.output<typeof appNavSchema>
export const DEFAULT_APP_NAV: AppNav = appNavSchema.parse({})

export function normaliseNav(raw: unknown): AppNav {
  const parsed = appNavSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : DEFAULT_APP_NAV
}

/* ── API / service inputs ────────────────────────────────────────────── */

export const PRINCIPAL_TYPES = ['user', 'team', 'role'] as const
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number]
/** viewer: read-only (no buttons that submit, start or claim); contributor: may use the action buttons. Both only within their own object permissions. */
export const APP_ROLES = ['viewer', 'contributor'] as const
export type AppRole = (typeof APP_ROLES)[number]
export const audienceEntrySchema = z.object({
  type: z.enum(PRINCIPAL_TYPES).describe('user, team or role'),
  id: uuid.describe('User, team or role id'),
  role: z.enum(APP_ROLES).default('viewer').describe('viewer (read-only, default) or contributor (may use action buttons: new submission, start workflow, claim)'),
}).strict()
export type AudienceEntry = z.output<typeof audienceEntrySchema>
export type AudienceEntryInput = z.input<typeof audienceEntrySchema>

/** An app's own sign-in page choice (apps.settings.sign_in_page; null follows the workspace's use_for_apps). */
export const APP_SIGN_IN_CHOICES = ['workspace', 'standard'] as const

/** App slugs that collide with /api/v1/apps/<word> routes (and the Apps UI): never an app's address. */
export const RESERVED_APP_SLUGS: ReadonlySet<string> = new Set(['spec', 'rule-types', 'widget-types', 'new', 'search'])
const appSlugSchema = slugSchema.refine((s) => !RESERVED_APP_SLUGS.has(s), { message: 'That address is reserved: choose another' })

export const appCreateSchema = z.object({
  name: shortText(120).min(1).describe('App name'),
  slug: appSlugSchema.optional().describe('URL slug (/apps/<slug>); derived from the name when omitted; spec, rule-types, widget-types, new and search are reserved'),
  subtitle: shortText(160).nullable().optional().describe('One line under the name (Apps page cards)'),
  description: shortText(1000).nullable().optional().describe('Short description (shown in the Apps menu and searched)'),
  icon: shortText(60).nullable().optional().describe('Icon name (lucide, e.g. LayoutGrid, Briefcase)'),
  color: z.string().regex(COLOR_RE, 'A #rrggbb colour').nullable().optional().describe('Accent colour #rrggbb, layered on the workspace theme'),
  menu: z.array(menuItemSchema).max(MAX_MENU_ITEMS).optional().describe('Extra menu entries beside the pages'),
  tags: z.array(z.string().max(60)).max(30).optional().describe('Tags (replaces the current tags; [] clears). Trimmed, matched case-insensitively'),
  audience: z.array(audienceEntrySchema).max(MAX_AUDIENCE).optional().describe('Who may open the app: users, teams and roles'),
  editors: z.array(uuid).max(MAX_EDITORS).optional().describe('User ids who may edit this app'),
  nav: appNavSchema.optional().describe('Navigation style and header options: { style: top | sidebar | drawer | tabs | bottom | mega | none, header_style, density, shell, … }'),
  params: paramsSchema.optional().describe('App parameters [{ name, type: text | number | boolean | date | list | record, default?, required? }], filled from ?p.<name>= on any page, the opener or the embed URL'),
  variables: variablesSchema.optional().describe('App variables [{ name, type, default? }]: kept for the session across pages; set by rules and widgets'),
  style: appStyleSchema.optional().describe('Widget styling: { default: <widget style every widget inherits>, presets: [{ name, style }] } — see lib/apps/style.ts and /docs/tasks/apps “Styling widgets”'),
  rules: rulesSchema.optional().describe('App rules (run on every page): [{ id, name?, when: { type, … }, if?: { match, conditions }, then: [actions] }] — see lib/apps/rules.ts and /docs/tasks/apps'),
  sign_in_page: z.enum(APP_SIGN_IN_CHOICES).nullable().optional().describe('Where people who are not signed in sign in: workspace (the workspace sign-in page), standard (the standard UserTasks sign-in) or null (follow the workspace setting use_for_apps, the default). Live at once: not part of the draft'),
}).strict()
export type AppCreateInput = z.input<typeof appCreateSchema>

export const appUpdateSchema = appCreateSchema.partial().strict()
export type AppUpdateInput = z.input<typeof appUpdateSchema>

export const pageCreateSchema = z.object({
  title: shortText(120).min(1).describe('Page title (menu label)'),
  slug: slugSchema.optional().describe('URL slug (/apps/<app>/<slug>); derived from the title when omitted'),
  icon: shortText(60).nullable().optional().describe('Icon name'),
  position: z.number().int().min(0).max(1000).optional().describe('Menu order (0 first); appended when omitted'),
  layout: pageLayoutSchema.optional().describe('Widgets in reading order: { widgets: [{ id, type, w, h, title?, config }], params?: [page parameters], variables?: [page variables], rules?: [page rules] }'),
  filters: z.array(pageFilterSchema).max(MAX_FILTERS).optional().describe('Page filters widgets can bind to with { filter: "<id>" }'),
}).strict()
export type PageCreateInput = z.infer<typeof pageCreateSchema>
export const pageUpdateSchema = pageCreateSchema.partial().strict()
export type PageUpdateInput = z.infer<typeof pageUpdateSchema>

/* ── Shapes returned by the service ──────────────────────────────────── */

export type AppAccess = 'edit' | 'view'

export interface AppSummary {
  id: string
  slug: string
  name: string
  subtitle: string | null
  description: string | null
  icon: string | null
  color: string | null
  /** The caller's access. */
  access: AppAccess
  /** Shared with the caller (the audience names them, a team or a role of theirs). */
  in_audience: boolean
  /** What the caller may do in the app: editor (builders), contributor (action buttons) or viewer (read-only). */
  app_role: 'editor' | AppRole
  /** Editors only: unresolved access issues found at the last save (null when never checked / not an editor). */
  access_issues: number | null
  /** Tags ([] until migration 20270122150000 is applied). */
  tags: string[]
  /** First page slug (where /apps/<slug> opens), null when the app has none. */
  home_page: string | null
  updated_at: string
  /** The app has a published version (always true before the drafts migration). Its audience sees only published apps. */
  published?: boolean
  /** The live version number (null: never published, or no drafts on this server). */
  published_version?: number | null
  /** Editors only: the draft has changes that are not published (true while never published); null for everyone else. */
  has_draft_changes?: boolean | null
}

/** An app's draft / publish state, for its editors (lib/services/app-versions.ts). */
export interface AppPublishState {
  /** The live version (null: never published — only its editors see the app). */
  published_version: number | null
  published_at: string | null
  published_by: string | null
  /** The draft differs from the published version ("Changes not published"). */
  has_draft_changes: boolean
  draft_updated_at: string | null
  draft_updated_by: string | null
}

export interface AppPage {
  id: string
  app_id: string
  slug: string
  title: string
  icon: string | null
  position: number
  layout: PageLayout
  filters: PageFilter[]
  updated_at: string
}

export interface AppDetail extends Omit<AppSummary, 'home_page'> {
  home_page: string | null
  menu: AppMenuItem[]
  nav: AppNav
  /** App parameters, variables and rules (lib/apps/variables.ts, rules.ts). */
  params: ParamDecl[]
  variables: VariableDecl[]
  rules: AppRule[]
  /** App-level widget style (default + presets). */
  style: AppStyle
  /** Pages the caller may open, in menu order; `hidden`: not in the menu (opened from buttons / panels). */
  pages: Array<Pick<AppPage, 'id' | 'slug' | 'title' | 'icon' | 'position'> & { hidden?: boolean; min_role?: PageOptions['min_role'] }>
  /** Builders only (null for viewers). */
  audience: AudienceEntry[] | null
  editors: string[] | null
  created_at: string
  created_by: string | null
  /** Which version this is: the working draft, the published version, or live (no drafts on this server). */
  content?: 'draft' | 'published' | 'live'
  /** The published version number shown (null for the draft). */
  version?: number | null
  /** Editors only: the draft / publish state (null for everyone else, and before the drafts migration). */
  publish_state?: AppPublishState | null
  /** Where signed-out visitors sign in: the workspace sign-in page, the standard sign-in, or null (the workspace setting). Live, not versioned. */
  sign_in_page?: (typeof APP_SIGN_IN_CHOICES)[number] | null
}

/** A slug from free text (name / title), never empty. */
export function slugFrom(text: string, fallback = 'app'): string {
  const slug = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '')
  return SLUG_RE.test(slug) ? slug : fallback
}

/** `base`, or `base-2`, `base-3`… — the first one not in `taken`. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`
    const candidate = `${base.slice(0, 64 - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return `${base.slice(0, 55)}-${Date.now().toString(36)}`
}
