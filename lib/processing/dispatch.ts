/**
 * Starting and resuming runs from a request, honouring the processing
 * hand-off (lib/processing/handoff.ts).
 *
 *   web    startRun / resumeRun call the engine in this process, exactly as
 *          the callers did before.
 *   queue  they enqueue a signed `engine call` job (workflow_queue,
 *          trigger_data._engine_call) and return — or, for callers that need
 *          the result (synchronous API starts, middleware webhooks, the agent
 *          tool, run actions), wait for the job, bounded
 *          (PROCESSING_WAIT_TIMEOUT_MS, default 55 s): past it they get a
 *          clear timeout (the run carries on in the background).
 *
 * Inside a processor process (the worker) both run locally: the worker is
 * where queued work runs.
 *
 * The job's payload is HMAC-signed (the internal signing key, as queued
 * resumes are): the worker runs only engine calls whose signature verifies
 * for the job's tenant and workflow, so a payload field can never smuggle
 * one in.
 */
import { createHmac, timingSafeEqual } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { requireSigningKey, signingKeys } from "@/lib/config/signing"
import { createServiceClient } from "@/lib/cron-auth"
import { executeWorkflow, resumeWorkflow, type NodeEvent, type WorkflowHttpResponse } from "@/lib/workflow-engine"
import type { RunInitiator } from "@/lib/workflow-initiator"
import { RunNotResumableError } from "@/lib/workflow-run-errors"
import { isProcessorProcess, notifyProcessing, processingHandoff, testRunsOnWorkers } from "./handoff"

/* eslint-disable @typescript-eslint/no-explicit-any -- run results and job rows are untyped JSON */

export const ENGINE_CALL_KEY = "_engine_call"
export const ENGINE_CALL_TRIGGER_TYPE = "engine_call"

export type EngineCall =
  | {
      op: "start"
      task_id?: string | null
      variables?: Record<string, unknown>
      version_id?: string | null
      initiator?: { userId: string | null; via: string } | null
      test?: boolean
      test_form_drafts?: boolean
      /** Relay the engine's events (designer test runs) to workflow_run_event_relay. */
      relay?: boolean
    }
  | {
      op: "resume"
      run_id: string
      variables: Record<string, unknown>
      event_id?: string | null
      migrated?: boolean
      relay?: boolean
    }

interface SignedEngineCall {
  call: string
  sig: string
}

function mac(key: Buffer, tenantId: string, workflowId: string, call: string): Buffer {
  return createHmac("sha256", key).update(["engine_call", tenantId, workflowId, call].join("\n")).digest()
}

export function signEngineCall(tenantId: string, workflowId: string, call: EngineCall): SignedEngineCall {
  const json = JSON.stringify(call)
  return { call: json, sig: mac(requireSigningKey(), tenantId, workflowId, json).toString("hex") }
}

/** The call, when the signature verifies for this tenant and workflow (any configured key); else null. */
export function verifyEngineCall(tenantId: string, workflowId: string, signed: unknown): EngineCall | null {
  const s = (signed ?? {}) as Partial<SignedEngineCall>
  if (typeof s.call !== "string" || typeof s.sig !== "string" || !/^[0-9a-f]{64}$/.test(s.sig)) return null
  const given = Buffer.from(s.sig, "hex")
  let ok = false
  for (const { key } of signingKeys()) if (timingSafeEqual(mac(key, tenantId, workflowId, s.call), given)) ok = true
  if (!ok) return null
  try {
    const call = JSON.parse(s.call)
    return call && (call.op === "start" || call.op === "resume") ? (call as EngineCall) : null
  } catch {
    return null
  }
}

/** Bounded wait for queued work a caller needs the result of (env PROCESSING_WAIT_TIMEOUT_MS, 1 s – 15 min). */
export function processingWaitTimeoutMs(): number {
  const value = Number(process.env.PROCESSING_WAIT_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? Math.min(Math.max(Math.floor(value), 1000), 15 * 60_000) : 55_000
}

export class QueuedRunTimeoutError extends Error {
  readonly code = "processing_timeout"
  constructor(readonly jobId: string, readonly timeoutMs: number) {
    super(
      `The run was handed to the processing workers and did not finish within ${Math.round(timeoutMs / 1000)} s. ` +
        `It carries on in the background (queue job ${jobId}); check the workflow queue or the run for its outcome.`,
    )
    this.name = "QueuedRunTimeoutError"
  }
}

/** Should this request hand runs to the queue (queue mode, and not already inside a processor)? */
export async function handsOff(options: { test?: boolean } = {}): Promise<boolean> {
  if (isProcessorProcess()) return false
  if (options.test) return testRunsOnWorkers()
  return (await processingHandoff()) === "queue"
}

/** Enqueue a signed engine call; returns the job id. */
export async function enqueueEngineCall(input: {
  supabase?: SupabaseClient
  tenantId: string
  workflowId: string
  taskId?: string | null
  call: EngineCall
  priority?: number
  triggerType?: string
}): Promise<string> {
  const supabase = input.supabase ?? createServiceClient()
  const { data, error } = await (supabase.rpc as any)("enqueue_workflow", {
    p_workflow_id: input.workflowId,
    p_tenant_id: input.tenantId,
    p_task_id: input.taskId ?? null,
    p_trigger_type: input.triggerType ?? ENGINE_CALL_TRIGGER_TYPE,
    p_trigger_data: { [ENGINE_CALL_KEY]: signEngineCall(input.tenantId, input.workflowId, input.call) },
    p_priority: Math.max(0, Math.min(Math.round(input.priority ?? 90), 100)),
    p_delay_seconds: 0,
  })
  if (error || !data) throw new Error(`Could not hand the run to the processing workers: ${error?.message ?? "no job id"}`)
  void notifyProcessing("workflows")
  return String(data)
}

export interface QueueJobRow {
  id: string
  status: string
  result: Record<string, any> | null
  error: string | null
  attempts?: number
  max_attempts?: number
}

/**
 * Waits until the job finished (completed / dead, or failed with no attempt
 * left), polling with a growing interval (100 ms → 1 s). Null on timeout.
 */
export async function waitForQueueJob(
  supabase: SupabaseClient,
  jobId: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<QueueJobRow | null> {
  const deadline = Date.now() + (options.timeoutMs ?? processingWaitTimeoutMs())
  let interval = 100
  for (;;) {
    const { data } = await (supabase.from("workflow_queue") as any)
      .select("id, status, result, error, attempts, max_attempts")
      .eq("id", jobId)
      .maybeSingle()
    if (data && (data.status === "completed" || data.status === "dead" || (data.status === "failed" && Number(data.attempts) >= Number(data.max_attempts ?? 3)))) {
      return data as QueueJobRow
    }
    if (Date.now() >= deadline || options.signal?.aborted) return null
    await new Promise((resolve) => setTimeout(resolve, Math.min(interval, Math.max(0, deadline - Date.now()))))
    interval = Math.min(1000, Math.round(interval * 1.5))
  }
}

export interface RunOutcome {
  status: string
  run_id?: string
  node_results: Record<string, any>
  error?: string
  reason?: string
  event_id?: string
  paused_node_id?: string
  response?: WorkflowHttpResponse
  logs?: any[]
  /** Ran on a processing worker (queue mode). */
  queued?: { job_id: string }
}

/** A finished engine-call job → the outcome its caller expects (the run row fills in the details). */
async function outcomeOfJob(supabase: SupabaseClient, job: QueueJobRow): Promise<RunOutcome> {
  const result = job.result ?? {}
  const runId = typeof result.run_id === "string" ? result.run_id : undefined
  let run: any = null
  if (runId) {
    const { data } = await (supabase.from("workflow_runs") as any)
      .select("id, status, error, node_results, event_id, paused_node_id")
      .eq("id", runId)
      .maybeSingle()
    run = data
  }
  const failedJob = job.status !== "completed"
  return {
    status: failedJob ? "failed" : String(result.status ?? run?.status ?? "completed"),
    ...(runId ? { run_id: runId } : {}),
    node_results: (run?.node_results ?? {}) as Record<string, any>,
    ...(failedJob ? { error: job.error ?? "The processing worker could not run it" } : result.error ? { error: String(result.error) } : {}),
    ...(result.reason ? { reason: String(result.reason) } : {}),
    ...(run?.event_id ? { event_id: run.event_id } : result.event_id ? { event_id: String(result.event_id) } : {}),
    ...(run?.paused_node_id ? { paused_node_id: run.paused_node_id } : {}),
    ...(result.response ? { response: decodeHttpResponse(result.response) } : {}),
    queued: { job_id: job.id },
  }
}

/** HTTP responses travel through the job result as JSON: file bodies base64-encoded. */
export function encodeHttpResponse(response: WorkflowHttpResponse | undefined): Record<string, unknown> | undefined {
  if (!response) return undefined
  const body = response.body as unknown
  if (body instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(body))) {
    return { ...response, body: { __base64: Buffer.from(body as Uint8Array).toString("base64") } }
  }
  if (body instanceof ArrayBuffer) return { ...response, body: { __base64: Buffer.from(body).toString("base64") } }
  return response as unknown as Record<string, unknown>
}

export function decodeHttpResponse(value: any): WorkflowHttpResponse {
  const body = value?.body
  if (body && typeof body === "object" && typeof body.__base64 === "string") {
    return { ...value, body: Buffer.from(body.__base64, "base64") } as WorkflowHttpResponse
  }
  return value as WorkflowHttpResponse
}

interface StartRunInput {
  supabase?: SupabaseClient
  workflowId: string
  tenantId: string
  taskId?: string | null
  variables?: Record<string, any>
  /** The published version to run (queued starts pin it). */
  versionId?: string | null
  initiator?: RunInitiator
  test?: boolean
  testFormDrafts?: boolean
  onEvent?: (event: NodeEvent) => void
  /** queue mode: wait for the result (default true); false returns { status: 'queued' } at once. */
  wait?: boolean
  timeoutMs?: number
  priority?: number
}

/**
 * Start a run: in this process (web mode), or on a processing worker (queue
 * mode; waits for the result unless `wait: false`). Throws
 * QueuedRunTimeoutError when the wait runs out.
 */
export async function startRun(input: StartRunInput): Promise<RunOutcome> {
  if (!(await handsOff({ test: input.test }))) {
    return executeWorkflow(
      input.workflowId,
      input.taskId ?? undefined,
      input.test === true,
      input.variables,
      input.onEvent,
      input.versionId ?? undefined,
      undefined,
      {
        ...(input.supabase ? { supabase: input.supabase } : {}),
        ...(input.initiator ? { initiator: input.initiator } : {}),
        ...(input.testFormDrafts ? { testFormDrafts: true } : {}),
      },
    ) as Promise<RunOutcome>
  }
  const supabase = input.supabase ?? createServiceClient()
  const jobId = await enqueueEngineCall({
    supabase,
    tenantId: input.tenantId,
    workflowId: input.workflowId,
    taskId: input.taskId ?? null,
    priority: input.priority ?? (input.test ? 100 : 90),
    call: {
      op: "start",
      task_id: input.taskId ?? null,
      variables: input.variables ?? {},
      version_id: input.versionId ?? null,
      initiator: input.initiator ? { userId: input.initiator.userId ?? null, via: input.initiator.via } : null,
      ...(input.test ? { test: true } : {}),
      ...(input.testFormDrafts ? { test_form_drafts: true } : {}),
      ...(input.onEvent ? { relay: true } : {}),
    },
  })
  if (input.wait === false) return { status: "queued", node_results: {}, queued: { job_id: jobId } }
  return awaitQueued(supabase, jobId, input.timeoutMs, input.onEvent)
}

interface ResumeRunInput {
  supabase?: SupabaseClient
  runId: string
  tenantId: string
  workflowId: string
  variables: Record<string, any>
  eventId?: string | null
  migrated?: boolean
  test?: boolean
  onEvent?: (event: NodeEvent) => void
  wait?: boolean
  timeoutMs?: number
}

/**
 * Resume a waiting / paused run (resumeWorkflow) here or on a processing
 * worker. The worker claims the run only while it is still waiting on the
 * same event, as resumeWorkflow does; a run that moved on comes back as
 * status `skipped` with the reason.
 */
export async function resumeRun(input: ResumeRunInput): Promise<RunOutcome> {
  if (!(await handsOff({ test: input.test }))) {
    const options = {
      ...(input.supabase ? { supabase: input.supabase } : {}),
      ...(input.eventId ? { eventId: input.eventId } : {}),
      ...(input.migrated ? { migrated: true } : {}),
    }
    // Exactly the call the callers made before (no options object when none apply).
    const result = await resumeWorkflow(input.runId, input.variables, input.onEvent, Object.keys(options).length ? options : undefined)
    return { ...result, run_id: input.runId }
  }
  const supabase = input.supabase ?? createServiceClient()
  const jobId = await enqueueEngineCall({
    supabase,
    tenantId: input.tenantId,
    workflowId: input.workflowId,
    priority: input.test ? 100 : 90,
    call: {
      op: "resume",
      run_id: input.runId,
      variables: input.variables ?? {},
      ...(input.eventId ? { event_id: input.eventId } : {}),
      ...(input.migrated ? { migrated: true } : {}),
      ...(input.onEvent ? { relay: true } : {}),
    },
  })
  if (input.wait === false) return { status: "queued", run_id: input.runId, node_results: {}, queued: { job_id: jobId } }
  return awaitQueued(supabase, jobId, input.timeoutMs, input.onEvent)
}

async function awaitQueued(supabase: SupabaseClient, jobId: string, timeoutMs: number | undefined, onEvent?: (event: NodeEvent) => void): Promise<RunOutcome> {
  const limit = timeoutMs ?? processingWaitTimeoutMs()
  const job = onEvent
    ? await relayEvents(supabase, jobId, limit, onEvent)
    : await waitForQueueJob(supabase, jobId, { timeoutMs: limit })
  if (!job) throw new QueuedRunTimeoutError(jobId, limit)
  const outcome = await outcomeOfJob(supabase, job)
  if (outcome.status === "skipped" && outcome.reason === RUN_NOT_RESUMABLE) throw new RunNotResumableError()
  return outcome
}

/** Reason a queued resume reports when the run was no longer waiting (callers map it to RunNotResumableError). */
export const RUN_NOT_RESUMABLE = "run_not_resumable"

/* ── event relay (queued designer test runs) ─────────────────────────── */

const RELAY_MAX_EVENTS = 5000
const RELAY_EVENT_BYTES = 64 * 1024

/** Worker side: buffers the engine's events and writes them in small batches. */
export function createEventRelay(supabase: SupabaseClient, jobId: string): { onEvent: (event: NodeEvent) => void; flush: () => Promise<void> } {
  let seq = 0
  let buffer: Array<{ job_id: string; seq: number; event: unknown }> = []
  let writing: Promise<void> = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | null = null
  const write = () => {
    timer = null
    const rows = buffer
    buffer = []
    if (!rows.length) return writing
    writing = writing.then(async () => {
      await (supabase.from("workflow_run_event_relay" as any) as any).insert(rows).then(() => undefined, () => undefined)
    })
    return writing
  }
  return {
    onEvent(event) {
      if (seq >= RELAY_MAX_EVENTS) return
      let payload: unknown = event
      try {
        if (JSON.stringify(event).length > RELAY_EVENT_BYTES) {
          payload = { type: (event as any).type, node_id: (event as any).node_id, node_label: (event as any).node_label, data: { truncated: true } }
        }
      } catch {
        return
      }
      buffer.push({ job_id: jobId, seq: ++seq, event: payload })
      timer ??= setTimeout(write, 200)
    },
    async flush() {
      if (timer) clearTimeout(timer)
      await write()
    },
  }
}

/** Web side: streams relayed events to `onEvent` until the job finishes (or the wait runs out). */
async function relayEvents(supabase: SupabaseClient, jobId: string, timeoutMs: number, onEvent: (event: NodeEvent) => void): Promise<QueueJobRow | null> {
  const deadline = Date.now() + timeoutMs
  let last = 0
  const drain = async () => {
    const { data } = await (supabase.from("workflow_run_event_relay" as any) as any)
      .select("seq, event")
      .eq("job_id", jobId)
      .gt("seq", last)
      .order("seq", { ascending: true })
      .limit(500)
    for (const row of (data ?? []) as Array<{ seq: number; event: NodeEvent }>) {
      last = row.seq
      if (row.event?.type !== "done") onEvent(row.event)
    }
    return (data ?? []).length
  }
  for (;;) {
    const job = await waitForQueueJob(supabase, jobId, { timeoutMs: 0 })
    while ((await drain()) >= 500) { /* catch up */ }
    if (job) {
      await drain()
      await (supabase.from("workflow_run_event_relay" as any) as any).delete().eq("job_id", jobId).then(() => undefined, () => undefined)
      return job
    }
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/* ── worker side ──────────────────────────────────────────────────────── */

/**
 * Runs a verified engine call (the queue processor, for an `_engine_call`
 * job). Returns the run's result; a resume of a run that is no longer
 * waiting comes back as `skipped` (RUN_NOT_RESUMABLE).
 */
export async function runEngineCall(
  supabase: SupabaseClient,
  job: { id: string; workflow_id: string; tenant_id: string; trace_id?: string | null },
  signed: unknown,
  options: { onRunCreated?: (runId: string) => void | Promise<void> } = {},
): Promise<Record<string, unknown>> {
  const call = verifyEngineCall(job.tenant_id, job.workflow_id, signed)
  if (!call) return { status: "skipped", node_results: {}, reason: "Engine call signature is invalid" }
  const relay = call.relay ? createEventRelay(supabase, job.id) : null
  try {
    if (call.op === "start") {
      const result = await executeWorkflow(
        job.workflow_id,
        call.task_id ?? undefined,
        call.test === true,
        call.variables ?? {},
        relay?.onEvent,
        call.test ? undefined : (call.version_id ?? undefined),
        job.trace_id ?? null,
        {
          supabase,
          ...(call.initiator ? { initiator: { userId: call.initiator.userId, via: call.initiator.via as RunInitiator["via"] } } : {}),
          ...(call.test_form_drafts ? { testFormDrafts: true } : {}),
          ...(options.onRunCreated ? { onRunCreated: options.onRunCreated } : {}),
        },
      )
      return { ...result, response: encodeHttpResponse(result.response) }
    }
    // The run must belong to the job's workflow and tenant.
    const { data: run } = await (supabase.from("workflow_runs") as any)
      .select("id")
      .eq("id", call.run_id)
      .eq("workflow_id", job.workflow_id)
      .eq("tenant_id", job.tenant_id)
      .maybeSingle()
    if (!run) return { status: "skipped", node_results: {}, run_id: call.run_id, reason: "Run not found" }
    await options.onRunCreated?.(call.run_id)
    try {
      const result = await resumeWorkflow(call.run_id, call.variables ?? {}, relay?.onEvent, {
        supabase,
        ...(call.event_id ? { eventId: call.event_id } : {}),
        ...(call.migrated ? { migrated: true } : {}),
      })
      return { ...result, run_id: call.run_id }
    } catch (error) {
      if (error instanceof RunNotResumableError) return { status: "skipped", node_results: {}, run_id: call.run_id, reason: RUN_NOT_RESUMABLE }
      throw error
    }
  } finally {
    await relay?.flush()
  }
}
