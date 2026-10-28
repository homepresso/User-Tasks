import { databaseUrl, readEnv } from '@/lib/config/bootstrap'
import { NOTIFY_COLUMNS, REALTIME_TOPIC_NAMES, type RealtimeTopic } from './topics'
import { NOTIFY_CHANNEL, parseNotifyPayload, type ChangeEvent, type ChangeRow } from './events'
import { pgConnectionConfig } from '@/lib/providers/db/pg-auth'

/**
 * Per-process change feed for the SSE realtime provider (server only).
 *
 * One hub per app instance, shared by every open SSE stream on it. It runs in
 * one of two modes:
 *
 *  - listen: a dedicated `pg` connection (not from a pool, never in a
 *    transaction) LISTENs on `usertasks_realtime` and keeps the NOTIFY
 *    triggers armed with app_realtime.mark_listening() every 30 s. Each
 *    instance listens on its own, so any number of instances work without a
 *    broker. On connection loss it reconnects with backoff and tells
 *    subscribers to resync (notifications sent meanwhile are lost).
 *  - poll: no connection string, or the migration isn't applied. Every 2 s it
 *    reads rows changed since a cursor from each table (service client).
 *    Inserts and updates that bump a timestamp are seen; deletes and
 *    in-place flag updates (notifications.is_read) are not.
 *
 * Events are kept in a ring buffer so a stream that reconnects (Last-Event-ID
 * = a database-clock ms timestamp) can replay what it missed. When the gap
 * can't be covered (buffer overflow, hub restarted, other instance), streams
 * send a resync instead and clients refetch everything they show.
 *
 * The hub starts with its first subscriber and stops (closing the
 * connection) after IDLE_STOP_MS without one.
 */

export type HubMessage =
  | { kind: 'change'; event: ChangeEvent }
  /** Changes may have been missed (reconnect after a connection loss). */
  | { kind: 'resync' }

export type HubMode = 'listen' | 'poll'

export interface HubOptions {
  /** Connection string for LISTEN; null forces polling. Default: resolveListenUrl(). */
  connectionString?: string | null
  /** Polling reader (tests inject one). Default: service-client reads. */
  pollReader?: PollReader
  pollMs?: number
  heartbeatMs?: number
  bufferSize?: number
  idleStopMs?: number
  now?: () => number
  log?: (message: string) => void
}

/** Reads rows changed after `sinceIso` from one table, oldest first. */
export type PollReader = (table: RealtimeTopic, sinceIso: string, limit: number) => Promise<Array<Record<string, unknown>>>

/** Overlap applied when resuming: commit order can lag the statement clock. */
export const REPLAY_OVERLAP_MS = 5_000
const DEFAULT_BUFFER = 2_000
const POLL_LIMIT = 500

/** Timestamp column polled per table (and whether rows are insert-only). */
const POLL_COLUMNS: Record<RealtimeTopic, { ts: string; created?: string }> = {
  tasks: { ts: 'updated_at', created: 'created_at' },
  task_assignees: { ts: 'created_at' },
  notifications: { ts: 'created_at' },
  user_jobs: { ts: 'updated_at', created: 'created_at' },
  lifecycle_events: { ts: 'created_at' },
  workflow_logs: { ts: 'created_at' },
  object_audit_log: { ts: 'created_at' },
  integration_call_logs: { ts: 'started_at' },
  agent_runs: { ts: 'started_at' },
}

/**
 * LISTEN connection string: REALTIME_DATABASE_URL, else DATABASE_URL, else
 * SUPABASE_DB_URL (a Supabase project's direct/session-pooler string). Must
 * be a session-mode connection: transaction-mode poolers (PgBouncer, the
 * Supabase pooler on 6543) don't deliver notifications.
 */
export function resolveListenUrl(): string | null {
  for (const value of [readEnv('REALTIME_DATABASE_URL'), databaseUrl(), readEnv('SUPABASE_DB_URL')]) {
    if (value && value.trim()) return value.trim()
  }
  return null
}

interface PgClientLike {
  connect(): Promise<unknown>
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
  end(): Promise<void>
  on(event: string, listener: (...args: any[]) => void): unknown // eslint-disable-line @typescript-eslint/no-explicit-any
}

export class RealtimeHub {
  private readonly opts: Required<Omit<HubOptions, 'connectionString' | 'pollReader'>> & Pick<HubOptions, 'pollReader'>
  private readonly connectionString: string | null
  private listeners = new Set<(message: HubMessage) => void>()
  private buffer: ChangeEvent[] = []
  /** Newest ts dropped from the buffer (replays from before it are impossible). */
  private droppedThrough = -Infinity
  /** Continuous coverage since this database-clock ms (null = not covering). */
  private coverageFrom: number | null = null
  private lastWatermark: number | null = null
  private running = false
  private client: PgClientLike | null = null
  private timers: ReturnType<typeof setTimeout>[] = []
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private backoffMs = 1_000
  private pollCursors = new Map<RealtimeTopic, number>()
  private pollSeen = new Map<string, number>()
  mode: HubMode

  constructor(options: HubOptions = {}) {
    this.connectionString = options.connectionString === undefined ? resolveListenUrl() : options.connectionString
    this.mode = this.connectionString ? 'listen' : 'poll'
    this.opts = {
      pollMs: options.pollMs ?? 2_000,
      heartbeatMs: options.heartbeatMs ?? 30_000,
      bufferSize: options.bufferSize ?? DEFAULT_BUFFER,
      idleStopMs: options.idleStopMs ?? 60_000,
      now: options.now ?? Date.now,
      log: options.log ?? ((m) => console.warn(`[realtime] ${m}`)),
      pollReader: options.pollReader,
    }
  }

  /** Subscribe to hub messages; starts the hub. Returns an unsubscribe function. */
  subscribe(listener: (message: HubMessage) => void): () => void {
    this.listeners.add(listener)
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (!this.running) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.running && !this.idleTimer) {
        this.idleTimer = setTimeout(() => {
          this.idleTimer = null
          if (this.listeners.size === 0) void this.stop()
        }, this.opts.idleStopMs)
        this.idleTimer.unref?.()
      }
    }
  }

  get subscriberCount(): number {
    return this.listeners.size
  }

  /** Latest point (database clock ms) up to which this hub has delivered everything, or null. */
  watermark(): number | null {
    return this.coverageFrom === null ? null : this.lastWatermark
  }

  /**
   * Events since `ts` (minus the overlap), or null when the hub can't vouch
   * for the whole gap — the caller then sends a resync.
   */
  replaySince(ts: number): ChangeEvent[] | null {
    const from = ts - REPLAY_OVERLAP_MS
    if (this.coverageFrom === null || this.coverageFrom > from) return null
    if (this.droppedThrough >= from) return null
    return this.buffer.filter((e) => e.ts >= from)
  }

  /** Feed an event (NOTIFY handler, poller; tests). */
  ingest(event: ChangeEvent): void {
    this.buffer.push(event)
    if (this.buffer.length > this.opts.bufferSize) {
      const dropped = this.buffer.splice(0, this.buffer.length - this.opts.bufferSize)
      this.droppedThrough = Math.max(this.droppedThrough, ...dropped.map((e) => e.ts))
    }
    if (this.lastWatermark === null || event.ts > this.lastWatermark) this.lastWatermark = event.ts
    this.broadcast({ kind: 'change', event })
  }

  private broadcast(message: HubMessage): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(message)
      } catch (error) {
        this.opts.log(`subscriber failed: ${(error as Error).message}`)
      }
    }
  }

  private schedule(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== timer)
      fn()
    }, ms)
    timer.unref?.()
    this.timers.push(timer)
  }

  private start(): void {
    this.running = true
    if (this.mode === 'listen') void this.connect()
    else this.startPolling()
  }

  async stop(): Promise<void> {
    this.running = false
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    this.coverageFrom = null
    const client = this.client
    this.client = null
    if (client) await client.end().catch(() => undefined)
  }

  // ── listen mode ──

  private async connect(): Promise<void> {
    if (!this.running || !this.connectionString) return
    const { Client } = await import('pg')
    const client: PgClientLike = new Client(pgConnectionConfig(this.connectionString, {
      application_name: 'usertasks-realtime',
      keepAlive: true,
    }))
    let failed = false
    const onLost = (reason: string) => {
      if (failed) return
      failed = true
      if (this.client === client) this.client = null
      const wasCovering = this.coverageFrom !== null
      this.coverageFrom = null
      void client.end().catch(() => undefined)
      if (!this.running) return
      this.opts.log(`LISTEN connection lost (${reason}); reconnecting in ${this.backoffMs} ms`)
      this.schedule(() => {
        void this.connect().then(() => {
          if (wasCovering && this.coverageFrom !== null) this.broadcast({ kind: 'resync' })
        })
      }, this.backoffMs)
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000)
    }
    client.on('error', (error: Error) => onLost(error.message))
    client.on('end', () => onLost('closed'))
    client.on('notification', (msg: { channel: string; payload?: string }) => {
      if (msg.channel !== NOTIFY_CHANNEL) return
      const event = parseNotifyPayload(msg.payload)
      if (event) this.ingest(event)
    })
    try {
      await client.connect()
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`)
      const now = await this.markListening(client)
      if (!this.running) {
        await client.end().catch(() => undefined)
        return
      }
      this.client = client
      this.coverageFrom = now
      this.lastWatermark = now
      this.backoffMs = 1_000
      this.heartbeat(client)
    } catch (error) {
      const message = (error as Error).message
      if (/mark_listening|app_realtime/.test(message)) {
        // Migration 20261105000000 not applied: no triggers to listen to.
        this.opts.log(`NOTIFY triggers unavailable (${message}); polling instead`)
        failed = true
        await client.end().catch(() => undefined)
        this.mode = 'poll'
        this.startPolling()
        return
      }
      onLost(message)
    }
  }

  private async markListening(client: PgClientLike): Promise<number> {
    const seconds = Math.ceil((this.opts.heartbeatMs * 3) / 1000)
    const { rows } = await client.query('SELECT app_realtime.mark_listening($1) AS now', [seconds])
    return Number(rows[0]?.now)
  }

  private heartbeat(client: PgClientLike): void {
    this.schedule(async () => {
      if (!this.running || this.client !== client) return
      try {
        const now = await this.markListening(client)
        if (this.client === client && this.coverageFrom !== null && (this.lastWatermark === null || now > this.lastWatermark)) {
          this.lastWatermark = now
        }
      } catch (error) {
        this.opts.log(`heartbeat failed: ${(error as Error).message}`)
      }
      this.heartbeat(client)
    }, this.opts.heartbeatMs)
  }

  // ── poll mode ──

  private startPolling(): void {
    for (const table of REALTIME_TOPIC_NAMES) if (!this.pollCursors.has(table)) this.pollCursors.set(table, this.opts.now())
    this.coverageFrom = this.opts.now()
    this.lastWatermark = this.coverageFrom
    const tick = async () => {
      if (!this.running || this.mode !== 'poll') return
      const startedAt = this.opts.now()
      let ok = true
      for (const table of REALTIME_TOPIC_NAMES) {
        try {
          await this.pollTable(table)
        } catch (error) {
          ok = false
          this.opts.log(`polling ${table} failed: ${(error as Error).message}`)
        }
      }
      // Rows stamped before this tick started (minus the overlap) are covered.
      if (ok && this.coverageFrom !== null) this.lastWatermark = Math.max(this.lastWatermark ?? 0, startedAt - REPLAY_OVERLAP_MS)
      for (const [key, at] of this.pollSeen) if (at < startedAt - 120_000) this.pollSeen.delete(key)
      this.schedule(() => void tick(), this.opts.pollMs)
    }
    void tick()
  }

  private async pollTable(table: RealtimeTopic): Promise<void> {
    const reader = this.opts.pollReader ?? defaultPollReader
    const cols = POLL_COLUMNS[table]
    const cursor = this.pollCursors.get(table)!
    // Re-read a window behind the cursor: timestamps are transaction start
    // times, so a row can commit after newer-stamped ones were seen.
    const since = new Date(cursor - REPLAY_OVERLAP_MS * 2).toISOString()
    const rows = await reader(table, since, POLL_LIMIT)
    let maxTs = cursor
    for (const raw of rows) {
      const stamp = String(raw[cols.ts] ?? '')
      const id = String(raw.id ?? '')
      const ts = Date.parse(stamp)
      if (!id || !Number.isFinite(ts)) continue
      if (ts > maxTs) maxTs = ts
      const seenKey = `${table}:${id}:${stamp}`
      if (this.pollSeen.has(seenKey)) continue
      this.pollSeen.set(seenKey, this.opts.now())
      const row: ChangeRow = { id, tenant_id: raw.tenant_id ? String(raw.tenant_id) : null, cols: {} }
      for (const col of NOTIFY_COLUMNS[table]) row.cols[col] = raw[col] ? [String(raw[col])] : []
      const op = cols.created && raw[cols.created] && Date.parse(String(raw[cols.created])) !== ts ? 'UPDATE' : 'INSERT'
      this.ingest({ ts, table, op, rows: [row] })
    }
    this.pollCursors.set(table, maxTs)
  }
}

/** Service-role reads for poll mode (tenant filtering happens per subscriber). */
const defaultPollReader: PollReader = async (table, sinceIso, limit) => {
  const { getServiceDb } = await import('@/lib/providers/db')
  const cols = POLL_COLUMNS[table]
  const select = ['id', 'tenant_id', cols.ts, ...(cols.created ? [cols.created] : []), ...NOTIFY_COLUMNS[table]].join(', ')
  const { data, error } = await getServiceDb()
    .from(table)
    .select(select)
    .gt(cols.ts, sinceIso)
    .order(cols.ts, { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Array<Record<string, unknown>>
}

const globalRef = globalThis as typeof globalThis & { __usertasksRealtimeHub?: RealtimeHub }

/** The process-wide hub (created on first use). */
export function getRealtimeHub(): RealtimeHub {
  if (!globalRef.__usertasksRealtimeHub) globalRef.__usertasksRealtimeHub = new RealtimeHub()
  return globalRef.__usertasksRealtimeHub
}

/** Tests: replace or clear the process-wide hub. */
export function setRealtimeHubForTests(hub: RealtimeHub | undefined): void {
  globalRef.__usertasksRealtimeHub = hub
}
