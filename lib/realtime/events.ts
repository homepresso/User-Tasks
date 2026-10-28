import { isRealtimeTopic, NOTIFY_COLUMNS, type ParsedSubscription, type RealtimeOp, type RealtimeTopic } from './topics'

/**
 * Change events for the SSE realtime provider (server side) and the rules
 * that decide who receives them.
 *
 * Events come from the NOTIFY triggers (migration 20261105000000) or, without
 * a LISTEN connection, from polling the tables (./hub). They carry ids and the
 * few columns needed for routing, never row data. A subscriber receives a row
 * only when the row's tenant/user passes the same test the table's SELECT RLS
 * policy applies, evaluated from the subscriber's audience (./audience).
 */

export const NOTIFY_CHANNEL = 'usertasks_realtime'

export interface ChangeRow {
  id: string
  tenant_id: string | null
  /** Routing columns (NOTIFY_COLUMNS): new and, for updates, old values. */
  cols: Record<string, string[]>
}

export interface ChangeEvent {
  /** Database clock (ms) when the statement ran; orders events and resumes streams. */
  ts: number
  table: RealtimeTopic
  op: RealtimeOp
  /** Changed rows; absent for bulk statements. */
  rows?: ChangeRow[]
  /** Bulk statements: tenants touched (null = unknown/too many). */
  tenants?: string[] | null
}

/** What the subscriber may see, mirroring the SELECT policies of the published tables. */
export interface Audience {
  userId: string
  /** rls_visible_tenant_ids(): tasks, task_assignees, lifecycle_events, workflow_logs. */
  visible: ReadonlySet<string>
  /** get_current_tenant_id(): object_audit_log, integration_call_logs (tenant_isolation). */
  current: string | null
  /** users.tenant_id + current tenant: agent_runs. */
  agent: ReadonlySet<string>
  /** get_user_tenant_ids(): every membership (bulk notification fan-out only). */
  member: ReadonlySet<string>
}

const OPS: readonly RealtimeOp[] = ['INSERT', 'UPDATE', 'DELETE']

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** Parse one NOTIFY payload; null when it is not ours or malformed. */
export function parseNotifyPayload(payload: string | undefined): ChangeEvent | null {
  if (!payload) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(payload)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const table = raw.table
  const op = raw.op
  const ts = Number(raw.ts)
  if (!isRealtimeTopic(table) || !OPS.includes(op as RealtimeOp) || !Number.isFinite(ts)) return null
  if (raw.bulk) {
    const tenants = Array.isArray(raw.tenants) ? raw.tenants.map(str).filter((t): t is string => Boolean(t)) : null
    return { ts, table, op: op as RealtimeOp, tenants }
  }
  if (!Array.isArray(raw.rows)) return null
  const rows: ChangeRow[] = []
  for (const r of raw.rows as Array<Record<string, unknown>>) {
    const id = str(r?.id)
    if (!id) continue
    const cols: Record<string, string[]> = {}
    for (const col of NOTIFY_COLUMNS[table]) {
      const v = r[col]
      cols[col] = Array.isArray(v) ? v.map(str).filter((x): x is string => Boolean(x)) : []
    }
    rows.push({ id, tenant_id: str(r.tenant_id), cols })
  }
  return { ts, table, op: op as RealtimeOp, rows }
}

/** Row-level visibility: the table's SELECT policy, evaluated from the audience. */
export function rowVisible(table: RealtimeTopic, row: ChangeRow, audience: Audience): boolean {
  switch (table) {
    case 'notifications':
    case 'user_jobs':
      return (row.cols.user_id ?? []).includes(audience.userId)
    case 'object_audit_log':
    case 'integration_call_logs':
      return row.tenant_id !== null && row.tenant_id === audience.current
    case 'agent_runs':
      return row.tenant_id !== null && audience.agent.has(row.tenant_id)
    default:
      return row.tenant_id !== null && audience.visible.has(row.tenant_id)
  }
}

/** Bulk statements carry no rows: deliver a "something changed" when a touched tenant is visible. */
export function bulkVisible(event: ChangeEvent, audience: Audience): boolean {
  if (event.tenants === null || event.tenants === undefined) return true
  const scope = event.table === 'notifications' || event.table === 'user_jobs' ? audience.member
    : event.table === 'object_audit_log' || event.table === 'integration_call_logs' ? new Set(audience.current ? [audience.current] : [])
    : event.table === 'agent_runs' ? audience.agent
    : audience.visible
  return event.tenants.some((t) => scope.has(t))
}

/** Does a (visible) row match a subscription's filter? */
export function rowMatches(sub: ParsedSubscription, op: RealtimeOp, row: ChangeRow): boolean {
  const { column, value, event } = sub.filter
  if (event && event !== '*' && event !== op) return false
  if (!column) return true
  const v = (value ?? '').toLowerCase()
  if (column === 'id') return row.id.toLowerCase() === v
  if (column === 'tenant_id') return (row.tenant_id ?? '').toLowerCase() === v
  return (row.cols[column] ?? []).some((x) => x.toLowerCase() === v)
}

export interface Delivery {
  key: string
  op: RealtimeOp
  /** null = ids unknown (bulk). */
  ids: string[] | null
}

/**
 * The deliveries one event produces for one subscriber: per matching
 * subscription, the ids of the visible rows that match it. Bulk events reach
 * every subscription on the table (without ids) when a touched tenant is
 * visible.
 */
export function deliveriesFor(event: ChangeEvent, subs: readonly ParsedSubscription[], audience: Audience): Delivery[] {
  const out: Delivery[] = []
  const onTable = subs.filter((s) => s.topic === event.table)
  if (onTable.length === 0) return out
  if (!event.rows) {
    if (!bulkVisible(event, audience)) return out
    for (const sub of onTable) {
      const e = sub.filter.event
      if (!e || e === '*' || e === event.op) out.push({ key: sub.key, op: event.op, ids: null })
    }
    return out
  }
  const visible = event.rows.filter((row) => rowVisible(event.table, row, audience))
  if (visible.length === 0) return out
  for (const sub of onTable) {
    const ids = visible.filter((row) => rowMatches(sub, event.op, row)).map((row) => row.id)
    if (ids.length > 0) out.push({ key: sub.key, op: event.op, ids })
  }
  return out
}
