import type { SupabaseClient } from "@supabase/supabase-js"
import { getServiceDb } from "@/lib/providers/db"
import { executeWorkflow, resumeTimedPause } from "@/lib/workflow-engine"
import { queueWorkerContext } from "@/lib/process-queue"
import { runQueuedResume } from "@/lib/workflow-resume-queue"
import { QUEUED_INITIATOR_KEY, resolveQueuedInitiator } from "@/lib/workflow-initiator"

/** Jobs run at the same time by one processor invocation (env WORKFLOW_CONCURRENCY). */
export function workflowConcurrency(): number {
  const value = Number(process.env.WORKFLOW_CONCURRENCY)
  return Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), 50) : 5
}

/** Time after which the processor starts no new job (env WORKFLOW_PROCESSOR_BUDGET_MS). */
export function processorBudgetMs(): number {
  const value = Number(process.env.WORKFLOW_PROCESSOR_BUDGET_MS)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 50_000
}

type Job = {
  id: string
  workflow_id: string
  tenant_id: string
  task_id?: string | null
  trigger_type?: string | null
  trigger_data?: unknown
  trace_id?: string | null
}

type JobResult = Record<string, unknown>

/**
 * Claims up to `limit` runnable jobs: claim_jobs (one statement) when the
 * migration is applied, else claim_next_job one at a time.
 */
async function claimJobs(supabase: SupabaseClient, workerId: string, limit: number, state: { batchRpc: boolean }): Promise<Job[]> {
  if (state.batchRpc) {
    const { data, error } = await supabase.rpc("claim_jobs", { p_worker_id: workerId, p_limit: limit })
    if (!error) {
      // Run in claim order (the RPC's RETURNING order is not guaranteed).
      return ((data ?? []) as Array<Job & { priority?: number | null; scheduled_for?: string }>).sort(
        (a, b) =>
          (b.priority ?? 0) - (a.priority ?? 0) ||
          String(a.scheduled_for ?? "").localeCompare(String(b.scheduled_for ?? "")),
      )
    }
    if (error.code !== "PGRST202") return []
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

/** Slim job result stored by complete_job (the run row holds the details). */
function slimResult(result: Record<string, unknown>) {
  const slim: Record<string, unknown> = { status: result.status }
  for (const key of ["run_id", "event_id", "reason", "error"] as const) {
    if (result[key] !== undefined && result[key] !== null) slim[key] = result[key]
  }
  return slim
}

/**
 * A new run from a queued job, started by the job's initiator: its signed
 * `_started_by`, a task trigger's actor, else nobody (the workflow's owner).
 */
async function startQueuedRun(supabase: SupabaseClient, job: Job, triggerData: Record<string, unknown> | undefined, versionId: unknown) {
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
    { supabase, initiator },
  )
}

/** One claimed job (exported for the DB-backed tests). */
export async function runJob(supabase: SupabaseClient, job: Job): Promise<JobResult> {
  try {
    const triggerData = job.trigger_data
      ? (typeof job.trigger_data === "string" ? JSON.parse(job.trigger_data) : job.trigger_data)
      : undefined
    const enqueuedVersionId = triggerData?._version_id
    if (triggerData?._version_id) delete triggerData._version_id

    const scope = { workflowId: job.workflow_id, tenantId: job.tenant_id }
    // A delay_resume job continues a run paused by a long delay/pause_until
    // node, a task_resume job one waiting on a completed task or event;
    // everything else starts a new run.
    const result: Record<string, unknown> = triggerData?._task_resume
      ? await runQueuedResume(triggerData._task_resume, scope, { supabase })
      : triggerData?._resume_run_id
        ? {
            ...(await resumeTimedPause(
              String(triggerData._resume_run_id),
              String(triggerData._resume_event_id ?? ""),
              scope,
              { supabase },
            )),
            run_id: String(triggerData._resume_run_id),
          }
        : await startQueuedRun(supabase, job, triggerData, enqueuedVersionId)

    await supabase.rpc("complete_job", {
      p_job_id: job.id,
      p_result: slimResult(result),
    })

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
    await supabase.rpc("fail_job", {
      p_job_id: job.id,
      p_error: message,
    })
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
  const claimState = { batchRpc: true }
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
      const task: Promise<void> = runJob(supabase, job).then((r) => {
        results.push(r)
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

  return {
    processed: results.length,
    results,
    worker_id: workerId,
    released,
    budget_exhausted: budgetExhausted,
    /** Runnable jobs are (probably) left: the caller should kick another invocation. */
    more,
  }
}
