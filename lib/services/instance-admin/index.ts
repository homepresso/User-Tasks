import {
  INSTANCE_FACT_DATASETS, instanceDatasetParamsSchema, isInstanceDataset, type InstanceDataset, type InstanceFactDataset,
} from '@/lib/instance-admin/schema'
import { ServiceError, type ServiceContext } from '../context'
import { instanceDb, requireInstanceAdmin, type InstanceAdmin } from './access'
import { readDataset, type InstancePage } from './reads'
import { dailyCounts, workspaceStats } from './stats'

/**
 * Instance admin ("cloud admin") service entry points: every call checks the
 * instance admin first (lib/services/instance-admin/access.ts).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

export { runInstanceAction, InstanceAuditUnavailable } from './actions'
export { isInstanceAdmin, requireInstanceAdmin, ACCESS_MESSAGE } from './access'
export type { InstancePage } from './reads'

/** Read one dataset as an instance admin (404 for everyone else). */
export async function readInstanceDataset(
  ctx: ServiceContext,
  dataset: InstanceDataset,
  rawParams: unknown,
  options: { via?: InstanceAdmin['via']; refusal?: 'not_found' | 'forbidden' } = {},
): Promise<InstancePage> {
  await requireInstanceAdmin(ctx, { kind: 'read', via: options.via, refusal: options.refusal })
  if (!isInstanceDataset(dataset)) throw ServiceError.validation('Unknown dataset')
  const parsed = instanceDatasetParamsSchema.safeParse(rawParams ?? {})
  if (!parsed.success) throw ServiceError.validation(`Invalid parameters: ${parsed.error.issues[0]?.message ?? 'check them'}`, parsed.error.issues)
  return readDataset(dataset, parsed.data)
}

/** One fact for the app builder's metrics, charts and pivots (same shape as lib/services/app-widgets.ts Fact). */
export interface InstanceFact { at: string; status: string | null; workflow: null; form: null; person: string | null; data: Record<string, unknown>; n?: number }

const DAY = 86_400_000

async function names(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await (instanceDb() as any).from('tenants').select('id, name').in('id', unique.slice(i, i + 200))
    for (const t of (data ?? []) as any[]) out.set(t.id, t.name)
  }
  return out
}

/**
 * Facts of a fact dataset in [from, to) (default: the last 90 days), as an
 * instance admin. Daily counts come back weighted (`n`), so charts never
 * scan raw rows once the migration is applied.
 */
export async function instanceFacts(
  ctx: ServiceContext,
  dataset: InstanceFactDataset,
  range: { from?: Date | null; to?: Date | null },
  options: { workspaceId?: string | null; refusal?: 'not_found' | 'forbidden' } = {},
): Promise<{ rows: InstanceFact[]; truncated: boolean }> {
  await requireInstanceAdmin(ctx, { kind: 'read', via: 'app', refusal: options.refusal })
  if (!(INSTANCE_FACT_DATASETS as readonly string[]).includes(dataset)) throw ServiceError.validation('Unknown dataset')
  const to = range.to ?? new Date()
  const from = range.from ?? new Date(to.getTime() - 90 * DAY)
  const ws = options.workspaceId ?? null
  const fact = (at: string, status: string | null, data: Record<string, unknown>, n?: number): InstanceFact => ({ at, status, workflow: null, form: null, person: null, data, ...(n !== undefined ? { n } : {}) })
  const daily = async (kind: Parameters<typeof dailyCounts>[0], withAmount = false) => {
    const { rows, truncated } = await dailyCounts(kind, from, to)
    const filtered = ws ? rows.filter((r) => r.tenant_id === ws) : rows
    const map = await names(filtered.map((r) => r.tenant_id ?? ''))
    if (withAmount) {
      // Sum and average need one row per fact: spread the day's amount evenly over its n rows (weights keep counts right).
      return { truncated, rows: filtered.map((r) => fact(`${r.day}T12:00:00.000Z`, r.status, { workspace: map.get(r.tenant_id ?? '') ?? 'Unknown', status: r.status, cost: Math.round(((r.amount ?? 0) / Math.max(1, r.n)) * 10000) / 10000 }, r.n)) }
    }
    return { truncated, rows: filtered.map((r) => fact(`${r.day}T12:00:00.000Z`, r.status, { workspace: map.get(r.tenant_id ?? '') ?? 'Unknown', status: r.status, plan: r.status }, r.n)) }
  }
  const db = instanceDb() as any
  switch (dataset) {
    case 'signups': return daily('signups')
    case 'people': return daily('people')
    case 'runs': return daily('runs')
    case 'tasks': return daily('tasks')
    case 'ai_requests': return daily('ai_requests', true)
    case 'agent_errors': {
      const r = await daily('agent_runs')
      return { truncated: r.truncated, rows: r.rows.filter((f) => f.status === 'failed') }
    }
    case 'active_people': {
      let q = db.from('users').select('id, tenant_id, last_seen_at').is('deleted_at', null).gte('last_seen_at', from.toISOString()).lt('last_seen_at', to.toISOString()).limit(5000)
      if (ws) q = q.eq('tenant_id', ws)
      const { data } = await q
      const map = await names(((data ?? []) as any[]).map((u) => u.tenant_id))
      return { truncated: (data ?? []).length >= 5000, rows: ((data ?? []) as any[]).map((u) => ({ ...fact(u.last_seen_at, null, { workspace: map.get(u.tenant_id) ?? 'Unknown' }), person: u.id })) }
    }
    case 'invitations': {
      let q = db.from('invitations').select('tenant_id, role, accepted_at, expires_at, created_at').gte('created_at', from.toISOString()).lt('created_at', to.toISOString()).limit(5000)
      if (ws) q = q.eq('tenant_id', ws)
      const { data } = await q
      const map = await names(((data ?? []) as any[]).map((i) => i.tenant_id))
      return {
        truncated: (data ?? []).length >= 5000,
        rows: ((data ?? []) as any[]).map((i) => {
          const status = i.accepted_at ? 'accepted' : new Date(i.expires_at).getTime() < Date.now() ? 'expired' : 'pending'
          return fact(i.created_at, status, { workspace: map.get(i.tenant_id) ?? 'Unknown', role: i.role, status })
        }),
      }
    }
    case 'storage': {
      let tq = db.from('tenants').select('id, name').is('deleted_at', null).limit(2000)
      if (ws) tq = tq.eq('id', ws)
      const { data: tenants } = await tq
      const stats = await workspaceStats(((tenants ?? []) as any[]).map((t) => t.id))
      const now = new Date().toISOString()
      return {
        truncated: false,
        rows: ((tenants ?? []) as any[]).map((t) => {
          const bytes = stats.get(t.id)?.storage_bytes ?? 0
          return fact(now, null, { workspace: t.name, bytes, mb: Math.round((bytes / 1_048_576) * 100) / 100 })
        }),
      }
    }
    case 'admin_actions': {
      let q = db.from('instance_admin_audit').select('created_at, action, admin_email, target_tenant_id, outcome').gte('created_at', from.toISOString()).lt('created_at', to.toISOString()).limit(5000)
      if (ws) q = q.eq('target_tenant_id', ws)
      const { data, error } = await q
      if (error) return { rows: [], truncated: false }
      const map = await names(((data ?? []) as any[]).map((a) => a.target_tenant_id))
      return {
        truncated: (data ?? []).length >= 5000,
        rows: ((data ?? []) as any[]).map((a) => fact(a.created_at, a.outcome, { action: a.action, admin: a.admin_email, workspace: map.get(a.target_tenant_id) ?? '—', outcome: a.outcome })),
      }
    }
  }
}
