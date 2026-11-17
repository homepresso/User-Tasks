/**
 * Server-side task search — one implementation behind the app's
 * "Open | Completed | All" views of My tasks and Following
 * (`tasks.search`, components/tasks/task-search-list.tsx) and the embeddable
 * task list (lib/services/embed-tasks.ts → /embed/tasks, every tab).
 * Nothing is loaded into the browser beyond one page.
 *
 * Who sees what — the app's own rules, per tab:
 *  - mine: assigned to me, a collaborative task I'm on, a task I completed
 *    (actioned_by — "completed by me"); view groups / all as the unified list
 *    (my teams' unclaimed tasks, AAD claim candidates; all = everything with
 *    tasks.view_all);
 *  - following: the app's Following set (followed directly, through a run I
 *    follow, shared with me — task-follows followedTaskIdSet);
 *  - tracker: scope all / assigned_by_me / team (tasks.view_all, as the app's
 *    `tasks.assigned`) or reports (my reporting line, manager-tasks).
 *
 * Then: status (open | completed | any), search (title, task id, workflow
 * name, requester), priority, due window, completed window, workflow,
 * assignee, team, unread (task_unread_ids), sort (due, priority, created,
 * updated, completed, title; asc / desc; id breaks ties) with keyset paging
 * (`cursor`) — offset paging for the title sort — and a count that stops at
 * SEARCH_COUNT_CAP: 1,000 or more reads as "1,000+".
 */

import { dbError, ilikeTerm, serviceRoleClient } from './_shared'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { queueSources } from './home'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const OPEN_TASK_STATUSES = ['todo', 'in_progress', 'blocked'] as const
export const SEARCH_COUNT_CAP = 1000
/** in=(…) lists stay well under URL limits; beyond them the set is cut. */
const MAX_IN_IDS = 1000
const UNREAD_CANDIDATES = 5000

export type SearchTab = 'mine' | 'following' | 'tracker'
export type SearchScope = 'all' | 'assigned_by_me' | 'team' | 'reports'
export type SearchSort = 'due' | 'priority' | 'created' | 'updated' | 'completed' | 'title'

export interface TaskSearchInput {
  tab: SearchTab
  /** mine: whose tasks (mine | groups | all). */
  view?: 'mine' | 'groups' | 'all'
  /** tracker: the scope wanted (null: the first this person has). */
  scope?: SearchScope | null
  status: 'open' | 'completed' | 'any'
  q?: string
  priority?: string[]
  /** Due window [from, to). */
  due?: { from: string | null; to: string | null } | null
  /** Completed window [from, to). */
  completed?: { from: string | null; to: string | null } | null
  /** Host scope: only these workflows (empty: nothing); a workflow tag narrows it. */
  workflowIds?: string[] | null
  tag?: string | null
  workflowId?: string | null
  assigneeId?: string | null
  teamId?: string | null
  unread?: boolean
  sort: SearchSort
  dir: 'asc' | 'desc'
  size: number
  /** Keyset position (from the previous page's nextCursor). */
  cursor?: string | null
  /** 1-based page, for the title sort (offset). */
  page?: number
  /** Extra columns to select (the caller's row shape). */
  columns: string
}

export interface TaskSearchResult {
  rows: any[]
  /** Matching tasks, capped at SEARCH_COUNT_CAP (`capped`: that many or more). */
  total: number
  capped: boolean
  /** The next page's cursor (null: last page, or the title sort pages by `page`). */
  nextCursor: string | null
  scopes?: SearchScope[]
  scope?: SearchScope | null
  /** The queue sources of the caller (row actions reuse them). */
  queue: { teams: string[]; collabIds: string[]; candidateIds: string[] }
}

const SORT_COLUMN: Record<SearchSort, string> = { due: 'due_date', priority: 'priority', created: 'created_at', updated: 'updated_at', completed: 'completed_at', title: 'title' }
const inList = (ids: string[]) => ids.filter((id) => UUID_RE.test(id)).join(',')

/** Task tracker scopes this person has (the app's rules: tasks.view_all for the tracker views, a reporting line for "My reports"). */
export async function searchScopes(ctx: ServiceContext): Promise<SearchScope[]> {
  const out: SearchScope[] = []
  if (hasPerm(ctx, 'tasks.view_all')) out.push('all', 'assigned_by_me', 'team')
  const { isManager } = await import('./manager-tasks')
  if (await isManager(ctx).catch(() => false)) out.push('reports')
  return out
}

interface Visibility { or?: string; ids?: string[]; assignees?: string[]; assigner?: string; none?: boolean }

async function visibility(ctx: ServiceContext, db: AnySupabaseClient, me: string, input: TaskSearchInput, scope: SearchScope | null, queue: TaskSearchResult['queue']): Promise<Visibility> {
  if (input.tab === 'mine') {
    const { data: assigneeRows } = await (db as any).from('task_assignees').select('task_id').eq('tenant_id', ctx.tenantId).eq('user_id', me).limit(500)
    const onTask = [...new Set(((assigneeRows ?? []) as any[]).map((r) => String(r.task_id ?? '')))]
    // "Completed by me" counts too: tasks I actioned that are no longer assigned to me.
    const mineParts = [`assignee_id.eq.${me}`, `actioned_by.eq.${me}`, ...(inList(onTask) ? [`id.in.(${inList(onTask)})`] : [])]
    const groupParts = [
      `and(assignee_id.eq.${me},assigned_team_id.not.is.null)`,
      ...(inList(queue.teams) ? [`and(assignee_id.is.null,assigned_team_id.in.(${inList(queue.teams)}))`] : []),
      ...(inList(queue.candidateIds) ? [`and(assignee_id.is.null,id.in.(${inList(queue.candidateIds)}))`] : []),
    ]
    const view = input.view ?? 'mine'
    if (view === 'mine') return { or: mineParts.join(',') }
    if (view === 'groups') return { or: groupParts.join(',') }
    return hasPerm(ctx, 'tasks.view_all') ? {} : { or: [...mineParts, ...groupParts].join(',') }
  }
  if (input.tab === 'following') {
    const { followedTaskIdSet } = await import('./task-follows')
    const ids = await followedTaskIdSet(ctx)
    return ids.length ? { ids: ids.slice(0, MAX_IN_IDS) } : { none: true }
  }
  if (!scope) return { none: true }
  if (scope === 'all') return {}
  if (scope === 'assigned_by_me') return { assigner: me }
  if (scope === 'team') {
    const { data: myTeams } = await (db as any).from('user_teams').select('team_id').eq('user_id', me)
    const teamIds = ((myTeams ?? []) as any[]).map((r) => String(r.team_id)).filter((id) => UUID_RE.test(id))
    if (!teamIds.length) return { none: true }
    const { data: members } = await (db as any).from('user_teams').select('user_id').in('team_id', teamIds)
    const ids = [...new Set(((members ?? []) as any[]).map((r) => String(r.user_id)))].filter((id) => id !== me && UUID_RE.test(id))
    return ids.length ? { assignees: ids.slice(0, MAX_IN_IDS) } : { none: true }
  }
  const { listReportsOf } = await import('./manager-tasks')
  const reports = await listReportsOf(ctx, me, { indirect: true })
  const ids = reports.reports.map((r: { id: string }) => String(r.id)).filter((id: string) => UUID_RE.test(id))
  return ids.length ? { assignees: ids.slice(0, MAX_IN_IDS) } : { none: true }
}

/** Free text → or(): title, the task id, a workflow's name, the requester's name / e-mail. */
async function searchClause(ctx: ServiceContext, db: AnySupabaseClient, raw: string | undefined): Promise<string | null> {
  const term = String(raw ?? '').trim()
  if (!term) return null
  const like = ilikeTerm(term)
  const parts = [`title.ilike.%${like}%`]
  if (UUID_RE.test(term)) parts.push(`id.eq.${term.toLowerCase()}`)
  const [{ data: wfs }, { data: people }] = await Promise.all([
    (db as any).from('workflows').select('id').eq('tenant_id', ctx.tenantId).ilike('name', `%${like}%`).limit(50),
    (db as any).from('users').select('id').or(`display_name.ilike.%${like}%,email.ilike.%${like}%`).limit(50),
  ])
  const wfIds = ((wfs ?? []) as any[]).map((w) => String(w.id)).filter((id) => UUID_RE.test(id))
  const personIds = ((people ?? []) as any[]).map((m) => String(m.id)).filter((id) => UUID_RE.test(id))
  if (wfIds.length) parts.push(`workflow_id.in.(${wfIds.join(',')})`)
  if (personIds.length) parts.push(`assigner_id.in.(${personIds.join(',')})`)
  return parts.join(',')
}

/* ── keyset cursor ──────────────────────────────────────────────────── */

interface Cursor { v: string | null; id: string }

export function encodeCursor(row: Record<string, unknown>, sort: SearchSort): string {
  const v = row[SORT_COLUMN[sort]]
  return Buffer.from(JSON.stringify({ v: v == null ? null : String(v), id: String(row.id) })).toString('base64url')
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw || raw.length > 600) return null
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor
    if (!UUID_RE.test(String(c.id)) || (c.v !== null && typeof c.v !== 'string')) return null
    if (c.v !== null && (c.v.length > 64 || /[,()"\\]/.test(c.v))) return null
    return c
  } catch { return null }
}

/**
 * The rows after a cursor, for ORDER BY col (asc|desc) NULLS LAST, id ASC:
 *  - after a value: col beyond it, or the same value with a later id, or no value (nulls come last);
 *  - after a null: only nulls with a later id.
 */
export function keysetClause(sort: SearchSort, dir: 'asc' | 'desc', c: Cursor): string {
  const col = SORT_COLUMN[sort]
  if (c.v === null) return `and(${col}.is.null,id.gt.${c.id})`
  const beyond = dir === 'desc' ? 'lt' : 'gt'
  return `${col}.${beyond}.${c.v},and(${col}.eq.${c.v},id.gt.${c.id}),${col}.is.null`
}

/* ── the search ─────────────────────────────────────────────────────── */

export async function searchTasks(ctx: ServiceContext, input: TaskSearchInput): Promise<TaskSearchResult> {
  requirePerm(ctx, 'tasks.view_own')
  const me = ctx.actorId
  if (!me) throw ServiceError.forbidden('Sign in to see your tasks')
  const db = await serviceRoleClient(ctx)
  const queue = await queueSources(db, ctx.tenantId, me)
  const empty: TaskSearchResult = { rows: [], total: 0, capped: false, nextCursor: null, queue }
  let scope: SearchScope | null = null
  if (input.tab === 'tracker') {
    empty.scopes = await searchScopes(ctx)
    scope = input.scope && empty.scopes.includes(input.scope) ? input.scope : empty.scopes[0] ?? null
    empty.scope = scope
  }
  if (input.workflowIds && input.workflowIds.length === 0) return empty

  let workflowIds = input.workflowIds ?? null
  if (input.tag) {
    let wq = (db as any).from('workflows').select('id').eq('tenant_id', ctx.tenantId).contains('tags', [input.tag]).limit(200)
    if (workflowIds) wq = wq.in('id', workflowIds)
    const { data, error } = await wq
    if (error) throw dbError(error)
    workflowIds = ((data ?? []) as any[]).map((w) => String(w.id))
    if (!workflowIds.length) return empty
  }

  const [vis, search] = await Promise.all([visibility(ctx, db, me, input, scope, queue), searchClause(ctx, db, input.q)])
  if (vis.none) return empty

  const filtered = (q: any, extraIds?: string[]) => {
    q = q.eq('tenant_id', ctx.tenantId).is('deleted_at', null).is('parent_task_id', null)
    if (vis.or) q = q.or(vis.or)
    if (vis.ids) q = q.in('id', vis.ids)
    if (vis.assignees) q = q.in('assignee_id', vis.assignees)
    if (vis.assigner) q = q.eq('assigner_id', vis.assigner).neq('assignee_id', vis.assigner)
    if (search) q = q.or(search)
    if (input.status === 'completed') q = q.eq('status', 'completed')
    else if (input.status === 'open') q = q.in('status', OPEN_TASK_STATUSES)
    if (input.priority?.length) q = q.in('priority', input.priority)
    if (input.due?.from) q = q.gte('due_date', input.due.from)
    if (input.due?.to) q = q.not('due_date', 'is', null).lt('due_date', input.due.to)
    if (input.completed?.from) q = q.gte('completed_at', input.completed.from)
    if (input.completed?.to) q = q.lt('completed_at', input.completed.to)
    if (workflowIds) q = q.in('workflow_id', workflowIds)
    if (input.workflowId) q = q.eq('workflow_id', input.workflowId)
    if (input.assigneeId) q = q.eq('assignee_id', input.assigneeId)
    if (input.teamId) q = q.eq('assigned_team_id', input.teamId)
    if (extraIds) q = q.in('id', extraIds)
    return q
  }

  let unreadIds: string[] | undefined
  if (input.unread) {
    const { data, error } = await filtered((db as any).from('tasks').select('id')).limit(UNREAD_CANDIDATES)
    if (error) throw dbError(error)
    const { unreadTaskIds } = await import('./task-reads')
    unreadIds = [...await unreadTaskIds(ctx, ((data ?? []) as any[]).map((r) => String(r.id)))].slice(0, MAX_IN_IDS)
    if (!unreadIds.length) return empty
  }

  const column = SORT_COLUMN[input.sort]
  const ascending = input.dir !== 'desc'
  const size = Math.max(1, Math.min(50, input.size))
  const keyset = input.sort !== 'title'
  const cursor = keyset ? decodeCursor(input.cursor) : null
  let page = filtered((db as any).from('tasks').select(input.columns), unreadIds)
  if (cursor) page = page.or(keysetClause(input.sort, input.dir, cursor))
  page = page.order(column, { ascending, nullsFirst: false }).order('id', { ascending: true })
  page = keyset ? page.limit(size + 1) : page.range((Math.max(1, input.page ?? 1) - 1) * size, (Math.max(1, input.page ?? 1)) * size)

  const [{ data: countRows, error: countError }, { data, error }] = await Promise.all([
    // At most SEARCH_COUNT_CAP rows (the data API caps a request at 1,000 rows anyway): a full count reads as "1,000+".
    filtered((db as any).from('tasks').select('id'), unreadIds).limit(SEARCH_COUNT_CAP),
    page,
  ])
  if (countError) throw dbError(countError)
  if (error) throw dbError(error)
  const all = (data ?? []) as any[]
  const more = all.length > size
  const rows = all.slice(0, size)
  const counted = (countRows ?? []).length
  return {
    ...empty,
    rows,
    total: Math.min(counted, SEARCH_COUNT_CAP),
    capped: counted >= SEARCH_COUNT_CAP,
    nextCursor: keyset && more && rows.length ? encodeCursor(rows[rows.length - 1], input.sort) : null,
  }
}
