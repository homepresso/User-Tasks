/**
 * Wake-ups for the gateway queue over Postgres LISTEN / NOTIFY, so an idle
 * gateway costs about one claim query per long poll instead of a claim every
 * few hundred milliseconds.
 *
 * The migration's trigger on public.gateway_jobs sends
 *   NOTIFY usertasks_gateway, 'q:<gateway id>'  when a job becomes claimable
 *   NOTIFY usertasks_gateway, 'j:<job id>'      when a job reaches an end state
 * and this module holds ONE listening connection per server process (only
 * while gateway traffic needs it) that turns them into the queue's
 * in-process wake-up events (lib/gateway/queue.ts).
 *
 * LISTEN needs a session-level connection: a direct database URL or a
 * session-mode pooler — never a transaction-mode pooler (Supabase's 6543,
 * PgBouncer in transaction mode), which drops LISTEN silently. The URL, first
 * that is set:
 *   GATEWAY_LISTEN_DATABASE_URL   explicit (set it to '' / 'off' to disable)
 *   POSTGRES_URL_NON_POOLING      Vercel's Supabase integration
 *   SUPABASE_DB_URL               direct Supabase connection
 *   DATABASE_URL                  only with DB_PROVIDER=postgres (plain Postgres)
 * Without one (or while the connection is down) the queue falls back to
 * claiming with an adaptive back-off — everything still works, just with more
 * queries and a slower first pick-up on an idle gateway.
 *
 * Server-only.
 */
import { EventEmitter } from 'node:events'

/* eslint-disable @typescript-eslint/no-explicit-any -- node-postgres is loaded lazily */

export const GATEWAY_NOTIFY_CHANNEL = 'usertasks_gateway'

export interface GatewayNotifier {
  /** Notifications are being received right now (wait for them instead of polling). */
  listening(): boolean
}

const SLOT = Symbol.for('usertasks.gateway.notifier')
type State = { notifier: GatewayNotifier | null; starting: Promise<void> | null; override: GatewayNotifier | null }
const state: State = ((globalThis as any)[SLOT] ??= { notifier: null, starting: null, override: null })

export function listenUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.GATEWAY_LISTEN_DATABASE_URL
  if (explicit !== undefined) return /^(|off|false|0)$/i.test(explicit.trim()) ? null : explicit.trim()
  const direct = env.POSTGRES_URL_NON_POOLING?.trim() || env.SUPABASE_DB_URL?.trim()
  if (direct) return direct
  if ((env.DB_PROVIDER ?? '').trim() === 'postgres' && env.DATABASE_URL?.trim()) return env.DATABASE_URL.trim()
  return null
}

/** Parse a NOTIFY payload into the bus event it maps to (null for anything unexpected). */
export function eventForPayload(payload: string | undefined | null): string | null {
  const m = /^([qj]):([0-9a-f-]{36})$/i.exec(String(payload ?? ''))
  if (!m) return null
  return m[1] === 'q' ? `gw:${m[2].toLowerCase()}` : `job:${m[2].toLowerCase()}`
}

class PgListener implements GatewayNotifier {
  private client: any = null
  private ok = false
  private backoff = 1000
  private stopped = false

  constructor(private readonly url: string, private readonly bus: EventEmitter) {}

  listening(): boolean { return this.ok }

  async start(): Promise<void> {
    if (this.stopped) return
    try {
      const { Client } = await import('pg')
      const { pgConnectionConfig } = await import('@/lib/providers/db/pg-auth')
      const client = new Client(pgConnectionConfig(this.url, { application_name: 'usertasks-gateway-listen', keepAlive: true }))
      client.on('notification', (msg: { channel: string; payload?: string }) => {
        if (msg.channel !== GATEWAY_NOTIFY_CHANNEL) return
        const event = eventForPayload(msg.payload)
        if (event) this.bus.emit(event)
      })
      const lost = () => {
        if (this.client !== client) return
        this.ok = false
        this.client = null
        client.end().catch(() => {})
        this.retry()
      }
      client.on('error', lost)
      client.on('end', lost)
      await client.connect()
      await client.query(`LISTEN ${GATEWAY_NOTIFY_CHANNEL}`)
      this.client = client
      this.ok = true
      this.backoff = 1000
      // Waiters may have missed events while we were down: let them re-check now.
      this.bus.emit('gateway:resync')
    } catch (error) {
      this.ok = false
      console.warn(`[gateway] LISTEN unavailable (${(error as Error).message}); falling back to polling`)
      this.retry()
    }
  }

  private retry(): void {
    if (this.stopped) return
    const wait = this.backoff
    this.backoff = Math.min(60_000, this.backoff * 2)
    setTimeout(() => { void this.start() }, wait).unref?.()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.ok = false
    await this.client?.end().catch(() => {})
  }
}

const NONE: GatewayNotifier = { listening: () => false }

/**
 * The process's notifier, started on first use. Never throws and never
 * blocks long: if the connection is not up within `waitMs`, the caller
 * proceeds with polling and the listener keeps trying in the background.
 */
export async function gatewayNotifier(bus: EventEmitter, waitMs = 1500): Promise<GatewayNotifier> {
  if (state.override) return state.override
  if (state.notifier) return state.notifier
  const url = listenUrl()
  if (!url) return NONE
  const listener = new PgListener(url, bus)
  state.notifier = listener
  state.starting = listener.start()
  await Promise.race([state.starting, new Promise((r) => setTimeout(r, waitMs).unref?.())])
  return listener
}

/** Tests: use this notifier instead of a database connection (null restores the default). */
export function setGatewayNotifierForTests(notifier: GatewayNotifier | null): void {
  state.override = notifier
}
