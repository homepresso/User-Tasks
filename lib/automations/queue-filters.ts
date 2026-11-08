/**
 * Automations → Workflow queue: views, filters, URL state and the matching
 * rule (pure and isomorphic).
 *
 *  - Views: Active (default) · Needs attention · Completed · All. The
 *    status chips refine inside a view.
 *  - The database applies the same rules (public.workflow_queue_list,
 *    migration 20270101000000_workflow_queue_list.sql). `matchesQueueFilters`
 *    is the TypeScript mirror the read uses before that migration is applied
 *    (newest 200 items only). Keep the two in step.
 *  - URL: `?view=&status=&q=&wf=&by=&assignee=&date=&from=&to=&sla=&trigger=&version=&errors=&sort=&dir=&page=&size=`;
 *    keys at their default are left out (view is always written once chosen).
 *  - The last view a person used is remembered per user in localStorage.
 */

export type QueueView = 'active' | 'attention' | 'completed' | 'all'
export type QueueDateField = 'created' | 'started' | 'updated'
export type QueueSortField = 'created_at' | 'started_at' | 'status'
export type QueueSortDir = 'asc' | 'desc'
export type QueueSla = 'on_track' | 'warning' | 'breached'
export type QueueTriggerGroup = 'form' | 'schedule' | 'webhook' | 'manual' | 'data_event'

/** Effective statuses (job status while queued / failed, else the run's). */
export const ACTIVE_STATUSES = ['pending', 'processing', 'running', 'waiting_for_event', 'paused'] as const
export const ATTENTION_STATUSES = ['failed', 'dead'] as const
export const DONE_STATUSES = ['completed', 'cancelled', 'migrated'] as const

export const QUEUE_VIEWS: ReadonlyArray<{ value: QueueView; label: string; description: string }> = [
  { value: 'active', label: 'Active', description: 'Pending, running, awaiting action and paused' },
  { value: 'attention', label: 'Needs attention', description: 'Failed, dead, or past their SLA' },
  { value: 'completed', label: 'Completed', description: 'Completed, cancelled and migrated' },
  { value: 'all', label: 'All', description: 'Every item' },
]
const VIEW_VALUES = QUEUE_VIEWS.map((v) => v.value)

/** Status chips (a refinement inside the view) and the effective statuses each covers. */
export const STATUS_CHIPS: ReadonlyArray<{ value: string; label: string; statuses: readonly string[]; views: readonly QueueView[] }> = [
  { value: 'pending', label: 'Pending', statuses: ['pending'], views: ['active', 'all'] },
  { value: 'processing', label: 'Running', statuses: ['processing', 'running'], views: ['active', 'all'] },
  { value: 'waiting', label: 'Awaiting action', statuses: ['waiting_for_event'], views: ['active', 'attention', 'all'] },
  { value: 'paused', label: 'Paused', statuses: ['paused'], views: ['active', 'attention', 'all'] },
  { value: 'failed', label: 'Failed', statuses: ['failed'], views: ['attention', 'all'] },
  { value: 'dead', label: 'Dead', statuses: ['dead'], views: ['attention', 'all'] },
  { value: 'completed', label: 'Completed', statuses: ['completed'], views: ['completed', 'all'] },
  { value: 'cancelled', label: 'Cancelled', statuses: ['cancelled'], views: ['completed', 'all'] },
  { value: 'migrated', label: 'Migrated', statuses: ['migrated'], views: ['completed', 'all'] },
]
const CHIP_VALUES = STATUS_CHIPS.map((c) => c.value)

export const TRIGGER_GROUPS: ReadonlyArray<{ value: QueueTriggerGroup; label: string; types: readonly string[] }> = [
  { value: 'form', label: 'Form', types: ['form_submitted', 'task_submitted'] },
  { value: 'schedule', label: 'Schedule', types: ['schedule'] },
  { value: 'webhook', label: 'Webhook', types: ['webhook_received', 'middleware_received', 'esign_event'] },
  { value: 'manual', label: 'Manual / API', types: ['manual', 'api'] },
  {
    value: 'data_event', label: 'Data event', types: [
      'data_table_event', 'task_created', 'task_received', 'task_updated', 'task_completed', 'task_rejected',
      'retention_policy_review', 'retention_policy_executed', 'workflow_error', 'workflow_sla',
    ],
  },
]
const TRIGGER_VALUES = TRIGGER_GROUPS.map((g) => g.value)

export const SLA_OPTIONS: ReadonlyArray<{ value: QueueSla; label: string }> = [
  { value: 'on_track', label: 'On track' },
  { value: 'warning', label: 'Warning' },
  { value: 'breached', label: 'Breached' },
]
const SLA_VALUES = SLA_OPTIONS.map((s) => s.value)

export const DATE_FIELDS: ReadonlyArray<{ value: QueueDateField; label: string }> = [
  { value: 'created', label: 'Created' },
  { value: 'started', label: 'Started' },
  { value: 'updated', label: 'Updated' },
]

export const QUEUE_PAGE_SIZES = [25, 50, 100] as const
export const MAX_QUEUE_SEARCH = 200

export interface QueueFilters {
  view: QueueView
  /** STATUS_CHIPS values. */
  statuses: string[]
  search: string
  workflowIds: string[]
  startedBy: string[]
  assigneeIds: string[]
  dateField: QueueDateField
  /** YYYY-MM-DD (local day), inclusive. */
  dateFrom: string
  dateTo: string
  sla: QueueSla[]
  triggers: QueueTriggerGroup[]
  versionIds: string[]
  hasErrors: boolean
  sort: QueueSortField
  dir: QueueSortDir
  page: number
  pageSize: number
}

export function defaultQueueFilters(view: QueueView = 'active'): QueueFilters {
  return {
    view, statuses: [], search: '', workflowIds: [], startedBy: [], assigneeIds: [],
    dateField: 'created', dateFrom: '', dateTo: '', sla: [], triggers: [], versionIds: [], hasErrors: false,
    sort: 'created_at', dir: 'desc', page: 1, pageSize: 25,
  }
}

export function isQueueView(value: unknown): value is QueueView {
  return typeof value === 'string' && (VIEW_VALUES as string[]).includes(value)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

type ParamsLike = { get(name: string): string | null }

const list = (raw: string | null, allowed?: readonly string[], max = 50): string[] => {
  if (!raw) return []
  const out = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
  return (allowed ? out.filter((v) => allowed.includes(v)) : out).slice(0, max)
}
const ids = (raw: string | null) => list(raw).filter((v) => UUID_RE.test(v))

/** The filters in a URL query; anything missing or invalid falls back to its default (`fallbackView` when no view). */
export function parseQueueFilters(params: ParamsLike, fallbackView: QueueView = 'active'): QueueFilters {
  const d = defaultQueueFilters(fallbackView)
  const view = params.get('view')
  const dateField = params.get('date')
  const sort = params.get('sort')
  const dir = params.get('dir')
  const page = Number.parseInt(params.get('page') ?? '', 10)
  const size = Number.parseInt(params.get('size') ?? '', 10)
  const day = (v: string | null) => (v && DAY_RE.test(v) ? v : '')
  return {
    view: isQueueView(view) ? view : d.view,
    statuses: list(params.get('status'), CHIP_VALUES),
    search: (params.get('q') ?? '').slice(0, MAX_QUEUE_SEARCH),
    workflowIds: ids(params.get('wf')),
    startedBy: ids(params.get('by')),
    assigneeIds: ids(params.get('assignee')),
    dateField: dateField === 'started' || dateField === 'updated' ? dateField : 'created',
    dateFrom: day(params.get('from')),
    dateTo: day(params.get('to')),
    sla: list(params.get('sla'), SLA_VALUES) as QueueSla[],
    triggers: list(params.get('trigger'), TRIGGER_VALUES) as QueueTriggerGroup[],
    versionIds: ids(params.get('version')),
    hasErrors: params.get('errors') === '1',
    sort: sort === 'started_at' || sort === 'status' ? sort : 'created_at',
    dir: dir === 'asc' ? 'asc' : 'desc',
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100_000) : 1,
    pageSize: (QUEUE_PAGE_SIZES as readonly number[]).includes(size) ? size : d.pageSize,
  }
}

const QUEUE_KEYS = ['view', 'status', 'q', 'wf', 'by', 'assignee', 'date', 'from', 'to', 'sla', 'trigger', 'version', 'errors', 'sort', 'dir', 'page', 'size']

/** The filters as a URL query (other keys in `base` are kept). Defaults are left out; the view is always written. */
export function serializeQueueFilters(f: QueueFilters, base?: URLSearchParams): string {
  const out = new URLSearchParams(base)
  for (const key of QUEUE_KEYS) out.delete(key)
  out.set('view', f.view)
  if (f.statuses.length) out.set('status', f.statuses.join(','))
  if (f.search.trim()) out.set('q', f.search)
  if (f.workflowIds.length) out.set('wf', f.workflowIds.join(','))
  if (f.startedBy.length) out.set('by', f.startedBy.join(','))
  if (f.assigneeIds.length) out.set('assignee', f.assigneeIds.join(','))
  if ((f.dateFrom || f.dateTo) && f.dateField !== 'created') out.set('date', f.dateField)
  if (f.dateFrom) out.set('from', f.dateFrom)
  if (f.dateTo) out.set('to', f.dateTo)
  if (f.sla.length) out.set('sla', f.sla.join(','))
  if (f.triggers.length) out.set('trigger', f.triggers.join(','))
  if (f.versionIds.length) out.set('version', f.versionIds.join(','))
  if (f.hasErrors) out.set('errors', '1')
  if (f.sort !== 'created_at') out.set('sort', f.sort)
  if (f.dir !== 'desc') out.set('dir', f.dir)
  if (f.page > 1) out.set('page', String(f.page))
  if (f.pageSize !== 25) out.set('size', String(f.pageSize))
  return out.toString()
}

/** The filters after a change: anything but the page goes back to page 1; a view change drops chips it does not offer. */
export function nextQueueFilters(f: QueueFilters, patch: Partial<QueueFilters>): QueueFilters {
  const next = { ...f, ...patch }
  const changed = (Object.keys(patch) as Array<keyof QueueFilters>).some((k) => k !== 'page' && JSON.stringify(patch[k]) !== JSON.stringify(f[k]))
  if (changed && patch.page === undefined) next.page = 1
  if (patch.view && patch.statuses === undefined) next.statuses = next.statuses.filter((s) => chipsForView(next.view).some((c) => c.value === s))
  if (patch.workflowIds && patch.versionIds === undefined && next.workflowIds.length !== 1) next.versionIds = []
  return next
}

export function chipsForView(view: QueueView) {
  return STATUS_CHIPS.filter((c) => c.views.includes(view))
}

/** The view a status chip belongs to by default (stat card clicks). */
export function viewForChip(chip: string): QueueView {
  const c = STATUS_CHIPS.find((s) => s.value === chip)
  return c ? c.views[0] : 'all'
}

/** Advanced filters set (search, view and status chips excluded). */
export function advancedFilterCount(f: QueueFilters): number {
  return [f.workflowIds.length > 0, f.startedBy.length > 0, f.assigneeIds.length > 0, Boolean(f.dateFrom || f.dateTo),
    f.sla.length > 0, f.triggers.length > 0, f.versionIds.length > 0, f.hasErrors].filter(Boolean).length
}

/** Any filter narrowing the view (search, chips or advanced). */
export function hasQueueFilters(f: QueueFilters): boolean {
  return Boolean(f.search.trim()) || f.statuses.length > 0 || advancedFilterCount(f) > 0
}

/** Clear every filter, keep the view, sort and page size. */
export function clearQueueFilters(f: QueueFilters): QueueFilters {
  return { ...defaultQueueFilters(f.view), sort: f.sort, dir: f.dir, pageSize: f.pageSize }
}

// ─── What the server receives ───

/** The read's filter arguments (dates already as instants). */
export interface QueueReadFilters {
  view: QueueView
  statuses?: string[]
  search?: string
  workflowIds?: string[]
  startedBy?: string[]
  assigneeIds?: string[]
  dateField?: QueueDateField
  dateFrom?: string
  dateTo?: string
  sla?: QueueSla[]
  triggers?: QueueTriggerGroup[]
  versionIds?: string[]
  hasErrors?: boolean
}

/** Local-day bounds as ISO instants (from = 00:00:00.000, to = 23:59:59.999 in the browser's zone). */
export function dayBounds(day: string, end: boolean): string | undefined {
  if (!DAY_RE.test(day)) return undefined
  const [y, m, d] = day.split('-').map(Number)
  const date = end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function toReadFilters(f: QueueFilters): QueueReadFilters {
  const out: QueueReadFilters = { view: f.view }
  if (f.statuses.length) out.statuses = f.statuses
  if (f.search.trim()) out.search = f.search.trim()
  if (f.workflowIds.length) out.workflowIds = f.workflowIds
  if (f.startedBy.length) out.startedBy = f.startedBy
  if (f.assigneeIds.length) out.assigneeIds = f.assigneeIds
  if (f.dateFrom || f.dateTo) {
    out.dateField = f.dateField
    const from = f.dateFrom ? dayBounds(f.dateFrom, false) : undefined
    const to = f.dateTo ? dayBounds(f.dateTo, true) : undefined
    if (from) out.dateFrom = from
    if (to) out.dateTo = to
  }
  if (f.sla.length) out.sla = f.sla
  if (f.triggers.length) out.triggers = f.triggers
  if (f.versionIds.length) out.versionIds = f.versionIds
  if (f.hasErrors) out.hasErrors = true
  return out
}

/** The RPC's `p_filters` (chips → effective statuses, trigger groups → trigger types). */
export function toRpcFilters(f: QueueReadFilters, facets = false): Record<string, unknown> {
  const statuses = f.statuses?.length ? [...new Set(f.statuses.flatMap((c) => STATUS_CHIPS.find((s) => s.value === c)?.statuses ?? []))] : undefined
  const triggerTypes = f.triggers?.length ? [...new Set(f.triggers.flatMap((g) => TRIGGER_GROUPS.find((t) => t.value === g)?.types ?? []))] : undefined
  const out: Record<string, unknown> = { view: f.view }
  if (statuses?.length) out.statuses = statuses
  if (f.search) out.search = f.search.slice(0, MAX_QUEUE_SEARCH)
  if (f.workflowIds?.length) out.workflow_ids = f.workflowIds
  if (f.startedBy?.length) out.started_by = f.startedBy
  if (f.assigneeIds?.length) out.assignee_ids = f.assigneeIds
  if (f.dateFrom || f.dateTo) {
    out.date_field = f.dateField ?? 'created'
    if (f.dateFrom) out.date_from = f.dateFrom
    if (f.dateTo) out.date_to = f.dateTo
  }
  if (f.sla?.length) out.sla = f.sla
  if (triggerTypes?.length) out.trigger_types = triggerTypes
  if (f.versionIds?.length) out.version_ids = f.versionIds
  if (f.hasErrors) out.has_errors = true
  if (facets) out.facets = true
  return out
}

// ─── Items and the matching rule (mirror of the RPC) ───

export interface QueueRunSummary {
  id: string
  workflow_id: string
  version_id: string | null
  version_number?: number | null
  status: string
  event_id: string | null
  paused_node_id: string | null
  started_at: string | null
  title: string | null
  sla_label: string | null
  sla_due_at: string | null
  sla_warning_at: string | null
  sla_status: string | null
}

export interface QueuePerson { id: string; name: string | null; email: string | null }

/** One row of the queue: a queue job (with its run) or a middleware run without a job (`run:<id>`). */
export interface QueueItem {
  id: string
  job_id: string | null
  synthetic_run: boolean
  workflow_id: string
  workflow: { id: string; name: string; trigger_type?: string | null }
  /** The queue job's own status. */
  status: string
  effective_status: string
  trigger_type: string | null
  trigger_data: { task_id?: string } | null
  result: { run_id?: string; event_id?: string } | null
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string | null
  run: QueueRunSummary | null
  /** The open task's title, else the current node's label. */
  step_label: string | null
  started_by: QueuePerson | null
  assignee: QueuePerson | null
}

export type QueueViewCounts = Record<QueueView, number>

/** The advanced filter pickers' options (workflows, versions, starters, assignees in the person's scope). */
export interface QueueFacets {
  workflows: Array<{ id: string; name: string }>
  versions: Array<{ id: string; workflow_id: string; version_number: number }>
  starters: QueuePerson[]
  assignees: QueuePerson[]
}

/** Effective status: the job's while it is queued, running, failed or dead (or has no run), else the run's. */
export function effectiveQueueStatus(jobStatus: string, runStatus: string | null | undefined): string {
  if (!runStatus || ['pending', 'processing', 'failed', 'dead'].includes(jobStatus)) return jobStatus
  return runStatus
}

const isActive = (s: string) => (ACTIVE_STATUSES as readonly string[]).includes(s)

export function inQueueView(item: Pick<QueueItem, 'effective_status'> & { run?: { sla_status?: string | null; sla_due_at?: string | null } | null }, view: QueueView): boolean {
  const s = item.effective_status
  switch (view) {
    case 'active': return isActive(s)
    case 'attention': return (ATTENTION_STATUSES as readonly string[]).includes(s) || (slaOf(item) === 'breached' && isActive(s))
    case 'completed': return (DONE_STATUSES as readonly string[]).includes(s)
    default: return true
  }
}

function slaOf(item: { run?: { sla_status?: string | null; sla_due_at?: string | null } | null }): string | null {
  return item.run?.sla_due_at ? (item.run.sla_status ?? 'on_track') : null
}

const dateOf = (item: QueueItem, field: QueueDateField) =>
  field === 'started' ? item.started_at : field === 'updated' ? (item.updated_at ?? item.completed_at ?? item.started_at ?? item.created_at) : item.created_at

/** Every filter but the view and status chips (what the view counts use). */
export function matchesQueueRefinements(item: QueueItem, f: QueueReadFilters): boolean {
  if (f.workflowIds?.length && !f.workflowIds.includes(item.workflow_id)) return false
  if (f.startedBy?.length && !(item.started_by && f.startedBy.includes(item.started_by.id))) return false
  if (f.assigneeIds?.length && !(item.assignee && f.assigneeIds.includes(item.assignee.id))) return false
  if (f.versionIds?.length && !(item.run?.version_id && f.versionIds.includes(item.run.version_id))) return false
  if (f.sla?.length) {
    const sla = slaOf(item)
    if (!sla || !f.sla.includes(sla as QueueSla)) return false
  }
  if (f.triggers?.length) {
    const types = f.triggers.flatMap((g) => TRIGGER_GROUPS.find((t) => t.value === g)?.types ?? [])
    if (!item.trigger_type || !types.includes(item.trigger_type)) return false
  }
  if (f.hasErrors && !(item.error || ATTENTION_STATUSES.includes(item.effective_status as 'failed'))) return false
  if (f.dateFrom || f.dateTo) {
    const value = dateOf(item, f.dateField ?? 'created')
    const t = value ? new Date(value).getTime() : NaN
    if (Number.isNaN(t)) return false
    if (f.dateFrom && t < new Date(f.dateFrom).getTime()) return false
    if (f.dateTo && t > new Date(f.dateTo).getTime()) return false
  }
  if (f.search?.trim() && !queueSearchText(item).includes(f.search.trim().toLowerCase())) return false
  return true
}

/** The view, status chips and every other filter. */
export function matchesQueueFilters(item: QueueItem, f: QueueReadFilters): boolean {
  if (!inQueueView(item, f.view)) return false
  if (f.statuses?.length) {
    const statuses = f.statuses.flatMap((c) => STATUS_CHIPS.find((s) => s.value === c)?.statuses ?? [])
    if (!statuses.includes(item.effective_status)) return false
  }
  return matchesQueueRefinements(item, f)
}

/** What search looks in: workflow name, item / run id (short ids too), run title, current step, the starter's name and email. */
export function queueSearchText(item: QueueItem): string {
  return [
    item.workflow?.name, item.id, item.result?.run_id ?? item.run?.id, item.run?.title, item.step_label,
    item.started_by?.name, item.started_by?.email,
  ].filter(Boolean).join('\n').toLowerCase()
}

export function viewCountsOf(items: QueueItem[], f: QueueReadFilters): QueueViewCounts {
  const counts: QueueViewCounts = { active: 0, attention: 0, completed: 0, all: 0 }
  for (const item of items) {
    if (!matchesQueueRefinements(item, f)) continue
    for (const v of VIEW_VALUES) if (inQueueView(item, v)) counts[v]++
  }
  return counts
}

export function sortQueueItems(items: QueueItem[], sort: QueueSortField, dir: QueueSortDir): QueueItem[] {
  const sign = dir === 'asc' ? 1 : -1
  const time = (v: string | null) => (v ? new Date(v).getTime() : null)
  return [...items].sort((a, b) => {
    if (sort === 'status') {
      const c = a.effective_status.localeCompare(b.effective_status)
      if (c) return sign * c
    }
    if (sort === 'started_at') {
      const x = time(a.started_at), y = time(b.started_at)
      if (x !== y) {
        if (x == null) return dir === 'asc' ? -1 : 1
        if (y == null) return dir === 'asc' ? 1 : -1
        return sign * (x - y)
      }
    }
    return sign * ((time(a.created_at) ?? 0) - (time(b.created_at) ?? 0)) || a.id.localeCompare(b.id)
  })
}

// ─── Last-used view (per user) ───

const viewKey = (userId: string | null | undefined) => `usertasks:queue-view:${userId ?? 'anon'}`

export function readLastQueueView(userId: string | null | undefined): QueueView | null {
  try {
    const v = globalThis.localStorage?.getItem(viewKey(userId))
    return isQueueView(v) ? v : null
  } catch {
    return null
  }
}

export function writeLastQueueView(userId: string | null | undefined, view: QueueView): void {
  try {
    globalThis.localStorage?.setItem(viewKey(userId), view)
  } catch {
    // Storage unavailable (private mode, quota): the URL still carries the view.
  }
}
