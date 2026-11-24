import type { GridDefLookup, GridItemDef } from '@/lib/home/layout'
import {
  DATE_PRESETS, WIDGET_CONFIG_SCHEMAS, isWidgetType,
  type AppWidget, type DatePreset, type DateRangeValue, type FilterRef, type PageFilter, type RowCondition, type WidgetConfig, type WidgetType,
} from './schema'

/**
 * The Phase 1 widget catalogue and input binding (pure, client-safe;
 * __tests__/apps-widgets.test.ts).
 *
 * Grid sizes plug into Home's grid (lib/home/layout.ts GridDefLookup):
 * `appGridDefs(widgets)` maps each widget id on a page to its type's bounds
 * and the title the builder shows on its handle.
 */

export type WidgetGroup = 'actions' | 'tasks' | 'sla' | 'workflows' | 'forms' | 'data' | 'charts' | 'people' | 'activity' | 'content' | 'layout' | 'navigation' | 'agents'

export interface WidgetCatalogEntry {
  type: WidgetType
  title: string
  description: string
  /** lucide icon name (components/apps/app-icon.tsx WIDGET_ICONS). */
  icon: string
  group: WidgetGroup
  /** Grid group: 'list' and 'forms' widgets are drawn on a card by the grid; others draw their own surface. */
  gridGroup: 'list' | 'chart' | 'metric' | 'forms'
  w: number
  h: number
  minW: number
  maxW: number
  minH: number
  maxH: number
  tabletMinW: number
  /** New widgets of this type start chromeless (bleed). */
  bleed?: boolean
  /** Search keywords for the catalogue. */
  keywords?: string
}

const entry = (e: WidgetCatalogEntry) => e
type Size = Pick<WidgetCatalogEntry, 'w' | 'h' | 'minW' | 'maxW' | 'minH' | 'maxH' | 'tabletMinW'>
const size = (w: number, h: number, minW = 3, maxW = 12, minH = 3, maxH = 30): Size => ({ w, h, minW, maxW, minH, maxH, tabletMinW: Math.min(minW, 6) })
const list = (e: Omit<WidgetCatalogEntry, 'gridGroup' | keyof Size>, s: Size): WidgetCatalogEntry => ({ ...e, gridGroup: 'list', ...s })
const bare = (e: Omit<WidgetCatalogEntry, 'gridGroup' | keyof Size>, s: Size): WidgetCatalogEntry => ({ ...e, gridGroup: 'metric', ...s })

export const WIDGET_CATALOG: readonly WidgetCatalogEntry[] = [
  entry({ type: 'actions', title: 'Buttons', description: 'Buttons that open a form, start a workflow, open a page, report, record or link, claim the next task, copy a link or set a filter — styled, with badges, confirmations and visibility rules.', icon: 'MousePointerClick', group: 'actions', gridGroup: 'list', w: 6, h: 2, minW: 2, maxW: 12, minH: 1, maxH: 10, tabletMinW: 2 }),
  list({ type: 'tiles', title: 'Tile menu', description: 'Icon tiles that open pages, forms, workflows, reports or links.', icon: 'LayoutGrid', group: 'navigation' }, size(12, 4, 3, 12, 2, 16)),
  list({ type: 'quick_search', title: 'Quick search', description: 'Search this app’s pages, forms, workflows, tables, reports and your tasks.', icon: 'Search', group: 'navigation' }, size(6, 3, 3, 12, 2, 12)),
  { type: 'nav_bar', title: 'Navigation bar', description: 'A menu docked flush to the left, right or top of the page: groups, nested items, badges, search, collapse to icons — the same navigation as the app menu.', icon: 'PanelLeft', group: 'navigation', gridGroup: 'metric', ...size(12, 1, 1, 12, 1, 30), bleed: true, keywords: 'sidebar menu rail docked' },
  bare({ type: 'page_header', title: 'Page header', description: 'Breadcrumb, the app’s icon and name, and the page title.', icon: 'PanelTop', group: 'navigation' }, size(12, 2, 4, 12, 1, 4)),

  entry({ type: 'task_list', title: 'Task list', description: 'My tasks, a team queue, or tasks filtered by form, workflow, status or assignee — with claim, due / SLA indicators and a quick-view drawer.', icon: 'ListChecks', group: 'tasks', gridGroup: 'list', w: 6, h: 8, minW: 3, maxW: 12, minH: 4, maxH: 30, tabletMinW: 3 }),
  list({ type: 'kanban', title: 'Kanban board', description: 'Tasks in columns by status, or data table rows in lanes by a column (deals by stage); drag a card to move it (contributors who may complete tasks / manage rows).', icon: 'Columns3', group: 'tasks', keywords: 'board status columns lanes pipeline stage' }, size(12, 10, 6, 12, 6, 30)),
  list({ type: 'task_calendar', title: 'Task calendar', description: 'Tasks on a month or week calendar by due date.', icon: 'CalendarDays', group: 'tasks', keywords: 'due dates' }, size(8, 10, 4, 12, 6, 30)),
  list({ type: 'my_workload', title: 'My workload', description: 'The viewer’s open, overdue, due-today and due-this-week tasks, and what they completed this week.', icon: 'BriefcaseBusiness', group: 'tasks' }, size(4, 4, 3, 12, 3, 10)),
  list({ type: 'overdue_list', title: 'Overdue tasks', description: 'Open tasks past their due date, oldest first.', icon: 'AlarmClock', group: 'tasks' }, size(6, 6)),
  list({ type: 'team_workload', title: 'Team workload', description: 'Open and overdue tasks per person for a team — its queue and the tasks assigned to its members; click a person to filter the page.', icon: 'UsersRound', group: 'tasks' }, size(6, 7)),

  entry({ type: 'sla', title: 'SLA', description: 'On track, at risk and breached counts with a breakdown, for a person, team, workflow or form.', icon: 'Timer', group: 'sla', gridGroup: 'list', w: 4, h: 5, minW: 3, maxW: 12, minH: 4, maxH: 14, tabletMinW: 3 }),
  list({ type: 'sla_trend', title: 'SLA trend', description: 'Share of tasks or runs finished on time, per day, week or month.', icon: 'TrendingUp', group: 'sla' }, size(6, 7, 3, 12, 4, 16)),
  list({ type: 'sla_breakdown', title: 'SLA breakdown', description: 'On track, at risk and breached by workflow, team, assignee or form.', icon: 'TableProperties', group: 'sla' }, size(6, 7)),
  list({ type: 'cycle_time', title: 'Cycle time', description: 'Time to complete (median and 90th percentile) with its trend.', icon: 'Hourglass', group: 'sla', keywords: 'time to complete duration p90 median' }, size(6, 7, 3, 12, 4, 16)),
  list({ type: 'bottleneck', title: 'Bottlenecks', description: 'Where work waits: open tasks and paused runs by workflow step, with the average wait.', icon: 'Filter', group: 'sla' }, size(6, 7)),
  list({ type: 'throughput', title: 'Throughput', description: 'Created versus completed over time.', icon: 'ArrowRightLeft', group: 'sla' }, size(6, 7, 3, 12, 4, 16)),

  list({ type: 'run_status', title: 'Run status', description: 'Running, waiting, completed and failed workflow runs; click a status to filter.', icon: 'Activity', group: 'workflows' }, size(6, 4, 3, 12, 3, 10)),
  list({ type: 'recent_failures', title: 'Recent failures', description: 'The latest failed workflow runs with their error.', icon: 'OctagonAlert', group: 'workflows' }, size(6, 6)),
  list({ type: 'run_timeline', title: 'Run timeline', description: 'The step-by-step timeline of the latest run of a workflow (the viewer’s by default).', icon: 'GitCommitVertical', group: 'workflows' }, size(6, 9, 4, 12, 4, 30)),
  list({ type: 'start_workflow', title: 'Start workflow', description: 'A card with a button that opens the workflow’s start form (its inputs) in a dialog.', icon: 'Play', group: 'workflows' }, size(4, 3, 3, 12, 2, 8)),

  list({ type: 'submission_trend', title: 'Submissions', description: 'Form submission count with its trend over time.', icon: 'FileBarChart', group: 'forms' }, size(6, 6, 3, 12, 3, 16)),
  { type: 'form_embed', title: 'Form', description: 'A form rendered right on the page, edge to edge — submit in place, with prefill from page filters or the viewer.', icon: 'FileInput', group: 'forms', gridGroup: 'metric', ...size(6, 12, 3, 12, 4, 30), bleed: true, keywords: 'embed inline submit' },
  list({ type: 'my_submissions', title: 'My submissions', description: 'The viewer’s form submissions with the status of the work they started.', icon: 'Inbox', group: 'forms' }, size(6, 6)),
  list({ type: 'field_analytics', title: 'Field analytics', description: 'Answer distribution of a form’s choice fields (survey charts).', icon: 'ChartPie', group: 'forms', keywords: 'survey choice distribution' }, size(6, 8, 3, 12, 4, 24)),

  entry({ type: 'table_view', title: 'Data table / report', description: 'Rows of a data table, or a saved report, embedded read-only.', icon: 'Table', group: 'data', gridGroup: 'list', w: 12, h: 8, minW: 4, maxW: 12, minH: 4, maxH: 30, tabletMinW: 6 }),
  list({ type: 'data_grid', title: 'Data grid', description: 'A data table as a grid with search, grouping and paging; contributors with Manage rows can edit cells.', icon: 'Sheet', group: 'data', keywords: 'editable spreadsheet' }, size(12, 10, 6, 12, 5, 30)),
  list({ type: 'card_view', title: 'Card view', description: 'Records as cards — from a data table (or one of its views), a report, or an API reference — with a card template, actions, search and paging.', icon: 'LayoutPanelTop', group: 'data', keywords: 'cards gallery api' }, size(12, 10, 3, 12, 4, 30)),
  list({ type: 'record_card', title: 'Record', description: 'One data table row as a detail card (fixed, or chosen by a page filter).', icon: 'IdCard', group: 'data' }, size(4, 6)),
  list({ type: 'filtered_list', title: 'Filtered list', description: 'Data table rows as a searchable list; click a row to filter the page.', icon: 'ListFilter', group: 'data' }, size(4, 8)),
  list({ type: 'pivot', title: 'Pivot table', description: 'Group by one or two dimensions with count, sum or average.', icon: 'Grid3x3', group: 'data', keywords: 'summary group aggregate' }, size(6, 7)),

  entry({ type: 'metric', title: 'Metric', description: 'A count, sum or average of tasks, workflow runs, form submissions or data table rows, with an optional comparison to the previous period.', icon: 'Gauge', group: 'charts', gridGroup: 'list', w: 3, h: 2, minW: 2, maxW: 6, minH: 2, maxH: 6, tabletMinW: 2 }),
  list({ type: 'kpi', title: 'KPI with sparkline', description: 'A number with its sparkline and change, optionally against a target.', icon: 'ChartSpline', group: 'charts' }, size(3, 3, 2, 6, 2, 6)),
  list({ type: 'goal', title: 'Goal progress', description: 'Progress towards a target as a bar.', icon: 'Target', group: 'charts' }, size(4, 3, 2, 12, 2, 6)),
  list({ type: 'gauge', title: 'Gauge', description: 'A value on a dial between a minimum and maximum, with warning and danger bands.', icon: 'Gauge', group: 'charts' }, size(3, 5, 2, 6, 3, 10)),
  entry({ type: 'chart', title: 'Chart', description: 'Bar, horizontal bar, stacked bar, combo bar + line, line, area, pie, donut, funnel or scatter over tasks, runs, submissions or data table rows; click a segment to filter.', icon: 'ChartColumn', group: 'charts', gridGroup: 'list', w: 6, h: 7, minW: 3, maxW: 12, minH: 4, maxH: 16, tabletMinW: 3 }),
  list({ type: 'heatmap', title: 'Heatmap', description: 'Activity by day of week and hour of day.', icon: 'Grid2x2', group: 'charts' }, size(6, 6, 4, 12, 4, 12)),

  list({ type: 'team_members', title: 'Team members', description: 'A team’s members with presence (last seen) and open task counts.', icon: 'Users', group: 'people' }, size(4, 7)),
  list({ type: 'org_chart', title: 'Org chart', description: 'A person’s manager, peers and reports.', icon: 'Network', group: 'people' }, size(6, 8, 4, 12, 4, 20)),
  list({ type: 'people_directory', title: 'People directory', description: 'Search people by name, email, job title or department.', icon: 'Contact', group: 'people' }, size(6, 8)),

  entry({ type: 'recent', title: 'Recent activity', description: 'The latest form submissions or workflow runs, filtered by form, workflow or person.', icon: 'History', group: 'activity', gridGroup: 'list', w: 6, h: 6, minW: 3, maxW: 12, minH: 3, maxH: 20, tabletMinW: 3 }),
  list({ type: 'activity_feed', title: 'Activity feed', description: 'Task, run and submission events — and the audit log for admins — that the viewer may see.', icon: 'Rss', group: 'activity' }, size(4, 8)),
  list({ type: 'announcement', title: 'Announcement', description: 'A highlighted note (rich text) editors keep up to date, optionally shown only between two dates.', icon: 'Megaphone', group: 'content' }, size(12, 3, 3, 12, 2, 12)),

  entry({ type: 'heading', title: 'Heading', description: 'A title and an optional subtitle.', icon: 'Heading', group: 'content', gridGroup: 'metric', w: 12, h: 2, minW: 2, maxW: 12, minH: 1, maxH: 4, tabletMinW: 2 }),
  entry({ type: 'text', title: 'Rich text', description: 'Formatted text: paragraphs, lists, links (sanitised).', icon: 'Text', group: 'content', gridGroup: 'list', w: 6, h: 4, minW: 2, maxW: 12, minH: 2, maxH: 20, tabletMinW: 2 }),
  entry({ type: 'image', title: 'Image', description: 'An image from an https:// address, optionally a link.', icon: 'Image', group: 'content', gridGroup: 'metric', w: 4, h: 5, minW: 2, maxW: 12, minH: 2, maxH: 20, tabletMinW: 2 }),
  entry({ type: 'links', title: 'Link list', description: 'A list of useful links with optional descriptions.', icon: 'Link', group: 'content', gridGroup: 'list', w: 4, h: 5, minW: 2, maxW: 12, minH: 2, maxH: 20, tabletMinW: 2 }),
  { type: 'video', title: 'Video', description: 'A YouTube or Vimeo video, or an https:// video file.', icon: 'Video', group: 'content', gridGroup: 'metric', ...size(6, 7, 3, 12, 3, 20), bleed: true },
  { type: 'embed', title: 'Embed', description: 'Another site in a frame — only origins an admin allowed (Settings → Embedding).', icon: 'AppWindow', group: 'content', gridGroup: 'metric', ...size(6, 8, 3, 12, 3, 30), bleed: true, keywords: 'iframe' },

  bare({ type: 'divider', title: 'Divider', description: 'A line between parts of the page, with an optional label.', icon: 'Minus', group: 'layout' }, size(12, 1, 2, 12, 1, 2)),
  bare({ type: 'spacer', title: 'Spacer', description: 'Empty space.', icon: 'Space', group: 'layout' }, size(12, 1, 1, 12, 1, 8)),
  list({ type: 'tabs', title: 'Tabs', description: 'Group other widgets of the page into tabs.', icon: 'PanelsTopLeft', group: 'layout', keywords: 'container' }, size(12, 10, 4, 12, 4, 30)),
  list({ type: 'section', title: 'Collapsible section', description: 'Group other widgets under a heading that can be collapsed.', icon: 'ChevronsUpDown', group: 'layout', keywords: 'container accordion' }, size(12, 8, 4, 12, 2, 30)),

  list({ type: 'agent_chat', title: 'Ask an agent', description: 'Chat with a chosen agent (people who may run agents).', icon: 'Bot', group: 'agents' }, size(6, 10, 3, 12, 6, 30)),
]

export const WIDGET_GROUP_LABELS: Record<WidgetGroup, string> = {
  actions: 'Actions', tasks: 'Tasks', sla: 'SLA & performance', workflows: 'Workflows', forms: 'Forms', data: 'Data', charts: 'Charts',
  people: 'People & org', activity: 'Activity', content: 'Content', layout: 'Layout', navigation: 'Navigation', agents: 'Agents',
}

const CATALOG = new Map<WidgetType, WidgetCatalogEntry>(WIDGET_CATALOG.map((e) => [e.type, e]))

export function catalogEntry(type: WidgetType): WidgetCatalogEntry {
  return CATALOG.get(type)!
}

/** The grid's view of one widget type (bounds + title). Bleed widgets draw no card. */
export function gridDefFor(type: WidgetType, title?: string | null, bleed?: boolean): GridItemDef {
  const e = catalogEntry(type)
  return { title: title?.trim() || e.title, group: bleed ? 'metric' : e.gridGroup, ...(bleed ? { bleed: true } : {}), w: e.w, h: e.h, minW: e.minW, maxW: e.maxW, minH: e.minH, maxH: e.maxH, tabletMinW: e.tabletMinW }
}

/** A grid lookup for the widgets of one page (by widget id). */
export function appGridDefs(widgets: readonly Pick<AppWidget, 'id' | 'type' | 'title' | 'bleed'>[], styleOf?: (id: string) => { vars: Record<string, string>; box: Record<string, string>; flags: string } | null): GridDefLookup {
  const map = new Map(widgets.map((w) => {
    const def = gridDefFor(w.type, w.title, isBleed(w))
    const st = styleOf?.(w.id)
    return [w.id, st ? { ...def, cardStyle: { ...st.vars, ...st.box }, cardFlags: st.flags } : def]
  }))
  return (id) => map.get(id)
}

/** Is the widget chromeless? Its own setting, else its type's default. */
export function isBleed(w: Pick<AppWidget, 'type' | 'bleed'>): boolean {
  return w.bleed ?? catalogEntry(w.type).bleed ?? false
}

/** Ids of widgets placed inside a tabs / section container (drawn there, not on the grid). */
export function containedIds(widgets: readonly AppWidget[]): Set<string> {
  const out = new Set<string>()
  for (const w of widgets) {
    if (w.type === 'tabs') for (const t of (w.config as WidgetConfig<'tabs'>).tabs) for (const id of t.widgets) if (id !== w.id) out.add(id)
    if (w.type === 'section') for (const id of (w.config as WidgetConfig<'section'>).widgets) if (id !== w.id) out.add(id)
  }
  // A container can't sit inside another container that it holds (no cycles): containers stay on the grid.
  for (const w of widgets) if (w.type === 'tabs' || w.type === 'section' || w.type === 'nav_bar') out.delete(w.id)
  return out
}

/** Nav bars docked to the page edges (the first per edge); the grid draws the rest. */
export function dockedBars(widgets: readonly AppWidget[]): Partial<Record<'left' | 'right' | 'top', AppWidget<'nav_bar'>>> {
  const out: Partial<Record<'left' | 'right' | 'top', AppWidget<'nav_bar'>>> = {}
  for (const w of widgets) {
    if (w.type !== 'nav_bar') continue
    const edge = (w.config as WidgetConfig<'nav_bar'>).edge
    if (!out[edge]) out[edge] = w as AppWidget<'nav_bar'>
  }
  return out
}

/** A new widget of `type` with its default config and size, and an id not in `taken`. Lists, cards and people start with auto height and a sensible title. */
export function newWidget(type: WidgetType, taken: Iterable<string>): AppWidget {
  const used = new Set(taken)
  let n = 1
  while (used.has(`${type.replace(/_/g, '-')}-${n}`)) n++
  const e = catalogEntry(type)
  const widget: AppWidget = { id: `${type.replace(/_/g, '-')}-${n}`, type, title: null, w: e.w, h: e.h, config: WIDGET_CONFIG_SCHEMAS[type].parse({}) as WidgetConfig, ...(e.bleed ? { bleed: true } : {}) }
  if (fitsContent(type)) widget.height = 'auto'
  if (needsTitle(type)) widget.title = autoTitle(widget)
  return widget
}

/* ── Sizing to content and titles ────────────────────────────────────── */

/**
 * Widgets whose card can follow its content (auto height): lists, cards,
 * people, small summaries and text. Charts, boards, calendars, grids, embeds
 * and KPI tiles fill the box they are given instead.
 */
export const FIT_CONTENT_TYPES: ReadonlySet<WidgetType> = new Set<WidgetType>([
  'actions', 'tiles', 'quick_search', 'task_list', 'my_workload', 'overdue_list', 'team_workload', 'sla', 'sla_breakdown', 'bottleneck',
  'run_status', 'recent_failures', 'start_workflow', 'my_submissions', 'record_card', 'filtered_list', 'card_view', 'pivot',
  'team_members', 'people_directory', 'recent', 'activity_feed', 'announcement', 'text', 'links',
])
export function fitsContent(type: WidgetType): boolean {
  return FIT_CONTENT_TYPES.has(type)
}

/**
 * The most rows a widget may grow to when it follows its content, or null
 * when it keeps exactly its size: `height: 'auto'` → its max_h (default
 * MAX_AUTO_ROWS); unset (saved before auto height) → shrinks to its content
 * but never grows past the size the builder gave it; `fixed` → null.
 */
export function autoHeightCap(w: Pick<AppWidget, 'type' | 'h' | 'height' | 'max_h' | 'bleed'>): number | null {
  if (!fitsContent(w.type) || w.height === 'fixed' || isBleed(w)) return null
  const e = catalogEntry(w.type)
  if (w.height === 'auto') return Math.max(e.minH, Math.min(w.max_h ?? Math.max(14, w.h), 30))
  return Math.max(e.minH, w.h)
}

/** Data widgets show a title bar; untitled ones read better with a sensible one ("My tasks", "Team queue"). */
const TITLE_EXEMPT: ReadonlySet<WidgetType> = new Set<WidgetType>(['metric', 'kpi', 'goal', 'gauge', 'form_embed'])
export function needsTitle(type: WidgetType): boolean {
  return isDataWidget(type) && !TITLE_EXEMPT.has(type)
}

const SOURCE_NOUN: Record<string, string> = { tasks: 'Tasks', runs: 'Workflow runs', submissions: 'Submissions', table_rows: 'Rows' }

/** A plain title for an untitled widget, from what it shows. */
export function autoTitle(widget: Pick<AppWidget, 'type' | 'config'>): string {
  const c = widget.config as Record<string, unknown>
  switch (widget.type) {
    case 'task_list': {
      const status = typeof c.status === 'string' ? c.status : null
      switch (c.scope) {
        case 'queue': return 'Team queue'
        case 'team': return 'Team tasks'
        case 'all': return status === 'completed' ? 'Completed tasks' : status === 'open' ? 'Open tasks' : 'Tasks'
        default: return status === 'completed' ? 'My completed tasks' : 'My tasks'
      }
    }
    case 'kanban': return 'Task board'
    case 'task_calendar': return 'Due dates'
    case 'overdue_list': return 'Overdue tasks'
    case 'team_workload': return 'Team workload'
    case 'sla': return c.source === 'runs' ? 'Workflow SLA' : 'Task SLA'
    case 'sla_breakdown': return `SLA by ${String(c.by ?? 'workflow')}`
    case 'recent': return c.source === 'runs' ? 'Recent workflow runs' : 'Recent submissions'
    case 'chart': {
      const what = SOURCE_NOUN[String(c.source)] ?? 'Tasks'
      const by = c.group_by === 'time' ? `per ${String(c.interval ?? 'day')}` : c.group_by === 'assignee' ? 'by person' : c.group_by === 'field' ? `by ${String(c.field ?? 'column')}` : `by ${String(c.group_by ?? 'status')}`
      return `${what} ${by}`
    }
    default: return catalogEntry(widget.type as WidgetType).title
  }
}

/** The title a widget shows: its own, else (for data widgets) the automatic one. */
export function widgetTitle(widget: Pick<AppWidget, 'type' | 'config' | 'title'>): string | null {
  const own = widget.title?.trim()
  if (own) return own
  return needsTitle(widget.type) ? autoTitle(widget) : null
}

/** Data widgets read through the widget data service; the rest render from their config alone. */
export const DATA_WIDGET_TYPES: readonly WidgetType[] = [
  'task_list', 'sla', 'metric', 'chart', 'table_view', 'recent',
  'kanban', 'task_calendar', 'my_workload', 'overdue_list', 'team_workload',
  'sla_trend', 'sla_breakdown', 'cycle_time', 'bottleneck', 'throughput',
  'run_status', 'recent_failures', 'run_timeline',
  'submission_trend', 'my_submissions', 'field_analytics',
  'data_grid', 'record_card', 'filtered_list', 'pivot', 'card_view',
  'kpi', 'goal', 'gauge', 'heatmap',
  'team_members', 'org_chart', 'people_directory', 'activity_feed',
]
export function isDataWidget(type: string): boolean {
  return isWidgetType(type) && DATA_WIDGET_TYPES.includes(type)
}

/* ── Page filter values and input binding ────────────────────────────── */

/** Current values of a page's filters, by filter id. */
export type FilterValues = Record<string, string | DateRangeValue | null | undefined>

export function isFilterRef(value: unknown): value is FilterRef {
  return !!value && typeof value === 'object' && typeof (value as { filter?: unknown }).filter === 'string' && Object.keys(value).length === 1
}

/** Initial values: each filter's default. */
export function defaultFilterValues(filters: readonly PageFilter[]): FilterValues {
  return Object.fromEntries(filters.map((f) => [f.id, f.default ?? null]))
}

/** URL search param for a filter (?f.<id>=…); date ranges are preset names or from..to. */
export function filterParam(id: string): string {
  return `f.${id}`
}

export function encodeFilterValue(value: FilterValues[string]): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') return value
  if ('preset' in value) return value.preset
  return `${value.from ?? ''}..${value.to ?? ''}`
}

const PRESETS: readonly string[] = DATE_PRESETS

export function decodeFilterValue(kind: PageFilter['kind'], raw: string | null | undefined): FilterValues[string] {
  if (raw === null || raw === undefined || raw === '') return null
  const value = raw.slice(0, 200)
  if (kind === 'date_range') {
    if (PRESETS.includes(value)) return { preset: value as DatePreset }
    const m = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/.exec(value)
    return m ? { from: m[1] ?? null, to: m[2] ?? null } : null
  }
  return value
}

/** Filter values from URL params over the defaults (unknown / malformed params ignored). */
export function filterValuesFromParams(filters: readonly PageFilter[], get: (name: string) => string | null): FilterValues {
  const out = defaultFilterValues(filters)
  for (const f of filters) {
    const raw = get(filterParam(f.id))
    if (raw !== null) out[f.id] = decodeFilterValue(f.kind, raw)
  }
  return out
}

/**
 * A widget config with every { filter } input replaced by that filter's
 * current value (null when the filter is missing or empty, i.e. "any").
 * The result is what the widget data service receives; it still validates
 * against the widget's schema.
 */
export function resolveBindings<T extends WidgetType>(type: T, config: WidgetConfig<T>, values: FilterValues): WidgetConfig<T> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    out[key] = isFilterRef(value) ? (values[value.filter] ?? null)
      // Row conditions: each bound value is the filter's current value (empty: the condition is skipped).
      : key === 'where' && Array.isArray(value) ? value.map((c) => (c && typeof c === 'object' && isFilterRef((c as { value?: unknown }).value) ? { ...c, value: boundText(values[(c as { value: FilterRef }).value.filter]) } : c))
      : value
  }
  const parsed = WIDGET_CONFIG_SCHEMAS[type].safeParse(out)
  if (parsed.success) return parsed.data as WidgetConfig<T>
  // A filter value that doesn't fit the input (e.g. a status in a user input): treat that input as "any".
  for (const issue of parsed.error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string') out[key] = null
  }
  const retry = WIDGET_CONFIG_SCHEMAS[type].safeParse(out)
  return (retry.success ? retry.data : WIDGET_CONFIG_SCHEMAS[type].parse({})) as WidgetConfig<T>
}

const boundText = (v: FilterValues[string]): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** Filter ids a widget's inputs bind to (row conditions included). */
export function boundFilters(config: Record<string, unknown>): string[] {
  const where = Array.isArray(config.where) ? (config.where as Array<{ value?: unknown }>).map((c) => c?.value).filter(isFilterRef) : []
  return [...Object.values(config).filter(isFilterRef), ...where].map((v) => v.filter)
}

/**
 * Row conditions → data table row filters (lib/services/data-tables.ts):
 * conditions with an empty value are skipped (is_empty / not_empty need none).
 */
export function rowFiltersOf(where: readonly RowCondition[] | null | undefined): Array<{ field: string; operator: RowCondition['op']; value?: string }> {
  const out: Array<{ field: string; operator: RowCondition['op']; value?: string }> = []
  for (const c of where ?? []) {
    if (!c?.column) continue
    if (c.op === 'is_empty' || c.op === 'not_empty') { out.push({ field: c.column, operator: c.op }); continue }
    const v = c.value
    if (v === null || v === undefined || isFilterRef(v)) continue
    const text = String(v).trim()
    if (text) out.push({ field: c.column, operator: c.op, value: text })
  }
  return out
}

/** The date a data table row counts on: its date_field value (YYYY-MM-DD…) or, without one, when it was created. */
export function rowDate(row: { created_at: string; data?: Record<string, unknown> | null }, dateField: string | null | undefined): string {
  const v = dateField ? row.data?.[dateField] : null
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(new Date(v).getTime()) ? v : row.created_at
}

/* ── Date ranges ─────────────────────────────────────────────────────── */

export interface ResolvedRange {
  from: Date | null
  to: Date | null
  /** A calendar period in progress (this month / quarter / year): "previous period" compares to-date. */
  current?: boolean
}

/** A date range value → concrete bounds (`to` exclusive), relative to `now`. */
export function resolveDateRange(value: DateRangeValue | null | undefined, now: Date = new Date()): ResolvedRange {
  if (!value) return { from: null, to: null }
  if ('preset' in value) {
    const day = 86_400_000
    switch (value.preset) {
      case '7d': return { from: new Date(now.getTime() - 7 * day), to: null }
      case '30d': return { from: new Date(now.getTime() - 30 * day), to: null }
      case '90d': return { from: new Date(now.getTime() - 90 * day), to: null }
      case '365d': return { from: new Date(now.getTime() - 365 * day), to: null }
      // Calendar periods are bounded both ends, so dated rows later in the period (a close date next week) count too.
      case 'this_month': return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)), current: true }
      case 'this_quarter': {
        const q = Math.floor(now.getUTCMonth() / 3) * 3
        return { from: new Date(Date.UTC(now.getUTCFullYear(), q, 1)), to: new Date(Date.UTC(now.getUTCFullYear(), q + 3, 1)), current: true }
      }
      case 'last_quarter': {
        const q = Math.floor(now.getUTCMonth() / 3) * 3
        return { from: new Date(Date.UTC(now.getUTCFullYear(), q - 3, 1)), to: new Date(Date.UTC(now.getUTCFullYear(), q, 1)) }
      }
      case 'this_year': return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)), current: true }
      default: return { from: null, to: null }
    }
  }
  const from = value.from ? new Date(`${value.from.slice(0, 10)}T00:00:00Z`) : null
  const to = value.to ? new Date(new Date(`${value.to.slice(0, 10)}T00:00:00Z`).getTime() + 86_400_000) : null
  return { from: from && !Number.isNaN(from.getTime()) ? from : null, to: to && !Number.isNaN(to.getTime()) ? to : null }
}

/** The period just before a range of the same length (for "vs previous period"); null for open-ended ranges. */
export function previousRange(range: ResolvedRange, now: Date = new Date()): ResolvedRange | null {
  if (!range.from) return null
  // A period in progress compares like for like: the time so far against the same length before it.
  const end = range.to && !(range.current && range.to > now) ? range.to : now
  const length = end.getTime() - range.from.getTime()
  if (length <= 0) return null
  return { from: new Date(range.from.getTime() - length), to: range.from }
}

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '365d': 'Last 12 months',
  this_month: 'This month', this_quarter: 'This quarter', last_quarter: 'Last quarter', this_year: 'This year', all: 'All time',
}

/**
 * The unit a number widget shows (metric, KPI, goal, gauge): "%" for
 * percentages, the currency code, the summed / averaged column's name
 * ("Amount"), else what it counts ("tasks", "submissions", "records") —
 * never the bare word "rows".
 */
export function metricUnitLabel(c: { source?: string; aggregate?: string; field?: string | null; format?: string; currency?: string }, unit?: string | null): string {
  if (c.format === 'percent') return '%'
  if (c.format === 'currency') return c.currency || 'USD'
  if ((c.source === 'table_rows' || c.source === 'instance') && c.aggregate && c.aggregate !== 'count' && c.field) {
    const name = c.field.replace(/[_-]+/g, ' ').trim()
    return `${c.aggregate === 'avg' ? 'Average ' : ''}${c.aggregate === 'avg' ? name.toLowerCase() : name.charAt(0).toUpperCase() + name.slice(1)}`
  }
  const u = unit || ({ tasks: 'tasks', runs: 'runs', submissions: 'submissions', table_rows: 'records' } as Record<string, string>)[c.source ?? 'tasks'] || ''
  return u === 'rows' ? 'records' : u
}
