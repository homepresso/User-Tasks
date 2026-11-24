/**
 * usertasks-admin rollups status | backfill | rebuild | reconcile
 *
 * Report rollups (migration 20270123100000; lib/jobs/report-rollups.ts):
 *   status                       coverage, backfill progress, queued rebuilds, last refresh
 *   backfill [--tenant <id>] [--max-seconds <n>]
 *                                run the history backfill now (chunks of days per tenant,
 *                                resumable: stop any time, run again to continue)
 *   rebuild --tenant <id> [--from <YYYY-MM-DD> --to <YYYY-MM-DD>]
 *                                queue an exact rebuild of a day range (no range: restart that
 *                                workspace's backfill; reads use the live path until it is covered
 *                                again), then drain the queue
 *   reconcile [--tenant <id>]    rebuild today and yesterday now (normally hourly)
 *
 * Works over a direct connection (DATABASE_URL) or, on the Supabase
 * provider, the service-role API — the same SQL functions the scheduler's
 * report-rollups job calls.
 */

export type RollupsAction = 'status' | 'backfill' | 'rebuild' | 'reconcile'
export const ROLLUPS_ACTIONS: readonly RollupsAction[] = ['status', 'backfill', 'rebuild', 'reconcile']

/** Calls a public SQL function with named arguments; returns its (jsonb / scalar) value. */
export type RollupCall = (fn: string, args?: Record<string, unknown>) => Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any

interface IO { out: (line: string) => void; err: (line: string) => void }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A direct pg connection as a RollupCall. */
export function sqlRollupCall(db: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }): RollupCall {
  return async (fn, args = {}) => {
    if (!/^[a-z_]+$/.test(fn)) throw new Error(`bad function name ${fn}`)
    const keys = Object.keys(args)
    keys.forEach((k) => { if (!/^p_[a-z_]+$/.test(k)) throw new Error(`bad argument ${k}`) })
    const { rows } = await db.query(`SELECT public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`, keys.map((k) => args[k]))
    return rows[0]?.r
  }
}

/** The service-role API (supabase-js rpc) as a RollupCall. */
export function rpcRollupCall(api: { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> }): RollupCall {
  return async (fn, args) => {
    const { data, error } = await api.rpc(fn, args)
    if (error) throw new Error(error.message)
    return data
  }
}

const ago = (iso: unknown) => {
  if (!iso) return 'never'
  const min = Math.round((Date.now() - new Date(String(iso)).getTime()) / 60_000)
  return min < 120 ? `${min} min ago` : `${Math.round(min / 60)} h ago`
}

/** One line for `usertasks-admin status` / the doctor. */
export function rollupsSummary(s: any): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  return `${s.backfilled}/${s.tenants} workspaces backfilled${s.in_progress ? `, ${s.in_progress} in progress` : ''}${s.not_started ? `, ${s.not_started} not started` : ''}`
    + ` · ${s.dirty_ranges} queued rebuild${s.dirty_ranges === 1 ? '' : 's'} · last rebuild ${ago(s.last_refresh_at)} · oldest reconcile ${ago(s.oldest_reconciled_at)}`
}

export async function runRollupsCommand(action: RollupsAction, call: RollupCall, opts: { tenant?: string; from?: string; to?: string; maxSeconds?: number; json?: boolean }, io: IO): Promise<number> {
  if (opts.tenant && !UUID_RE.test(opts.tenant)) { io.err('--tenant must be a workspace id (uuid)'); return 2 }
  for (const d of [opts.from, opts.to]) if (d && !DAY_RE.test(d)) { io.err('--from / --to must be YYYY-MM-DD (UTC days)'); return 2 }
  let status: any // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    status = await call('report_rollup_status')
  } catch (error) {
    io.err(`Report rollups are not installed: ${(error as Error).message} (apply migration 20270123100000: usertasks-admin db migrate)`)
    return 1
  }
  if (action === 'status') {
    if (opts.json) { io.out(JSON.stringify(status, null, 2)); return 0 }
    io.out(`Report rollups: ${rollupsSummary(status)}`)
    io.out(`Rows: runs ~${status.rows.runs}, nodes ~${status.rows.nodes}, tasks ~${status.rows.tasks}, submissions ~${status.rows.submissions}; newest delta ${ago(status.newest_delta_at)}`)
    for (const t of status.tenants_detail ?? []) {
      io.out(`  ${String(t.name).slice(0, 30).padEnd(30)} ${t.done ? 'backfilled' : `covered from ${t.covered_from ?? '—'} (oldest ${t.oldest_day ?? '—'})`} · reconciled ${ago(t.last_reconciled_at)}`)
    }
    return 0
  }

  const deadline = Date.now() + Math.max(1, opts.maxSeconds ?? 600) * 1000
  const tenant = opts.tenant ?? null
  let calls = 0
  let days = 0
  try {
    if (action === 'rebuild') {
      if (!tenant) { io.err('rebuild needs --tenant <workspace id>'); return 2 }
      if (Boolean(opts.from) !== Boolean(opts.to)) { io.err('give both --from and --to, or neither (restart the backfill)'); return 2 }
      const n = await call('report_rollup_request_rebuild', { p_tenant_id: tenant, p_from: opts.from ?? null, p_to: opts.to ?? null })
      io.out(opts.from ? `Queued ${opts.from} … ${opts.to}.` : `Backfill restarted for the workspace (${n} state row${n === 1 ? '' : 's'} reset).`)
      if (!opts.from) action = 'backfill'
      else {
        while (Date.now() < deadline) {
          const r = await call('report_rollup_drain_next', { p_days: 31 })
          if (!r || r.idle) break
          calls++; days += Number(r.rebuilt?.days ?? 0)
        }
        io.out(`Rebuilt ${days} day${days === 1 ? '' : 's'} in ${calls} step${calls === 1 ? '' : 's'}.`)
        return 0
      }
    }
    if (action === 'backfill') {
      while (Date.now() < deadline) {
        const r = await call('report_rollup_backfill_next', { p_tenant_id: tenant, p_days: 31 })
        if (!r || r.idle) break
        if (r.busy) { io.err('That workspace is being backfilled by another process; try again shortly.'); break }
        calls++; days += Number(r.rebuilt?.days ?? 0)
        if (r.done) io.out(`Workspace ${r.tenant_id}: backfilled (oldest day ${r.oldest_day ?? '—'}).`)
        if (tenant && r.done) break
      }
      const after = await call('report_rollup_status')
      io.out(`${days} day${days === 1 ? '' : 's'} rebuilt in ${calls} step${calls === 1 ? '' : 's'}. ${rollupsSummary(after)}`)
      if (Date.now() >= deadline && after.in_progress + after.not_started > 0) io.out('Time limit reached; run it again to continue (it resumes where it stopped).')
      return 0
    }
    if (action === 'reconcile') {
      while (Date.now() < deadline) {
        const r = await call('report_rollup_reconcile_next', { p_min_age_minutes: tenant ? 0 : 1, p_tenant_id: tenant })
        if (!r || r.idle) break
        calls++
        if (tenant) break
      }
      io.out(`Reconciled ${calls} workspace${calls === 1 ? '' : 's'} (today and yesterday).`)
      return 0
    }
  } catch (error) {
    io.err(`rollups ${action} failed: ${(error as Error).message}`)
    return 1
  }
  return 0
}
