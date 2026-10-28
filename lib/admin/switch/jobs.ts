import os from 'node:os'
import type { ProviderArea } from '@/lib/config/schema'
import { decryptSecret, encryptSecret, isEncrypted } from '@/lib/secret-crypto'
import { loadInstanceConfig, type SqlClient } from '../ops/instance-db'
import { runSwitch, type EngineIO, type SwitchResult } from './engine'
import { hasSwitchLogExtras, newRecord, newSwitchId, switchRunning, tryLockSwitches, unlockSwitches } from './log'
import type { AreaSwitch, SwitchJob, SwitchOptions, SwitchRecordRow } from './types'

/**
 * Background switches (Settings → Infrastructure): a data-moving switch is
 * not run inside the request that starts it. The request queues it — a
 * switch record with status `queued` and the options in `job` (secret values
 * encrypted) — and a runner on a long-running process picks it up:
 * straight away in the app process that queued it, and from the
 * `provider-switches` tick job every minute (which also resumes a switch
 * whose process died: its record is still `running` but nobody holds the
 * switch lock). runSwitch does the work, exactly as `usertasks-admin
 * switch` would; steps already done are skipped on resume.
 */

export class SwitchBusyError extends Error {
  constructor(message = 'Another provider switch is queued or running: wait for it to finish (or cancel it).') {
    super(message)
    this.name = 'SwitchBusyError'
  }
}

export interface EnqueueSwitchInput {
  area: ProviderArea
  to: string
  set: Record<string, string>
  secret: Record<string, string>
  flags?: SwitchOptions['flags']
  /** Flags that are credentials (the database's --target-url): kept with the encrypted secret values. */
  secretFlags?: Record<string, string>
  noDump?: boolean
  force?: boolean
  actor: string
}

const COLUMNS = 'id, kind, area, from_provider, to_provider, status, rollback_of, steps, config_before, config_after, env_changes, backup_dir, actor, host, error, started_at, finished_at, log, job, cancel_requested_at'

/** Whether a switch is queued, or running anywhere (switch lock held). */
export async function switchBusy(db: SqlClient): Promise<boolean> {
  if (await switchRunning(db)) return true
  if (!(await hasSwitchLogExtras(db))) return false
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.instance_provider_switches WHERE status = 'queued'`)
  return (rows[0]?.n ?? 0) > 0
}

interface JobSecrets {
  secret: Record<string, string>
  flags: Record<string, string>
}

export function encryptJobSecrets(secret: Record<string, string>, flags: Record<string, string> = {}): string | null {
  if (!Object.keys(secret).length && !Object.keys(flags).length) return null
  const ciphertext = encryptSecret(JSON.stringify({ secret, flags } satisfies JobSecrets))
  if (!isEncrypted(ciphertext)) throw new Error('ENCRYPTION_KEY must be set to queue a switch with secret values (or use secret:// references)')
  return ciphertext
}

function decryptJobSecrets(job: SwitchJob): JobSecrets {
  if (!job.secret) return { secret: {}, flags: {} }
  const parsed = JSON.parse(decryptSecret(job.secret)) as Partial<JobSecrets>
  return { secret: parsed.secret ?? {}, flags: parsed.flags ?? {} }
}

export async function enqueueSwitch(db: SqlClient, input: EnqueueSwitchInput): Promise<SwitchRecordRow> {
  if (!(await hasSwitchLogExtras(db))) throw new Error('Background switches need migration 20261110000000 (usertasks-admin db migrate)')
  if (await switchBusy(db)) throw new SwitchBusyError()
  const { config } = await loadInstanceConfig(db)
  const job: SwitchJob = { set: input.set, secret: encryptJobSecrets(input.secret, input.secretFlags), flags: input.flags ?? {}, noDump: input.noDump ?? false, force: input.force ?? false }
  const record = newRecord({
    id: newSwitchId(), kind: 'switch', area: input.area, from_provider: config.providers[input.area].id, to_provider: input.to,
    actor: input.actor, backup_dir: null, status: 'queued',
  })
  try {
    await db.query(
      `INSERT INTO public.instance_provider_switches (id, kind, area, from_provider, to_provider, status, steps, env_changes, actor, host, started_at, job, log)
       VALUES ($1, 'switch', $2, $3, $4, 'queued', '[]'::jsonb, '{}'::jsonb, $5, $6, now(), $7::jsonb, $8::jsonb)`,
      [record.id, record.area, record.from_provider, record.to_provider, record.actor, os.hostname(), JSON.stringify(job), JSON.stringify(['Queued: waiting for the background runner.'])],
    )
  } catch (error) {
    // The one-queued-switch index: someone queued one at the same moment.
    if ((error as { code?: string }).code === '23505') throw new SwitchBusyError()
    throw error
  }
  return { ...record, job, log: ['Queued: waiting for the background runner.'] }
}

/** Ask a running or queued switch to stop before its next step (a queued one is cancelled at once). */
export async function requestCancel(db: SqlClient, id: string, actor: string): Promise<'cancelled' | 'requested' | 'not-running'> {
  const queued = await db.query(
    `UPDATE public.instance_provider_switches
        SET status = 'cancelled', cancel_requested_at = now(), finished_at = now(), job = job - 'secret',
            error = $2, log = log || to_jsonb(ARRAY[$2::text])
      WHERE id = $1 AND status = 'queued'`,
    [id, `Cancelled by ${actor} before it started.`],
  )
  if ((queued.rowCount ?? 0) > 0) return 'cancelled'
  const running = await db.query(
    `UPDATE public.instance_provider_switches SET cancel_requested_at = now()
      WHERE id = $1 AND status = 'running' AND cancel_requested_at IS NULL`,
    [id],
  )
  return (running.rowCount ?? 0) > 0 ? 'requested' : 'not-running'
}

/**
 * Put a failed or cancelled background switch back in the queue (done steps
 * are skipped when it runs). Not once its secret values were dropped (a
 * switch cancelled before it started): start it again from the wizard.
 */
export async function requeueSwitch(db: SqlClient, id: string): Promise<boolean> {
  if (await switchBusy(db)) throw new SwitchBusyError()
  try {
    const { rowCount } = await db.query(
      `UPDATE public.instance_provider_switches
          SET status = 'queued', error = NULL, finished_at = NULL, cancel_requested_at = NULL, log = log || '["Queued again."]'::jsonb
        WHERE id = $1 AND kind = 'switch' AND status IN ('failed', 'cancelled') AND job ? 'secret'`,
      [id],
    )
    return (rowCount ?? 0) > 0
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new SwitchBusyError()
    throw error
  }
}

export interface RunQueuedOptions {
  dbUrl: string
  plans: Partial<Record<ProviderArea, AreaSwitch>>
  backupRoot: string
  io?: EngineIO
  /** At most this many switches per call (default 3). */
  limit?: number
  /** Epoch ms: a chunked run (serverless) — switches pause there and continue on the next call. */
  deadline?: number
  /** Only these areas (a chunked runner takes only switches that can pause). */
  areas?: ProviderArea[]
}

/**
 * Run queued switches, and resume interrupted background ones, one at a
 * time while this connection holds the switch lock. Returns what ran.
 */
export async function runQueuedSwitches(db: SqlClient, options: RunQueuedOptions): Promise<Array<{ id: string; result: SwitchResult }>> {
  if (!(await hasSwitchLogExtras(db))) return []
  if (!(await tryLockSwitches(db))) return []
  const io = options.io ?? { log: () => undefined, warn: () => undefined }
  const ran: Array<{ id: string; result: SwitchResult }> = []
  try {
    for (let i = 0; i < (options.limit ?? 3); i++) {
      // Holding the lock, any `running` background record is one whose runner died.
      const { rows } = await db.query<SwitchRecordRow & Record<string, unknown>>(
        `SELECT ${COLUMNS} FROM public.instance_provider_switches
          WHERE kind = 'switch' AND job IS NOT NULL AND status IN ('queued', 'running') AND NOT (id = ANY($1::uuid[]))
            AND ($2::text[] IS NULL OR area = ANY($2::text[]))
          ORDER BY started_at LIMIT 1`,
        [ran.map((r) => r.id), options.areas ?? null],
      )
      const row = rows[0]
      if (!row) break
      const record: SwitchRecordRow = {
        ...row,
        started_at: (row.started_at as unknown) instanceof Date ? (row.started_at as unknown as Date).toISOString() : String(row.started_at),
        finished_at: null,
        log: [...(Array.isArray(row.log) ? row.log : []), row.status === 'running' ? 'Resuming after an interruption.' : 'Started by the background runner.'],
      }
      const plan = options.plans[record.area]
      const job = record.job!
      let secrets: JobSecrets
      try {
        if (!plan) throw new Error(`no switch plan for ${record.area}`)
        secrets = decryptJobSecrets(job)
      } catch (error) {
        await db.query(`UPDATE public.instance_provider_switches SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [record.id, (error as Error).message])
        ran.push({ id: record.id, result: { code: 2, switchId: record.id, preflight: [], record: null, plan: null } })
        continue
      }
      const result = await runSwitch({
        db, dbUrl: options.dbUrl, area: record.area, plan,
        options: {
          to: record.to_provider, dryRun: false, yes: true, backupRoot: options.backupRoot, set: job.set ?? {}, secret: secrets.secret,
          flags: { ...(job.flags ?? {}), ...secrets.flags }, noDump: job.noDump, actor: record.actor ?? 'settings', force: job.force,
          deadline: options.deadline,
        },
        io, resume: record,
      })
      ran.push({ id: record.id, result })
      // Paused at the deadline (or out of time): the next call continues.
      if (result.code === 3 || (options.deadline && Date.now() >= options.deadline)) break
    }
  } finally {
    await unlockSwitches(db)
  }
  return ran
}

/** Whether there is background work (queued, or an interrupted background switch). */
export async function hasQueuedSwitches(db: SqlClient): Promise<boolean> {
  if (!(await hasSwitchLogExtras(db))) return false
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.instance_provider_switches WHERE kind = 'switch' AND job IS NOT NULL AND status IN ('queued', 'running')`,
  )
  return (rows[0]?.n ?? 0) > 0
}
