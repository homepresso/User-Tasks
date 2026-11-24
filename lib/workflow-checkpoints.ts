/**
 * Run checkpoints and step idempotency (migration 20270125100000).
 *
 * A run executes in segments: from its start to its first pause, then from
 * each resume to the next pause or the end. While a segment runs,
 * `workflow_runs.checkpoint` holds how it began (`base`) and, after every
 * completed step, that step's output and the variables it changed — a small
 * delta, one UPDATE per step (checkpoint_run_step). Side-effecting steps are
 * also marked `started` just before they run.
 *
 * When the worker running a segment is lost (crash, OOM kill, timeout — its
 * queue lease expires, lib/workflow-queue-processor), the retried job
 * replays the segment from its base with the same run id: steps already
 * completed are not run again — their recorded output and variable changes
 * are applied instead — and execution carries on after the last completed
 * step. Pure steps (conditions, set variable, text and JSON helpers …) simply
 * run again; they only read variables.
 *
 * A side-effecting step that was started but not completed may or may not
 * have taken effect. It runs again when it is idempotent — send email and
 * data table writes check workflow_step_effects for their idempotency key,
 * an HTTP request with a safe method (GET/HEAD/OPTIONS/PUT/DELETE) or with
 * "Send an Idempotency-Key header" on lets the receiver de-duplicate — and
 * otherwise fails with "outcome unknown" (On error decides), unless the
 * workflow's trigger step says `interrupted_steps: retry`.
 *
 * Idempotency key of a step execution: `<run id>:<node id>:<visit>` (visit =
 * the how-many-th time the run executes that step, 1 for steps outside
 * loops), the same on every attempt of the job, so a retry is recognised.
 *
 * WORKFLOW_CHECKPOINTS: `side_effects` (default: record side-effecting steps
 * only; pure ones are recomputed on replay), `all`, or `off`.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { truncateForStorage } from "@/lib/truncate"

/* eslint-disable @typescript-eslint/no-explicit-any -- run state is untyped JSON */

export type CheckpointMode = "off" | "side_effects" | "all"

export function checkpointMode(env: Record<string, string | undefined> = process.env): CheckpointMode {
  const value = (env.WORKFLOW_CHECKPOINTS ?? "").trim().toLowerCase()
  if (value === "off" || value === "false" || value === "0") return "off"
  if (value === "all") return "all"
  return "side_effects"
}

/** Steps that only read and write run variables: safe to recompute on replay. */
export const PURE_NODE_TYPES: ReadonlySet<string> = new Set([
  "task_created", "task_received", "task_submitted", "task_updated", "task_completed", "task_rejected",
  "workflow_error", "workflow_sla", "retention_policy_review", "retention_policy_executed", "data_table_event",
  "form_submitted", "middleware_received", "schedule", "webhook_received", "esign_event", "agent_error", "manual",
  "parallel", "placeholder", "section_group", "condition", "switch_case", "loop", "loop_n_times",
  "math", "modify_string", "text_template", "format_date", "date_math", "regex",
  "collection_count", "collection_get", "collection_filter", "collection_sort", "collection_unique", "collection_join",
  "json_build_object", "json_build_array", "json_add_to_array", "json_get_value",
  "set_variable", "decision_table", "check_permission", "goto_activity",
])

/** Wait / control steps that end the segment or are handled by the pause machinery (never memoized). */
const NEVER_MEMOIZED: ReadonlySet<string> = new Set([
  "user_task", "server_event", "delay", "pause_until", "end_workflow", "esign_wait",
])

/** Steps whose performed effect is recorded in workflow_step_effects (a re-run after a lost worker finds it). */
export const EFFECT_RECORDED_TYPES: ReadonlySet<string> = new Set(["send_email", "update_data_table"])

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"])

export function isSideEffectingNode(type: string): boolean {
  return !PURE_NODE_TYPES.has(type)
}

/** Steps that can be run again safely after an interruption mid-step. */
export function isIdempotentStep(node: { type: string; config?: Record<string, any> }): boolean {
  if (PURE_NODE_TYPES.has(node.type)) return true
  if (node.type === "send_email" || node.type === "update_data_table") return true
  if (node.type === "http_request") {
    const method = String(node.config?.method ?? "GET").toUpperCase()
    return SAFE_HTTP_METHODS.has(method) || node.config?.idempotency_header === true
  }
  return false
}

export function stepIdempotencyKey(runId: string, nodeId: string, visit: number): string {
  return `${runId}:${nodeId}:${visit}`
}

/** How the segment began: enough to replay it. */
export type CheckpointBase =
  | {
      kind: "start"
      task_id: string | null
      test: boolean
      test_form_drafts?: boolean
      variables: Record<string, unknown>
      initiator?: { userId: string | null; via: string } | null
    }
  | {
      kind: "resume"
      paused_node_id: string | null
      pause_variables: Record<string, unknown> | null
      return_variables: Record<string, unknown>
      node_results: Record<string, unknown> | null
      event_id: string | null
      migrated?: boolean
    }

export interface CompletedStep {
  /** The step's output (capped). */
  o: unknown
  /** Variables the step set (key → value) and removed (in `x`). */
  d: Record<string, unknown>
  x?: string[]
  /** Output or variables were too large to keep: replay cannot restore this step. */
  t?: true
  /** The step failed with this error (replay fails it the same way). */
  e?: string
  at: string
}

export interface RunCheckpoint {
  v: 1
  segment: string
  base: CheckpointBase
  completed: Record<string, CompletedStep>
  started: Record<string, string>
  /** Whole-segment state too big to checkpoint: nothing is recorded (replay impossible). */
  disabled?: true
}

const MAX_STEP_BYTES = 256 * 1024
const MAX_BASE_BYTES = 1024 * 1024

export function newCheckpoint(base: CheckpointBase): RunCheckpoint {
  const segment = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const size = safeSize(base)
  return size > MAX_BASE_BYTES
    ? { v: 1, segment, base: { ...base, ...(base.kind === "start" ? { variables: {} } : { pause_variables: {}, node_results: {}, return_variables: {} }) } as CheckpointBase, completed: {}, started: {}, disabled: true }
    : { v: 1, segment, base, completed: {}, started: {} }
}

function safeSize(value: unknown): number {
  try {
    return JSON.stringify(value ?? null).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Shallow copy of the variables (references), to diff after a step. */
export function snapshotVariables(vars: Record<string, unknown>): Map<string, unknown> {
  return new Map(Object.entries(vars))
}

/** Variables a step set (new or changed reference) and removed. */
export function variablesDelta(before: Map<string, unknown>, after: Record<string, unknown>): { set: Record<string, unknown>; removed: string[] } {
  const set: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(after)) {
    if (!before.has(key) || before.get(key) !== value) set[key] = value
  }
  const removed: string[] = []
  for (const key of before.keys()) if (!(key in after)) removed.push(key)
  return { set, removed }
}

/** What a step that was interrupted mid-run does on replay. */
export type InterruptedStepPolicy = "fail" | "retry"

export class OutcomeUnknownError extends Error {
  readonly code = "outcome_unknown"
  constructor(label: string) {
    super(
      `Outcome unknown: the worker running "${label}" was lost before the step finished, so it may or may not have taken effect. ` +
        "It was not run again (it cannot be repeated safely). Check the target system, then resume or re-run as needed; " +
        "set the trigger step's “If a step is interrupted” option to Run it again to retry such steps automatically.",
    )
    this.name = "OutcomeUnknownError"
  }
}

export type StepReplay =
  | { kind: "run" }
  | { kind: "replay"; step: CompletedStep }
  | { kind: "outcome_unknown" }

/**
 * The checkpoint of one running segment: counts step visits, answers whether
 * a step replays, and records completed / started steps. Shared by every
 * Parallel branch of the run (same object in their contexts).
 */
export class CheckpointRuntime {
  private readonly visits = new Map<string, number>()
  private writes: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly supabase: SupabaseClient,
    readonly runId: string,
    readonly checkpoint: RunCheckpoint,
    readonly mode: CheckpointMode,
    /** The checkpoint left by a lost worker (replay), when recovering. */
    private readonly replay: RunCheckpoint | null,
    readonly policy: InterruptedStepPolicy = "fail",
  ) {}

  /** Checkpoints are written (not off, not disabled by size or a missing migration). */
  get active(): boolean {
    return this.mode !== "off" && !this.checkpoint.disabled
  }

  get recovering(): boolean {
    return this.replay !== null
  }

  /** The visit number of this execution of `nodeId` (1, 2, … in loops). */
  nextVisit(nodeId: string): number {
    const visit = (this.visits.get(nodeId) ?? 0) + 1
    this.visits.set(nodeId, visit)
    return visit
  }

  key(nodeId: string, visit: number): string {
    return `${nodeId}#${visit}`
  }

  decide(node: { id: string; type: string; config?: Record<string, any> }, visit: number): StepReplay {
    if (!this.replay || NEVER_MEMOIZED.has(node.type)) return { kind: "run" }
    const key = this.key(node.id, visit)
    const done = this.replay.completed?.[key]
    if (done && !done.t) return { kind: "replay", step: done }
    // Completed but too large to restore, or started and never finished: run
    // again only when that is safe (or the workflow says so).
    if ((done || this.replay.started?.[key]) && !isIdempotentStep(node) && this.policy === "fail") return { kind: "outcome_unknown" }
    return { kind: "run" }
  }

  private records(type: string): boolean {
    if (this.mode === "off" || this.checkpoint.disabled || NEVER_MEMOIZED.has(type)) return false
    return this.mode === "all" || isSideEffectingNode(type)
  }

  /**
   * Before a non-idempotent side-effecting step runs: mark it started
   * (awaited, so a crash after this is known). Idempotent steps run again on
   * replay anyway, so they skip this write.
   */
  async markStarted(node: { id: string; type: string; config?: Record<string, any> }, visit: number): Promise<void> {
    if (!this.records(node.type) || !isSideEffectingNode(node.type) || isIdempotentStep(node)) return
    const key = this.key(node.id, visit)
    const at = new Date().toISOString()
    this.checkpoint.started[key] = at
    await this.write({ p_started: { [key]: at } })
  }

  /** After a step failed: record the error, so a replay fails it the same way instead of guessing. */
  async recordFailed(node: { id: string; type: string }, visit: number, message: string, delta: { set: Record<string, unknown>; removed: string[] }): Promise<void> {
    if (!this.records(node.type)) return
    const key = this.key(node.id, visit)
    let step: CompletedStep = { o: null, d: delta.set, ...(delta.removed.length ? { x: delta.removed } : {}), e: message.slice(0, 4000), at: new Date().toISOString() }
    if (safeSize(step) > MAX_STEP_BYTES) step = { o: null, d: {}, t: true, e: step.e, at: step.at }
    this.checkpoint.completed[key] = step
    await this.write({ p_completed: { [key]: step } })
  }

  /** After a step completed: record its output and variable changes. */
  async recordCompleted(node: { id: string; type: string }, visit: number, output: unknown, delta: { set: Record<string, unknown>; removed: string[] }): Promise<void> {
    if (!this.records(node.type)) return
    const key = this.key(node.id, visit)
    let step: CompletedStep = { o: output ?? null, d: delta.set, ...(delta.removed.length ? { x: delta.removed } : {}), at: new Date().toISOString() }
    if (safeSize(step) > MAX_STEP_BYTES) {
      step = { o: truncateForStorage(output, 2048), d: {}, t: true, at: step.at }
    }
    this.checkpoint.completed[key] = step
    await this.write({ p_completed: { [key]: step } })
  }

  private async write(patch: { p_completed?: Record<string, unknown>; p_started?: Record<string, unknown> }): Promise<void> {
    const run = async () => {
      const { error } = await (this.supabase.rpc as any)("checkpoint_run_step", {
        p_run_id: this.runId,
        p_segment: this.checkpoint.segment,
        p_completed: patch.p_completed ?? null,
        p_started: patch.p_started ?? null,
      })
      // Before the migration: no checkpoints (the run behaves as before).
      if (error && ["PGRST202", "42883"].includes(String(error.code))) this.checkpoint.disabled = true
    }
    this.writes = this.writes.then(run, run)
    await this.writes
  }
}

/** Apply a replayed step's variable changes. */
export function applyReplayedStep(vars: Record<string, unknown>, step: CompletedStep): void {
  for (const [key, value] of Object.entries(step.d ?? {})) vars[key] = value
  for (const key of step.x ?? []) delete vars[key]
}

/**
 * Durable record of a performed side effect (workflow_step_effects), by
 * idempotency key: `find` before acting, `record` after. Tolerates a missing
 * table (before the migration: always act).
 */
export async function findStepEffect(supabase: SupabaseClient, key: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await (supabase.from("workflow_step_effects" as any) as any).select("result").eq("key", key).maybeSingle()
  if (error || !data) return null
  return (data.result ?? {}) as Record<string, unknown>
}

export async function recordStepEffect(
  supabase: SupabaseClient,
  input: { key: string; tenantId: string; runId?: string | null; nodeId: string; kind: string; result: unknown },
): Promise<void> {
  await (supabase.from("workflow_step_effects" as any) as any)
    .upsert({
      key: input.key,
      tenant_id: input.tenantId,
      run_id: input.runId ?? null,
      node_id: input.nodeId,
      kind: input.kind,
      result: truncateForStorage(input.result ?? null, 16 * 1024),
    }, { onConflict: "key", ignoreDuplicates: true })
    .then(() => undefined, () => undefined)
}

/** The workflow's policy for interrupted non-idempotent steps (trigger step option `interrupted_steps`). */
export function interruptedStepPolicy(nodes: Array<{ type: string; config?: Record<string, any> }>, triggerTypes: readonly string[]): InterruptedStepPolicy {
  const trigger = nodes.find((n) => triggerTypes.includes(n.type) || n.type.startsWith("ext."))
  return trigger?.config?.interrupted_steps === "retry" ? "retry" : "fail"
}
