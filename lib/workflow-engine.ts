/**
 * Server-side workflow execution engine.
 * Traverses workflow nodes and executes actions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceDb } from "@/lib/providers/db";
import {
  resolveExpression as resolveExpr,
  type ExpressionContext,
} from "./expression-resolver";
import { decryptSensitiveFields } from "./secret-fields";
import { truncateForStorage } from "./truncate";
import { ensureTraceId } from "./trace";
import {
  handleMath,
  handleModifyString,
  handleTextTemplate,
  handleFormatDate,
  handleDateMath,
  handleRegex,
  handleCollectionCount,
  handleCollectionGet,
  handleCollectionFilter,
  handleCollectionSort,
  handleCollectionUnique,
  handleCollectionJoin,
  handleCondition,
  handleSwitchCase,
  calculateDelay,
  canonicalDelay,
  canonicalDataFilterOperator,
  callReferenceInputValue,
  handleJsonBuildObject,
  handleJsonBuildArray,
  handleJsonAddToArray,
  handleJsonGetValue,
} from "./workflow-node-handlers";
import {
  enqueueDataTableEventWorkflows,
  type TableLike as DataTableLike,
} from "./data-table-workflow-triggers";
import { evaluateDecisionTable } from "./decision-table-engine";
import { ActionRunError, executeStoredAction, loadStoredAction } from "./custom-actions/execute";
import { actionManifestOf, operationOf } from "./custom-actions/manifest";
import { evaluateOperator, normalizeOperator } from "./conditions";
import { normalizeTaskFieldValue, WORKFLOW_UPDATABLE_TASK_FIELDS } from "./task-fields";
import { resolveTaskDescriptionTemplate } from "./task-description";
import { htmlToPlainText } from "./html-sanitize";
import { loadTaskDataObject } from "./task-data";
import { USER_TASK_PER_STEP_VARIABLES } from "./workflow-system-variables";

/** `{{task.attachments}}`: the run task's Attachments tab files (service client, the run's tenant). */
function taskAttachmentsLoader(db: unknown) {
  return async (tenantId: string, taskId: string): Promise<unknown[]> => {
    const { listTaskAttachmentsForWorkflow } = await import("@/lib/services/task-attachments");
    return listTaskAttachmentsForWorkflow(db as never, tenantId, taskId);
  };
}
import { defaultTaskFieldValues, stepFieldValues } from "./task-field-schema";
import { compactLayoutForSave } from "./forms/layout";
import { resolveOptionSources, resolveRuntimeForm } from "./services/forms";
import { preResolveLookupConfig, preResolveLookupTemplate } from "./forms/lookup";
import { preResolveDataTableConfig } from "./forms/data-table";
import { resolveContextParams, substituteParams } from "./forms/form-params";
import { loadEmailTemplate } from "./email-templates";
import { RunNotResumableError } from "./workflow-run-errors";
import {
  INITIATOR_VARIABLES,
  initiatorFromRunVariables,
  initiatorVariables,
  stripInitiatorVariables,
  SYSTEM_INITIATOR,
  type RunInitiator,
} from "./workflow-initiator";
import { userVariableDefaults } from "./workflow-migration";
import {
  PARALLEL_STATE_KEY,
  compareWaits,
  computeParallelGraph,
  emptyParallelState,
  joinBlockers,
  joinReplayOrder,
  joinWaitingSummary,
  parallelBranchLabels,
  parallelDoneEdges,
  parallelStateIsActive,
  readParallelState,
  type FrameState,
  type LivePosition,
  type ParallelGraph,
  type ParallelState,
  type PathEntry,
  type WaitState,
  type WriteRecord,
} from "./workflow-parallel";
import { appUrlOrLocalhost, configuredAppUrl } from "@/lib/config/bootstrap";
import { fetchFile, fileSource, storeWorkflowFile, type StoredWorkflowFile } from "@/lib/storage/files";
import { dataTableIdOf } from "./workflow-table-refs";
import { esignEdgeMatches } from "./esign/catalog";
import { reportableRunVariables } from "./workflow-run-variables";
import { decideAcceptance, type QueueTaskFacts } from "./tasks/queue-rules";
import { decideAcceptanceForAssignees } from "./tasks/queue-rules-server";
import { setVariableAssignments, usesSetVariableAssignments } from "./workflow-set-variable";
import type { AadGroupPlanResult } from "./tasks/aad-group-runtime";

export { RunNotResumableError };

// ─── Constants ───
const TIMEOUTS = {
  DEFAULT: 15_000,
  STANDARD: 30_000,
  LARGE_FILE: 60_000,
} as const;
const TIME_MS = {
  MINUTE: 60_000,
  HOUR: 3_600_000,
  DAY: 86_400_000,
  WEEK: 604_800_000,
} as const;
const END_MARKER = "__END__:";
const PAUSE_MARKER = "__PAUSE__:";
/** event_id prefix of a timed pause (long delay / pause_until). */
const TIMED_PAUSE_PREFIX = "delay_";

const TRIGGER_TYPES = [
  "task_created",
  "task_received",
  "task_submitted",
  "task_updated",
  "task_completed",
  "task_rejected",
  "workflow_error",
  "workflow_sla",
  "retention_policy_review",
  "retention_policy_executed",
  "data_table_event",
  "form_submitted",
  "middleware_received",
  "schedule",
  "webhook_received",
  "esign_event",
  // Not in the node catalog: the start node API / MCP / import create for
  // workflow trigger_type "manual" (started by hand, the API or the CLI).
  "manual",
] as const;

function generateEventId(): string {
  return `evt_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function normalizeUserTaskOutcomeLabel(value: string | null | undefined) {
  const base = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "");
  return base.replace(
    /(ation|ition|ment|ance|ence|ality|ality|ing|ed|al|e|s)$/g,
    "",
  );
}

function userTaskOutcomeMatches(
  edgeLabel: string | null | undefined,
  outcome: string | null | undefined,
) {
  const edgeRaw = String(edgeLabel ?? "")
    .toLowerCase()
    .trim();
  const outcomeRaw = String(outcome ?? "")
    .toLowerCase()
    .trim();
  if (!edgeRaw || !outcomeRaw) return false;
  if (edgeRaw === outcomeRaw) return true;

  const edgeNorm = normalizeUserTaskOutcomeLabel(edgeLabel);
  const outcomeNorm = normalizeUserTaskOutcomeLabel(outcome);
  return Boolean(edgeNorm && outcomeNorm && edgeNorm === outcomeNorm);
}

class PauseError extends Error {
  eventId: string;
  nodeId: string;
  /** Timed pause (delay / pause_until): when the queued resume job runs. */
  resumeAt?: Date;
  /** Node output recorded while the run waits (timed pauses). */
  waitOutput?: Record<string, unknown>;
  /** Already in the run's open waits (see registerWait). */
  waitRegistered?: boolean;
  /** Test runs: the inline prompt event of the step (shown again when the run waits on it later). */
  prompt?: { node_label: string; data: Record<string, unknown> };
  constructor(
    eventId: string,
    nodeId: string,
    timed?: { resumeAt: Date; output: Record<string, unknown> },
  ) {
    super(`${PAUSE_MARKER}${eventId}`);
    this.eventId = eventId;
    this.nodeId = nodeId;
    this.resumeAt = timed?.resumeAt;
    this.waitOutput = timed?.output;
  }
}

/** Retries of a wait completion that raced a running resume (15 s apart, about an hour). */
export const DEFERRED_RETRY_SECONDS = 15;
export const DEFERRED_RETRY_ATTEMPTS = 240;

/** Run statuses a resume may claim. */
const RESUMABLE_RUN_STATUSES = ["waiting_for_event", "paused"];

/** Run columns resumeWorkflow needs (not the SLA/title columns). */
const RESUME_RUN_COLUMNS =
  "id, workflow_id, tenant_id, task_id, status, event_id, paused_at, paused_node_id, pause_variables, version_id, trace_id, node_results, execution_trace";

class EndWorkflowSignal extends Error {
  reason: string;
  response?: WorkflowHttpResponse;
  responseSummary?: WorkflowHttpResponseSummary | null;
  constructor(reason: string, response?: WorkflowHttpResponse) {
    super(`${END_MARKER}${reason}`);
    this.reason = reason;
    this.response = response;
    this.responseSummary = summarizeWorkflowResponse(response);
  }
}

function normalizeCustomActivityResult(raw: any) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (
      raw.outputs &&
      typeof raw.outputs === "object" &&
      !Array.isArray(raw.outputs)
    ) {
      return {
        outputs: raw.outputs as Record<string, any>,
        summary: raw.summary,
        metadata: raw.metadata,
        logs: Array.isArray(raw.logs) ? raw.logs : [],
      };
    }

    return {
      outputs: raw as Record<string, any>,
      summary: undefined,
      metadata: undefined,
      logs: [],
    };
  }

  return {
    outputs: { result: raw },
    summary: undefined,
    metadata: undefined,
    logs: [],
  };
}

type WorkflowResponseBodyType = "json" | "text" | "file";

export interface WorkflowHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  bodyType: WorkflowResponseBodyType;
  body: unknown;
}

type WorkflowHttpResponseSummary = {
  statusCode: number;
  bodyType: WorkflowResponseBodyType;
  headers: Record<string, string>;
  bodyPreview?: unknown;
  fileSize?: number;
};

interface WorkflowNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, any>;
  onError?: "stop" | "continue";
  executionMode?: "sync" | "async";
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export type NodeEvent = {
  type: "node_start" | "node_complete" | "node_error" | "log" | "done";
  node_id?: string;
  node_label?: string;
  data?: Record<string, any>; // event payload — intentionally flexible
};

interface LogEntry {
  node_id?: string;
  node_type?: string;
  node_label?: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
  duration_ms?: number;
  /** false: returned/streamed but not written to workflow_logs (already stored elsewhere). */
  persist?: false;
}

interface NodeResult {
  status: string;
  output?: Record<string, unknown>;
  error?: string;
  duration_ms: number;
}

interface LiveBinding {
  referenceId: string;
  inputMappings: Record<string, string>;
  outputPaths: Record<string, string>; // output name → dot path in response
  configSnapshot: Record<string, any>; // full config for executeReferenceCall
}

interface ExecutionContext {
  supabase: SupabaseClient;
  tenantId: string;
  /** The workflow being run (not the user-editable {{workflow_id}} variable). */
  workflowId?: string;
  runId?: string;
  /** workflow_runs.trace_id — propagated to agent runs and integration calls. */
  traceId?: string;
  taskId?: string;
  task?: Record<string, any>; // dynamic task fields from DB
  variables: Record<string, any>; // dynamic workflow variables
  liveBindings: Record<string, LiveBinding>; // keyed by binding name
  _liveCache?: Record<string, any>; // per-node cache, cleared after each node
  /** Per-run lookup caches (see getRunCache). */
  cache?: RunCache;
  /** > 0 while executing a loop body (loop state can't survive a pause). */
  loopDepth?: number;
  /** The loops running now, outermost first: their current item / index (nested loops read the outer one as parent_item / parent_index). */
  loopFrames?: Array<{ item: unknown; index: number }>;
  nodeResults: Record<string, NodeResult>;
  executedNodes: Set<string>;
  executionTrace: Array<Record<string, unknown>>;
  logs: LogEntry[];
  onEvent?: (event: NodeEvent) => void;
  isTest?: boolean;
  /**
   * A designer test run with "Use form drafts": User Task steps linking a
   * reusable form use its working draft (lib/services/form-design-drafts)
   * instead of the published version. Test runs only; set by the Test
   * runner route (forms.edit), kept across a resume in the engine-owned
   * `_test_form_drafts` variable.
   */
  testFormDrafts?: boolean;
  nodeMap?: Map<string, WorkflowNode>;
  edgesBySource?: Map<string, WorkflowEdge[]>;
  metrics?: {
    startedAt: number;
    nodeVisits: number;
    edgeTraversals: number;
  };
  /** Parallel join tracking (shared by every branch of the run). */
  parallel?: ParallelRuntime;
}

function traceNodeVisit(
  ctx: ExecutionContext,
  node: WorkflowNode,
  phase: "enter" | "wait" | "error" | "resume",
) {
  if (phase === "enter" || phase === "resume") {
    ctx.metrics ??= { startedAt: Date.now(), nodeVisits: 0, edgeTraversals: 0 };
    ctx.metrics.nodeVisits += 1;
  }
  ctx.executionTrace.push({
    type: "node",
    phase,
    node_id: node.id,
    node_type: node.type,
    node_label: node.label,
    at: new Date().toISOString(),
  });
}

function traceEdgeTraversal(
  ctx: ExecutionContext,
  edge: WorkflowEdge,
  sourceNode?: WorkflowNode | null,
  targetNode?: WorkflowNode | null,
  reason?: string,
) {
  ctx.metrics ??= { startedAt: Date.now(), nodeVisits: 0, edgeTraversals: 0 };
  ctx.metrics.edgeTraversals += 1;
  ctx.executionTrace.push({
    type: "edge",
    edge_id: edge.id,
    source: edge.source,
    target: edge.target,
    source_label: sourceNode?.label ?? null,
    target_label: targetNode?.label ?? null,
    label: edge.label ?? null,
    reason: reason ?? null,
    at: new Date().toISOString(),
  });
}

function buildNodeMap(nodes: WorkflowNode[]) {
  return new Map(nodes.map((node) => [node.id, node]));
}

function buildEdgesBySource(edges: WorkflowEdge[]) {
  const index = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const existing = index.get(edge.source);
    if (existing) existing.push(edge);
    else index.set(edge.source, [edge]);
  }
  return index;
}

function getNodeById(
  ctx: ExecutionContext,
  allNodes: WorkflowNode[],
  nodeId: string,
) {
  if (!ctx.nodeMap) ctx.nodeMap = buildNodeMap(allNodes);
  return ctx.nodeMap.get(nodeId);
}

function getOutgoingEdges(
  ctx: ExecutionContext,
  allEdges: WorkflowEdge[],
  sourceId: string,
) {
  if (!ctx.edgesBySource) ctx.edgesBySource = buildEdgesBySource(allEdges);
  return ctx.edgesBySource.get(sourceId) ?? [];
}

// ─── Per-run caches ───
// Lookups that a run repeats (a decision table or reference inside a loop, a
// data table's columns on every insert) are read once per run. Entries are
// promises so parallel branches share one request; a failed lookup is evicted
// so the next attempt retries. The engine invalidates an entry when it writes
// that row itself (auto-created data table columns).
type CachedRow = Record<string, unknown>;
interface TableColumn {
  key: string;
  label: string;
  type?: string;
}
interface RunCache {
  decisionTables: Map<string, Promise<CachedRow>>;
  /** integration_references row + integration, credentials decrypted. */
  references: Map<string, Promise<CachedRow>>;
  tableColumns: Map<string, Promise<TableColumn[]>>;
  /** custom_tables rows for data_table_event trigger payloads. */
  triggerTables: Map<string, Promise<DataTableLike | null>>;
  roles: Map<string, Promise<CachedRow>>;
  /** Live-binding names referenced by each node's config (scan once per run). */
  liveBindingNames: Map<string, string[]>;
}

function getRunCache(ctx: ExecutionContext): RunCache {
  return (ctx.cache ??= {
    decisionTables: new Map(),
    references: new Map(),
    tableColumns: new Map(),
    triggerTables: new Map(),
    roles: new Map(),
    liveBindingNames: new Map(),
  });
}

function cachedLookup<T>(
  map: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  let entry = map.get(key);
  if (!entry) {
    entry = load();
    map.set(key, entry);
    entry.catch(() => {
      if (map.get(key) === entry) map.delete(key);
    });
  }
  return entry;
}

/** Reference + integration (credentials decrypted at the read boundary), cached per run. */
function loadReference(ctx: ExecutionContext, refId: string): Promise<CachedRow> {
  return cachedLookup(getRunCache(ctx).references, refId, async () => {
    const { data: ref } = await ctx.supabase
      .from("integration_references")
      .select("*, integration:integrations(*)")
      .eq("id", refId)
      .single();
    if (!ref) throw new Error("Reference not found");
    const integration = ref.integration as { config?: unknown } | null;
    if (integration?.config)
      integration.config = decryptSensitiveFields(integration.config);
    return ref;
  });
}

/** Data table column definitions, cached per run. */
function loadTableColumns(
  ctx: ExecutionContext,
  tableId: string,
): Promise<TableColumn[]> {
  return cachedLookup(getRunCache(ctx).tableColumns, tableId, async () => {
    const { data: table, error } = await ctx.supabase
      .from("custom_tables")
      .select("columns")
      .eq("id", tableId)
      .single();
    // A failed read is not cached (evicted on rejection); callers fall back to [].
    if (error) throw new Error(error.message);
    return (table?.columns ?? []) as TableColumn[];
  });
}

// ─── Persisted-size caps ───
// Node outputs stay complete in memory (downstream nodes read them); only the
// copies written to workflow_runs / workflow_logs are capped.
function envLimit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const ENGINE_LIMITS = {
  /** Max serialized size of one node's output in workflow_runs.node_results. */
  get nodeResultMaxBytes() {
    return envLimit("WORKFLOW_NODE_RESULT_MAX_BYTES", 32 * 1024);
  },
  /** Max execution_trace entries per run (head + marker + tail kept). */
  get traceMaxEntries() {
    return envLimit("WORKFLOW_TRACE_MAX_ENTRIES", 5_000);
  },
  /** Max workflow_logs rows per run (head + marker + tail kept). */
  get logMaxEntries() {
    return envLimit("WORKFLOW_LOG_MAX_ENTRIES", 5_000);
  },
  /** Delays up to this long wait inline; longer ones pause the run. */
  inlineDelayMaxMs: TIMEOUTS.STANDARD,
};

/** node_results with each oversized output replaced by a `_truncated` preview. */
function nodeResultsForStorage(
  nodeResults: Record<string, NodeResult>,
): Record<string, NodeResult> {
  const max = ENGINE_LIMITS.nodeResultMaxBytes;
  let out: Record<string, NodeResult> | null = null;
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    if (result?.output == null) continue;
    const capped = truncateForStorage(result.output, max);
    if (capped === result.output) continue;
    out ??= { ...nodeResults };
    out[nodeId] = { ...result, output: capped as Record<string, unknown> };
  }
  return out ?? nodeResults;
}

/**
 * Keep the first and last entries of an over-long list with one marker in
 * between. Markers carry `dropped` so repeated compaction keeps the total.
 */
function capEntries<T>(
  entries: T[],
  max: number,
  makeMarker: (dropped: number) => T,
  droppedIn: (entry: T) => number,
): T[] {
  if (entries.length <= max) return entries;
  const tailCount = Math.min(100, Math.floor(max / 10));
  const headCount = Math.max(0, max - tailCount - 1);
  const middle = entries.slice(headCount, entries.length - tailCount);
  const dropped = middle.reduce((sum, entry) => sum + droppedIn(entry), 0);
  return [
    ...entries.slice(0, headCount),
    makeMarker(dropped),
    ...entries.slice(entries.length - tailCount),
  ];
}

function capTrace(trace: Array<Record<string, unknown>>, max: number) {
  return capEntries(
    trace,
    max,
    (dropped) => ({
      type: "truncated",
      dropped,
      message: `${dropped} trace entries dropped (limit ${max} per run)`,
      at: new Date().toISOString(),
    }),
    (entry) => (entry.type === "truncated" ? Number(entry.dropped) || 0 : 1),
  );
}

function capLogs(logs: LogEntry[], max: number) {
  return capEntries<LogEntry>(
    logs,
    max,
    (dropped) => ({
      level: "warn",
      message: `${dropped} log entries dropped (limit ${max} per run)`,
      metadata: { _truncated: true, dropped },
    }),
    (entry) =>
      entry.metadata?._truncated === true
        ? Number(entry.metadata.dropped) || 0
        : 1,
  );
}

/** Keep in-memory trace/logs bounded on very long runs (checked once per node). */
function boundRunMemory(ctx: ExecutionContext) {
  const traceMax = ENGINE_LIMITS.traceMaxEntries;
  // In place: parallel branches share these arrays through their own contexts.
  if (ctx.executionTrace.length > traceMax * 2)
    replaceContents(ctx.executionTrace, capTrace(ctx.executionTrace, traceMax));
  const logMax = ENGINE_LIMITS.logMaxEntries;
  if (ctx.logs.length > logMax * 2) replaceContents(ctx.logs, capLogs(ctx.logs, logMax));
}

function replaceContents<T>(target: T[], next: T[]) {
  target.length = 0;
  for (const item of next) target.push(item);
}

/** Persisted (capped) copies of the run's node results and trace. */
function runStateForStorage(ctx: ExecutionContext) {
  return {
    node_results: nodeResultsForStorage(ctx.nodeResults),
    execution_trace: capTrace(ctx.executionTrace, ENGINE_LIMITS.traceMaxEntries),
    // Reportable copy of the variables (bounded, redacted) — workflow
    // variable columns in reports (lib/workflow-run-variables.ts).
    variables: reportableRunVariables(ctx.variables),
  };
}

/**
 * workflows.run_count/last_run_at: atomic increment via record_workflow_run
 * (migration 20261025000000); falls back to the old read-modify-write when the
 * function is not deployed yet.
 */
async function recordWorkflowRun(
  supabase: SupabaseClient,
  workflowId: string,
  knownRunCount: number | null | undefined,
) {
  const { error } = await supabase.rpc("record_workflow_run", {
    p_workflow_id: workflowId,
  });
  if (!error) return;
  await supabase
    .from("workflows")
    .update({
      last_run_at: new Date().toISOString(),
      run_count: (knownRunCount ?? 0) + 1,
    })
    .eq("id", workflowId);
}

async function updateWorkflowRunCompat(
  supabase: SupabaseClient,
  runId: string,
  updates: Record<string, unknown>,
) {
  const optionalColumns = [
    "execution_trace",
    "variables",
    "sla_label",
    "sla_due_at",
    "sla_warning_at",
    "sla_status",
    "sla_warning_triggered_at",
    "sla_breached_triggered_at",
    "sla_last_evaluated_at",
    "sla_metadata",
  ];
  const globals = globalThis as typeof globalThis & {
    __workflowRunCompatWarnings?: Set<string>;
    __workflowRunCompatUnsupportedColumns?: Set<string>;
  };
  const warnedColumns =
    globals.__workflowRunCompatWarnings ??
    (globals.__workflowRunCompatWarnings = new Set<string>());
  const unsupportedColumns =
    globals.__workflowRunCompatUnsupportedColumns ??
    (globals.__workflowRunCompatUnsupportedColumns = new Set<string>());
  let nextUpdates = Object.fromEntries(
    Object.entries(updates).filter(([key]) => !unsupportedColumns.has(key)),
  );

  while (true) {
    const { error } = await supabase
      .from("workflow_runs")
      .update(nextUpdates as any)
      .eq("id", runId);

    if (!error) return;

    const missingOptionalColumn = optionalColumns.find(
      (column) =>
        error.message?.includes(
          `column workflow_runs.${column} does not exist`,
        ) || error.message?.includes(`Could not find the '${column}' column`),
    );

    if (missingOptionalColumn && missingOptionalColumn in nextUpdates) {
      unsupportedColumns.add(missingOptionalColumn);
      if (!warnedColumns.has(missingOptionalColumn)) {
        warnedColumns.add(missingOptionalColumn);
        console.warn(
          `[workflow-engine] workflow_runs is missing optional column "${missingOptionalColumn}". ` +
            `Continuing without it until migrations are applied.`,
        );
      }
      delete nextUpdates[missingOptionalColumn];
      continue;
    }

    throw new Error(`Failed to update workflow run ${runId}: ${error.message}`);
  }
}

/**
 * Insert one row and return its id, leaving out `optional` columns the
 * database does not have yet (code deployed before its migration, e.g.
 * 20261217000000_home_dashboard's workflow_runs.started_by and
 * tasks.workflow_run_id). Missing columns are remembered per process.
 */
const missingInsertColumns = new Set<string>();
export async function insertWithOptionalColumns(
  supabase: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
  optional: readonly string[],
): Promise<{ data: { id: string } | null; error: { message: string; code?: string } | null }> {
  let next = Object.fromEntries(Object.entries(row).filter(([key]) => !missingInsertColumns.has(`${table}.${key}`)));
  for (;;) {
    const { data, error } = await (supabase.from(table as any) as any).insert(next).select("id").single();
    if (!error) return { data: data as { id: string }, error: null };
    const missing = optional.find((column) => column in next && (
      error.message?.includes(`column ${table}.${column} does not exist`) ||
      error.message?.includes(`column "${column}" of relation "${table}" does not exist`) ||
      error.message?.includes(`Could not find the '${column}' column`)));
    if (!missing) return { data: null, error };
    missingInsertColumns.add(`${table}.${missing}`);
    const { [missing]: _dropped, ...rest } = next;
    next = rest;
  }
}

/**
 * The run's Home columns (migration 20261217000000): the person who started
 * it and the form submission behind it. Designer test runs and system starts
 * have no person; the submission link is only trusted for form starts.
 */
export function runOriginColumns(
  initiator: RunInitiator | null | undefined,
  startVariables: Record<string, unknown> | null | undefined,
  test: boolean,
): { started_by: string | null; started_via: string | null; form_submission_id: string | null } {
  if (test) return { started_by: null, started_via: "test", form_submission_id: null };
  const via = initiator?.via ?? "system";
  const userId = typeof initiator?.userId === "string" && initiator.userId.trim() ? initiator.userId.trim() : null;
  const submission = typeof startVariables?.form_submission_id === "string" ? startVariables.form_submission_id.trim() : "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    started_by: userId && uuid.test(userId) ? userId : null,
    started_via: via,
    form_submission_id: (via === "form" || via === "anonymous") && uuid.test(submission) ? submission : null,
  };
}

/**
 * The workflow's owner (creator) for the steps that act with its authority —
 * agents' acting user, governance / retention actors. Runs paused before
 * workflow_owner_id existed kept the owner in workflow_started_by.
 */
function workflowOwnerId(ctx: ExecutionContext): string | undefined {
  const owner = ctx.variables.workflow_owner_id;
  if (typeof owner === "string") return owner;
  const legacy = ctx.variables.workflow_started_by;
  return typeof legacy === "string" ? legacy : undefined;
}

function createEngineClient(): SupabaseClient {
  return getServiceDb({ anonFallback: true });
}

/**
 * Fire workflow_error triggers when a workflow fails.
 * Won't trigger recursively (skips if the failed workflow is itself a workflow_error type).
 */
async function fireWorkflowErrorTriggers(
  supabase: SupabaseClient,
  failedWorkflowId: string,
  failedWorkflowName: string,
  tenantId: string,
  runId: string | undefined,
  errorMessage: string,
  failedNodeLabel?: string,
) {
  try {
    // Don't trigger error workflows from error workflows (prevent infinite loop)
    const { data: failedWf } = await supabase
      .from("workflows")
      .select("trigger_type")
      .eq("id", failedWorkflowId)
      .single();
    if (failedWf?.trigger_type === "workflow_error") return;

    const { data: errorWorkflows } = await supabase
      .from("workflows")
      .select("id, nodes, trigger_config, published_version_id")
      .eq("tenant_id", tenantId)
      .eq("trigger_type", "workflow_error")
      .eq("is_active", true);
    if (!errorWorkflows?.length) return;

    const errorData = {
      error_workflow_id: failedWorkflowId,
      error_workflow_name: failedWorkflowName,
      error_run_id: runId ?? null,
      error_message: errorMessage,
      error_node: failedNodeLabel ?? null,
      error_timestamp: new Date().toISOString(),
    };

    const matchesWorkflowErrorScope = async (workflow: {
      id: string;
      nodes?: any;
      trigger_config?: any;
      published_version_id?: string | null;
    }) => {
      let triggerNodeConfig: Record<string, any> = {};

      if (workflow.published_version_id) {
        const { data: version } = await supabase
          .from("workflow_versions" as any)
          .select("nodes, trigger_config")
          .eq("id", workflow.published_version_id)
          .maybeSingle();
        const versionNodes = Array.isArray((version as any)?.nodes)
          ? ((version as any).nodes as any[])
          : [];
        triggerNodeConfig = (versionNodes.find(
          (node) => node?.type === "workflow_error",
        )?.config ??
          (version as any)?.trigger_config ??
          {}) as Record<string, any>;
      } else {
        const workflowNodes = Array.isArray(workflow.nodes)
          ? (workflow.nodes as any[])
          : [];
        triggerNodeConfig = (workflowNodes.find(
          (node) => node?.type === "workflow_error",
        )?.config ??
          workflow.trigger_config ??
          {}) as Record<string, any>;
      }

      const selectedWorkflowIds = Array.isArray(triggerNodeConfig.workflow_ids)
        ? triggerNodeConfig.workflow_ids.filter(Boolean)
        : triggerNodeConfig.workflow_id
          ? [triggerNodeConfig.workflow_id]
          : [];
      const scope =
        triggerNodeConfig.error_scope === "specific" ? "specific" : "all";
      if (scope !== "specific") return true;
      return selectedWorkflowIds.includes(failedWorkflowId);
    };

    // Scope checks (one version read each) run in parallel.
    const matches = await Promise.all(
      errorWorkflows.map((wf) =>
        matchesWorkflowErrorScope(wf).catch(() => false),
      ),
    );
    errorWorkflows.forEach((wf, i) => {
      if (!matches[i]) return;
      executeWorkflow(wf.id, undefined, false, errorData, undefined, undefined, undefined, {
        supabase,
        initiator: { userId: null, via: "event" },
      }).catch(() => {
        // Silently ignore — don't let error workflow failures cascade
      });
    });
  } catch {
    // Silently ignore — error trigger failures must not affect the original workflow
  }
}

// Columns executeWorkflow reads (the draft nodes/edges are added only when needed).
const WORKFLOW_RUN_COLUMNS =
  "id, name, tenant_id, trigger_type, run_count, published_version_id, user_variables, created_by" as const;
const WORKFLOW_RUN_COLUMNS_WITH_DRAFT =
  "id, name, tenant_id, trigger_type, run_count, published_version_id, user_variables, created_by, nodes, edges" as const;
const VERSION_RUN_COLUMNS = "id, nodes, edges, user_variables";

export async function executeWorkflow(
  workflowId: string,
  taskId?: string,
  test: boolean = false,
  initialVariables?: Record<string, any>,
  onEvent?: (event: NodeEvent) => void,
  pinnedVersionId?: string,
  /** Inbound trace id (e.g. workflow_queue.trace_id); a fresh one is minted when absent. */
  inboundTraceId?: string | null,
  /**
   * supabase: reuse the caller's client (sub-workflows, error triggers, queue
   * worker). initiator: who started the run (lib/workflow-initiator) — sets
   * workflow_started_by / workflow_started_via; none means a system start
   * (the owner). Callers' variables never set those.
   */
  options?: { supabase?: SupabaseClient; initiator?: RunInitiator; testFormDrafts?: boolean },
): Promise<{
  status: string;
  node_results: Record<string, any>;
  error?: string;
  reason?: string;
  logs?: any[];
  run_id?: string;
  event_id?: string;
  paused_node_id?: string;
  response?: WorkflowHttpResponse;
}> {
  const supabase = options?.supabase ?? createEngineClient();
  const startVariables = stripInitiatorVariables(initialVariables);
  // Engine-owned: only the Test runner's option sets it (never a caller's variables).
  delete startVariables._test_form_drafts;
  const testFormDrafts = Boolean(test && options?.testFormDrafts);

  // Fetch workflow, and the pinned published version in parallel when available.
  // The draft definition (nodes/edges) is only needed when no version will be used.
  const usePinnedVersion = !test && !!pinnedVersionId;
  const workflowPromise = usePinnedVersion
    ? supabase.from("workflows").select(WORKFLOW_RUN_COLUMNS).eq("id", workflowId).single()
    : supabase.from("workflows").select(WORKFLOW_RUN_COLUMNS_WITH_DRAFT).eq("id", workflowId).single();

  const versionPromise = usePinnedVersion
    ? supabase
        .from("workflow_versions" as any)
        .select(VERSION_RUN_COLUMNS)
        .eq("id", pinnedVersionId)
        .single()
    : Promise.resolve({ data: null });

  const [{ data: workflow }, pinnedVersionResult] = await Promise.all([
    workflowPromise,
    versionPromise,
  ]);

  if (!workflow) throw new Error("Workflow not found");

  // Use published version if available (unless testing, which uses draft)
  let nodes: WorkflowNode[];
  let edges: WorkflowEdge[];
  let versionId: string | undefined;
  let versionUserVars: any[] | undefined;
  // Use pinned version (from queue), or current published version
  const resolvedVersionId =
    pinnedVersionId ?? (workflow as any).published_version_id;

  if (!test && resolvedVersionId) {
    const version =
      resolvedVersionId === pinnedVersionId
        ? pinnedVersionResult.data
        : (
            await supabase
              .from("workflow_versions" as any)
              .select(VERSION_RUN_COLUMNS)
              .eq("id", resolvedVersionId)
              .single()
          ).data;

    if (version) {
      nodes = (version as any).nodes as any;
      edges = (version as any).edges as any;
      versionId = (version as any).id;
      versionUserVars = (version as any).user_variables as any[];
    } else {
      throw new Error(
        `Published version ${resolvedVersionId} not found — workflow may be corrupted. Re-publish or unpublish.`,
      );
    }
  } else {
    nodes = ((workflow as any).nodes ?? []) as any;
    edges = ((workflow as any).edges ?? []) as any;
  }

  if (nodes.length === 0) {
    return { status: "completed", node_results: {} };
  }

  // Canonical task data object: full row + data (template values) +
  // responses/timeline/computed fields — everything designers can bind as
  // {{task.*}}. Superset of the raw row, so existing references are unchanged.
  const taskPromise = taskId
    ? // Only a task of the workflow's tenant (service-role client).
      loadTaskDataObject(supabase, taskId, { includeTimeline: true, tenantId: workflow.tenant_id, attachments: taskAttachmentsLoader(supabase) }).then(
        (t) => t ?? undefined,
      )
    : Promise.resolve(undefined);

  const traceId = ensureTraceId(inboundTraceId);
  const runPromise = insertWithOptionalColumns(supabase, "workflow_runs", {
    workflow_id: workflowId,
    tenant_id: workflow.tenant_id,
    task_id: taskId ?? null,
    status: "running",
    version_id: versionId ?? null,
    trace_id: traceId,
    // Home: who started it (auto-follow) and the submission behind it.
    ...runOriginColumns(options?.initiator, startVariables, test),
  }, ["started_by", "started_via", "form_submission_id"])
    .then(({ data }) => data?.id as string | undefined);

  // Load user-defined variable defaults from the published version (or draft if testing)
  const userVarDefaults = userVariableDefaults(
    (versionUserVars ?? (workflow as any).user_variables) as
      | { name: string; type: string; defaultValue: string }[]
      | undefined,
  ) as Record<string, any>;

  const [task, runId] = await Promise.all([taskPromise, runPromise]);
  // Run stats count every real run when it starts — waiting, failed and
  // still-running runs included (they used to count only on success, so the
  // count looked stuck while runs waited on tasks). Test runs never count.
  if (runId && !test) await recordWorkflowRun(supabase, workflowId, workflow.run_count);
  // Files uploaded with a start form now belong to this run.
  if (runId && startVariables && !test) {
    const { bindStartRunFiles } = await import("@/lib/services/form-files");
    await bindStartRunFiles(supabase, workflow.tenant_id, workflowId, runId, startVariables);
  }

  const ctx: ExecutionContext = {
    supabase,
    tenantId: workflow.tenant_id,
    workflowId,
    taskId,
    task,
    runId,
    traceId,
    variables: {
      ...userVarDefaults,
      ...startVariables,
      task_id: taskId ?? "",
      tenant_id: workflow.tenant_id,
      workflow_started_at: new Date().toISOString(),
      // Who started the run (the owner when no person did) and the creator.
      ...initiatorVariables(options?.initiator ?? SYSTEM_INITIATOR, (workflow as any).created_by),
      workflow_id: workflowId,
      workflow_name: workflow.name ?? "",
      trigger_type: workflow.trigger_type,
      _trigger_type: workflow.trigger_type,
      // Names of the run's inputs (user variables + start variables), so a
      // data-table get never overwrites them with same-named columns.
      _workflow_inputs: Object.keys({ ...userVarDefaults, ...startVariables }).filter(
        (key) => !key.startsWith("_"),
      ),
      ...(testFormDrafts ? { _test_form_drafts: true } : {}),
    },
    liveBindings: {},
    nodeResults: {},
    executedNodes: new Set(),
    executionTrace: [],
    logs: [],
    onEvent,
    isTest: test,
    testFormDrafts,
    metrics: {
      startedAt: Date.now(),
      nodeVisits: 0,
      edgeTraversals: 0,
    },
  };

  ctx.logs.push({
    level: "info",
    message: `Workflow started: ${workflow.name}`,
    metadata: { trigger: workflow.trigger_type, task_id: taskId ?? null },
  });


  try {
    // Find start nodes — only trigger nodes should start execution
    // Non-trigger nodes without incoming edges are orphans and should NOT execute
    const targetIds = new Set(edges.map((e) => e.target));
    const startNodes = nodes.filter(
      (n) =>
        !targetIds.has(n.id) &&
        (TRIGGER_TYPES as readonly string[]).includes(n.type),
    );

    if (startNodes.length === 0 && nodes.length > 0) {
      // No trigger nodes found — fall back to first node with no incoming edge
      const firstOrphan = nodes.find((n) => !targetIds.has(n.id));
      if (firstOrphan) startNodes.push(firstOrphan);
    }

    // Check trigger filters before executing
    for (const startNode of startNodes) {
      if (!passesTriggerFilters(startNode, ctx)) {
        return {
          status: "skipped",
          node_results: {},
          reason: "Trigger filters not met",
        };
      }
    }

    // Execute from start nodes
    for (const startNode of startNodes) {
      await executeNode(startNode, nodes, edges, ctx);
    }
    if (ctx.parallel) await drainRootDone(ctx.parallel);
    // Waits left open inside Parallel branches pause the run.
    const parallelPause = nextParallelPause(ctx.parallel);
    if (parallelPause) throw parallelPause;

    const doneLog = {
      level: "info",
      message: `Workflow completed — ${Object.keys(ctx.nodeResults).length} nodes executed`,
      metadata: {
        total_nodes_executed: Object.keys(ctx.nodeResults).length,
        total_node_visits: ctx.metrics?.nodeVisits ?? 0,
        total_edge_traversals: ctx.metrics?.edgeTraversals ?? 0,
        total_runtime_ms: Date.now() - (ctx.metrics?.startedAt ?? Date.now()),
      },
    };
    ctx.logs.push(doneLog);
    ctx.onEvent?.({ type: "log", data: doneLog });

    await finishRun(supabase, ctx, workflowId, runId, {
      countRun: !test,
      runCount: workflow.run_count,
    });
    ctx.onEvent?.({ type: "done", data: { status: "completed" } });

    return {
      status: "completed",
      node_results: ctx.nodeResults,
      logs: ctx.logs,
      run_id: runId,
    };
  } catch (error: unknown) {
    // Handle pause for server events / user tasks / timed delays
    if (error instanceof PauseError) {
      registerWait(parallelRuntime(ctx, nodes, edges), error, []);
      reemitWaitPrompt(ctx, error);
      const scheduleError = await persistPause(
        supabase,
        ctx,
        workflowId,
        runId,
        error,
      );
      if (scheduleError) {
        await flushLogs(supabase, ctx, workflowId, runId);
        return {
          status: "failed",
          node_results: ctx.nodeResults,
          error: scheduleError,
          logs: ctx.logs,
          run_id: runId,
        };
      }
      ctx.onEvent?.({
        type: "done",
        data: {
          status: "waiting_for_event",
          event_id: error.eventId,
          paused_node_id: error.nodeId,
          ...(error.resumeAt ? { resume_at: error.resumeAt.toISOString() } : {}),
        },
      });
      await flushLogs(supabase, ctx, workflowId, runId);
      return {
        status: "waiting_for_event",
        node_results: ctx.nodeResults,
        event_id: error.eventId,
        paused_node_id: error.nodeId,
        logs: ctx.logs,
        run_id: runId,
      };
    }

    if (error instanceof EndWorkflowSignal) {
      const reason = error.reason;
      const endLog = {
        level: "info",
        message: `Workflow ended: ${reason}`,
        metadata: error.responseSummary
          ? { response: error.responseSummary }
          : undefined,
      };
      ctx.logs.push(endLog);
      ctx.onEvent?.({ type: "log", data: endLog });
      await finishRun(supabase, ctx, workflowId, runId, {
        countRun: !test,
        runCount: workflow.run_count,
      });
      ctx.onEvent?.({
        type: "done",
        data: { status: "completed", reason, response: error.responseSummary },
      });
      return {
        status: "completed",
        node_results: ctx.nodeResults,
        reason,
        logs: ctx.logs,
        run_id: runId,
        response: error.response,
      };
    }

    const errMsg = toErrorMessage(error);

    // Handle intentional end_workflow
    if (errMsg.startsWith(END_MARKER)) {
      const reason = errMsg.slice(END_MARKER.length);
      const endLog = { level: "info", message: `Workflow ended: ${reason}` };
      ctx.logs.push(endLog);
      ctx.onEvent?.({ type: "log", data: endLog });
      await finishRun(supabase, ctx, workflowId, runId, {
        countRun: !test,
        runCount: workflow.run_count,
      });
      ctx.onEvent?.({ type: "done", data: { status: "completed", reason } });
      return {
        status: "completed",
        node_results: ctx.nodeResults,
        reason,
        logs: ctx.logs,
        run_id: runId,
      };
    }

    const failLog = { level: "error", message: `Workflow failed: ${errMsg}` };
    ctx.logs.push(failLog);
    ctx.onEvent?.({ type: "log", data: failLog });
    ctx.onEvent?.({ type: "done", data: { status: "failed", error: errMsg } });

    await finishRun(supabase, ctx, workflowId, runId, {
      countRun: false, // failed runs don't count towards run stats (unchanged)
      error: errMsg,
    });

    // Fire workflow_error triggers
    if (!test) {
      fireWorkflowErrorTriggers(
        supabase,
        workflowId,
        workflow.name,
        workflow.tenant_id,
        runId,
        errMsg,
        ctx.variables["last_error_node"] as string,
      );
    }

    return {
      status: "failed",
      node_results: ctx.nodeResults,
      error: errMsg,
      logs: ctx.logs,
      run_id: runId,
    };
  }
}

/**
 * Final writes of a finished run, concurrently: the run row (completed, or
 * failed with `error`), run stats (`countRun`) and the log batch.
 */
async function finishRun(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  workflowId: string,
  runId: string | undefined,
  opts: { countRun?: boolean; runCount?: number | null; error?: string },
) {
  // Joins that never ran (the run failed or ended first) are not steps of the run.
  clearJoinPlaceholders(ctx);
  await Promise.all([
    runId
      ? updateWorkflowRunCompat(supabase, runId, {
          status: opts.error === undefined ? "completed" : "failed",
          completed_at: new Date().toISOString(),
          ...runStateForStorage(ctx),
          ...(opts.error === undefined ? {} : { error: opts.error }),
        })
      : null,
    // run_count/last_run_at are recorded when the run starts (executeWorkflow).
    flushLogs(supabase, ctx, workflowId, runId),
  ]);
}

/**
 * Record a paused run (status waiting_for_event + the state needed to resume).
 * A timed pause (delay / pause_until longer than the inline limit) also
 * enqueues a `delay_resume` job on workflow_queue for the resume time; the
 * queue worker hands it to resumeTimedPause. Returns an error message when the
 * resume could not be scheduled (the run is then marked failed — a paused run
 * with no scheduled resume would wait forever).
 */
async function persistPause(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  workflowId: string,
  runId: string | undefined,
  error: PauseError,
  opts: { recordWaitingNode?: boolean; pausedAgain?: boolean } = {},
): Promise<string | null> {
  // Record the paused node as waiting so the process viewer shows it
  if (opts.recordWaitingNode !== false) {
    ctx.nodeResults[error.nodeId] = {
      status: "waiting",
      output: error.waitOutput ?? { event_id: error.eventId },
      duration_ms: 0,
    };
  }
  // Timed waits to schedule: this one and any other open wait of a Parallel
  // branch (each resumes from its own delay_resume job; one the run is not
  // waiting on when it fires is kept for later — see recordDeferredWaitCompletion).
  const timed: Array<{ eventId: string; resumeAt: Date }> = [];
  const waits = ctx.parallel?.state.waits ?? [];
  const activeWait = waits.find((w) => w.event_id === error.eventId);
  if (error.resumeAt && !activeWait?.scheduled)
    timed.push({ eventId: error.eventId, resumeAt: error.resumeAt });
  for (const w of waits) {
    if (w.resume_at && !w.scheduled && w.event_id !== error.eventId)
      timed.push({ eventId: w.event_id, resumeAt: new Date(w.resume_at) });
    if (w.resume_at) w.scheduled = true;
  }
  markJoinPlaceholders(ctx);
  if (runId) {
    await updateWorkflowRunCompat(supabase, runId, {
      status: "waiting_for_event",
      event_id: error.eventId,
      paused_at: new Date().toISOString(),
      paused_node_id: error.nodeId,
      pause_variables: pauseVariablesOf(ctx),
      ...runStateForStorage(ctx),
    });
  }

  for (const job of timed) {
    if (!runId) break;
    // enqueue_workflow schedules in whole seconds; round up so the run never
    // resumes early.
    const delaySeconds = Math.min(
      2_147_483_647,
      Math.max(1, Math.ceil((job.resumeAt.getTime() - Date.now()) / 1000)),
    );
    const { error: enqueueError } = await supabase.rpc("enqueue_workflow", {
      p_workflow_id: workflowId,
      p_tenant_id: ctx.tenantId,
      p_task_id: ctx.taskId ?? null,
      p_trigger_type: "delay_resume",
      p_trigger_data: {
        _resume_run_id: runId,
        _resume_event_id: job.eventId,
      },
      p_priority: 0,
      p_delay_seconds: delaySeconds,
    });
    if (enqueueError) {
      const message = `Could not schedule resume: ${enqueueError.message}`;
      const failLog: LogEntry = {
        level: "error",
        message: `Workflow failed: ${message}`,
      };
      ctx.logs.push(failLog);
      ctx.onEvent?.({ type: "log", data: failLog });
      ctx.onEvent?.({ type: "done", data: { status: "failed", error: message } });
      await updateWorkflowRunCompat(supabase, runId, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error: message,
        event_id: null,
        paused_at: null,
        paused_node_id: null,
        pause_variables: null,
      });
      return message;
    }
  }

  const pauseLog: LogEntry = error.resumeAt
    ? {
        level: "info",
        message: `Workflow paused — resumes at ${error.resumeAt.toISOString()}`,
        node_id: error.nodeId,
        metadata: { resume_at: error.resumeAt.toISOString(), event_id: error.eventId },
      }
    : {
        level: "info",
        message: opts.pausedAgain
          ? `Workflow paused again — waiting for event ${error.eventId}`
          : `Workflow paused — waiting for server event ${error.eventId}`,
      };
  ctx.logs.push(pauseLog);
  ctx.onEvent?.({ type: "log", data: pauseLog });
  return null;
}

/**
 * Queue entry point for a timed pause (`delay_resume` job): resumes the run
 * only if it is still waiting on that same pause — a run that was resumed,
 * cancelled or manually paused in the meantime is left alone.
 */
export async function resumeTimedPause(
  runId: string,
  eventId: string,
  /** The queue job's own workflow/tenant: the run must belong to both. */
  job: { workflowId: string; tenantId: string },
  options?: { supabase?: SupabaseClient; attempt?: number },
): Promise<{
  status: string;
  node_results: Record<string, unknown>;
  reason?: string;
  error?: string;
}> {
  const supabase = options?.supabase ?? createEngineClient();
  // trigger_data came through enqueue_workflow (service role only since
  // 20261118000000); as defence in depth only a timed-pause event of a run of the job's own workflow and tenant
  // can be resumed this way.
  const { data: run } = eventId.startsWith(TIMED_PAUSE_PREFIX)
    ? await supabase
        .from("workflow_runs")
        .select("id, status, event_id, workflow_id, tenant_id")
        .eq("id", runId)
        .eq("workflow_id", job.workflowId)
        .eq("tenant_id", job.tenantId)
        .maybeSingle()
    : { data: null };
  if (run && run.event_id !== eventId && (run.status === "waiting_for_event" || run.status === "running")) {
    // Another wait of a Parallel node is the one the run waits on: keep this
    // one's completion for when the run gets to it.
    const outcome = await recordDeferredWaitCompletion(
      supabase,
      { runId, eventId, workflowId: job.workflowId, tenantId: job.tenantId },
      {},
    );
    if (outcome === "stored") {
      return { status: "skipped", node_results: {}, reason: "Kept for when the run reaches this wait (another Parallel branch is waiting)" };
    }
    if (outcome === "busy" && (options?.attempt ?? 0) < DEFERRED_RETRY_ATTEMPTS) {
      await supabase.rpc("enqueue_workflow", {
        p_workflow_id: job.workflowId,
        p_tenant_id: job.tenantId,
        p_task_id: null,
        p_trigger_type: "delay_resume",
        p_trigger_data: { _resume_run_id: runId, _resume_event_id: eventId, _resume_attempt: (options?.attempt ?? 0) + 1 },
        p_priority: 0,
        p_delay_seconds: DEFERRED_RETRY_SECONDS,
      });
      return { status: "skipped", node_results: {}, reason: `Run is busy; retrying in ${DEFERRED_RETRY_SECONDS} s` };
    }
    if (outcome !== "active") {
      return { status: "skipped", node_results: {}, reason: `Run is ${run.status}, no longer waiting on this pause` };
    }
  } else if (!run || run.status !== "waiting_for_event" || run.event_id !== eventId) {
    return {
      status: "skipped",
      node_results: {},
      reason: run
        ? `Run is ${run.status}, no longer waiting on this pause`
        : "Run not found",
    };
  }
  try {
    return await resumeWorkflow(runId, {}, undefined, { supabase, eventId });
  } catch (error) {
    // Lost the claim to a concurrent resume of the same pause.
    if (error instanceof RunNotResumableError) {
      return { status: "skipped", node_results: {}, reason: error.message };
    }
    throw error;
  }
}

function hasHeader(headers: Record<string, string>, key: string): boolean {
  return Object.keys(headers).some(
    (existingKey) => existingKey.toLowerCase() === key.toLowerCase(),
  );
}

function setDefaultHeader(
  headers: Record<string, string>,
  key: string,
  value?: string,
) {
  if (!value || hasHeader(headers, key)) return;
  headers[key] = value;
}

function inferFileNameFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const candidate = pathname.split("/").pop();
    return candidate ? decodeURIComponent(candidate) : null;
  } catch {
    return null;
  }
}

function sanitizeResponsePreview(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string")
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return "[unserializable]";
  }
}

function summarizeWorkflowResponse(
  response?: WorkflowHttpResponse,
): WorkflowHttpResponseSummary | null {
  if (!response) return null;

  if (response.bodyType === "file") {
    const fileBody = response.body;
    const fileSize = Buffer.isBuffer(fileBody)
      ? fileBody.byteLength
      : fileBody instanceof Uint8Array
        ? fileBody.byteLength
        : fileBody instanceof ArrayBuffer
          ? fileBody.byteLength
          : undefined;

    return {
      statusCode: response.statusCode,
      bodyType: response.bodyType,
      headers: response.headers,
      fileSize,
    };
  }

  return {
    statusCode: response.statusCode,
    bodyType: response.bodyType,
    headers: response.headers,
    bodyPreview: sanitizeResponsePreview(response.body),
  };
}

function parseDataUrl(
  dataUrl: string,
): { buffer: Buffer; contentType: string } | null {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return null;

  const contentType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";

  try {
    const buffer = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf-8");
    return { buffer, contentType };
  } catch {
    return null;
  }
}

async function fetchFileResponse(url: string): Promise<{
  buffer: Buffer;
  contentType?: string;
  fileName?: string | null;
}> {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUTS.LARGE_FILE),
  });
  if (!resp.ok)
    throw new Error(`File response fetch failed: HTTP ${resp.status}`);

  const disposition = resp.headers.get("content-disposition");
  let fileName: string | null | undefined = null;
  if (disposition) {
    const match = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
    if (match) fileName = decodeURIComponent(match[1]);
  }

  return {
    buffer: Buffer.from(await resp.arrayBuffer()),
    contentType:
      resp.headers.get("content-type")?.split(";")[0].trim() || undefined,
    fileName: fileName ?? inferFileNameFromUrl(url),
  };
}

async function buildMiddlewareResponse(
  config: Record<string, any>,
  ctx: ExecutionContext,
  reason: string,
): Promise<WorkflowHttpResponse> {
  const statusCode =
    Number(resolveExpression(config.response_status_code ?? "200", ctx)) || 200;
  const headers: Record<string, string> = {};

  for (const header of (config.response_headers ?? []) as {
    key: string;
    value: string;
  }[]) {
    if (!header?.key?.trim()) continue;
    const value = resolveExpression(header.value, ctx);
    headers[header.key.trim()] = value == null ? "" : String(value);
  }

  const bodyMode = config.response_body_mode ?? "json";

  if (bodyMode === "text") {
    setDefaultHeader(headers, "Content-Type", "text/plain; charset=utf-8");
    return {
      statusCode,
      headers,
      bodyType: "text",
      body: String(resolveExpression(config.response_body, ctx) ?? reason),
    };
  }

  if (bodyMode === "json_variable") {
    setDefaultHeader(
      headers,
      "Content-Type",
      "application/json; charset=utf-8",
    );
    const jsonBody = resolveExpression(config.response_json_body, ctx);
    return {
      statusCode,
      headers,
      bodyType: "json",
      body:
        jsonBody === undefined || jsonBody === ""
          ? { ok: true, reason }
          : jsonBody,
    };
  }

  if (bodyMode === "file") {
    const fileSource = resolveExpression(config.response_file_source, ctx);
    if (fileSource == null || fileSource === "") {
      throw new Error("Middleware file response requires a file source");
    }

    let buffer: Buffer;
    let fileName =
      resolveExpression(config.response_file_name, ctx) ?? undefined;
    let contentType =
      resolveExpression(config.response_file_content_type, ctx) ?? undefined;

    if (Buffer.isBuffer(fileSource)) {
      buffer = fileSource;
    } else if (fileSource instanceof Uint8Array) {
      buffer = Buffer.from(fileSource);
    } else if (fileSource instanceof ArrayBuffer) {
      buffer = Buffer.from(fileSource);
    } else if (typeof fileSource === "string") {
      const trimmed = fileSource.trim();
      if (/^https?:\/\//i.test(trimmed)) {
        const fetched = await fetchFileResponse(trimmed);
        buffer = fetched.buffer;
        fileName ??= fetched.fileName ?? undefined;
        contentType ??= fetched.contentType;
      } else if (trimmed.startsWith("data:")) {
        const parsed = parseDataUrl(trimmed);
        if (!parsed)
          throw new Error(
            "Invalid data URL configured for middleware file response",
          );
        buffer = parsed.buffer;
        contentType ??= parsed.contentType;
      } else {
        buffer = Buffer.from(trimmed, "base64");
      }
    } else if (typeof fileSource === "object") {
      const sourceObj = fileSource as Record<string, any>;
      const sourceUrl = sourceObj.url ?? sourceObj.file_url;
      const sourceBase64 = sourceObj.base64 ?? sourceObj.data;

      fileName ??= sourceObj.name ?? sourceObj.file_name ?? undefined;
      contentType ??=
        sourceObj.content_type ??
        sourceObj.contentType ??
        sourceObj.mime_type ??
        undefined;

      if (typeof sourceUrl === "string" && sourceUrl) {
        const fetched = await fetchFileResponse(sourceUrl);
        buffer = fetched.buffer;
        fileName ??= fetched.fileName ?? undefined;
        contentType ??= fetched.contentType;
      } else if (typeof sourceBase64 === "string" && sourceBase64) {
        buffer = Buffer.from(sourceBase64, "base64");
      } else {
        throw new Error("Unsupported file object for middleware response");
      }
    } else {
      throw new Error("Unsupported file response source");
    }

    fileName = fileName ? String(fileName) : "download.bin";
    contentType = contentType
      ? String(contentType)
      : "application/octet-stream";

    const dispositionMode = resolveExpression(
      config.response_file_disposition ?? "attachment",
      ctx,
    );
    const dispositionType =
      dispositionMode === "inline" ? "inline" : "attachment";

    setDefaultHeader(headers, "Content-Type", contentType);
    setDefaultHeader(
      headers,
      "Content-Disposition",
      `${dispositionType}; filename="${String(fileName).replace(/"/g, "")}"`,
    );

    return {
      statusCode,
      headers,
      bodyType: "file",
      body: buffer,
    };
  }

  const mappings = (config.response_mappings ?? []) as {
    key: string;
    value: string;
  }[];
  const body =
    mappings.length > 0
      ? Object.fromEntries(
          mappings
            .filter((mapping) => mapping?.key?.trim())
            .map((mapping) => [
              mapping.key.trim(),
              resolveExpression(mapping.value, ctx),
            ]),
        )
      : { ok: true, reason };

  setDefaultHeader(headers, "Content-Type", "application/json; charset=utf-8");

  return {
    statusCode,
    headers,
    bodyType: "json",
    body,
  };
}

/**
 * Resume a paused workflow run after a server event callback.
 * Accepts either a run ID or an event ID to find the paused run.
 * Restores execution state, merges return variables, and continues from the paused node.
 */
export async function resumeWorkflow(
  runIdOrEventId: string,
  returnVariables: Record<string, any>,
  onEvent?: (event: NodeEvent) => void,
  options?: {
    supabase?: SupabaseClient;
    /** Only resume when the run is still waiting on this event id. */
    eventId?: string;
    /**
     * First start of a run created by a live instance migration: it waits,
     * paused, at its target node, which `_goto_node_id` names.
     */
    migrated?: boolean;
  },
): Promise<{
  status: string;
  node_results: Record<string, any>;
  error?: string;
}> {
  const supabase = options?.supabase ?? createEngineClient();

  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      runIdOrEventId,
    );

  // Claim the run atomically: only the request whose UPDATE flips it out of
  // waiting/paused resumes it, so a double submit resumes once (the other
  // matches no row). The pause columns are returned unchanged and cleared
  // below.
  let claim = (supabase.from("workflow_runs") as any)
    .update({ status: "running" })
    .in("status", RESUMABLE_RUN_STATUSES);
  claim = isUUID
    ? claim.eq("id", runIdOrEventId)
    : claim.eq("event_id", runIdOrEventId);
  if (options?.eventId) claim = claim.eq("event_id", options.eventId);
  const { data: run } = (await claim
    .select(RESUME_RUN_COLUMNS)
    .maybeSingle()) as { data: any };

  if (!run) throw new RunNotResumableError();
  const runId = run.id;
  const runVersionId = run.version_id as string | null;

  // Workflow, version and task in parallel; the pause columns are cleared
  // alongside.
  const [workflowRes, versionRes, task] = await Promise.all([
    supabase
      .from("workflows")
      .select(runVersionId ? "id, name, run_count" : "id, name, run_count, nodes, edges")
      .eq("id", run.workflow_id)
      .maybeSingle(),
    runVersionId
      ? supabase
          .from("workflow_versions" as any)
          .select("nodes, edges")
          .eq("id", runVersionId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    run.task_id
      ? // Enriched, so {{task.data.*}}/{{task.responses}} reflect what was
        // collected while the run was paused.
        loadTaskDataObject(supabase, run.task_id, { includeTimeline: true, tenantId: run.tenant_id, attachments: taskAttachmentsLoader(supabase) })
      : Promise.resolve(null),
    supabase
      .from("workflow_runs")
      .update({
        event_id: null,
        paused_at: null,
        paused_node_id: null,
        pause_variables: null,
      } as any)
      .eq("id", runId),
  ]);
  const workflow = workflowRes.data as any;
  const version = versionRes.data as any;

  // The run was claimed: a definition that can no longer be loaded fails it
  // instead of leaving it "running" forever.
  const loadError = !workflow
    ? "Workflow not found"
    : runVersionId && !version
      ? `Version ${runVersionId} used by this run was deleted — cannot resume safely.`
      : null;
  if (loadError) {
    await updateWorkflowRunCompat(supabase, runId, {
      status: "failed",
      error: loadError,
      completed_at: new Date().toISOString(),
    });
    throw new Error(loadError);
  }

  // Use the version the run was started with (not current draft); runs
  // started before versioning use the current draft.
  const nodes: WorkflowNode[] = (version ?? workflow).nodes as any;
  const edges: WorkflowEdge[] = (version ?? workflow).edges as any;

  const pausedNodeId = (run as any).paused_node_id as string;
  const { [PARALLEL_STATE_KEY]: savedParallel, ...savedVariables } = (run.pause_variables ??
    {}) as Record<string, any>;

  // Restore execution context
  const ctx: ExecutionContext = {
    supabase,
    tenantId: run.tenant_id,
    workflowId: run.workflow_id ?? undefined,
    runId,
    traceId: (run as any).trace_id ?? undefined,
    taskId: run.task_id ?? undefined,
    variables: {
      ...savedVariables,
      ...returnVariables, // Return vars override saved vars (auto-map by name)
      // ...except the engine-owned initiator variables (a task's values never set them).
      ...Object.fromEntries(
        INITIATOR_VARIABLES.filter((key) => key in savedVariables).map((key) => [key, savedVariables[key]]),
      ),
    },
    liveBindings: {},
    nodeResults: (run.node_results ?? {}) as Record<string, any>,
    executedNodes: new Set(
      Object.keys((run.node_results ?? {}) as Record<string, any>),
    ),
    executionTrace: Array.isArray((run as any).execution_trace)
      ? [...((run as any).execution_trace as Array<Record<string, unknown>>)]
      : [],
    logs: [],
    onEvent,
    // A designer test run stays one after a resume (its next User Task /
    // server event is simulated, not a real task). From the SAVED engine-owned
    // variable: a task's values cannot switch it.
    isTest: savedVariables.workflow_started_via === "test",
    // From the saved variables too (a task's values cannot switch it on).
    testFormDrafts: savedVariables.workflow_started_via === "test" && savedVariables._test_form_drafts === true,
    metrics: {
      startedAt: Date.now(),
      nodeVisits: 0,
      edgeTraversals: 0,
    },
  };

  function pushResumeLog(entry: LogEntry) {
    ctx.logs.push(entry);
    ctx.onEvent?.({ type: "log", data: entry });
  }

  if (task) ctx.task = task;
  // Parallel joins in progress (frames, open waits) when the run paused.
  ctx.parallel = newParallelRuntime(ctx, readParallelState(savedParallel));
  parallelRuntime(ctx, nodes, edges);
  clearJoinPlaceholders(ctx);

  pushResumeLog(
    options?.migrated
      ? {
          level: "info",
          message: "Workflow started from a migrated run",
          metadata: { goto_node_id: returnVariables._goto_node_id ?? null },
        }
      : {
          level: "info",
          message: `Workflow resumed — event completed with ${Object.keys(returnVariables).length} variables`,
          metadata: { returned_variable_count: Object.keys(returnVariables).length },
        },
  );

  try {
    // Check for manual "Go To Activity" redirect
    const gotoNodeId = returnVariables._goto_node_id;
    if (gotoNodeId) {
      delete ctx.variables._goto_node_id;
      const gotoNode = getNodeById(ctx, nodes, gotoNodeId);
      if (!gotoNode) throw new Error(`Go To node ${gotoNodeId} not found`);
      // Moving the run abandons Parallel branches still in progress.
      if (ctx.parallel.state.frames.length > 0 || ctx.parallel.state.waits.length > 1) {
        ctx.logs.push({
          level: "warn",
          message: `Go To abandons ${ctx.parallel.state.waits.length} open wait(s) of Parallel branches`,
        });
      }
      ctx.parallel = newParallelRuntime(ctx);
      parallelRuntime(ctx, nodes, edges);
      ctx.logs.push({
        level: "info",
        message: `Redirected to: ${gotoNode.label}`,
        metadata: { goto_node_id: gotoNodeId },
      });
      ctx.executedNodes.delete(gotoNode.id);
      traceNodeVisit(ctx, gotoNode, "resume");
      await executeNode(gotoNode, nodes, edges, ctx);
    } else if (!pausedNodeId) {
      throw new Error(
        "No paused node ID recorded — cannot determine where to resume from",
      );
    } else {
      // Find the paused node and continue from its outgoing edges
      const pausedNode = getNodeById(ctx, nodes, pausedNodeId);
      if (!pausedNode)
        throw new Error(
          `Paused node ${pausedNodeId} not found in workflow — it may have been deleted`,
        );
      const rt = parallelRuntime(ctx, nodes, edges);
      const filteredReturn = Object.fromEntries(
        Object.entries(returnVariables).filter(
          ([key]) => !(INITIATOR_VARIABLES as readonly string[]).includes(key),
        ),
      );
      // The wait being resumed: one of the run's open waits, or (runs paused
      // before join tracking, or outside any Parallel) the paused node itself.
      const wait: WaitState = rt.state.waits.find(
        (w) => w.event_id === run.event_id && w.node_id === pausedNodeId,
      ) ?? {
        event_id: String(run.event_id ?? ""),
        node_id: pausedNodeId,
        path: [],
        paused_at: run.paused_at ?? new Date().toISOString(),
      };
      await continueWait(rt, wait, filteredReturn, nodes, edges, pushResumeLog);
      // Waits of other branches that completed while the run waited on this one.
      for (;;) {
        const next = [...rt.state.waits]
          .sort(compareWaits)
          .find((w) => rt.state.completed[w.event_id]);
        if (!next) break;
        const vars = rt.state.completed[next.event_id];
        delete rt.state.completed[next.event_id];
        pushResumeLog({
          level: "info",
          message: `Continuing a Parallel branch whose wait completed earlier (${next.event_id})`,
          node_id: next.node_id,
        });
        await continueWait(rt, next, vars, nodes, edges, pushResumeLog);
      }
      // Other Parallel branches still wait: pause on the next one.
      const parallelPause = nextParallelPause(rt);
      if (parallelPause) throw parallelPause;
    }

    pushResumeLog({
      level: "info",
      message: `Workflow completed after resume — ${Object.keys(ctx.nodeResults).length} nodes total`,
      metadata: {
        total_nodes_executed: Object.keys(ctx.nodeResults).length,
        total_node_visits: ctx.metrics?.nodeVisits ?? 0,
        total_edge_traversals: ctx.metrics?.edgeTraversals ?? 0,
        total_runtime_ms: Date.now() - (ctx.metrics?.startedAt ?? Date.now()),
      },
    });
    // Mark completed
    await finishRun(supabase, ctx, workflow.id, runId, {
      countRun: !ctx.isTest,
      runCount: workflow.run_count,
    });

    return { status: "completed", node_results: ctx.nodeResults };
  } catch (error: unknown) {
    // Could pause again (nested server events)
    if (error instanceof PauseError) {
      registerWait(parallelRuntime(ctx, nodes, edges), error, []);
      reemitWaitPrompt(ctx, error);
      const pausedNode = nodes.find(
        (candidate: WorkflowNode) => candidate.id === error.nodeId,
      );
      if (pausedNode) {
        traceNodeVisit(ctx, pausedNode, "wait");
      }
      // Timed pauses record their wait output; event pauses keep the node's
      // existing result (unchanged behaviour).
      const scheduleError = await persistPause(
        supabase,
        ctx,
        workflow.id,
        runId,
        error,
        { recordWaitingNode: !!error.resumeAt, pausedAgain: true },
      );
      await flushLogs(supabase, ctx, workflow.id, runId);
      if (scheduleError) {
        return { status: "failed", node_results: ctx.nodeResults, error: scheduleError };
      }
      return {
        status: "waiting_for_event",
        node_results: ctx.nodeResults,
        event_id: error.eventId,
      } as any;
    }

    const errMsg = toErrorMessage(error);

    // Handle end_workflow
    if (errMsg.startsWith(END_MARKER)) {
      await finishRun(supabase, ctx, workflow.id, runId, {});
      return { status: "completed", node_results: ctx.nodeResults };
    }

    // Failure
    pushResumeLog({
      level: "error",
      message: `Workflow failed after resume: ${errMsg}`,
    });
    await finishRun(supabase, ctx, workflow.id, runId, { error: errMsg });

    // Fire workflow_error triggers
    fireWorkflowErrorTriggers(
      supabase,
      workflow.id,
      workflow.name,
      run.tenant_id,
      runId,
      errMsg,
      ctx.variables["last_error_node"] as string,
    );

    return { status: "failed", node_results: ctx.nodeResults, error: errMsg };
  }
}

/**
 * Continue a run from a node it waited on: the outgoing edges (a user task's
 * by its outcome), on the Parallel path the wait was on.
 */
async function followPausedNode(
  pausedNode: WorkflowNode,
  ctx: ExecutionContext,
  scope: BranchScope | undefined,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  pausedAtIso: string | null | undefined,
  pushResumeLog: (entry: LogEntry) => void,
) {
  const pausedNodeId = pausedNode.id;
  const run = { paused_at: pausedAtIso };
      // Follow outgoing edges — for user_task nodes, route by outcome label
      const outEdges = getOutgoingEdges(ctx, edges, pausedNodeId);
      const outcome = ctx.variables.outcome as string | undefined;
      const pausedNodeType = pausedNode.type;
      traceNodeVisit(ctx, pausedNode, "resume");

      // A Run Agent step that waited (approval / queued mode): the agent
      // finished — record its output, or fail the step with its error.
      if (pausedNodeType === "run_agent") {
        const agentError = ctx.variables._agent_node_error;
        const agentOutput = ctx.variables._agent_node_output;
        delete ctx.variables._agent_node_error;
        delete ctx.variables._agent_node_output;
        if (agentError) {
          ctx.nodeResults[pausedNodeId] = { status: "error", error: String(agentError), duration_ms: 0 };
          throw new Error(String(agentError));
        }
        const pausedAtMs = run.paused_at ? new Date(run.paused_at).getTime() : NaN;
        ctx.nodeResults[pausedNodeId] = {
          status: "success",
          output: agentOutput && typeof agentOutput === "object" ? agentOutput : {},
          duration_ms: Number.isFinite(pausedAtMs) ? Math.max(0, Date.now() - pausedAtMs) : 0,
        };
      }

      // A media step that ran in the background: record its output, or fail
      // the step with the job's error.
      if (pausedNodeType.startsWith("media_")) {
        const mediaError = ctx.variables._media_node_error;
        const mediaOutput = ctx.variables._media_node_output;
        delete ctx.variables._media_node_error;
        delete ctx.variables._media_node_output;
        const pausedAtMs = run.paused_at ? new Date(run.paused_at).getTime() : NaN;
        const waited = Number.isFinite(pausedAtMs) ? Math.max(0, Date.now() - pausedAtMs) : 0;
        if (mediaError) {
          ctx.nodeResults[pausedNodeId] = { status: "error", error: String(mediaError), duration_ms: waited };
          throw new Error(String(mediaError));
        }
        ctx.nodeResults[pausedNodeId] = {
          status: "success",
          output: mediaOutput && typeof mediaOutput === "object" ? mediaOutput : {},
          duration_ms: waited,
        };
      }

      // A Wait for signature step: the envelope is final (or the wait timed out).
      if (pausedNodeType === "esign_wait") {
        const esignError = ctx.variables._esign_node_error;
        const esignOutput = ctx.variables._esign_node_output;
        delete ctx.variables._esign_node_error;
        delete ctx.variables._esign_node_output;
        const pausedAtMs = run.paused_at ? new Date(run.paused_at).getTime() : NaN;
        const waited = Number.isFinite(pausedAtMs) ? Math.max(0, Date.now() - pausedAtMs) : 0;
        if (esignError) {
          ctx.nodeResults[pausedNodeId] = { status: "error", error: String(esignError), duration_ms: waited };
          throw new Error(String(esignError));
        }
        const output = esignOutput && typeof esignOutput === "object" ? (esignOutput as Record<string, unknown>) : {};
        const { applyWaitOutput } = await import("./esign/handlers");
        applyWaitOutput(pausedNode.config ?? {}, ctx.variables, output);
        ctx.nodeResults[pausedNodeId] = { status: "success", output, duration_ms: waited };
      }

      // A completed User Task: keep its values under the step's own prefix
      // too ({{<prefix>_task_data.<key>}}, {{<prefix>_outcome}}…) — the
      // generic task_data / outcome are replaced by the next User Task.
      if (pausedNodeType === "user_task") {
        const prefix = nodeVariablePrefix(pausedNode);
        for (const key of USER_TASK_PER_STEP_VARIABLES) {
          if (ctx.variables[key] !== undefined) ctx.variables[`${prefix}_${key}`] = ctx.variables[key];
        }
      }

      // A timed pause (delay / pause_until) is complete once resumed.
      if (pausedNodeType === "delay" || pausedNodeType === "pause_until") {
        const waitOutput = (ctx.nodeResults[pausedNodeId]?.output ?? {}) as Record<string, unknown>;
        const pausedAt = run.paused_at
          ? new Date(run.paused_at).getTime()
          : NaN;
        const waitedMs = Number.isFinite(pausedAt) ? Math.max(0, Date.now() - pausedAt) : null;
        ctx.nodeResults[pausedNodeId] = {
          status: "success",
          output: { ...waitOutput, waited_ms: waitedMs, remaining_ms: 0 },
          duration_ms: waitedMs ?? 0,
        };
      }

      let edgesToFollow =
        pausedNodeType === "user_task" && outcome
          ? outEdges.filter(
              (edge) =>
                !edge.label || userTaskOutcomeMatches(edge.label, outcome),
            )
          : pausedNodeType === "esign_wait"
            ? outEdges.filter((edge) => esignEdgeMatches(edge.label, ctx.variables.esign_outcome))
            : outEdges;

      if (
        pausedNodeType === "user_task" &&
        outcome &&
        edgesToFollow.length === 0
      ) {
        const configuredOutcomes = Array.isArray(pausedNode.config?.outcomes)
          ? (pausedNode.config.outcomes as string[])
          : [];
        const matchedOutcomeIndex = configuredOutcomes.findIndex((candidate) =>
          userTaskOutcomeMatches(candidate, outcome),
        );
        if (matchedOutcomeIndex >= 0 && outEdges[matchedOutcomeIndex]) {
          edgesToFollow = [outEdges[matchedOutcomeIndex]];
          pushResumeLog({
            level: "warn",
            message: `Falling back to outcome index routing for "${outcome}" on ${pausedNode.label}`,
            node_id: pausedNode.id,
            node_type: pausedNode.type,
            node_label: pausedNode.label,
            metadata: {
              matched_outcome_index: matchedOutcomeIndex,
              configured_outcomes: configuredOutcomes,
              selected_edge_label: outEdges[matchedOutcomeIndex]?.label ?? null,
            },
          });
        }
      }

      if (
        pausedNodeType === "user_task" &&
        outcome &&
        edgesToFollow.length === 0
      ) {
        pushResumeLog({
          level: "warn",
          message: `No matching outcome branch found for "${outcome}" on ${pausedNode.label}`,
          node_id: pausedNode.id,
          node_type: pausedNode.type,
          node_label: pausedNode.label,
          metadata: {
            available_edges: outEdges.map((edge) => edge.label ?? ""),
          },
        });
      }

      // Allow the chosen post-pause branch to re-enter its downstream subgraph.
      // Without this, any node already present in run.node_results is skipped by
      // executeNode(), which makes resumed test runs appear frozen even though
      // the resume request itself succeeded.
      const resumableNodeIds = new Set<string>();
      const collectResumableNodes = (nodeId: string) => {
        if (resumableNodeIds.has(nodeId) || nodeId === pausedNodeId) return;
        resumableNodeIds.add(nodeId);
        for (const candidateEdge of getOutgoingEdges(ctx, edges, nodeId)) {
          collectResumableNodes(candidateEdge.target);
        }
      };
      for (const edge of edgesToFollow) {
        collectResumableNodes(edge.target);
      }
      for (const nodeId of resumableNodeIds) {
        ctx.executedNodes.delete(nodeId);
      }

      for (const edge of edgesToFollow) {
        const nextNode = getNodeById(ctx, nodes, edge.target);
        if (nextNode) {
          traceEdgeTraversal(ctx, edge, pausedNode, nextNode, "resume");
          await executeNode(nextNode, nodes, edges, ctx, scope);
        }
      }
}

/**
 * Resume one open wait: on its Parallel path (with `returnVariables` set
 * there), then run whatever that unblocks (joins, the next sequential branch)
 * until nothing more can run.
 */
async function continueWait(
  rt: ParallelRuntime,
  wait: WaitState,
  returnVariables: Record<string, unknown>,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  pushResumeLog: (entry: LogEntry) => void,
) {
  rt.state.waits = rt.state.waits.filter((w) => w !== wait);
  const node = getNodeById(rt.root, nodes, wait.node_id);
  if (!node)
    throw new Error(
      `Paused node ${wait.node_id} not found in workflow — it may have been deleted`,
    );
  const prior = rt.root.nodeResults[node.id];
  if ((prior?.output as Record<string, unknown> | undefined)?._parallel_wait) {
    const { _parallel_wait: _flag, ...output } = prior.output as Record<string, unknown>;
    rt.root.nodeResults[node.id] = { ...prior, output };
  }
  const last = wait.path[wait.path.length - 1];
  const frame = last && rt.state.frames.find((f) => f.id === last.frame);
  if (!frame) {
    // Outside any Parallel: as before, errors and pauses propagate.
    Object.assign(rt.root.variables, returnVariables);
    await followPausedNode(node, rt.root, undefined, nodes, edges, wait.paused_at, pushResumeLog);
    return;
  }
  startPath(rt, frame, last.token, last.record, frameParent(rt, frame), async (ctx, scope) => {
    Object.assign(ctx.variables, returnVariables);
    await followPausedNode(node, ctx, scope, nodes, edges, wait.paused_at, pushResumeLog);
  });
  await parallelSettled(rt);
  throwParallelFailure(rt);
  await drainRootDone(rt);
}

function passesTriggerFilters(
  node: WorkflowNode,
  ctx: ExecutionContext,
): boolean {
  const config = node.config;
  const task = ctx.task;

  // Only apply filters to task trigger nodes
  if (!(TRIGGER_TYPES as readonly string[]).includes(node.type)) {
    return true;
  }

  if (node.type === "manual") return true;

  if (node.type === "esign_event") {
    // The trigger dispatcher (lib/esign/triggers) already matched the queued
    // event; a manual / test start without event variables passes.
    const wantedIntegration = typeof config.integration_id === "string" ? config.integration_id.trim() : "";
    const wantedEvents = Array.isArray(config.events) ? config.events.filter(Boolean) : [];
    if (wantedIntegration && ctx.variables.esign_integration_id && ctx.variables.esign_integration_id !== wantedIntegration) return false;
    if (wantedEvents.length && ctx.variables.esign_event && !wantedEvents.includes(ctx.variables.esign_event)) return false;
    return true;
  }

  if (node.type === "data_table_event") {
    const tableId = dataTableIdOf(config) || undefined;
    const selectedEventTypes = Array.isArray(config.event_types)
      ? config.event_types.filter(Boolean)
      : [];
    if (
      tableId &&
      ctx.variables.data_table_id &&
      ctx.variables.data_table_id !== tableId
    )
      return false;
    if (
      selectedEventTypes.length > 0 &&
      ctx.variables.data_event &&
      !selectedEventTypes.includes(ctx.variables.data_event)
    )
      return false;
    return true;
  }

  if (node.type === "middleware_received") {
    return true;
  }

  if (node.type === "workflow_error") {
    const scope = config.error_scope === "specific" ? "specific" : "all";
    const selectedWorkflowIds = Array.isArray(config.workflow_ids)
      ? config.workflow_ids.filter(Boolean)
      : config.workflow_id
        ? [config.workflow_id]
        : [];
    if (scope === "specific") {
      const failedWorkflowId = ctx.variables.error_workflow_id;
      return (
        !!failedWorkflowId && selectedWorkflowIds.includes(failedWorkflowId)
      );
    }
    return true;
  }

  if (node.type === "workflow_sla") {
    const scope = config.workflow_scope === "specific" ? "specific" : "all";
    const selectedWorkflowIds = Array.isArray(config.workflow_ids)
      ? config.workflow_ids.filter(Boolean)
      : config.workflow_id
        ? [config.workflow_id]
        : [];
    const selectedEventTypes = Array.isArray(config.event_types)
      ? config.event_types.filter(Boolean)
      : [];
    const selectedStatuses = Array.isArray(config.sla_statuses)
      ? config.sla_statuses.filter(Boolean)
      : [];

    if (scope === "specific") {
      const workflowId = ctx.variables.workflow_sla_workflow_id;
      if (!workflowId || !selectedWorkflowIds.includes(workflowId))
        return false;
    }
    if (selectedEventTypes.length > 0) {
      const eventType = ctx.variables.workflow_sla_event;
      if (!eventType || !selectedEventTypes.includes(eventType)) return false;
    }
    if (selectedStatuses.length > 0) {
      const slaStatus = ctx.variables.workflow_sla_status;
      if (!slaStatus || !selectedStatuses.includes(slaStatus)) return false;
    }
    return true;
  }

  if (node.type === "retention_policy_review") {
    const scope = config.policy_scope === "specific" ? "specific" : "all";
    const selectedPolicyIds = Array.isArray(config.policy_ids)
      ? config.policy_ids.filter(Boolean)
      : config.retention_policy_id
        ? [config.retention_policy_id]
        : [];
    if (scope === "specific") {
      const policyId = ctx.variables.retention_policy_id;
      return !!policyId && selectedPolicyIds.includes(policyId);
    }
    return true;
  }

  if (node.type === "retention_policy_executed") {
    const scope = config.policy_scope === "specific" ? "specific" : "all";
    const selectedPolicyIds = Array.isArray(config.policy_ids)
      ? config.policy_ids.filter(Boolean)
      : config.retention_policy_id
        ? [config.retention_policy_id]
        : [];
    if (scope === "specific") {
      const policyId = ctx.variables.retention_policy_id;
      if (!policyId || !selectedPolicyIds.includes(policyId)) return false;
    }
    const selectedActionTypes = Array.isArray(config.action_types)
      ? config.action_types.filter(Boolean)
      : config.action_type
        ? [config.action_type]
        : [];
    if (selectedActionTypes.length > 0) {
      const actionType = ctx.variables.retention_action_type;
      if (!actionType || !selectedActionTypes.includes(actionType))
        return false;
    }
    return true;
  }

  if (!task) return true;

  // Priority filter
  const priorityFilter: string[] = config.priority_filter ?? [];
  if (priorityFilter.length > 0 && !priorityFilter.includes(task.priority))
    return false;

  return true;
}

/**
 * Resolve live bindings referenced in a node's config.
 * Scans the config JSON for {{live.bindingName.xxx}} patterns,
 * makes the API call for each unique binding (once per node, cached),
 * and injects results into ctx.variables.live[bindingName].
 */
async function resolveLiveBindingsForNode(
  node: WorkflowNode,
  ctx: ExecutionContext,
) {
  // The node's config is fixed for the run, so the scan runs once per node per
  // run (loops re-enter nodes). Each reference is still fetched fresh for every
  // node execution — live_reference means "fresh data on demand".
  const scans = getRunCache(ctx).liveBindingNames;
  let bindingNames = scans.get(node.id);
  if (!bindingNames) {
    const configStr = JSON.stringify(node.config ?? {});
    const names = new Set<string>();
    if (configStr.includes("{{live")) {
      const livePattern = /\{\{live\.(\w+)(?:\.\w+)*\}\}/g;
      let match;
      while ((match = livePattern.exec(configStr)) !== null) {
        names.add(match[1]);
      }
      // Also check for {{live_XXX}} shorthand
      const shorthandPattern = /\{\{live_(\w+)(?:\.\w+)*\}\}/g;
      while ((match = shorthandPattern.exec(configStr)) !== null) {
        names.add(match[1]);
      }
    }
    bindingNames = [...names];
    scans.set(node.id, bindingNames);
  }
  if (bindingNames.length === 0) return;

  if (!ctx.variables.live) ctx.variables.live = {};
  const { executeReference } = await import("@/lib/reference-executor");

  for (const name of bindingNames) {
    if (ctx._liveCache?.[name]) {
      ctx.variables.live[name] = ctx._liveCache[name];
      ctx.variables[`live_${name}`] = ctx._liveCache[name];
      continue;
    }

    const binding = ctx.liveBindings[name];
    if (!binding) {
      ctx.logs.push({
        level: "warn",
        message: `Live reference '${name}' not found — no binding registered`,
        node_id: node.id,
        node_type: node.type,
        node_label: node.label,
        duration_ms: 0,
      });
      continue;
    }

    const start = Date.now();
    try {
      let data: any;

      // Handle data table live bindings (list/get re-query)
      if (
        binding.referenceId === "__data_table_list" ||
        binding.referenceId === "__data_table_get"
      ) {
        const snap = binding.configSnapshot;
        const tblId = snap.table_id;
        if (binding.referenceId === "__data_table_list") {
          let query = ctx.supabase
            .from("custom_table_rows")
            .select("id, data, created_at, updated_at")
            .eq("table_id", tblId);
          for (const f of (snap.filters ?? []) as {
            column: string;
            operator: string;
            value: string;
          }[]) {
            if (!f.column) continue;
            const val = resolveExpression(f.value, ctx);
            const col = `data->>${f.column}`;
            query = applyDataFilter(query, col, f.operator, val);
          }
          if (snap.sort_column) {
            query = query.order(`data->>${snap.sort_column}` as any, {
              ascending: snap.sort_direction !== "desc",
            });
          } else {
            query = query.order("created_at", { ascending: false });
          }
          query = query.limit(Number(snap.limit) || 100);
          const { data: rows } = await query;
          data = (rows ?? []).map((r: any) => ({
            row_id: r.id,
            ...r.data,
            _created_at: r.created_at,
            _updated_at: r.updated_at,
          }));
        } else {
          // __data_table_get
          const rowId = snap._resolved_row_id;
          const { data: row } = await ctx.supabase
            .from("custom_table_rows")
            .select("id, data, created_at, updated_at")
            .eq("id", rowId)
            .single();
          data = row
            ? {
                row_id: row.id,
                ...((row.data as any) ?? {}),
                _created_at: row.created_at,
                _updated_at: row.updated_at,
              }
            : null;
        }
      } else {
        // Standard API reference live binding
        const resolvedInputs: Record<string, string> = {};
        const ref = await loadReference(ctx, binding.referenceId).catch(
          () => null,
        );
        const inputs = (ref?.inputs as any[]) ?? [];
        for (const inp of inputs) {
          const mapped = binding.inputMappings[inp.name];
          if (mapped) {
            resolvedInputs[inp.name] = String(
              resolveExpression(mapped, ctx) ?? inp.default_value ?? "",
            );
          } else {
            resolvedInputs[inp.name] = String(inp.default_value ?? "");
          }
        }

        const result = await executeReference({
          supabase: ctx.supabase,
          referenceId: binding.referenceId,
          inputValues: resolvedInputs,
          timeout: 30_000,
          caller: {
            traceId: ctx.traceId ?? ctx.runId ?? "",
            callerType: "workflow_node",
            callerId: ctx.runId ?? null,
            callerNodeId: node.id,
          },
        });
        data = result.data;
      }
      ctx.variables.live[name] = data;
      ctx.variables[`live_${name}`] = data;
      if (ctx._liveCache) ctx._liveCache[name] = data;

      ctx.logs.push({
        level: "info",
        message: `Live reference '${name}' fetched (${Array.isArray(data) ? data.length + " items" : typeof data})`,
        node_id: node.id,
        node_type: node.type,
        node_label: node.label,
        duration_ms: Date.now() - start,
      });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      ctx.variables.live[name] = { _error: errMsg };
      ctx.logs.push({
        level: "warn",
        message: `Live reference '${name}' failed: ${errMsg}`,
        node_id: node.id,
        node_type: node.type,
        node_label: node.label,
        duration_ms: 0,
      });
    }
  }
}

/**
 * Pause the run until `resumeAt` (throws PauseError; executeWorkflow persists
 * the run and enqueues the resume). Returns without pausing — the node then
 * continues without the long wait, as before, with a warning log — when the
 * run can't be resumed at this node: inside a loop body (loop iteration state
 * isn't persisted) or when the run row couldn't be created.
 */
function timedPause(
  node: WorkflowNode,
  ctx: ExecutionContext,
  resumeAt: Date,
  output: Record<string, unknown>,
): void {
  const reason = (ctx.loopDepth ?? 0) > 0
    ? "inside a loop body, where the loop can't be resumed after a pause"
    : !ctx.runId
      ? "the run has no run record to resume"
      : null;
  if (reason) {
    ctx.logs.push({
      node_id: node.id,
      node_type: node.type,
      node_label: node.label,
      level: "warn",
      message: `${node.label}: wait over ${ENGINE_LIMITS.inlineDelayMaxMs / 1000} s not applied — ${reason}`,
      metadata: { resume_at: resumeAt.toISOString() },
    });
    return;
  }
  throw new PauseError(`${TIMED_PAUSE_PREFIX}${crypto.randomUUID()}`, node.id, {
    resumeAt,
    output,
  });
}

// ─── Parallel joins ───
// Semantics in lib/workflow-parallel.ts. Every branch of a Parallel node runs
// as a "path" with its own context (variables write through to the run's and
// are recorded per path); a step two or more branches can reach is a join:
// a path arriving there stops while another branch could still get there,
// and the join runs once, on a new path carrying the merged branches, when
// none can. Waits inside a path end it for now (the run state keeps them);
// the run pauses when nothing else can run.

interface BranchScope {
  frame: FrameState;
  entry: PathEntry;
  parent?: BranchScope;
}

interface RunningPath {
  path: PathEntry[];
}

interface ParallelRuntime {
  state: ParallelState;
  root: ExecutionContext;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  graphs: Map<string, ParallelGraph>;
  reachable: Map<string, Set<string>>;
  running: Set<RunningPath>;
  /** Errors / end signals of paths, with the frame and branches they came from. */
  failures: Array<{ frame: string; token: number[]; error: unknown }>;
  failedFrames: Set<string>;
  /** Context / scope a frame's Parallel node ran in (materialized after a resume). */
  parents: Map<string, { ctx: ExecutionContext; scope?: BranchScope }>;
  waiters: Array<{ frame?: string; resolve: () => void }>;
  /** Root-level frames that finished after a resume and whose Done edges still have to run. */
  rootDone: FrameState[];
  /** Frames whose Parallel node is still awaiting its branches in this process (it runs Done itself). */
  attached: Set<string>;
  pumping: boolean;
  repump: boolean;
}

function newParallelRuntime(
  root: ExecutionContext,
  state: ParallelState = emptyParallelState(),
): ParallelRuntime {
  return {
    state,
    root,
    nodes: [],
    edges: [],
    graphs: new Map(),
    reachable: new Map(),
    running: new Set(),
    failures: [],
    failedFrames: new Set(),
    parents: new Map(),
    waiters: [],
    rootDone: [],
    attached: new Set(),
    pumping: false,
    repump: false,
  };
}

function parallelRuntime(
  ctx: ExecutionContext,
  allNodes?: WorkflowNode[],
  allEdges?: WorkflowEdge[],
): ParallelRuntime {
  ctx.parallel ??= newParallelRuntime(ctx);
  const rt = ctx.parallel;
  if (allNodes && rt.nodes.length === 0) rt.nodes = allNodes;
  if (allEdges && rt.edges.length === 0) rt.edges = allEdges;
  // Lazily-built shared caches must exist before contexts are forked.
  getRunCache(ctx);
  ctx.metrics ??= { startedAt: Date.now(), nodeVisits: 0, edgeTraversals: 0 };
  if (!ctx.nodeMap) ctx.nodeMap = buildNodeMap(rt.nodes);
  if (!ctx.edgesBySource) ctx.edgesBySource = buildEdgesBySource(rt.edges);
  return rt;
}

const pathOf = (scope?: BranchScope): PathEntry[] => {
  const out: PathEntry[] = [];
  for (let s = scope; s; s = s.parent) out.unshift(s.entry);
  return out;
};

const tokenUnion = (...tokens: number[][]) =>
  [...new Set(tokens.flat())].sort((a, b) => a - b);

function frameGraph(rt: ParallelRuntime, frame: FrameState): ParallelGraph {
  const key = `${frame.node_id}|${frame.branches.map((b) => b.target).join(",")}`;
  let graph = rt.graphs.get(key);
  if (!graph) {
    graph = computeParallelGraph(
      frame.node_id,
      frame.branches.map((b) => b.target),
      (id) => getOutgoingEdges(rt.root, rt.edges, id),
    );
    rt.graphs.set(key, graph);
  }
  return graph;
}

/** `to` can be reached from `from` along one or more edges. */
function canReach(rt: ParallelRuntime, from: string, to: string): boolean {
  let seen = rt.reachable.get(from);
  if (!seen) {
    seen = new Set();
    const stack = getOutgoingEdges(rt.root, rt.edges, from).map((e) => e.target);
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of getOutgoingEdges(rt.root, rt.edges, id)) stack.push(e.target);
    }
    rt.reachable.set(from, seen);
  }
  return seen.has(to);
}

/** Everything of the run still live inside `frame` (see joinBlockers). */
function livePositions(
  rt: ParallelRuntime,
  frame: FrameState,
  exceptArrivalsAt?: string,
): LivePosition[] {
  const at = (path: PathEntry[]) => path.find((p) => p.frame === frame.id);
  const out: LivePosition[] = [];
  for (const p of rt.running) {
    const e = at(p.path);
    if (e) out.push({ token: e.token, node: null });
  }
  for (const w of rt.state.waits) {
    const e = at(w.path);
    if (e) out.push({ token: e.token, node: w.node_id });
  }
  for (const f of rt.state.frames) {
    if (f === frame) {
      for (const a of f.arrivals)
        if (a.node_id !== exceptArrivalsAt)
          out.push({ token: a.token, node: a.node_id });
      f.branches.forEach((b, i) => {
        if (!b.started) out.push({ token: [i], node: b.target, start: true });
      });
      continue;
    }
    const e = at(f.parent_path);
    if (!e) continue;
    // Its Done edges still run on this path, from the Parallel node.
    if (f.done_edges?.length)
      for (const edge of getOutgoingEdges(rt.root, rt.edges, f.node_id))
        if (f.done_edges.includes(edge.id)) out.push({ token: e.token, node: edge.target, start: true });
    for (const a of f.arrivals) out.push({ token: e.token, node: a.node_id });
    for (const b of f.branches)
      if (!b.started) out.push({ token: e.token, node: b.target, start: true });
  }
  return out;
}

function blockersAt(
  rt: ParallelRuntime,
  frame: FrameState,
  nodeId: string,
  token: number[],
): number[] {
  return joinBlockers(
    frameGraph(rt, frame),
    nodeId,
    token,
    livePositions(rt, frame, nodeId),
    (from, to) => canReach(rt, from, to),
  );
}

/** A path context: variables write through to the parent's and are recorded. */
function forkPathContext(
  parent: ExecutionContext,
  record: WriteRecord,
): ExecutionContext {
  const variables = new Proxy(parent.variables, {
    set(target, key, value) {
      if (typeof key === "string") {
        record.writes[key] = value;
        const i = record.deleted.indexOf(key);
        if (i >= 0) record.deleted.splice(i, 1);
      }
      target[key as string] = value;
      return true;
    },
    deleteProperty(target, key) {
      if (typeof key === "string") {
        delete record.writes[key];
        if (!record.deleted.includes(key)) record.deleted.push(key);
      }
      return delete target[key as string];
    },
  });
  return { ...parent, variables, _liveCache: undefined };
}

/** Context and scope of a path (rebuilt from the persisted state after a resume). */
function materializePath(
  rt: ParallelRuntime,
  path: PathEntry[],
): { ctx: ExecutionContext; scope?: BranchScope } {
  let ctx = rt.root;
  let scope: BranchScope | undefined;
  for (const entry of path) {
    const frame = rt.state.frames.find((f) => f.id === entry.frame);
    if (!frame) break;
    const record = (frame.records[entry.record] ??= {
      token: entry.token,
      writes: {},
      deleted: [],
    });
    ctx = forkPathContext(ctx, record);
    scope = { frame, entry, parent: scope };
  }
  return { ctx, scope };
}

function frameParent(rt: ParallelRuntime, frame: FrameState) {
  let parent = rt.parents.get(frame.id);
  if (!parent) {
    parent = materializePath(rt, frame.parent_path);
    rt.parents.set(frame.id, parent);
  }
  return parent;
}

function registerWait(
  rt: ParallelRuntime,
  error: PauseError,
  path: PathEntry[],
) {
  if (error.waitRegistered) return;
  error.waitRegistered = true;
  rt.state.waits.push({
    event_id: error.eventId,
    node_id: error.nodeId,
    path,
    paused_at: new Date().toISOString(),
    ...(error.resumeAt
      ? { resume_at: error.resumeAt.toISOString(), output: error.waitOutput }
      : {}),
    ...(error.prompt ? { prompt: error.prompt } : {}),
  });
  if (path.length > 0) {
    rt.root.nodeResults[error.nodeId] = {
      status: "waiting",
      output: { ...(error.waitOutput ?? { event_id: error.eventId }), _parallel_wait: true },
      duration_ms: 0,
    };
  }
}

function startPath(
  rt: ParallelRuntime,
  frame: FrameState,
  token: number[],
  record: number,
  parent: { ctx: ExecutionContext; scope?: BranchScope },
  start: (ctx: ExecutionContext, scope: BranchScope) => Promise<void>,
) {
  const entry: PathEntry = { frame: frame.id, token, record };
  const scope: BranchScope = { frame, entry, parent: parent.scope };
  const pathCtx = forkPathContext(
    parent.ctx,
    (frame.records[record] ??= { token, writes: {}, deleted: [] }),
  );
  const live: RunningPath = { path: [...pathOf(parent.scope), entry] };
  rt.running.add(live);
  void (async () => {
    try {
      await start(pathCtx, scope);
    } catch (error) {
      if (error instanceof PauseError) registerWait(rt, error, live.path);
      else {
        rt.failedFrames.add(frame.id);
        rt.failures.push({ frame: frame.id, token, error });
      }
    } finally {
      if (pathCtx.task !== parent.ctx.task) parent.ctx.task = pathCtx.task;
      rt.running.delete(live);
      pumpParallel(rt);
    }
  })();
}

function startBranch(rt: ParallelRuntime, frame: FrameState, index: number) {
  const branch = frame.branches[index];
  branch.started = true;
  const parent = frameParent(rt, frame);
  const node = getNodeById(rt.root, rt.nodes, branch.target);
  if (!node) return;
  const parallelNode = getNodeById(rt.root, rt.nodes, frame.node_id);
  const edge = getOutgoingEdges(rt.root, rt.edges, frame.node_id).find(
    (e) => e.id === branch.edge_id,
  );
  startPath(rt, frame, [index], index, parent, async (ctx, scope) => {
    if (edge)
      traceEdgeTraversal(
        ctx,
        edge,
        parallelNode,
        node,
        frame.mode === "parallel" ? "parallel" : "parallel_sequential",
      );
    await executeNode(node, rt.nodes, rt.edges, ctx, scope);
  });
}

/** Run a join: apply the merged branches' variables in branch order, then continue on one path. */
function fireJoin(rt: ParallelRuntime, frame: FrameState, nodeId: string) {
  const group = frame.arrivals.filter((a) => a.node_id === nodeId);
  frame.arrivals = frame.arrivals.filter((a) => a.node_id !== nodeId);
  const token = tokenUnion(...group.map((a) => a.token));
  const parent = frameParent(rt, frame);
  for (const index of joinReplayOrder(frame.records, token)) {
    const record = frame.records[index];
    for (const key of record.deleted) delete parent.ctx.variables[key];
    for (const [key, value] of Object.entries(record.writes))
      parent.ctx.variables[key] = value;
  }
  frame.records.push({ token, writes: {}, deleted: [] });
  const node = getNodeById(rt.root, rt.nodes, nodeId);
  if (!node) return;
  startPath(rt, frame, token, frame.records.length - 1, parent, (ctx, scope) =>
    executeNode(node, rt.nodes, rt.edges, ctx, scope, scope),
  );
}

/** A path at `node` that has to wait for other branches records its arrival and stops. */
function arriveAtJoin(
  node: WorkflowNode,
  ctx: ExecutionContext,
  scope: BranchScope | undefined,
  passed: BranchScope | undefined,
): boolean {
  const rt = ctx.parallel;
  if (!rt) return false;
  for (let s = scope; s; s = s.parent) {
    if (s === passed) continue;
    if (!frameGraph(rt, s.frame).stop.has(node.id)) continue;
    // A branch failed: the run fails once the others finish; joins don't run.
    if (rt.failedFrames.has(s.frame.id)) return true;
    const pending = s.frame.arrivals.filter((a) => a.node_id === node.id);
    const token = tokenUnion(s.entry.token, ...pending.map((a) => a.token));
    const blockers = blockersAt(rt, s.frame, node.id, token);
    if (pending.length === 0 && blockers.length === 0) continue; // nothing left to wait for
    s.frame.arrivals.push({
      node_id: node.id,
      token: s.entry.token,
      record: s.entry.record,
    });
    if (blockers.length > 0) {
      const parallelNode = getNodeById(rt.root, rt.nodes, s.frame.node_id);
      ctx.logs.push({
        node_id: node.id,
        node_type: node.type,
        node_label: node.label,
        level: "info",
        message: `${node.label}: waiting for ${blockers.length === 1 ? "branch" : "branches"} ${blockers
          .map((b) => `"${s!.frame.branches[b]?.label ?? b + 1}"`)
          .join(", ")} of ${parallelNode?.label ?? "Parallel"}`,
      });
    }
    pumpParallel(rt);
    return true;
  }
  return false;
}

const runningIn = (rt: ParallelRuntime, frameId: string) =>
  [...rt.running].some((p) => p.path.some((e) => e.frame === frameId));

function frameQuiet(rt: ParallelRuntime, frame: FrameState): boolean {
  return (
    frame.branches.every((b) => b.started) &&
    !runningIn(rt, frame.id) &&
    !rt.state.waits.some((w) => w.path.some((e) => e.frame === frame.id)) &&
    !rt.state.frames.some(
      (f) => f !== frame && f.parent_path.some((e) => e.frame === frame.id),
    )
  );
}

/** Start whatever can run now: the next sequential branch, joins nothing can still reach. */
function pumpParallel(rt: ParallelRuntime) {
  if (rt.pumping) {
    rt.repump = true;
    return;
  }
  rt.pumping = true;
  try {
    do {
      rt.repump = false;
      for (const frame of [...rt.state.frames]) {
        if (rt.failedFrames.has(frame.id)) continue;
        if (frame.mode === "sequential") {
          const next = frame.branches.findIndex((b) => !b.started);
          const busy = (b: number) =>
            [...rt.running].some((p) =>
              p.path.some((e) => e.frame === frame.id && e.token.includes(b)),
            ) ||
            rt.state.waits.some((w) =>
              w.path.some((e) => e.frame === frame.id && e.token.includes(b)),
            );
          if (next >= 0 && !Array.from({ length: next }, (_, b) => b).some(busy)) {
            startBranch(rt, frame, next);
            rt.repump = true;
          }
        }
        for (const nodeId of [...new Set(frame.arrivals.map((a) => a.node_id))]) {
          const token = tokenUnion(
            ...frame.arrivals.filter((a) => a.node_id === nodeId).map((a) => a.token),
          );
          if (blockersAt(rt, frame, nodeId, token).length === 0) {
            fireJoin(rt, frame, nodeId);
            rt.repump = true;
          }
        }
        // Joins waiting on each other (a cycle): nothing else can arrive, run the first.
        if (!rt.repump && frame.arrivals.length > 0 && frameQuiet(rt, frame)) {
          fireJoin(rt, frame, frame.arrivals[0].node_id);
          rt.repump = true;
        }
        if (frame.arrivals.length === 0 && frameQuiet(rt, frame)) {
          rt.state.frames = rt.state.frames.filter((f) => f !== frame);
          if (frame.done_edges?.length && !rt.attached.has(frame.id))
            startDeferredDone(rt, frame);
          rt.parents.delete(frame.id);
          rt.repump = true;
        }
      }
    } while (rt.repump);
  } finally {
    rt.pumping = false;
  }
  const waiting = rt.waiters;
  rt.waiters = [];
  for (const w of waiting) {
    const done = w.frame ? !runningIn(rt, w.frame) : rt.running.size === 0;
    if (done) w.resolve();
    else rt.waiters.push(w);
  }
}

/** Resolves once no path of `frameId` (or, without one, of the run) is running. */
function parallelSettled(rt: ParallelRuntime, frameId?: string): Promise<void> {
  const done = frameId ? !runningIn(rt, frameId) : rt.running.size === 0;
  if (done) return Promise.resolve();
  return new Promise((resolve) => rt.waiters.push({ frame: frameId, resolve }));
}

/** Rethrow the failure of a frame (or of any frame): errors before end signals, earlier branches first. */
function throwParallelFailure(rt: ParallelRuntime, frameId?: string) {
  const failures = rt.failures.filter((f) => !frameId || f.frame === frameId);
  if (failures.length === 0) return;
  const isEnd = (e: unknown) =>
    e instanceof EndWorkflowSignal || toErrorMessage(e).startsWith(END_MARKER);
  failures.sort(
    (a, b) =>
      Number(isEnd(a.error)) - Number(isEnd(b.error)) ||
      Math.min(...a.token) - Math.min(...b.token),
  );
  rt.failures = rt.failures.filter((f) => !failures.includes(f));
  throw failures[0].error;
}

async function runParallelNode(
  node: WorkflowNode,
  output: { mode?: string; branches?: string[] } | undefined,
  outEdges: WorkflowEdge[],
  allNodes: WorkflowNode[],
  allEdges: WorkflowEdge[],
  ctx: ExecutionContext,
  scope: BranchScope | undefined,
) {
  const rt = parallelRuntime(ctx, allNodes, allEdges);
  const labels: string[] = output?.branches ?? [];
  const branchEdges = labels
    .map((label) =>
      outEdges.find(
        (e) => (e.label ?? "").toLowerCase().trim() === label.toLowerCase().trim(),
      ),
    )
    .filter(Boolean) as WorkflowEdge[];
  const doneEdges = parallelDoneEdges(outEdges, labels);
  if (branchEdges.length === 0) {
    await runParallelDone(node, doneEdges, ctx, scope);
    return;
  }
  const frame: FrameState = {
    id: `${node.id}#${++rt.state.seq}`,
    node_id: node.id,
    // As before: anything but "parallel" (the default) runs one branch at a time.
    mode: (output?.mode ?? "parallel") === "parallel" ? "parallel" : "sequential",
    parent_path: pathOf(scope),
    branches: branchEdges.map((e) => ({
      label: e.label ?? "",
      target: e.target,
      edge_id: e.id,
      started: false,
    })),
    records: branchEdges.map((_, i) => ({ token: [i], writes: {}, deleted: [] })),
    arrivals: [],
    ...(doneEdges.length > 0 ? { done_edges: doneEdges.map((e) => e.id) } : {}),
  };
  rt.state.frames.push(frame);
  rt.parents.set(frame.id, { ctx, scope });
  rt.attached.add(frame.id);
  try {
    if (frame.mode === "parallel")
      frame.branches.forEach((_, i) => startBranch(rt, frame, i));
    pumpParallel(rt);
    await parallelSettled(rt, frame.id);
    throwParallelFailure(rt, frame.id);
  } finally {
    rt.attached.delete(frame.id);
  }
  // A branch still waits (user task, long delay): the frame keeps its
  // done_edges and they run when it finishes after the resume (startDeferredDone).
  if (doneEdges.length === 0 || rt.state.frames.includes(frame)) return;
  applyFrameWrites(frame, ctx);
  await runParallelDone(node, doneEdges, ctx, scope);
}

/** Apply every branch's variables in branch order (a later branch wins), as a join of all branches would. */
function applyFrameWrites(frame: FrameState, ctx: ExecutionContext) {
  const all = frame.branches.map((_, i) => i);
  for (const index of joinReplayOrder(frame.records, all)) {
    const record = frame.records[index];
    for (const key of record.deleted) delete ctx.variables[key];
    for (const [key, value] of Object.entries(record.writes)) ctx.variables[key] = value;
  }
}

/** Follow a Parallel node's Done edges (after all its branches finished). */
async function runParallelDone(
  node: WorkflowNode | null | undefined,
  doneEdges: WorkflowEdge[],
  ctx: ExecutionContext,
  scope: BranchScope | undefined,
) {
  const rt = ctx.parallel;
  const nodes = rt?.nodes ?? [];
  const edges = rt?.edges ?? [];
  for (const edge of doneEdges) {
    const next = getNodeById(ctx, nodes, edge.target);
    if (!next) continue;
    ctx.executedNodes.delete(next.id);
    traceEdgeTraversal(ctx, edge, node, next, "parallel_done");
    await executeNode(next, nodes, edges, ctx, scope);
  }
}

/**
 * A frame whose Parallel node returned while a branch waited has now
 * finished (after a resume): run its Done edges on the path the Parallel
 * node ran on — a new path of the enclosing frame, or (outside any
 * Parallel) at the root, where continueWait runs them (drainRootDone).
 */
function startDeferredDone(rt: ParallelRuntime, frame: FrameState) {
  const ids = frame.done_edges ?? [];
  frame.done_edges = undefined;
  const out = getOutgoingEdges(rt.root, rt.edges, frame.node_id);
  const doneEdges = ids
    .map((id) => out.find((e) => e.id === id))
    .filter(Boolean) as WorkflowEdge[];
  if (doneEdges.length === 0) return;
  const node = getNodeById(rt.root, rt.nodes, frame.node_id);
  const last = frame.parent_path[frame.parent_path.length - 1];
  const outer = last && rt.state.frames.find((f) => f.id === last.frame);
  if (!outer) {
    frame.done_edges = ids;
    rt.rootDone.push(frame);
    return;
  }
  const parent = frameParent(rt, frame);
  applyFrameWrites(frame, parent.ctx);
  startPath(rt, outer, last.token, last.record, frameParent(rt, outer), (ctx, scope) =>
    runParallelDone(node, doneEdges, ctx, scope),
  );
}

/** Done edges of root-level frames that finished after a resume (errors and pauses propagate as usual). */
async function drainRootDone(rt: ParallelRuntime) {
  while (rt.rootDone.length > 0) {
    const frame = rt.rootDone.shift()!;
    const ids = frame.done_edges ?? [];
    frame.done_edges = undefined;
    const out = getOutgoingEdges(rt.root, rt.edges, frame.node_id);
    const doneEdges = ids
      .map((id) => out.find((e) => e.id === id))
      .filter(Boolean) as WorkflowEdge[];
    applyFrameWrites(frame, rt.root);
    await runParallelDone(getNodeById(rt.root, rt.nodes, frame.node_id), doneEdges, rt.root, undefined);
  }
}

function withTestPrompt(
  error: PauseError,
  node: WorkflowNode,
  data: Record<string, unknown>,
): PauseError {
  error.prompt = { node_label: node.label, data };
  return error;
}

/**
 * Test runs with several open waits: show the prompt of the one the run now
 * waits on again (the test runner offers the latest prompt).
 */
function reemitWaitPrompt(ctx: ExecutionContext, error: PauseError) {
  const rt = ctx.parallel;
  if (!ctx.onEvent || !rt || rt.state.waits.length < 2) return;
  const prompt = error.prompt ?? rt.state.waits.find((w) => w.event_id === error.eventId)?.prompt;
  if (!prompt) return;
  ctx.onEvent({
    type: "node_complete",
    node_id: error.nodeId,
    node_label: prompt.node_label,
    data: prompt.data,
  });
}

/** PauseError for the run's next open wait (the first by branch order, see compareWaits), if any. */
function nextParallelPause(rt: ParallelRuntime | undefined): PauseError | null {
  const w = rt ? [...rt.state.waits].sort(compareWaits)[0] : undefined;
  if (!w) return null;
  const error = new PauseError(
    w.event_id,
    w.node_id,
    w.resume_at
      ? { resumeAt: new Date(w.resume_at), output: w.output ?? {} }
      : undefined,
  );
  error.waitRegistered = true;
  if (w.prompt) error.prompt = w.prompt;
  return error;
}

/** Placeholder results of joins still waiting (status waiting + _join_waiting summary). */
function markJoinPlaceholders(ctx: ExecutionContext) {
  const rt = ctx.parallel;
  if (!rt) return;
  for (const frame of rt.state.frames) {
    for (const nodeId of new Set(frame.arrivals.map((a) => a.node_id))) {
      const token = tokenUnion(
        ...frame.arrivals.filter((a) => a.node_id === nodeId).map((a) => a.token),
      );
      ctx.nodeResults[nodeId] = {
        status: "waiting",
        output: {
          _join_waiting: joinWaitingSummary(
            frame,
            nodeId,
            token,
            blockersAt(rt, frame, nodeId, token),
          ),
        },
        duration_ms: 0,
      };
    }
  }
}

function clearJoinPlaceholders(ctx: ExecutionContext) {
  for (const [id, result] of Object.entries(ctx.nodeResults)) {
    if ((result?.output as Record<string, unknown> | undefined)?._join_waiting) {
      delete ctx.nodeResults[id];
      ctx.executedNodes.delete(id);
    }
  }
}

/** pause_variables: the run's variables plus, when needed, the parallel state. */
function pauseVariablesOf(ctx: ExecutionContext): Record<string, unknown> {
  const rt = ctx.parallel;
  const { [PARALLEL_STATE_KEY]: _drop, ...variables } = ctx.variables;
  if (!rt || !parallelStateIsActive(rt.state)) return variables;
  rt.state.wait_events = rt.state.waits.map((w) => w.event_id);
  rt.state.rev += 1;
  return { ...variables, [PARALLEL_STATE_KEY]: rt.state };
}

/**
 * Store the completion of a wait the run is not waiting on right now (a
 * second user task / delay of a Parallel node): applied when the run gets to
 * that wait. `active`: the run is waiting on it (resume it normally); `busy`:
 * the run is running or the write raced a resume (try again later); `gone`:
 * no such open wait.
 */
export async function recordDeferredWaitCompletion(
  supabase: SupabaseClient,
  target: { runId: string; eventId: string; workflowId: string; tenantId: string },
  variables: Record<string, unknown>,
): Promise<"stored" | "active" | "busy" | "gone"> {
  const { data: run } = (await supabase
    .from("workflow_runs")
    .select("id, status, event_id, pause_variables")
    .eq("id", target.runId)
    .eq("workflow_id", target.workflowId)
    .eq("tenant_id", target.tenantId)
    .maybeSingle()) as {
    data: { id: string; status: string; event_id: string | null; pause_variables: Record<string, unknown> | null } | null;
  };
  if (!run) return "gone";
  const resumable = RESUMABLE_RUN_STATUSES.includes(run.status);
  if (resumable && run.event_id === target.eventId) return "active";
  if (run.status === "running") return "busy";
  if (!resumable) return "gone";
  const pauseVariables = run.pause_variables ?? {};
  const state = readParallelState(pauseVariables[PARALLEL_STATE_KEY]);
  if (!state.waits.some((w) => w.event_id === target.eventId)) return "gone";
  if (state.completed[target.eventId]) return "stored";
  const rev = state.rev;
  state.completed[target.eventId] = variables;
  state.rev += 1;
  const { data: updated } = (await supabase
    .from("workflow_runs")
    .update({ pause_variables: { ...pauseVariables, [PARALLEL_STATE_KEY]: state } as never })
    .eq("id", run.id)
    .eq("status", run.status)
    .eq("event_id", String(run.event_id))
    .eq(`pause_variables->${PARALLEL_STATE_KEY}->>rev`, String(rev))
    .select("id")) as { data: unknown[] | null };
  return updated && updated.length > 0 ? "stored" : "busy";
}

async function executeNode(
  node: WorkflowNode,
  allNodes: WorkflowNode[],
  allEdges: WorkflowEdge[],
  ctx: ExecutionContext,
  /** The Parallel branch path this step runs on (none outside a Parallel). */
  scope?: BranchScope,
  /** A join being run: skip the join check of this level for this step. */
  passed?: BranchScope,
): Promise<void> {
  // A join of a Parallel node: wait here while another branch can still arrive.
  if (scope && arriveAtJoin(node, ctx, scope, passed)) return;
  // Skip if already executed (prevents duplicate execution when multiple paths converge)
  if (ctx.executedNodes.has(node.id)) return;
  ctx.executedNodes.add(node.id);
  boundRunMemory(ctx);
  traceNodeVisit(ctx, node, "enter");

  const start = Date.now();

  // Async mode: fire action without waiting, proceed immediately
  if (node.executionMode === "async") {
    ctx.onEvent?.({
      type: "node_start",
      node_id: node.id,
      node_label: node.label,
    });
    // Fire and log errors (don't swallow them)
    runNodeAction(node, ctx).catch((err) => {
      ctx.logs.push({
        node_id: node.id,
        node_type: node.type,
        node_label: node.label,
        level: "error",
        message: `Async failed: ${node.label} — ${err.message}`,
        duration_ms: Date.now() - start,
      });
    });
    const dur = Date.now() - start;
    const logEntry = {
      node_id: node.id,
      node_type: node.type,
      node_label: node.label,
      level: "info" as const,
      message: `Fired async: ${node.label}`,
      duration_ms: dur,
      metadata: { async: true },
    };
    ctx.logs.push(logEntry);
    ctx.nodeResults[node.id] = {
      status: "success",
      output: { async: true },
      duration_ms: dur,
    };
    ctx.onEvent?.({
      type: "node_complete",
      node_id: node.id,
      node_label: node.label,
      data: { status: "success", output: { async: true }, duration_ms: dur },
    });
    ctx.onEvent?.({ type: "log", data: logEntry });

    // Continue to next nodes immediately
    const outEdges = getOutgoingEdges(ctx, allEdges, node.id);
    for (const edge of outEdges) {
      const nextNode = getNodeById(ctx, allNodes, edge.target);
      if (nextNode) {
        traceEdgeTraversal(ctx, edge, node, nextNode, "async");
        await executeNode(nextNode, allNodes, allEdges, ctx, scope);
      }
    }
    return;
  }

  ctx.onEvent?.({
    type: "node_start",
    node_id: node.id,
    node_label: node.label,
  });

  // Resolve any live bindings referenced in this node's config (fresh per node;
  // the per-node cache dedupes repeated references within the node).
  if (
    node.type !== "live_reference" &&
    Object.keys(ctx.liveBindings).length > 0
  ) {
    ctx._liveCache = {};
    await resolveLiveBindingsForNode(node, ctx);
  }

  try {
    const output = await runNodeAction(node, ctx);
    const dur = Date.now() - start;
    const logEntry = {
      node_id: node.id,
      node_type: node.type,
      node_label: node.label,
      level: "info",
      message: `Executed: ${node.label}`,
      duration_ms: dur,
      metadata: summarizeOutput(node.type, output),
    };
    ctx.logs.push(logEntry);
    ctx.nodeResults[node.id] = {
      status: "success",
      output,
      duration_ms: dur,
    };
    ctx.onEvent?.({
      type: "node_complete",
      node_id: node.id,
      node_label: node.label,
      data: {
        status: "success",
        output: summarizeOutput(node.type, output),
        duration_ms: dur,
      },
    });
    ctx.onEvent?.({ type: "log", data: logEntry });
    delete ctx._liveCache; // Clear per-node live cache

    // Handle "Go To Activity" — jump to target node instead of following edges
    if (output?.goto) {
      const targetNode = getNodeById(ctx, allNodes, output.goto);
      if (targetNode) {
        // Clear the target AND all downstream nodes so the full subgraph
        // can re-execute (same pattern as loop body re-execution).
        // We skip the goto node during traversal to prevent infinite recursion,
        // then explicitly add it so it can be re-entered on the next iteration.
        const toClear = new Set<string>();
        function collectDownstream(nodeId: string) {
          if (toClear.has(nodeId) || nodeId === node.id) return;
          toClear.add(nodeId);
          for (const e of getOutgoingEdges(ctx, allEdges, nodeId)) {
            collectDownstream(e.target);
          }
        }
        collectDownstream(targetNode.id);
        toClear.add(node.id); // allow this goto node to re-execute in loops
        for (const id of toClear) ctx.executedNodes.delete(id);
        traceNodeVisit(ctx, targetNode, "resume");
        await executeNode(targetNode, allNodes, allEdges, ctx, scope);
      }
      return; // Don't follow normal edges
    }

    // Determine next nodes
    const outEdges = getOutgoingEdges(ctx, allEdges, node.id);

    // Parallel / Sequential: run the branches; their joins run once each
    // (see runParallelNode).
    if (node.type === "parallel") {
      await runParallelNode(node, output, outEdges, allNodes, allEdges, ctx, scope);
      return;
    }

    // For loop nodes, iterate "Each Item" edges per item, then execute "Done" edges once
    if (
      (node.type === "loop" || node.type === "loop_n_times") &&
      output?.items
    ) {
      const items: any[] = output.items;
      const itemVar = output.item_var ?? "item";
      const indexVar = output.index_var ?? "index";

      // Separate loop body edges from done edges
      const bodyEdges = outEdges.filter((e) => {
        const label = (e.label ?? "").toLowerCase().trim();
        return label === "each item" || label === "" || !label;
      });
      const doneEdges = outEdges.filter((e) => {
        const label = (e.label ?? "").toLowerCase().trim();
        return label === "done";
      });
      // If no labeled edges (legacy), treat all as body edges
      const loopEdges =
        bodyEdges.length > 0 || doneEdges.length > 0 ? bodyEdges : outEdges;

      // Collect all node IDs reachable from the loop body so the full
      // chain can be re-executed on every iteration (not just the direct targets).
      const doneTargetIds = new Set(doneEdges.map((e) => e.target));
      const bodyNodeIds = new Set<string>();
      function collectBodyNodes(nodeId: string) {
        if (
          bodyNodeIds.has(nodeId) ||
          nodeId === node.id ||
          doneTargetIds.has(nodeId)
        )
          return;
        bodyNodeIds.add(nodeId);
        for (const e of getOutgoingEdges(ctx, allEdges, nodeId)) {
          collectBodyNodes(e.target);
        }
      }
      for (const e of loopEdges) collectBodyNodes(e.target);

      // A loop inside another loop's body (orders → {{item.lines}}): the
      // outer loop's current item / index stay readable as parent_item /
      // parent_index, and its own variables come back once this loop ends.
      const frames = (ctx.loopFrames ??= []);
      const outer = frames.length ? frames[frames.length - 1] : null;
      const savedVars = outer
        ? [itemVar, indexVar, "parent_item", "parent_index"].map((name) => ({ name, had: Object.prototype.hasOwnProperty.call(ctx.variables, name), value: ctx.variables[name] }))
        : [];
      const frame = { item: undefined as unknown, index: -1 };
      frames.push(frame);
      ctx.loopDepth = (ctx.loopDepth ?? 0) + 1;
      try {
        for (let i = 0; i < items.length; i++) {
          frame.item = items[i];
          frame.index = i;
          ctx.variables[itemVar] = items[i];
          ctx.variables[indexVar] = i;
          if (outer) {
            ctx.variables.parent_item = outer.item;
            ctx.variables.parent_index = outer.index;
          }
          // Clear the entire body subgraph so every node re-runs each iteration
          for (const id of bodyNodeIds) ctx.executedNodes.delete(id);
          for (const edge of loopEdges) {
            const nextNode = getNodeById(ctx, allNodes, edge.target);
            if (nextNode) {
              traceEdgeTraversal(ctx, edge, node, nextNode, "loop_each");
              await executeNode(nextNode, allNodes, allEdges, ctx, scope);
            }
          }
        }
      } finally {
        ctx.loopDepth -= 1;
        frames.pop();
        for (const v of savedVars) {
          if (v.had) ctx.variables[v.name] = v.value;
          else delete ctx.variables[v.name];
        }
      }

      // Execute "Done" edges after loop completes
      for (const edge of doneEdges) {
        const nextNode = getNodeById(ctx, allNodes, edge.target);
        if (nextNode) {
          ctx.executedNodes.delete(nextNode.id);
          traceEdgeTraversal(ctx, edge, node, nextNode, "loop_done");
          await executeNode(nextNode, allNodes, allEdges, ctx, scope);
        }
      }
    } else {
      for (const edge of outEdges) {
        // For condition nodes, check if the edge label matches ANY matched branch
        if (node.type === "condition") {
          const matchedBranches: string[] =
            output?.matched_branches ??
            (output?.matched_branch ? [output.matched_branch] : []);
          if (matchedBranches.length === 0) continue;
          const edgeLabel = (edge.label ?? "").toLowerCase().trim();
          const matchedLower = matchedBranches.map((b: string) =>
            String(b).toLowerCase().trim(),
          );
          // Legacy: support "true"/"false" labels
          if (
            edgeLabel === "true" &&
            !matchedLower.includes("true") &&
            output?.result !== true
          )
            continue;
          if (
            edgeLabel === "false" &&
            !matchedLower.includes("false") &&
            output?.result !== false
          )
            continue;
          // Multi-branch: edge label must match one of the matched branch labels
          if (
            edgeLabel !== "true" &&
            edgeLabel !== "false" &&
            !matchedLower.includes(edgeLabel)
          )
            continue;
        }

        // Wait for signature (already final): edges labelled with an outcome follow that outcome.
        if (node.type === "esign_wait" && !esignEdgeMatches(edge.label, output?.outcome)) continue;

        // For switch/case nodes, route to the matching case edge
        if (node.type === "switch_case") {
          const matchedCase = output?.matched_case;
          if (!matchedCase) continue;
          const edgeLabel = (edge.label ?? "").toLowerCase().trim();
          if (edgeLabel !== String(matchedCase).toLowerCase().trim()) continue;
        }

        const nextNode = getNodeById(ctx, allNodes, edge.target);
        if (nextNode) {
          traceEdgeTraversal(ctx, edge, node, nextNode, "default");
          await executeNode(nextNode, allNodes, allEdges, ctx, scope);
        }
      }
    }
  } catch (error: unknown) {
    // PauseError and __END__ must bubble up to executeWorkflow — don't treat as node errors
    if (error instanceof PauseError) throw error;
    // Child nodes execute inside this try, so a throw from a descendant is
    // re-caught by every ancestor on the call stack. Record each error/end
    // signal exactly ONCE — for the node where it originated — and let
    // ancestors rethrow untouched. Without this, ancestors' success results
    // get clobbered with the child's error and duplicate events are emitted
    // (the trigger card would show the failing action's error).
    const alreadyRecorded =
      typeof error === "object" &&
      error !== null &&
      (error as any).__recordedForNode;
    if (error instanceof EndWorkflowSignal) {
      if (!alreadyRecorded) {
        const dur = Date.now() - start;
        const responseSummary = error.responseSummary;
        const output = {
          reason: error.reason,
          response: responseSummary,
        };
        const logEntry: LogEntry = {
          node_id: node.id,
          node_type: node.type,
          node_label: node.label,
          level: "info",
          message: `Executed: ${node.label}`,
          duration_ms: dur,
          metadata: summarizeOutput(node.type, output),
        };
        ctx.logs.push(logEntry);
        ctx.nodeResults[node.id] = {
          status: "success",
          output,
          duration_ms: dur,
        };
        ctx.onEvent?.({
          type: "node_complete",
          node_id: node.id,
          node_label: node.label,
          data: {
            status: "success",
            output: summarizeOutput(node.type, output),
            duration_ms: dur,
          },
        });
        ctx.onEvent?.({ type: "log", data: logEntry });
        (error as any).__recordedForNode = node.id;
      }
      throw error;
    }
    const errMsg = toErrorMessage(error);
    if (errMsg.startsWith(END_MARKER)) throw error;

    if (!alreadyRecorded) {
      const dur = Date.now() - start;
      const stack =
        error instanceof Error
          ? error.stack?.split("\n").slice(0, 3).join(" ")
          : undefined;
      const logEntry: LogEntry = {
        node_id: node.id,
        node_type: node.type,
        node_label: node.label,
        level: "error",
        message: `Failed: ${node.label} — ${errMsg}`,
        duration_ms: dur,
        metadata: { error: errMsg, stack },
      };
      ctx.logs.push(logEntry);
      ctx.nodeResults[node.id] = {
        status: "error",
        error: errMsg,
        duration_ms: dur,
      };
      traceNodeVisit(ctx, node, "error");
      ctx.onEvent?.({
        type: "node_error",
        node_id: node.id,
        node_label: node.label,
        data: { status: "error", error: errMsg, duration_ms: dur },
      });
      ctx.onEvent?.({ type: "log", data: logEntry });

      // Set error context variables for downstream error handling
      ctx.variables["last_error"] = errMsg;
      ctx.variables["last_error_node"] = node.label;
      ctx.variables["last_error_node_id"] = node.id;
      ctx.variables["last_error_node_type"] = node.type;
      ctx.variables["has_error"] = true;

      if (typeof error === "object" && error !== null)
        (error as any).__recordedForNode = node.id;
    }

    // Check if node is configured to continue on error
    if (node.onError === "continue") {
      ctx.logs.push({
        node_id: node.id,
        node_type: node.type,
        node_label: node.label,
        level: "warn",
        message: `Continuing after error (onError=continue): ${node.label}`,
      });
      // Continue to next nodes despite the error
      const outEdges = getOutgoingEdges(ctx, allEdges, node.id);
      for (const edge of outEdges) {
        const nextNode = getNodeById(ctx, allNodes, edge.target);
        if (nextNode) {
          traceEdgeTraversal(ctx, edge, node, nextNode, "continue_on_error");
          await executeNode(nextNode, allNodes, allEdges, ctx, scope);
        }
      }
      return;
    }

    throw error;
  }
}

/** A step's variable prefix: `_output_prefix`, else its label as snake_case (≤30), else its id. */
function nodeVariablePrefix(node: WorkflowNode): string {
  return (
    node.config?._output_prefix ||
    String(node.label ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 30) ||
    node.id.slice(0, 8)
  );
}

async function runNodeAction(
  node: WorkflowNode,
  ctx: ExecutionContext,
): Promise<any> {
  const config = node.config;
  // Output prefix: user-configurable or auto-generated from node label
  const _prefix = nodeVariablePrefix(node);
  // Helper: set a prefixed variable AND a generic one (generic = latest wins for backward compat)
  function setVar(baseName: string, value: any) {
    ctx.variables[`${_prefix}_${baseName}`] = value;
    ctx.variables[baseName] = value;
  }
  // Warning lines from helpers (doc handlers) attributed to this node.
  function docLog(message: string) {
    ctx.logs.push({
      node_id: node.id,
      node_type: node.type,
      node_label: node.label,
      level: "warn",
      message,
    });
  }
  const { supabase, tenantId, taskId, task } = ctx;

  // Role lookups are cached per run (the engine never writes roles).
  function resolveGovernanceRole() {
    const explicitRoleId = String(
      resolveExpression(config.role_id, ctx) ?? "",
    ).trim();
    const explicitRoleName = String(
      resolveExpression(config.role_name, ctx) ?? "",
    ).trim();
    const key = explicitRoleId ? `id:${explicitRoleId}` : `name:${explicitRoleName}`;
    return cachedLookup(getRunCache(ctx).roles, key, lookupGovernanceRole);
  }

  async function lookupGovernanceRole() {
    const explicitRoleId = String(
      resolveExpression(config.role_id, ctx) ?? "",
    ).trim();
    const explicitRoleName = String(
      resolveExpression(config.role_name, ctx) ?? "",
    ).trim();

    if (explicitRoleId) {
      const { data: role, error } = await (supabase as any)
        .from("roles")
        .select("id, name, slug, is_system")
        .eq("tenant_id", tenantId)
        .eq("id", explicitRoleId)
        .single();
      if (error || !role) throw new Error("Role not found in tenant");
      return role;
    }

    if (!explicitRoleName) throw new Error("No role specified");

    const slug = explicitRoleName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    const { data: roleBySlug, error: slugError } = await (supabase as any)
      .from("roles")
      .select("id, name, slug, is_system")
      .eq("tenant_id", tenantId)
      .eq("slug", slug)
      .maybeSingle();
    if (slugError) throw new Error(`Role lookup failed: ${slugError.message}`);
    if (roleBySlug) return roleBySlug;

    const { data: roleByName, error: nameError } = await (supabase as any)
      .from("roles")
      .select("id, name, slug, is_system")
      .eq("tenant_id", tenantId)
      .eq("name", explicitRoleName)
      .maybeSingle();
    if (nameError) throw new Error(`Role lookup failed: ${nameError.message}`);
    if (!roleByName) throw new Error(`Role "${explicitRoleName}" not found`);
    return roleByName;
  }

  async function resolveGovernanceUser() {
    const userId = String(resolveExpression(config.user_id, ctx) ?? "").trim();
    if (!userId) throw new Error("No user_id");
    const { data: user, error } = await (supabase as any)
      .from("users")
      .select("id, display_name, email")
      .eq("tenant_id" as any, tenantId)
      .eq("id", userId)
      .single();
    if (error || !user) throw new Error("User not found in tenant");
    return user;
  }

  async function logGovernanceAudit(
    action: string,
    targetUserId: string,
    roleId: string,
    details: Record<string, any>,
  ) {
    const actorId = String(
      ctx.variables.workflow_actor_id ??
        ctx.variables.current_user_id ??
        ctx.variables.actor_user_id ??
        workflowOwnerId(ctx) ??
        "",
    ).trim();

    if (!actorId) return false;

    const { error } = await supabase.from("permission_audit_log").insert({
      tenant_id: tenantId,
      actor_id: actorId,
      action,
      target_user_id: targetUserId,
      role_id: roleId,
      details: {
        source: "workflow",
        workflow_run_id: ctx.runId ?? null,
        workflow_task_id: taskId ?? null,
        node_id: node.id,
        node_label: node.label,
        ...details,
      },
    } as any);

    if (error) {
      ctx.logs.push({
        node_id: node.id,
        node_type: node.type,
        node_label: node.label,
        level: "warn",
        message: `Governance audit log failed: ${error.message}`,
      });
      return false;
    }

    return true;
  }

  function resolveWorkflowActorId() {
    return String(
      ctx.variables.workflow_actor_id ??
        ctx.variables.current_user_id ??
        ctx.variables.actor_user_id ??
        workflowOwnerId(ctx) ??
        task?.assignee_id ??
        task?.assigner_id ??
        "",
    ).trim();
  }

  switch (node.type) {
    // ─── Triggers (no-op, they just start the flow) ───
    case "task_created":
    case "task_received":
    case "task_submitted":
    case "task_updated":
    case "task_completed":
    case "task_rejected":
    case "workflow_error":
    case "workflow_sla":
    case "retention_policy_review":
    case "retention_policy_executed":
    case "data_table_event":
    case "form_submitted":
    case "middleware_received":
    case "schedule":
    case "webhook_received":
    case "esign_event":
    case "manual":
      return { triggered: true, task_id: taskId };

    // ─── Parallel / Sequential branching ───
    case "parallel": {
      const mode = config.mode ?? "parallel";
      // {label, order} objects (the designer) or plain labels.
      const branches = parallelBranchLabels(config.branches);
      return {
        mode,
        branch_count: branches.length,
        branches,
      };
    }

    // ─── Call Sub Workflow — execute another workflow inline ───
    case "call_sub_workflow": {
      const subWorkflowId = config.sub_workflow_id;
      if (!subWorkflowId)
        return { skipped: true, reason: "No sub-workflow selected" };

      // Build input variables from mappings
      const inputMappings = (config.input_mappings ?? {}) as Record<
        string,
        string
      >;
      const subVariables: Record<string, any> = {};
      for (const [name, expr] of Object.entries(inputMappings)) {
        if (expr && expr.trim()) {
          subVariables[name] = resolveExpression(expr, ctx);
        }
      }

      // Also pass through parent variables that aren't explicitly mapped
      for (const [key, val] of Object.entries(ctx.variables)) {
        if (!(key in subVariables) && !key.startsWith("_")) {
          subVariables[key] = val;
        }
      }

      // The sub-run is started by whoever started this run.
      const subInitiator = initiatorFromRunVariables(ctx.variables, "subworkflow");
      if (node.executionMode === "async") {
        // Fire and forget — don't wait
        executeWorkflow(subWorkflowId, taskId, false, subVariables, undefined, undefined, undefined, {
          supabase,
          initiator: subInitiator,
        }).catch(
          (err) => {
            ctx.logs.push({
              level: "error",
              message: `Async sub-workflow failed: ${err.message}`,
              node_id: node.id,
              node_type: node.type,
              node_label: node.label,
            });
          },
        );
        return {
          mode: "async",
          sub_workflow_id: subWorkflowId,
          sub_workflow_name: config.sub_workflow_name,
        };
      }

      // Sync — execute and wait, merge logs
      try {
        ctx.logs.push({
          node_id: node.id,
          node_type: node.type,
          node_label: node.label,
          level: "info",
          message: `Starting sub-workflow: ${config.sub_workflow_name ?? subWorkflowId}`,
        });

        const subResult = await executeWorkflow(
          subWorkflowId,
          taskId,
          false,
          subVariables,
          undefined,
          undefined,
          undefined,
          { supabase, initiator: subInitiator },
        );

        // Merge sub-workflow logs into the parent's returned/streamed logs. They
        // are already stored under the sub-workflow's own run, so they are not
        // written again under the parent run — one summary line links to it.
        if (subResult.logs) {
          for (const log of subResult.logs) {
            ctx.logs.push({
              ...log,
              message: `[Sub: ${config.sub_workflow_name ?? "workflow"}] ${log.message}`,
              persist: false,
            });
          }
        }
        ctx.logs.push({
          node_id: node.id,
          node_type: node.type,
          node_label: node.label,
          level: subResult.status === "failed" ? "error" : "info",
          message: `Sub-workflow ${config.sub_workflow_name ?? subWorkflowId} ${subResult.status} (run ${subResult.run_id ?? "n/a"}, ${subResult.logs?.length ?? 0} log entries)`,
          metadata: { sub_run_id: subResult.run_id ?? null, sub_status: subResult.status },
        });

        // Store sub-workflow results in parent variables
        setVar("status", subResult.status);
        setVar("results", subResult.node_results);
        setVar("error", subResult.error ?? null);
        // Backward compat
        ctx.variables["sub_workflow_status"] = subResult.status;
        ctx.variables["sub_workflow_results"] = subResult.node_results;
        ctx.variables["sub_workflow_error"] = subResult.error ?? null;

        if (subResult.status === "failed") {
          throw new Error(
            `Sub-workflow failed: ${subResult.error ?? "Unknown error"}`,
          );
        }

        return {
          status: subResult.status,
          sub_workflow_id: subWorkflowId,
          sub_workflow_name: config.sub_workflow_name,
          node_count: Object.keys(subResult.node_results).length,
        };
      } catch (e: unknown) {
        if (e instanceof PauseError) throw e; // Bubble up if sub-workflow pauses
        throw new Error(`Sub-workflow failed: ${toErrorMessage(e)}`);
      }
    }

    case "decision_table": {
      const decisionTableId = String(config.decision_table_id ?? "").trim();
      if (!decisionTableId)
        return { skipped: true, reason: "No business rule selected" };

      const table = await cachedLookup(
        getRunCache(ctx).decisionTables,
        decisionTableId,
        async () => {
          const { data, error } = await supabase
            .from("decision_tables")
            .select("id, name, inputs, outputs, rules")
            .eq("tenant_id", tenantId)
            .eq("id", decisionTableId)
            .single();
          if (error || !data) throw new Error("Business rule not found");
          return data;
        },
      );

      const inputMappings = (config.input_mappings ?? {}) as Record<
        string,
        string
      >;
      const resolvedInputs: Record<string, any> = {};
      for (const input of (table.inputs ?? []) as any[]) {
        if (!input?.key) continue;
        resolvedInputs[input.key] = resolveExpression(
          inputMappings[input.key] ?? "",
          ctx,
        );
      }

      const result = evaluateDecisionTable(
        (table.inputs ?? []) as any[],
        (table.rules ?? []) as any[],
        resolvedInputs,
      );


      setVar("matched", result.matched);
      setVar("rule_id", result.rule?.id ?? null);
      setVar("rule_label", result.rule?.label ?? null);
      setVar("outputs", result.outputs);
      for (const [key, value] of Object.entries(result.outputs)) {
        setVar(key, value);
      }

      return {
        decision_table_id: table.id,
        decision_table_name: table.name,
        inputs: resolvedInputs,
        matched: result.matched,
        rule_id: result.rule?.id ?? null,
        rule_label: result.rule?.label ?? null,
        outputs: result.outputs,
      };
    }

    case "retention_policies": {
      const operation = String(config.operation ?? "list_policies");
      const normalizeAppliesTo = (value: unknown) => {
        const allowed = new Set(["data_tables", "data_rows", "roles"]);
        if (!Array.isArray(value)) return ["data_tables", "data_rows", "roles"];
        const next = value
          .map((item) => String(item ?? "").trim())
          .filter((item) => allowed.has(item));
        return next.length > 0
          ? next
          : ["data_tables", "data_rows", "roles"];
      };
      const isIsoDate = (value: string) =>
        !Number.isNaN(new Date(value).getTime());

      if (operation === "list_policies") {
        const scope = String(
          resolveExpression(config.scope, ctx) ?? config.scope ?? "",
        ).trim();
        let query = (supabase as any)
          .from("retention_policies")
          .select(
            "id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to, created_at, updated_at",
          )
          .eq("tenant_id", tenantId)
          .order("name");

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        const policies = (data ?? []).filter((policy: any) => {
          if (!scope) return true;
          return (
            Array.isArray(policy.applies_to) &&
            policy.applies_to.includes(scope)
          );
        });
        const result = {
          operation,
          policy_count: policies.length,
          policies,
        };
        setVar("policy_count", policies.length);
        setVar("policies", policies);
        return result;
      }

      if (operation === "create_policy") {
        const actorId = resolveWorkflowActorId();
        if (!actorId)
          throw new Error(
            "Retention Policies action could not determine the workflow actor",
          );

        const name = String(resolveExpression(config.name, ctx) ?? "").trim();
        if (!name) throw new Error("Policy name is required");

        const policyMode = String(
          resolveExpression(config.policy_mode, ctx) ??
            config.policy_mode ??
            "",
        ).trim();
        if (
          ![
            "review",
            "review_on_exact_date",
            "purge_on",
            "purge_on_exact_date",
            "keep_forever",
          ].includes(policyMode)
        ) {
          throw new Error("Policy mode is invalid");
        }

        let durationValue: number | null = null;
        let durationUnit: string | null = null;
        let exactDate: string | null = null;

        if (
          policyMode === "review_on_exact_date" ||
          policyMode === "purge_on_exact_date"
        ) {
          const rawExactDate = String(
            resolveExpression(config.exact_date, ctx) ??
              config.exact_date ??
              "",
          ).trim();
          if (!rawExactDate || !isIsoDate(rawExactDate))
            throw new Error("A valid exact date is required");
          exactDate = new Date(rawExactDate).toISOString();
        } else if (policyMode !== "keep_forever") {
          durationValue = Number(
            resolveExpression(config.duration_value, ctx) ??
              config.duration_value ??
              0,
          );
          durationUnit = String(
            resolveExpression(config.duration_unit, ctx) ??
              config.duration_unit ??
              "",
          ).trim();
          if (!Number.isFinite(durationValue) || durationValue <= 0)
            throw new Error("Retention duration must be greater than 0");
          if (!["days", "months", "years"].includes(durationUnit))
            throw new Error(
              "Retention duration unit must be days, months, or years",
            );
        }

        const appliesToRaw = resolveExpression(config.applies_to, ctx);
        const appliesTo = normalizeAppliesTo(
          typeof appliesToRaw === "string"
            ? (() => {
                try {
                  return JSON.parse(appliesToRaw);
                } catch {
                  return String(appliesToRaw)
                    .split(",")
                    .map((item) => item.trim());
                }
              })()
            : Array.isArray(appliesToRaw)
              ? appliesToRaw
              : config.applies_to,
        );
        if (
          appliesTo.includes("roles") &&
          ["purge_on", "purge_on_exact_date"].includes(policyMode)
        ) {
          throw new Error(
            "Roles support review-style retention policies only. Purge policies cannot target roles.",
          );
        }

        const { data, error } = await (supabase as any)
          .from("retention_policies")
          .insert({
            tenant_id: tenantId,
            name,
            description:
              String(
                resolveExpression(config.description, ctx) ??
                  config.description ??
                  "",
              ).trim() || null,
            policy_mode: policyMode,
            duration_value: durationValue,
            duration_unit: durationUnit,
            exact_date: exactDate,
            applies_to: appliesTo,
            created_by: actorId,
            updated_by: actorId,
          })
          .select(
            "id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to",
          )
          .single();
        if (error || !data)
          throw new Error(
            error?.message ?? "Failed to create retention policy",
          );

        const result = {
          operation,
          created: true,
          retention_policy_id: data.id,
          retention_policy_name: data.name,
          policy: data,
        };
        setVar("retention_policy_id", data.id);
        setVar("retention_policy_name", data.name);
        setVar("policy", data);
        return result;
      }

      if (operation === "delete_policy") {
        const retentionPolicyId = String(
          resolveExpression(config.retention_policy_id, ctx) ??
            config.retention_policy_id ??
            "",
        ).trim();
        if (!retentionPolicyId) throw new Error("Retention policy is required");

        const [
          { count: tableCount },
          { count: rowCount },
          { count: roleCount },
        ] = await Promise.all([
          (supabase as any)
            .from("custom_tables")
            .select("*", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("retention_policy_id", retentionPolicyId),
          (supabase as any)
            .from("custom_table_rows")
            .select("*", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("retention_policy_id", retentionPolicyId),
          (supabase as any)
            .from("roles")
            .select("*", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("retention_policy_id", retentionPolicyId),
        ]);
        if (
          (tableCount ?? 0) > 0 ||
          (rowCount ?? 0) > 0 ||
          (roleCount ?? 0) > 0
        ) {
          throw new Error(
            "Remove this policy from tables, rows, and roles before deleting it",
          );
        }

        const { error } = await (supabase as any)
          .from("retention_policies")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("id", retentionPolicyId);
        if (error) throw new Error(error.message);

        const result = {
          operation,
          deleted: true,
          retention_policy_id: retentionPolicyId,
        };
        setVar("retention_policy_id", retentionPolicyId);
        return result;
      }

      if (operation === "list_assets") {
        const retentionPolicyId = String(
          resolveExpression(config.retention_policy_id, ctx) ??
            config.retention_policy_id ??
            "",
        ).trim();
        if (!retentionPolicyId) throw new Error("Retention policy is required");

        const [tablesResult, rowsResult, rolesResult] = await Promise.all([
          (supabase as any)
            .from("custom_tables")
            .select("id, name, updated_at")
            .eq("tenant_id", tenantId)
            .eq("retention_policy_id", retentionPolicyId)
            .order("name"),
          (supabase as any)
            .from("custom_table_rows")
            .select("id, table_id, data, updated_at")
            .eq("tenant_id", tenantId)
            .eq("retention_policy_id", retentionPolicyId)
            .order("updated_at", { ascending: false })
            .limit(200),
          (supabase as any)
            .from("roles")
            .select("id, name, slug, updated_at")
            .eq("tenant_id", tenantId)
            .eq("retention_policy_id", retentionPolicyId)
            .order("name"),
        ]);

        if (tablesResult.error) throw new Error(tablesResult.error.message);
        if (rowsResult.error) throw new Error(rowsResult.error.message);
        if (rolesResult.error) throw new Error(rolesResult.error.message);

        const dataTables = tablesResult.data ?? [];
        const roles = rolesResult.data ?? [];
        const dataRows = (rowsResult.data ?? []).map((row: any) => ({
          id: row.id,
          table_id: row.table_id,
          updated_at: row.updated_at,
          summary:
            typeof row.data === "object" && row.data
              ? Object.fromEntries(Object.entries(row.data).slice(0, 6))
              : {},
        }));

        const assets = {
          data_tables: dataTables,
          data_rows: dataRows,
          roles,
        };
        const assetCount = dataTables.length + dataRows.length + roles.length;
        const result = {
          operation,
          retention_policy_id: retentionPolicyId,
          asset_count: assetCount,
          assets,
        };
        setVar("retention_policy_id", retentionPolicyId);
        setVar("asset_count", assetCount);
        setVar("assets", assets);
        setVar("data_tables", dataTables);
        setVar("data_rows", dataRows);
        setVar("roles", roles);
        return result;
      }

      if (operation === "assign_policy") {
        const actorId = resolveWorkflowActorId();
        if (!actorId)
          throw new Error(
            "Retention Policies action could not determine the workflow actor",
          );

        const targetType = String(
          resolveExpression(config.target_type, ctx) ??
            config.target_type ??
            "",
        ).trim();
        const targetId = String(
          resolveExpression(config.target_id, ctx) ?? config.target_id ?? "",
        ).trim();
        const retentionPolicyId =
          String(
            resolveExpression(config.retention_policy_id, ctx) ??
              config.retention_policy_id ??
              "",
          ).trim() || null;
        if (!["data_table", "data_row", "role"].includes(targetType))
          throw new Error("Target type is invalid");
        if (!targetId) throw new Error("Target ID is required");

        if (retentionPolicyId) {
          const expectedScope =
            targetType === "data_row"
              ? "data_rows"
              : targetType === "role"
                ? "roles"
                : "data_tables";
          const { data: policy, error: policyError } = await (supabase as any)
            .from("retention_policies")
            .select("id, applies_to")
            .eq("tenant_id", tenantId)
            .eq("id", retentionPolicyId)
            .single();
          if (policyError || !policy)
            throw new Error(
              policyError?.message ?? "Retention policy not found",
            );
          if (
            Array.isArray(policy.applies_to) &&
            !policy.applies_to.includes(expectedScope)
          ) {
            throw new Error(
              "That retention policy cannot be applied to this object type",
            );
          }
        }

        const tableName =
          targetType === "data_table"
            ? "custom_tables"
            : targetType === "role"
              ? "roles"
              : "custom_table_rows";

        if (targetType === "role" && retentionPolicyId) {
          const { data: policyModeRow, error: policyModeError } = await (
            supabase as any
          )
            .from("retention_policies")
            .select("policy_mode")
            .eq("tenant_id", tenantId)
            .eq("id", retentionPolicyId)
            .single();
          if (policyModeError || !policyModeRow)
            throw new Error(
              policyModeError?.message ?? "Retention policy not found",
            );
          if (
            ["purge_on", "purge_on_exact_date"].includes(
              String(policyModeRow.policy_mode ?? ""),
            )
          ) {
            throw new Error(
              "Roles support review-style retention policies only. Purge policies cannot be applied to roles.",
            );
          }
        }

        const updatePayload: Record<string, any> = {
          retention_policy_id: retentionPolicyId,
        };
        if (tableName !== "custom_table_rows") {
          updatePayload.retention_applied_at = retentionPolicyId
            ? new Date().toISOString()
            : null;
        }
        const { error } = await (supabase as any)
          .from(tableName)
          .update(updatePayload)
          .eq("tenant_id", tenantId)
          .eq("id", targetId);
        if (error) throw new Error(error.message);

        const result = {
          operation,
          target_type: targetType,
          target_id: targetId,
          retention_policy_id: retentionPolicyId,
          assigned: true,
        };
        setVar("target_type", targetType);
        setVar("target_id", targetId);
        setVar("retention_policy_id", retentionPolicyId);
        return result;
      }

      throw new Error(`Unsupported retention policy operation: ${operation}`);
    }

    case "custom_activity": {
      // Custom workflow action (Extensibility): the code is always read from
      // the workspace library (never from the workflow definition) and runs
      // in the QuickJS sandbox — lib/custom-actions/execute.ts.
      const activityId = String(config.custom_activity_id ?? "").trim();
      const activityKey = String(config.custom_activity_key ?? "").trim();
      const activityName = String(
        config.activity_name ?? node.label ?? activityKey ?? "Custom action",
      ).trim();
      if (!activityId && !activityKey)
        return { skipped: true, reason: "No custom action selected" };
      const stored = await loadStoredAction(supabase, tenantId, {
        id: activityId,
        key: activityKey,
        version: config.custom_activity_version ?? null,
      });
      if (!stored)
        throw new Error(
          `Custom action "${activityName}" is not installed in this workspace (Extensibility → Workflow actions)`,
        );
      const actionManifest = actionManifestOf(stored);
      const actionOperation = operationOf(actionManifest, config.operation);
      const inputMappings = (config.input_mappings ?? {}) as Record<string, unknown>;
      const rawInputs: Record<string, any> = {};
      for (const input of actionOperation?.inputs ?? []) {
        const mapped = inputMappings[input.name];
        if (typeof mapped === "string" ? mapped.trim() : mapped !== undefined && mapped !== null) {
          rawInputs[input.name] = typeof mapped === "string" ? resolveExpression(mapped, ctx) : mapped;
        } else if (stored.runtime !== "module") {
          rawInputs[input.name] = input.default ?? null;
        }
      }
      // Retries: retryable failures (time limit, a host call that failed,
      // ctx.fail(…, { retryable: true })) are tried again with backoff.
      const retryable = Math.max(0, Math.min(5, Number(config.retry_attempts ?? 2) || 0));
      let attempt = 0;
      let actionResult: Awaited<ReturnType<typeof executeStoredAction>> | null = null;
      for (;;) {
        attempt += 1;
        try {
          actionResult = await executeStoredAction({
            db: supabase,
            tenantId,
            action: stored,
            operation: config.operation ?? null,
            inputs: rawInputs,
            actorId: (ctx.variables?.started_by_user_id as string | undefined) ?? null,
            run: { id: ctx.runId ?? null, workflow_id: ctx.workflowId ?? null, step_id: node.id, test: Boolean(ctx.isTest) },
            timeoutMs: config.timeout_ms != null && config.timeout_ms !== "" ? Number(resolveExpression(config.timeout_ms, ctx)) : null,
            legacy: stored.runtime === "module" ? undefined : {
              context: {
                tenantId,
                runId: ctx.runId ?? null,
                taskId: taskId ?? null,
                task: ctx.task ?? null,
                variables: ctx.variables,
                node: { id: node.id, label: node.label, type: node.type, activityId: stored.id, activityKey: stored.key, activityName },
              },
              variables: ctx.variables,
              resolveExpression: (expression: string) => resolveExpression(expression, ctx),
            },
          });
          break;
        } catch (error) {
          const runError = error instanceof ActionRunError ? error : null;
          for (const entry of runError?.logs ?? []) {
            ctx.logs.push({ node_id: node.id, node_type: node.type, node_label: node.label, level: entry.level, message: `[${activityName}] ${entry.message}`, metadata: entry.metadata });
          }
          if (runError?.retryable && attempt <= retryable) {
            ctx.logs.push({ node_id: node.id, node_type: node.type, node_label: node.label, level: "warn", message: `[${activityName}] attempt ${attempt} failed (${runError.code}): ${runError.message} — retrying` });
            await new Promise((resolve) => setTimeout(resolve, Math.min(4000, 250 * 2 ** (attempt - 1))));
            continue;
          }
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`${activityName}: ${message}${runError ? ` [${runError.code}]` : ""}`);
        }
      }
      const result = actionResult!;
      let resolvedOutputs: Record<string, any> = result.outputs;
      let summaryText: unknown = null;
      let metadataValue: unknown = null;
      if (result.legacy) {
        const normalized = normalizeCustomActivityResult(result.legacy.raw);
        resolvedOutputs = normalized.outputs ?? {};
        summaryText = normalized.summary ?? null;
        metadataValue = normalized.metadata ?? null;
        for (const [name, value] of Object.entries(result.legacy.variables)) ctx.variables[name] = value;
        for (const entry of normalized.logs) {
          if (entry?.message) ctx.logs.push({ node_id: node.id, node_type: node.type, node_label: node.label, level: entry.level ?? "info", message: `[${activityName}] ${entry.message}`, metadata: entry.metadata });
        }
        const declared = (result.operation.outputs ?? []).map((o) => o.name);
        const missing = declared.filter((name) => !Object.prototype.hasOwnProperty.call(resolvedOutputs, name));
        if (declared.length && missing.length) result.warnings.push(`did not return declared outputs: ${missing.join(", ")}`);
      }
      for (const [name, value] of Object.entries(resolvedOutputs)) {
        setVar(name, value);
      }
      ctx.variables[`${_prefix}_outputs`] = resolvedOutputs;
      ctx.variables[`${_prefix}_meta`] = metadataValue;
      for (const entry of result.logs) {
        ctx.logs.push({ node_id: node.id, node_type: node.type, node_label: node.label, level: entry.level, message: `[${activityName}] ${entry.message}`, metadata: entry.metadata });
      }
      for (const warning of result.warnings) {
        ctx.logs.push({ node_id: node.id, node_type: node.type, node_label: node.label, level: "warn", message: `[${activityName}] ${warning}` });
      }
      ctx.logs.push({
        node_id: node.id, node_type: node.type, node_label: node.label, level: "info",
        message: `[${activityName}] ran ${result.action.key}@${result.action.version} ${result.operation.id} in ${result.stats.duration_ms} ms (${result.stats.host_calls} host call${result.stats.host_calls === 1 ? "" : "s"}${attempt > 1 ? `, attempt ${attempt}` : ""})`,
        metadata: { action: result.action.key, version: result.action.version, sha256: result.action.sha256, operation: result.operation.id, duration_ms: result.stats.duration_ms, host_calls: result.stats.host_calls, memory_bytes: result.stats.memory_bytes, attempts: attempt },
      });

      return {
        activity_id: result.action.id,
        activity_key: result.action.key,
        activity_name: activityName,
        action_version: result.action.version,
        operation: result.operation.id,
        input_count: Object.keys(rawInputs).length,
        output_count: Object.keys(resolvedOutputs).length,
        outputs: resolvedOutputs,
        summary: summaryText,
        metadata: metadataValue,
        stats: { ...result.stats, attempts: attempt },
        ...(result.warnings.length ? { warnings: result.warnings } : {}),
      };
    }

    // ─── User Task — create a human task and pause workflow ───
    case "user_task": {
      const taskTitle =
        resolveExpression(config.task_title, ctx) ?? "Untitled Task";
      // May be HTML: interpolated values are escaped, the result sanitised.
      const taskDescription = resolveTaskDescriptionTemplate(
        config.task_description,
        { variables: ctx.variables, task: ctx.task },
      );
      const priority = config.task_priority ?? "medium";
      const outcomes = (config.outcomes ?? []) as string[];
      const workflowActorId = resolveWorkflowActorId();
      // The step's form: a linked reusable form (pinned version in a
      // published snapshot, else the latest) or the node's own fields.
      const runtimeForm = await resolveRuntimeForm(supabase, tenantId, config, { useDraft: Boolean(ctx.isTest && ctx.testFormDrafts) });
      // Lookup filters / reference inputs may use workflow {{variables}}:
      // resolved now; {{task_data.<key>}} / {{search}} stay for the lookup.
      const taskFields = (
        await resolveOptionSources(supabase, tenantId, runtimeForm.fields)
      ).map((field) =>
        field.type === "lookup" && field.lookup
          ? {
              ...field,
              lookup: preResolveLookupConfig(field.lookup, (path) =>
                resolveExpression(`{{${path}}}`, ctx),
              ),
            }
          : field.type === "data_table" && field.data_table
            ? {
                ...field,
                // Base filter / API inputs: workflow {{variables}} now; {{form.x}}, {{user.*}}, dates, paging at query time.
                data_table: preResolveDataTableConfig(field.data_table, (path) =>
                  resolveExpression(`{{${path}}}`, ctx),
                ),
              }
            : field,
      );
      const taskFormLayout = runtimeForm.layout
        ? compactLayoutForSave(
            runtimeForm.layout,
            taskFields.map((f) => f.key),
          )
        : null;
      // Form parameters (lib/forms/form-params.ts): the step's mapping, resolved now and stored on the task.
      const taskFormParams = resolveContextParams(runtimeForm.layout, config.form_params, (template) =>
        resolveExpression(template, ctx),
      );
      // Values the task opens with: each field's default, then the step's
      // own prefill map (config.field_values) — the reusable form is untouched.
      const resolveTaskValue = (value: string) =>
        resolveExpression(substituteParams(value, taskFormParams), ctx);
      const taskFieldValues = {
        ...defaultTaskFieldValues(taskFields, resolveTaskValue),
        ...stepFieldValues(taskFields, config.field_values, resolveTaskValue),
      };

      // In test mode: don't create a real task, emit event for inline action in test runner
      if (ctx.isTest) {
        const eventId = generateEventId();
        ctx.variables["user_task_id"] = `test_${eventId}`;
        ctx.variables["user_task_event_id"] = eventId;
        setVar("task_id", `test_${eventId}`);
        setVar("event_id", eventId);
        // Emit a special test_user_task event so the test runner can show inline action UI
        const prompt = {
          status: "test_user_task",
          event_id: eventId,
          task_title: taskTitle,
          task_description: taskDescription,
          outcomes: outcomes.length > 0 ? outcomes : ["completed"],
          priority,
          fields: taskFields,
          values: taskFieldValues,
          form_layout: taskFormLayout,
          form_params: taskFormParams,
          form_theme: runtimeForm.theme_overrides,
          form_buttons: runtimeForm.buttons ?? null,
          form_header: runtimeForm.header?.enabled ? runtimeForm.header : null,
        };
        ctx.onEvent?.({
          type: "node_complete",
          node_id: node.id,
          node_label: node.label,
          data: prompt,
        });
        throw withTestPrompt(new PauseError(eventId, node.id), node, prompt);
      }
      const assignmentType = config.assignment_type ?? "individual";

      // Resolve assignee
      let assigneeId = config.assignee_id || null;
      if (config.assignee_variable) {
        const resolved = resolveExpression(config.assignee_variable, ctx);
        if (resolved) assigneeId = resolved;
      }
      let teamId = config.team_id || null;

      // AAD (Entra ID) group: members resolved through Microsoft Graph and
      // mapped to workspace members (lib/tasks/aad-group-runtime.ts). Claim:
      // candidates who can claim one unassigned task; everyone: a
      // collaborative task. Nobody resolved → created unassigned (logged).
      let aadGroup: AadGroupPlanResult | null = null;
      let groupMode: "claim" | "everyone" | null = null;
      let groupUserIds: string[] = [];
      if (assignmentType === "aad_group") {
        const { planAadGroupAssignment } = await import("./tasks/aad-group-runtime");
        aadGroup = await planAadGroupAssignment(supabase as any, tenantId, config);
        for (const line of aadGroup.logs) {
          ctx.logs.push({ node_id: node.id, node_type: node.type, node_label: node.label, level: line.level, message: line.message, metadata: { aad_group: aadGroup.metadata } });
        }
        assigneeId = null;
        teamId = null;
        const plan = aadGroup.plan;
        if (plan.kind === "single") assigneeId = plan.userId;
        else if (plan.kind === "team") teamId = plan.teamId;
        else if (plan.kind === "everyone") { groupMode = "everyone"; groupUserIds = plan.userIds; assigneeId = plan.userIds[0]; }
        else if (plan.kind === "claim") { groupMode = "claim"; groupUserIds = plan.userIds; }
      }

      // Calculate due date
      let dueDate: string | null = null;
      const dueDateMode = config.due_date_mode ?? "relative";
      if (dueDateMode === "absolute" && config.due_date) {
        dueDate = new Date(
          resolveExpression(config.due_date, ctx),
        ).toISOString();
      } else if (dueDateMode === "relative") {
        const amount = Number(config.due_offset_amount ?? 3);
        const unit = config.due_offset_unit ?? "days";
        const ms =
          unit === "minutes"
            ? amount * TIME_MS.MINUTE
            : unit === "hours"
              ? amount * TIME_MS.HOUR
              : unit === "weeks"
                ? amount * TIME_MS.WEEK
                : amount * TIME_MS.DAY;
        dueDate = new Date(Date.now() + ms).toISOString();
      }

      // Generate event_id for workflow pause/resume
      const eventId = generateEventId();

      // Queued (pending) or added straight to the assignee's tasks: the node's
      // queue_behaviour override, else the assignee's queue rules (a team task
      // with no assignee uses the default rules) — lib/tasks/queue-rules.ts.
      // What the rules can look at: no person assigned it (a workflow did).
      const queueFacts: QueueTaskFacts = {
        priority,
        source: "workflow",
        workflow_id: ctx.workflowId ?? null,
        assigned_by_user_id: null,
        origins: [
          "workflow",
          ...(runtimeForm.form_id ? ["form"] : []),
          ...(assignmentType === "team" ? ["team"] : assignmentType === "aad_group" ? ["aad_group"] : []),
        ],
        form_id: runtimeForm.form_id ?? null,
        assignment: assignmentType === "team" || assignmentType === "aad_group" ? assignmentType : "individual",
        assigned_team_id: teamId ?? null,
        due_date: dueDate,
        title: String(taskTitle),
        description: String(taskDescription),
        has_attachments: false,
        is_subtask: false,
        tags: [],
      };
      const assignmentStatus = assigneeId
        ? (await decideAcceptanceForAssignees(supabase, { tenantId, assigneeIds: [assigneeId], facts: queueFacts, override: config.queue_behaviour })).get(assigneeId) ?? "pending"
        : decideAcceptance({ preferences: null, facts: queueFacts, override: config.queue_behaviour });

      // Create the task
      const { data: newTask, error: taskError } = await insertWithOptionalColumns(supabase, "tasks", {
          tenant_id: tenantId,
          // The run this task belongs to (Home: stages, people involved).
          workflow_run_id: ctx.runId ?? null,
          title: String(taskTitle),
          description: String(taskDescription),
          priority,
          allow_reassign: config.allow_redirect === true,
          assignee_id: assignmentType === "individual" || assignmentType === "aad_group" ? assigneeId : null,
          assigned_team_id: assignmentType === "team" || assignmentType === "aad_group" ? teamId : null,
          assignment_type: assignmentType,
          // AAD claim tasks are an unclaimed pool like team tasks; everyone → collaborative.
          assignment_mode:
            assignmentType === "team" || groupMode === "claim" || (assignmentType === "aad_group" && teamId)
              ? "team"
              : groupMode === "everyone"
                ? "collaborative"
                : "single",
          acceptance_status: assignmentStatus,
          is_workflow_task: true,
          event_id: eventId,
          due_date: dueDate,
          due_date_mode: dueDateMode,
          due_date_offset:
            dueDateMode === "relative"
              ? {
                  amount: config.due_offset_amount ?? 3,
                  unit: config.due_offset_unit ?? "days",
                }
              : null,
          available_outcomes: outcomes.length > 0 ? outcomes : null,
          // The native workflow link. workflow_source_id is a FK to
          // workflow_sources (external engines that ingest tasks) and must
          // stay null here — writing the workflow id there failed every run.
          workflow_id: ctx.workflowId ?? null,
          workflow_step_id: node.id,
          metadata: {
            // A claimed task has one assignee: the first response completes it.
            completion_rule: groupMode === "claim" ? "first_response" : config.completion_rule ?? "first_response",
            ...(aadGroup ? { aad_group: aadGroup.metadata } : {}),
            min_responses: config.min_responses,
            custom_rule_expression: config.custom_rule_expression,
            custom_rule_outcome: config.custom_rule_outcome,
            fields: taskFields,
            template_values: taskFieldValues,
            // Grid layout and resolved mini theme (absent → classic form).
            ...(taskFormLayout ? { form_layout: taskFormLayout } : {}),
            ...(Object.keys(taskFormParams).length ? { form_params: taskFormParams } : {}),
            ...(runtimeForm.theme_overrides
              ? { form_theme: runtimeForm.theme_overrides }
              : {}),
            // Button bar (only when configured — a task keeps its classic
            // outcome buttons otherwise) and header; header texts keep
            // {{task_data.*}} for the form, workflow variables resolve now.
            ...(runtimeForm.buttons ? { form_buttons: runtimeForm.buttons } : {}),
            ...(runtimeForm.header?.enabled
              ? {
                  form_header: {
                    ...runtimeForm.header,
                    title: preResolveLookupTemplate(
                      runtimeForm.header.title ?? "",
                      (path) => resolveExpression(`{{${path}}}`, ctx),
                    ),
                    subtitle: preResolveLookupTemplate(
                      runtimeForm.header.subtitle ?? "",
                      (path) => resolveExpression(`{{${path}}}`, ctx),
                    ),
                  },
                }
              : {}),
            ...(runtimeForm.form_id
              ? {
                  form_ref: {
                    form_id: runtimeForm.form_id,
                    name: runtimeForm.form_name,
                    version: runtimeForm.version,
                  },
                }
              : {}),
            // External form URL (form_type 'url' in the builder) — previously
            // configured in the UI but never persisted anywhere.
            form_url:
              config.form_type === "url" && config.form_url
                ? String(
                    resolveExpression(config.form_url, ctx) ?? "",
                  ).trim() || null
                : null,
            task_actions: {
              allow_redirect: config.allow_redirect === true,
              allow_invite_on_redirect:
                config.allow_invite_on_redirect === true,
              invite_role: config.redirect_invite_role ?? "viewer",
              redirect_assignment_mode:
                config.redirect_assignment_mode ?? "single",
              redirect_recipient_limit_mode:
                config.redirect_recipient_limit_mode ?? "unlimited",
              redirect_recipient_limit:
                config.redirect_recipient_limit_mode === "capped"
                  ? Math.max(1, Number(config.redirect_recipient_limit ?? 1))
                  : null,
            },
          },
          status: "todo",
        }, ["workflow_run_id"]);

      if (taskError)
        throw new Error(`Create user task failed: ${taskError.message}`);
      const taskId2 = newTask?.id;

      // AAD group members: claim candidates (pending until someone claims) or
      // collaborators, each queued or added by their own queue rules.
      if (groupUserIds.length && taskId2) {
        const memberDecisions = groupMode === "everyone"
          ? await decideAcceptanceForAssignees(supabase, {
              tenantId,
              assigneeIds: groupUserIds,
              facts: { ...queueFacts, assignment: "collaborative" },
              override: config.queue_behaviour,
            })
          : new Map<string, "pending" | "accepted">();
        const now = new Date().toISOString();
        const rows = groupUserIds.map((userId, index) => {
          const accepted = groupMode === "everyone" && memberDecisions.get(userId) === "accepted";
          return {
            tenant_id: tenantId,
            task_id: taskId2,
            user_id: userId,
            role: groupMode === "claim" ? "candidate" : index === 0 ? "lead" : "collaborator",
            acceptance_status: accepted ? "accepted" : "pending",
            accepted_at: accepted ? now : null,
          };
        });
        const { error: assigneesError } = await (supabase as any).from("task_assignees").insert(rows);
        if (assigneesError) {
          ctx.logs.push({ node_id: node.id, node_type: node.type, node_label: node.label, level: "warn", message: `AAD group assignment: could not add the group's members to the task (${assigneesError.message})` });
        }
      }

      // Create reminders
      const reminders = (config.reminders ?? []) as {
        offset_minutes: number;
      }[];
      if (reminders.length > 0 && taskId2) {
        await supabase.from("task_reminders" as any).insert(
          reminders.map((r) => ({
            task_id: taskId2,
            tenant_id: tenantId,
            offset_minutes: r.offset_minutes,
          })),
        );
      }

      // Create escalation config
      if (config.escalation_enabled && taskId2) {
        await supabase.from("task_escalations" as any).insert({
          task_id: taskId2,
          tenant_id: tenantId,
          escalation_type: config.escalation_type ?? "manager",
          user_id: config.escalation_user_id || null,
          team_id: config.escalation_team_id || null,
          escalate_after_minutes: config.escalate_after_minutes ?? 60,
        });
      }

      // Make the newly-created task available while rendering its notification template.
      setVar("user_task_id", taskId2);
      setVar("user_task_title", String(taskTitle));
      // Plain text (notification text bodies); the stored HTML is
      // available as user_task_description_html for HTML email bodies.
      setVar("user_task_description", htmlToPlainText(taskDescription));
      setVar("user_task_description_html", String(taskDescription ?? ""));

      // Create notification for the assignee (AAD group: every member)
      const notifyUserIds = groupUserIds.length ? groupUserIds : assigneeId ? [assigneeId] : [];
      if (notifyUserIds.length) {
        if (!ctx.variables.app_url)
          ctx.variables.app_url = configuredAppUrl() ?? "";
        const notificationTemplate = config.notification_template_id
          ? await loadEmailTemplate(
              supabase,
              tenantId,
              String(config.notification_template_id),
            )
          : null;
        const notificationTitle = notificationTemplate
          ? String(
              resolveExpression(notificationTemplate.subject, ctx) ?? "",
            ).trim()
          : groupMode === "claim"
            ? `Task available to claim: ${taskTitle}`
            : `New task: ${taskTitle}`;
        const notificationBody = notificationTemplate
          ? String(
              resolveExpression(notificationTemplate.text_body, ctx) ?? "",
            ).trim()
          : taskDescription
            ? htmlToPlainText(taskDescription).slice(0, 200)
            : "You have been assigned a new task.";
        const notificationRows = notifyUserIds.map((userId) => ({
          user_id: userId,
          tenant_id: tenantId,
          type: "task_assigned",
          title: notificationTitle || `New task: ${taskTitle}`,
          body: (
            notificationBody || "You have been assigned a new task."
          ).slice(0, 2000),
          task_id: taskId2,
        }));
        await supabase.from("notifications").insert(
          notificationRows.length === 1 ? notificationRows[0] : notificationRows,
        );
      }

      // Store task info in variables
      setVar("task_id", taskId2);
      setVar("event_id", eventId);
      // Backward compat
      ctx.variables["user_task_id"] = taskId2;
      ctx.variables["user_task_event_id"] = eventId;

      // Pause the workflow — will resume when task is actioned
      throw new PauseError(eventId, node.id);
    }

    // ─── Placeholder (no-op, passes through) ───
    case "placeholder":
      return {
        placeholder: true,
        note: node.config.note ?? "No action configured",
      };

    case "section_group":
      return { skipped: true, reason: "Section groups are visual only" };

    case "live_reference": {
      const refId = config.reference_id;
      if (!refId) return { skipped: true, reason: "No reference selected" };
      const bindingName =
        config.binding_name || node.label.replace(/\s+/g, "_").toLowerCase();

      // Register the live binding — no API call yet
      ctx.liveBindings[bindingName] = {
        referenceId: refId,
        inputMappings: config.input_mappings ?? {},
        outputPaths: {},
        configSnapshot: { ...config },
      };
      // Build output paths
      const refOutputs = (config._ref_outputs ?? []) as {
        name: string;
        path?: string;
      }[];
      for (const out of refOutputs) {
        ctx.liveBindings[bindingName].outputPaths[out.name] =
          out.path || out.name;
      }

      // Do an EAGER first fetch so that downstream nodes have data immediately
      if (!ctx.variables.live) ctx.variables.live = {};
      try {
        const { executeReference } = await import("@/lib/reference-executor");
        // Resolve input expressions
        const ref = await loadReference(ctx, refId).catch(() => null);
        const resolvedInputs: Record<string, string> = {};
        for (const inp of (ref?.inputs as any[]) ?? []) {
          const mapped = (config.input_mappings ?? {})[inp.name];
          resolvedInputs[inp.name] = mapped
            ? String(resolveExpression(mapped, ctx) ?? inp.default_value ?? "")
            : String(inp.default_value ?? "");
        }
        const result = await executeReference({
          supabase: ctx.supabase,
          referenceId: refId,
          inputValues: resolvedInputs,
          // Live Reference = fresh data on demand: a write reference is refused.
          readOnly: true,
          timeout: 30_000,
          caller: {
            traceId: ctx.traceId ?? ctx.runId ?? "",
            callerType: "workflow_node",
            callerId: ctx.runId ?? null,
            callerNodeId: node.id,
          },
        });
        const data = result.data;
        ctx.variables.live[bindingName] = data;
        ctx.variables[`live_${bindingName}`] = data;
        ctx.logs.push({
          level: "info",
          message: `Live reference '${bindingName}' pre-fetched (${Array.isArray(data) ? data.length + " items" : typeof data})`,
          node_id: node.id,
          node_type: node.type,
          node_label: node.label,
          duration_ms: 0,
        });
        return {
          binding_name: bindingName,
          registered: true,
          prefetched: true,
          data_type: Array.isArray(data) ? "array" : typeof data,
          item_count: Array.isArray(data) ? data.length : undefined,
        };
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        ctx.logs.push({
          level: "warn",
          message: `Live reference '${bindingName}' pre-fetch failed: ${errMsg}`,
          node_id: node.id,
          node_type: node.type,
          node_label: node.label,
          duration_ms: 0,
        });
      }

      // Fallback: set empty placeholder (will be fetched on demand)
      if (!ctx.variables.live[bindingName]) {
        ctx.variables.live[bindingName] = {
          _live: true,
          _binding: bindingName,
        };
      }
      return { binding_name: bindingName, registered: true, prefetched: false };
    }

    // ─── Go To Activity — jump to another node on the canvas ───
    case "goto_activity": {
      const targetNodeId = config.target_node_id;
      if (!targetNodeId)
        return { skipped: true, reason: "No target activity selected" };

      // Apply input overrides to variables before jumping
      const overrides = (config.input_overrides ?? {}) as Record<
        string,
        string
      >;
      for (const [key, val] of Object.entries(overrides)) {
        if (val && val.trim()) {
          ctx.variables[key] = resolveExpression(val, ctx);
        }
      }

      return {
        goto: targetNodeId,
        target_label: config.target_node_label,
        overrides_applied: Object.keys(overrides).filter((k) =>
          overrides[k]?.trim(),
        ),
      };
    }

    // ─── Server Event — pause workflow and wait for external callback ───
    case "server_event": {
      const eventName = resolveExpression(config.event_name, ctx) ?? "event";
      const eventId = generateEventId();

      // In test mode: skip outbound action, emit event for process viewer (like user_task)
      if (ctx.isTest) {
        setVar("event_id", eventId);
        setVar("event_name", eventName);
        ctx.variables["event_id"] = eventId;
        ctx.variables["event_name"] = eventName;
        ctx.onEvent?.({
          type: "node_complete",
          node_id: node.id,
          node_label: node.label,
          data: {
            status: "test_server_event",
            event_id: eventId,
            event_name: eventName,
          },
        });
        throw withTestPrompt(new PauseError(eventId, node.id), node, {
          status: "test_server_event",
          event_id: eventId,
          event_name: eventName,
        });
      }

      // Build outbound payload: variable list (default) or a custom JSON
      // template. Either way the event_id/event_name callback contract is
      // guaranteed — the external system must receive the id to call back.
      const payloadMode =
        config.payload_mode === "custom" ? "custom" : "variables";
      let outboundPayload: Record<string, any> = {
        event_id: eventId,
        event_name: eventName,
      };
      if (
        payloadMode === "custom" &&
        String(config.custom_payload ?? "").trim()
      ) {
        const resolvedTemplate = resolveExpression(
          String(config.custom_payload),
          ctx,
        );
        try {
          const parsed =
            typeof resolvedTemplate === "string"
              ? JSON.parse(resolvedTemplate)
              : resolvedTemplate;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("not an object");
          outboundPayload = {
            event_id: eventId,
            event_name: eventName,
            ...parsed,
          };
        } catch {
          throw new Error(
            "Server Event custom payload is not a valid JSON object after variable resolution",
          );
        }
      } else {
        const sendVars = (config.send_variables ?? []) as string[];
        for (const varName of sendVars) {
          outboundPayload[varName] = ctx.variables[varName] ?? null;
        }
      }

      // Execute outbound action (send event_id to external system)
      const outboundAction = config.outbound_action ?? "none";
      if (outboundAction === "api_reference" && config.reference_id) {
        const referenceInputMappings = (config.reference_input_mappings ??
          {}) as Record<string, string>;
        const hasInputMappings = Object.values(referenceInputMappings).some(
          (value) => String(value ?? "").trim(),
        );
        if (hasInputMappings) {
          // Governed path: run through the reference executor so the
          // reference's declared inputs drive path/query/body exactly as they
          // do for Call Reference nodes. event_id/event_name are always
          // available as inputs even when not explicitly mapped.
          const inputValues: Record<string, any> = {
            event_id: eventId,
            event_name: eventName,
          };
          for (const [inputName, expression] of Object.entries(
            referenceInputMappings,
          )) {
            if (!String(expression ?? "").trim()) continue;
            inputValues[inputName] = resolveExpression(expression, ctx);
          }
          const { executeReference } = await import("@/lib/reference-executor");
          try {
            await executeReference({
              supabase,
              referenceId: config.reference_id,
              inputValues,
              timeout: TIMEOUTS.STANDARD,
              caller: {
                traceId: ctx.traceId ?? ctx.runId ?? "",
                callerType: "workflow_node",
                callerId: ctx.runId ?? null,
              },
              expectedTenantId: tenantId,
            });
          } catch (e: unknown) {
            throw new Error(
              `Server event outbound call failed: ${toErrorMessage(e)}`,
            );
          }
        } else {
          // Legacy path: POST the payload straight at the reference's endpoint.
          // Cached per run, credentials already decrypted.
          const ref = await loadReference(ctx, config.reference_id).catch(
            () => null,
          );

          if (ref) {
            const integration = ref.integration as any;
            const reqConfig = ref.request_config as any;
            const baseUrl = (integration.config as any)?.base_url ?? "";
            let path = reqConfig?.path_template ?? "";
            let body = JSON.stringify(outboundPayload);

            // Resolve path variables from payload
            for (const [key, val] of Object.entries(outboundPayload)) {
              path = path.replace(`{{${key}}}`, String(val ?? ""));
            }

            const headers: Record<string, string> = {
              "Content-Type": "application/json",
            };
            const authCfg = (integration.config as any)?.auth_config;
            if (
              (integration.config as any)?.auth_type === "bearer" &&
              authCfg?.token
            ) {
              headers["Authorization"] = `Bearer ${authCfg.token}`;
            } else if (
              (integration.config as any)?.auth_type === "api_key" &&
              authCfg?.key_value
            ) {
              headers[authCfg.key_name || "X-API-Key"] = authCfg.key_value;
            }

            try {
              await fetch(baseUrl + path, {
                method: reqConfig?.method ?? "POST",
                headers,
                body,
                signal: AbortSignal.timeout(TIMEOUTS.STANDARD),
              });
            } catch (e: unknown) {
              throw new Error(
                `Server event outbound call failed: ${toErrorMessage(e)}`,
              );
            }
          }
        }
      } else if (outboundAction === "data_table" && dataTableIdOf(config)) {
        // Write event to a data table
        await supabase.from("custom_table_rows").insert({
          table_id: dataTableIdOf(config),
          tenant_id: tenantId,
          data: outboundPayload,
        } as any);
      }

      // Store event_id in variables for reference
      setVar("event_id", eventId);
      setVar("event_name", eventName);
      // Backward compat
      ctx.variables["event_id"] = eventId;
      ctx.variables["event_name"] = eventName;

      // Throw PauseError to halt execution — caught by executeWorkflow
      throw new PauseError(eventId, node.id);
    }

    // ─── Condition (multi-branch — can match multiple) ───
    case "condition":
      return handleCondition(config, ctx, evaluateRule);

    // ─── Switch/Case ───
    case "switch_case":
      return handleSwitchCase(config, ctx);

    // ─── Loop ───
    case "loop": {
      const items = resolveExpression(config.items, ctx);
      const arr = Array.isArray(items) ? items : [];
      const itemVar = config.item_var ?? "item";
      const indexVar = config.index_var ?? "index";
      ctx.variables[`${itemVar}_count`] = arr.length;
      // Store items for downstream iteration — the executeNode caller handles edge traversal
      // Each iteration sets item + index variables so downstream nodes can use them
      return {
        items: arr,
        count: arr.length,
        item_var: itemVar,
        index_var: indexVar,
      };
    }

    // ─── Delay ───
    // Up to 30 s waits inline; longer delays pause the run and a queued
    // resume job continues it after the delay (see timedPause).
    case "delay": {
      const delay = canonicalDelay(config);
      const ms = calculateDelay(delay.duration, delay.unit);
      if (ms > ENGINE_LIMITS.inlineDelayMaxMs) {
        const resumeAt = new Date(Date.now() + ms);
        timedPause(node, ctx, resumeAt, {
          delay_ms: ms,
          resume_at: resumeAt.toISOString(),
        });
        return { waited_ms: 0, skipped_wait_ms: ms };
      }
      if (ms > 0) {
        await new Promise((resolve) => setTimeout(resolve, ms));
      }
      return { waited_ms: ms };
    }

    // ─── Loop N Times ───
    case "loop_n_times": {
      const n = Number(resolveExpression(config.count, ctx)) || 0;
      const indexVar = config.index_var ?? "i";
      ctx.variables[`${indexVar}_total`] = n;
      return {
        count: n,
        index_var: indexVar,
        items: Array.from({ length: n }, (_, i) => i),
      };
    }

    // ─── Pause Until Date ───
    case "pause_until": {
      const targetDate = resolveExpression(config.date, ctx);
      const target = new Date(targetDate);
      const now = new Date();
      const waitMs = Math.max(0, target.getTime() - now.getTime());
      const inlineMax = ENGINE_LIMITS.inlineDelayMaxMs;
      if (waitMs > inlineMax) {
        timedPause(node, ctx, target, {
          target_date: targetDate,
          resume_at: target.toISOString(),
        });
      } else if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      return {
        target_date: targetDate,
        waited_ms: Math.min(waitMs, inlineMax),
        remaining_ms: Math.max(0, waitMs - inlineMax),
      };
    }

    // ─── End Workflow ───
    case "end_workflow": {
      const reason = resolveExpression(config.reason, ctx) ?? "Workflow ended";
      // End as failed: the step fails with the reason, so the run is failed
      // (red in the process view and run history) and workflow_error
      // triggers fire. Not for middleware responses (they always answer).
      if (config.status === "failed" && ctx.variables._trigger_type !== "middleware_received") {
        throw new Error(String(reason) || "Workflow ended as failed");
      }
      if (ctx.variables._trigger_type === "middleware_received") {
        const response = await buildMiddlewareResponse(
          config,
          ctx,
          String(reason),
        );
        throw new EndWorkflowSignal(String(reason), response);
      }
      throw new EndWorkflowSignal(reason);
    }

    // ─── Operations (delegated to handlers) ───
    case "math":
      return handleMath(config, ctx);
    case "modify_string":
      return handleModifyString(config, ctx);
    case "text_template":
      return handleTextTemplate(config, ctx);
    case "format_date":
      return handleFormatDate(config, ctx);
    case "date_math":
      return handleDateMath(config, ctx);
    case "regex":
      return handleRegex(config, ctx);

    // ─── Collections (delegated to handlers) ───
    case "collection_count":
      return handleCollectionCount(config, ctx);
    case "collection_get":
      return handleCollectionGet(config, ctx);
    case "collection_filter":
      return handleCollectionFilter(config, ctx, evaluateRule);
    case "collection_sort":
      return handleCollectionSort(config, ctx);
    case "collection_unique":
      return handleCollectionUnique(config, ctx);
    case "collection_join":
      return handleCollectionJoin(config, ctx);

    // ─── JSON Operations (delegated to handlers) ───
    case "json_build_object":
      return handleJsonBuildObject(config, ctx);
    case "json_build_array":
      return handleJsonBuildArray(config, ctx);
    case "json_add_to_array":
      return handleJsonAddToArray(config, ctx);
    case "json_get_value":
      return handleJsonGetValue(config, ctx);

    // ─── Update Task ───
    case "update_task": {
      if (!taskId) return { skipped: true, reason: "No task" };
      // Allowlist — workflow configs are author-editable data, so a raw
      // dynamic column write let a workflow overwrite tenant_id/event_id/etc.
      if (
        !(WORKFLOW_UPDATABLE_TASK_FIELDS as readonly string[]).includes(
          String(config.field),
        )
      ) {
        throw new Error(`Update Task: field "${config.field}" is not allowed`);
      }
      const value = normalizeTaskFieldValue(
        String(config.field),
        resolveExpression(config.value, ctx),
      );
      const { error } = await supabase
        .from("tasks")
        .update({ [config.field]: value })
        .eq("id", taskId)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(`Update task failed: ${error.message}`);
      // Refresh the in-memory task so downstream {{task.*}} sees this write.
      ctx.task = (await loadTaskDataObject(supabase, taskId, { tenantId, attachments: taskAttachmentsLoader(supabase) })) ?? ctx.task;
      return { updated: config.field, value };
    }

    // ─── Update Data Table ───
    case "update_data_table": {
      // Legacy configs stored the table as tableId / data_table_id.
      const tableId = dataTableIdOf(config);
      if (!tableId) return { skipped: true, reason: "No table selected" };
      const operation = config.operation ?? "insert";
      const shouldApplyRowRetention =
        operation === "set_retention" ||
        ((operation === "insert" || operation === "update") &&
          config.apply_retention_policy === true);
      const resolvedRetentionPolicyId = (() => {
        const resolved = resolveExpression(config.retention_policy_id, ctx);
        const normalized = String(resolved ?? "").trim();
        return normalized || null;
      })();

      async function validateRowRetentionPolicy(policyId: string | null) {
        if (!policyId) return;
        const { data: policy, error: policyError } = await (supabase as any)
          .from("retention_policies")
          .select("id, applies_to")
          .eq("tenant_id", tenantId)
          .eq("id", policyId)
          .single();
        if (policyError || !policy)
          throw new Error(policyError?.message ?? "Retention policy not found");
        if (
          Array.isArray(policy.applies_to) &&
          !policy.applies_to.includes("data_rows")
        ) {
          throw new Error("That retention policy cannot be applied to rows");
        }
      }

      // Build row data: column_values (new) > field_mappings (legacy) > data (JSON)
      let rowData: Record<string, any>;
      const columnValues: Record<string, string> = config.column_values ?? {};
      const hasColumnValues = Object.values(columnValues).some(Boolean);
      const fieldMappings: Record<string, string> = config.field_mappings ?? {};
      const hasMappings = Object.values(fieldMappings).some(Boolean);

      if (hasColumnValues) {
        // New format: each column has a value/expression to resolve
        rowData = {};
        for (const [col, expr] of Object.entries(columnValues)) {
          if (!expr) continue;
          rowData[col] = resolveExpression(expr, ctx);
        }
      } else if (hasMappings) {
        rowData = {};
        // Canonical source: task.data (the enriched task object) with the
        // legacy metadata path as fallback for un-enriched contexts.
        const templateValues =
          (ctx.task as any)?.data ??
          (ctx.task?.metadata as any)?.template_values ??
          {};

        for (const [fieldId, column] of Object.entries(fieldMappings)) {
          if (!column) continue;
          let value: any;
          if (fieldId === "__task_id") value = ctx.taskId;
          else if (fieldId === "__task_title") value = ctx.task?.title;
          else if (fieldId === "__task_status") value = ctx.task?.status;
          else if (fieldId === "__task_priority") value = ctx.task?.priority;
          else if (fieldId === "__task_assignee_id")
            value = ctx.task?.assignee_id;
          else if (fieldId === "__task_due_date") value = ctx.task?.due_date;
          else if (fieldId === "__task_completed_at")
            value = ctx.task?.completed_at;
          else if (fieldId === "__task_outcome") value = ctx.task?.outcome;
          else if (fieldId.startsWith("__"))
            value = ctx.task?.[fieldId.slice(2)];
          else value = templateValues[fieldId] ?? null;
          rowData[column] = value;
        }

        // Auto-create columns if enabled
        if (config.auto_create_columns) {
          const existingCols: { key: string; label: string }[] =
            await loadTableColumns(ctx, tableId).catch(() => []);
          const existingKeys = new Set(existingCols.map((c: any) => c.key));
          const newCols = [...existingCols];
          let changed = false;
          for (const col of Object.keys(rowData)) {
            if (!existingKeys.has(col)) {
              newCols.push({
                key: col,
                label: col
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (c) => c.toUpperCase()),
              });
              changed = true;
            }
          }
          if (changed) {
            await supabase
              .from("custom_tables")
              .update({ columns: newCols } as any)
              .eq("id", tableId);
            // The engine changed the columns: drop the cached copies.
            getRunCache(ctx).tableColumns.delete(tableId);
            getRunCache(ctx).triggerTables.delete(tableId);
          }
        }
      } else {
        rowData = resolveExpression(config.data, ctx) ?? {};
        if (typeof rowData === "string") {
          try {
            rowData = JSON.parse(rowData);
          } catch {
            rowData = {};
          }
        }
      }

      // Custom output variable names (user-configurable)
      const rowIdVar = config.output_row_id_var || config.output_var || "row_id";
      const rowVar = config.output_row_var || "row";
      const rowsVar = config.output_rows_var || "rows";
      const countVar = config.output_count_var || "row_count";
      const resolveMatchedRowId = async () => {
        const directRowId = resolveExpression(config.row_id, ctx);
        if (directRowId) return String(directRowId);

        const matchField = String(
          resolveExpression(
            config.row_match_field ?? config.match_column,
            ctx,
          ) ?? "",
        ).trim();
        const rawMatchValue = resolveExpression(
          config.row_match_value ?? config.match_value,
          ctx,
        );
        const matchValue = rawMatchValue == null ? "" : String(rawMatchValue);
        if (!matchField || !matchValue) return null;

        const { data: matchedRow, error: matchError } = await supabase
          .from("custom_table_rows")
          .select("id")
          .eq("table_id", tableId)
          .eq(`data->>${matchField}`, matchValue)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (matchError)
          throw new Error(`Match lookup failed: ${matchError.message}`);
        return matchedRow?.id ? String(matchedRow.id) : null;
      };

      if (operation === "get") {
        const rowId = await resolveMatchedRowId();
        if (!rowId) return { skipped: true, reason: "No row ID for get" };

        // Helper to execute the get query (reused for live binding)
        async function executeGet() {
          const { data: row, error } = await supabase
            .from("custom_table_rows")
            .select("id, data, created_at, updated_at")
            .eq("id", rowId)
            .single();
          if (error) throw new Error(`Get failed: ${error.message}`);
          if (!row) return null;
          return {
            row_id: row.id,
            ...((row.data as any) ?? {}),
            _created_at: row.created_at,
            _updated_at: row.updated_at,
          };
        }

        const result = await executeGet();
        setVar(rowVar, result);
        setVar(rowIdVar, result?.row_id ?? null);
        if (result) {
          // Columns: always `<prefix>_<column>` (and in `rowVar`). The
          // top-level copy is kept for existing workflows but never
          // overwrites a workflow input, an engine-owned variable or this
          // node's own outputs.
          const inputs = new Set<string>(
            Array.isArray(ctx.variables._workflow_inputs)
              ? ctx.variables._workflow_inputs
              : [],
          );
          const kept: string[] = [];
          for (const [k, v] of Object.entries((result as any) ?? {})) {
            if (k === "row_id" || k.startsWith("_")) continue;
            ctx.variables[`${_prefix}_${k}`] = v;
            if (
              inputs.has(k) ||
              RESERVED_RUN_VARIABLES.has(k) ||
              k === rowVar ||
              k === rowIdVar
            ) {
              kept.push(k);
              continue;
            }
            ctx.variables[k] = v;
          }
          if (kept.length > 0) {
            ctx.logs.push({
              node_id: node.id,
              node_type: node.type,
              node_label: node.label,
              level: "warn",
              message: `Columns ${kept.join(", ")} not copied to top-level variables (same name as a workflow input or run variable); read them as {{${rowVar}.<column>}} or {{${_prefix}_<column>}}`,
            });
          }
        }

        // Register live binding if enabled — re-queries on each downstream access
        if (config.live_reference) {
          if (!ctx.variables.live) ctx.variables.live = {};
          ctx.variables.live[rowVar] = result;
          ctx.variables[`live_${rowVar}`] = result;
          ctx.liveBindings[rowVar] = {
            referenceId: "__data_table_get",
            inputMappings: {},
            outputPaths: {},
            configSnapshot: { ...config, _resolved_row_id: rowId },
          };
        }

        return {
          operation,
          table_id: tableId,
          row_id: result?.row_id ?? null,
          found: !!result,
        };
      } else if (operation === "insert") {
        if (shouldApplyRowRetention) {
          await validateRowRetentionPolicy(resolvedRetentionPolicyId);
        }
        // Auto-populate system columns
        const tblCols = await loadTableColumns(ctx, tableId).catch(() => []);
        if (!rowData.id && rowData.id !== 0) {
          const idCol = tblCols.find(
            (c: any) => c.key === "id" && c.type === "number",
          );
          if (idCol) {
            const { data: lastRow } = await supabase
              .from("custom_table_rows")
              .select("data")
              .eq("table_id", tableId)
              .order("created_at", { ascending: false })
              .limit(1);
            rowData.id =
              (lastRow?.length
                ? Number((lastRow[0].data as any)?.id) || 0
                : 0) + 1;
          }
        }
        if (!rowData.date_created && !rowData["Date Created"]) {
          if (tblCols.find((c: any) => c.key === "date_created"))
            rowData["Date Created"] = new Date().toISOString().split("T")[0];
        }
        const { data: inserted, error } = await supabase
          .from("custom_table_rows")
          .insert({
            table_id: tableId,
            tenant_id: tenantId,
            data: rowData,
            ...(shouldApplyRowRetention
              ? {
                  retention_policy_id: resolvedRetentionPolicyId,
                }
              : {}),
          })
          .select("id")
          .single();
        if (error) throw new Error(`Insert failed: ${error.message}`);
        const insertedRowId = inserted?.id;
        if (insertedRowId) {
          await enqueueDataTableEventWorkflows({
            supabase,
            tenantId,
            tableId,
            rowId: insertedRowId,
            rowData,
            eventType: "created",
            tableCache: getRunCache(ctx).triggerTables,
            initiator: initiatorFromRunVariables(ctx.variables, "data_table"),
          });
        }
        setVar(rowIdVar, insertedRowId);
        if (shouldApplyRowRetention)
          setVar("retention_policy_id", resolvedRetentionPolicyId);
        return {
          operation,
          table_id: tableId,
          row_id: insertedRowId,
          columns: Object.keys(rowData),
          retention_policy_id: shouldApplyRowRetention
            ? resolvedRetentionPolicyId
            : null,
        };
      } else if (operation === "update") {
        const rowId = await resolveMatchedRowId();
        if (!rowId) return { skipped: true, reason: "No row ID for update" };
        if (shouldApplyRowRetention) {
          await validateRowRetentionPolicy(resolvedRetentionPolicyId);
        }
        // Merge over the existing row data — an update that sets two columns
        // must not wipe the others (data is a single jsonb blob in the DB).
        const { data: existingRow } = await supabase
          .from("custom_table_rows")
          .select("data")
          .eq("id", rowId)
          .maybeSingle();
        rowData = {
          ...((existingRow?.data as Record<string, any> | null) ?? {}),
          ...rowData,
        };
        const updatePayload: Record<string, any> = { data: rowData };
        if (shouldApplyRowRetention) {
          updatePayload.retention_policy_id = resolvedRetentionPolicyId;
        }
        const { error } = await supabase
          .from("custom_table_rows")
          .update(updatePayload as any)
          .eq("id", rowId);
        if (error) throw new Error(`Update failed: ${error.message}`);
        await enqueueDataTableEventWorkflows({
          supabase,
          tenantId,
          tableId,
          rowId,
          rowData,
          eventType: "updated",
          tableCache: getRunCache(ctx).triggerTables,
          initiator: initiatorFromRunVariables(ctx.variables, "data_table"),
        });
        setVar(rowIdVar, rowId);
        if (shouldApplyRowRetention)
          setVar("retention_policy_id", resolvedRetentionPolicyId);
        return {
          operation,
          table_id: tableId,
          row_id: rowId,
          columns: Object.keys(rowData),
          retention_policy_id: shouldApplyRowRetention
            ? resolvedRetentionPolicyId
            : null,
        };
      } else if (operation === "delete") {
        const rowId = await resolveMatchedRowId();
        if (!rowId) return { skipped: true, reason: "No row ID for delete" };
        const { data: existingRow } = await supabase
          .from("custom_table_rows")
          .select("data")
          .eq("id", rowId)
          .maybeSingle();
        const { error } = await supabase
          .from("custom_table_rows")
          .delete()
          .eq("id", rowId);
        if (error) throw new Error(`Delete failed: ${error.message}`);
        await enqueueDataTableEventWorkflows({
          supabase,
          tenantId,
          tableId,
          rowId,
          rowData: (existingRow?.data as Record<string, any> | null) ?? {},
          eventType: "deleted",
          tableCache: getRunCache(ctx).triggerTables,
          initiator: initiatorFromRunVariables(ctx.variables, "data_table"),
        });
        setVar(rowIdVar, rowId);
        return { operation, table_id: tableId, row_id: rowId };
      } else if (operation === "set_retention") {
        const rowId = await resolveMatchedRowId();
        if (!rowId)
          return { skipped: true, reason: "No row ID for retention update" };
        const retentionPolicyId = resolvedRetentionPolicyId;
        await validateRowRetentionPolicy(retentionPolicyId);

        const { error } = await (supabase as any)
          .from("custom_table_rows")
          .update({
            retention_policy_id: retentionPolicyId,
          })
          .eq("tenant_id", tenantId)
          .eq("table_id", tableId)
          .eq("id", rowId);
        if (error) throw new Error(`Set retention failed: ${error.message}`);
        setVar(rowIdVar, rowId);
        setVar("retention_policy_id", retentionPolicyId);
        return {
          operation,
          table_id: tableId,
          row_id: rowId,
          retention_policy_id: retentionPolicyId,
        };
      } else if (operation === "list") {
        // Build the query
        let query = supabase
          .from("custom_table_rows")
          .select("id, data, created_at, updated_at")
          .eq("table_id", tableId);

        // Apply filters
        const filters: { column: string; operator: string; value: string }[] =
          config.filters ?? [];
        for (const f of filters) {
          if (!f.column) continue;
          const val = resolveExpression(f.value, ctx);
          const col = `data->>${f.column}`;
          query = applyDataFilter(query, col, f.operator, val);
        }

        // Sort
        const sortColumn = config.sort_column;
        if (sortColumn) {
          const sortDir = config.sort_direction === "desc" ? false : true;
          query = query.order(`data->>${sortColumn}` as any, {
            ascending: sortDir,
          });
        } else {
          query = query.order("created_at", { ascending: false });
        }

        // Limit
        const limit = Number(config.limit) || 100;
        query = query.limit(limit);

        // Offset
        const offset = Number(resolveExpression(config.offset, ctx)) || 0;
        if (offset > 0) query = query.range(offset, offset + limit - 1);

        const { data: rows, error } = await query;
        if (error) throw new Error(`List failed: ${error.message}`);

        const results = (rows ?? []).map((r: any) => ({
          row_id: r.id,
          ...r.data,
          _created_at: r.created_at,
          _updated_at: r.updated_at,
          _retention_policy_id: r.retention_policy_id ?? null,
          _retention_applied_at: r.created_at ?? null,
        }));

        setVar(rowsVar, results);
        setVar(countVar, results.length);

        // Register live binding if enabled — re-queries on each downstream access
        if (config.live_reference) {
          if (!ctx.variables.live) ctx.variables.live = {};
          ctx.variables.live[rowsVar] = results;
          ctx.variables[`live_${rowsVar}`] = results;
          ctx.liveBindings[rowsVar] = {
            referenceId: "__data_table_list",
            inputMappings: {},
            outputPaths: {},
            configSnapshot: { ...config },
          };
        }

        return {
          operation,
          table_id: tableId,
          row_count: results.length,
          rows: results,
        };
      }
      return { operation, table_id: tableId, columns: Object.keys(rowData) };
    }

    // ─── Call Reference ───
    case "call_reference": {
      const refId = config.reference_id;
      if (!refId) return { skipped: true, reason: "No reference" };

      // Cached per run. Execution itself goes through the shared reference
      // executor (lib/reference-executor) — the same runtime as tests, agents
      // and MCP: escaped templates, minted auth, egress guard, retries,
      // database / S3 / Azure Blob / SFTP executors, binary downloads as files.
      const ref = await loadReference(ctx, refId);
      const inputs = (ref.inputs as any[]) ?? [];

      // Resolve input values — check config.input_mappings first (from wizard), fall back to ref defaults
      const inputMappings = config.input_mappings as
        | Record<string, string>
        | undefined;
      // Allow location overrides from workflow config
      const inputLocationOverrides = config._ref_inputs_override as
        | any[]
        | undefined;
      const inputValues: Record<string, any> = {};
      for (const input of inputs) {
        inputValues[input.name] = callReferenceInputValue(input, inputMappings?.[input.name], ctx);
      }
      const inputLocations: Record<string, string> = {};
      for (const override of inputLocationOverrides ?? []) {
        if (override?.location) inputLocations[String(override.id ?? override.name)] = String(override.location);
      }

      // Use custom body if provided (JSON mode), otherwise use template
      // Custom JSON body: object / array variables are inserted as JSON.
      let body: string | undefined;
      if (config._custom_body) {
        const custom = resolveExpr(config._custom_body, {
          variables: ctx.variables,
          task: ctx.task,
          json: true,
        });
        body = typeof custom === "string" ? custom : JSON.stringify(custom);
      }

      // In form mode, build body JSON from body-location inputs
      if (config._body_mode === "form" && !config._custom_body) {
        // Check for array body with repeating rows
        const bodyRows = config._body_rows as
          | Record<string, string>[]
          | undefined;
        if (bodyRows && Array.isArray(bodyRows) && bodyRows.length > 0) {
          const resolvedRows = bodyRows.map((row: Record<string, string>) => {
            const obj: Record<string, any> = {};
            for (const [key, val] of Object.entries(row)) {
              if (val != null && val !== "")
                obj[key] = resolveExpression(val, ctx);
            }
            return obj;
          });
          body = JSON.stringify(
            config._body_is_array ? resolvedRows : resolvedRows[0],
          );
        } else {
          // Single object body from individual inputs
          const bodyObj: Record<string, any> = {};
          for (const input of inputs) {
            const location =
              inputLocationOverrides?.find(
                (o: any) => (o.id ?? o.name) === (input.id ?? input.name),
              )?.location ?? input.location;
            if (location !== "body") continue;
            let value: any = callReferenceInputValue(input, inputMappings?.[input.name], ctx);
            if (input.type === "array" && typeof value === "string") {
              try {
                value = JSON.parse(value);
              } catch {
                /* keep as string */
              }
            }
            if (value != null && value !== "") bodyObj[input.name] = value;
          }
          if (Object.keys(bodyObj).length > 0)
            body = JSON.stringify(config._body_is_array ? [bodyObj] : bodyObj);
        }
      }

      const { executeReference } = await import("@/lib/reference-executor");
      const result = await executeReference({
        supabase,
        referenceId: refId,
        inputValues,
        timeout: TIMEOUTS.STANDARD,
        expectedTenantId: tenantId,
        inputLocations,
        bodyTemplate: body,
        dbResultShape: "rows",
        caller: {
          traceId: ctx.traceId ?? ctx.runId ?? "",
          callerType: "workflow_node",
          callerId: ctx.runId ?? null,
          callerNodeId: node.id,
        },
      });
      const respStatus = result.status;
      let responseData: any = result.data;
      if (
        responseData &&
        typeof responseData === "object" &&
        !Array.isArray(responseData) &&
        typeof responseData._raw === "string" &&
        Object.keys(responseData).length === 1
      ) {
        // Text responses: `_text` is the name earlier workflows read.
        responseData = { _raw: responseData._raw, _text: responseData._raw };
      }
      if (responseData && typeof responseData === "object" && responseData._file) {
        setVar("api_file", responseData);
        setVar("api_file_url", responseData.url);
        setVar("api_file_name", responseData.name);
        setVar("api_file_size", responseData.size);
      }
      if (result.error_message) {
        ctx.logs.push({
          level: "warn",
          message: `Reference call returned ${respStatus}: ${result.error_message}`,
          node_id: node.id,
          node_type: node.type,
          node_label: node.label,
          duration_ms: 0,
        });
      }

      // Store response with both prefixed and generic names
      setVar("response", responseData);
      setVar("status", respStatus);
      // Keep backward-compat generic names
      ctx.variables["api_response"] = responseData;
      ctx.variables["api_status"] = respStatus;

      // Auto-map outputs to workflow variables
      const outputMappings = config.output_mappings as
        | Record<string, { enabled: boolean; variableName: string }>
        | undefined;
      const mappedVars: Record<string, { type: string; count?: number }> = {};
      if (outputMappings) {
        const refOutputs = (ref.outputs as any[]) ?? [];
        for (const out of refOutputs) {
          const mapping = outputMappings[out.name];
          if (mapping?.enabled && mapping.variableName) {
            // Skip column descriptors (path starts with []. — metadata only)
            if (out.path?.startsWith("[].")) continue;

            // Extract value from response using the output's JSON path
            let value: any = responseData;
            if (out.path && responseData && typeof responseData === "object" && !Array.isArray(responseData) && Object.prototype.hasOwnProperty.call(responseData, out.path)) {
              // A key that itself contains dots (OData '@odata.nextLink').
              value = responseData[out.path];
            } else if (out.path) {
              for (const key of out.path.split(".")) {
                if (value === undefined || value === null) break;
                const arrMatch = key.match(/^(\w+)\[(\d+)\]$/);
                if (arrMatch) {
                  value = value[arrMatch[1]]?.[Number(arrMatch[2])];
                } else {
                  value = value[key];
                }
              }
            }
            // Empty path means use the full response (e.g. for list results)
            ctx.variables[mapping.variableName] = value;

            // Track output type metadata
            if (Array.isArray(value)) {
              mappedVars[mapping.variableName] = {
                type: "list",
                count: value.length,
              };
            } else if (value !== null && typeof value === "object") {
              mappedVars[mapping.variableName] = { type: "object" };
            } else {
              mappedVars[mapping.variableName] = { type: typeof value };
            }
          }
        }
      }

      // Outputs added on the node from the response model ("Add as output"
      // in the data picker): { name, path } read relative to the response.
      const customOutputs = Array.isArray(config.custom_outputs)
        ? (config.custom_outputs as { name?: string; path?: string }[])
        : [];
      if (customOutputs.length) {
        const { valueAtPath } = await import("@/lib/response-schema");
        for (const out of customOutputs) {
          const name = String(out?.name ?? "").trim();
          if (!name) continue;
          const value = out?.path ? valueAtPath(responseData, out.path) : responseData;
          ctx.variables[name] = value;
          mappedVars[name] = Array.isArray(value)
            ? { type: "list", count: value.length }
            : { type: value !== null && typeof value === "object" ? "object" : typeof value };
        }
      }

      return {
        status: respStatus,
        data: responseData,
        mapped_variables: mappedVars,
      };
    }

    // ─── Add Task Attachment ───
    case "add_task_attachment": {
      // Attach a file the run produced or downloaded (a file object, storage
      // reference, URL, base64 / data URL) to a task's Attachments tab.
      // Task: config.task_id, else the run's task, else the latest User Task's.
      const configuredTask = config.task_id ? String(resolveExpression(config.task_id, ctx) ?? "").trim() : "";
      const targetTaskId = configuredTask || taskId || String(ctx.variables.user_task_id ?? "").trim();
      if (!targetTaskId) {
        throw new Error("Add task attachment: no task. Set Task to a task id or {{variable}} (e.g. {{user_task_id}}), or run this in a task-triggered workflow.");
      }
      const { resolveFileInput } = await import("./files/resolve-input");
      const { addTaskAttachmentFromWorkflow, maxAttachmentBytes } = await import("@/lib/services/task-attachments");
      const file = await resolveFileInput(resolveExpression(config.file, ctx), {
        tenantId: String(tenantId),
        label: "Add task attachment: file",
        maxBytes: maxAttachmentBytes(),
      });
      const fileName = String(resolveExpression(config.file_name, ctx) ?? "").trim() || file.name;
      const attachment = await addTaskAttachmentFromWorkflow(supabase as never, {
        tenantId: String(tenantId),
        taskId: targetTaskId,
        runId: ctx.runId ?? null,
        fileName,
        bytes: file.bytes,
        name: String(resolveExpression(config.name, ctx) ?? ""),
        type: String(resolveExpression(config.type, ctx) ?? ""),
        description: String(resolveExpression(config.description, ctx) ?? ""),
      });
      setVar("attachment", attachment);
      return { attachment_id: attachment.id, task_id: targetTaskId, name: attachment.name, size: attachment.size };
    }

    // ─── Create Subtask ───
    case "create_subtask": {
      // The parent task can be selected explicitly (config.parent_task_id —
      // a task id or a {{variable}}), otherwise it falls back to the task in
      // context (the triggering/user task). Previously this node silently
      // skipped whenever there was no ambient task, so it appeared not to work
      // in workflows that weren't task-triggered.
      const configuredParent = config.parent_task_id
        ? String(resolveExpression(config.parent_task_id, ctx) ?? "").trim()
        : "";
      const parentTaskId = configuredParent || taskId;
      if (!parentTaskId) {
        throw new Error(
          "Create subtask: no parent task. Set the Parent Task field to a task id or {{variable}}, or run this after a task node.",
        );
      }

      // Validate the parent belongs to this tenant (also resolves the tenant
      // for explicitly-selected tasks).
      const { data: parentTask, error: parentErr } = await supabase
        .from("tasks")
        .select("id, tenant_id")
        .eq("id", parentTaskId)
        .maybeSingle();
      if (parentErr || !parentTask || String((parentTask as any).tenant_id) !== String(tenantId)) {
        throw new Error(`Create subtask: parent task ${parentTaskId} was not found in this workspace.`);
      }

      const subtaskAssignee = config.assignee
        ? resolveExpression(config.assignee, ctx)
        : null;
      const subtaskTitle =
        resolveExpression(config.title, ctx) ?? "Untitled subtask";
      const { error, data } = await supabase
        .from("tasks")
        .insert({
          tenant_id: tenantId,
          parent_task_id: parentTaskId,
          title: subtaskTitle,
          assignee_id: subtaskAssignee || null,
          acceptance_status: "pending",
        } as any)
        .select("id")
        .single();
      if (error) throw new Error(`Create subtask failed: ${error.message}`);
      // The new subtask's id, for later steps (Auto Action, Add Task Attachment…).
      setVar("subtask_id", data?.id ?? null);
      return {
        subtask_id: data?.id,
      };
    }

    // ─── Auto Action ───
    case "auto_action": {
      const targetId = config.target_task_id
        ? resolveExpression(config.target_task_id, ctx)
        : taskId;
      if (!targetId) return { skipped: true, reason: "No task ID" };
      const updates: Record<string, any> = {};
      if (config.status) updates.status = resolveExpression(config.status, ctx);
      if (config.outcome)
        updates.outcome = resolveExpression(config.outcome, ctx);
      if (config.outcome_notes)
        updates.outcome_notes = resolveExpression(config.outcome_notes, ctx);
      if (config.acceptance_status)
        updates.acceptance_status = resolveExpression(
          config.acceptance_status,
          ctx,
        );
      if (config.priority)
        updates.priority = resolveExpression(config.priority, ctx);
      if (config.assignee_id)
        updates.assignee_id = resolveExpression(config.assignee_id, ctx);
      if (Object.keys(updates).length === 0)
        return { skipped: true, reason: "No fields to update" };
      // The target can come from an expression: only a task of this
      // workspace (the engine's client bypasses RLS).
      const { data: updatedRows, error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", targetId)
        .eq("tenant_id", tenantId)
        .select("id");
      if (error) throw new Error(`Auto action failed: ${error.message}`);
      if (!updatedRows || (updatedRows as unknown[]).length === 0) {
        throw new Error(`Auto action: task ${targetId} was not found in this workspace.`);
      }
      // Log lifecycle event
      const eventType =
        updates.status === "completed"
          ? "completed"
          : updates.status === "cancelled"
            ? "cancelled"
            : updates.assignee_id
              ? "reassigned"
              : "started";
      await supabase.from("lifecycle_events").insert({
        tenant_id: tenantId,
        task_id: targetId,
        event_type: eventType,
        metadata: { source: "automation", updates },
      });
      return { action: "applied", target_task_id: targetId, updates };
    }

    // ─── Governance: Add User to Role ───
    case "add_user_to_role": {
      const user = await resolveGovernanceUser();
      const role = await resolveGovernanceRole();
      const { data: existing } = await (supabase as any)
        .from("user_roles")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .eq("role_id", role.id)
        .maybeSingle();

      if (existing?.id) {
        const result = {
          success: true,
          action: "already_assigned",
          user_id: user.id,
          role_id: role.id,
          role_name: role.name,
          audited: false,
        };
        setVar("success", result.success);
        setVar("action", result.action);
        setVar("user_id", result.user_id);
        setVar("role_id", result.role_id);
        setVar("role_name", result.role_name);
        setVar("audited", result.audited);
        return result;
      }

      const { error } = await (supabase as any)
        .from("user_roles")
        .insert({ tenant_id: tenantId, user_id: user.id, role_id: role.id });
      if (error) throw new Error(`Add user to role failed: ${error.message}`);

      const audited = await logGovernanceAudit(
        "user_role_assigned",
        user.id,
        role.id,
        {
          user_email: user.email ?? null,
          user_display_name: user.display_name ?? null,
          role_name: role.name,
        },
      );
      const result = {
        success: true,
        action: "added",
        user_id: user.id,
        role_id: role.id,
        role_name: role.name,
        audited,
      };
      setVar("success", result.success);
      setVar("action", result.action);
      setVar("user_id", result.user_id);
      setVar("role_id", result.role_id);
      setVar("role_name", result.role_name);
      setVar("audited", result.audited);
      return result;
    }

    // ─── Governance: Remove User from Role ───
    case "remove_user_from_role": {
      const user = await resolveGovernanceUser();
      const role = await resolveGovernanceRole();
      const { data: existing } = await (supabase as any)
        .from("user_roles")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .eq("role_id", role.id)
        .maybeSingle();

      if (!existing?.id) {
        const result = {
          success: true,
          action: "already_removed",
          user_id: user.id,
          role_id: role.id,
          role_name: role.name,
          audited: false,
        };
        setVar("success", result.success);
        setVar("action", result.action);
        setVar("user_id", result.user_id);
        setVar("role_id", result.role_id);
        setVar("role_name", result.role_name);
        setVar("audited", result.audited);
        return result;
      }

      const { error } = await (supabase as any)
        .from("user_roles")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .eq("role_id", role.id);
      if (error)
        throw new Error(`Remove user from role failed: ${error.message}`);

      const audited = await logGovernanceAudit(
        "user_role_removed",
        user.id,
        role.id,
        {
          user_email: user.email ?? null,
          user_display_name: user.display_name ?? null,
          role_name: role.name,
        },
      );
      const result = {
        success: true,
        action: "removed",
        user_id: user.id,
        role_id: role.id,
        role_name: role.name,
        audited,
      };
      setVar("success", result.success);
      setVar("action", result.action);
      setVar("user_id", result.user_id);
      setVar("role_id", result.role_id);
      setVar("role_name", result.role_name);
      setVar("audited", result.audited);
      return result;
    }

    // ─── Governance: Check Permission ───
    case "check_permission": {
      const userId = resolveExpression(config.user_id, ctx);
      const permission = resolveExpression(config.permission, ctx);
      if (!userId || !permission)
        return { skipped: true, reason: "Missing user_id or permission" };

      const { data: perms } = await (supabase as any)
        .from("user_roles")
        .select("role:roles(permissions)")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId);

      const allPerms = new Set<string>();
      for (const ur of perms ?? []) {
        for (const p of ur.role?.permissions ?? []) allPerms.add(p);
      }
      const hasPermission = allPerms.has(permission);
      setVar("has_permission", hasPermission);
      setVar("permissions", [...allPerms]);
      return { user_id: userId, permission, has_permission: hasPermission };
    }

    // ─── Set Variable ───
    case "set_title": {
      const title = resolveExpression(config.title, ctx);
      ctx.variables._title = title;
      // Persist to workflow_runs so it's visible in the queue
      if (ctx.runId) {
        await updateWorkflowRunCompat(supabase, ctx.runId, { title } as any);
      }
      return { title };
    }

    case "set_sla": {
      const mode = config.mode === "exact" ? "exact" : "relative";
      // Amounts may be numbers or expressions ({{sla_days}}, {{=ADD(…)}}):
      // resolved, coerced to a number and validated. A required amount must
      // be > 0; an optional (warning) one may be blank or 0 (= no warning).
      const slaAmount = (raw: any, what: string, required: boolean): number => {
        const resolved = resolveExpression(raw, ctx);
        const text = resolved == null ? "" : String(resolved).trim();
        if (!required && text === "") return 0;
        const value = Number(text);
        if (!Number.isFinite(value) || value < 0 || (required && value <= 0)) {
          const source =
            typeof raw === "string" && raw.includes("{{") ? ` from ${raw}` : "";
          throw new Error(
            `${what} must be a ${required ? "positive" : "non-negative"} number (got "${text}"${source})`,
          );
        }
        return value;
      };
      const label =
        String(resolveExpression(config.sla_label, ctx) ?? "").trim() || null;
      const now = new Date();
      let dueAt: Date | null = null;

      if (mode === "exact") {
        const rawDueAt = String(
          resolveExpression(config.due_at, ctx) ?? "",
        ).trim();
        if (rawDueAt) {
          const parsed = new Date(rawDueAt);
          if (!Number.isNaN(parsed.getTime())) dueAt = parsed;
        }
      } else {
        const amount = slaAmount(config.amount, "SLA amount", true);
        const unit = String(config.unit ?? "hours").trim() || "hours";
        if (amount > 0) {
          const ms =
            unit === "minutes"
              ? amount * TIME_MS.MINUTE
              : unit === "hours"
                ? amount * TIME_MS.HOUR
                : unit === "weeks"
                  ? amount * TIME_MS.WEEK
                  : amount * TIME_MS.DAY;
          dueAt = new Date(now.getTime() + ms);
        }
      }

      let warningAt: Date | null = null;
      const warningMode =
        config.warning_mode === "exact" ? "exact" : "relative";
      if (dueAt) {
        if (warningMode === "exact") {
          const rawWarningAt = String(
            resolveExpression(config.warning_at, ctx) ?? "",
          ).trim();
          if (rawWarningAt) {
            const parsed = new Date(rawWarningAt);
            if (!Number.isNaN(parsed.getTime())) warningAt = parsed;
          }
        } else {
          const warningAmount = slaAmount(
            config.warning_amount,
            "SLA warning amount",
            false,
          );
          const warningUnit =
            String(config.warning_unit ?? config.unit ?? "hours").trim() ||
            "hours";
          if (warningAmount > 0) {
            const warningMs =
              warningUnit === "minutes"
                ? warningAmount * TIME_MS.MINUTE
                : warningUnit === "hours"
                  ? warningAmount * TIME_MS.HOUR
                  : warningUnit === "weeks"
                    ? warningAmount * TIME_MS.WEEK
                    : warningAmount * TIME_MS.DAY;
            warningAt = new Date(dueAt.getTime() - warningMs);
          }
        }
      }

      const status = dueAt
        ? dueAt.getTime() <= now.getTime()
          ? "breached"
          : warningAt && warningAt.getTime() <= now.getTime()
            ? "warning"
            : "on_track"
        : "none";
      const result = {
        sla_label: label,
        sla_due_at: dueAt ? dueAt.toISOString() : null,
        sla_warning_at: warningAt ? warningAt.toISOString() : null,
        sla_status: status,
        sla_warning_triggered_at: null,
        sla_breached_triggered_at: null,
        sla_last_evaluated_at: now.toISOString(),
        sla_metadata: {
          mode,
          unit: config.unit ?? null,
          amount: config.amount ?? null,
          warning_mode: warningMode,
          warning_unit: config.warning_unit ?? config.unit ?? null,
          warning_amount: config.warning_amount ?? null,
        },
      };

      ctx.variables.workflow_sla_label = result.sla_label;
      ctx.variables.workflow_sla_due_at = result.sla_due_at;
      ctx.variables.workflow_sla_warning_at = result.sla_warning_at;
      ctx.variables.workflow_sla_status = result.sla_status;

      if (ctx.runId) {
        await updateWorkflowRunCompat(supabase, ctx.runId, result as any);
      }
      return result;
    }

    case "set_variable": {
      // Legacy single { name, expression }: unchanged.
      if (!usesSetVariableAssignments(config)) {
        const value = resolveExpression(config.expression, ctx);
        ctx.variables[config.name] = value;
        return { variable: config.name, value };
      }
      // { assignments: [...] }: in order, each visible to the next. A failing
      // row fails the node with an error naming the variable; rows before it
      // stay set (as separate Set Variable nodes would).
      const assigned: { name: string; value: unknown }[] = [];
      for (const [index, assignment] of setVariableAssignments(config).entries()) {
        if (!assignment.name) throw new Error(`Set Variable: row ${index + 1} has no variable name`);
        let value: unknown;
        try {
          value = resolveExpression(assignment.expression, ctx);
        } catch (err) {
          throw new Error(`Set Variable "${assignment.name}": ${err instanceof Error ? err.message : String(err)}`);
        }
        ctx.variables[assignment.name] = value;
        assigned.push({ name: assignment.name, value });
      }
      return assigned.length === 1
        ? { variable: assigned[0].name, value: assigned[0].value, assignments: assigned }
        : { assignments: assigned, variables: Object.fromEntries(assigned.map((a) => [a.name, a.value])) };
    }

    // ─── Run Agent ───
    case "run_agent": {
      const agentId = String(config.agent_id ?? "").trim();
      if (!agentId) {
        // Visible in the run trace rather than a silent no-op — a run_agent node
        // with no agent configured is almost always a mistake.
        const warning = "run_agent node has no agent configured — node skipped";
        ctx.onEvent?.({
          type: "log",
          node_id: node.id,
          data: { level: "warn", message: warning },
        });
        return { skipped: true, warning, reason: "No agent selected" };
      }

      const { loadAgentForRun } = await import("./agents/prepare");
      const { runAgent, agentWorkflowVariables, agentNodeOutput } = await import("./agents/run");
      const { AGENT_WAIT_EVENT_PREFIX, newEventId } = await import("./agents/approval");
      const { agentOutputPrefix } = await import("./agent-knowledge");

      // The agent of this tenant, active, with its own tenant's AI provider —
      // at the version the published workflow pinned (lib/agents/pins.ts);
      // drafts / Save & Test carry no pin and run the latest version.
      const pinnedVersion = Number(config.agent_version) >= 1 ? Math.floor(Number(config.agent_version)) : null;
      const loaded = await loadAgentForRun(supabase, tenantId, agentId, { version: pinnedVersion });
      const agentRow = loaded.agent;
      if (!pinnedVersion && ctx.isTest) {
        ctx.onEvent?.({
          type: "log",
          node_id: node.id,
          data: { level: "info", message: `Test run: "${agentRow.name}" runs its latest version (v${agentRow.version ?? 1}). Published runs use the version pinned when the workflow is published.` },
        });
      }
      const initiatedBy = typeof ctx.variables.workflow_initiator_user_id === "string" && ctx.variables.workflow_initiator_user_id.trim()
        ? ctx.variables.workflow_initiator_user_id.trim()
        : null;

      const userMessage = String(
        resolveExpression(config.user_message ?? config.message, ctx) ?? "",
      );
      if (!userMessage.trim())
        throw new Error("Run Agent requires a prompt / message");

      // Who the agent acts for (task / workflow tools): least privilege — see agentActingUserId.
      const { agentActingUserId } = await import("./agents/identity");
      const actingUserId = agentActingUserId(ctx.variables, config);
      const shareContext = config.share_context !== false;
      const agentContext = shareContext
        ? (ctx.variables.agent_context ?? { messages: [], facts: {} })
        : undefined;
      const link = {
        run_id: String(ctx.runId ?? ""),
        workflow_id: ctx.workflowId ?? null,
        event_id: newEventId(AGENT_WAIT_EVENT_PREFIX),
        node_id: node.id,
        node_label: node.label,
        output_variable: String(config.output_variable || "agent_response"),
        output_prefix: String(config._output_prefix || agentOutputPrefix(agentRow.name)),
        share_context: shareContext,
        agent_context: agentContext ?? null,
        user_message: userMessage,
      };

      const filesSpec = typeof config.files === "string" ? config.files.trim() : "";
      const { fileValues } = await import("@/lib/workflow-files");
      const fileList = filesSpec ? fileValues(resolveExpression(filesSpec, ctx)) : [];

      // Queued mode: the agent runs on the agent queue; this run waits on
      // its event and resumes with the agent's variables.
      if (config.execution_mode === "queued" && ctx.runId) {
        const { error: queueError } = await (supabase as any).from("agent_queue").insert({
          agent_id: agentId,
          tenant_id: tenantId,
          input_message: userMessage,
          status: "pending",
          kind: "run",
          created_by: actingUserId,
          options: {
            workflow: link,
            acting_user_id: actingUserId,
            ...(pinnedVersion ? { agent_version: pinnedVersion } : {}),
            ...(initiatedBy ? { initiated_by: initiatedBy } : {}),
            trace_id: ctx.traceId ?? ctx.runId ?? null,
            ...(fileList.length ? { files: fileList } : {}),
            ...(config.max_iterations !== undefined ? { max_iterations: config.max_iterations } : {}),
            ...(config.timeout_ms !== undefined ? { timeout_ms: config.timeout_ms } : {}),
          },
        });
        if (queueError) throw new Error(`Could not queue the agent: ${queueError.message}`);
        const { kickAgentQueueProcessor } = await import("@/lib/process-queue");
        kickAgentQueueProcessor(1);
        ctx.onEvent?.({ type: "log", node_id: node.id, data: { level: "info", message: `Agent "${agentRow.name}" queued — the run continues when it finishes` } });
        throw new PauseError(link.event_id, node.id);
      }

      // Files (Run Agent → Files): read for this run's tenant, shaped for the
      // model's API (images / PDFs / extracted text); names only in logs.
      let agentAttachments: Awaited<ReturnType<typeof import("./agents/files").loadRunAgentFilesWithSummary>> | undefined;
      if (fileList.length) {
        const { loadRunAgentFilesWithSummary } = await import("./agents/files");
        agentAttachments = await loadRunAgentFilesWithSummary(fileList, tenantId, loaded);
        ctx.onEvent?.({ type: "log", node_id: node.id, data: { level: "info", message: `Files for the agent: ${agentAttachments.summary.map((f) => `${f.name} (${f.sent_as})`).join(", ")}` } });
      }

      // Save & Test streams the agent's reply into the run view (coalesced
      // text deltas); production runs only need the final result.
      const streamReply = Boolean(ctx.isTest && ctx.onEvent);
      const { coalescedAgentEvents } = await import("./agents/stream");
      const relay = coalescedAgentEvents<any>((event) => {
        ctx.onEvent?.({ type: "log", node_id: node.id, data: event });
      });
      const outcome = await runAgent({
        stream: streamReply,
        db: supabase,
        tenantId,
        loaded,
        message: userMessage,
        actingUserId,
        callerType: "workflow_node",
        callerId: ctx.runId ?? null,
        initiatedBy,
        traceId: ctx.traceId ?? ctx.runId ?? null,
        workflow: ctx.runId ? link : null,
        includeSharedContext: shareContext || Boolean(agentAttachments),
        sharedContext: agentContext,
        attachments: agentAttachments?.attachments,
        overrides: { maxIterations: config.max_iterations, maxDurationMs: config.timeout_ms },
        onEvent: (event) => relay.onEvent(event),
      }).finally(() => relay.close());
      const result = outcome.result;

      if (result.status === "awaiting_approval") {
        if (!ctx.runId) throw new Error("This agent needs a tool call approved, which needs a saved workflow run");
        ctx.onEvent?.({ type: "log", node_id: node.id, data: { level: "info", message: `Agent "${agentRow.name}" is waiting for approval of ${result.pending?.tool ?? "a tool call"} (task ${outcome.approval?.taskId ?? "?"})` } });
        throw new PauseError(link.event_id, node.id);
      }
      // Surface real failures as node failures (continue-on-error / fail run).
      if (result.status === "failed") {
        throw new Error(`Agent execution failed: ${result.error ?? "unknown error"}`);
      }

      Object.assign(ctx.variables, agentWorkflowVariables(result, link, outcome.outputConfig, agentRow.name));
      return {
        ...agentNodeOutput(result, outcome.runId),
        ...(agentAttachments?.summary.length ? { files: agentAttachments.summary } : {}),
      };
    }

    // ─── HTTP Request ───
    case "http_request": {
      let baseUrl = String(resolveExpression(config.url, ctx) ?? "");
      if (!baseUrl) throw new Error("HTTP Request: no URL configured");
      const method = config.method ?? "GET";

      // Build query params
      const configParams = (config.params ?? []) as {
        key: string;
        value: string;
      }[];
      const queryParts = configParams
        .filter((p) => p.key)
        .map(
          (p) =>
            `${encodeURIComponent(p.key)}=${encodeURIComponent(String(resolveExpression(p.value, ctx) ?? ""))}`,
        );
      if (queryParts.length > 0)
        baseUrl += (baseUrl.includes("?") ? "&" : "?") + queryParts.join("&");

      // Build headers
      const contentType = config.content_type ?? "json";
      const headers: Record<string, string> = {};
      // multipart: fetch sets multipart/form-data with its boundary.
      if (contentType === "json") headers["Content-Type"] = "application/json";
      else if (contentType === "form")
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      else if (contentType === "text") headers["Content-Type"] = "text/plain";

      // Auth
      const authType = config.auth_type ?? "none";
      if (authType === "bearer" && config.auth_token) {
        headers["Authorization"] =
          `Bearer ${resolveExpression(config.auth_token, ctx)}`;
      } else if (authType === "api_key" && config.auth_key_value) {
        headers[config.auth_key_name || "X-API-Key"] = String(
          resolveExpression(config.auth_key_value, ctx),
        );
      } else if (authType === "basic" && config.auth_username) {
        headers["Authorization"] =
          `Basic ${Buffer.from(`${resolveExpression(config.auth_username, ctx)}:${resolveExpression(config.auth_password, ctx) ?? ""}`).toString("base64")}`;
      }

      // Custom headers
      const configHeaders = (config.headers ?? []) as {
        key: string;
        value: string;
      }[];
      for (const h of configHeaders) {
        if (h.key)
          headers[h.key] = String(resolveExpression(h.value, ctx) ?? "");
      }

      // Body
      let body: string | FormData | Uint8Array | undefined;
      let sentFiles: Array<{ name: string; size: number; mime_type: string }> = [];
      if (method !== "GET" && contentType === "multipart") {
        // Form parts: text values, and files (a form attachment, a list of
        // them — each a part with the same name — or another step's file).
        const { loadStepFiles, describeStepFiles } = await import("@/lib/workflow-files");
        const form = new FormData();
        const parts = (Array.isArray(config.multipart) ? config.multipart : []) as Array<{ key?: string; value?: string; type?: string }>;
        for (const part of parts) {
          const key = String(part?.key ?? "").trim();
          if (!key) continue;
          if (part.type === "file") {
            const files = await loadStepFiles(resolveExpression(part.value ?? "", ctx), { tenantId, maxFiles: 20, maxTotalBytes: 50 * 1024 * 1024 });
            for (const file of files) form.append(key, new Blob([file.bytes as unknown as BlobPart], { type: file.mime_type }), file.name);
            sentFiles = [...sentFiles, ...describeStepFiles(files)];
          } else {
            const value = resolveExpression(part.value ?? "", ctx);
            form.append(key, value !== null && typeof value === "object" ? JSON.stringify(value) : String(value ?? ""));
          }
        }
        body = form;
      } else if (method !== "GET" && contentType === "binary") {
        // The body is one file's bytes (its type as Content-Type unless a header sets it).
        const { loadStepFiles, describeStepFiles } = await import("@/lib/workflow-files");
        const [file] = await loadStepFiles(resolveExpression(config.body ?? "", ctx), { tenantId, maxFiles: 1, maxTotalBytes: 50 * 1024 * 1024 });
        if (!file) throw new Error("HTTP Request: the binary body names no file");
        body = file.bytes;
        if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["Content-Type"] = file.mime_type;
        sentFiles = describeStepFiles([file]);
      } else if (method !== "GET" && config.body && contentType !== "none") {
        body = String(resolveExpression(config.body, ctx) ?? "");
      }

      let resp: Response;
      try {
        // Egress-guarded on every redirect hop (no private / metadata targets
        // unless ALLOW_PRIVATE_EGRESS); no automatic retries for this node.
        const { connectorFetch } = await import("@/lib/integrations/http");
        resp = await connectorFetch(baseUrl, {
          method,
          headers,
          body: body as BodyInit | undefined,
        }, { timeoutMs: sentFiles.length ? TIMEOUTS.LARGE_FILE : TIMEOUTS.DEFAULT, retry: "never" });
      } catch (e: unknown) {
        throw new Error(
          `HTTP Request to ${baseUrl} failed: ${toErrorMessage(e)}`,
        );
      }

      // Store output with custom variable name
      const outputVar = config.output_var;

      const ct = resp.headers.get("content-type") ?? "";
      const isBinaryResp =
        ct.includes("octet-stream") ||
        ct.includes("pdf") ||
        ct.includes("vnd.") ||
        ct.includes("image/") ||
        ct.includes("zip");

      if (isBinaryResp) {
        // Store file in storage
        const buffer = Buffer.from(await resp.arrayBuffer());
        const disposition = resp.headers.get("content-disposition");
        let fn =
          new URL(String(baseUrl)).pathname.split("/").pop() || "download";
        if (disposition) {
          const m = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
          if (m) fn = decodeURIComponent(m[1]);
        }
        const ext = fn.includes(".") ? (fn.split(".").pop() ?? "bin") : "bin";
        const stored = await storeWorkflowFile(supabase, tenantId, buffer, ext, ct);
        const fileRef = {
          _file: true,
          name: fn,
          url: stored.url,
          path: stored.path,
          size: buffer.byteLength,
          content_type: ct,
          ...(stored.ref ? { ref: stored.ref } : {}),
        };
        setVar("file", fileRef);
        setVar("file_url", stored.url);
        ctx.variables["http_file"] = fileRef;
        ctx.variables["http_file_url"] = stored.url;
        if (outputVar) {
          ctx.variables[outputVar] = fileRef;
          ctx.variables[`${outputVar}_url`] = stored.url;
        }
        ctx.variables[`${_prefix}_status`] = resp.status;
        return { status: resp.status, file: fileRef };
      }

      const data = await resp.json().catch(async () => {
        const text = await resp
          .clone()
          .text()
          .catch(() => null);
        return text;
      });
      setVar("response", data);
      if (outputVar) ctx.variables[outputVar] = data;
      ctx.variables[`${_prefix}_status`] = resp.status;
      return { status: resp.status, data, ...(sentFiles.length ? { files_sent: sentFiles } : {}) };
    }

    // ─── Log ───
    case "log": {
      const message = resolveExpression(config.message, ctx);
      if (taskId) {
        await supabase.from("lifecycle_events").insert({
          tenant_id: tenantId,
          task_id: taskId,
          event_type: "comment_added",
          metadata: { message, source: "automation" },
        });
      }
      return { logged: message };
    }

    // ─── Send Email ───
    case "send_email": {
      const { sendEmail } = await import("@/lib/email");
      if (!ctx.variables.app_url)
        ctx.variables.app_url = configuredAppUrl() ?? "";
      const to = resolveExpression(config.to, ctx);
      const emailTemplate = config.email_template_id
        ? await loadEmailTemplate(
            supabase,
            tenantId,
            String(config.email_template_id),
          )
        : null;
      if (config.email_template_id && !emailTemplate)
        throw new Error("Email template not found");
      const subject = resolveExpression(
        emailTemplate?.subject ?? config.subject,
        ctx,
      );
      const body = resolveExpression(
        emailTemplate?.html_body ?? config.body,
        ctx,
      );
      const from = config.from
        ? resolveExpression(config.from, ctx)
        : undefined;
      const replyTo = config.reply_to
        ? resolveExpression(config.reply_to, ctx)
        : undefined;

      if (!to) return { skipped: true, reason: "No recipient" };
      if (!subject) return { skipped: true, reason: "No subject" };

      // Attachments: one file or a list (form attachments, generated files,
      // URLs); several {{…}} separated by commas are all attached.
      const { loadStepFiles, describeStepFiles, fileValues } = await import("@/lib/workflow-files");
      const attachmentSpec = typeof config.attachments === "string" ? config.attachments.trim() : "";
      let emailFiles: Awaited<ReturnType<typeof loadStepFiles>> = [];
      if (attachmentSpec) {
        const parts = attachmentSpec.match(/\{\{[\s\S]*?\}\}/g) ?? [];
        const separated = parts.length > 1 && attachmentSpec.replace(/\{\{[\s\S]*?\}\}/g, "").trim().replace(/[,;\s]/g, "") === "";
        const values = separated
          ? parts.flatMap((part: string) => fileValues(resolveExpression(part, ctx)))
          : fileValues(resolveExpression(attachmentSpec, ctx));
        emailFiles = await loadStepFiles(values, { tenantId, maxFiles: 20, maxTotalBytes: 25 * 1024 * 1024 });
      }

      const result = await sendEmail({
        to: String(to).includes(",")
          ? String(to)
              .split(",")
              .map((s) => s.trim())
          : String(to),
        subject: String(subject),
        body: String(body ?? ""),
        from: from ? String(from) : undefined,
        replyTo: replyTo ? String(replyTo) : undefined,
        ...(emailFiles.length
          ? { attachments: emailFiles.map((f) => ({ filename: f.name, contentType: f.mime_type, content: f.bytes })) }
          : {}),
      });

      if (!result.success) throw new Error(`Email failed: ${result.error}`);
      return {
        sent: true,
        email_id: result.id,
        to,
        ...(emailFiles.length ? { attachments: describeStepFiles(emailFiles) } : {}),
      };
    }

    // ─── File to Base64 ───
    case "file_to_base64": {
      const fileUrl = resolveExpression(config.file_url, ctx);
      if (!fileUrl) return { skipped: true, reason: "No file URL" };
      const outputVar = config.output_var ?? "file_base64";

      try {
        const resp = await fetchFile(fileSource(fileUrl), {
          signal: AbortSignal.timeout(TIMEOUTS.STANDARD),
        }, { tenantId });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const fileBuffer = await resp.arrayBuffer();
        const base64 = Buffer.from(fileBuffer).toString("base64");
        ctx.variables[outputVar] = base64;

        const fileName =
          String(fileUrl).split("/").pop()?.split("?")[0] ?? "file";
        const ext = fileName.includes(".")
          ? fileName.split(".").pop()?.toLowerCase()
          : "";
        ctx.variables[`${outputVar}_name`] = fileName;
        ctx.variables[`${outputVar}_size`] = fileBuffer.byteLength;
        ctx.variables[`${outputVar}_ext`] = ext;

        return { variable: outputVar, size: fileBuffer.byteLength, fileName };
      } catch (e: unknown) {
        throw new Error(`File to Base64 failed: ${toErrorMessage(e)}`);
      }
    }

    // ─── Base64 to File ───
    case "base64_to_file": {
      const base64Data = resolveExpression(config.base64_data, ctx);
      const fileName = resolveExpression(config.file_name, ctx) ?? "file.bin";
      const outputVar = config.output_var ?? "file_url";

      if (!base64Data) return { skipped: true, reason: "No base64 data" };

      try {
        const buffer = Buffer.from(String(base64Data), "base64");
        const ext = String(fileName).split(".").pop() ?? "bin";
        const stored = await storeWorkflowFile(supabase, tenantId, buffer, ext, config.content_type || "application/octet-stream");
        const urlData = { publicUrl: stored.url };
        const storagePath = stored.path;

        ctx.variables[outputVar] = urlData.publicUrl;
        ctx.variables[`${outputVar}_path`] = storagePath;
        ctx.variables[`${outputVar}_name`] = fileName;
        ctx.variables[`${outputVar}_size`] = buffer.byteLength;

        return {
          variable: outputVar,
          url: urlData.publicUrl,
          size: buffer.byteLength,
          fileName,
        };
      } catch (e: unknown) {
        throw new Error(`Base64 to File failed: ${toErrorMessage(e)}`);
      }
    }

    // ─── Download File ───
    case "download_file": {
      const url = resolveExpression(config.url, ctx);
      if (!url) return { skipped: true, reason: "No URL" };
      const outputVar = config.output_var ?? "downloaded_file";

      try {
        const resp = await fetchFile(fileSource(url), {
          signal: AbortSignal.timeout(TIMEOUTS.LARGE_FILE),
        }, { tenantId });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const buffer = Buffer.from(await resp.arrayBuffer());
        const contentType =
          resp.headers.get("content-type") ?? "application/octet-stream";

        const disposition = resp.headers.get("content-disposition");
        let fileName = config.file_name
          ? resolveExpression(config.file_name, ctx)
          : null;
        if (!fileName && disposition) {
          const match = disposition.match(
            /filename[*]?=(?:UTF-8''|"?)([^";]+)/i,
          );
          if (match) fileName = decodeURIComponent(match[1]);
        }
        if (!fileName)
          fileName =
            new URL(String(url)).pathname.split("/").pop() || "download";

        const ext = String(fileName).split(".").pop() ?? "bin";
        const stored = await storeWorkflowFile(supabase, tenantId, buffer, ext, contentType);
        const urlData = { publicUrl: stored.url };
        const storagePath = stored.path;

        ctx.variables[outputVar] = urlData.publicUrl;
        ctx.variables[`${outputVar}_path`] = storagePath;
        ctx.variables[`${outputVar}_name`] = fileName;
        ctx.variables[`${outputVar}_size`] = buffer.byteLength;
        ctx.variables[`${outputVar}_type`] = contentType;
        ctx.variables[`${outputVar}_base64`] = buffer.toString("base64");

        return {
          variable: outputVar,
          url: urlData.publicUrl,
          size: buffer.byteLength,
          fileName,
          contentType,
        };
      } catch (e: unknown) {
        throw new Error(`Download file failed: ${toErrorMessage(e)}`);
      }
    }

    // ─── Read File Content ───
    case "read_file": {
      const fileUrl = resolveExpression(config.file_url, ctx);
      if (!fileUrl) return { skipped: true, reason: "No file URL" };
      const outputVar = config.output_var ?? "file_content";
      const encoding = config.encoding ?? "utf-8";

      try {
        const resp = await fetchFile(fileSource(fileUrl), {
          signal: AbortSignal.timeout(TIMEOUTS.STANDARD),
        }, { tenantId });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        if (encoding === "base64") {
          const buffer = Buffer.from(await resp.arrayBuffer());
          ctx.variables[outputVar] = buffer.toString("base64");
          ctx.variables[`${outputVar}_size`] = buffer.byteLength;
        } else if (encoding === "json") {
          ctx.variables[outputVar] = await resp.json();
        } else {
          const text = await resp.text();
          ctx.variables[outputVar] = text;
          ctx.variables[`${outputVar}_length`] = text.length;
        }

        return { variable: outputVar, encoding };
      } catch (e: unknown) {
        throw new Error(`Read file failed: ${toErrorMessage(e)}`);
      }
    }

    // ─── Read CSV ───
    case "read_csv": {
      // ─── Write mode: convert JSON array to CSV file ───
      if (config.mode === "write") {
        const data = resolveExpression(config.data_var, ctx);
        const arr = Array.isArray(data) ? data : [];
        if (arr.length === 0)
          return { skipped: true, reason: "No data to write" };
        const delimiter = config.delimiter ?? ",";
        const fileName =
          resolveExpression(config.file_name, ctx) || "export.csv";
        const outputVar = config.output_var ?? "csv_file";

        // Build CSV: headers from first object's keys
        const headers = Object.keys(arr[0]);
        const csvLines = [
          headers.join(delimiter),
          ...arr.map((row: any) =>
            headers
              .map((h) => {
                const val = String(row[h] ?? "");
                return val.includes(delimiter) ||
                  val.includes('"') ||
                  val.includes("\n")
                  ? `"${val.replace(/"/g, '""')}"`
                  : val;
              })
              .join(delimiter),
          ),
        ];
        const csvContent = csvLines.join("\n");
        const buffer = Buffer.from(csvContent, "utf-8");
        let stored: StoredWorkflowFile;
        try {
          stored = await storeWorkflowFile(supabase, tenantId, buffer, "csv", "text/csv");
        } catch (e) {
          throw new Error(`CSV write failed: ${toErrorMessage(e)}`);
        }
        const urlData = { publicUrl: stored.url };
        const fileRef = {
          _file: true,
          name: fileName,
          url: stored.url,
          path: stored.path,
          size: buffer.byteLength,
          content_type: "text/csv",
          ...(stored.ref ? { ref: stored.ref } : {}),
        };
        ctx.variables[outputVar] = fileRef;
        setVar("file", fileRef);
        setVar("file_url", urlData.publicUrl);
        return {
          variable: outputVar,
          rows: arr.length,
          size: buffer.byteLength,
          fileName,
        };
      }

      // ─── Read mode ───
      let fileUrl = resolveExpression(config.file_url, ctx);
      if (fileUrl && typeof fileUrl === "object" && fileUrl.url)
        fileUrl = fileUrl.url;
      if (!fileUrl) return { skipped: true, reason: "No file URL" };
      const outputVar = config.output_var ?? "csv_data";
      const hasHeaders = config.has_headers !== false;
      const delimiter = config.delimiter ?? ",";

      try {
        const resp = await fetchFile(fileSource(fileUrl), {
          signal: AbortSignal.timeout(TIMEOUTS.STANDARD),
        }, { tenantId });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();

        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length === 0) {
          ctx.variables[outputVar] = [];
          return { variable: outputVar, count: 0 };
        }

        // Parse CSV respecting quoted fields
        function parseLine(line: string): string[] {
          const result: string[] = [];
          let current = "",
            inQuote = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuote) {
              if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
              } else if (ch === '"') inQuote = false;
              else current += ch;
            } else if (ch === '"') {
              inQuote = true;
            } else if (ch === delimiter) {
              result.push(current.trim());
              current = "";
            } else current += ch;
          }
          result.push(current.trim());
          return result;
        }

        let rows: Record<string, any>[];
        if (hasHeaders) {
          const headers = parseLine(lines[0]);
          rows = lines.slice(1).map((line) => {
            const values = parseLine(line);
            const obj: Record<string, any> = {};
            headers.forEach((h, i) => {
              obj[h] = values[i] ?? "";
            });
            return obj;
          });
        } else {
          rows = lines.map((line) => {
            const values = parseLine(line);
            const obj: Record<string, any> = {};
            values.forEach((v, i) => {
              obj[`col_${i + 1}`] = v;
            });
            return obj;
          });
        }

        ctx.variables[outputVar] = rows;
        ctx.variables[`${outputVar}_count`] = rows.length;
        if (hasHeaders && lines.length > 0)
          ctx.variables[`${outputVar}_headers`] = parseLine(lines[0]);

        return {
          variable: outputVar,
          count: rows.length,
          has_headers: hasHeaders,
        };
      } catch (e: unknown) {
        throw new Error(`Read CSV failed: ${toErrorMessage(e)}`);
      }
    }

    // ─── Read Excel ───
    case "read_excel": {
      // ─── Write mode: convert JSON array to Excel file ───
      if (config.mode === "write") {
        const data = resolveExpression(config.data_var, ctx);
        const arr = Array.isArray(data) ? data : [];
        if (arr.length === 0)
          return { skipped: true, reason: "No data to write" };
        const fileName =
          resolveExpression(config.file_name, ctx) || "export.xlsx";
        const sheetName = config.sheet_name || "Sheet1";
        const outputVar = config.output_var ?? "excel_file";

        const xl = await import("./excel");
        const xlsxBuffer = await xl.workbookToBuffer(
          xl.buildWorkbook([{ name: sheetName, rows: arr }]),
        );
        let stored: StoredWorkflowFile;
        try {
          stored = await storeWorkflowFile(supabase, tenantId, xlsxBuffer, "xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        } catch (e) {
          throw new Error(`Excel write failed: ${toErrorMessage(e)}`);
        }
        const urlData = { publicUrl: stored.url };
        const fileRef = {
          _file: true,
          name: fileName,
          url: stored.url,
          path: stored.path,
          size: xlsxBuffer.byteLength,
          content_type:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ...(stored.ref ? { ref: stored.ref } : {}),
        };
        ctx.variables[outputVar] = fileRef;
        setVar("file", fileRef);
        setVar("file_url", urlData.publicUrl);
        return {
          variable: outputVar,
          rows: arr.length,
          sheet: sheetName,
          size: xlsxBuffer.byteLength,
          fileName,
        };
      }

      // ─── Read mode ───
      let fileUrl = resolveExpression(config.file_url, ctx);
      if (fileUrl && typeof fileUrl === "object" && fileUrl.url)
        fileUrl = fileUrl.url;
      if (!fileUrl) return { skipped: true, reason: "No file URL" };
      const outputVar = config.output_var ?? "excel_data";
      const sheetName = config.sheet_name
        ? resolveExpression(config.sheet_name, ctx)
        : undefined;
      const hasHeaders = config.has_headers !== false;

      try {
        const resp = await fetchFile(fileSource(fileUrl), {
          signal: AbortSignal.timeout(TIMEOUTS.LARGE_FILE),
        }, { tenantId });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buffer = await resp.arrayBuffer();

        const xl = await import("./excel");
        const workbook = await xl.loadWorkbook(buffer);
        const sheets = xl.sheetNames(workbook);
        const sheet = xl.getSheet(workbook, sheetName);
        if (!sheet)
          throw new Error(`Sheet "${sheetName ?? "default"}" not found`);

        const rows: unknown[] = hasHeaders
          ? xl.sheetToObjects(sheet, { defval: "" })
          : xl.sheetToArrays(sheet, { defval: "" });

        ctx.variables[outputVar] = rows;
        ctx.variables[`${outputVar}_count`] = rows.length;
        ctx.variables[`${outputVar}_sheets`] = sheets;

        return {
          variable: outputVar,
          count: rows.length,
          sheet: sheetName ?? sheets[0],
          sheets,
        };
      } catch (e: unknown) {
        throw new Error(`Read Excel failed: ${toErrorMessage(e)}`);
      }
    }

    // ─── Document Generation (dynamic imports to keep bundle small) ───
    case "doc_word": {
      const { handleDocWord } = await import("./doc-handlers");
      const resolve = (e: any) => resolveExpression(e, ctx);
      const result = await handleDocWord(
        config,
        resolve,
        supabase,
        tenantId,
        setVar,
        docLog,
      );
      if (result.fileRef)
        ctx.variables[config.output_var || "doc_file"] = result.fileRef;
      return result;
    }
    case "doc_excel": {
      const { handleDocExcel } = await import("./doc-handlers");
      const resolve = (e: any) => resolveExpression(e, ctx);
      const result = await handleDocExcel(
        config,
        resolve,
        supabase,
        tenantId,
        setVar,
        docLog,
      );
      if (result.fileRef)
        ctx.variables[config.output_var || "doc_file"] = result.fileRef;
      return result;
    }
    case "doc_powerpoint": {
      const { handleDocPowerpoint } = await import("./doc-handlers");
      const resolve = (e: any) => resolveExpression(e, ctx);
      const result = await handleDocPowerpoint(
        config,
        resolve,
        supabase,
        tenantId,
        setVar,
        docLog,
      );
      if (result.fileRef)
        ctx.variables[config.output_var || "doc_file"] = result.fileRef;
      return result;
    }

    // ─── Document actions (read / compare / convert / PDF / extract / redact / inspect) ───
    case "doc_read":
    case "doc_compare":
    case "doc_convert":
    case "doc_pdf":
    case "doc_extract":
    case "doc_redact":
    case "doc_inspect": {
      const { runDocumentNode } = await import("./documents/handlers");
      return runDocumentNode({
        type: node.type,
        config,
        resolve: (e: unknown) => resolveExpression(e, ctx),
        supabase,
        tenantId,
        variables: ctx.variables,
        setVar,
        warn: docLog,
        initiator: initiatorFromRunVariables(ctx.variables, "data_table"),
      });
    }

    // ─── Media (transcribe / analyze / redact / generate / speech / FFmpeg utilities) ───
    case "media_transcribe":
    case "media_analyze_image":
    case "media_analyze_video":
    case "media_redact_image":
    case "media_redact_video":
    case "media_generate_image":
    case "media_tts":
    case "media_tools": {
      const media = await import("./media/handlers");
      const resolveMedia = (e: unknown) => resolveExpression(e, ctx);
      const mediaInfo = (message: string) => {
        ctx.logs.push({ node_id: node.id, node_type: node.type, node_label: node.label, level: "info", message });
      };
      const result = await media.runMediaNode({
        type: node.type,
        config,
        resolve: resolveMedia,
        supabase,
        tenantId,
        variables: ctx.variables,
        setVar,
        warn: docLog,
        info: mediaInfo,
        // Long media moves to a background job — a saved run outside loops only.
        canBackground: Boolean(ctx.runId) && !ctx.isTest && !ctx.loopDepth,
      });
      if (result instanceof media.MediaBackground || result instanceof media.MediaContinue) {
        if (!ctx.runId) throw new Error("This media step needs a saved workflow run to continue in the background");
        const { enqueueMediaJob } = await import("./media/jobs");
        const eventId = await enqueueMediaJob({
          supabase,
          tenantId,
          runId: ctx.runId,
          workflowId: ctx.workflowId ?? null,
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: node.label,
          outputPrefix: _prefix,
          config: await media.snapshotMediaConfig({ config, resolve: resolveMedia, supabase, tenantId }),
          state: result.state,
          traceId: ctx.traceId ?? ctx.runId ?? null,
        });
        const reason = result instanceof media.MediaBackground ? result.reason : "the provider is still working";
        ctx.onEvent?.({ type: "log", node_id: node.id, data: { level: "info", message: `${node.label} continues in the background (${reason}) — the run resumes when it finishes` } });
        mediaInfo(`Continues in the background: ${reason}`);
        throw new PauseError(eventId, node.id);
      }
      return result;
    }

    // ─── E-signature (send / envelope actions / wait for signature) ───
    case "esign_send":
    case "esign_envelope":
    case "esign_wait": {
      const esign = await import("./esign/handlers");
      const result = await esign.runEsignNode({
        type: node.type,
        config,
        resolve: (e: unknown) => resolveExpression(e, ctx),
        supabase,
        tenantId,
        variables: ctx.variables,
        runId: ctx.runId ?? null,
        workflowId: ctx.workflowId ?? null,
        nodeId: node.id,
        nodeLabel: node.label,
        isTest: Boolean(ctx.isTest),
        info: (message: string) => {
          ctx.logs.push({ node_id: node.id, node_type: node.type, node_label: node.label, level: "info", message });
        },
      });
      if (result instanceof esign.EsignPause) {
        ctx.onEvent?.({ type: "log", node_id: node.id, data: { level: "info", message: `${node.label}: ${result.reason} — the run resumes when the envelope is final` } });
        throw new PauseError(result.eventId, node.id);
      }
      return result;
    }

    default:
      return { skipped: true, reason: `Unknown node type: ${node.type}` };
  }
}

// Flush accumulated logs to the database in a single batch insert. Awaited by
// every caller so the write isn't lost when a serverless function returns; a
// failed insert is logged, never thrown.
async function flushLogs(
  supabase: SupabaseClient,
  ctx: ExecutionContext,
  workflowId: string,
  runId?: string,
): Promise<void> {
  const persisted = ctx.logs.filter((log) => log.persist !== false);
  if (!persisted.length) return;
  const rows = capLogs(persisted, ENGINE_LIMITS.logMaxEntries).map((log) => ({
    run_id: runId ?? null,
    workflow_id: workflowId,
    tenant_id: ctx.tenantId,
    node_id: log.node_id ?? null,
    node_type: log.node_type ?? null,
    node_label: log.node_label ?? null,
    level: log.level,
    message: log.message,
    metadata: log.metadata ?? null,
    duration_ms: log.duration_ms ?? null,
  }));
  try {
    const { error } = await supabase.from("workflow_logs").insert(rows);
    if (error) console.error("flushLogs failed:", error.message);
  } catch (e: unknown) {
    console.error("flushLogs failed:", toErrorMessage(e));
  }
}

// Summarize output to keep logs lean — no full data dumps
function summarizeOutput(nodeType: string, output: any): any {
  if (!output) return null;
  if (output.skipped) return { skipped: true, reason: output.reason };
  switch (nodeType) {
    case "condition":
      return { matched: output.matched_branches ?? [output.matched_branch] };
    case "switch_case":
      return { value: output.value, matched: output.matched_case };
    case "call_reference":
      return {
        status: output.status,
        vars: output.mapped_variables
          ? Object.keys(output.mapped_variables)
          : [],
      };
    case "custom_activity": {
      // Step detail (Save & Test, run viewer): the typed values, long lists trimmed.
      const trim = (value: any): any => {
        if (Array.isArray(value)) return value.length > 5 ? [...value.slice(0, 5).map(trim), `… ${value.length - 5} more`] : value.map(trim);
        if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
        return value;
      };
      const values = output.outputs && typeof output.outputs === "object" && !Array.isArray(output.outputs)
        ? Object.fromEntries(Object.entries(output.outputs).map(([k, v]) => [k, trim(v)]))
        : output.outputs;
      return {
        activity: output.activity_name ?? output.activity ?? null,
        ...(output.activity_key ? { action: `${output.activity_key}${output.action_version ? `@${output.action_version}` : ""}` } : {}),
        ...(output.operation ? { operation: output.operation } : {}),
        outputs: values,
        count: output.output_count ?? output.count ?? (values && typeof values === "object" ? Object.keys(values).length : 0),
        ...(output.stats ? { duration_ms: output.stats.duration_ms, host_calls: output.stats.host_calls, attempts: output.stats.attempts } : {}),
        ...(Array.isArray(output.warnings) && output.warnings.length ? { warnings: output.warnings } : {}),
      };
    }
    case "live_reference":
      return {
        binding: output.binding_name,
        prefetched: output.prefetched,
        type: output.data_type,
        items: output.item_count,
      };
    case "http_request":
      return output.file
        ? { status: output.status, file: output.file.name }
        : Array.isArray(output.files_sent)
          ? { status: output.status, files_sent: output.files_sent.map((f: any) => ({ name: f.name, size: f.size })) }
          : { status: output.status };
    case "loop":
      return { count: output.count };
    case "loop_n_times":
      return { count: output.count };
    case "update_task":
      return { field: output.updated, value: output.value };
    case "auto_action":
      return { updates: output.updates };
    case "send_email":
      // Attachments: names and sizes only, never contents.
      return Array.isArray(output.attachments)
        ? { sent: output.sent, to: output.to, attachments: output.attachments.map((f: any) => ({ name: f.name, size: f.size })) }
        : { sent: output.sent, to: output.to };
    case "math":
      return { result: output.result, variable: output.variable };
    case "set_title":
      return { title: output.title };
    case "set_variable": {
      const shown = (value: unknown) => (value !== null && typeof value === "object" ? "[object]" : value);
      if (Array.isArray(output.assignments) && output.assignments.length > 1) {
        return { assignments: output.assignments.map((a: any) => ({ name: a.name, value: shown(a.value) })) };
      }
      return {
        name: output.variable ?? output.name,
        value: typeof output.value === "object" ? "[object]" : output.value,
      };
    }
    case "modify_string":
      return { result: output.result, variable: output.variable };
    case "text_template":
      return { variable: output.variable };
    case "format_date":
      return { result: output.result };
    case "date_math":
      return { result: output.result };
    case "regex":
      return { matched: output.matched, result: output.result };
    case "collection_filter":
      return { count: output.count };
    case "collection_count":
      return { count: output.count };
    case "collection_get":
      return { variable: output.variable };
    case "collection_sort":
      return { count: output.count };
    case "collection_unique":
      return { count: output.count };
    case "collection_join":
      return { variable: output.variable };
    case "json_build_object":
      return { variable: output.variable, fields: output.field_count };
    case "json_build_array":
      return { variable: output.variable, count: output.count };
    case "json_add_to_array":
      return { variable: output.variable, count: output.count };
    case "json_get_value":
      return { variable: output.variable, type: output.type };
    case "create_subtask":
      return { subtask_id: output.subtask_id };
    case "add_task_attachment":
      return { attachment_id: output.attachment_id, task_id: output.task_id, size: output.size };
    case "update_data_table":
      return output.operation === "list"
        ? { operation: output.operation, row_count: output.row_count }
        : output.operation === "get"
          ? { operation: output.operation, found: output.found }
          : { operation: output.operation, row_id: output.row_id };
    case "log":
      return { logged: output.logged };
    case "delay":
      return { waited: output.duration };
    case "file_to_base64":
      return { fileName: output.fileName, size: output.size };
    case "base64_to_file":
      return { fileName: output.fileName, url: output.url };
    case "download_file":
      return {
        fileName: output.fileName,
        size: output.size,
        contentType: output.contentType,
      };
    case "read_file":
      return { encoding: output.encoding };
    case "read_csv":
      return output.fileName
        ? {
            variable: output.variable,
            rows: output.rows,
            file: output.fileName,
          }
        : { variable: output.variable, count: output.count };
    case "read_excel":
      return output.fileName
        ? {
            variable: output.variable,
            rows: output.rows,
            file: output.fileName,
          }
        : {
            variable: output.variable,
            count: output.count,
            sheet: output.sheet,
          };
    case "call_sub_workflow":
      return {
        status: output.status,
        sub_workflow: output.sub_workflow_name,
        nodes: output.node_count,
      };
    case "decision_table":
      return {
        decision_table_id: output.decision_table_id,
        decision_table_name: output.decision_table_name,
        matched: output.matched ?? false,
        rule_id: output.rule_id ?? null,
        rule_label: output.rule_label ?? null,
        input_count:
          output.inputs && typeof output.inputs === "object"
            ? Object.keys(output.inputs).length
            : 0,
        output_count:
          output.outputs && typeof output.outputs === "object"
            ? Object.keys(output.outputs).length
            : 0,
        output_keys:
          output.outputs && typeof output.outputs === "object"
            ? Object.keys(output.outputs)
            : [],
        inputs: output.inputs ?? {},
        outputs: output.outputs ?? {},
      };
    case "placeholder":
      return { note: output.note };
    case "goto_activity":
      return { goto: output.target_label, overrides: output.overrides_applied };
    case "parallel":
      return { mode: output.mode, branches: output.branch_count };
    case "server_event":
      return { event_id: output.event_id, event: output.event_name };
    case "end_workflow":
      return output.response
        ? {
            reason: output.reason,
            response_status: output.response.statusCode,
            response_type: output.response.bodyType,
            response_headers: Object.keys(output.response.headers ?? {}).length,
            response_body: output.response.bodyPreview,
            response_file_size: output.response.fileSize,
          }
        : { reason: output.reason };
    case "doc_word":
    case "doc_excel":
    case "doc_powerpoint":
      return { mode: output.mode, file: output.fileName, size: output.size };
    case "doc_read":
    case "doc_compare":
    case "doc_convert":
    case "doc_pdf":
    case "doc_extract":
    case "doc_redact":
    case "doc_inspect": {
      // Already compact (no document text beyond a short preview).
      const { text_preview: _preview, ...rest } = output;
      return rest;
    }
    case "media_transcribe":
    case "media_analyze_image":
    case "media_analyze_video":
    case "media_redact_image":
    case "media_redact_video":
    case "media_generate_image":
    case "media_tts":
    case "media_tools": {
      // Already compact (counts, names, cost); the persisted log drops text previews.
      const { text_preview: _p, description_preview: _d, summary_preview: _s, ...rest } = output;
      return rest;
    }
    default:
      return { ok: true };
  }
}

/**
 * One Data step list filter on `data->>column` (both the step and its live
 * re-query). Aliases ("equals", "==", "contains") read as their canonical
 * operator; an unknown operator adds no filter (the designer flags it).
 */
function applyDataFilter<Q extends { eq: any; neq: any; gt: any; gte: any; lt: any; lte: any; like: any; ilike: any; is: any; not: any }>(
  query: Q,
  col: string,
  operator: unknown,
  val: any,
): Q {
  switch (canonicalDataFilterOperator(operator)) {
    case "eq": return query.eq(col, val);
    case "neq": return query.neq(col, val);
    case "gt": return query.gt(col, val);
    case "gte": return query.gte(col, val);
    case "lt": return query.lt(col, val);
    case "lte": return query.lte(col, val);
    case "like": return query.like(col, `%${val}%`);
    case "ilike": return query.ilike(col, `%${val}%`);
    case "starts_with": return query.ilike(col, `${val}%`);
    case "ends_with": return query.ilike(col, `%${val}`);
    case "is_null": return query.is(col, null);
    case "not_null": return query.not(col, "is", null);
    default: return query;
  }
}

/**
 * Run variables the engine owns. A data-table get never copies a column
 * over these (the row is still in its row variable and prefixed columns).
 */
const RESERVED_RUN_VARIABLES = new Set([
  "task", "task_id", "task_data", "tenant_id", "workflow_id", "workflow_name",
  "workflow_started_at", "workflow_started_by", "workflow_started_via", "workflow_owner_id", "trigger_type", "run_id",
  "outcome", "outcome_notes", "last_error", "last_error_node", "last_error_node_id",
  "last_error_node_type", "has_error", "live", "item", "index",
  // Submission metadata (lib/forms/submission-meta.ts), server-set.
  "submission",
]);

function evaluateRule(
  field: string,
  operator: string,
  value: string,
  ctx: ExecutionContext,
): boolean {
  // A condition rule's `field` is meant to point at the VALUE to
  // compare, not be the literal string itself. LLMs (and older
  // hand-authored rules) often write a bare identifier like
  // "ticket_priority" instead of "{{ticket_priority}}", which
  // resolveExpression returns verbatim. If the bare name matches a
  // known workflow variable, promote it to a {{…}} lookup so the
  // comparison runs against the actual value.
  const bareIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_.]*$/;
  let effectiveField = field;
  if (
    typeof field === "string" &&
    !field.includes("{{") &&
    bareIdentifierPattern.test(field)
  ) {
    const rootKey = field.split(".")[0];
    if (
      rootKey &&
      ((ctx.variables as any)?.[rootKey] !== undefined ||
        (ctx.variables as any)?.[field] !== undefined || // flat dotted variable name
        (rootKey === "task" && (ctx as any).task)) // task context lives outside variables
    ) {
      effectiveField = `{{${field}}}`;
    }
  }
  const fieldValue = resolveExpression(effectiveField, ctx);
  const compareValue = resolveExpression(value, ctx);

  // Normalize operator casing and longhand aliases (greater_than → gt,
  // ">=" → gte, …) so MCP- or hand-authored rules don't silently fall
  // through the default branch and read as "no match".
  const op = normalizeOperator(
    String(operator ?? "")
      .toLowerCase()
      .trim(),
  );
  switch (op) {
    case "equals":
      return String(fieldValue) === String(compareValue);
    case "not_equals":
      return String(fieldValue) !== String(compareValue);
    case "contains":
      return String(fieldValue).includes(String(compareValue));
    case "not_contains":
      return !String(fieldValue).includes(String(compareValue));
    // Boolean checks share the form-rules coercion (lib/conditions.ts
    // isTruthyValue): true / "true" / 1 / "1" / "yes" / "on" are true;
    // false / "false" / 0 / "0" / "" / "no" / "off" / null / missing are false.
    case "is_true":
    case "is_false":
    // Regular expression (ReDoS-guarded; an invalid pattern reads as no match).
    case "matches":
      return evaluateOperator(op, fieldValue, compareValue);
    case "gt":
      return Number(fieldValue) > Number(compareValue);
    case "lt":
      return Number(fieldValue) < Number(compareValue);
    case "gte":
      return Number(fieldValue) >= Number(compareValue);
    case "lte":
      return Number(fieldValue) <= Number(compareValue);
    case "is_empty":
      // Parity with the form-rules operator: 0 and false are VALUES, not empty.
      return fieldValue === null || fieldValue === undefined || fieldValue === "" ||
        (Array.isArray(fieldValue) && fieldValue.length === 0);
    case "is_not_empty":
      return !(fieldValue === null || fieldValue === undefined || fieldValue === "" ||
        (Array.isArray(fieldValue) && fieldValue.length === 0));
    case "starts_with":
      return String(fieldValue).startsWith(String(compareValue));
    case "ends_with":
      return String(fieldValue).endsWith(String(compareValue));
    case "in": {
      const list = String(compareValue)
        .split(",")
        .map((s) => s.trim());
      return list.includes(String(fieldValue));
    }
    default:
      return false;
  }
}

function resolveExpression(expr: any, ctx: ExecutionContext): any {
  return resolveExpr(expr, { variables: ctx.variables, task: ctx.task });
}

// calculateDelay is now imported from workflow-node-handlers

// Test-only surface: executeNode is internal, but the error-attribution
// contract (a descendant's failure must not clobber ancestor node results)
// needs direct unit coverage — see __tests__/workflow-error-attribution.test.ts.
export const __testing = { executeNode, evaluateRule };
