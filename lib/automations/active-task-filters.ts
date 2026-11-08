/**
 * The workflow queue page's "Active tasks" tab: its tab and filters in the
 * URL (client-safe, pure). `?tab=tasks` selects the tab; its filters use a
 * `wt_` prefix so they never clash with the Workflows tab's.
 */

export type QueueTab = 'workflows' | 'tasks'
export const WAITING_TIMES = ['1d', '3d', '1w'] as const
export type WaitingTime = (typeof WAITING_TIMES)[number]
export const WAITING_SLA = ['overdue', 'due_soon', 'on_track', 'none'] as const
export type WaitingSla = (typeof WAITING_SLA)[number]
export const WAITING_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
export const WAITING_PAGE_SIZES = [25, 50, 100] as const
export const MAX_WAITING_SEARCH = 200

export const WAITING_TIME_LABEL: Record<WaitingTime, string> = { '1d': 'More than 1 day', '3d': 'More than 3 days', '1w': 'More than 1 week' }
export const WAITING_SLA_LABEL: Record<WaitingSla, string> = { overdue: 'Overdue', due_soon: 'Due within 24 hours', on_track: 'On track', none: 'No due date' }
export const WAITING_TIME_MS: Record<WaitingTime, number> = { '1d': 86_400_000, '3d': 3 * 86_400_000, '1w': 7 * 86_400_000 }

export interface ActiveTaskFilters {
  search: string
  assignee: string | null
  workflow: string | null
  waiting: WaitingTime | null
  sla: WaitingSla | null
  priority: string | null
  unassigned: boolean
  page: number
  pageSize: number
}

export const DEFAULT_ACTIVE_FILTERS: ActiveTaskFilters = { search: '', assignee: null, workflow: null, waiting: null, sla: null, priority: null, unassigned: false, page: 1, pageSize: 25 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseQueueTab(params: URLSearchParams | { get(key: string): string | null }): QueueTab {
  return params.get('tab') === 'tasks' ? 'tasks' : 'workflows'
}

export function parseActiveFilters(params: URLSearchParams | { get(key: string): string | null }): ActiveTaskFilters {
  const one = <T extends string>(key: string, allowed: readonly T[]): T | null => {
    const v = params.get(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : null
  }
  const uuid = (key: string) => { const v = params.get(key); return v && UUID.test(v) ? v : null }
  const page = Math.max(1, Math.floor(Number(params.get('wt_page')) || 1))
  const size = Number(params.get('wt_size'))
  return {
    search: (params.get('wt_q') ?? '').slice(0, MAX_WAITING_SEARCH),
    assignee: uuid('wt_assignee'),
    workflow: uuid('wt_workflow'),
    waiting: one('wt_waiting', WAITING_TIMES),
    sla: one('wt_sla', WAITING_SLA),
    priority: one('wt_priority', WAITING_PRIORITIES),
    unassigned: params.get('wt_unassigned') === '1',
    page,
    pageSize: (WAITING_PAGE_SIZES as readonly number[]).includes(size) ? size : 25,
  }
}

/** The query string with the tab and the Active tasks filters set (other params kept). */
export function serializeQueueTab(tab: QueueTab, filters: ActiveTaskFilters, base: URLSearchParams = new URLSearchParams()): string {
  const p = new URLSearchParams(base.toString())
  for (const key of [...p.keys()]) if (key.startsWith('wt_')) p.delete(key)
  if (tab === 'tasks') {
    p.set('tab', 'tasks')
    if (filters.search.trim()) p.set('wt_q', filters.search.trim())
    if (filters.assignee) p.set('wt_assignee', filters.assignee)
    if (filters.workflow) p.set('wt_workflow', filters.workflow)
    if (filters.waiting) p.set('wt_waiting', filters.waiting)
    if (filters.sla) p.set('wt_sla', filters.sla)
    if (filters.priority) p.set('wt_priority', filters.priority)
    if (filters.unassigned) p.set('wt_unassigned', '1')
    if (filters.page > 1) p.set('wt_page', String(filters.page))
    if (filters.pageSize !== 25) p.set('wt_size', String(filters.pageSize))
  } else {
    p.delete('tab')
  }
  return p.toString()
}

/** A filter change returns to page 1 (a page change keeps the filters). */
export function nextActiveFilters(current: ActiveTaskFilters, patch: Partial<ActiveTaskFilters>): ActiveTaskFilters {
  const pageOnly = Object.keys(patch).every((k) => k === 'page')
  return { ...current, ...patch, page: pageOnly ? (patch.page ?? current.page) : 1 }
}

export function hasActiveFilters(f: ActiveTaskFilters): boolean {
  return Boolean(f.search.trim() || f.assignee || f.workflow || f.waiting || f.sla || f.priority || f.unassigned)
}

/** "3 days", "5 hours", "12 minutes". */
export function waitingFor(since: string | null | undefined, now = Date.now()): string {
  if (!since) return '—'
  const ms = Math.max(0, now - new Date(since).getTime())
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  const weeks = Math.floor(days / 7)
  return `${weeks} week${weeks === 1 ? '' : 's'}`
}

/** A due date's SLA status (now = the read time). */
export function slaStatus(due: string | null | undefined, now = Date.now()): WaitingSla {
  if (!due) return 'none'
  const t = new Date(due).getTime()
  if (t < now) return 'overdue'
  if (t < now + 86_400_000) return 'due_soon'
  return 'on_track'
}
