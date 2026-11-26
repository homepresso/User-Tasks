/**
 * App widget data (Phase 1): what each data widget on an app page shows,
 * read AS THE VIEWER. Called by the ui-read apps.widget
 * (lib/services/ui-reads/apps.ts) for the signed-in person, on their
 * session client: RLS applies, and on top of it the same permission scoping
 * the rest of the product uses —
 *
 *  - tasks: tasks.view_all sees every task of the workspace; otherwise only
 *    tasks assigned to them or queued for a team they are in (tasks.view_own).
 *  - workflow runs: lib/services/run-visibility.ts (view_runs: all; view_queue:
 *    runs they are involved in or hold a View grant on); neither: the runs
 *    they started.
 *  - form submissions: forms.edit sees all; otherwise their own (as the
 *    form_submissions RLS policy).
 *  - data tables: lib/services/data-tables.ts (data.view, the table's own checks).
 *  - every query is pinned to ctx.tenantId.
 *
 * The widget config comes from the stored page (never the browser), except
 * for an app's editors previewing unsaved changes in the builder; either way
 * the reads stay inside the viewer's own access, so a config can never widen
 * what someone sees. Bindings to page filters are resolved before the read
 * (lib/apps/widgets.ts resolveBindings).
 */

import {
  WIDGET_CONFIG_SCHEMAS, isWidgetType,
  type AppWidget, type DataSource, type RowCondition, type WidgetConfig, type WidgetType,
} from '@/lib/apps/schema'
import { isDataWidget, previousRange, resolveBindings, resolveDateRange, rowDate, rowFiltersOf, type FilterValues, type ResolvedRange } from '@/lib/apps/widgets'
import { OPEN_TASK_STATUSES } from '@/lib/home/progress'
import { getDb, hasPerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError } from './_shared'
import { getAppAccess, getPresentedPage, getViewerAppRole, type PreviewOptions } from './apps'
import { MORE_TYPES, actionBadges, moreWidgetData, type MoreWidgetData, type WidgetExtra, type WidgetParams } from './app-widgets-more'
import { myTeams, shapeTasks, TASK_COLUMNS, type HomeTask } from './home'
import { resolveRunScope, runScopeFilter } from './run-visibility'
import { getDataTable, queryRows, type RowFilter } from './data-tables'
import { rollupFacts, withWidgetDataSource } from './app-widget-rollups'
import { recordQueryTiming, resolveDataSource } from '@/lib/reports/data-source'

import { INSTANCE_FACT_LABELS, isInstanceFactDataset } from '@/lib/instance-admin/schema'
import { instanceFacts } from './instance-admin'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows and joins */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_MATCH = '00000000-0000-0000-0000-000000000000'
/**
 * Most rows the database returns for one read: PostgREST max_rows (1,000 on
 * Supabase unless changed), mirrored by DB_MAX_ROWS for the in-process
 * provider (0 = no cap). A larger .limit() is silently cut to it.
 */
export function serverRowCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DB_MAX_ROWS
  if (raw === undefined || raw === '') return 1000
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Number.POSITIVE_INFINITY
}
/**
 * Most rows a chart / sum / SLA widget aggregates in memory: 5,000, but never
 * more than the server returns, so `truncated` (rows.length >= cap) is true
 * when rows were cut. It was 5,000 against a 1,000-row server cap: widgets
 * silently counted the first 1,000 rows and never said so.
 */
export const AGGREGATE_ROW_CAP = Math.min(5000, serverRowCap())

export type WidgetTask = HomeTask

export type WidgetData = MoreWidgetData
  | { type: 'task_list'; tasks: WidgetTask[]; total: number; note?: string }
  | { type: 'sla'; source: 'tasks' | 'runs'; on_track: number; at_risk: number; breached: number; no_sla: number; total: number; breakdown: Array<{ label: string; on_track: number; at_risk: number; breached: number }>; truncated: boolean }
  | { type: 'metric'; value: number | null; previous: number | null; change_pct: number | null; unit: string; truncated: boolean }
  | { type: 'chart'; points: Array<{ key: string; label: string; value: number; values?: Record<string, number> }>; series?: Array<{ key: string; label: string }>; scatter?: Array<{ x: number; y: number; label: string }>; value_label: string; group_by: string; interval: string; truncated: boolean }
  | { type: 'table_view'; kind: 'data_table'; table: { id: string; name: string }; columns: Array<{ key: string; label: string; type: string }>; rows: Array<{ id: string; data: Record<string, unknown>; created_at: string }>; total: number }
  | { type: 'table_view'; kind: 'report'; report_id: string }
  | { type: 'recent'; source: 'submissions' | 'runs'; items: Array<{ id: string; title: string; subtitle: string | null; at: string; status: string | null; href: string | null }> }
  | { type: 'empty'; reason: string }

export interface WidgetDataRequest {
  app: string
  page: string
  widget_id: string
  filters?: FilterValues
  /** Builder preview: the unsaved widget (editors only). */
  preview?: { type: string; config: unknown } | null
  /** Per-read view state: search text, page, month (validated per widget). */
  params?: WidgetParams
  /** Editors: read the widget from the DRAFT (the builder and Preview), optionally as a lower app role. */
  draft?: boolean | null
  as_role?: 'viewer' | 'contributor' | null
}

/** Data for one widget of a page, for the signed-in viewer. */
export async function getWidgetData(ctx: ServiceContext, input: WidgetDataRequest): Promise<WidgetData> {
  if (ctx.authKind !== 'session') throw ServiceError.forbidden('Widget data is read in the app as the signed-in person')
  // The page as this viewer may see it: a widget hidden from them (an object they can't use) is not found.
  // The builder's unsaved widgets live on the draft page; Preview reads the draft; everyone else the published page.
  const preview: PreviewOptions = { draft: !!(input.draft || input.preview), as_role: input.as_role ?? null }
  const page = await getPresentedPage(ctx, input.app, input.page, preview)
  let widget = page.layout.widgets.find((w) => w.id === input.widget_id) as AppWidget | undefined
  if (input.preview) {
    if ((await getAppAccess(ctx, input.app)) !== 'edit') throw ServiceError.forbidden('Only the app’s editors can preview unsaved widgets')
    if (!isWidgetType(input.preview.type)) throw ServiceError.validation('Unknown widget type')
    const parsed = WIDGET_CONFIG_SCHEMAS[input.preview.type].safeParse(input.preview.config ?? {})
    if (!parsed.success) throw ServiceError.validation(`Invalid widget settings: ${parsed.error.issues[0]?.message ?? 'check the fields'}`)
    widget = { id: input.widget_id, type: input.preview.type, w: 1, h: 1, config: parsed.data as WidgetConfig }
  }
  if (!widget) throw ServiceError.notFound('Widget not found')
  if (widget.type === 'actions') return actionBadges(ctx, widget.config as WidgetConfig<'actions'>)
  if (widget.type === 'tabs') {
    // A data table tab: its rows, read as the viewer (the tab was dropped server-side if they can't read the table).
    const tab = (widget.config as WidgetConfig<'tabs'>).tabs[Number(input.params?.tab ?? -1)]
    if (tab?.target?.kind !== 'table') return { type: 'empty', reason: 'This tab has no data' }
    return tableView(ctx, { kind: 'data_table', table_id: tab.target.table_id, report_id: null, columns: [], limit: 50 } as WidgetConfig<'table_view'>)
  }
  if (!isDataWidget(widget.type)) return { type: 'empty', reason: 'This widget has no data' }
  const config = resolveBindings(widget.type, widget.config as WidgetConfig, input.filters ?? {})
  const role = await getViewerAppRole(ctx, input.app, preview)
  // Settings → Query: workspace → App widgets → this app → this widget (when allowed).
  const wctx = withWidgetDataSource(ctx, await resolveDataSource(ctx, { service: 'app_widgets', appId: page.app_id, widgetMode: widget.data_source ?? null }))
  return widgetData(wctx, widget.type, config, { params: input.params ?? {}, filters: input.filters ?? {}, role, widgetKey: `${input.app}:${input.page}:${input.widget_id}`, preview: !!input.preview })
}

/** Data for a resolved widget config (exported for tests). */
export async function widgetData(ctx: ServiceContext, type: WidgetType, config: WidgetConfig, extra: WidgetExtra = { params: {}, filters: {}, role: 'viewer', widgetKey: '', preview: false }): Promise<WidgetData> {
  if (MORE_TYPES.has(type)) return moreWidgetData(ctx, type, config, extra)
  switch (type) {
    case 'task_list': return taskList(ctx, config as WidgetConfig<'task_list'>)
    case 'sla': return sla(ctx, config as WidgetConfig<'sla'>)
    case 'metric': return metric(ctx, config as WidgetConfig<'metric'>)
    case 'chart': return chart(ctx, config as WidgetConfig<'chart'>)
    case 'table_view': return tableView(ctx, config as WidgetConfig<'table_view'>)
    case 'recent': return recent(ctx, config as WidgetConfig<'recent'>)
    default: return { type: 'empty', reason: 'This widget has no data' }
  }
}

/* ── Scoping ─────────────────────────────────────────────────────────── */

export const me = (ctx: ServiceContext) => {
  if (!ctx.actorId || !UUID_RE.test(ctx.actorId)) throw ServiceError.forbidden('Sign in to see this')
  return ctx.actorId
}
export const asId = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null)

export interface Common {
  assignee?: unknown
  team?: unknown
  form_id?: unknown
  workflow_id?: unknown
  table_id?: unknown
  status?: unknown
  date_range?: unknown
  /** Data table rows: row conditions and the date column (lib/apps/schema.ts rowScope). */
  where?: RowCondition[] | null
  date_field?: string | null
  /** The "UserTasks instance" source: the fact dataset and an optional workspace. */
  dataset?: string | null
  instance_workspace?: unknown
}

/** Sources whose facts carry numbers (sum / average a field): data table rows and the UserTasks instance. */
export const aggregatable = (source: DataSource) => source === 'table_rows' || source === 'instance'

export function rangeOf(config: Common): ResolvedRange {
  const value = config.date_range
  return value && typeof value === 'object' ? resolveDateRange(value as any) : { from: null, to: null }
}

export function withRange(query: any, column: string, range: ResolvedRange): any {
  let q = query
  if (range.from) q = q.gte(column, range.from.toISOString())
  if (range.to) q = q.lt(column, range.to.toISOString())
  return q
}

export interface TaskScope { all: boolean; userId: string; teams: string[] }

export async function taskScope(ctx: ServiceContext, db: AnySupabaseClient): Promise<TaskScope> {
  const userId = me(ctx)
  const all = hasPerm(ctx, 'tasks.view_all')
  if (!all && !hasPerm(ctx, 'tasks.view_own')) throw ServiceError.forbidden('You don’t have access to tasks')
  const teams = (await myTeams(db, ctx.tenantId, userId)).filter((t) => UUID_RE.test(t))
  return { all, userId, teams }
}

/** Visible tasks matching the widget's inputs (a PostgREST query, not yet ranged). */
export function tasksQuery(ctx: ServiceContext, db: AnySupabaseClient, scope: TaskScope, config: Common & { scope?: string }, columns: string, opts: { count?: boolean } = {}): any {
  let q = (db as any).from('tasks').select(columns, opts.count ? { count: 'exact' } : undefined)
    .eq('tenant_id', ctx.tenantId).is('deleted_at', null).is('parent_task_id', null)
  // What the viewer may see at all.
  if (!scope.all) {
    const parts = [`assignee_id.eq.${scope.userId}`]
    if (scope.teams.length) parts.push(`assigned_team_id.in.(${scope.teams.join(',')})`)
    q = q.or(parts.join(','))
  }
  // What the widget asks for.
  const listScope = config.scope ?? 'all'
  if (listScope === 'mine') q = q.eq('assignee_id', scope.userId)
  const assignee = config.assignee === 'me' ? scope.userId : asId(config.assignee)
  if (assignee) q = q.eq('assignee_id', assignee)
  if (listScope === 'team' || config.team) {
    const teams = config.team === 'my_teams' || (!config.team && listScope === 'team') ? scope.teams : [asId(config.team)].filter((t): t is string => !!t)
    q = teams.length ? q.in('assigned_team_id', teams) : q.eq('id', NO_MATCH)
  }
  const workflow = asId(config.workflow_id)
  if (workflow) q = q.eq('workflow_id', workflow)
  const status = typeof config.status === 'string' ? config.status : 'open'
  if (status === 'open') q = q.in('status', [...OPEN_TASK_STATUSES])
  else if (status === 'completed') q = q.eq('status', 'completed')
  return withRange(q, 'created_at', rangeOf(config))
}

export interface RunAccess { filter: string | null }

/** Runs the viewer may see: run-visibility, or just the ones they started. */
export async function runAccess(ctx: ServiceContext): Promise<RunAccess> {
  const userId = me(ctx)
  if (!hasPerm(ctx, 'workflows.view_runs') && !hasPerm(ctx, 'workflows.view_queue')) return { filter: `started_by.eq.${userId}` }
  return { filter: runScopeFilter(await resolveRunScope(ctx)) }
}

export function runsQuery(ctx: ServiceContext, db: AnySupabaseClient, access: RunAccess, config: Common & { person?: unknown }, columns: string, opts: { count?: boolean } = {}): any {
  let q = (db as any).from('workflow_runs').select(columns, opts.count ? { count: 'exact' } : undefined).eq('tenant_id', ctx.tenantId)
  if (access.filter) q = q.or(access.filter)
  const workflow = asId(config.workflow_id)
  if (workflow) q = q.eq('workflow_id', workflow)
  const person = config.person === 'me' || config.assignee === 'me' ? ctx.actorId : asId(config.person ?? config.assignee)
  if (person) q = q.eq('started_by', person)
  const status = typeof config.status === 'string' ? config.status : 'all'
  if (status === 'open') q = q.in('status', ['running', 'waiting_for_event', 'paused', 'pending'])
  else if (status === 'completed') q = q.eq('status', 'completed')
  return withRange(q, 'started_at', rangeOf(config))
}

export function submissionsQuery(ctx: ServiceContext, db: AnySupabaseClient, config: Common & { person?: unknown }, columns: string, opts: { count?: boolean } = {}): any {
  const userId = me(ctx)
  let q = (db as any).from('form_submissions').select(columns, opts.count ? { count: 'exact' } : undefined).eq('tenant_id', ctx.tenantId)
  if (!hasPerm(ctx, 'forms.edit')) q = q.eq('submitted_by', userId)
  const form = asId(config.form_id)
  if (form) q = q.eq('form_id', form)
  const person = config.person === 'me' || config.assignee === 'me' ? userId : asId(config.person ?? config.assignee)
  if (person) q = q.eq('submitted_by', person)
  return withRange(q, 'created_at', rangeOf(config))
}

/* ── Task list ───────────────────────────────────────────────────────── */

async function taskList(ctx: ServiceContext, config: WidgetConfig<'task_list'>): Promise<WidgetData> {
  const db = getDb(ctx)
  const scope = await taskScope(ctx, db)
  let q = tasksQuery(ctx, db, scope, config, `${TASK_COLUMNS}, assignee_id`, { count: true })
  if (config.scope === 'queue') {
    // Waiting for someone in my teams to claim (unassigned team tasks) or for my acceptance.
    const parts = [`and(assignee_id.eq.${scope.userId},acceptance_status.eq.pending)`]
    if (scope.teams.length) parts.push(`and(assignee_id.is.null,assigned_team_id.in.(${scope.teams.join(',')}))`)
    q = q.or(parts.join(','))
  }
  const { data, count, error } = await q.order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).order('id').range(0, config.limit - 1)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const shaped = await shapeTasks(db, ctx.tenantId, rows)
  const teams = new Set(scope.teams)
  return {
    type: 'task_list',
    total: count ?? rows.length,
    tasks: shaped.map((task, i) => ({
      ...task,
      action: config.show_claim && !rows[i].assignee_id && rows[i].assigned_team_id && teams.has(rows[i].assigned_team_id) && hasPerm(ctx, 'tasks.complete') ? 'claim' as const : undefined,
    })),
    ...(config.scope === 'all' && !scope.all ? { note: 'Showing the tasks you can see (yours and your teams’).' } : {}),
  }
}

/* ── SLA ─────────────────────────────────────────────────────────────── */

type SlaBucket = 'on_track' | 'at_risk' | 'breached' | 'no_sla'

/** One open item's SLA bucket: its run's SLA status first, else its due date. */
export function slaBucket(input: { due: string | null; slaStatus?: string | null }, atRiskHours: number, now = Date.now()): SlaBucket {
  if (input.slaStatus === 'breached') return 'breached'
  if (input.slaStatus === 'warning') return 'at_risk'
  if (!input.due) return input.slaStatus === 'on_track' ? 'on_track' : 'no_sla'
  const due = new Date(input.due).getTime()
  if (Number.isNaN(due)) return 'no_sla'
  if (due < now) return 'breached'
  if (due - now <= atRiskHours * 3_600_000) return 'at_risk'
  return 'on_track'
}

export async function workflowNames(db: AnySupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  const { data } = await (db as any).from('workflows').select('id, name').eq('tenant_id', tenantId).in('id', unique)
  for (const w of (data ?? []) as any[]) out.set(w.id, String(w.name ?? 'Workflow'))
  return out
}

export async function formNames(db: AnySupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  const { data } = await (db as any).from('forms').select('id, name').eq('tenant_id', tenantId).in('id', unique)
  for (const f of (data ?? []) as any[]) out.set(f.id, String(f.name ?? 'Form'))
  return out
}

export async function personNames(db: AnySupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  const { data } = await (db as any).from('users').select('id, display_name, email').in('id', unique)
  for (const u of (data ?? []) as any[]) out.set(u.id, String(u.display_name || (u.email ? String(u.email).split('@')[0] : '') || 'Someone'))
  return out
}

async function sla(ctx: ServiceContext, config: WidgetConfig<'sla'>): Promise<WidgetData> {
  const db = getDb(ctx)
  const counts: Record<SlaBucket, number> = { on_track: 0, at_risk: 0, breached: 0, no_sla: 0 }
  const byGroup = new Map<string, Record<SlaBucket, number>>()
  const add = (group: string | null, bucket: SlaBucket) => {
    counts[bucket]++
    if (!group) return
    const g = byGroup.get(group) ?? { on_track: 0, at_risk: 0, breached: 0, no_sla: 0 }
    g[bucket]++
    byGroup.set(group, g)
  }
  let truncated = false
  if (config.source === 'runs') {
    const access = await runAccess(ctx)
    const { data, error } = await runsQuery(ctx, db, access, { ...config, status: 'open' }, 'id, workflow_id, sla_status, sla_due_at').limit(AGGREGATE_ROW_CAP)
    if (error) throw dbError(error)
    const rows = (data ?? []) as any[]
    truncated = rows.length >= AGGREGATE_ROW_CAP
    for (const r of rows) add(r.workflow_id, slaBucket({ due: r.sla_due_at ?? null, slaStatus: r.sla_status === 'none' ? null : r.sla_status }, config.at_risk_hours))
  } else {
    const scope = await taskScope(ctx, db)
    const { data, error } = await tasksQuery(ctx, db, scope, { ...config, status: 'open' }, 'id, due_date, workflow_id, workflow_run_id').limit(AGGREGATE_ROW_CAP)
    if (error) throw dbError(error)
    const rows = (data ?? []) as any[]
    truncated = rows.length >= AGGREGATE_ROW_CAP
    const runIds = [...new Set(rows.map((r) => r.workflow_run_id).filter((id) => UUID_RE.test(String(id))))]
    const runSla = new Map<string, string>()
    for (let i = 0; i < runIds.length; i += 200) {
      const { data: runs } = await (db as any).from('workflow_runs').select('id, sla_status').eq('tenant_id', ctx.tenantId).in('id', runIds.slice(i, i + 200))
      for (const r of (runs ?? []) as any[]) if (r.sla_status && r.sla_status !== 'none') runSla.set(r.id, r.sla_status)
    }
    for (const r of rows) add(r.workflow_id, slaBucket({ due: r.due_date ?? null, slaStatus: r.workflow_run_id ? runSla.get(r.workflow_run_id) : null }, config.at_risk_hours))
  }
  const names = await workflowNames(db, ctx.tenantId, [...byGroup.keys()])
  const breakdown = [...byGroup.entries()]
    .map(([id, g]) => ({ label: names.get(id) ?? 'Other', on_track: g.on_track, at_risk: g.at_risk, breached: g.breached }))
    .sort((a, b) => (b.breached - a.breached) || (b.at_risk - a.at_risk) || (b.on_track - a.on_track))
    .slice(0, 6)
  return { type: 'sla', source: config.source, ...counts, total: counts.on_track + counts.at_risk + counts.breached + counts.no_sla, breakdown, truncated }
}

/* ── Rows for metrics and charts ─────────────────────────────────────── */

/** One row (or, from the report rollups, `n` rows that share every field — at is then a UTC day start). */
export interface Fact { at: string; status: string | null; workflow: string | null; form: string | null; person: string | null; data: Record<string, unknown> | null; n?: number }

/** How many rows a fact stands for. */
export const weightOf = (f: Fact) => f.n ?? 1

/**
 * The rows a metric / chart aggregates, as plain facts (capped at
 * AGGREGATE_ROW_CAP). With `opts.dims` (the dimensions the caller groups
 * by), the report rollups answer when they can (app-widget-rollups.ts):
 * weighted facts, never truncated.
 */
export async function facts(ctx: ServiceContext, source: DataSource, config: Common, range: ResolvedRange, opts: { dims?: readonly string[] } = {}): Promise<{ rows: Fact[]; truncated: boolean }> {
  if (opts.dims) {
    const rolled = await rollupFacts(ctx, source, config, range, opts.dims)
    if (rolled) return rolled
    if (source !== 'table_rows') {
      const t0 = performance.now()
      const live = await factRows(ctx, source, config, range)
      recordQueryTiming(ctx.tenantId, 'app_widgets', 'live', performance.now() - t0)
      return live
    }
  }
  return factRows(ctx, source, config, range)
}

async function factRows(ctx: ServiceContext, source: DataSource, config: Common, range: ResolvedRange): Promise<{ rows: Fact[]; truncated: boolean }> {
  const db = getDb(ctx)
  const scoped = { ...config, date_range: null }
  let rows: Fact[] = []
  if (source === 'tasks') {
    const scope = await taskScope(ctx, db)
    const { data, error } = await withRange(tasksQuery(ctx, db, scope, { ...scoped, status: config.status ?? 'all' }, 'id, created_at, status, workflow_id, assignee_id'), 'created_at', range)
      .order('created_at', { ascending: false }).limit(AGGREGATE_ROW_CAP)
    if (error) throw dbError(error)
    rows = ((data ?? []) as any[]).map((r) => ({ at: r.created_at, status: r.status, workflow: r.workflow_id, form: null, person: r.assignee_id, data: null }))
  } else if (source === 'runs') {
    const access = await runAccess(ctx)
    const { data, error } = await withRange(runsQuery(ctx, db, access, scoped, 'id, started_at, status, workflow_id, started_by'), 'started_at', range)
      .order('started_at', { ascending: false }).limit(AGGREGATE_ROW_CAP)
    if (error) throw dbError(error)
    rows = ((data ?? []) as any[]).map((r) => ({ at: r.started_at, status: r.status, workflow: r.workflow_id, form: null, person: r.started_by, data: null }))
  } else if (source === 'instance') {
    // Instance admins only (403 with an access message for anyone else).
    if (!isInstanceFactDataset(config.dataset)) return { rows: [], truncated: false }
    const got = await instanceFacts(ctx, config.dataset, { from: range.from ?? null, to: range.to ?? null }, { workspaceId: asId(config.instance_workspace), refusal: 'forbidden' })
    // Row conditions on the facts' fields (e.g. status equals failed).
    const conditions = rowFiltersOf(config.where)
    return conditions.length ? { rows: got.rows.filter((f) => conditions.every((c) => instanceFactMatches(f.data?.[c.field], c.operator, c.value))), truncated: got.truncated } : got
  } else if (source === 'submissions') {
    const { data, error } = await withRange(submissionsQuery(ctx, db, scoped, 'id, created_at, form_id, submitted_by, outcome'), 'created_at', range)
      .order('created_at', { ascending: false }).limit(AGGREGATE_ROW_CAP)
    if (error) throw dbError(error)
    rows = ((data ?? []) as any[]).map((r) => ({ at: r.created_at, status: r.outcome ?? null, workflow: null, form: r.form_id, person: r.submitted_by, data: null }))
  } else {
    const tableId = asId(config.table_id)
    if (!tableId) return { rows: [], truncated: false }
    const filters = rowFiltersOf(config.where) as RowFilter[]
    const result = await queryRows(ctx, tableId, filters.length ? { filters } : {}, { limit: AGGREGATE_ROW_CAP, offset: 0 })
    rows = (result.rows as any[])
      .map((r) => ({ at: rowDate(r, config.date_field), status: null, workflow: null, form: null, person: r.created_by ?? null, data: (r.data ?? {}) as Record<string, unknown> }))
      .filter((r) => (!range.from || new Date(r.at) >= range.from) && (!range.to || new Date(r.at) < range.to))
    return { rows, truncated: result.total > AGGREGATE_ROW_CAP || !!result.truncated }
  }
  return { rows, truncated: rows.length >= AGGREGATE_ROW_CAP }
}

/** A UserTasks instance fact field against a row condition (equals / contains / compare / empty). */
export function instanceFactMatches(v: unknown, op: string, value?: string): boolean {
  const text = v === null || v === undefined ? '' : String(v)
  const n = Number(text); const m = Number(value)
  switch (op) {
    case 'equals': return text.toLowerCase() === String(value ?? '').toLowerCase()
    case 'not_equals': return text.toLowerCase() !== String(value ?? '').toLowerCase()
    case 'contains': return text.toLowerCase().includes(String(value ?? '').toLowerCase())
    case 'starts_with': return text.toLowerCase().startsWith(String(value ?? '').toLowerCase())
    case 'gt': return n > m
    case 'gte': return n >= m
    case 'lt': return n < m
    case 'lte': return n <= m
    case 'is_empty': return text === ''
    case 'not_empty': return text !== ''
    default: return true
  }
}

export const numberOf = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** count / sum / avg of facts (sum and avg read a data table column; other sources count). */
export function aggregate(rows: readonly Fact[], how: 'count' | 'sum' | 'avg', field?: string | null): number | null {
  if (how === 'count' || !field) return rows.reduce((n, r) => n + weightOf(r), 0)
  const values = rows.map((r) => numberOf(r.data?.[field])).filter((n): n is number => n !== null)
  if (!values.length) return how === 'sum' ? 0 : null
  const sum = values.reduce((a, b) => a + b, 0)
  return how === 'sum' ? sum : sum / values.length
}

async function metric(ctx: ServiceContext, config: WidgetConfig<'metric'>): Promise<WidgetData> {
  const range = rangeOf(config)
  const how = aggregatable(config.source) ? config.aggregate : 'count'
  const current = await facts(ctx, config.source, config, range, { dims: [] })
  const value = aggregate(current.rows, how, config.field)
  let previous: number | null = null
  let change: number | null = null
  const prev = config.compare_previous ? previousRange(range) : null
  if (prev) {
    const before = await facts(ctx, config.source, config, prev, { dims: [] })
    previous = aggregate(before.rows, how, config.field)
    change = previous && value !== null ? ((value - previous) / Math.abs(previous)) * 100 : null
  }
  const unit = { tasks: 'tasks', runs: 'runs', submissions: 'submissions', table_rows: 'rows', instance: config.dataset ? (INSTANCE_FACT_LABELS[config.dataset as keyof typeof INSTANCE_FACT_LABELS] ?? 'items').toLowerCase() : 'items' }[config.source]
  return { type: 'metric', value, previous, change_pct: change, unit, truncated: current.truncated }
}

/* ── Chart ───────────────────────────────────────────────────────────── */

/** The bucket key of a date for an interval (UTC): YYYY-MM-DD (day, week's Monday) or YYYY-MM. */
export function timeKey(at: string, interval: 'day' | 'week' | 'month'): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return 'unknown'
  if (interval === 'month') return d.toISOString().slice(0, 7)
  if (interval === 'week') {
    const day = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - day)
  }
  return d.toISOString().slice(0, 10)
}

/** A column value that names a period (2026, 2026-03, 2026-03-15, 2026-Q1, 2026-H2, FY2027, FY2027-Q3): such groups read in time order. */
export const PERIOD_KEY_RE = /^(FY)?\d{4}(-(Q[1-4]|H[12]|\d{2}(-\d{2})?))?$/i
/** Are these group keys all periods (blank '—' aside)? */
export function arePeriodKeys(keys: readonly string[]): boolean {
  const named = keys.filter((k) => k !== '—' && k !== '__other')
  return named.length > 0 && named.every((k) => PERIOD_KEY_RE.test(k))
}

/** Group facts into chart points: time buckets (and period-named column values) in order, other groups largest first (the rest as "Other"). */
export function groupFacts(rows: readonly Fact[], opts: { by: WidgetConfig<'chart'>['group_by']; field?: string | null; interval: 'day' | 'week' | 'month'; how: 'count' | 'sum' | 'avg'; valueField?: string | null; maxGroups: number; byLabel?: boolean }): Array<{ key: string; value: number }> {
  const groups = new Map<string, Fact[]>()
  for (const r of rows) {
    const key = opts.by === 'time' ? timeKey(r.at, opts.interval)
      : opts.by === 'status' ? (r.status ?? 'none')
      : opts.by === 'workflow' ? (r.workflow ?? 'none')
      : opts.by === 'form' ? (r.form ?? 'none')
      : opts.by === 'assignee' ? (r.person ?? 'none')
      : String(r.data?.[opts.field ?? ''] ?? '—')
    const list = groups.get(key) ?? []
    list.push(r)
    groups.set(key, list)
  }
  const points = [...groups.entries()].map(([key, list]) => ({ key, value: aggregate(list, opts.how, opts.valueField) ?? 0 }))
  if (opts.by === 'time' || (opts.by === 'field' && arePeriodKeys(points.map((p) => p.key)))) return points.sort((a, b) => a.key.localeCompare(b.key)).slice(-60)
  // A line or area over a column reads left to right: its groups in natural order (Q1, Q2, Q3), not largest first.
  if (opts.byLabel) points.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
  else points.sort((a, b) => b.value - a.value)
  if (points.length <= opts.maxGroups) return points
  const head = points.slice(0, opts.maxGroups - 1)
  const rest = points.slice(opts.maxGroups - 1).reduce((sum, p) => sum + p.value, 0)
  return [...head, { key: '__other', value: rest }]
}

async function chart(ctx: ServiceContext, config: WidgetConfig<'chart'>): Promise<WidgetData> {
  const range = rangeOf(config)
  const how = aggregatable(config.source) ? config.aggregate : 'count'
  // A second column as the series (series_field) lets group and series both be columns.
  const seriesField = config.series_by === 'field' ? (config.series_field || config.field) : null
  const distinctSeries = config.series_by !== config.group_by || (config.series_by === 'field' && !!config.series_field && config.series_field !== config.field)
  const stacked = (config.chart === 'stacked_bar' || config.chart === 'combo') && config.series_by !== 'none' && distinctSeries
  const dims = config.chart === 'scatter' ? undefined : [config.group_by, ...(stacked ? [config.series_by] : [])]
  const { rows, truncated } = await facts(ctx, config.source, config, range, { dims })
  const db = getDb(ctx)
  const base = { group_by: config.group_by, interval: config.interval, truncated }
  if (config.chart === 'scatter') {
    // Two numeric columns of data table rows: value_field (x) against y_field (y).
    const scatter = rows.map((r) => ({ x: numberOf(r.data?.[config.value_field ?? '']), y: numberOf(r.data?.[config.y_field ?? '']), label: String(r.data?.[config.field ?? ''] ?? '') }))
      .filter((p): p is { x: number; y: number; label: string } => p.x !== null && p.y !== null).slice(0, 1000)
    return { type: 'chart', points: [], scatter, value_label: config.y_field ?? 'y', ...base }
  }
  const points = groupFacts(rows, { by: config.group_by, field: config.field, interval: config.interval, how, valueField: config.value_field, maxGroups: config.max_groups, byLabel: (config.chart === 'line' || config.chart === 'area') && config.group_by === 'field' })
  const namesFor = async (by: string, ids: string[]) => by === 'workflow' ? workflowNames(db, ctx.tenantId, ids)
    : by === 'form' ? formNames(db, ctx.tenantId, ids)
    : by === 'assignee' ? personNames(db, ids)
    : new Map<string, string>()
  const labeller = (by: string, names: Map<string, string>) => (key: string) => key === '__other' ? 'Other' : key === 'none' ? (by === 'assignee' ? 'Unassigned' : 'None') : by === 'time' ? timeLabel(key, config.interval) : names.get(key) ?? key.replace(/_/g, ' ')
  const label = labeller(config.group_by, await namesFor(config.group_by, points.map((p) => p.key)))
  const valueLabel = how === 'count' ? { tasks: 'Tasks', runs: 'Runs', submissions: 'Submissions', table_rows: 'Rows', instance: config.dataset ? (INSTANCE_FACT_LABELS[config.dataset as keyof typeof INSTANCE_FACT_LABELS] ?? 'Count') : 'Count' }[config.source] : `${how === 'sum' ? 'Sum' : 'Average'} of ${config.value_field ?? 'value'}`
  let shaped = points.map((p) => ({ key: p.key, label: label(p.key), value: Math.round(p.value * 100) / 100 }))
  if (config.sort_by === 'choices' && config.source === 'table_rows' && config.group_by === 'field' && config.field) shaped = await inChoiceOrder(ctx, asId(config.table_id), config.field, shaped)
  if (stacked) {
    const seriesPoints = groupFacts(rows, { by: config.series_by as Exclude<typeof config.series_by, 'none'>, field: seriesField ?? config.field, interval: config.interval, how: 'count', maxGroups: 6 })
    const top = new Set(seriesPoints.map((p) => p.key))
    const seriesKey = (r: Fact) => {
      const k = config.series_by === 'status' ? (r.status ?? 'none') : config.series_by === 'workflow' ? (r.workflow ?? 'none') : config.series_by === 'form' ? (r.form ?? 'none') : config.series_by === 'assignee' ? (r.person ?? 'none') : config.series_by === 'time' ? timeKey(r.at, config.interval) : String(r.data?.[seriesField ?? config.field ?? ''] ?? '—')
      return top.has(k) ? k : '__other'
    }
    const groupKey = (r: Fact) => (config.group_by === 'time' ? timeKey(r.at, config.interval) : config.group_by === 'status' ? (r.status ?? 'none') : config.group_by === 'workflow' ? (r.workflow ?? 'none') : config.group_by === 'form' ? (r.form ?? 'none') : config.group_by === 'assignee' ? (r.person ?? 'none') : String(r.data?.[config.field ?? ''] ?? '—'))
    const cells = new Map<string, Map<string, Fact[]>>()
    for (const r of rows) {
      const g = groupKey(r)
      const m = cells.get(g) ?? new Map<string, Fact[]>()
      const sk = seriesKey(r)
      m.set(sk, [...(m.get(sk) ?? []), r])
      cells.set(g, m)
    }
    const seriesKeys = [...seriesPoints.map((p) => p.key)]
    const sLabel = labeller(config.series_by, await namesFor(config.series_by, seriesKeys))
    return {
      type: 'chart', value_label: valueLabel, ...base,
      series: seriesKeys.map((k) => ({ key: k, label: sLabel(k) })),
      points: shaped.map((p) => ({ ...p, values: Object.fromEntries(seriesKeys.map((sk) => [sk, Math.round((aggregate(cells.get(p.key)?.get(sk) ?? [], how, config.value_field) ?? 0) * 100) / 100])) })),
    }
  }
  return { type: 'chart', points: shaped, value_label: valueLabel, ...base }
}

/** Points in the order of a choice column's options (unknown values after them, as they were). */
export function orderByChoices<T extends { key: string }>(points: T[], options: readonly string[]): T[] {
  const rank = new Map(options.map((o, i) => [o, i]))
  return [...points].sort((a, b) => (rank.get(a.key) ?? options.length) - (rank.get(b.key) ?? options.length))
}

async function inChoiceOrder<T extends { key: string }>(ctx: ServiceContext, tableId: string | null, field: string, points: T[]): Promise<T[]> {
  if (!tableId) return points
  const table = await getDataTable(ctx, tableId) as any
  const column = ((table?.columns ?? []) as any[]).find((c) => c?.key === field)
  const options = ((Array.isArray(column?.options) ? column.options : []) as any[]).map((o) => String(o?.value ?? o?.label ?? o))
  return options.length ? orderByChoices(points, options) : points
}

/** A time bucket key → a short label. */
export function timeLabel(key: string, interval: 'day' | 'week' | 'month'): string {
  const d = new Date(interval === 'month' ? `${key}-01T00:00:00Z` : `${key}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return key
  return interval === 'month' ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/* ── Data table / report ─────────────────────────────────────────────── */

async function tableView(ctx: ServiceContext, config: WidgetConfig<'table_view'>): Promise<WidgetData> {
  if (config.kind === 'report') {
    const reportId = asId(config.report_id)
    if (!reportId) return { type: 'empty', reason: 'Choose a report' }
    if (!hasPerm(ctx, 'reports.view')) throw ServiceError.forbidden('You don’t have access to reports')
    return { type: 'table_view', kind: 'report', report_id: reportId }
  }
  const tableId = asId(config.table_id)
  if (!tableId) return { type: 'empty', reason: 'Choose a data table' }
  const table = await getDataTable(ctx, tableId) as any
  const allColumns = ((table?.columns ?? []) as any[]).filter((c) => c && c.key && !c.hidden)
  const chosen = config.columns.length ? config.columns.map((key) => allColumns.find((c) => c.key === key)).filter(Boolean) : allColumns.slice(0, 8)
  const filters = rowFiltersOf(config.where) as RowFilter[]
  const result = await queryRows(ctx, tableId, filters.length ? { filters } : {}, { limit: config.limit, offset: 0 })
  return {
    type: 'table_view', kind: 'data_table',
    table: { id: tableId, name: String(table?.name ?? 'Data table') },
    columns: chosen.map((c: any) => ({ key: String(c.key), label: String(c.name ?? c.key), type: String(c.type ?? 'text') })),
    rows: (result.rows as any[]).map((r) => ({ id: r.id, data: Object.fromEntries(chosen.map((c: any) => [c.key, r.data?.[c.key] ?? null])), created_at: r.created_at })),
    total: result.total,
  }
}

/* ── Recent submissions / runs ───────────────────────────────────────── */

async function recent(ctx: ServiceContext, config: WidgetConfig<'recent'>): Promise<WidgetData> {
  const db = getDb(ctx)
  if (config.source === 'runs') {
    const access = await runAccess(ctx)
    const { data, error } = await runsQuery(ctx, db, access, config, 'id, title, status, started_at, workflow_id, started_by').order('started_at', { ascending: false }).limit(config.limit)
    if (error) throw dbError(error)
    const rows = (data ?? []) as any[]
    const [workflows, people] = await Promise.all([workflowNames(db, ctx.tenantId, rows.map((r) => r.workflow_id)), personNames(db, rows.map((r) => r.started_by))])
    return {
      type: 'recent', source: 'runs',
      items: rows.map((r) => ({
        id: r.id, title: String(r.title || workflows.get(r.workflow_id) || 'Workflow run'),
        subtitle: [workflows.get(r.workflow_id), people.get(r.started_by)].filter(Boolean).join(' · ') || null,
        at: r.started_at, status: r.status ?? null, href: `/home/runs/${r.id}`,
      })),
    }
  }
  const { data, error } = await submissionsQuery(ctx, db, config, 'id, form_id, form_name, submitted_by, outcome, created_at').order('created_at', { ascending: false }).limit(config.limit)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const people = await personNames(db, rows.map((r) => r.submitted_by))
  return {
    type: 'recent', source: 'submissions',
    items: rows.map((r) => ({
      id: r.id, title: String(r.form_name || 'Form submission'),
      subtitle: people.get(r.submitted_by) ?? null,
      at: r.created_at, status: r.outcome ?? null, href: null,
    })),
  }
}
