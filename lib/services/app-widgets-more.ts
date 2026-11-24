/**
 * App widget data, Phase 2 widgets (tasks, SLA & performance, workflows,
 * forms, data, charts, people, activity). Same rules as
 * lib/services/app-widgets.ts: read AS THE VIEWER on their session client
 * (RLS) with the product's permission scoping on top; every query pinned to
 * ctx.tenantId; a config can never widen what someone sees.
 *
 *  - tasks: taskScope (view_all, else own + their teams' tasks)
 *  - runs: run-visibility (runAccess)
 *  - submissions: forms.edit sees all, else their own
 *  - data tables: data-tables service (data.view, table scope)
 *  - people: team.view_members, else themselves / their teams; org: org.view
 *  - audit (activity feed): settings.view, else left out
 *  - card view: lib/services/app-card-sources.ts
 *
 * Aggregations read at most AGGREGATE_ROW_CAP rows and say when truncated.
 */

import { columnCurrency } from '@/lib/apps/field-format'
import { MAX_VIEW_FILTERS, viewColumns } from '@/lib/apps/grid-views'
import type { BadgeSource, WidgetConfig, WidgetType } from '@/lib/apps/schema'
import { resolveDateRange, previousRange, rowFiltersOf, type FilterValues, type ResolvedRange } from '@/lib/apps/widgets'
import { OPEN_TASK_STATUSES } from '@/lib/home/progress'
import { getDb, hasPerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError } from './_shared'
import { myTeams, shapeTasks, TASK_COLUMNS, type HomeTask } from './home'
import {
  AGGREGATE_ROW_CAP, aggregatable, aggregate, arePeriodKeys, asId, facts, formNames, groupFacts, me, personNames, rangeOf, runAccess, runsQuery, slaBucket,
  submissionsQuery, taskScope, tasksQuery, timeKey, weightOf, withRange, workflowNames, type Common,
} from './app-widgets'
import { getDataTable, queryRows, type RowFilter } from './data-tables'
import { listRowChanges, type RowChange } from './data-table-audit'
import { cardViewData, toCard, type Card, type CardViewData } from './app-card-sources'
import { displayRow, instanceList, instanceRowId, widgetColumnType } from './instance-admin/widgets'
import { INSTANCE_DATASET_COLUMNS, isInstanceDataset } from '@/lib/instance-admin/schema'
import { rollupFinished } from './app-widget-rollups'
import { histQuantile, mergeHists } from '@/lib/report-rollups/hist'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows and joins */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HOUR = 3_600_000
const DAY = 86_400_000

/** Per-read view state from the browser (search text, page number, month), validated per widget. */
export interface WidgetParams { q?: string; page?: number; month?: string; row?: string; tab?: number; sort?: string; dir?: 'asc' | 'desc'; cols?: string[]; eq?: Array<{ column: string; value: string }> }
export interface WidgetExtra {
  params: WidgetParams
  filters: FilterValues
  role: 'editor' | 'contributor' | 'viewer'
  /** app:page:widget — card view cache / rate-limit key. */
  widgetKey: string
  preview: boolean
}

type Point = { key: string; label: string }
export type MoreWidgetData =
  | { type: 'kanban'; columns: Array<{ status: string; label: string; tasks: HomeTask[]; total: number; cards?: Card[]; sum?: number | null }>; can_drag: boolean
      /** Table source: the rows' table, the lane column and how lane totals are formatted. */
      source?: 'table'; table_id?: string; lane_column?: string; sum_format?: 'number' | 'currency'; currency?: string; truncated?: boolean }
  | { type: 'task_calendar'; month: string; tasks: Array<{ id: string; title: string; due: string; status: string; overdue: boolean }>; truncated: boolean }
  | { type: 'my_workload'; open: number; overdue: number; due_today: number; due_week: number; at_risk: number; completed_week: number }
  | { type: 'team_workload'; rows: Array<{ id: string; name: string; avatar: string | null; open: number; overdue: number }>; unassigned: number; truncated: boolean }
  | { type: 'sla_trend'; points: Array<Point & { on_time: number; late: number; pct: number | null }>; truncated: boolean }
  | { type: 'sla_breakdown'; by: string; rows: Array<{ key: string; label: string; on_track: number; at_risk: number; breached: number }>; truncated: boolean }
  | { type: 'cycle_time'; median_h: number | null; p90_h: number | null; count: number; points: Array<Point & { median_h: number | null; p90_h: number | null; count: number }>; truncated: boolean }
  | { type: 'bottleneck'; rows: Array<{ key: string; label: string; workflow: string | null; waiting: number; avg_wait_h: number; oldest_h: number }>; runs_waiting: number; truncated: boolean }
  | { type: 'throughput'; points: Array<Point & { created: number; completed: number }>; truncated: boolean }
  | { type: 'run_status'; counts: { running: number; waiting: number; completed: number; failed: number }; total: number; truncated: boolean }
  | { type: 'recent_failures'; items: Array<{ id: string; title: string; workflow: string | null; error: string | null; at: string }> }
  | { type: 'run_timeline'; run: { id: string; title: string; status: string; started_at: string } | null }
  | { type: 'submission_trend'; total: number; previous: number | null; change_pct: number | null; points: Array<Point & { value: number }>; truncated: boolean }
  | { type: 'my_submissions'; items: Array<{ id: string; form: string; at: string; outcome: string | null; status: string | null; href: string | null; title?: string | null }> }
  | { type: 'field_analytics'; form: { id: string; name: string }; total: number; stats: unknown[] }
  | { type: 'data_grid'; table: { id: string; name: string }; columns: Array<{ key: string; label: string; type: string; options?: string[]; currency?: string }>; grid_columns: Array<{ key: string; label: string; type: string }>; sort: string | null; dir: 'asc' | 'desc'; personal_views: boolean; rows: Array<{ id: string; data: Record<string, unknown>; updated_at: string | null }>; total: number; page: number; page_size: number; editable: boolean; group_by: string | null; truncated: boolean; can_delete?: boolean; row_actions?: Array<{ label: string }>
      /** The built-in "UserTasks instance" source: no table to open (sort, saved views and filters run on the server like a table's). */
      source?: 'instance'; note?: string | null }
  | { type: 'record_card'; history?: RowChange[] | null; table: { id: string; name: string }; columns: Array<{ key: string; label: string; type: string }>; row: { id: string; data: Record<string, unknown>; created_at: string } | null }
  | { type: 'filtered_list'; table: { id: string; name: string }; items: Array<{ id: string; title: string; subtitle: string | null; value: string | null }>; total: number }
  | { type: 'pivot'; row_label: string; col_label: string | null; rows: Point[]; cols: Point[]; cells: Record<string, Record<string, number>>; row_totals: Record<string, number | null>; col_totals: Record<string, number | null>; total: number | null; truncated: boolean }
  | CardViewData
  | { type: 'kpi'; value: number | null; previous: number | null; change_pct: number | null; points: Array<{ key: string; value: number }>; unit: string; truncated: boolean }
  | { type: 'goal'; value: number | null; target: number; pct: number; unit: string }
  | { type: 'gauge'; value: number | null; unit: string }
  | { type: 'heatmap'; cells: number[][]; max: number; total: number; truncated: boolean }
  | { type: 'team_members'; team: string | null; members: Array<{ id: string; name: string; email: string | null; avatar: string | null; last_seen: string | null; online: boolean; open: number; overdue: number }> }
  | { type: 'org_chart'; person: OrgCard; managers: OrgCard[]; peers: OrgCard[]; reports: Array<OrgCard & { depth: number }> }
  | { type: 'people_directory'; people: Array<OrgCard>; total: number; next: number | null }
  | { type: 'activity_feed'; items: Array<{ id: string; kind: 'task' | 'run' | 'submission' | 'audit'; title: string; subtitle: string | null; at: string; href: string | null }> }
  | { type: 'badges'; counts: Partial<Record<BadgeSource, number>> }

interface OrgCard { id: string; name: string; email: string | null; avatar: string | null; job_title: string | null; department: string | null }

export const MORE_TYPES: ReadonlySet<WidgetType> = new Set<WidgetType>([
  'kanban', 'task_calendar', 'my_workload', 'overdue_list', 'team_workload',
  'sla_trend', 'sla_breakdown', 'cycle_time', 'bottleneck', 'throughput',
  'run_status', 'recent_failures', 'run_timeline',
  'submission_trend', 'my_submissions', 'field_analytics',
  'data_grid', 'record_card', 'filtered_list', 'pivot', 'card_view',
  'kpi', 'goal', 'gauge', 'heatmap',
  'team_members', 'org_chart', 'people_directory', 'activity_feed',
])

export async function moreWidgetData(ctx: ServiceContext, type: WidgetType, config: WidgetConfig, extra: WidgetExtra): Promise<any> {
  const c = config as any
  switch (type) {
    case 'kanban': return kanban(ctx, c, extra)
    case 'task_calendar': return taskCalendar(ctx, c, extra)
    case 'my_workload': return myWorkload(ctx, c)
    case 'overdue_list': return overdueList(ctx, c)
    case 'team_workload': return teamWorkload(ctx, c)
    case 'sla_trend': return slaTrend(ctx, c)
    case 'sla_breakdown': return slaBreakdown(ctx, c)
    case 'cycle_time': return cycleTime(ctx, c)
    case 'bottleneck': return bottleneck(ctx, c)
    case 'throughput': return throughput(ctx, c)
    case 'run_status': return runStatus(ctx, c)
    case 'recent_failures': return recentFailures(ctx, c)
    case 'run_timeline': return runTimeline(ctx, c)
    case 'submission_trend': return submissionTrend(ctx, c)
    case 'my_submissions': return mySubmissions(ctx, c)
    case 'field_analytics': return fieldAnalytics(ctx, c)
    case 'data_grid': return dataGrid(ctx, c, extra)
    case 'record_card': return recordCard(ctx, c, extra)
    case 'filtered_list': return filteredList(ctx, c, extra)
    case 'pivot': return pivot(ctx, c)
    case 'card_view': return cardViewData(ctx, c, extra)
    case 'kpi': return kpi(ctx, c)
    case 'goal': return goal(ctx, c)
    case 'gauge': return gauge(ctx, c)
    case 'heatmap': return heatmap(ctx, c)
    case 'team_members': return teamMembers(ctx, c)
    case 'org_chart': return orgChart(ctx, c)
    case 'people_directory': return peopleDirectory(ctx, c, extra)
    case 'activity_feed': return activityFeed(ctx, c)
    default: return { type: 'empty', reason: 'This widget has no data' }
  }
}

/* ── Pure helpers (tested) ───────────────────────────────────────────── */

/** The q-quantile (0..1) of numbers (linear interpolation); null when empty. */
export function quantile(values: readonly number[], q: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q))
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10)

/** Was a finished item on time? (finished at or before its due date; no due date counts as on time.) */
export function onTime(due: string | null | undefined, finished: string | null | undefined): boolean {
  if (!due || !finished) return true
  return new Date(finished).getTime() <= new Date(due).getTime()
}

/** Day-of-week (Mon=0) × hour (0–23) counts of timestamps (UTC). */
export function heatmapCells(times: readonly string[]): { cells: number[][]; max: number } {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  let max = 0
  for (const t of times) {
    const d = new Date(t)
    if (Number.isNaN(d.getTime())) continue
    const day = (d.getUTCDay() + 6) % 7
    const v = ++cells[day][d.getUTCHours()]
    if (v > max) max = v
  }
  return { cells, max }
}

/** Every time bucket from `from` to `to` (so empty periods show as zero), at most 60. */
export function timeBuckets(range: ResolvedRange, interval: 'day' | 'week' | 'month', now = new Date()): string[] {
  const end = range.to ?? now
  const start = range.from ?? new Date(end.getTime() - (interval === 'month' ? 365 : interval === 'week' ? 84 : 30) * DAY)
  const out: string[] = []
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  // `to` is exclusive (the day after a custom range, the 1st of the next month for "this month").
  while ((range.to ? d < end : d <= end) && out.length < 400) {
    const key = timeKey(d.toISOString(), interval)
    if (out[out.length - 1] !== key) out.push(key)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out.slice(-60)
}

/** A bucket key → a short label (day: "Nov 21", week: "Wk of Nov 17", month: "Nov 2026"). */
export function bucketLabel(key: string, interval: 'day' | 'week' | 'month'): string {
  const d = new Date(interval === 'month' ? `${key}-01T00:00:00Z` : `${key}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return key
  if (interval === 'month') return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return interval === 'week' ? `Wk of ${day}` : day
}

/** A date range covering one time bucket (for click-through to a date range filter). */
export function bucketRange(key: string, interval: 'day' | 'week' | 'month'): { from: string; to: string } {
  const start = new Date(interval === 'month' ? `${key}-01T00:00:00Z` : `${key}T00:00:00Z`)
  const end = new Date(start)
  if (interval === 'month') end.setUTCMonth(end.getUTCMonth() + 1)
  else end.setUTCDate(end.getUTCDate() + (interval === 'week' ? 7 : 1))
  end.setUTCDate(end.getUTCDate() - 1)
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

/** Two-dimensional pivot of facts: cells[row][col] = aggregate. */
export function pivotCells<F>(rows: readonly F[], rowKey: (f: F) => string, colKey: (f: F) => string, value: (list: F[]) => number): { cells: Record<string, Record<string, number>>; rowTotals: Record<string, number>; colTotals: Record<string, number>; total: number } {
  const groups = new Map<string, Map<string, F[]>>()
  for (const f of rows) {
    const r = rowKey(f)
    const c = colKey(f)
    const byCol = groups.get(r) ?? new Map<string, F[]>()
    const list = byCol.get(c) ?? []
    list.push(f)
    byCol.set(c, list)
    groups.set(r, byCol)
  }
  const cells: Record<string, Record<string, number>> = {}
  const rowTotals: Record<string, number> = {}
  const colLists = new Map<string, F[]>()
  for (const [r, byCol] of groups) {
    cells[r] = {}
    const all: F[] = []
    for (const [c, list] of byCol) {
      cells[r][c] = value(list)
      all.push(...list)
      colLists.set(c, [...(colLists.get(c) ?? []), ...list])
    }
    rowTotals[r] = value(all)
  }
  const colTotals = Object.fromEntries([...colLists].map(([c, list]) => [c, value(list)]))
  return { cells, rowTotals, colTotals, total: value([...rows]) }
}

/* ── Tasks ───────────────────────────────────────────────────────────── */

const STATUS_LABELS: Record<string, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', completed: 'Completed', cancelled: 'Cancelled', draft: 'Draft' }

/** The lanes of a table board: its own list, else the lane column's choices. */
export function boardLanes(c: Pick<WidgetConfig<'kanban'>, 'lanes' | 'lane_column'>, columns: readonly any[]): string[] {
  if (c.lanes?.length) return [...c.lanes]
  const col = columns.find((x) => x?.key === c.lane_column)
  return ((Array.isArray(col?.options) ? col.options : []) as any[]).map((o) => String(o?.value ?? o?.label ?? o)).filter(Boolean).slice(0, 10)
}

/** A Kanban board of data table rows: lanes by a column's value, cards from the Card view template, a total per lane. */
async function tableBoard(ctx: ServiceContext, c: WidgetConfig<'kanban'>, extra: WidgetExtra) {
  const tableId = asId(c.table_id)
  if (!tableId) return { type: 'empty', reason: 'Choose a data table' }
  if (!c.lane_column) return { type: 'empty', reason: 'Choose the column that sets each card’s lane' }
  const table = await getDataTable(ctx, tableId) as any
  const lanes = boardLanes(c, Array.isArray(table?.columns) ? table.columns : [])
  if (!lanes.length) return { type: 'empty', reason: 'List the lanes (or use a choice column)' }
  const filters = rowFiltersOf(c.where) as RowFilter[]
  const result = await queryRows(ctx, tableId, { ...(filters.length ? { filters } : {}), ...(c.sort ? { sort_field: c.sort, sort_direction: c.sort_dir ?? 'asc' } : {}) }, { limit: AGGREGATE_ROW_CAP, offset: 0 })
  const template = c.template ?? { title: c.lane_column, image_style: 'none' as const, badge_colors: [], fields: [] }
  const byLane = new Map<string, any[]>(lanes.map((l) => [l, []]))
  for (const r of result.rows as any[]) byLane.get(String(r.data?.[c.lane_column] ?? ''))?.push(r)
  const sumOf = (rows: any[]) => (c.sum_field ? rows.reduce((n, r) => { const v = Number(r.data?.[c.sum_field!]); return Number.isFinite(v) ? n + v : n }, 0) : null)
  return {
    type: 'kanban', source: 'table', table_id: tableId, lane_column: c.lane_column, sum_format: c.sum_format ?? 'number', currency: c.currency ?? 'USD', truncated: !!result.truncated,
    columns: lanes.map((lane) => {
      const rows = byLane.get(lane) ?? []
      return { status: lane, label: lane, tasks: [], total: rows.length, sum: sumOf(rows), cards: rows.slice(0, c.per_column).map((r) => toCard({ ...(r.data ?? {}), id: r.id }, String(r.id), { template, actions: [], click_key: null }, Array.isArray(table?.columns) ? table.columns : [], { currency: c.currency })) }
    }),
    can_drag: c.allow_drag && extra.role !== 'viewer' && hasPerm(ctx, 'data.manage_rows'),
  } as MoreWidgetData
}

async function kanban(ctx: ServiceContext, c: WidgetConfig<'kanban'>, extra: WidgetExtra) {
  if (c.source === 'table') return tableBoard(ctx, c, extra)
  const db = getDb(ctx)
  const scope = await taskScope(ctx, db)
  const columns = await Promise.all(c.columns.map(async (status) => {
    let q = tasksQuery(ctx, db, scope, { ...c, status: 'all' }, `${TASK_COLUMNS}, assignee_id`, { count: true }).eq('status', status)
    if (status === 'completed' || status === 'cancelled') q = q.gte('updated_at', new Date(Date.now() - 14 * DAY).toISOString())
    const { data, count, error } = await q.order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).range(0, c.per_column - 1)
    if (error) throw dbError(error)
    return { status, label: STATUS_LABELS[status] ?? status, tasks: await shapeTasks(db, ctx.tenantId, (data ?? []) as any[]), total: count ?? (data ?? []).length }
  }))
  return { type: 'kanban', columns, can_drag: c.allow_drag && extra.role !== 'viewer' && hasPerm(ctx, 'tasks.complete') }
}

export function monthWindow(month: string | undefined, now = new Date()): { month: string; from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '')
  const year = m ? Number(m[1]) : now.getUTCFullYear()
  const mon = m ? Number(m[2]) - 1 : now.getUTCMonth()
  const from = new Date(Date.UTC(year, mon, 1))
  const to = new Date(Date.UTC(year, mon + 1, 1))
  // A week either side, so the calendar's leading / trailing days have their tasks.
  return { month: from.toISOString().slice(0, 7), from: new Date(from.getTime() - 7 * DAY), to: new Date(to.getTime() + 7 * DAY) }
}

async function taskCalendar(ctx: ServiceContext, c: WidgetConfig<'task_calendar'>, extra: WidgetExtra) {
  const db = getDb(ctx)
  const scope = await taskScope(ctx, db)
  const win = monthWindow(extra.params.month)
  const { data, error } = await tasksQuery(ctx, db, scope, { ...c, status: c.status ?? 'all' }, 'id, title, due_date, status')
    .gte('due_date', win.from.toISOString()).lt('due_date', win.to.toISOString()).order('due_date').limit(500)
  if (error) throw dbError(error)
  const now = Date.now()
  const rows = (data ?? []) as any[]
  return {
    type: 'task_calendar', month: win.month, truncated: rows.length >= 500,
    tasks: rows.map((r) => ({ id: r.id, title: String(r.title || 'Untitled task'), due: r.due_date, status: r.status, overdue: (OPEN_TASK_STATUSES as readonly string[]).includes(r.status) && new Date(r.due_date).getTime() < now })),
  }
}

async function myWorkload(ctx: ServiceContext, c: WidgetConfig<'my_workload'>) {
  const db = getDb(ctx)
  const scope = await taskScope(ctx, db)
  const now = new Date()
  const endToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const endWeek = new Date(endToday.getTime() + ((7 - ((now.getUTCDay() + 6) % 7)) - 1) * DAY)
  const startWeek = new Date(endWeek.getTime() - 7 * DAY)
  const mine = { scope: 'mine' as const }
  const { data, error } = await tasksQuery(ctx, db, scope, { ...mine, status: 'open' }, 'id, due_date').limit(AGGREGATE_ROW_CAP)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const t = (r: any) => (r.due_date ? new Date(r.due_date).getTime() : null)
  const done = await tasksQuery(ctx, db, scope, { ...mine, status: 'completed' }, 'id', { count: true }).gte('completed_at', startWeek.toISOString()).limit(1)
  return {
    type: 'my_workload',
    open: rows.length,
    overdue: rows.filter((r) => (t(r) ?? Infinity) < now.getTime()).length,
    due_today: rows.filter((r) => { const v = t(r); return v !== null && v >= now.getTime() && v < endToday.getTime() }).length,
    due_week: rows.filter((r) => { const v = t(r); return v !== null && v >= now.getTime() && v < endWeek.getTime() }).length,
    at_risk: rows.filter((r) => slaBucket({ due: r.due_date ?? null }, c.at_risk_hours) === 'at_risk').length,
    completed_week: done.count ?? 0,
  }
}

async function overdueList(ctx: ServiceContext, c: WidgetConfig<'overdue_list'>) {
  const db = getDb(ctx)
  const scope = await taskScope(ctx, db)
  const { data, count, error } = await tasksQuery(ctx, db, scope, { ...c, status: 'open' }, `${TASK_COLUMNS}, assignee_id`, { count: true })
    .lt('due_date', new Date().toISOString()).order('due_date', { ascending: true }).range(0, c.limit - 1)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  return { type: 'task_list', tasks: await shapeTasks(db, ctx.tenantId, rows), total: count ?? rows.length }
}

/**
 * Open work per person for a team: tasks routed to the team's queue AND
 * tasks assigned to the team's members one by one (workflows that assign
 * people individually), each once, only the tasks the viewer may see.
 */
async function teamWorkload(ctx: ServiceContext, c: WidgetConfig<'team_workload'>) {
  const db = getDb(ctx)
  const scope = await taskScope(ctx, db)
  const team = c.team ?? 'my_teams'
  const teamIds = team === 'my_teams' ? scope.teams : [asId(team)].filter((t): t is string => !!t)
  const [queued, members] = await Promise.all([
    tasksQuery(ctx, db, scope, { team, workflow_id: c.workflow_id, status: 'open' }, 'id, assignee_id, due_date').limit(AGGREGATE_ROW_CAP),
    teamIds.length ? (db as any).from('user_teams').select('user_id, team:teams!inner(tenant_id)').in('team_id', teamIds).eq('team.tenant_id', ctx.tenantId).limit(500) : Promise.resolve({ data: [] }),
  ])
  if (queued.error) throw dbError(queued.error)
  const memberIds = [...new Set(((members.data ?? []) as any[]).map((m) => String(m.user_id)))]
  let assigned: any[] = []
  if (memberIds.length) {
    const r = await tasksQuery(ctx, db, scope, { workflow_id: c.workflow_id, status: 'open' }, 'id, assignee_id, due_date').in('assignee_id', memberIds).limit(AGGREGATE_ROW_CAP)
    if (r.error) throw dbError(r.error)
    assigned = (r.data ?? []) as any[]
  }
  const seen = new Set<string>()
  const rows = [...((queued.data ?? []) as any[]), ...assigned].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  const now = Date.now()
  const by = new Map<string, { open: number; overdue: number }>()
  let unassigned = 0
  for (const r of rows) {
    if (!r.assignee_id) { unassigned++; continue }
    const e = by.get(r.assignee_id) ?? { open: 0, overdue: 0 }
    e.open++
    if (r.due_date && new Date(r.due_date).getTime() < now) e.overdue++
    by.set(r.assignee_id, e)
  }
  const ids = [...by.keys()]
  const { data: users } = ids.length ? await (db as any).from('users').select('id, display_name, email, avatar_url').in('id', ids) : { data: [] }
  const info = new Map(((users ?? []) as any[]).map((u) => [String(u.id), u]))
  return {
    type: 'team_workload', unassigned, truncated: rows.length >= AGGREGATE_ROW_CAP,
    rows: [...by.entries()].map(([id, v]) => ({ id, name: personLabel(info.get(id)), avatar: info.get(id)?.avatar_url ?? null, ...v }))
      .sort((a, b) => b.open - a.open).slice(0, c.limit),
  }
}

const personLabel = (u: any) => String(u?.display_name || (u?.email ? String(u.email).split('@')[0] : '') || 'Someone')

/* ── SLA & performance ───────────────────────────────────────────────── */

/** Finished items in range with due + finish times (tasks: due_date / completed_at; runs: sla_due_at / completed_at). */
async function finished(ctx: ServiceContext, c: Common & { source?: string }): Promise<{ rows: Array<{ due: string | null; start: string; end: string; group: string | null; person: string | null }>; truncated: boolean }> {
  const db = getDb(ctx)
  const range = rangeOf(c)
  if (c.source === 'runs') {
    const access = await runAccess(ctx)
    const { data, error } = await withRange(runsQuery(ctx, db, access, { ...c, date_range: null, status: 'completed' }, 'id, started_at, completed_at, sla_due_at, workflow_id, started_by'), 'completed_at', range)
      .not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(AGGREGATE_ROW_CAP)
    if (error) throw dbError(error)
    const rows = (data ?? []) as any[]
    return { rows: rows.map((r) => ({ due: r.sla_due_at ?? null, start: r.started_at, end: r.completed_at, group: r.workflow_id, person: r.started_by })), truncated: rows.length >= AGGREGATE_ROW_CAP }
  }
  const scope = await taskScope(ctx, db)
  const { data, error } = await withRange(tasksQuery(ctx, db, scope, { ...c, date_range: null, status: 'completed' }, 'id, created_at, completed_at, due_date, workflow_id, assignee_id'), 'completed_at', range)
    .not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(AGGREGATE_ROW_CAP)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  return { rows: rows.map((r) => ({ due: r.due_date ?? null, start: r.created_at, end: r.completed_at, group: r.workflow_id, person: r.assignee_id })), truncated: rows.length >= AGGREGATE_ROW_CAP }
}

async function slaTrend(ctx: ServiceContext, c: WidgetConfig<'sla_trend'>) {
  const buckets = timeBuckets(rangeOf(c), c.interval)
  const by = new Map(buckets.map((k) => [k, { on_time: 0, late: 0 }]))
  const rolled = await rollupFinished(ctx, c, rangeOf(c), false)
  if (rolled) {
    for (const d of rolled) {
      const b = by.get(timeKey(d.day, c.interval))
      if (!b) continue
      b.on_time += d.onTime
      b.late += d.late
    }
  }
  const { rows, truncated } = rolled ? { rows: [], truncated: false } : await finished(ctx, c)
  for (const r of rows) {
    const b = by.get(timeKey(r.end, c.interval))
    if (!b) continue
    if (onTime(r.due, r.end)) b.on_time++; else b.late++
  }
  return {
    type: 'sla_trend', truncated,
    points: buckets.map((k) => { const b = by.get(k)!; const n = b.on_time + b.late; return { key: k, label: bucketLabel(k, c.interval), ...b, pct: n ? Math.round((b.on_time / n) * 1000) / 10 : null } }),
  }
}

async function slaBreakdown(ctx: ServiceContext, c: WidgetConfig<'sla_breakdown'>) {
  const db = getDb(ctx)
  const by = new Map<string, { on_track: number; at_risk: number; breached: number }>()
  const add = (key: string | null, bucket: string) => {
    if (bucket === 'no_sla') return
    const k = key ?? 'none'
    const e = by.get(k) ?? { on_track: 0, at_risk: 0, breached: 0 }
    e[bucket as 'on_track']++
    by.set(k, e)
  }
  let truncated = false
  if (c.source === 'runs') {
    const access = await runAccess(ctx)
    const { data, error } = await runsQuery(ctx, db, access, { ...c, status: 'open' }, 'id, workflow_id, started_by, sla_status, sla_due_at').limit(AGGREGATE_ROW_CAP)
    if (error) throw dbError(error)
    const rows = (data ?? []) as any[]
    truncated = rows.length >= AGGREGATE_ROW_CAP
    for (const r of rows) add(c.by === 'assignee' ? r.started_by : r.workflow_id, slaBucket({ due: r.sla_due_at ?? null, slaStatus: r.sla_status === 'none' ? null : r.sla_status }, c.at_risk_hours))
  } else {
    const scope = await taskScope(ctx, db)
    const { data, error } = await tasksQuery(ctx, db, scope, { ...c, status: 'open' }, 'id, due_date, workflow_id, assignee_id, assigned_team_id, metadata').limit(AGGREGATE_ROW_CAP)
    if (error) throw dbError(error)
    const rows = (data ?? []) as any[]
    truncated = rows.length >= AGGREGATE_ROW_CAP
    for (const r of rows) {
      const key = c.by === 'team' ? r.assigned_team_id : c.by === 'assignee' ? r.assignee_id : c.by === 'form' ? (r.metadata?.form_ref?.form_id ?? null) : r.workflow_id
      add(key, slaBucket({ due: r.due_date ?? null }, c.at_risk_hours))
    }
  }
  const keys = [...by.keys()]
  const names = c.by === 'team' ? await teamNames(db, ctx.tenantId, keys) : c.by === 'assignee' ? await personNames(db, keys) : c.by === 'form' ? await formNames(db, ctx.tenantId, keys) : await workflowNames(db, ctx.tenantId, keys)
  return {
    type: 'sla_breakdown', by: c.by, truncated,
    rows: [...by.entries()].map(([key, v]) => ({ key, label: key === 'none' ? (c.by === 'assignee' ? 'Unassigned' : 'None') : names.get(key) ?? 'Other', ...v }))
      .sort((a, b) => (b.breached - a.breached) || (b.at_risk - a.at_risk) || (b.on_track - a.on_track)).slice(0, c.limit),
  }
}

async function teamNames(db: AnySupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  const { data } = await (db as any).from('teams').select('id, name').eq('tenant_id', tenantId).in('id', unique)
  for (const t of (data ?? []) as any[]) out.set(String(t.id), String(t.name ?? 'Team'))
  return out
}

async function cycleTime(ctx: ServiceContext, c: WidgetConfig<'cycle_time'>) {
  const rolled = await rollupFinished(ctx, c, rangeOf(c), true)
  if (rolled) {
    // Histogram percentiles (within 9.1%); ms → hours.
    const h = (hist: number[], q: number) => { const v = histQuantile(hist, q); return v === null ? null : v / HOUR }
    const buckets = timeBuckets(rangeOf(c), c.interval)
    const all = mergeHists(...rolled.map((d) => d.hist))
    return {
      type: 'cycle_time', truncated: false, count: rolled.reduce((n, d) => n + d.n, 0), median_h: round1(h(all, 0.5)), p90_h: round1(h(all, 0.9)),
      points: buckets.map((k) => {
        const days = rolled.filter((d) => timeKey(d.day, c.interval) === k)
        const hist = mergeHists(...days.map((d) => d.hist))
        return { key: k, label: bucketLabel(k, c.interval), count: days.reduce((n, d) => n + d.n, 0), median_h: round1(h(hist, 0.5)), p90_h: round1(h(hist, 0.9)) }
      }),
    }
  }
  const { rows, truncated } = await finished(ctx, c)
  const hours = (r: { start: string; end: string }) => Math.max(0, (new Date(r.end).getTime() - new Date(r.start).getTime()) / HOUR)
  const all = rows.map(hours).filter((h) => Number.isFinite(h))
  const buckets = timeBuckets(rangeOf(c), c.interval)
  const by = new Map<string, number[]>(buckets.map((k) => [k, []]))
  for (const r of rows) by.get(timeKey(r.end, c.interval))?.push(hours(r))
  return {
    type: 'cycle_time', truncated, count: all.length, median_h: round1(quantile(all, 0.5)), p90_h: round1(quantile(all, 0.9)),
    points: buckets.map((k) => { const v = by.get(k)!; return { key: k, label: bucketLabel(k, c.interval), count: v.length, median_h: round1(quantile(v, 0.5)), p90_h: round1(quantile(v, 0.9)) } }),
  }
}

async function bottleneck(ctx: ServiceContext, c: WidgetConfig<'bottleneck'>) {
  const db = getDb(ctx)
  const scope = await taskScope(ctx, db)
  const { data, error } = await tasksQuery(ctx, db, scope, { team: c.team, workflow_id: c.workflow_id, status: 'open' }, 'id, title, created_at, routed_at, workflow_id, workflow_step_id')
    .not('workflow_id', 'is', null).limit(AGGREGATE_ROW_CAP)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const now = Date.now()
  const groups = new Map<string, { workflow: string; titles: Map<string, number>; waits: number[] }>()
  for (const r of rows) {
    const key = `${r.workflow_id}:${r.workflow_step_id ?? r.title}`
    const g = groups.get(key) ?? { workflow: String(r.workflow_id), titles: new Map<string, number>(), waits: [] as number[] }
    const title = String(r.title || 'Step')
    g.titles.set(title, (g.titles.get(title) ?? 0) + 1)
    g.waits.push(Math.max(0, (now - new Date(r.routed_at ?? r.created_at).getTime()) / HOUR))
    groups.set(key, g)
  }
  const names = await workflowNames(db, ctx.tenantId, [...groups.values()].map((g) => g.workflow))
  let runsWaiting = 0
  try {
    const access = await runAccess(ctx)
    const { count } = await runsQuery(ctx, db, access, { workflow_id: c.workflow_id }, 'id', { count: true }).in('status', ['paused', 'waiting_for_event', 'waiting']).limit(1)
    runsWaiting = count ?? 0
  } catch { runsWaiting = 0 }
  return {
    type: 'bottleneck', runs_waiting: runsWaiting, truncated: rows.length >= AGGREGATE_ROW_CAP,
    rows: [...groups.entries()].map(([key, g]) => {
      const label = [...g.titles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Step'
      return { key, label, workflow: names.get(g.workflow) ?? null, waiting: g.waits.length, avg_wait_h: round1(g.waits.reduce((a, b) => a + b, 0) / g.waits.length) ?? 0, oldest_h: round1(Math.max(...g.waits)) ?? 0 }
    }).sort((a, b) => (b.waiting * b.avg_wait_h) - (a.waiting * a.avg_wait_h)).slice(0, c.limit),
  }
}

async function throughput(ctx: ServiceContext, c: WidgetConfig<'throughput'>) {
  const range = rangeOf(c)
  const created = await facts(ctx, c.source, { ...c, status: 'all' } as Common, range, { dims: ['time'] })
  const rolled = await rollupFinished(ctx, c, range, false)
  const done = rolled ? { rows: [], truncated: false } : await finished(ctx, c)
  const buckets = timeBuckets(range, c.interval)
  const by = new Map(buckets.map((k) => [k, { created: 0, completed: 0 }]))
  for (const r of created.rows) { const b = by.get(timeKey(r.at, c.interval)); if (b) b.created += weightOf(r) }
  for (const d of rolled ?? []) { const b = by.get(timeKey(d.day, c.interval)); if (b) b.completed += d.n }
  for (const r of done.rows) { const b = by.get(timeKey(r.end, c.interval)); if (b) b.completed++ }
  return { type: 'throughput', truncated: created.truncated || done.truncated, points: buckets.map((k) => ({ key: k, label: bucketLabel(k, c.interval), ...by.get(k)! })) }
}

/* ── Workflows ───────────────────────────────────────────────────────── */

export const RUN_GROUP: Record<string, 'running' | 'waiting' | 'completed' | 'failed'> = {
  running: 'running', pending: 'running', paused: 'waiting', waiting: 'waiting', waiting_for_event: 'waiting', completed: 'completed', failed: 'failed', cancelled: 'failed', canceled: 'failed',
}

async function runStatus(ctx: ServiceContext, c: WidgetConfig<'run_status'>) {
  const db = getDb(ctx)
  const access = await runAccess(ctx)
  const { data, error } = await runsQuery(ctx, db, access, c, 'id, status').limit(AGGREGATE_ROW_CAP)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const counts = { running: 0, waiting: 0, completed: 0, failed: 0 }
  for (const r of rows) { const g = RUN_GROUP[String(r.status)]; if (g) counts[g]++ }
  return { type: 'run_status', counts, total: rows.length, truncated: rows.length >= AGGREGATE_ROW_CAP }
}

async function recentFailures(ctx: ServiceContext, c: WidgetConfig<'recent_failures'>) {
  const db = getDb(ctx)
  const access = await runAccess(ctx)
  const { data, error } = await runsQuery(ctx, db, access, c, 'id, title, status, error, started_at, completed_at, workflow_id').eq('status', 'failed')
    .order('started_at', { ascending: false }).limit(c.limit)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const names = await workflowNames(db, ctx.tenantId, rows.map((r) => r.workflow_id))
  return { type: 'recent_failures', items: rows.map((r) => ({ id: r.id, title: String(r.title || names.get(r.workflow_id) || 'Workflow run'), workflow: names.get(r.workflow_id) ?? null, error: r.error ? String(r.error).slice(0, 300) : null, at: r.completed_at ?? r.started_at })) }
}

async function runTimeline(ctx: ServiceContext, c: WidgetConfig<'run_timeline'>) {
  const db = getDb(ctx)
  const access = await runAccess(ctx)
  const { data, error } = await runsQuery(ctx, db, access, { workflow_id: c.workflow_id, person: c.person ?? 'me' }, 'id, title, status, started_at, workflow_id').order('started_at', { ascending: false }).limit(1)
  if (error) throw dbError(error)
  const r = ((data ?? []) as any[])[0]
  if (!r) return { type: 'run_timeline', run: null }
  const names = await workflowNames(db, ctx.tenantId, [r.workflow_id])
  return { type: 'run_timeline', run: { id: r.id, title: String(r.title || names.get(r.workflow_id) || 'Workflow run'), status: String(r.status), started_at: r.started_at } }
}

/* ── Forms ───────────────────────────────────────────────────────────── */

async function submissionTrend(ctx: ServiceContext, c: WidgetConfig<'submission_trend'>) {
  const range = rangeOf(c)
  const current = await facts(ctx, 'submissions', c as Common, range, { dims: ['time'] })
  const buckets = timeBuckets(range, c.interval)
  const by = new Map(buckets.map((k) => [k, 0]))
  for (const r of current.rows) { const k = timeKey(r.at, c.interval); if (by.has(k)) by.set(k, by.get(k)! + weightOf(r)) }
  const prev = previousRange(range)
  const count = (rows: Array<{ n?: number }>) => rows.reduce((n, r) => n + (r.n ?? 1), 0)
  const before = prev ? count((await facts(ctx, 'submissions', c as Common, prev, { dims: [] })).rows) : null
  const total = count(current.rows)
  return {
    type: 'submission_trend', total, previous: before, truncated: current.truncated,
    change_pct: before ? Math.round(((total - before) / before) * 1000) / 10 : null,
    points: buckets.map((k) => ({ key: k, label: bucketLabel(k, c.interval), value: by.get(k) ?? 0 })),
  }
}

async function mySubmissions(ctx: ServiceContext, c: WidgetConfig<'my_submissions'>) {
  const db = getDb(ctx)
  const { data, error } = await submissionsQuery(ctx, db, { ...c, person: 'me' }, 'id, form_id, form_name, outcome, created_at, task_id').order('created_at', { ascending: false }).limit(c.limit)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const ids = rows.map((r) => r.id)
  const runs = new Map<string, any>()
  if (ids.length) {
    const { data: rs } = await (db as any).from('workflow_runs').select('id, status, title, form_submission_id').eq('tenant_id', ctx.tenantId).in('form_submission_id', ids)
    for (const r of (rs ?? []) as any[]) runs.set(String(r.form_submission_id), r)
  }
  return {
    type: 'my_submissions',
    items: rows.map((r) => {
      const run = runs.get(r.id)
      return { id: r.id, form: String(r.form_name || 'Form'), at: r.created_at, outcome: r.outcome ?? null, status: run ? String(run.status) : null, href: run ? `/home/runs/${run.id}` : r.task_id ? `/tasks/${r.task_id}` : null, title: run?.title ? String(run.title) : null }
    }),
  }
}

async function fieldAnalytics(ctx: ServiceContext, c: WidgetConfig<'field_analytics'>) {
  const formId = asId(c.form_id)
  if (!formId) return { type: 'empty', reason: 'Choose a form' }
  const db = getDb(ctx)
  const { data: form, error: fe } = await (db as any).from('forms').select('id, name, fields').eq('tenant_id', ctx.tenantId).eq('id', formId).maybeSingle()
  if (fe) throw dbError(fe)
  if (!form) return { type: 'empty', reason: 'This form isn’t available' }
  const { data, error } = await withRange(submissionsQuery(ctx, db, { form_id: formId }, 'id, values, created_at'), 'created_at', rangeOf(c)).order('created_at', { ascending: false }).limit(AGGREGATE_ROW_CAP)
  if (error) throw dbError(error)
  const { surveyStats } = await import('@/lib/forms/survey-stats')
  const fields = ((Array.isArray(form.fields) ? form.fields : []) as any[]).filter((f) => !c.field || f.key === c.field)
  const rows = ((data ?? []) as any[]).map((r) => (r.values ?? {}) as Record<string, unknown>)
  return { type: 'field_analytics', form: { id: form.id, name: String(form.name ?? 'Form') }, total: rows.length, stats: surveyStats(fields, rows, (f, row) => row[f.key]) }
}

/* ── Data ────────────────────────────────────────────────────────────── */

const SAFE_SEARCH = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '')

async function tableAndColumns(ctx: ServiceContext, tableId: string, viewId: string | null | undefined, chosen: string[]) {
  const table = await getDataTable(ctx, tableId) as any
  const all = ((table?.columns ?? []) as any[]).filter((col) => col && col.key && !col.hidden)
  const view = viewId ? ((Array.isArray(table?.views) ? table.views : []) as any[]).find((v) => v?.id === viewId) : null
  const keys = chosen.length ? chosen : view ? ((view.columns ?? []) as any[]).map((col) => col.key ?? col.field).filter(Boolean) : all.slice(0, 8).map((col) => col.key)
  const columns = keys.map((k: string) => all.find((col) => col.key === k)).filter(Boolean).map((col: any) => ({
    key: String(col.key), label: String(col.name ?? col.key), type: String(col.type ?? 'text'),
    ...(Array.isArray(col.options) ? { options: (col.options as any[]).map((o) => String(o?.value ?? o?.label ?? o)).slice(0, 50) } : {}),
    // The column's own currency (a currency format's default before USD).
    ...(columnCurrency(col) ? { currency: columnCurrency(col) } : {}),
  }))
  return { table, columns, groupBy: (view?.group_by?.[0] as string | undefined) ?? null }
}

/** Instance dataset params a saved view's "equals" filter can set (other columns are not filterable on the server). */
const INSTANCE_EQ_PARAMS: Record<string, 'status' | 'plan' | 'workspace_id' | 'user_id'> = { status: 'status', plan: 'plan', workspace_id: 'workspace_id', user_id: 'user_id', state: 'status', outcome: 'status', severity: 'status' }

/**
 * Data grid over the built-in "UserTasks instance" source: read-only, instance admins only. Uses the
 * grid's own machinery (lib/apps/grid-views.ts): the viewer's header sort and saved views (columns
 * shown, "equals" filters on filterable columns) — all applied on the server by the instance services.
 */
async function instanceGrid(ctx: ServiceContext, c: WidgetConfig<'data_grid'>, extra: WidgetExtra) {
  const page = Math.max(0, Math.min(1000, Math.floor(Number(extra.params.page ?? 0)) || 0))
  const search = SAFE_SEARCH(extra.params.q) || SAFE_SEARCH(c.search)
  const dataset = isInstanceDataset(c.instance_dataset) ? c.instance_dataset : null
  if (!dataset) return { type: 'empty', reason: 'Choose a UserTasks instance dataset' }
  const all = INSTANCE_DATASET_COLUMNS[dataset]
  const gridKeys = (c.columns.length ? c.columns : all.map((col) => col.key)).filter((k) => all.some((col) => col.key === k))
  const own = new Set(gridKeys)
  const sortKey = extra.params.sort && all.some((col) => col.key === extra.params.sort) ? extra.params.sort : (c.sort && all.some((col) => col.key === c.sort) ? c.sort : null)
  const sortDir = extra.params.sort ? (extra.params.dir ?? 'asc') : (c.sort_dir ?? 'asc')
  const params: Record<string, unknown> = { ...((c.instance_params as Record<string, unknown> | null) ?? {}) }
  for (const f of (extra.params.eq ?? []).filter((f) => own.has(f.column) && String(f.value ?? '').trim()).slice(0, MAX_VIEW_FILTERS)) {
    const key = INSTANCE_EQ_PARAMS[f.column]
    if (key) params[key] = String(f.value).trim()
  }
  const result = await instanceList(ctx, { dataset, params: params as never, filters: extra.filters, page, size: c.page_size, q: search || undefined, sort: sortKey, dir: sortDir })
  if (!result) return { type: 'empty', reason: 'Choose a UserTasks instance dataset' }
  const gridColumns = gridKeys.map((k) => all.find((col) => col.key === k)!).map((col) => ({ key: col.key, label: col.label, type: widgetColumnType(col) }))
  const shown = viewColumns(gridKeys, { columns: extra.params.cols })
  const columns = shown.map((k) => gridColumns.find((col) => col.key === k)!).filter(Boolean)
  return {
    type: 'data_grid', source: 'instance', table: { id: `instance:${dataset}`, name: humanColumn(dataset).replace(/_/g, ' ') }, columns,
    grid_columns: gridColumns, sort: sortKey, dir: sortDir, personal_views: !!c.personal_views,
    // Every dataset column travels in the row (rules read {{event.row.<column>}}, e.g. a membership's user_id), shown or not.
    rows: result.page.rows.map((r, i) => ({ id: instanceRowId(r, i), data: displayRow(result.columns, r), updated_at: null })),
    total: result.page.total, page, page_size: c.page_size, truncated: !!result.page.truncated, editable: false, can_delete: false,
    row_actions: c.row_actions ?? [], group_by: c.group_by ?? null, note: result.page.note ?? null,
  }
}

async function dataGrid(ctx: ServiceContext, c: WidgetConfig<'data_grid'>, extra: WidgetExtra) {
  if (c.source === 'instance') return instanceGrid(ctx, c, extra)
  const tableId = asId(c.table_id)
  if (!tableId) return { type: 'empty', reason: 'Choose a data table' }
  const { table, columns: gridColumns, groupBy } = await tableAndColumns(ctx, tableId, c.view_id, c.columns)
  // The viewer's state (header sort, a saved view): only the grid's own columns, and filters that narrow it.
  const own = new Set(gridColumns.map((col: any) => col.key as string))
  const tableKeys = new Set(((table?.columns ?? []) as any[]).filter((col) => col?.key && !col.hidden).map((col) => String(col.key)))
  const shown = viewColumns(gridColumns.map((col: any) => col.key as string), { columns: extra.params.cols })
  const columns = shown.map((k) => gridColumns.find((col: any) => col.key === k)).filter(Boolean)
  const sortKey = extra.params.sort && (own.has(extra.params.sort) || tableKeys.has(extra.params.sort)) ? extra.params.sort : (c.sort && tableKeys.has(c.sort) ? c.sort : null)
  const sortDir = extra.params.sort ? (extra.params.dir ?? 'asc') : (c.sort_dir ?? 'asc')
  const page = Math.max(0, Math.min(1000, Math.floor(Number(extra.params.page ?? 0)) || 0))
  const search = SAFE_SEARCH(extra.params.q) || SAFE_SEARCH(c.search)
  const viewFilters: RowFilter[] = (extra.params.eq ?? []).filter((f) => own.has(f.column) && String(f.value ?? '').trim()).slice(0, MAX_VIEW_FILTERS).map((f) => ({ field: f.column, operator: 'equals', value: String(f.value).trim() }))
  const filters = [...(rowFiltersOf(c.where) as RowFilter[]), ...viewFilters]
  const result = await queryRows(ctx, tableId, { ...(search ? { search } : {}), ...(filters.length ? { filters } : {}), ...(sortKey ? { sort_field: sortKey, sort_direction: sortDir } : {}) }, { limit: c.page_size, offset: page * c.page_size })
  return {
    type: 'data_grid', table: { id: tableId, name: String(table?.name ?? 'Data table') }, columns,
    /** Every column the grid may show (the view editor's choices) and the order applied. */
    grid_columns: gridColumns, sort: sortKey, dir: sortDir, personal_views: !!c.personal_views,
    rows: (result.rows as any[]).map((r) => ({ id: r.id, data: Object.fromEntries(columns.map((col: any) => [col.key, r.data?.[col.key] ?? null])), updated_at: r.updated_at ?? null })),
    total: result.total, page, page_size: c.page_size, truncated: !!result.truncated,
    editable: c.editable && extra.role !== 'viewer' && hasPerm(ctx, 'data.manage_rows'),
    // Bulk selection: delete (Manage rows, an acting role) and the grid's row actions (rules decide what they may do).
    can_delete: !!c.allow_delete && extra.role !== 'viewer' && hasPerm(ctx, 'data.manage_rows'),
    row_actions: c.row_actions ?? [],
    group_by: c.group_by ?? groupBy,
  }
}

async function recordCard(ctx: ServiceContext, c: WidgetConfig<'record_card'>, extra: WidgetExtra) {
  const tableId = asId(c.table_id)
  if (!tableId) return { type: 'empty', reason: 'Choose a data table' }
  const { table, columns } = await tableAndColumns(ctx, tableId, null, c.fields)
  const rowId = SAFE_SEARCH(extra.params.row) || SAFE_SEARCH(c.row_id)
  let row: any = null
  if (rowId) {
    const { data } = await (getDb(ctx) as any).from('custom_table_rows').select('id, data, created_at').eq('tenant_id', ctx.tenantId).eq('table_id', tableId).eq(UUID_RE.test(rowId) ? 'id' : 'row_id', rowId).maybeSingle()
    row = data ?? null
  }
  // The record's change history (tables that record field changes; nothing before migration 20270128090000).
  const history = c.show_history && row ? await listRowChanges(ctx, tableId, row.id, { limit: 20, table }).then((h) => (h.available && (h.audited || h.changes.length) ? h.changes : null)).catch(() => null) : null
  return { type: 'record_card', table: { id: tableId, name: String(table?.name ?? 'Data table') }, columns, row: row ? { id: row.id, data: row.data ?? {}, created_at: row.created_at } : null, history }
}

const text = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'object') { const o = v as any; return String(o.label ?? o.name ?? o.display_name ?? o.value ?? JSON.stringify(v)).slice(0, 300) }
  return String(v).slice(0, 300)
}

async function filteredList(ctx: ServiceContext, c: WidgetConfig<'filtered_list'>, extra: WidgetExtra) {
  const tableId = asId(c.table_id)
  if (!tableId) return { type: 'empty', reason: 'Choose a data table' }
  const table = await getDataTable(ctx, tableId) as any
  const cols = ((table?.columns ?? []) as any[]).filter((col) => col?.key)
  const titleKey = c.title_column ?? cols[0]?.key
  const search = SAFE_SEARCH(extra.params.q) || SAFE_SEARCH(c.search)
  const filters = rowFiltersOf(c.where) as RowFilter[]
  const result = await queryRows(ctx, tableId, { ...(search ? { search } : {}), ...(filters.length ? { filters } : {}) }, { limit: c.limit, offset: 0 })
  return {
    type: 'filtered_list', table: { id: tableId, name: String(table?.name ?? 'Data table') }, total: result.total,
    items: (result.rows as any[]).map((r) => ({ id: r.id, title: text(r.data?.[titleKey]) ?? 'Untitled', subtitle: c.subtitle_column ? text(r.data?.[c.subtitle_column]) : null, value: c.click_column ? text(r.data?.[c.click_column]) : r.id })),
  }
}

/** A column key as a heading (business_unit → Business unit). */
export const humanColumn = (key: string) => { const t = key.replace(/_/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : key }

async function pivot(ctx: ServiceContext, c: WidgetConfig<'pivot'>) {
  const range = rangeOf(c)
  const { rows, truncated } = await facts(ctx, c.source, c as Common, range, { dims: [c.rows, c.columns].filter((d) => d !== 'none') })
  const how = aggregatable(c.source) ? c.aggregate : 'count'
  const keyOf = (dim: string, field: string | null | undefined) => (f: (typeof rows)[number]) =>
    dim === 'time' ? timeKey(f.at, c.interval) : dim === 'status' ? (f.status ?? 'none') : dim === 'workflow' ? (f.workflow ?? 'none') : dim === 'form' ? (f.form ?? 'none') : dim === 'assignee' ? (f.person ?? 'none') : dim === 'none' ? 'all' : String(f.data?.[field ?? ''] ?? '—')
  // A sum / average over cells with no numbers (blank values) has no value: the cell is left out (shown as —), never 0.
  const result = pivotCells(rows, keyOf(c.rows, c.row_field), keyOf(c.columns, c.column_field), (list) => { const v = aggregate(list, how, c.value_field); return v === null ? NaN : Math.round(v * 100) / 100 })
  for (const byCol of Object.values(result.cells)) for (const [k, v] of Object.entries(byCol)) if (Number.isNaN(v)) delete byCol[k]
  const finite = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : -Infinity)
  const db = getDb(ctx)
  const label = async (dim: string, keys: string[]): Promise<Point[]> => {
    const names = dim === 'workflow' ? await workflowNames(db, ctx.tenantId, keys) : dim === 'form' ? await formNames(db, ctx.tenantId, keys) : dim === 'assignee' ? await personNames(db, keys) : new Map<string, string>()
    const sorted = dim === 'time' || (dim === 'field' && arePeriodKeys(keys)) ? [...keys].sort() : [...keys].sort((a, b) => finite(result.rowTotals[b] ?? result.colTotals[b]) - finite(result.rowTotals[a] ?? result.colTotals[a]) || a.localeCompare(b))
    return sorted.slice(0, 30).map((k) => ({ key: k, label: dim === 'time' ? bucketLabel(k, c.interval) : k === 'none' ? (dim === 'assignee' ? 'Unassigned' : 'None') : k === 'all' ? 'Total' : names.get(k) ?? STATUS_LABELS[k] ?? k.replace(/_/g, ' ') }))
  }
  // A column dimension is labelled with the column's name ("Calibrated rating"), not its key.
  const tableId = c.source === 'table_rows' ? asId(c.table_id) : null
  const columnNames = new Map<string, string>()
  if (tableId && (c.rows === 'field' || c.columns === 'field')) {
    const table = await getDataTable(ctx, tableId).catch(() => null) as any
    for (const col of ((table?.columns ?? []) as any[])) if (col?.key) columnNames.set(String(col.key), String(col.name ?? col.label ?? col.key))
  }
  const dimLabel = (d: string, f?: string | null) => (d === 'field' ? (f ? columnNames.get(f) ?? humanColumn(f) : 'Column') : d === 'assignee' ? 'Person' : d[0].toUpperCase() + d.slice(1))
  const orNull = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number.isNaN(v) ? null : v]))
  return {
    type: 'pivot', truncated, total: Number.isNaN(result.total) ? null : result.total, cells: result.cells, row_totals: orNull(result.rowTotals), col_totals: orNull(result.colTotals),
    row_label: dimLabel(c.rows, c.row_field), col_label: c.columns === 'none' ? null : dimLabel(c.columns, c.column_field),
    rows: await label(c.rows, Object.keys(result.rowTotals)), cols: await label(c.columns, Object.keys(result.colTotals)),
  }
}

/* ── Charts ──────────────────────────────────────────────────────────── */

const UNIT: Record<string, string> = { tasks: 'tasks', runs: 'runs', submissions: 'submissions', table_rows: 'rows' }

async function metricValue(ctx: ServiceContext, c: any, range: ResolvedRange) {
  const how = aggregatable(c.source) ? c.aggregate : 'count'
  const r = await facts(ctx, c.source, c, range, { dims: ['time'] })
  return { value: aggregate(r.rows, how, c.field), rows: r.rows, truncated: r.truncated, how }
}

async function kpi(ctx: ServiceContext, c: WidgetConfig<'kpi'>) {
  const range = rangeOf(c)
  const effective: ResolvedRange = range.from ? range : { from: new Date(Date.now() - (c.interval === 'month' ? 365 : c.interval === 'week' ? 84 : 30) * DAY), to: range.to }
  const cur = await metricValue(ctx, c, effective)
  const prev = previousRange(effective)
  const before = prev ? (await metricValue(ctx, c, prev)).value : null
  const points = groupFacts(cur.rows, { by: 'time', interval: c.interval, how: cur.how, valueField: c.field, maxGroups: 60 })
  const keys = timeBuckets(effective, c.interval)
  const byKey = new Map(points.map((p) => [p.key, p.value]))
  return {
    type: 'kpi', value: cur.value, previous: before, unit: UNIT[c.source], truncated: cur.truncated,
    change_pct: before && cur.value !== null ? Math.round(((cur.value - before) / Math.abs(before)) * 1000) / 10 : null,
    points: keys.map((k) => ({ key: k, value: byKey.get(k) ?? 0 })),
  }
}

async function goal(ctx: ServiceContext, c: WidgetConfig<'goal'>) {
  const cur = await metricValue(ctx, c, rangeOf(c))
  return { type: 'goal', value: cur.value, target: c.target, pct: cur.value === null ? 0 : Math.round((cur.value / c.target) * 1000) / 10, unit: UNIT[c.source] }
}

async function gauge(ctx: ServiceContext, c: WidgetConfig<'gauge'>) {
  const cur = await metricValue(ctx, c, rangeOf(c))
  return { type: 'gauge', value: cur.value, unit: UNIT[c.source] }
}

async function heatmap(ctx: ServiceContext, c: WidgetConfig<'heatmap'>) {
  const range = rangeOf(c)
  if (c.source === 'tasks' && c.event === 'completed') {
    const { rows, truncated } = await finished(ctx, { ...c, source: 'tasks' })
    return { type: 'heatmap', ...heatmapCells(rows.map((r) => r.end)), total: rows.length, truncated }
  }
  const { rows, truncated } = await facts(ctx, c.source, { ...c, status: 'all' } as Common, range)
  return { type: 'heatmap', ...heatmapCells(rows.map((r) => r.at)), total: rows.length, truncated }
}

/* ── People & org ────────────────────────────────────────────────────── */

const ONLINE_MS = 10 * 60_000

async function teamMembers(ctx: ServiceContext, c: WidgetConfig<'team_members'>) {
  const db = getDb(ctx) as any
  const userId = me(ctx)
  const mine = (await myTeams(db, ctx.tenantId, userId)).filter((t) => UUID_RE.test(t))
  const requested = c.team === 'my_teams' || !c.team ? mine : [asId(c.team)].filter((t): t is string => !!t)
  // Without View members: only teams the viewer is in.
  const teams = hasPerm(ctx, 'team.view_members') ? requested : requested.filter((t) => mine.includes(t))
  if (!teams.length) return { type: 'team_members', team: null, members: [] }
  const { data, error } = await db.from('user_teams').select('user_id, team:teams!inner(id, name, tenant_id)').in('team_id', teams).eq('team.tenant_id', ctx.tenantId).limit(500)
  if (error) throw dbError(error)
  const ids = [...new Set(((data ?? []) as any[]).map((r) => String(r.user_id)))]
  const { data: users } = ids.length ? await db.from('users').select('id, display_name, email, avatar_url, last_seen_at').in('id', ids) : { data: [] }
  const counts = new Map<string, { open: number; overdue: number }>()
  if (c.show_workload && ids.length && (hasPerm(ctx, 'tasks.view_all') || hasPerm(ctx, 'tasks.view_own'))) {
    const scope = await taskScope(ctx, db)
    const { data: tasks } = await tasksQuery(ctx, db, scope, { status: 'open' }, 'assignee_id, due_date').in('assignee_id', ids).limit(AGGREGATE_ROW_CAP)
    const now = Date.now()
    for (const t of (tasks ?? []) as any[]) {
      const e = counts.get(t.assignee_id) ?? { open: 0, overdue: 0 }
      e.open++
      if (t.due_date && new Date(t.due_date).getTime() < now) e.overdue++
      counts.set(t.assignee_id, e)
    }
  }
  const now = Date.now()
  const teamName = ((data ?? []) as any[])[0]?.team?.name ?? null
  return {
    type: 'team_members', team: teams.length === 1 ? teamName : null,
    members: ((users ?? []) as any[]).map((u) => ({
      id: String(u.id), name: personLabel(u), email: u.email ?? null, avatar: u.avatar_url ?? null,
      last_seen: c.show_presence ? u.last_seen_at ?? null : null, online: c.show_presence && !!u.last_seen_at && now - new Date(u.last_seen_at).getTime() < ONLINE_MS,
      ...(counts.get(String(u.id)) ?? { open: 0, overdue: 0 }),
    })).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)).slice(0, c.limit),
  }
}

const orgCard = (p: any): OrgCard => ({ id: String(p.id), name: personLabel(p), email: p.email ?? null, avatar: p.avatar_url ?? null, job_title: p.job_title ?? null, department: p.department ?? null })

async function orgChart(ctx: ServiceContext, c: WidgetConfig<'org_chart'>) {
  if (!hasPerm(ctx, 'org.view')) throw ServiceError.forbidden('You don’t have access to the org chart')
  const org = await import('./org')
  const who = c.person === 'me' || !c.person ? 'me' : asId(c.person) ?? 'me'
  const person = await org.getPerson(ctx, who) as any
  let reports: Array<OrgCard & { depth: number }> = ((person.direct_reports ?? []) as any[]).map((p) => ({ ...orgCard(p), depth: 1 }))
  if (c.depth > 1) {
    const subs = await org.getSubordinates(ctx, person.id, { depth: 'all' }) as any
    reports = ((subs.people ?? []) as any[]).filter((p) => p.depth <= c.depth).map((p) => ({ ...orgCard(p), depth: p.depth })).slice(0, 200)
  }
  return { type: 'org_chart', person: orgCard(person), managers: ((person.manager_chain ?? []) as any[]).slice(0, 3).map(orgCard), peers: ((person.peers ?? []) as any[]).slice(0, 20).map(orgCard), reports }
}

async function peopleDirectory(ctx: ServiceContext, c: WidgetConfig<'people_directory'>, extra: WidgetExtra) {
  const db = getDb(ctx) as any
  const userId = me(ctx)
  const page = Math.max(0, Math.floor(Number(extra.params.page ?? 0)) || 0)
  const q = SAFE_SEARCH(extra.params.q).replace(/[%,()_\\]/g, ' ').trim()
  if (!hasPerm(ctx, 'team.view_members')) {
    const { data } = await db.from('users').select('id, display_name, email, avatar_url').eq('id', userId).maybeSingle()
    return { type: 'people_directory', people: data ? [orgCard(data)] : [], total: data ? 1 : 0, next: null }
  }
  let query = db.from('user_memberships').select('user_id, job_title, department, user:users!inner(id, display_name, email, avatar_url)', { count: 'exact' }).eq('tenant_id', ctx.tenantId).eq('is_active', true)
  const team = c.team === 'my_teams' ? (await myTeams(db, ctx.tenantId, userId)) : asId(c.team) ? [asId(c.team)!] : null
  if (team) {
    const { data: members } = await db.from('user_teams').select('user_id').in('team_id', team.length ? team : ['00000000-0000-0000-0000-000000000000'])
    query = query.in('user_id', [...new Set(((members ?? []) as any[]).map((m) => m.user_id))].slice(0, 1000))
  }
  if (q) query = query.or(`display_name.ilike.%${q}%,email.ilike.%${q}%`, { referencedTable: 'user' })
  const { data, count, error } = await query.order('user_id').range(page * c.limit, page * c.limit + c.limit - 1)
  if (error) throw dbError(error)
  const people = ((data ?? []) as any[]).filter((m) => m.user).map((m) => orgCard({ ...m.user, job_title: m.job_title, department: m.department }))
  const total = count ?? people.length
  return { type: 'people_directory', people, total, next: (page + 1) * c.limit < total ? page + 1 : null }
}

/* ── Activity ────────────────────────────────────────────────────────── */

async function activityFeed(ctx: ServiceContext, c: WidgetConfig<'activity_feed'>) {
  const db = getDb(ctx) as any
  const items: Array<{ id: string; kind: 'task' | 'run' | 'submission' | 'audit'; title: string; subtitle: string | null; at: string; href: string | null }> = []
  const range = rangeOf(c)
  const jobs: Promise<void>[] = []
  if (c.sources.includes('tasks') && (hasPerm(ctx, 'tasks.view_own') || hasPerm(ctx, 'tasks.view_all'))) jobs.push((async () => {
    const scope = await taskScope(ctx, db)
    const { data } = await withRange(tasksQuery(ctx, db, scope, { workflow_id: c.workflow_id, assignee: c.person, status: 'all' }, 'id, title, status, updated_at, completed_at'), 'updated_at', range).order('updated_at', { ascending: false }).limit(c.limit)
    for (const t of (data ?? []) as any[]) items.push({ id: `t:${t.id}`, kind: 'task', title: String(t.title || 'Task'), subtitle: t.status === 'completed' ? 'Completed' : `Updated · ${STATUS_LABELS[t.status] ?? t.status}`, at: t.completed_at ?? t.updated_at, href: `/tasks/${t.id}` })
  })())
  if (c.sources.includes('runs')) jobs.push((async () => {
    const access = await runAccess(ctx)
    const { data } = await runsQuery(ctx, db, access, { workflow_id: c.workflow_id, person: c.person, date_range: c.date_range }, 'id, title, status, started_at, completed_at, workflow_id').order('started_at', { ascending: false }).limit(c.limit)
    const rows = (data ?? []) as any[]
    const names = await workflowNames(db, ctx.tenantId, rows.map((r) => r.workflow_id))
    for (const r of rows) items.push({ id: `r:${r.id}`, kind: 'run', title: String(r.title || names.get(r.workflow_id) || 'Workflow run'), subtitle: `${r.completed_at ? (r.status === 'failed' ? 'Failed' : 'Finished') : 'Started'} · ${names.get(r.workflow_id) ?? 'Workflow'}`, at: r.completed_at ?? r.started_at, href: `/home/runs/${r.id}` })
  })())
  if (c.sources.includes('submissions') && (hasPerm(ctx, 'forms.submit') || hasPerm(ctx, 'forms.edit'))) jobs.push((async () => {
    const { data } = await submissionsQuery(ctx, db, { person: c.person, date_range: c.date_range }, 'id, form_name, submitted_by, created_at').order('created_at', { ascending: false }).limit(c.limit)
    const rows = (data ?? []) as any[]
    const people = await personNames(db, rows.map((r) => r.submitted_by))
    for (const r of rows) items.push({ id: `s:${r.id}`, kind: 'submission', title: String(r.form_name || 'Form submission'), subtitle: `Submitted${people.get(r.submitted_by) ? ` by ${people.get(r.submitted_by)}` : ''}`, at: r.created_at, href: null })
  })())
  if (c.sources.includes('audit') && hasPerm(ctx, 'settings.view')) jobs.push((async () => {
    const { data } = await withRange(db.from('object_audit_log').select('id, summary, action, object_type, created_at').eq('tenant_id', ctx.tenantId), 'created_at', range).order('created_at', { ascending: false }).limit(c.limit)
    for (const a of (data ?? []) as any[]) items.push({ id: `a:${a.id}`, kind: 'audit', title: String(a.summary || `${a.action} ${a.object_type}`), subtitle: String(a.object_type ?? '').replace(/_/g, ' ') || null, at: a.created_at, href: null })
  })())
  await Promise.all(jobs.map((j) => j.catch(() => undefined)))
  return { type: 'activity_feed', items: items.filter((i) => i.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, c.limit) }
}

/* ── Button badges ───────────────────────────────────────────────────── */

/** Live counts for the badges a Buttons widget shows (as the viewer; a count they can't read is left out). */
export async function actionBadges(ctx: ServiceContext, config: WidgetConfig<'actions'>): Promise<{ type: 'badges'; counts: Partial<Record<BadgeSource, number>> }> {
  const wanted = [...new Set(config.buttons.map((b) => b.badge).filter((b): b is BadgeSource => !!b))]
  return { type: 'badges', counts: await badgeCounts(ctx, wanted) }
}

export async function badgeCounts(ctx: ServiceContext, wanted: readonly BadgeSource[]): Promise<Partial<Record<BadgeSource, number>>> {
  const counts: Partial<Record<BadgeSource, number>> = {}
  if (!wanted.length) return counts
  const db = getDb(ctx)
  await Promise.all(wanted.map(async (source) => {
    try {
      if (source === 'my_tasks' || source === 'overdue' || source === 'queue') {
        const scope = await taskScope(ctx, db)
        let q = tasksQuery(ctx, db, scope, { scope: source === 'queue' ? 'all' : 'mine', status: 'open' }, 'id', { count: true })
        if (source === 'overdue') q = q.lt('due_date', new Date().toISOString())
        if (source === 'queue') {
          const parts = [`and(assignee_id.eq.${scope.userId},acceptance_status.eq.pending)`]
          if (scope.teams.length) parts.push(`and(assignee_id.is.null,assigned_team_id.in.(${scope.teams.join(',')}))`)
          q = q.or(parts.join(','))
        }
        const { count } = await q.limit(1)
        counts[source] = count ?? 0
      } else if (source === 'my_submissions') {
        const { count } = await submissionsQuery(ctx, db, { person: 'me' }, 'id', { count: true }).limit(1)
        counts[source] = count ?? 0
      } else if (source === 'running_runs') {
        const access = await runAccess(ctx)
        const { count } = await runsQuery(ctx, db, access, { status: 'open' }, 'id', { count: true }).limit(1)
        counts[source] = count ?? 0
      }
    } catch { /* not readable for this viewer: no badge */ }
  }))
  return counts
}

export { resolveDateRange }
