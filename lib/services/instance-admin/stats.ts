import { instanceDb } from './access'

/**
 * Cross-workspace operational counts. Uses the migration's aggregate RPCs
 * (instance_admin_workspace_stats / instance_admin_daily_counts) and falls
 * back to plain, capped queries before migration 20270129090000 is applied.
 * Counts and sums only.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

export interface WorkspaceStats {
  tenant_id: string
  members: number
  active_members: number
  active_7d: number
  active_30d: number
  pending_invitations: number
  forms: number
  workflows: number
  active_workflows: number
  apps: number
  data_tables: number
  reports: number
  agents: number
  runs_30d: number
  failed_runs_7d: number
  open_tasks: number
  ai_requests_30d: number
  ai_cost_30d: number
  storage_bytes: number
  queue_pending: number
  queue_dead: number
  last_activity_at: string | null
}

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0 }

async function headCount(build: (db: any) => any): Promise<number> {
  try {
    const { count, error } = await build(instanceDb() as any)
    return error ? 0 : Number(count ?? 0)
  } catch {
    return 0
  }
}

const count = (table: string) => (db: any) => db.from(table).select('id', { count: 'exact', head: true })

async function fallbackStats(tenantId: string): Promise<WorkspaceStats> {
  const db = instanceDb() as any
  const members = await db.from('user_memberships').select('user_id, is_active').eq('tenant_id', tenantId).limit(5000)
  const rows = ((members.data ?? []) as any[])
  const activeIds = rows.filter((r) => r.is_active).map((r) => r.user_id)
  let seen: string[] = []
  if (activeIds.length) {
    const { data } = await db.from('users').select('last_seen_at').in('id', activeIds.slice(0, 1000))
    seen = ((data ?? []) as any[]).map((u) => u.last_seen_at).filter(Boolean)
  }
  const since = (days: number) => seen.filter((s) => new Date(s).getTime() >= Date.now() - days * DAY).length
  const sumOf = async (table: string, column: string, build: (q: any) => any) => {
    try {
      const { data } = await build(db.from(table).select(column).eq('tenant_id', tenantId)).limit(10_000)
      return ((data ?? []) as any[]).reduce((s, r) => s + num(r[column]), 0)
    } catch { return 0 }
  }
  const [pending, forms, workflows, activeWorkflows, apps, tables, reports, agents, runs, failed, open, agentRuns, assistant, aiCostA, aiCostB, filesA, filesB, qPending, qDead] = await Promise.all([
    headCount((d) => count('invitations')(d).eq('tenant_id', tenantId).is('accepted_at', null).gt('expires_at', new Date().toISOString())),
    headCount((d) => count('forms')(d).eq('tenant_id', tenantId)),
    headCount((d) => count('workflows')(d).eq('tenant_id', tenantId)),
    headCount((d) => count('workflows')(d).eq('tenant_id', tenantId).eq('is_active', true)),
    headCount((d) => count('apps')(d).eq('tenant_id', tenantId)),
    headCount((d) => count('custom_tables')(d).eq('tenant_id', tenantId)),
    headCount((d) => count('reports')(d).eq('tenant_id', tenantId)),
    headCount((d) => count('agents')(d).eq('tenant_id', tenantId)),
    headCount((d) => count('workflow_runs')(d).eq('tenant_id', tenantId).gte('started_at', ago(30))),
    headCount((d) => count('workflow_runs')(d).eq('tenant_id', tenantId).eq('status', 'failed').gte('started_at', ago(7))),
    headCount((d) => count('tasks')(d).eq('tenant_id', tenantId).is('deleted_at', null).in('status', ['draft', 'todo', 'in_progress', 'blocked'])),
    headCount((d) => count('agent_runs')(d).eq('tenant_id', tenantId).gte('started_at', ago(30))),
    headCount((d) => count('assistant_usage')(d).eq('tenant_id', tenantId).gte('created_at', ago(30))),
    sumOf('agent_runs', 'cost_amount', (q) => q.gte('started_at', ago(30))),
    sumOf('assistant_usage', 'cost_amount', (q) => q.gte('created_at', ago(30))),
    sumOf('form_files', 'size', (q) => q),
    sumOf('task_attachments', 'size', (q) => q.is('deleted_at', null)),
    headCount((d) => count('workflow_queue')(d).eq('tenant_id', tenantId).in('status', ['pending', 'processing'])),
    headCount((d) => count('workflow_queue')(d).eq('tenant_id', tenantId).eq('status', 'dead').gte('created_at', ago(7))),
  ])
  return {
    tenant_id: tenantId, members: rows.length, active_members: activeIds.length, active_7d: since(7), active_30d: since(30),
    pending_invitations: pending, forms, workflows, active_workflows: activeWorkflows, apps, data_tables: tables, reports, agents,
    runs_30d: runs, failed_runs_7d: failed, open_tasks: open, ai_requests_30d: agentRuns + assistant, ai_cost_30d: aiCostA + aiCostB,
    storage_bytes: filesA + filesB, queue_pending: qPending, queue_dead: qDead,
    last_activity_at: seen.length ? seen.sort().at(-1)! : null,
  }
}

let rpcMissing = false

/** Stats of these workspaces (any number; RPC in chunks of 200, else per workspace). */
export async function workspaceStats(tenantIds: readonly string[]): Promise<Map<string, WorkspaceStats>> {
  const out = new Map<string, WorkspaceStats>()
  const ids = [...new Set(tenantIds)]
  if (!ids.length) return out
  if (!rpcMissing) {
    try {
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await (instanceDb() as any).rpc('instance_admin_workspace_stats', { p_tenant_ids: ids.slice(i, i + 200) })
        if (error) throw Object.assign(new Error(error.message), { missing: /function|does not exist|schema cache/i.test(error.message ?? '') })
        for (const r of (data ?? []) as any[]) {
          out.set(r.tenant_id, {
            tenant_id: r.tenant_id, members: num(r.members), active_members: num(r.active_members), active_7d: num(r.active_7d), active_30d: num(r.active_30d),
            pending_invitations: num(r.pending_invitations), forms: num(r.forms), workflows: num(r.workflows), active_workflows: num(r.active_workflows),
            apps: num(r.apps), data_tables: num(r.data_tables), reports: num(r.reports), agents: num(r.agents), runs_30d: num(r.runs_30d),
            failed_runs_7d: num(r.failed_runs_7d), open_tasks: num(r.open_tasks), ai_requests_30d: num(r.ai_requests_30d),
            ai_cost_30d: Math.round(num(r.ai_cost_30d) * 100) / 100, storage_bytes: num(r.storage_bytes), queue_pending: num(r.queue_pending),
            queue_dead: num(r.queue_dead), last_activity_at: r.last_activity_at ?? null,
          })
        }
      }
      return out
    } catch (error) {
      if ((error as any)?.missing) rpcMissing = true
      else console.warn('[instance-admin] workspace stats RPC failed:', (error as Error).message)
    }
  }
  // Fallback: per workspace, at most 50 (callers page).
  const results = await Promise.all(ids.slice(0, 50).map((id) => fallbackStats(id).catch(() => null)))
  for (const r of results) if (r) out.set(r.tenant_id, r)
  return out
}

export type DailyKind = 'runs' | 'tasks' | 'agent_runs' | 'ai_requests' | 'signups' | 'people'
export interface DailyCount { day: string; tenant_id: string | null; status: string | null; n: number; amount: number | null }

const RAW: Record<DailyKind, Array<{ table: string; at: string; status: string | null; tenant: string; amount?: string; extra?: (q: any) => any }>> = {
  runs: [{ table: 'workflow_runs', at: 'started_at', status: 'status', tenant: 'tenant_id' }],
  tasks: [{ table: 'tasks', at: 'created_at', status: 'status', tenant: 'tenant_id', extra: (q) => q.is('deleted_at', null) }],
  agent_runs: [{ table: 'agent_runs', at: 'started_at', status: 'status', tenant: 'tenant_id', amount: 'cost_amount' }],
  ai_requests: [
    { table: 'agent_runs', at: 'started_at', status: 'status', tenant: 'tenant_id', amount: 'cost_amount' },
    { table: 'assistant_usage', at: 'created_at', status: 'status', tenant: 'tenant_id', amount: 'cost_amount' },
  ],
  signups: [{ table: 'tenants', at: 'created_at', status: 'plan', tenant: 'id', extra: (q) => q.is('deleted_at', null) }],
  people: [{ table: 'users', at: 'created_at', status: null, tenant: 'tenant_id', extra: (q) => q.is('deleted_at', null) }],
}

let dailyMissing = false

const DAILY_PAGE = 1000
const DAILY_MAX_ROWS = 100_000

/** Per-day, per-workspace counts in [from, to). `truncated` when the fallback hit its cap. */
export async function dailyCounts(kind: DailyKind, from: Date, to: Date): Promise<{ rows: DailyCount[]; truncated: boolean }> {
  if (!dailyMissing) {
    // Paged: the RPC returns a row per day x workspace x status, and one
    // response is cut at max_rows (1,000) — ~200 workspaces over 7 days
    // already exceed it, which made the overview's totals silently low.
    const all: any[] = []
    let error: any = null
    for (let offset = 0; offset < DAILY_MAX_ROWS; offset += DAILY_PAGE) {
      const call = (instanceDb() as any).rpc('instance_admin_daily_counts', { p_kind: kind, p_from: from.toISOString(), p_to: to.toISOString() })
      const pageable = typeof call?.order === 'function'
      const res = await (pageable ? call.order('day').order('tenant_id').order('status').range(offset, offset + DAILY_PAGE - 1) : call)
      if (res.error) { error = res.error; break }
      const page = (res.data ?? []) as any[]
      all.push(...page)
      if (!pageable || page.length < DAILY_PAGE) break
    }
    if (!error) {
      return {
        rows: all.map((r) => ({ day: String(r.day).slice(0, 10), tenant_id: r.tenant_id ?? null, status: r.status ?? null, n: num(r.n), amount: r.amount === null || r.amount === undefined ? null : num(r.amount) })),
        truncated: all.length >= DAILY_MAX_ROWS,
      }
    }
    if (/function|does not exist|schema cache/i.test(error.message ?? '')) dailyMissing = true
    else console.warn('[instance-admin] daily counts RPC failed:', error.message)
  }
  const CAP = 10_000
  const grouped = new Map<string, DailyCount>()
  let truncated = false
  for (const src of RAW[kind]) {
    const cols = [src.at, src.tenant, src.status, src.amount].filter(Boolean).join(', ')
    let q = (instanceDb() as any).from(src.table).select(cols).gte(src.at, from.toISOString()).lt(src.at, to.toISOString())
    if (src.extra) q = src.extra(q)
    const { data, error } = await q.order(src.at, { ascending: false }).limit(CAP)
    if (error) continue
    if ((data ?? []).length >= CAP) truncated = true
    for (const r of (data ?? []) as any[]) {
      const day = String(r[src.at]).slice(0, 10)
      const status = src.status ? (r[src.status] ?? null) : null
      const key = `${day}|${r[src.tenant]}|${status}`
      const cur = grouped.get(key) ?? { day, tenant_id: r[src.tenant] ?? null, status, n: 0, amount: src.amount ? 0 : null }
      cur.n += 1
      if (src.amount) cur.amount = (cur.amount ?? 0) + num(r[src.amount])
      grouped.set(key, cur)
    }
  }
  return { rows: [...grouped.values()], truncated }
}

/** Tests: forget that an RPC was missing. */
export function resetInstanceStatsForTests(): void {
  rpcMissing = false
  dailyMissing = false
}
