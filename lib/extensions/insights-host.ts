/**
 * Run history and statistics for an extension's own workflows and forms
 * (ctx.workflows.history / stats, ctx.forms.submissionStats): a page that
 * shows "how is everything bound to this record doing" — e.g. a dashboard
 * for one SharePoint list — without core UI and without pulling rows to
 * count them.
 *
 * Scope: only workflows whose trigger is one of the calling extension's
 * triggers, only forms bound to one of its form targets, in the caller's
 * workspace; ids of anything else are ignored.
 *
 * Permissions (people; system and elevated contexts see everything):
 *   history          workflows.view, then the run-list rule of
 *                    lib/services/run-visibility: workflows.view_runs = every run;
 *                    workflows.view_queue = runs the person is involved in plus
 *                    workflows they hold a View grant on; neither = none. Task
 *                    assignees need workflows.view_runs or tasks.view_all.
 *   stats            workflows.view (counts only, like the run count on ctx.workflows.list)
 *   submissionStats  forms.view (counts only, never values)
 *
 * Aggregates run in the database (supabase/migrations/20270115000000_run_and_submission_stats.sql)
 * over a bounded period (≤ 90 days) and indexed columns; when that migration
 * is not applied yet, a bounded read (at most FALLBACK_ROWS rows) is
 * aggregated here with the same rules. Server-only.
 */

import type {
  ExtensionRunCounts, ExtensionRunDay, ExtensionRunGroup, ExtensionRunHistory, ExtensionRunHistoryItem,
  ExtensionRunHistoryOptions, ExtensionRunStats, ExtensionRunTask, ExtensionSubmissionStats, ExtensionWaiting,
} from '@/lib/extensions/sdk'
import { ExtensionError } from '@/lib/extensions/sdk'
import { boundForm } from './forms'
import { asExtensionError, serviceContext } from './objects-host'

/* eslint-disable @typescript-eslint/no-explicit-any -- supabase rows */

interface InsightsHost {
  extensionId: string
  tenantId: string | null
  actorId: string | null
  serviceDb: any
  /** The caller's client (service calls run as the person). */
  db?: any
  permissions: ReadonlySet<string> | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY_RE = /^[a-z_][a-z0-9_]{0,62}$/i
const DAY_MS = 86_400_000
export const FALLBACK_ROWS = 50_000
const MAX_OFFSET = 10_000
const RESUME_TRIGGERS = new Set(['task_resume', 'delay_resume'])
const OPEN_TASKS = ['draft', 'todo', 'in_progress', 'blocked']

export const RUN_GROUPS: Record<ExtensionRunGroup, string[]> = {
  running: ['running'],
  waiting: ['paused', 'waiting_for_event', 'waiting'],
  completed: ['completed'],
  failed: ['failed', 'cancelled', 'canceled'],
}

/** A run a person cancelled is stored as failed + this error (lib/services/workflow-runs). */
export const MANUAL_CANCEL_ERROR = 'Manually cancelled'
const isManualCancel = (r: { status?: unknown; error?: unknown }) => r.status === 'failed' && r.error === MANUAL_CANCEL_ERROR

export function runGroup(status: string): ExtensionRunGroup {
  for (const [group, statuses] of Object.entries(RUN_GROUPS) as Array<[ExtensionRunGroup, string[]]>) if (statuses.includes(status)) return group
  // Queue states before a run exists.
  if (status === 'pending' || status === 'processing' || status === 'queued') return 'waiting'
  if (status === 'dead') return 'failed'
  return 'completed'
}

const has = (host: InsightsHost, permission: string) => !host.permissions || host.permissions.has(permission)
const uuids = (ids: unknown): string[] => (Array.isArray(ids) ? ids.map(String).filter((id) => UUID_RE.test(id)) : [])

function triggerTypes(extensionId: string, key?: string): Promise<string[]> {
  return import('./registry').then(({ getExtensionManifest }) => (getExtensionManifest(extensionId)?.contributes.triggers ?? [])
    .filter((t) => !key || t.key === key).map((t) => `ext.${extensionId}.${t.key}`))
}

/** The extension's own workflows in this workspace (optionally only some ids). */
async function ownWorkflows(host: InsightsHost, trigger: string | undefined, ids: string[] | undefined, columns = 'id, name'): Promise<Array<Record<string, any>>> {
  if (!host.tenantId) return []
  const types = await triggerTypes(host.extensionId, trigger)
  if (!types.length) return []
  const wanted = ids === undefined ? undefined : uuids(ids)
  if (wanted && !wanted.length) return []
  let q = host.serviceDb.from('workflows').select(columns).eq('tenant_id', host.tenantId).in('trigger_type', types)
  if (wanted) q = q.in('id', wanted.slice(0, 500))
  const { data, error } = await q.order('updated_at', { ascending: false }).limit(500)
  if (error) throw new Error(`workflows lookup failed: ${error.message}`)
  return (data ?? []) as Array<Record<string, any>>
}

/** The period: `days` whole UTC days ending today (1–90, default 30). */
export function period(days: unknown, now = Date.now()): { days: number; since: Date; until: Date; dayKeys: string[] } {
  const n = Math.min(Math.max(Math.trunc(Number(days) || 30), 1), 90)
  const today = Math.floor(now / DAY_MS) * DAY_MS
  const since = new Date(today - (n - 1) * DAY_MS)
  const dayKeys = Array.from({ length: n }, (_, i) => new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10))
  return { days: n, since, until: new Date(now + 1000), dayKeys }
}

const isMissingFunction = (error: any) => Boolean(error) && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function .* does not exist/i.test(String(error.message ?? '')))

/** percentile_cont semantics (linear interpolation), as the SQL function. */
export function percentileCont(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

interface RawCounts { started: number; completed: number; failed: number; cancelled: number; avg_ms: number | null; p95_ms: number | null; running: number; waiting: number; queued: number; per_day: Array<{ day: string; started: number; completed: number; failed: number; avg_ms?: number | null }> }

function counts(raw: Partial<RawCounts> | undefined, dayKeys: string[]): ExtensionRunCounts {
  const r = raw ?? {}
  const n = (v: unknown) => Number(v ?? 0) || 0
  const byDay = new Map((r.per_day ?? []).map((d) => [String(d.day), d]))
  const avgOf = (day: string) => { const v = byDay.get(day)?.avg_ms; return v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.round(Number(v)) }
  const perDay: ExtensionRunDay[] = dayKeys.map((day) => ({ day, started: n(byDay.get(day)?.started), completed: n(byDay.get(day)?.completed), failed: n(byDay.get(day)?.failed), avgMs: avgOf(day) }))
  const completed = n(r.completed)
  const finished = completed + n(r.failed) + n(r.cancelled)
  const ms = (v: unknown) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.round(Number(v)))
  return {
    started: n(r.started), completed, failed: n(r.failed), cancelled: n(r.cancelled),
    successRate: finished ? completed / finished : null,
    avgMs: ms(r.avg_ms), p95Ms: ms(r.p95_ms),
    running: n(r.running), waiting: n(r.waiting), queued: n(r.queued), perDay,
  }
}

/** The same aggregation as public.workflow_run_stats, over rows read with a bound (migration not applied yet). */
export function aggregateRuns(workflowIds: string[], periodRuns: Array<{ workflow_id: string; status: string; started_at: string; completed_at: string | null }>, liveRuns: Array<{ workflow_id: string; status: string }>, queuedJobs: Array<{ workflow_id: string }>): { workflows: Array<RawCounts & { workflow_id: string }>; total: RawCounts } {
  const empty = (): RawCounts & { ms: number[]; days: Map<string, { day: string; started: number; completed: number; failed: number; sum: number; n: number }> } => ({ started: 0, completed: 0, failed: 0, cancelled: 0, avg_ms: null, p95_ms: null, running: 0, waiting: 0, queued: 0, per_day: [], ms: [], days: new Map() })
  const per = new Map(workflowIds.map((id) => [id, empty()]))
  const total = empty()
  for (const r of periodRuns) {
    for (const acc of [per.get(r.workflow_id), total]) {
      if (!acc) continue
      acc.started++
      const day = new Date(r.started_at).toISOString().slice(0, 10)
      const d = acc.days.get(day) ?? { day, started: 0, completed: 0, failed: 0, sum: 0, n: 0 }
      d.started++
      if (r.status === 'completed') {
        acc.completed++; d.completed++
        if (r.completed_at) { const ms = new Date(r.completed_at).getTime() - new Date(r.started_at).getTime(); acc.ms.push(ms); d.sum += ms; d.n++ }
      } else if (r.status === 'failed') { acc.failed++; d.failed++ } else if (r.status === 'cancelled' || r.status === 'canceled') { acc.cancelled++; d.failed++ }
      acc.days.set(day, d)
    }
  }
  for (const r of liveRuns) {
    for (const acc of [per.get(r.workflow_id), total]) {
      if (!acc) continue
      if (r.status === 'running') acc.running++
      else if (RUN_GROUPS.waiting.includes(r.status)) acc.waiting++
    }
  }
  for (const q of queuedJobs) for (const acc of [per.get(q.workflow_id), total]) if (acc) acc.queued++
  const finish = (acc: ReturnType<typeof empty>): RawCounts => {
    const sorted = [...acc.ms].sort((a, b) => a - b)
    const { ms: _ms, days, ...rest } = acc
    return { ...rest, avg_ms: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null, p95_ms: percentileCont(sorted, 0.95), per_day: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map(({ sum, n, ...d }) => ({ ...d, avg_ms: n ? Math.round(sum / n) : null })) }
  }
  return { workflows: [...per].map(([workflow_id, acc]) => ({ workflow_id, ...finish(acc) })), total: finish(total) }
}

/* ── history ────────────────────────────────────────────────────────── */

/** A run of one of this extension's workflows in this workspace (else 404). */
async function ownRun(host: InsightsHost, runId: string, types: string[]): Promise<{ id: string; workflow_id: string; status: string }> {
  if (!UUID_RE.test(runId)) throw new ExtensionError('not_found', 'Run not found', 404)
  const { data: run } = await host.serviceDb.from('workflow_runs').select('id, workflow_id, status').eq('tenant_id', host.tenantId).eq('id', runId).maybeSingle()
  if (!run) throw new ExtensionError('not_found', 'Run not found', 404)
  const { data: wf } = await host.serviceDb.from('workflows').select('trigger_type').eq('tenant_id', host.tenantId).eq('id', run.workflow_id).maybeSingle()
  if (!wf || !types.includes(String(wf.trigger_type))) throw new ExtensionError('not_found', 'Run not found', 404)
  return { id: String(run.id), workflow_id: String(run.workflow_id), status: String(run.status) }
}

const NONE = (visibility: ExtensionRunHistory['visibility']): ExtensionRunHistory => ({ runs: [], total: 0, queued: 0, hasMore: false, visibility, assignees: false })

function nodeLabel(nodes: unknown, id: string | null): string | null {
  if (!id || !Array.isArray(nodes)) return null
  const node = nodes.find((n: any) => n?.id === id) as any
  if (!node) return null
  const label = node.label ?? node.data?.label ?? node.config?.label
  return typeof label === 'string' && label.trim() ? label.trim().slice(0, 200) : String(node.type ?? id)
}

function scalar(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.slice(0, 500)
  if (typeof v === 'number' || typeof v === 'boolean') return v
  return null
}

async function names(host: InsightsHost, table: 'users' | 'teams', ids: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id) => UUID_RE.test(id)))]
  if (!wanted.length) return new Map()
  const cols = table === 'users' ? 'id, display_name, email' : 'id, name'
  let q = host.serviceDb.from(table).select(cols).in('id', wanted)
  if (table === 'teams') q = q.eq('tenant_id', host.tenantId)
  const { data } = await q
  return new Map(((data ?? []) as any[]).map((r) => [String(r.id), String(table === 'users' ? (r.display_name || r.email || '') : r.name)]))
}

export function hostInsightsWorkflows(host: InsightsHost) {
  return {
    async history(options: ExtensionRunHistoryOptions = {}): Promise<ExtensionRunHistory> {
      if (!host.tenantId) throw new Error('workflows.history needs a workspace')
      const tenantId = host.tenantId
      if (!has(host, 'workflows.view')) return NONE('none')
      // Run-list visibility (lib/services/run-visibility).
      let visibility: ExtensionRunHistory['visibility'] = 'all'
      let granted: string[] = []
      let involved: string[] = []
      if (host.permissions && !host.permissions.has('workflows.view_runs')) {
        if (!host.permissions.has('workflows.view_queue') || !host.actorId) return NONE('none')
        visibility = 'involved'
        const { grantedWorkflowIds, involvedRunIds } = await import('@/lib/services/run-visibility')
        ;[granted, involved] = await Promise.all([grantedWorkflowIds(host.serviceDb, tenantId, host.actorId), involvedRunIds(host.serviceDb, tenantId, host.actorId)])
      }
      const assignees = has(host, 'workflows.view_runs') || has(host, 'tasks.view_all')
      const workflows = await ownWorkflows(host, options.trigger, options.workflowIds, 'id, name, nodes')
      if (!workflows.length) return { ...NONE(visibility), assignees }
      const wfIds = workflows.map((w) => String(w.id))
      const wfById = new Map(workflows.map((w) => [String(w.id), w]))
      const asked = (options.status ?? []).map(String)
      const groups = asked.filter((g): g is ExtensionRunGroup => g in RUN_GROUPS)
      const onlyQueued = asked.length > 0 && asked.every((g) => g === 'queued')
      const statuses = [...groups.flatMap((g) => RUN_GROUPS[g]), ...(asked.includes('cancelled') ? ['cancelled', 'canceled'] : [])]
      const wantQueued = !asked.length || asked.includes('queued') || asked.includes('waiting')
      const limit = Math.min(Math.max(Math.trunc(Number(options.limit) || 25), 1), 100)
      const offset = Math.min(Math.max(Math.trunc(Number(options.offset) || 0), 0), MAX_OFFSET)
      const picks = [...new Set((options.pick ?? []).map(String).filter((k) => KEY_RE.test(k)))].slice(0, 10)
      const match = Object.entries(options.match ?? {}).filter(([k]) => KEY_RE.test(k)).slice(0, 5)

      // Scope as a filter: whole workflows (granted) or single runs (involved).
      const full = visibility === 'all' ? wfIds : wfIds.filter((id) => granted.includes(id))
      const partialRuns = visibility === 'all' ? [] : involved.filter((id) => UUID_RE.test(id))
      if (visibility === 'involved' && !full.length && !partialRuns.length) return { ...NONE(visibility), assignees }

      const startedBy = options.startedBy && UUID_RE.test(options.startedBy) ? options.startedBy : null
      const since = options.since && !Number.isNaN(Date.parse(options.since)) ? new Date(options.since).toISOString() : null
      const until = options.until && !Number.isNaN(Date.parse(options.until)) ? new Date(options.until).toISOString() : null
      const sort = options.sort === 'duration' || options.sort === 'status' ? options.sort : 'started'
      const search = String(options.search ?? '').trim().slice(0, 100)

      // Search: an item title (trigger data), a run id, or the starter's name / e-mail (bounded id sets).
      let searchIds: string[] | null = null
      if (search) {
        const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
        const [byTitle, people] = await Promise.all([
          host.serviceDb.from('workflow_queue').select('result').eq('tenant_id', tenantId).in('workflow_id', wfIds).ilike('trigger_data->>title', like).order('created_at', { ascending: false }).limit(2000),
          host.serviceDb.from('users').select('id, display_name, email').or(`display_name.ilike.${like.replace(/[,()]/g, ' ')},email.ilike.${like.replace(/[,()]/g, ' ')}`).limit(200),
        ])
        const ids = new Set<string>(((byTitle.data ?? []) as any[]).map((j) => j.result?.run_id).filter((x: unknown): x is string => typeof x === 'string' && UUID_RE.test(x)))
        if (UUID_RE.test(search)) ids.add(search.toLowerCase())
        const needle = search.toLowerCase()
        const personIds = ((people.data ?? []) as any[]).filter((u) => `${u.display_name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(needle)).map((u) => String(u.id))
        if (personIds.length) {
          const { data } = await host.serviceDb.from('workflow_runs').select('id').eq('tenant_id', tenantId).in('workflow_id', wfIds).in('started_by', personIds).order('started_at', { ascending: false }).limit(2000)
          for (const r of (data ?? []) as any[]) ids.add(String(r.id))
        }
        searchIds = [...ids]
      }

      // A trigger-data match: the runs of matching jobs (bounded).
      let matchRunIds: string[] | null = null
      if (match.length) {
        let q = host.serviceDb.from('workflow_queue').select('id, result').eq('tenant_id', tenantId).in('workflow_id', wfIds)
        for (const [k, v] of match) q = q.filter(`trigger_data->>${k}`, 'eq', String(v))
        const { data, error } = await q.order('created_at', { ascending: false }).limit(2000)
        if (error) throw new Error(`workflows.history failed: ${error.message}`)
        matchRunIds = ((data ?? []) as any[]).map((j) => j.result?.run_id).filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
      }

      let runs: any[] = []
      let total = 0
      const idFilter = matchRunIds && searchIds ? matchRunIds.filter((id) => searchIds!.includes(id)) : matchRunIds ?? searchIds
      if (!onlyQueued && (!idFilter || idFilter.length)) {
        let q = host.serviceDb.from('workflow_runs')
          .select('id, workflow_id, status, started_at, completed_at, paused_node_id, version_id, title, started_by, error', { count: 'exact' })
          .eq('tenant_id', tenantId)
        if (visibility === 'all' || full.length === wfIds.length) q = q.in('workflow_id', wfIds)
        else {
          q = q.in('workflow_id', wfIds)
          const parts = [...(full.length ? [`workflow_id.in.(${full.join(',')})`] : []), ...(partialRuns.length ? [`id.in.(${partialRuns.join(',')})`] : [])]
          q = q.or(parts.join(','))
        }
        if (statuses.length) {
          const wantsCancelled = statuses.includes('cancelled')
          const wantsFailed = statuses.includes('failed')
          const plain = statuses.filter((x) => x !== 'failed')
          if (wantsFailed && wantsCancelled) q = q.in('status', [...plain, 'failed'])
          else if (wantsFailed) q = q.or(`status.in.(${plain.join(',') || 'none'}),and(status.eq.failed,error.neq."${MANUAL_CANCEL_ERROR}"),and(status.eq.failed,error.is.null)`)
          else if (wantsCancelled) q = q.or(`status.in.(${plain.join(',')}),and(status.eq.failed,error.eq."${MANUAL_CANCEL_ERROR}")`)
          else q = q.in('status', statuses)
        }
        if (idFilter) q = q.in('id', idFilter.slice(0, 2000))
        if (startedBy) q = q.eq('started_by', startedBy)
        if (since) q = q.gte('started_at', since)
        if (until) q = q.lt('started_at', until)
        let res: any
        if (sort === 'duration') {
          // No duration column: the newest 1 000 matching runs, sorted here, then paged.
          res = await q.order('started_at', { ascending: false }).limit(1000)
          const now = Date.now()
          const ms = (r: any) => (r.started_at ? (['running', 'waiting'].includes(runGroup(String(r.status))) || !r.completed_at ? now : Date.parse(r.completed_at)) - Date.parse(r.started_at) : -1)
          if (!res.error) res = { ...res, data: [...(res.data ?? [])].sort((a: any, b: any) => ms(b) - ms(a)).slice(offset, offset + limit) }
        } else {
          if (sort === 'status') q = q.order('status', { ascending: true })
          res = await q.order('started_at', { ascending: false }).range(offset, offset + limit - 1)
        }
        const { data, error, count } = res
        if (error) throw new Error(`workflows.history failed: ${error.message}`)
        runs = (data ?? []) as any[]
        // Manual cancels as cancelled, and the status filter again in memory (also where the client ignores `or`).
        for (const r of runs) if (isManualCancel(r)) r.status = 'cancelled'
        if (statuses.length) runs = runs.filter((r) => statuses.includes(String(r.status)))
        // Belt and braces: the scope again in memory (also where the client ignores `or`).
        if (visibility === 'involved') runs = runs.filter((r) => full.includes(String(r.workflow_id)) || partialRuns.includes(String(r.id)))
        total = Number(count ?? runs.length)
      }

      // Queued jobs (no run yet) on the first page.
      let queued: any[] = []
      if (offset === 0 && wantQueued && !startedBy && !search) {
        const { data } = await host.serviceDb.from('workflow_queue').select('id, workflow_id, status, trigger_type, trigger_data, result, created_at, error')
          .eq('tenant_id', tenantId).in('workflow_id', wfIds).in('status', ['pending', 'processing']).order('created_at', { ascending: false }).limit(50)
        queued = ((data ?? []) as any[]).filter((j) => !RESUME_TRIGGERS.has(String(j.trigger_type)) && !j.result?.run_id)
          .filter((j) => visibility === 'all' || full.includes(String(j.workflow_id)) || (host.actorId && j.trigger_data?._started_by?.user_id === host.actorId))
          .filter((j) => match.every(([k, v]) => String(j.trigger_data?.[k]) === String(v)))
          .filter((j) => (!since || j.created_at >= since) && (!until || j.created_at < until))
      }

      // Trigger data of the page's runs: only the picked keys (+ event), never the whole payload.
      const runIds = runs.map((r) => String(r.id))
      const jobByRun = new Map<string, any>()
      if (runIds.length) {
        const sel = ['workflow_id', 'trigger_type', 'created_at', 'run_id:result->>run_id', 'ev:trigger_data->event', ...picks.map((k, i) => `p${i}:trigger_data->${k}`)].join(', ')
        let res = await host.serviceDb.from('workflow_queue').select(sel).eq('tenant_id', tenantId).in('result->>run_id', runIds).order('created_at', { ascending: true }).limit(runIds.length * 4)
        if (res.error) res = await host.serviceDb.from('workflow_queue').select('workflow_id, trigger_type, created_at, result, trigger_data').eq('tenant_id', tenantId).in('result->>run_id', runIds).order('created_at', { ascending: true }).limit(runIds.length * 4)
        for (const j of (res.data ?? []) as any[]) {
          const runId = String(j.run_id ?? j.result?.run_id ?? '')
          if (!runId || RESUME_TRIGGERS.has(String(j.trigger_type)) || jobByRun.has(runId)) continue
          jobByRun.set(runId, j)
        }
      }
      const picked = (j: any): Record<string, string | number | boolean | null> => Object.fromEntries(picks.map((k, i) => [k, scalar(j && `p${i}` in j ? j[`p${i}`] : j?.trigger_data?.[k])]))
      const eventOf = (j: any) => { const e = j ? ('ev' in j ? j.ev : j.trigger_data?.event) : null; return typeof e === 'string' ? e : null }

      // Open tasks of waiting runs; step labels from the run's version.
      const waitingIds = runs.filter((r) => RUN_GROUPS.waiting.includes(String(r.status))).map((r) => String(r.id))
      const tasksByRun = new Map<string, any[]>()
      if (waitingIds.length) {
        const { data } = await host.serviceDb.from('tasks').select('id, title, status, due_date, assignee_id, assigned_team_id, workflow_run_id, created_at')
          .eq('tenant_id', tenantId).in('workflow_run_id', waitingIds).in('status', OPEN_TASKS).is('deleted_at', null).order('created_at', { ascending: false }).limit(200)
        for (const t of (data ?? []) as any[]) tasksByRun.set(String(t.workflow_run_id), [...(tasksByRun.get(String(t.workflow_run_id)) ?? []), t])
      }
      const versionIds = [...new Set(runs.filter((r) => r.paused_node_id && r.version_id).map((r) => String(r.version_id)))]
      const versionNodes = new Map<string, unknown>()
      if (versionIds.length) {
        const { data } = await host.serviceDb.from('workflow_versions').select('id, nodes').in('id', versionIds)
        for (const v of (data ?? []) as any[]) versionNodes.set(String(v.id), v.nodes)
      }
      const allTasks = [...tasksByRun.values()].flat()
      const [people, teams] = await Promise.all([
        names(host, 'users', [...runs.map((r) => String(r.started_by ?? '')), ...queued.map((j) => String(j.trigger_data?._started_by?.user_id ?? '')), ...(assignees ? allTasks.map((t) => String(t.assignee_id ?? '')) : [])]),
        assignees ? names(host, 'teams', allTasks.map((t) => String(t.assigned_team_id ?? ''))) : Promise.resolve(new Map<string, string>()),
      ])

      const now = Date.now()
      const items: ExtensionRunHistoryItem[] = queued.map((j) => ({
        workflowId: String(j.workflow_id), workflowName: wfById.get(String(j.workflow_id))?.name ?? null, runId: null, jobId: String(j.id),
        startedById: typeof j.trigger_data?._started_by?.user_id === 'string' ? j.trigger_data._started_by.user_id : null,
        status: String(j.status), group: 'waiting' as const, event: typeof j.trigger_data?.event === 'string' ? j.trigger_data.event : null,
        queuedAt: j.created_at ?? null, startedAt: null, completedAt: null, path: null, title: null, durationMs: null, currentStep: null,
        startedBy: people.get(String(j.trigger_data?._started_by?.user_id ?? '')) ?? null,
        data: picked({ trigger_data: j.trigger_data }), tasks: [], error: j.error ? String(j.error).slice(0, 300) : null,
      }))
      for (const r of runs) {
        if (isManualCancel(r)) r.status = 'cancelled'
        const id = String(r.id)
        const job = jobByRun.get(id)
        const status = String(r.status)
        const started = r.started_at ? new Date(r.started_at).getTime() : null
        const ended = r.completed_at ? new Date(r.completed_at).getTime() : null
        const tasks: ExtensionRunTask[] = (tasksByRun.get(id) ?? []).map((t) => ({
          id: String(t.id), title: String(t.title ?? ''), status: String(t.status), dueAt: t.due_date ?? null,
          assignee: assignees ? people.get(String(t.assignee_id ?? '')) ?? null : null,
          team: assignees ? teams.get(String(t.assigned_team_id ?? '')) ?? null : null,
        }))
        items.push({
          workflowId: String(r.workflow_id), workflowName: wfById.get(String(r.workflow_id))?.name ?? null, runId: id, jobId: null,
          startedById: r.started_by ? String(r.started_by) : null,
          status, group: runGroup(status), event: eventOf(job), queuedAt: job?.created_at ?? null, startedAt: r.started_at ?? null, completedAt: r.completed_at ?? null,
          path: `/automations/runs/${id}`, title: r.title ?? null,
          // Open runs: so far (a paused run may carry the pause time in completed_at).
          durationMs: started === null ? null : ['running', 'waiting'].includes(runGroup(status)) ? Math.max(0, now - started) : ended !== null ? Math.max(0, ended - started) : null,
          currentStep: RUN_GROUPS.waiting.includes(status) ? (nodeLabel(versionNodes.get(String(r.version_id)) ?? wfById.get(String(r.workflow_id))?.nodes, r.paused_node_id ?? null) ?? tasks[0]?.title ?? null) : null,
          startedBy: people.get(String(r.started_by ?? '')) ?? null,
          data: picked(job), tasks, error: r.error ? String(r.error).slice(0, 300) : null,
        })
      }
      return { runs: items, total, queued: queued.length, hasMore: offset + runs.length < total, visibility, assignees }
    },

    async waiting(options: { trigger?: string; workflowIds?: string[] } = {}): Promise<ExtensionWaiting> {
      if (!host.tenantId) throw new Error('workflows.waiting needs a workspace')
      const none: ExtensionWaiting = { total: 0, steps: [], assignees: [], assigneesVisible: false }
      if (!has(host, 'workflows.view')) return none
      const workflows = await ownWorkflows(host, options.trigger, options.workflowIds, 'id, name, nodes')
      if (!workflows.length) return none
      const byId = new Map(workflows.map((w) => [String(w.id), w]))
      const { data: open } = await host.serviceDb.from('workflow_runs').select('id, workflow_id, paused_node_id, version_id')
        .eq('tenant_id', host.tenantId).in('workflow_id', [...byId.keys()]).in('status', RUN_GROUPS.waiting).order('started_at', { ascending: false }).limit(5000)
      const runs = (open ?? []) as any[]
      if (!runs.length) return { ...none, assigneesVisible: has(host, 'workflows.view_runs') || has(host, 'tasks.view_all') }
      const versionIds = [...new Set(runs.map((r) => r.version_id).filter(Boolean).map(String))]
      const versions = new Map<string, unknown>()
      if (versionIds.length) for (const v of ((await host.serviceDb.from('workflow_versions').select('id, nodes').in('id', versionIds)).data ?? []) as any[]) versions.set(String(v.id), v.nodes)
      const steps = new Map<string, { workflowId: string; workflowName: string; step: string; count: number }>()
      for (const r of runs) {
        const w = byId.get(String(r.workflow_id))
        const step = nodeLabel(versions.get(String(r.version_id)) ?? w?.nodes, r.paused_node_id ?? null) ?? 'Waiting'
        const key = `${r.workflow_id}|${step}`
        const hit = steps.get(key) ?? { workflowId: String(r.workflow_id), workflowName: String(w?.name ?? ''), step, count: 0 }
        hit.count++
        steps.set(key, hit)
      }
      const visible = has(host, 'workflows.view_runs') || has(host, 'tasks.view_all')
      const { data: tasks } = await host.serviceDb.from('tasks').select('assignee_id, assigned_team_id')
        .eq('tenant_id', host.tenantId).in('workflow_run_id', runs.map((r) => String(r.id)).slice(0, 2000)).in('status', OPEN_TASKS).is('deleted_at', null).limit(5000)
      const counts = new Map<string, { kind: 'person' | 'team' | 'none'; id: string | null; count: number }>()
      for (const t of (tasks ?? []) as any[]) {
        const kind = t.assignee_id ? 'person' : t.assigned_team_id ? 'team' : 'none'
        const id = t.assignee_id ?? t.assigned_team_id ?? null
        const key = visible ? `${kind}:${id}` : 'hidden'
        const hit = counts.get(key) ?? { kind, id: visible ? id : null, count: 0 }
        hit.count++
        counts.set(key, hit)
      }
      const [people, teams] = visible
        ? await Promise.all([names(host, 'users', [...counts.values()].filter((c) => c.kind === 'person').map((c) => String(c.id))), names(host, 'teams', [...counts.values()].filter((c) => c.kind === 'team').map((c) => String(c.id)))])
        : [new Map<string, string>(), new Map<string, string>()]
      return {
        total: runs.length,
        steps: [...steps.values()].sort((a, b) => b.count - a.count),
        assignees: [...counts.values()].map((c) => ({ name: !visible ? null : c.kind === 'person' ? people.get(String(c.id)) ?? null : c.kind === 'team' ? teams.get(String(c.id)) ?? null : null, team: c.kind === 'team', unassigned: c.kind === 'none', count: c.count })).sort((a, b) => b.count - a.count),
        assigneesVisible: visible,
      }
    },

    async cancelRun(ref: { runId?: string; jobId?: string }): Promise<{ cancelled: boolean }> {
      if (!host.tenantId) throw new Error('workflows.cancelRun needs a workspace')
      const types = await triggerTypes(host.extensionId)
      const ctx = await serviceContext(host as any)
      if (ref?.jobId) {
        if (!UUID_RE.test(ref.jobId)) throw new ExtensionError('not_found', 'Queue item not found', 404)
        const { data } = await host.serviceDb.from('workflow_queue').select('id, trigger_type').eq('tenant_id', host.tenantId).eq('id', ref.jobId).maybeSingle()
        if (!data || !types.includes(String(data.trigger_type))) throw new ExtensionError('not_found', 'Queue item not found', 404)
        const { actOnQueueJob } = await import('@/lib/services/workflow-queue')
        await asExtensionError(() => actOnQueueJob(ctx as any, ref.jobId!, 'cancel'))
        return { cancelled: true }
      }
      const runId = String(ref?.runId ?? '')
      const run = await ownRun(host, runId, types)
      const { actOnWorkflowRun } = await import('@/lib/services/workflow-runs')
      await asExtensionError(() => actOnWorkflowRun(ctx as any, { runId: run.id }, { action: 'cancel' }))
      return { cancelled: true }
    },

    async retryRun(runId: string): Promise<{ started: boolean }> {
      if (!host.tenantId) throw new Error('workflows.retryRun needs a workspace')
      if (!has(host, 'workflows.start') && !has(host, 'workflows.activate')) throw new ExtensionError('forbidden', 'Forbidden: you lack workflows.start', 403)
      const types = await triggerTypes(host.extensionId)
      const run = await ownRun(host, String(runId), types)
      if (!RUN_GROUPS.failed.includes(String(run.status))) throw new ExtensionError('invalid_request', 'Only a failed or cancelled run can be run again', 400)
      const { data: jobs } = await host.serviceDb.from('workflow_queue').select('trigger_type, trigger_data, created_at').eq('tenant_id', host.tenantId).in('result->>run_id', [run.id]).order('created_at', { ascending: true }).limit(5)
      const job = ((jobs ?? []) as any[]).find((j) => types.includes(String(j.trigger_type)))
      if (!job) throw new ExtensionError('conflict', 'The run\'s start data is no longer available', 409)
      const data: Record<string, unknown> = { ...(job.trigger_data ?? {}), _retry_of: run.id }
      delete data._started_by
      delete data._dedupe_key
      const { data: wf } = await host.serviceDb.from('workflows').select('id, name, published_version_id, is_active').eq('tenant_id', host.tenantId).eq('id', run.workflow_id).maybeSingle()
      if (!wf?.is_active) throw new ExtensionError('conflict', 'Turn the workflow on before running it again', 409)
      data._version_id = wf.published_version_id ?? data._version_id ?? null
      const { withQueuedInitiator } = await import('@/lib/workflow-initiator')
      const signed = host.actorId ? withQueuedInitiator(data, { tenantId: host.tenantId, workflowId: wf.id }, { userId: host.actorId, via: 'ui' }) : data
      const { error } = await host.serviceDb.rpc('enqueue_workflow', { p_workflow_id: wf.id, p_tenant_id: host.tenantId, p_task_id: null, p_trigger_type: job.trigger_type, p_trigger_data: signed, p_priority: 0, p_delay_seconds: 0 })
      if (error) throw new Error(`workflows.retryRun failed: ${error.message}`)
      const { writeAudit } = await import('@/lib/audit-log')
      await writeAudit({ supabase: host.serviceDb, tenantId: host.tenantId, actorId: host.actorId, objectType: 'workflow', objectId: wf.id, action: 'execute', summary: `Ran workflow "${wf.name}" again after run ${run.id.slice(0, 8)} ${run.status} (extension ${host.extensionId})`, metadata: { retry_of: run.id, extension: host.extensionId } })
      const { kickQueueProcessor } = await import('@/lib/process-queue')
      kickQueueProcessor()
      return { started: true }
    },

    async stats(options: { trigger?: string; workflowIds?: string[]; days?: number } = {}): Promise<ExtensionRunStats> {
      if (!host.tenantId) throw new Error('workflows.stats needs a workspace')
      const p = period(options.days)
      const base = { since: p.since.toISOString(), until: p.until.toISOString(), days: p.days }
      const workflows = has(host, 'workflows.view') ? await ownWorkflows(host, options.trigger, options.workflowIds) : []
      if (!workflows.length) return { ...base, workflows: [], totals: counts(undefined, p.dayKeys) }
      const ids = workflows.map((w) => String(w.id))
      let raw: { workflows: Array<RawCounts & { workflow_id: string }>; total: RawCounts } | null = null
      if (typeof host.serviceDb.rpc === 'function') {
        const { data, error } = await host.serviceDb.rpc('workflow_run_stats', { p_tenant_id: host.tenantId, p_workflow_ids: ids, p_since: base.since, p_until: base.until })
        if (error && !isMissingFunction(error)) throw new Error(`workflows.stats failed: ${error.message}`)
        if (!error && data) raw = data
      }
      if (!raw) {
        const [periodRuns, liveRuns, queuedJobs] = await Promise.all([
          host.serviceDb.from('workflow_runs').select('workflow_id, status, started_at, completed_at, error').eq('tenant_id', host.tenantId).in('workflow_id', ids)
            .gte('started_at', base.since).lt('started_at', base.until).order('started_at', { ascending: false }).limit(FALLBACK_ROWS),
          host.serviceDb.from('workflow_runs').select('workflow_id, status').eq('tenant_id', host.tenantId).in('workflow_id', ids).in('status', ['running', ...RUN_GROUPS.waiting]).limit(FALLBACK_ROWS),
          host.serviceDb.from('workflow_queue').select('workflow_id, trigger_type, result').eq('tenant_id', host.tenantId).in('workflow_id', ids).in('status', ['pending', 'processing']).limit(FALLBACK_ROWS),
        ])
        for (const r of [periodRuns, liveRuns, queuedJobs]) if (r.error) throw new Error(`workflows.stats failed: ${r.error.message}`)
        raw = aggregateRuns(ids, ((periodRuns.data ?? []) as any[]).map((r) => (isManualCancel(r) ? { ...r, status: 'cancelled' } : r)), liveRuns.data ?? [], ((queuedJobs.data ?? []) as any[]).filter((j) => !RESUME_TRIGGERS.has(String(j.trigger_type)) && !j.result?.run_id))
      }
      const byId = new Map((raw.workflows ?? []).map((w) => [String(w.workflow_id), w]))
      return {
        ...base,
        workflows: workflows.map((w) => ({ workflowId: String(w.id), name: String(w.name), ...counts(byId.get(String(w.id)), p.dayKeys) })),
        totals: counts(raw.total, p.dayKeys),
      }
    },
  }
}

/* ── forms ──────────────────────────────────────────────────────────── */

export function hostInsightsForms(host: InsightsHost) {
  return {
    async submissionStats(options: { formIds?: string[]; key?: string; days?: number } = {}): Promise<ExtensionSubmissionStats> {
      if (!host.tenantId) throw new Error('forms.submissionStats needs a workspace')
      const p = period(options.days)
      const base = { since: p.since.toISOString(), until: p.until.toISOString(), days: p.days }
      const empty = { ...base, forms: [], totals: { total: 0, lastAt: null, perDay: p.dayKeys.map((day) => ({ day, count: 0 })) } }
      if (!has(host, 'forms.view')) return empty
      const wanted = options.formIds === undefined ? undefined : uuids(options.formIds)
      if (wanted && !wanted.length) return empty
      let q = host.serviceDb.from('forms').select('id, name, version, layout, updated_at').eq('tenant_id', host.tenantId)
      if (wanted) q = q.in('id', wanted.slice(0, 500))
      const { data: rows, error } = await q.order('updated_at', { ascending: false }).limit(2000)
      if (error) throw new Error(`forms.submissionStats failed: ${error.message}`)
      const forms = ((rows ?? []) as any[]).map((r) => boundForm(host.extensionId, r)).filter((f): f is NonNullable<typeof f> => Boolean(f) && (!options.key || f!.key === options.key)).slice(0, 500)
      if (!forms.length) return empty
      const ids = forms.map((f) => f.id)
      let raw: Array<{ form_id: string; total: number; last_at: string | null; per_day: Array<{ day: string; count: number }> }> | null = null
      if (typeof host.serviceDb.rpc === 'function') {
        const res = await host.serviceDb.rpc('form_submission_stats', { p_tenant_id: host.tenantId, p_form_ids: ids, p_since: base.since, p_until: base.until })
        if (res.error && !isMissingFunction(res.error)) throw new Error(`forms.submissionStats failed: ${res.error.message}`)
        if (!res.error && res.data) raw = res.data.forms ?? []
      }
      if (!raw) {
        const [inPeriod, latest] = await Promise.all([
          host.serviceDb.from('form_submissions').select('form_id, created_at').eq('tenant_id', host.tenantId).in('form_id', ids).gte('created_at', base.since).lt('created_at', base.until).order('created_at', { ascending: false }).limit(FALLBACK_ROWS),
          Promise.all(ids.map((id) => host.serviceDb.from('form_submissions').select('created_at').eq('tenant_id', host.tenantId).eq('form_id', id).order('created_at', { ascending: false }).limit(1))),
        ])
        if (inPeriod.error) throw new Error(`forms.submissionStats failed: ${inPeriod.error.message}`)
        raw = ids.map((id, i) => {
          const days = new Map<string, number>()
          for (const s of (inPeriod.data ?? []) as any[]) if (String(s.form_id) === id) { const d = new Date(s.created_at).toISOString().slice(0, 10); days.set(d, (days.get(d) ?? 0) + 1) }
          return { form_id: id, total: [...days.values()].reduce((a, b) => a + b, 0), last_at: latest[i].data?.[0]?.created_at ?? null, per_day: [...days].map(([day, count]) => ({ day, count })) }
        })
      }
      const byId = new Map(raw.map((r) => [String(r.form_id), r]))
      const fill = (perDay: Array<{ day: string; count: number }> | undefined) => { const m = new Map((perDay ?? []).map((d) => [String(d.day), Number(d.count) || 0])); return p.dayKeys.map((day) => ({ day, count: m.get(day) ?? 0 })) }
      const out = forms.map((f) => {
        const r = byId.get(f.id)
        return { formId: f.id, name: f.name, key: f.key, total: Number(r?.total ?? 0) || 0, lastAt: r?.last_at ?? null, perDay: fill(r?.per_day) }
      })
      const lastAt = out.map((f) => f.lastAt).filter((x): x is string => Boolean(x)).sort((a, b) => Date.parse(a) - Date.parse(b)).pop() ?? null
      return {
        ...base, forms: out,
        totals: { total: out.reduce((a, f) => a + f.total, 0), lastAt, perDay: p.dayKeys.map((day, i) => ({ day, count: out.reduce((a, f) => a + f.perDay[i].count, 0) })) },
      }
    },
  }
}
