/**
 * Global search (header search box) and data-row search, run server-side
 * as the signed-in user: the same ILIKE queries the browser ran (tasks.title
 * uses the pg_trgm index idx_tasks_title_trgm; row content goes through
 * search_custom_table_rows), with RLS deciding visibility exactly as before.
 * Each category is also gated on the permission of the area it links to.
 */

import { escapeLikePattern } from '@/lib/utils'
import { getDb, hasPerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- search rows */

const TASK_STATUSES: Record<string, string> = {
  todo: 'To Do', in_progress: 'In Progress', blocked: 'Blocked', completed: 'Completed', cancelled: 'Cancelled',
}
const TASK_PRIORITIES: Record<string, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', none: 'None',
}
const TASK_COLUMNS = 'id, title, status, priority, due_date, assignee:users!tasks_assignee_id_fkey(display_name)'

export interface GlobalSearchResults {
  /** Title matches, then description matches, then status/priority keyword matches (deduplicated). */
  tasks: Array<Record<string, any>>
  workflows: Array<Record<string, any>>
  agents: Array<Record<string, any>>
  integrations: Array<Record<string, any>>
  tables: Array<Record<string, any>>
  /** { id, table_id, data, table_name } rows whose content matches. */
  tableRows: Array<Record<string, any>>
  members: Array<Record<string, any>>
}

const EMPTY = { data: [] as any[], error: null }

function normalizeQuery(raw: unknown, min = 2): string {
  const q = String(raw ?? '').trim()
  if (q.length < min) throw ServiceError.validation(`Search for at least ${min} characters`)
  return q.slice(0, 200)
}

function keyword(map: Record<string, string>, lowerQ: string): string | null {
  const hit = Object.entries(map).find(([key, label]) => label.toLowerCase().includes(lowerQ) || key.includes(lowerQ))
  return hit ? hit[0] : null
}

function rows(result: { data: unknown; error: { message?: string } | null }) {
  if (result.error) throw dbError(result.error)
  return (result.data ?? []) as Array<Record<string, any>>
}

export async function globalSearch(ctx: ServiceContext, rawQuery: string): Promise<GlobalSearchResults> {
  const q = normalizeQuery(rawQuery)
  const db = getDb(ctx) as any
  // Escaped: commas/parens break .or() parsing; %/_ are LIKE wildcards.
  const pattern = `%${escapeLikePattern(q)}%`
  const lowerQ = q.toLowerCase()
  const canTasks = hasPerm(ctx, 'tasks.view_own') || hasPerm(ctx, 'tasks.view_all')
  const canData = hasPerm(ctx, 'data.view')
  const tasksBy = (column: 'title' | 'description', limit: number) => db.from('tasks')
    .select(TASK_COLUMNS).ilike(column, pattern).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(limit)
  const status = keyword(TASK_STATUSES, lowerQ)
  const priority = keyword(TASK_PRIORITIES, lowerQ)

  const [byTitle, byDescription, byStatus, byPriority, workflows, agents, integrations, tables, tableRows, members] = await Promise.all([
    canTasks ? tasksBy('title', 6) : EMPTY,
    canTasks ? tasksBy('description', 3) : EMPTY,
    canTasks && status ? db.from('tasks').select(TASK_COLUMNS).is('deleted_at', null).eq('status', status).order('created_at', { ascending: false }).limit(5) : EMPTY,
    canTasks && priority ? db.from('tasks').select(TASK_COLUMNS).is('deleted_at', null).eq('priority', priority).order('created_at', { ascending: false }).limit(5) : EMPTY,
    hasPerm(ctx, 'workflows.view')
      ? db.from('workflows').select('id, name, is_active, trigger_type').ilike('name', pattern).order('updated_at', { ascending: false }).limit(4)
      : EMPTY,
    hasPerm(ctx, 'agents.view')
      ? db.from('agents').select('id, name, is_active').ilike('name', pattern).order('updated_at', { ascending: false }).limit(4)
      : EMPTY,
    hasPerm(ctx, 'integrations.view')
      ? db.from('integrations').select('id, name, type, is_active').ilike('name', pattern).order('name').limit(4)
      : EMPTY,
    canData ? db.from('custom_tables').select('id, name').ilike('name', pattern).order('name').limit(4) : EMPTY,
    canData ? db.rpc('search_custom_table_rows', { q, lim: 6 }) : EMPTY,
    hasPerm(ctx, 'team.view_members')
      ? db.from('users').select('id, display_name, email').eq('tenant_id', ctx.tenantId).is('deleted_at', null).ilike('display_name', pattern).order('display_name').limit(4)
      : EMPTY,
  ])

  const seen = new Set<string>()
  const tasks = [byTitle, byDescription, byStatus, byPriority].flatMap(rows).filter((task) => {
    if (seen.has(task.id)) return false
    seen.add(task.id)
    return true
  })
  return {
    tasks,
    workflows: rows(workflows),
    agents: rows(agents),
    integrations: rows(integrations),
    tables: rows(tables),
    tableRows: rows(tableRows),
    members: rows(members),
  }
}

/** Rows whose content matches (data tables list search), up to `limit`. */
export async function searchDataTableRows(ctx: ServiceContext, rawQuery: string, limit = 50) {
  if (!hasPerm(ctx, 'data.view')) throw ServiceError.forbidden("Forbidden: you lack the 'data.view' permission")
  const q = normalizeQuery(rawQuery)
  const { data, error } = await (getDb(ctx) as any).rpc('search_custom_table_rows', { q, lim: Math.min(Math.max(Math.trunc(limit) || 50, 1), 200) })
  if (error) throw dbError(error)
  return (data ?? []) as Array<{ id: string; table_id: string; data: Record<string, unknown>; table_name: string }>
}
