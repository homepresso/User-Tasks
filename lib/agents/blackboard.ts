/**
 * The shared blackboard of a workflow run: facts that Run Agent steps with
 * "Share context" on read and write WHILE they run (read_shared_facts,
 * write_shared_fact, wait_for_shared_fact). Agents running at the same time
 * — in Parallel branches, inline or on the agent queue (another process) —
 * see each other's facts as soon as they are written.
 *
 * Store: public.workflow_run_facts (migration 20270114000000), one row per
 * (run, key), written with an upsert — atomic per key, so concurrent writers
 * never lose each other's keys; on the same key the last write wins and the
 * writer (agent, step, branch, time) is recorded. Rows are scoped to the
 * run's tenant (every read and write filters on tenant_id; RLS lets members
 * read their workspaces' rows, only the service role writes) and are removed
 * with the run (ON DELETE CASCADE).
 *
 * Until the migration is applied the blackboard falls back to the agent's
 * own in-memory facts (the behaviour before: facts shared only through
 * agent_context between steps) — runs never fail because of it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FactWriter } from './shared-context'

export interface BlackboardSnapshot {
  facts: Record<string, unknown>
  writers: Record<string, FactWriter>
}

export interface RunBlackboard {
  /** Every fact of the run. */
  read(): Promise<BlackboardSnapshot>
  write(key: string, value: unknown, writer: FactWriter): Promise<void>
  /** Shared across processes (false: this agent's memory only). */
  readonly shared: boolean
}

export const BLACKBOARD_TABLE = 'workflow_run_facts'
/** Facts one run may hold. */
export const MAX_RUN_FACTS = 500

/** Postgres / PostgREST "relation does not exist" (migration not applied yet). */
function missingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const message = String(error.message ?? '')
  return error.code === '42P01' || error.code === 'PGRST205' || (/workflow_run_facts/.test(message) && /does not exist|could not find/i.test(message))
}

/**
 * In-memory blackboard over a facts object (no run / migration not applied).
 * `shared`: other agents in this process use the same board (tests).
 */
export function memoryBlackboard(facts: Record<string, unknown>, writers: Record<string, FactWriter> = {}, shared = false): RunBlackboard {
  return {
    shared,
    async read() { return { facts: { ...facts }, writers: { ...writers } } },
    async write(key, value, writer) { facts[key] = value; writers[key] = writer },
  }
}

/**
 * The run's blackboard in the database. Falls back to `fallback` (in memory)
 * for the rest of the agent run when the table is not there yet.
 */
export function dbBlackboard(db: SupabaseClient, tenantId: string, runId: string, fallback: RunBlackboard = memoryBlackboard({})): RunBlackboard {
  let degraded = false
  const table = () => (db as any).from(BLACKBOARD_TABLE)
  const board: RunBlackboard = {
    get shared() { return !degraded },
    async read() {
      if (degraded) return fallback.read()
      const { data, error } = await table().select('key, value, written_by, written_at').eq('tenant_id', tenantId).eq('run_id', runId).limit(MAX_RUN_FACTS)
      if (error) {
        if (missingTable(error)) { degraded = true; return fallback.read() }
        throw new Error(`Could not read the shared facts: ${error.message}`)
      }
      const facts: Record<string, unknown> = {}
      const writers: Record<string, FactWriter> = {}
      for (const row of (data ?? []) as Array<{ key: string; value: unknown; written_by?: Record<string, unknown> | null; written_at?: string }>) {
        facts[row.key] = row.value
        writers[row.key] = { ...(row.written_by ?? {}), at: String(row.written_at ?? (row.written_by as any)?.at ?? new Date().toISOString()) }
      }
      return { facts, writers }
    },
    async write(key, value, writer) {
      await fallback.write(key, value, writer)
      if (degraded) return
      const { error } = await table().upsert({
        tenant_id: tenantId, run_id: runId, key,
        value: value === undefined ? null : value,
        written_by: { agent: writer.agent ?? null, node_id: writer.node_id ?? null, branch: writer.branch ?? null },
        written_at: writer.at,
      }, { onConflict: 'run_id,key' })
      if (error) {
        if (missingTable(error)) { degraded = true; return }
        throw new Error(`Could not write the shared fact: ${error.message}`)
      }
    },
  }
  return board
}

/** All facts of a run (the engine folds them into agent_context). Empty when the table is missing. */
export async function readRunFacts(db: SupabaseClient, tenantId: string, runId: string): Promise<BlackboardSnapshot> {
  try {
    return await dbBlackboard(db, tenantId, runId).read()
  } catch {
    return { facts: {}, writers: {} }
  }
}
