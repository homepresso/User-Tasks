/**
 * The Automations → Workflows list, one page at a time (server-side paging).
 *
 *  - URL state: `?q=&status=&trigger=&tag=&sort=&dir=&page=&size=` — every
 *    key is optional and dropped from the URL at its default, so a refresh or
 *    Back returns to the same page, filters and page size.
 *  - Page sizes depend on the view: cards 24 / 48 / 96, list 25 / 50 / 100.
 *    Switching the view keeps the size's position (48 cards → 50 rows).
 *  - The query (`applyWorkflowListQuery`) filters, sorts and ranges on the
 *    server with an exact count; search matches the name, an exact tag and
 *    the trigger's label.
 *
 * Pure and isomorphic (the read in lib/services/ui-reads/automations.ts and
 * components/automations/workflow-list.tsx share it).
 */

import { escapeLikePattern } from '@/lib/utils'

export const WORKFLOW_TRIGGER_LABELS: Record<string, string> = {
  task_created: 'Task Created',
  task_received: 'Task Received',
  task_submitted: 'Task Submitted',
  task_updated: 'Task Updated',
  data_table_event: 'Data Table Event',
  form_submitted: 'Form Submitted',
  middleware_received: 'Middleware',
  task_completed: 'Task Completed',
  task_rejected: 'Task Rejected',
  workflow_error: 'Error Handler',
  retention_policy_review: 'Policy Review',
  retention_policy_executed: 'Policy Executed',
  schedule: 'Schedule',
  webhook_received: 'Webhook',
  esign_event: 'E-signature Event',
}

export type WorkflowListView = 'cards' | 'list'
export type WorkflowSortField = 'name' | 'updated_at' | 'run_count' | 'status' | 'trigger_type' | 'nodes'
export type WorkflowSortDir = 'asc' | 'desc'
export type WorkflowStatusFilter = 'all' | 'active' | 'inactive'

export const WORKFLOW_PAGE_SIZES: Record<WorkflowListView, readonly number[]> = {
  cards: [24, 48, 96],
  list: [25, 50, 100],
}

const SORT_FIELDS: readonly WorkflowSortField[] = ['name', 'updated_at', 'run_count', 'status', 'trigger_type', 'nodes']
const SORT_COLUMNS: Record<WorkflowSortField, string> = {
  name: 'name',
  updated_at: 'updated_at',
  run_count: 'run_count',
  status: 'is_active',
  trigger_type: 'trigger_type',
  nodes: 'node_count',
}

export interface WorkflowListState {
  q: string
  status: WorkflowStatusFilter
  trigger: string | null
  tag: string | null
  sort: WorkflowSortField
  dir: WorkflowSortDir
  page: number
  /** A size of the current view's options (WORKFLOW_PAGE_SIZES). */
  size: number
}

export const MAX_WORKFLOW_SEARCH = 200

export function defaultWorkflowListState(view: WorkflowListView): WorkflowListState {
  return { q: '', status: 'all', trigger: null, tag: null, sort: 'updated_at', dir: 'desc', page: 1, size: WORKFLOW_PAGE_SIZES[view][0] }
}

/** A page size valid for the view: one of its options, else the same position in the other view's, else the first. */
export function pageSizeForView(view: WorkflowListView, size: number): number {
  const options = WORKFLOW_PAGE_SIZES[view]
  if (options.includes(size)) return size
  const other = WORKFLOW_PAGE_SIZES[view === 'cards' ? 'list' : 'cards']
  const index = other.indexOf(size)
  return index >= 0 ? options[index] : options[0]
}

const TOKEN_RE = /^[a-z0-9_]{1,80}$/

type ParamsLike = { get(name: string): string | null }

/** The list state in a URL query (anything missing or invalid falls back to its default). */
export function parseWorkflowListParams(params: ParamsLike, view: WorkflowListView): WorkflowListState {
  const d = defaultWorkflowListState(view)
  const status = params.get('status')
  const sort = params.get('sort') as WorkflowSortField | null
  const dir = params.get('dir')
  const trigger = params.get('trigger')
  const tag = params.get('tag')?.trim().toLowerCase() ?? ''
  const page = Number.parseInt(params.get('page') ?? '', 10)
  const size = Number.parseInt(params.get('size') ?? '', 10)
  return {
    q: (params.get('q') ?? '').slice(0, MAX_WORKFLOW_SEARCH),
    status: status === 'active' || status === 'inactive' ? status : 'all',
    trigger: trigger && TOKEN_RE.test(trigger) ? trigger : null,
    tag: tag ? tag.slice(0, 80) : null,
    sort: sort && SORT_FIELDS.includes(sort) ? sort : d.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : d.dir,
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100_000) : 1,
    size: Number.isFinite(size) ? pageSizeForView(view, size) : d.size,
  }
}

/** The list state as a URL query: defaults are left out (an empty string for the plain list). */
export function serializeWorkflowListParams(state: WorkflowListState, view: WorkflowListView, base?: URLSearchParams): string {
  const out = new URLSearchParams(base)
  for (const key of ['q', 'status', 'trigger', 'tag', 'sort', 'dir', 'page', 'size']) out.delete(key)
  const d = defaultWorkflowListState(view)
  if (state.q.trim()) out.set('q', state.q)
  if (state.status !== d.status) out.set('status', state.status)
  if (state.trigger) out.set('trigger', state.trigger)
  if (state.tag) out.set('tag', state.tag)
  if (state.sort !== d.sort) out.set('sort', state.sort)
  if (state.dir !== d.dir) out.set('dir', state.dir)
  if (state.page > 1) out.set('page', String(state.page))
  if (state.size !== d.size) out.set('size', String(state.size))
  return out.toString()
}

/** The state after a change: any filter, sort or size change goes back to page 1. */
export function nextWorkflowListState(state: WorkflowListState, patch: Partial<WorkflowListState>): WorkflowListState {
  const next = { ...state, ...patch }
  const resetsPage = (Object.keys(patch) as Array<keyof WorkflowListState>).some((k) => k !== 'page' && patch[k] !== state[k])
  if (resetsPage && patch.page === undefined) next.page = 1
  return next
}

/** The read's arguments (what the server needs from the state). */
export interface WorkflowListQuery {
  q?: string
  status?: WorkflowStatusFilter
  trigger?: string | null
  tag?: string | null
  sort?: WorkflowSortField
  dir?: WorkflowSortDir
  page: number
  size: number
}

/** Row range of a page (inclusive, as PostgREST's .range()). */
export function pageRange(page: number, size: number): { from: number; to: number } {
  const p = Math.max(1, Math.floor(page))
  const s = Math.max(1, Math.min(100, Math.floor(size)))
  return { from: (p - 1) * s, to: p * s - 1 }
}

/** Trigger types whose label (or type) contains the search text. */
export function triggersMatching(q: string): string[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  return Object.entries(WORKFLOW_TRIGGER_LABELS).filter(([type, label]) => type.includes(needle) || label.toLowerCase().includes(needle)).map(([type]) => type)
}

/** The PostgREST .or() filter of a search: name, an exact tag, matching trigger types. */
export function workflowSearchFilter(q: string): string | null {
  const term = q.trim().slice(0, MAX_WORKFLOW_SEARCH)
  if (!term) return null
  const parts = [`name.ilike.%${escapeLikePattern(term)}%`]
  const tag = term.toLowerCase()
  if (/^[a-z0-9 _-]{1,80}$/.test(tag)) parts.push(`tags.cs.{"${tag}"}`)
  const triggers = triggersMatching(term)
  if (triggers.length) parts.push(`trigger_type.in.(${triggers.join(',')})`)
  return parts.join(',')
}

/** The subset of a PostgREST builder the list query uses. */
export interface ListQueryBuilder<T> {
  or(filter: string): T
  eq(column: string, value: unknown): T
  not(column: string, operator: string, value: unknown): T
  contains(column: string, value: unknown): T
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): T
  range(from: number, to: number): T
}

/** Filters, sort and the page range on a `select(…, { count: 'exact' })` query. */
export function applyWorkflowListQuery<T extends ListQueryBuilder<T>>(query: T, args: WorkflowListQuery): T {
  let q = query
  const search = workflowSearchFilter(args.q ?? '')
  if (search) q = q.or(search)
  if (args.status === 'active') q = q.eq('is_active', true)
  // Not true = false or null (one .or() per query: the search owns it).
  if (args.status === 'inactive') q = q.not('is_active', 'is', true)
  if (args.trigger) q = q.eq('trigger_type', args.trigger)
  if (args.tag) q = q.contains('tags', [args.tag])
  const ascending = (args.dir ?? 'desc') === 'asc'
  q = q.order(SORT_COLUMNS[args.sort ?? 'updated_at'], { ascending, nullsFirst: false })
  // A stable order across pages (equal names / counts).
  q = q.order('id', { ascending: true })
  const { from, to } = pageRange(args.page, args.size)
  return q.range(from, to)
}

/** The last page that has rows (1 when there are none). */
export function lastPage(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, size)))
}
