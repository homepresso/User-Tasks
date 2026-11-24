import { INSTANCE_DAILY_KINDS, INSTANCE_REPORT_DATASET, type InstanceDailySourceKey } from '@/lib/instance-admin/report-sources'
import { rateLimit } from '@/lib/rate-limit'
import { ServiceError } from '../context'
import { ACCESS_MESSAGE, instanceDb, isInstanceAdminUser } from './access'
import { readDataset } from './reads'
import { dailyCounts } from './stats'

/**
 * Rows of the "UserTasks instance" report sources, for an instance admin
 * (`actorId`: the signed-in person or a user key's person; never a tenant
 * key or the in-app Agent — callers pass null then and get the access
 * message). Operational data only: list sources are the datasets' declared
 * columns; daily sources are counts and sums.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

const DAY = 86_400_000

export async function instanceReportRows(actorId: string | null | undefined, sourceKey: string, cap = 2000): Promise<Array<Record<string, unknown>>> {
  if (!actorId) throw ServiceError.forbidden(ACCESS_MESSAGE)
  const who = await isInstanceAdminUser(actorId)
  if (!who.ok) throw ServiceError.forbidden(ACCESS_MESSAGE)
  const limited = await rateLimit(`instance-admin:read:${actorId}`, { max: 300, windowMs: 60_000 })
  if (!limited.ok) throw new ServiceError('rate_limited', 'Too many instance admin requests: try again in a minute')
  const max = Math.max(1, Math.min(cap, 5000))
  const dataset = INSTANCE_REPORT_DATASET[sourceKey]
  if (dataset) {
    const rows: Array<Record<string, unknown>> = []
    const days = dataset === 'ai_usage' ? 90 : dataset === 'usage' ? 30 : undefined
    for (let offset = 0; offset < max; offset += 200) {
      const page = await readDataset(dataset, { limit: Math.min(200, max - offset), offset, ...(days ? { days } : {}) })
      rows.push(...page.rows)
      if (page.rows.length < 200 || rows.length >= page.total) break
    }
    return rows.slice(0, max)
  }
  const daily = INSTANCE_DAILY_KINDS[sourceKey as InstanceDailySourceKey]
  if (!daily) throw ServiceError.validation('Unknown instance report source')
  const to = new Date()
  const { rows } = await dailyCounts(daily.kind, new Date(to.getTime() - 365 * DAY), to)
  const ids = [...new Set(rows.map((r) => r.tenant_id).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await (instanceDb() as any).from('tenants').select('id, name').in('id', ids.slice(i, i + 200))
    for (const t of (data ?? []) as any[]) names.set(t.id, t.name)
  }
  const weekOf = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }
  return rows.slice(0, max).map((r) => ({
    id: `${r.day}|${r.tenant_id}|${r.status}`, day: r.day, week: weekOf(r.day), month: r.day.slice(0, 7),
    workspace_id: r.tenant_id, workspace: names.get(r.tenant_id ?? '') ?? 'Unknown', status: r.status, count: r.n,
    cost: r.amount === null ? null : Math.round(r.amount * 10000) / 10000,
  }))
}
