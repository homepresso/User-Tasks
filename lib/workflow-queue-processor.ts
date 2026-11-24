/* eslint-disable @typescript-eslint/no-explicit-any -- RPCs added by migrations newer than database.types.ts */
import type { SupabaseClient } from "@supabase/supabase-js"
import { getServiceDb } from "@/lib/providers/db"
import { executeWorkflow, recoverRunFromCheckpoint, resumeTimedPause } from "@/lib/workflow-engine"
import { queueWorkerContext } from "@/lib/process-queue"
import { runQueuedResume } from "@/lib/workflow-resume-queue"
import { QUEUED_INITIATOR_KEY, resolveQueuedInitiator } from "@/lib/workflow-initiator"
import { ENGINE_CALL_KEY, ENGINE_CALL_TRIGGER_TYPE, runEngineCall } from "@/lib/processing/dispatch"

/** Jobs run at the same time by one processor invocation (env WORKFLOW_CONCURRENCY). */
export function workflowConcurrency(): number {
  const value = Number(process.env.WORKFLOW_CONCURRENCY)
  return Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), 50) : 5
}

/**
 * Lease a processor holds on each job it claimed (env WORKFLOW_LEASE_SECONDS,
 * default 120, 15–3600). Renewed every quarter of it while the job runs; a
 * job whose lease runs out (the process crashed, was OOM-killed or frozen) is
 * recovered by the next claim anywhere (migration 20270124090000).
 */
export function leaseSeconds(): number {
  const value = Number(process.env.WORKFLOW_LEASE_SECONDS)
  return Number.isFinite(value) && value > 0 ? Math.min(Math.max(Math.floor(value), 15), 3600) : 120
}

/** Time after which the processor starts no new job (env WORKFLOW_PROCESSOR_BUDGET_MS). */
export function processorBudgetMs(): number {
  const value = Number(process.env.WORKFLOW_PROCESSOR_BUDGET_MS)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 50_000
}

export type Job = {
  id: string
  workflow_id: string
  tenant_id: string
  task_id?: string | null
  trigger_type?: string | null
  trigger_data?: unknown
  trace_id?: string | null
  attempts?: number | null
  /** The run this job started or continues (migration 20270124090000). */
  run_id?: string | null
  /** Times a worker lost this job's lease (crash, OOM, timeout) or an admin recovered it. */
  lease_lost_count?: number | null
}

type JobResult = Record<string, unknown>

/**
 * Claims up to `limit` runnable jobs: claim_jobs (one statement) when the
 * migration is applied, else claim_next_job one at a time.
 */
async function claimJobs(supabase: SupabaseClient, workerId: string, limit: number, state: ClaimState): Promise<Job[]> {
  if (state.batchRpc) {
    const { data, error } = await (supabase.rpc as any)("claim_jobs", {
      p_worker_id: workerId,
      p_limit: limit,
      ...(state.leases ? { p_lease_seconds: state.leaseSeconds } : {}),
    })
    if (!error) {
      // Run in claim order (the RPC's RETURNING order is not guaranteed).
      return ((data ?? []) as Array<Job & { priority?: number | null; scheduled_for?: string }>).sort(
        (a, b) =>
          (b.priority ?? 0) - (a.priority ?? 0) ||
          String(a.scheduled_for ?? "").localeCompare(String(b.scheduled_for ?? "")),
      )
    }
    if (error.code !== "PGRST202") return []
    // Before migration 20270124090000 claim_jobs has no lease argument.
    if (state.leases) {
      state.leases = false
      return claimJobs(supabase, workerId, limit, state)
    }
    state.batchRpc = false
  }
  const jobs: Job[] = []
  for (let i = 0; i < limit; i++) {
    const { data: job, error } = await supabase.rpc("claim_next_job", { p_worker_id: workerId })
    if (error || !job || !job.id) break
    jobs.push(job as Job)
  }
  return jobs
}

type ClaimState = { batchRpc: boolean; leases: boolean; leaseSeconds: number; fenced: boolean }

function newClaimState(): ClaimState {
  return { batchRpc: true, leases: true, leaseSeconds: leaseSeconds(), fenced: true }
}

const MISSING_FUNCTION = new Set(["PGRST202", "42883"])

/** How a job's run is finished: who holds it, and whether its lease was lost meanwhile. */
export type JobLease = {
  workerId: string
  /** Set once renew_job_leases stops returning the job: another worker or an admin took it over. */
  lost?: boolean
}

/**
 * complete_leased_job / fail_leased_job: only while this worker still holds
 * the job, so a worker that lost its lease never writes over a recovered job.
 * Falls back to the unfenced complete_job / fail_job before the migration.
 * Returns false when the result was discarded (lease lost).
 */
async function finishJob(
  supabase: SupabaseClient,
  job: Job,
  lease: JobLease | undefined,
  state: ClaimState | undefined,
  outcome: { result: Record<string, unknown> } | { error: string },
): Promise<boolean> {
  if (lease && state?.fenced !== false) {
    const { data, error } = "result" in outcome
      ? await (supabase.rpc as any)("complete_leased_job", { p_job_id: job.id, p_worker_id: lease.workerId, p_result: outcome.result })
      : await (supabase.rpc as any)("fail_leased_job", { p_job_id: job.id, p_worker_id: lease.workerId, p_error: outcome.error })
    if (!error) return data !== false
    if (!MISSING_FUNCTION.has(String(error.code))) return false
    if (state) state.fenced = false
  }
  if ("result" in outcome) await supabase.rpc("complete_job", { p_job_id: job.id, p_result: outcome.result as any })
  else await supabase.rpc("fail_job", { p_job_id: job.id, p_error: outcome.error })
  return true
}

/** Records the run a job started on the job (recovery finds it there); best effort. */
async function attachRun(supabase: SupabaseClient, job: Job, lease: JobLease | undefined, runId: string) {
  if (!lease || job.run_id === runId) return
  job.run_id = runId
  try {
    await (supabase.from("workflow_queue") as any)
      .update({ run_id: runId })
      .eq("id", job.id)
      .eq("locked_by", lease.workerId)
  } catch {
    // Column missing before migration 20270124090000: nothing to record.
  }
}

const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A job retried after its worker was lost (or an admin's Retry of a stuck
 * job) whose run was left `running`: that run never finishes on its own, so
 * it is marked failed ("Interrupted") before the job runs again. Returns the
 * interrupted run's id, or null when there was none.
 */
/** Fields only the engine writes on resume jobs: never taken from anyone else's data (a webhook payload, a form, an API start). */
export const RESUME_KEYS = ["_task_resume", "_resume_run_id", "_resume_event_id", "_resume_attempt"] as const
/** = RESUME_TRIGGER_TYPE in lib/workflow-resume-queue (kept literal here; __tests__/queue-resume-guard.test.ts checks they match). */
export const TASK_RESUME_TRIGGER = "task_resume"

/**
 * The resume instructions of a job — only when its trigger type says it is a
 * resume job the engine enqueued (task_resume / delay_resume). Every other
 * job's data comes, in part, from outside (webhook payloads, form fields, API
 * inputs), so the same keys there mean nothing.
 */
export function resumeData(triggerType: string | null | undefined, triggerData: Record<string, any> | undefined): {
  taskResume: Record<string, any> | null
  delayRunId: string | null
} {
  if (!triggerData) return { taskResume: null, delayRunId: null }
  if (triggerType === TASK_RESUME_TRIGGER && triggerData._task_resume && typeof triggerData._task_resume === "object") {
    return { taskResume: triggerData._task_resume, delayRunId: null }
  }
  if (triggerType === "delay_resume" && triggerData._resume_run_id) return { taskResume: null, delayRunId: String(triggerData._resume_run_id) }
  return { taskResume: null, delayRunId: null }
}

/** The run a job started or continues (null when unknown); resume run ids only from engine resume jobs (resumeData). */
export function jobRunRef(job: Job): string | null {
  const triggerData = (job.trigger_data && typeof job.trigger_data === "object" ? job.trigger_data : {}) as Record<string, any>
  const resume = resumeData(job.trigger_type, triggerData)
  const runId = job.run_id ?? resume.delayRunId ?? resume.taskResume?.run_id ?? null
  return typeof runId === "string" && RUN_ID_RE.test(runId) ? runId : null
}

export async function closeInterruptedRun(supabase: SupabaseClient, job: Job): Promise<string | null> {
  if (!(Number(job.lease_lost_count) > 0)) return null
  const runId = jobRunRef(job)
  if (!runId) return null
  const { data } = await (supabase.from("workflow_runs") as any)
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error: "Interrupted: the worker running this run was lost; the queue job was retried.",
    })
    .eq("id", runId)
    .eq("tenant_id", job.tenant_id)
    .eq("status", "running")
    .select("id")
  return data?.length ? runId : null
}

/** A lost worker's run continued from its checkpoint, or null (no checkpoint / not running / first attempt). */
async function recoverInterruptedRun(supabase: SupabaseClient, job: Job): Promise<Record<string, unknown> | null> {
  if (!(Number(job.lease_lost_count) > 0)) return null
  const runId = jobRunRef(job)
  if (!runId) return null
  const result = await recoverRunFromCheckpoint(runId, { tenantId: job.tenant_id, workflowId: job.workflow_id }, { supabase })
  return result ? { ...result, run_id: runId } : null
}

/** Slim job result stored by complete_job (the run row holds the details). */
function slimResult(result: Record<string, unknown>) {
  const slim: Record<string, unknown> = { status: result.status }
  for (const key of ["run_id", "event_id", "reason", "error", "response"] as const) {
    if (result[key] !== undefined && result[key] !== null) slim[key] = result[key]
  }
  return slim
}

/**
 * A new run from a queued job, started by the job's initiator: its signed
 * `_started_by`, a task trigger's actor, else nobody (the workflow's owner).
 */
async function startQueuedRun(
  supabase: SupabaseClient,
  job: Job,
  triggerData: Record<string, unknown> | undefined,
  versionId: unknown,
  onRunCreated?: (runId: string) => void | Promise<void>,
) {
  const initiator = await resolveQueuedInitiator(supabase, job, triggerData)
  const variables = triggerData ? { ...triggerData } : undefined
  if (variables) delete variables[QUEUED_INITIATOR_KEY]
  return executeWorkflow(
    job.workflow_id,
    job.task_id ?? undefined,
    false,
    variables,
    undefined,
    typeof versionId === "string" && versionId ? versionId : undefined,
    job.trace_id ?? null,
    { supabase, initiator, onRunCreated },
  )
}

/** One claimed job (exported for the DB-backed tests). */
export async function runJob(supabase: SupabaseClient, job: Job, lease?: JobLease, state?: ClaimState): Promise<JobResult> {
  try {
    // Retried after its worker was lost: continue the run from its
    // checkpoint (completed steps are not run again), else close it as
    // interrupted below.
    const recovered = await recoverInterruptedRun(supabase, job)
    if (recovered) {
      const applied = await finishJob(supabase, job, lease, state, { result: slimResult(recovered) })
      return { job_id: job.id, workflow_id: job.workflow_id, status: applied ? "completed" : "lease_lost", run_status: recovered.status, recovered: true }
    }
    const interruptedRunId = await closeInterruptedRun(supabase, job)
    if (interruptedRunId && job.run_id === interruptedRunId) job.run_id = null
    const triggerData = job.trigger_data
      ? (typeof job.trigger_data === "string" ? JSON.parse(job.trigger_data) : job.trigger_data)
      : undefined
    const enqueuedVersionId = triggerData?._version_id
    if (triggerData?._version_id) delete triggerData._version_id

    const scope = { workflowId: job.workflow_id, tenantId: job.tenant_id }
    // A delay_resume job continues a run paused by a long delay/pause_until
    // node, a task_resume job one waiting on a completed task or event;
    // everything else starts a new run. Which one is decided by the job's
    // trigger type (set by the engine), never by keys in its data: a webhook
    // payload or form submission could carry the same keys, and they are
    // stripped from every other job before its run starts.
    const resume = resumeData(job.trigger_type, triggerData)
    if (triggerData && !resume.taskResume && !resume.delayRunId) for (const key of RESUME_KEYS) delete triggerData[key]
    // A resume job whose run was interrupted mid-resume cannot resume it again
    // (the pause it was meant to continue is gone).
    if (interruptedRunId && (resume.taskResume || resume.delayRunId)) {
      const message = "The run was interrupted while resuming (its worker was lost) and was marked failed."
      await finishJob(supabase, job, lease, state, { result: { status: "failed", run_id: interruptedRunId, error: message } })
      return { job_id: job.id, workflow_id: job.workflow_id, status: "completed", run_status: "failed", error: message }
    }

    // Engine calls (queued starts / resumes, lib/processing/dispatch) only on
    // engine_call jobs, and signed; the key is stripped from every other job.
    const engineCall = job.trigger_type === ENGINE_CALL_TRIGGER_TYPE ? triggerData?.[ENGINE_CALL_KEY] : undefined
    if (triggerData && !engineCall) delete triggerData[ENGINE_CALL_KEY]
    const result: Record<string, unknown> = engineCall
      ? await runEngineCall(supabase, job, engineCall, { onRunCreated: (runId) => attachRun(supabase, job, lease, runId) })
      : resume.taskResume
      ? await runQueuedResume(resume.taskResume as any, scope, { supabase })
      : resume.delayRunId
        ? {
            ...(await resumeTimedPause(
              resume.delayRunId,
              String(triggerData?._resume_event_id ?? ""),
              scope,
              { supabase, attempt: Number(triggerData?._resume_attempt) || 0 },
            )),
            run_id: resume.delayRunId,
          }
        : await startQueuedRun(supabase, job, triggerData, enqueuedVersionId, (runId) => attachRun(supabase, job, lease, runId))

    const applied = await finishJob(supabase, job, lease, state, { result: slimResult(result) })
    if (!applied) {
      console.warn(`[workflow-queue] job ${job.id}: lease lost while running; its result was discarded (the job was recovered elsewhere)`)
      return { job_id: job.id, workflow_id: job.workflow_id, status: "lease_lost", run_status: result.status }
    }

    const nodeResults = (result.node_results ?? {}) as Record<string, { duration_ms?: number }>
    return {
      job_id: job.id,
      workflow_id: job.workflow_id,
      status: "completed",
      run_status: result.status,
      duration_ms: Object.values(nodeResults).reduce((sum, r) => sum + (r?.duration_ms ?? 0), 0),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const applied = await finishJob(supabase, job, lease, state, { error: message }).catch(() => false)
    if (!applied) {
      return { job_id: job.id, workflow_id: job.workflow_id, status: "lease_lost", error: message }
    }
    return {
      job_id: job.id,
      workflow_id: job.workflow_id,
      status: "failed",
      error: message,
    }
  }
}

/**
 * Runs queued workflow jobs: claims them in batches and runs up to
 * `concurrency` at once until `batchSize` jobs ran, the queue is empty, or the
 * time budget is spent (running jobs finish; claimed jobs that did not start
 * are released). Jobs enqueued by the running jobs are picked up before it
 * returns.
 */
export async function processWorkflowQueueBatch(options?: {
  batchSize?: number
  workerId?: string
  concurrency?: number
  budgetMs?: number
}) {
  const supabase = getServiceDb()

  const maxJobs = Math.max(1, Math.floor(options?.batchSize ?? 10))
  const workerId = options?.workerId ?? `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const concurrency = Math.max(1, Math.floor(options?.concurrency ?? workflowConcurrency()))
  const deadline = Date.now() + (options?.budgetMs ?? processorBudgetMs())
  const results: JobResult[] = []
  const worker = { kicked: false }
  const claimState = newClaimState()
  const leases = new Map<string, JobLease>()
  const keeper = startLeaseKeeper(supabase, workerId, leases, claimState)
  let released = 0
  let budgetExhausted = false
  let more = false

  await queueWorkerContext.run(worker, async () => {
    const pending: Job[] = []
    const running = new Set<Promise<void>>()
    let started = 0
    let queueEmpty = false

    const start = (job: Job) => {
      started++
      const lease: JobLease = { workerId }
      leases.set(job.id, lease)
      const task: Promise<void> = runJob(supabase, job, lease, claimState).then((r) => {
        results.push(r)
        leases.delete(job.id)
        running.delete(task)
      })
      running.add(task)
    }

    for (;;) {
      if (Date.now() >= deadline) {
        budgetExhausted = true
        break
      }
      // Fill free slots from claimed jobs, claiming more when none are left.
      while (running.size < concurrency && started < maxJobs) {
        if (!pending.length) {
          if (queueEmpty && !worker.kicked) break
          worker.kicked = false
          const want = Math.min(concurrency * 2, maxJobs - started)
          const claimed = await claimJobs(supabase, workerId, want, claimState)
          // A short batch means nothing else is runnable right now; claim
          // again only when a job kicks (it enqueued a follow-up).
          queueEmpty = claimed.length < want
          if (!claimed.length) break
          pending.push(...claimed)
        }
        start(pending.shift()!)
      }
      if (!running.size && !(worker.kicked && started < maxJobs)) break
      if (running.size) await Promise.race(running)
    }

    // Stopped with work left (budget spent, or batch_size reached on a full claim).
    more = budgetExhausted || pending.length > 0 || worker.kicked || (started >= maxJobs && !queueEmpty)

    // Out of budget: hand back what was claimed but not started.
    if (pending.length) {
      const ids = pending.map((job) => job.id)
      const { data, error } = claimState.batchRpc
        ? await supabase.rpc("release_jobs", { p_job_ids: ids, p_worker_id: workerId })
        : { data: null, error: { code: "PGRST202" } }
      if (error) {
        // Without release_jobs: reset them directly (same effect).
        await supabase
          .from("workflow_queue")
          .update({ status: "pending", locked_at: null, locked_by: null })
          .in("id", ids)
          .eq("locked_by", workerId)
      }
      released = typeof data === "number" ? data : ids.length
    }
    await Promise.all(running)
  })
  keeper.stop()

  return {
    processed: results.length,
    lease_lost: results.filter((r) => r.status === "lease_lost").length,
    results,
    worker_id: workerId,
    released,
    budget_exhausted: budgetExhausted,
    /** Runnable jobs are (probably) left: the caller should kick another invocation. */
    more,
  }
}

/**
 * Renews the leases of the jobs this processor is running every quarter of
 * the lease (renew_job_leases). A job the RPC no longer returns was taken
 * over (recovered after its lease expired, or force-cancelled): it is marked
 * lost so its result is not written. Does nothing before migration
 * 20270124090000 (claims carry no lease then).
 */
export function startLeaseKeeper(
  supabase: SupabaseClient,
  workerId: string,
  leases: Map<string, JobLease>,
  state: ClaimState,
): { stop: () => void; renewNow: () => Promise<void> } {
  let renewing: Promise<void> | null = null
  const renewNow = async () => {
    if (!state.leases || !state.batchRpc) return
    const ids = [...leases.entries()].filter(([, l]) => !l.lost).map(([id]) => id)
    if (!ids.length) return
    const { data, error } = await (supabase.rpc as any)("renew_job_leases", {
      p_worker_id: workerId,
      p_job_ids: ids,
      p_lease_seconds: state.leaseSeconds,
    })
    if (error) {
      if (MISSING_FUNCTION.has(String(error.code))) state.leases = false
      return // transient: the next renewal tries again well before the lease runs out
    }
    const held = new Set(((data ?? []) as unknown[]).map((row) => String(typeof row === "object" && row ? Object.values(row)[0] : row)))
    for (const id of ids) {
      const lease = leases.get(id)
      if (lease && !held.has(id)) {
        lease.lost = true
        console.warn(`[workflow-queue] job ${id}: lease lost (taken over by recovery or cancelled)`)
      }
    }
  }
  const timer = setInterval(() => {
    if (renewing) return
    renewing = renewNow().catch(() => undefined).finally(() => { renewing = null })
  }, Math.max(5, Math.floor(state.leaseSeconds / 4)) * 1000)
  ;(timer as { unref?: () => void }).unref?.()
  return { stop: () => clearInterval(timer), renewNow }
}

/**
 * A long-running claimer for a processor process (lib/processing/processor-host):
 * claims leased jobs on demand, runs them with the lease kept renewed, hands
 * unstarted ones back. Same claim / run / fence code as the batch above.
 */
export function createWorkflowJobRunner(workerId: string) {
  const supabase = getServiceDb()
  const state = newClaimState()
  const leases = new Map<string, JobLease>()
  const keeper = startLeaseKeeper(supabase, workerId, leases, state)
  return {
    leaseSeconds: state.leaseSeconds,
    async claim(limit: number): Promise<Job[]> {
      return claimJobs(supabase, workerId, Math.max(1, Math.min(Math.floor(limit), 100)), state)
    },
    async run(job: Job): Promise<JobResult> {
      const lease: JobLease = { workerId }
      leases.set(job.id, lease)
      try {
        return await queueWorkerContext.run({ kicked: false }, () => runJob(supabase, job, lease, state))
      } finally {
        leases.delete(job.id)
      }
    },
    async release(jobIds: string[]): Promise<number> {
      if (!jobIds.length) return 0
      const { data, error } = await supabase.rpc("release_jobs", { p_job_ids: jobIds, p_worker_id: workerId })
      return error ? 0 : Number(data) || 0
    },
    running(): number {
      return leases.size
    },
    stop(): void {
      keeper.stop()
    },
  }
}
