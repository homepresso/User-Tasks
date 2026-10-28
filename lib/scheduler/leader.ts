import { Client, type ClientConfig } from 'pg'
import { pgConnectionConfig } from '@/lib/providers/db/pg-auth'

/**
 * Leader election for the in-process scheduler worker (./worker.ts).
 *
 * Every replica that runs the worker asks its elector, once a minute, whether
 * it may tick. Two strategies:
 *
 *  - advisory_lock (DATABASE_URL / SCHEDULER_DATABASE_URL set): one dedicated
 *    session connection per replica holds `pg_try_advisory_lock(<key>)` for as
 *    long as it lives. The holder is the leader; the others keep trying once a
 *    minute and take over within a minute of the leader's connection closing
 *    (process exit, crash, network loss — Postgres releases session locks when
 *    the backend ends). Needs a session, so it must not go through a
 *    transaction-mode pooler (PgBouncer); point SCHEDULER_DATABASE_URL at the
 *    database directly in that case.
 *  - lease (only Supabase reachable): every replica is a candidate and the
 *    tick's own lease (public.cron_tick_acquire, app_cron.tick_lock) picks
 *    one per minute. The worker keeps the lease until it expires just before
 *    the next minute (runTick keepLock), so a replica arriving later in the
 *    same minute finds it held and skips.
 *
 * Either way the tick still takes its lease, so even a brief split brain
 * (old leader's connection not yet noticed as dead) cannot double-run a minute.
 */

export type ElectionMode = 'advisory_lock' | 'lease'

export interface LeaderElector {
  readonly mode: ElectionMode
  /** Whether this replica should tick now. Never throws (errors count as "no"). */
  isLeader(): Promise<boolean>
  /** Gives up leadership (closes the session). */
  release(): Promise<void>
}

/** pg_try_advisory_lock key: a fixed 64-bit value ("usertask" in ASCII). */
export const SCHEDULER_LOCK_KEY = '8463673090649043819'

/** Minimal pg client surface (tests inject fakes). */
export interface SessionClient {
  connect(): Promise<unknown>
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>
  end(): Promise<void>
  on(event: 'error', listener: (error: Error) => void): unknown
}

export interface AdvisoryLockElectorOptions {
  connectionString: string
  lockKey?: string
  /** Client factory (tests). */
  createClient?: (config: ClientConfig) => SessionClient
  log?: (message: string) => void
}

export class AdvisoryLockElector implements LeaderElector {
  readonly mode = 'advisory_lock' as const
  private client: SessionClient | null = null
  private held = false
  private broken = false
  private readonly key: string
  private readonly create: (config: ClientConfig) => SessionClient
  private readonly log: (message: string) => void

  constructor(private readonly opts: AdvisoryLockElectorOptions) {
    this.key = opts.lockKey ?? SCHEDULER_LOCK_KEY
    this.create = opts.createClient ?? ((config) => new Client(config) as unknown as SessionClient)
    this.log = opts.log ?? ((message) => console.warn(`[scheduler] ${message}`))
  }

  private async session(): Promise<SessionClient> {
    if (this.client && !this.broken) return this.client
    await this.drop()
    const client = this.create(pgConnectionConfig(this.opts.connectionString, {
      application_name: 'usertasks-scheduler',
      // Fail fast: an election that hangs would delay the tick.
      connectionTimeoutMillis: 10_000,
    }))
    // An idle session erroring (server restart) must not crash the process;
    // the next election notices and reconnects.
    client.on('error', (error) => {
      this.broken = true
      if (this.held) this.log(`leader session lost (${error.message}); re-electing next minute`)
      this.held = false
    })
    await client.connect()
    this.client = client
    this.broken = false
    return client
  }

  private async drop(): Promise<void> {
    const client = this.client
    this.client = null
    this.held = false
    if (client) await client.end().catch(() => undefined)
  }

  async isLeader(): Promise<boolean> {
    try {
      const client = await this.session()
      if (this.held) {
        // Still connected = still holding the lock.
        await client.query('SELECT 1')
        return true
      }
      const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS ok', [this.key])
      this.held = rows[0]?.ok === true
      return this.held
    } catch (error) {
      if (this.held) this.log(`leader session lost (${(error as Error).message}); re-electing next minute`)
      await this.drop()
      return false
    }
  }

  async release(): Promise<void> {
    if (this.client && this.held && !this.broken) {
      await this.client.query('SELECT pg_advisory_unlock($1::bigint)', [this.key]).catch(() => undefined)
    }
    await this.drop()
  }
}

/** Every replica is a candidate; the tick lease decides (see the module comment). */
export class LeaseElector implements LeaderElector {
  readonly mode = 'lease' as const
  async isLeader(): Promise<boolean> {
    return true
  }
  async release(): Promise<void> {}
}
