/**
 * Log export shipper: drains public.event_stream into the configured log
 * destinations. Driven by /api/cron/ship-events (pg_cron every minute); each
 * invocation runs for up to ~50 s:
 *
 *   loop until the time budget is spent:
 *     claim a due destination (claim_next_log_destination: lease with
 *       FOR UPDATE SKIP LOCKED, so overlapping invocations never double-send)
 *     → data-loss check (cursor below the retention purge mark →
 *       lagging_data_lost, system event, cursor jumps forward, admins notified)
 *     → read ≤ 500 matching events after the cursor (filters applied in SQL)
 *     → format + POST (lib/log-export/deliver: egress guard, 10 s timeout)
 *     → 2xx: advance the cursor, stats, status healthy, failures reset
 *       429/408/5xx/network: retrying, exponential backoff (5 s · 2^(n-1),
 *         cap 5 min, ±20% jitter, Retry-After honoured)
 *       other 4xx / config errors: counted; after 5 in a row → failing and
 *         one in-app notification to the tenant's owners/admins
 *     → release the lease (caught-up destinations are due again in ~2 s)
 *     nothing due → sleep until the next one is (≤ 2 s)
 *
 * Delivery is at-least-once: the cursor only advances past events a
 * destination acknowledged; every event carries its stable id for dedupe.
 *
 * Commit-order safety: event ids come from an identity column, so a
 * transaction can commit a lower id after a higher one is visible. The
 * shipper only reads up to a watermark (the newest id observed ≥ 2 s ago),
 * so the cursor never skips an id that was still in flight.
 *
 * Never logs credentials: errors stored in last_error are redacted.
 */

import type { LogDestinationType } from '@/lib/api-schemas/log-destinations'
import { listTenantAdminUserIds } from '@/lib/retention-review'
import { EVENT_COLUMNS, EVENT_SEVERITIES, severitiesFrom, typeGlobToLike } from '@/lib/services/events'
import { decryptCredentials, type LogDestinationFilters } from '@/lib/services/log-destinations'
import { deliverEvents, type DeliverResult, type FetchLike } from './deliver'
import type { ShipEvent } from './formats/types'

/* eslint-disable @typescript-eslint/no-explicit-any -- log_destinations / event_stream are not in the generated client typing */

export const SHIP_BATCH_EVENTS = 500
export const SHIP_BUDGET_MS = 50_000
export const POLL_INTERVAL_MS = 2_000
export const SETTLE_MS = 2_000
export const LEASE_SECONDS = 120
export const FAILING_AFTER = 5
export const BACKOFF_BASE_MS = 5_000
export const BACKOFF_CAP_MS = 300_000

export type DestinationStatus = 'healthy' | 'retrying' | 'failing' | 'disabled' | 'lagging_data_lost'

/** A claimed log_destinations row (jsonb from claim_next_log_destination). */
export interface ClaimedDestination {
  id: string
  tenant_id: string
  name: string
  type: LogDestinationType
  config: Record<string, any>
  credentials: Record<string, any>
  filters: LogDestinationFilters
  enabled: boolean
  cursor: number | string
  status: DestinationStatus
  events_sent: number | string
  consecutive_failures: number
  purged_through?: number | string
}

export interface ShipperDeps {
  supabase: any
  fetch?: FetchLike
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  workerId?: string
  /** Total time budget (default 50 s). */
  budgetMs?: number
  /** Re-poll interval for caught-up destinations (default 2 s). */
  pollMs?: number
  /** Watermark settle time (default 2 s; 0 in tests). */
  settleMs?: number
  /** Operational log (never receives credentials). */
  log?: (message: string) => void
}

export interface DestinationOutcome {
  id: string
  sent: number
  status: DestinationStatus
  cursor: number
  error: string | null
  dataLost: boolean
}

export interface ShipperSummary {
  worker_id: string
  claims: number
  events_sent: number
  failures: number
  destinations: Record<string, { sent: number; status: string; error: string | null }>
  duration_ms: number
}

// ─── Backoff ───

/** Delay before retry n (n = consecutive failures, ≥ 1): 5 s · 2^(n-1), capped at 5 min, ±20% jitter. */
export function backoffMs(failures: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(failures))
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.min(n - 1, 30))
  return Math.min(BACKOFF_CAP_MS, Math.round(base * (0.8 + 0.4 * random())))
}

/** Retry delay: backoff, but never sooner than the server's Retry-After. */
export function retryDelayMs(failures: number, retryAfterMs: number | null, random: () => number = Math.random): number {
  return Math.max(backoffMs(failures, random), retryAfterMs ?? 0)
}

// ─── Event reads ───

/** Destination filters → query constraints (same semantics as GET /events). */
export function applyDestinationFilters(query: any, filters: LogDestinationFilters | null | undefined): any {
  const f = filters ?? {}
  let q = query
  if (f.categories?.length) q = q.in('category', f.categories)
  if (f.min_severity) {
    const severities = severitiesFrom(f.min_severity)
    if (severities.length < EVENT_SEVERITIES.length) q = q.in('severity', severities)
  }
  if (f.types?.length === 1) {
    q = f.types[0].includes('*') ? q.like('type', typeGlobToLike(f.types[0])) : q.eq('type', f.types[0])
  } else if (f.types?.length) {
    q = q.or(f.types.map((t) => (t.includes('*') ? `type.like.${t.replace(/_/g, '\\_')}` : `type.eq.${t}`)).join(','))
  }
  if (f.workflow_ids?.length) q = q.in('workflow_id', f.workflow_ids)
  return q
}

export async function readDestinationEvents(supabase: any, row: ClaimedDestination, after: number, through: number, limit = SHIP_BATCH_EVENTS): Promise<ShipEvent[]> {
  let query = supabase.from('event_stream').select(EVENT_COLUMNS)
    .eq('tenant_id', row.tenant_id).gt('id', after).lte('id', through)
  query = applyDestinationFilters(query, row.filters)
  const { data, error } = await query.order('id', { ascending: true }).limit(limit)
  if (error) throw new Error(`event_stream read failed: ${error.message}`)
  return (data ?? []) as ShipEvent[]
}

/** Newest event id overall (0 when empty). */
export async function latestGlobalEventId(supabase: any): Promise<number> {
  const { data, error } = await supabase.from('event_stream').select('id').order('id', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`event_stream read failed: ${error.message}`)
  return data ? Number(data.id) : 0
}

/** Ids observed over time; `settled()` is the newest id observed at least `settleMs` ago. */
export class Watermark {
  private observations: Array<{ at: number; id: number }> = []
  constructor(private settleMs: number) {}

  observe(id: number, at: number) {
    this.observations.push({ at, id })
    if (this.observations.length > 64) this.observations.splice(0, this.observations.length - 64)
  }

  settled(now: number): number | null {
    let best: number | null = null
    for (const o of this.observations) if (o.at <= now - this.settleMs) best = best === null ? o.id : Math.max(best, o.id)
    return best
  }

  /** ms until some observation settles (null when none is pending). */
  waitMs(now: number): number | null {
    const pending = this.observations.filter((o) => o.at > now - this.settleMs)
    if (!pending.length) return null
    return Math.max(0, Math.min(...pending.map((o) => o.at + this.settleMs - now)))
  }

  lastObservedAt(): number | null {
    return this.observations.length ? this.observations[this.observations.length - 1].at : null
  }
}

// ─── Notifications / system events ───

async function notifyAdmins(supabase: any, tenantId: string, title: string, body: string, log: (m: string) => void) {
  try {
    const userIds = await listTenantAdminUserIds(supabase, tenantId)
    if (!userIds.length) return
    const { error } = await supabase.from('notifications').insert(
      userIds.map((userId) => ({ user_id: userId, tenant_id: tenantId, type: 'log_export', title, body })),
    )
    if (error) log(`[ship-events] notification insert failed: ${error.message}`)
  } catch (error) {
    log(`[ship-events] notification failed: ${(error as Error).message}`)
  }
}

async function emitSystemEvent(supabase: any, row: ClaimedDestination, type: string, severity: string, message: string, attributes: Record<string, unknown>, log: (m: string) => void) {
  const { error } = await supabase.from('event_stream').insert({
    tenant_id: row.tenant_id,
    type,
    category: 'system',
    severity,
    message,
    source_table: 'log_destinations',
    source_id: row.id,
    attributes: { destination_id: row.id, destination_name: row.name, destination_type: row.type, ...attributes },
  })
  if (error) log(`[ship-events] system event insert failed: ${error.message}`)
}

// ─── One destination ───

export interface ShipContext {
  supabase: any
  workerId: string
  now: () => number
  random: () => number
  pollMs: number
  fetch?: FetchLike
  log: (message: string) => void
}

async function updateLeased(ctx: ShipContext, row: ClaimedDestination, patch: Record<string, unknown>) {
  const { error } = await ctx.supabase.from('log_destinations').update(patch).eq('id', row.id).eq('locked_by', ctx.workerId)
  if (error) ctx.log(`[ship-events] update of destination ${row.id} failed: ${error.message}`)
}

const iso = (ms: number) => new Date(ms).toISOString()

/**
 * Ship one batch for a claimed destination and release its lease. `through`
 * is the settled watermark: events above it are left for the next round.
 */
export async function shipDestination(ctx: ShipContext, row: ClaimedDestination, through: number): Promise<DestinationOutcome> {
  let cursor = Number(row.cursor ?? 0)
  let status: DestinationStatus = row.status
  let dataLost = false

  // Retention purged events this destination had not sent yet.
  const purged = Number(row.purged_through ?? 0)
  if (purged > cursor) {
    const from = cursor + 1
    dataLost = true
    const message = `Log destination "${row.name}" fell behind event retention: events ${from}–${purged} were purged before they could be sent`
    await updateLeased(ctx, row, { cursor: purged, status: 'lagging_data_lost', last_error: message, last_error_at: iso(ctx.now()) })
    await emitSystemEvent(ctx.supabase, row, 'system.log_export.data_lost', 'warn', message, { cursor_before: cursor, cursor_after: purged }, ctx.log)
    if (status !== 'lagging_data_lost') {
      await notifyAdmins(ctx.supabase, row.tenant_id, `Log export lost events: ${row.name}`,
        `${message}. Shipping continues from the oldest retained event. Check the destination and consider longer event retention.`, ctx.log)
    }
    ctx.log(`[ship-events] destination ${row.id} lagging_data_lost (cursor ${cursor} → ${purged})`)
    cursor = purged
    status = 'lagging_data_lost'
  }

  const release = (patch: Record<string, unknown>) => updateLeased(ctx, row, { ...patch, locked_by: null, locked_at: null })

  if (through <= cursor) {
    await release({ next_attempt_at: iso(ctx.now() + ctx.pollMs) })
    return { id: row.id, sent: 0, status, cursor, error: null, dataLost }
  }

  let events: ShipEvent[]
  try {
    events = await readDestinationEvents(ctx.supabase, row, cursor, through)
  } catch (error) {
    await release({ next_attempt_at: iso(ctx.now() + ctx.pollMs) })
    throw error
  }

  const full = events.length >= SHIP_BATCH_EVENTS
  if (events.length === 0) {
    // Nothing matching up to the watermark: move past it without sending.
    await release({ cursor: through, next_attempt_at: iso(ctx.now() + ctx.pollMs) })
    return { id: row.id, sent: 0, status, cursor: through, error: null, dataLost }
  }

  const credentials = decryptCredentials(row.credentials)
  let delivery: DeliverResult
  try {
    delivery = await deliverEvents(row.type, events, {
      tenantId: row.tenant_id, destinationId: row.id, config: row.config ?? {}, credentials, now: ctx.now,
    }, { fetch: ctx.fetch })
  } catch (error) {
    await release({ next_attempt_at: iso(ctx.now() + ctx.pollMs) })
    throw error
  }

  const now = ctx.now()
  const patch: Record<string, unknown> = {}
  if (delivery.sentThrough !== null) {
    // Everything requested went out: skip past non-matching events up to the
    // watermark too (unless the read was capped at the batch size).
    cursor = delivery.result.kind === 'success' && !full ? through : delivery.sentThrough
    Object.assign(patch, { cursor, events_sent: Number(row.events_sent ?? 0) + delivery.sent, last_success_at: iso(now) })
  }

  if (delivery.result.kind === 'success') {
    status = status === 'lagging_data_lost' ? 'lagging_data_lost' : 'healthy'
    await release({ ...patch, status, consecutive_failures: 0, next_attempt_at: iso(full ? now : now + ctx.pollMs) })
    return { id: row.id, sent: delivery.sent, status, cursor, error: null, dataLost }
  }

  const failures = (delivery.sent > 0 ? 0 : Number(row.consecutive_failures ?? 0)) + 1
  const error = delivery.result.error ?? 'delivery failed'
  let delay: number
  if (delivery.result.kind === 'retry') {
    status = row.status === 'failing' ? 'failing' : 'retrying'
    delay = retryDelayMs(failures, delivery.result.retryAfterMs, ctx.random)
  } else {
    status = failures >= FAILING_AFTER ? 'failing' : 'retrying'
    delay = backoffMs(failures, ctx.random)
  }
  await release({ ...patch, status, consecutive_failures: failures, last_error: error, last_error_at: iso(now), next_attempt_at: iso(now + delay) })
  if (status === 'failing' && row.status !== 'failing') {
    await notifyAdmins(ctx.supabase, row.tenant_id, `Log export failing: ${row.name}`,
      `Log destination "${row.name}" rejected ${failures} deliveries in a row (last error: ${error}). Events are kept and retried; fix the destination settings or credentials.`, ctx.log)
  }
  ctx.log(`[ship-events] destination ${row.id} ${status} after ${failures} failure(s): ${error}`)
  return { id: row.id, sent: delivery.sent, status, cursor, error, dataLost }
}

// ─── Run loop ───

export async function claimDestination(supabase: any, workerId: string): Promise<ClaimedDestination | null> {
  const { data, error } = await supabase.rpc('claim_next_log_destination', { p_worker_id: workerId, p_lock_seconds: LEASE_SECONDS })
  if (error) throw new Error(`claim_next_log_destination failed: ${error.message}`)
  return (data as ClaimedDestination | null) ?? null
}

/** ms until the next enabled destination is due (capped at `max`). */
async function msUntilNextDue(supabase: any, now: number, max: number): Promise<number> {
  const { data } = await supabase.from('log_destinations').select('next_attempt_at')
    .eq('enabled', true).order('next_attempt_at', { ascending: true }).limit(1).maybeSingle()
  const at = data?.next_attempt_at ? Date.parse(data.next_attempt_at) : NaN
  if (!Number.isFinite(at)) return max
  // Floor: a due row leased by another worker is not claimable yet.
  return Math.min(max, Math.max(Math.min(500, max), at - now))
}

export async function runShipper(deps: ShipperDeps): Promise<ShipperSummary> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const workerId = deps.workerId ?? `ship-${now()}-${Math.random().toString(36).slice(2, 8)}`
  const pollMs = deps.pollMs ?? POLL_INTERVAL_MS
  const started = now()
  const deadline = started + (deps.budgetMs ?? SHIP_BUDGET_MS)
  const ctx: ShipContext = {
    supabase: deps.supabase, workerId, now, random: deps.random ?? Math.random, pollMs, fetch: deps.fetch,
    log: deps.log ?? ((message) => console.warn(message)),
  }
  const watermark = new Watermark(deps.settleMs ?? SETTLE_MS)
  const summary: ShipperSummary = { worker_id: workerId, claims: 0, events_sent: 0, failures: 0, destinations: {}, duration_ms: 0 }

  while (now() < deadline) {
    const last = watermark.lastObservedAt()
    if (last === null || now() - last >= Math.min(pollMs, 1000) / 2) watermark.observe(await latestGlobalEventId(ctx.supabase), now())
    let through = watermark.settled(now())
    if (through === null) {
      const wait = watermark.waitMs(now()) ?? pollMs
      if (now() + wait >= deadline) break
      await sleep(wait)
      through = watermark.settled(now())
      if (through === null) continue
    }

    const row = await claimDestination(ctx.supabase, workerId)
    if (!row) {
      const wait = await msUntilNextDue(ctx.supabase, now(), pollMs)
      if (now() + wait >= deadline) break
      await sleep(wait)
      continue
    }

    summary.claims += 1
    try {
      const outcome = await shipDestination(ctx, row, through)
      summary.events_sent += outcome.sent
      if (outcome.error) summary.failures += 1
      const entry = summary.destinations[row.id] ?? { sent: 0, status: outcome.status, error: null }
      summary.destinations[row.id] = { sent: entry.sent + outcome.sent, status: outcome.status, error: outcome.error }
    } catch (error) {
      summary.failures += 1
      ctx.log(`[ship-events] destination ${row.id}: ${(error as Error).message}`)
    }
  }

  summary.duration_ms = now() - started
  return summary
}
