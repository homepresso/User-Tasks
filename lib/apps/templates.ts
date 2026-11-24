import { WIDGET_CONFIG_SCHEMAS, normalisePageLayout, type AppWidget, type PageFilter, type PageLayout, type WidgetConfig, type WidgetType } from './schema'
import { autoTitle, catalogEntry, containedIds, fitsContent, needsTitle } from './widgets'

/**
 * Starter page templates, and duplicating / copying widgets and pages
 * (pure, client-safe; __tests__/apps-templates.test.ts).
 *
 * A template drops a pre-configured layout and page filters; objects
 * (forms, workflows, tables) are left for the designer to bind with the
 * pickers, so a template never points at something the designer can't see.
 */

export interface PageTemplate {
  id: string
  title: string
  description: string
  icon: string
  filters: PageFilter[]
  layout: PageLayout
}

type Spec = { type: WidgetType; id: string; w?: number; h?: number; title?: string; config?: Record<string, unknown>; bleed?: boolean }

/** A template's widgets: catalogue sizes, a title on every data widget, and auto height for lists, cards and people (they fit their content). */
function build(specs: Spec[]): PageLayout {
  return normalisePageLayout({
    widgets: specs.map((s) => {
      const e = catalogEntry(s.type)
      const config = WIDGET_CONFIG_SCHEMAS[s.type].parse(s.config ?? {})
      const title = s.title ?? (needsTitle(s.type) ? autoTitle({ type: s.type, config } as never) : null)
      return { id: s.id, type: s.type, w: s.w ?? e.w, h: s.h ?? e.h, title, config, ...(s.bleed ?? e.bleed ? { bleed: true } : {}), ...(fitsContent(s.type) ? { height: 'auto', max_h: Math.max(s.h ?? e.h, 6) } : {}) }
    }),
  })
}

export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    id: 'team_dashboard', title: 'Team dashboard', icon: 'LayoutDashboard',
    description: 'Team workload, SLA, throughput, a Kanban board and the team’s members — driven by a team filter.',
    filters: [{ id: 'team', kind: 'team', label: 'Team', default: 'my_teams' }, { id: 'period', kind: 'date_range', label: 'Period', default: { preset: '30d' } }, { id: 'person', kind: 'user', label: 'Person', default: null }],
    layout: build([
      { type: 'page_header', id: 'header' },
      { type: 'my_workload', id: 'workload', w: 4, h: 4, title: 'My workload' },
      { type: 'sla', id: 'sla', w: 4, h: 4, config: { team: { filter: 'team' } } },
      { type: 'kpi', id: 'done', w: 4, h: 4, title: 'Completed', config: { source: 'tasks', status: 'completed', team: { filter: 'team' }, date_range: { filter: 'period' } } },
      { type: 'team_workload', id: 'team-load', w: 6, h: 7, config: { team: { filter: 'team' }, click: { filter: 'person' } } },
      { type: 'throughput', id: 'throughput', w: 6, h: 7, config: { team: { filter: 'team' }, date_range: { filter: 'period' } } },
      { type: 'kanban', id: 'board', w: 12, h: 10, config: { scope: 'team', team: { filter: 'team' }, assignee: { filter: 'person' } } },
      { type: 'team_members', id: 'members', w: 12, h: 6, config: { team: { filter: 'team' } } },
    ]),
  },
  {
    id: 'requester_portal', title: 'Requester portal', icon: 'Inbox',
    description: 'Tiles to start requests, the request form on the page, and the requester’s submissions and runs.',
    filters: [],
    layout: build([
      { type: 'heading', id: 'welcome', config: { text: 'How can we help?', subtitle: 'Start a request or follow up on one you made.', level: 1 } },
      { type: 'announcement', id: 'notice', config: { html: '<p>Requests are answered within two working days.</p>', tone: 'info' } },
      { type: 'tiles', id: 'tiles', title: 'Start a request', config: { tiles: [] } },
      { type: 'form_embed', id: 'form', w: 7, h: 12, title: 'New request' },
      { type: 'my_submissions', id: 'mine', w: 5, h: 6, title: 'My requests' },
      { type: 'recent', id: 'runs', w: 5, h: 6, title: 'Progress', config: { source: 'runs', person: 'me' } },
    ]),
  },
  {
    id: 'manager_approvals', title: 'Manager approvals', icon: 'ClipboardList',
    description: 'The approval queue with a quick-view drawer, overdue items, team workload and cycle time.',
    filters: [{ id: 'workflow', kind: 'workflow', label: 'Workflow', default: null }, { id: 'person', kind: 'user', label: 'Assignee', default: null }],
    layout: build([
      { type: 'page_header', id: 'header' },
      { type: 'task_list', id: 'queue', w: 7, h: 10, title: 'Waiting for approval', config: { scope: 'queue', workflow_id: { filter: 'workflow' }, open_in: 'drawer' } },
      { type: 'overdue_list', id: 'overdue', w: 5, h: 5, config: { workflow_id: { filter: 'workflow' } } },
      { type: 'team_workload', id: 'load', w: 5, h: 5, config: { workflow_id: { filter: 'workflow' }, click: { filter: 'person' } } },
      { type: 'cycle_time', id: 'cycle', w: 6, h: 7, config: { workflow_id: { filter: 'workflow' }, assignee: { filter: 'person' } } },
      { type: 'sla_breakdown', id: 'by-person', w: 6, h: 7, config: { by: 'assignee', workflow_id: { filter: 'workflow' } } },
    ]),
  },
  {
    id: 'operations_sla', title: 'Operations SLA', icon: 'Timer',
    description: 'SLA status and trend, breakdown by workflow, bottlenecks, run status and recent failures.',
    filters: [{ id: 'workflow', kind: 'workflow', label: 'Workflow', default: null }, { id: 'period', kind: 'date_range', label: 'Period', default: { preset: '90d' } }, { id: 'status', kind: 'status', label: 'Status', default: 'all' }],
    layout: build([
      { type: 'page_header', id: 'header' },
      { type: 'sla', id: 'sla', w: 4, h: 5, config: { source: 'runs', workflow_id: { filter: 'workflow' } } },
      { type: 'gauge', id: 'on-time', w: 4, h: 5, title: 'Open tasks', config: { source: 'tasks', status: 'open', workflow_id: { filter: 'workflow' }, max: 200, warn_at: 120, danger_at: 160, higher_is_better: false } },
      { type: 'run_status', id: 'runs', w: 4, h: 5, config: { workflow_id: { filter: 'workflow' }, date_range: { filter: 'period' } } },
      { type: 'sla_trend', id: 'trend', w: 6, h: 7, config: { workflow_id: { filter: 'workflow' }, date_range: { filter: 'period' } } },
      { type: 'sla_breakdown', id: 'breakdown', w: 6, h: 7, config: { by: 'workflow', date_range: { filter: 'period' }, click: { filter: 'workflow' } } },
      { type: 'bottleneck', id: 'bottleneck', w: 6, h: 7, config: { workflow_id: { filter: 'workflow' } } },
      { type: 'recent_failures', id: 'failures', w: 6, h: 7, config: { workflow_id: { filter: 'workflow' }, date_range: { filter: 'period' } } },
      { type: 'heatmap', id: 'heatmap', w: 12, h: 6, title: 'When work arrives', config: { workflow_id: { filter: 'workflow' }, date_range: { filter: 'period' } } },
    ]),
  },
]

export function templateById(id: string): PageTemplate | undefined {
  return PAGE_TEMPLATES.find((t) => t.id === id)
}

/* ── Duplicate / copy / paste ────────────────────────────────────────── */



/** A widget id like `<type>-<n>` not in `taken`. */
export function freshId(type: WidgetType, taken: Set<string>): string {
  let n = 1
  while (taken.has(`${type.replace(/_/g, '-')}-${n}`)) n++
  return `${type.replace(/_/g, '-')}-${n}`
}

/**
 * Copies of `widgets` with new ids (not in `taken`), container child lists
 * re-pointed at the copies (children that weren't copied are dropped).
 */
export function cloneWidgets(widgets: readonly AppWidget[], taken: Iterable<string>): AppWidget[] {
  const used = new Set(taken)
  const map = new Map<string, string>()
  for (const w of widgets) {
    const id = freshId(w.type, used)
    used.add(id)
    map.set(w.id, id)
  }
  const remap = (ids: string[]) => ids.map((id) => map.get(id)).filter((id): id is string => !!id)
  return widgets.map((w) => {
    const config = structuredClone(w.config) as Record<string, unknown>
    if (w.type === 'tabs') (config as WidgetConfig<'tabs'>).tabs = (config as WidgetConfig<'tabs'>).tabs.map((t) => ({ ...t, widgets: remap(t.widgets) }))
    if (w.type === 'section') (config as WidgetConfig<'section'>).widgets = remap((config as WidgetConfig<'section'>).widgets)
    return { ...w, id: map.get(w.id)!, config: config as WidgetConfig }
  })
}

/** Duplicate one widget (a container brings its children), placed right after it. */
export function duplicateWidget(widgets: readonly AppWidget[], id: string): { widgets: AppWidget[]; copyId: string | null } {
  const i = widgets.findIndex((w) => w.id === id)
  if (i < 0) return { widgets: [...widgets], copyId: null }
  const group = withChildren(widgets, [id])
  const copies = cloneWidgets(group, widgets.map((w) => w.id))
  const out = [...widgets]
  out.splice(i + 1, 0, ...copies)
  return { widgets: out, copyId: copies[0]?.id ?? null }
}

/** The widgets with these ids plus the children of any container among them, in page order. */
export function withChildren(widgets: readonly AppWidget[], ids: readonly string[]): AppWidget[] {
  const want = new Set(ids)
  for (const w of widgets) {
    if (!want.has(w.id)) continue
    if (w.type === 'tabs') for (const t of (w.config as WidgetConfig<'tabs'>).tabs) for (const c of t.widgets) want.add(c)
    if (w.type === 'section') for (const c of (w.config as WidgetConfig<'section'>).widgets) want.add(c)
  }
  return widgets.filter((w) => want.has(w.id))
}

/** The clipboard payload for copying widgets between pages (and apps). */
export const CLIPBOARD_KIND = 'usertasks/app-widgets@1'
export function clipboardPayload(widgets: readonly AppWidget[], ids: readonly string[]): string {
  return JSON.stringify({ kind: CLIPBOARD_KIND, widgets: withChildren(widgets, ids) })
}

/** Paste: validate the payload (invalid widgets dropped), give the copies new ids. Null when it isn't ours. */
export function pasteWidgets(raw: string, existing: readonly AppWidget[]): AppWidget[] | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object' || (value as { kind?: unknown }).kind !== CLIPBOARD_KIND) return null
  const layout = normalisePageLayout({ widgets: (value as { widgets?: unknown }).widgets })
  return cloneWidgets(layout.widgets, existing.map((w) => w.id))
}

/** Widgets the grid draws (not inside a container). */
export function gridWidgets(widgets: readonly AppWidget[]): AppWidget[] {
  const inside = containedIds(widgets)
  return widgets.filter((w) => !inside.has(w.id))
}


