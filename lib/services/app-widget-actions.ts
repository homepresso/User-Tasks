/**
 * Writes from app widgets: moving a Kanban card, editing a data grid cell,
 * asking an agent, claiming the next task, and Quick search reads. Each
 * checks the widget is on the page AS THE VIEWER MAY SEE IT (governance
 * already removed it, or turned drag / editing off, for anyone who may not
 * act — lib/apps/governance.ts presentLayout), then calls the object's own
 * service, which authorises the write as it does everywhere else
 * (tasks.complete, data.manage_rows, agents.test, claiming rules).
 */

import type { AppWidget, WidgetConfig } from '@/lib/apps/schema'
import { hasPerm, ServiceError, getDb, type ServiceContext } from './context'
import { dbError } from './_shared'
import { getPresentedPage, getViewerAppRole, getAppPageView, type PreviewOptions } from './apps'
import { claimTask, myTeams } from './home'
import { completeStandardTask, updateTask } from './tasks'
import { deleteRows, updateRow } from './data-tables'
import { enqueueAgentRun, getAgentQueueJob } from './agents'
import { widgetBindings } from '@/lib/apps/governance'
import { gridViewSchema, readViews, upsertView, viewsKey, writeViews, type GridView } from '@/lib/apps/grid-views'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const KANBAN_STATUSES = ['todo', 'in_progress', 'blocked', 'completed', 'cancelled'] as const

/** Editors previewing the draft send `draft` (and `as_role`): the widget is looked up on the draft page. */
type Preview = { draft?: boolean | null; as_role?: 'viewer' | 'contributor' | null }
const previewOf = (input: Preview): PreviewOptions => ({ draft: !!input.draft, as_role: input.as_role ?? null })

async function widgetOnPage<T extends AppWidget['type']>(ctx: ServiceContext, app: string, page: string, widgetId: string, type: T, preview: Preview = {}): Promise<AppWidget<T>> {
  if (ctx.authKind !== 'session') throw ServiceError.forbidden('App widgets act as the signed-in person')
  const presented = await getPresentedPage(ctx, app, page, previewOf(preview))
  const widget = presented.layout.widgets.find((w) => w.id === widgetId)
  if (!widget || widget.type !== type) throw ServiceError.notFound('Widget not found')
  return widget as AppWidget<T>
}

/** Move a Kanban card to another status column. */
export async function moveKanbanTask(ctx: ServiceContext, input: { app: string; page: string; widget_id: string; task_id: string; status: string } & Preview) {
  const widget = await widgetOnPage(ctx, input.app, input.page, input.widget_id, 'kanban', input)
  const c = widget.config as WidgetConfig<'kanban'>
  if (!c.allow_drag) throw ServiceError.forbidden('You can’t change task statuses here')
  if (!(c.columns as readonly string[]).includes(input.status)) throw ServiceError.validation('That column isn’t on this board')
  if (!UUID_RE.test(input.task_id)) throw ServiceError.notFound('Task not found')
  if (input.status === 'completed') return completeStandardTask(ctx, input.task_id, { outcome: 'Completed' })
  return updateTask(ctx, input.task_id, { status: input.status } as any)
}

/** Move a card of a data table board to another lane: writes the board's lane column (Manage rows, as any row write). */
export async function moveKanbanRow(ctx: ServiceContext, input: { app: string; page: string; widget_id: string; row_id: string; lane: string } & Preview) {
  const widget = await widgetOnPage(ctx, input.app, input.page, input.widget_id, 'kanban', input)
  const c = widget.config as WidgetConfig<'kanban'>
  if (c.source !== 'table' || !c.lane_column) throw ServiceError.notFound('Widget not found')
  if (!c.allow_drag) throw ServiceError.forbidden('You can’t move cards here')
  const tableId = typeof c.table_id === 'string' && UUID_RE.test(c.table_id) ? c.table_id : null
  if (!tableId) throw ServiceError.validation('This board has no data table')
  if ((await getViewerAppRole(ctx, input.app, previewOf(input))) === 'viewer') throw ServiceError.forbidden('Viewers can’t move cards')
  const { getDataTable } = await import('./data-tables')
  const { boardLanes } = await import('./app-widgets-more')
  const table = await getDataTable(ctx, tableId) as any
  if (!boardLanes(c, Array.isArray(table?.columns) ? table.columns : []).includes(input.lane)) throw ServiceError.validation('That lane isn’t on this board')
  return updateRow(ctx, tableId, input.row_id, { [c.lane_column]: input.lane })
}

/** Save one row's cells from a data grid widget (editable for this viewer). */
export async function updateGridRow(ctx: ServiceContext, input: { app: string; page: string; widget_id: string; row_id: string; cells: Record<string, unknown> } & Preview) {
  const widget = await widgetOnPage(ctx, input.app, input.page, input.widget_id, 'data_grid', input)
  const c = widget.config as WidgetConfig<'data_grid'>
  if (!c.editable) throw ServiceError.forbidden('This grid is read-only for you')
  const tableId = typeof c.table_id === 'string' && UUID_RE.test(c.table_id) ? c.table_id : null
  if (!tableId) throw ServiceError.validation('This grid has no data table')
  // Only the grid's own columns.
  const allowed = c.columns.length ? new Set(c.columns) : null
  const cells = Object.fromEntries(Object.entries(input.cells ?? {}).filter(([k]) => !allowed || allowed.has(k)).slice(0, 30))
  if (!Object.keys(cells).length) throw ServiceError.validation('Nothing to save')
  return updateRow(ctx, tableId, input.row_id, cells)
}

/** Most rows one bulk delete from a data grid removes. */
export const GRID_BULK_DELETE_MAX = 100

/**
 * Delete the rows a viewer selected in a data grid (the grid allows it, and
 * governance left it on: Manage rows on the table and an acting app role).
 * Only ids of the grid's own table are deleted (others are ignored by the
 * data table service, which checks Manage rows again and queues the
 * deletions as everywhere else: stored files removed, "deleted" workflows run).
 */
export async function deleteGridRows(ctx: ServiceContext, input: { app: string; page: string; widget_id: string; row_ids: string[] } & Preview) {
  const widget = await widgetOnPage(ctx, input.app, input.page, input.widget_id, 'data_grid', input)
  const c = widget.config as WidgetConfig<'data_grid'>
  if (!c.allow_delete) throw ServiceError.forbidden('You can’t delete rows here')
  if ((await getViewerAppRole(ctx, input.app, previewOf(input))) === 'viewer') throw ServiceError.forbidden('Viewers can’t delete rows')
  const tableId = typeof c.table_id === 'string' && UUID_RE.test(c.table_id) ? c.table_id : null
  if (!tableId) throw ServiceError.validation('This grid has no data table')
  const ids = [...new Set((Array.isArray(input.row_ids) ? input.row_ids : []).map((id) => String(id)))]
  if (!ids.length || ids.some((id) => !UUID_RE.test(id))) throw ServiceError.validation('Choose the rows to delete')
  if (ids.length > GRID_BULK_DELETE_MAX) throw ServiceError.validation(`At most ${GRID_BULK_DELETE_MAX} rows at a time`)
  return deleteRows(ctx, tableId, ids)
}

/* ── Personal saved views of a data grid (the person's own users.preferences; lib/apps/grid-views.ts) ── */

type GridRef = { app: string; page: string; widget_id: string } & Preview

async function gridWithViews(ctx: ServiceContext, input: GridRef) {
  const widget = await widgetOnPage(ctx, input.app, input.page, input.widget_id, 'data_grid', input)
  if (!(widget.config as WidgetConfig<'data_grid'>).personal_views) throw ServiceError.forbidden('This grid has no saved views')
  if (!ctx.actorId) throw ServiceError.forbidden('Sign in to save views')
  return viewsKey(ctx.tenantId, input.app, input.page, input.widget_id)
}

async function myPreferences(ctx: ServiceContext): Promise<unknown> {
  const { data, error } = await (getDb(ctx) as any).from('users').select('preferences').eq('id', ctx.actorId).maybeSingle()
  if (error) throw dbError(error)
  return data?.preferences ?? {}
}

async function storeViews(ctx: ServiceContext, key: string, prefs: unknown, views: GridView[]): Promise<GridView[]> {
  const { error } = await (getDb(ctx) as any).from('users').update({ preferences: writeViews(prefs, key, views) }).eq('id', ctx.actorId)
  if (error) throw dbError(error)
  return views
}

/** The signed-in person's saved views of a grid. */
export async function listGridViews(ctx: ServiceContext, input: GridRef): Promise<{ views: GridView[] }> {
  const key = await gridWithViews(ctx, input)
  return { views: readViews(await myPreferences(ctx), key) }
}

/** Save (add or replace by id / name) one of the person's views of a grid. */
export async function saveGridView(ctx: ServiceContext, input: GridRef & { view: unknown }): Promise<{ views: GridView[] }> {
  const key = await gridWithViews(ctx, input)
  const parsed = gridViewSchema.safeParse(input.view)
  if (!parsed.success) throw ServiceError.validation('That view isn’t valid: give it a name (60 characters at most)')
  const prefs = await myPreferences(ctx)
  let views: GridView[]
  try { views = upsertView(readViews(prefs, key), parsed.data) } catch (e) { throw ServiceError.validation((e as Error).message) }
  return { views: await storeViews(ctx, key, prefs, views) }
}

/** Delete one of the person's views of a grid. */
export async function deleteGridView(ctx: ServiceContext, input: GridRef & { id: string }): Promise<{ views: GridView[] }> {
  const key = await gridWithViews(ctx, input)
  const prefs = await myPreferences(ctx)
  return { views: await storeViews(ctx, key, prefs, readViews(prefs, key).filter((v) => v.id !== input.id)) }
}

/** Send a message to the agent an "Ask an agent" widget is bound to; returns the queued job. */
export async function askAgent(ctx: ServiceContext, input: { app: string; page: string; widget_id: string; message: string; history?: Array<{ role: 'user' | 'agent'; text: string }> } & Preview) {
  const widget = await widgetOnPage(ctx, input.app, input.page, input.widget_id, 'agent_chat', input)
  const agentId = (widget.config as WidgetConfig<'agent_chat'>).agent_id
  if (typeof agentId !== 'string' || !UUID_RE.test(agentId)) throw ServiceError.validation('This widget has no agent')
  const history = (input.history ?? []).slice(-8).map((h) => `${h.role === 'user' ? 'User' : 'Agent'}: ${String(h.text).slice(0, 2000)}`).join('\n')
  const message = String(input.message ?? '').slice(0, 4000)
  return enqueueAgentRun(ctx, agentId, { message: history ? `${history}\nUser: ${message}` : message })
}

/** The state of an agent job the viewer started from a widget. */
export async function agentReply(ctx: ServiceContext, input: { app: string; page: string; widget_id: string; job_id: string } & Preview) {
  await widgetOnPage(ctx, input.app, input.page, input.widget_id, 'agent_chat', input)
  const { job } = await getAgentQueueJob(ctx, input.job_id) as any
  if (job.created_by && job.created_by !== ctx.actorId) throw ServiceError.notFound('Job not found')
  const result = job.result ?? null
  const text = typeof result === 'string' ? result : result?.final_response ?? result?.response ?? result?.output ?? result?.text ?? null
  return { status: String(job.status), text: text ? String(text).slice(0, 20_000) : null, error: job.error ? String(job.error).slice(0, 500) : null }
}

/** Claim the oldest unassigned task of the viewer's teams (or one team) — a Buttons "claim next" action. */
export async function claimNext(ctx: ServiceContext, input: { app: string; page: string; widget_id: string; index: number } & Preview) {
  const widget = await widgetOnPage(ctx, input.app, input.page, input.widget_id, 'actions', input)
  const button = (widget.config as WidgetConfig<'actions'>).buttons[input.index]
  if (!button || button.action.kind !== 'claim_next') throw ServiceError.notFound('Button not found')
  const team = button.action.team
  if (!hasPerm(ctx, 'tasks.complete')) throw ServiceError.forbidden('You can’t claim tasks')
  const db = getDb(ctx) as any
  const mine = (await myTeams(db, ctx.tenantId, ctx.actorId!)).filter((t) => UUID_RE.test(t))
  const teams = team === 'my_teams' ? mine : mine.filter((t) => t === team)
  if (!teams.length) throw ServiceError.validation('There’s no team queue for you here')
  const { data, error } = await db.from('tasks').select('id').eq('tenant_id', ctx.tenantId).is('deleted_at', null).is('assignee_id', null)
    .in('assigned_team_id', teams).in('status', ['todo', 'in_progress', 'blocked']).order('due_date', { ascending: true, nullsFirst: false }).order('created_at').limit(1)
  if (error) throw dbError(error)
  const next = ((data ?? []) as any[])[0]
  if (!next) return { claimed: null as string | null }
  await claimTask(ctx, next.id)
  return { claimed: String(next.id) }
}

export interface QuickSearchHit { kind: 'page' | 'form' | 'workflow' | 'table' | 'report' | 'task'; id: string; title: string; hint: string | null; href: string | null }

/**
 * Quick search: the app's pages and the objects its pages point at that the
 * viewer may use (taken from the pages as presented to them), plus their own
 * visible tasks by title.
 */
export async function quickSearch(ctx: ServiceContext, input: { app: string; q: string; include: string[] } & Preview): Promise<{ hits: QuickSearchHit[] }> {
  const q = String(input.q ?? '').trim().toLowerCase().slice(0, 100)
  if (!q) return { hits: [] }
  const include = new Set(input.include)
  const preview = previewOf(input)
  const { app } = await getAppPageView(ctx, input.app, null, preview.draft ? 'preview' : 'view', { as_role: preview.as_role })
  const role = await getViewerAppRole(ctx, input.app, preview)
  const hits: QuickSearchHit[] = []
  if (include.has('pages')) for (const p of app.pages) if (p.title.toLowerCase().includes(q)) hits.push({ kind: 'page', id: p.slug, title: p.title, hint: p.hidden ? 'Page (opened from buttons)' : 'Page', href: `/apps/${app.slug}/${p.slug}` })
  const want = (['form', 'workflow', 'table', 'report'] as const).filter((k) => include.has(`${k}s`))
  if (want.length) {
    const ids: Record<string, Set<string>> = { form: new Set(), workflow: new Set(), data_table: new Set(), report: new Set() }
    const pages = await Promise.all(app.pages.map((p) => getPresentedPage(ctx, app.id, p.slug, preview).catch(() => null)))
    for (const page of pages) for (const w of page?.layout.widgets ?? []) for (const o of widgetBindings(w).objects) if (o.kind in ids && (!o.action || role !== 'viewer')) ids[o.kind].add(o.id)
    const db = getDb(ctx) as any
    const table = { form: 'forms', workflow: 'workflows', table: 'custom_tables', report: 'reports' } as const
    const key = { form: 'form', workflow: 'workflow', table: 'data_table', report: 'report' } as const
    await Promise.all(want.map(async (k) => {
      const list = [...ids[key[k]]]
      if (!list.length) return
      const { data } = await db.from(table[k]).select('id, name').eq('tenant_id', ctx.tenantId).in('id', list).ilike('name', `%${q.replace(/[%_\\]/g, '')}%`).limit(10)
      for (const r of (data ?? []) as any[]) hits.push({ kind: k, id: r.id, title: String(r.name), hint: k === 'table' ? 'Data table' : k[0].toUpperCase() + k.slice(1), href: k === 'table' ? `/data/${r.id}` : k === 'report' ? `/reports/${r.id}` : k === 'form' ? `/fill/${r.id}` : null })
    }))
  }
  if (include.has('tasks') && (hasPerm(ctx, 'tasks.view_own') || hasPerm(ctx, 'tasks.view_all'))) {
    const { taskScope, tasksQuery } = await import('./app-widgets')
    const db = getDb(ctx)
    const scope = await taskScope(ctx, db)
    const { data } = await tasksQuery(ctx, db, scope, { status: 'open' }, 'id, title, status').ilike('title', `%${q.replace(/[%_\\]/g, '')}%`).limit(10)
    for (const t of (data ?? []) as any[]) hits.push({ kind: 'task', id: t.id, title: String(t.title || 'Task'), hint: 'Task', href: `/tasks/${t.id}` })
  }
  return { hits: hits.slice(0, 30) }
}
