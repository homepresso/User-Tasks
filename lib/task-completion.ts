import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveExpression } from "@/lib/expression-resolver";
import { writeLifecycleEvent } from "@/lib/lifecycle-events";
import { mergeTaskFieldValuesChecked } from "@/lib/forms/task-values";
import { normalizeTaskFields } from "@/lib/task-field-schema";
import { toKeySlug } from "@/lib/utils/slug";

/**
 * Multi-assignee task completion — the single implementation used by every
 * completion path (server action, v1 API, agent tool). Previously the rules
 * lived only in the server action, so a task requiring 3-of-5 consensus
 * completed on the FIRST response when actioned via the API or an agent.
 */

export type CompletionRule =
  | "first_response"
  | "all_complete"
  | "consensus"
  | "unanimous"
  | "custom";

export interface CompletionEvaluation {
  isComplete: boolean;
  winningOutcome: string;
  responseCount: number;
  assigneeCount: number;
  outcomeCounts: Record<string, number>;
  unanimousFailed: boolean;
}

function modalOutcome(
  outcomeCounts: Record<string, number>,
  fallback: string,
): string {
  return (
    Object.entries(outcomeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    fallback
  );
}

/**
 * Pure rule evaluation. `latestOutcome` is the outcome the current responder
 * just submitted (used by first_response and as the general fallback).
 */
export function evaluateCompletionRule(opts: {
  rule: CompletionRule | string;
  responses: Array<{ user_id: string; outcome: string }>;
  assigneeCount: number;
  latestOutcome: string;
  meta: Record<string, any>;
}): CompletionEvaluation {
  const { rule, responses, assigneeCount, latestOutcome, meta } = opts;

  const responseCount = responses.length;
  const outcomeCounts: Record<string, number> = {};
  for (const r of responses) {
    outcomeCounts[r.outcome] = (outcomeCounts[r.outcome] ?? 0) + 1;
  }

  let isComplete = false;
  let winningOutcome = latestOutcome;
  let unanimousFailed = false;

  switch (rule) {
    case "first_response":
      isComplete = true;
      winningOutcome = latestOutcome;
      break;

    case "all_complete":
      isComplete = responseCount >= assigneeCount;
      if (isComplete)
        winningOutcome = modalOutcome(outcomeCounts, latestOutcome);
      break;

    case "consensus": {
      const minResponses = meta.min_responses ?? Math.ceil(assigneeCount / 2);
      if (responseCount >= minResponses) {
        const sorted = Object.entries(outcomeCounts).sort(
          (a, b) => b[1] - a[1],
        );
        if (sorted.length > 0) {
          if (sorted.length === 1 || sorted[0][1] > sorted[1][1]) {
            isComplete = true;
            winningOutcome = sorted[0][0];
          } else if (responseCount >= assigneeCount) {
            // Everyone voted and it's a tie — first-sorted outcome wins.
            isComplete = true;
            winningOutcome = sorted[0][0];
          }
        }
      }
      break;
    }

    case "unanimous":
      if (responseCount >= assigneeCount) {
        const uniqueOutcomes = Object.keys(outcomeCounts);
        isComplete = true;
        if (uniqueOutcomes.length === 1) {
          winningOutcome = uniqueOutcomes[0];
        } else {
          winningOutcome = modalOutcome(outcomeCounts, latestOutcome);
          unanimousFailed = true;
        }
      }
      break;

    case "custom": {
      // Real expression evaluation (previously a stub that stripped {{...}}).
      // The builder documents response_count / assignee_count / outcome_counts
      // and per-outcome outcome_<slug>_count variables.
      const variables: Record<string, any> = {
        response_count: responseCount,
        assignee_count: assigneeCount,
        outcome_counts: outcomeCounts,
      };
      for (const [key, count] of Object.entries(outcomeCounts)) {
        variables[`outcome_${toKeySlug(key)}_count`] = count;
      }
      const expression = String(meta.custom_rule_expression ?? "").trim();
      if (expression) {
        try {
          const result = resolveExpression(expression, { variables });
          const normalized = String(result ?? "")
            .trim()
            .toLowerCase();
          isComplete =
            result === true ||
            normalized === "true" ||
            (Number(result) > 0 && normalized !== "");
        } catch {
          isComplete = responseCount >= assigneeCount; // fallback: all_complete
        }
      } else {
        isComplete = responseCount >= assigneeCount;
      }
      if (isComplete) {
        const outcomeExpr = String(meta.custom_rule_outcome ?? "").trim();
        if (outcomeExpr) {
          const resolved = String(
            resolveExpression(outcomeExpr, { variables }) ?? "",
          ).trim();
          winningOutcome =
            resolved || modalOutcome(outcomeCounts, latestOutcome);
        } else {
          winningOutcome = modalOutcome(outcomeCounts, latestOutcome);
        }
      }
      break;
    }

    default:
      isComplete = true;
      break;
  }

  return {
    isComplete,
    winningOutcome,
    responseCount,
    assigneeCount,
    outcomeCounts,
    unanimousFailed,
  };
}

export interface ResumePayload {
  outcome: string;
  outcome_notes: string;
  /** Who submitted it: the assignee, or the manager acting on their behalf. */
  actioned_by: string | null;
  actioned_by_name: string;
  /** The assignee a manager acted for (empty when the assignee acted). */
  actioned_on_behalf_of: string;
  actioned_on_behalf_of_name: string;
  /** The manager's on-behalf note (empty otherwise). */
  on_behalf_note: string;
  user_task_id: string;
  response_count: number;
  outcome_counts: Record<string, number>;
  /** The task's field values (metadata.template_values) — `{{task_data.<key>}}` after the node. */
  task_data: Record<string, unknown>;
}

export type RecordTaskResponseResult =
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "waiting"; responses: number; needed: number }
  | {
      status: "completed";
      outcome: string;
      responses: number;
      resume: ResumePayload;
    };

/**
 * Record one responder's outcome and evaluate the task's completion rule.
 * Caller is responsible for auth + loading the task (tenant-checked).
 * On completion this updates the task and returns the
 * FULL resume payload — every path resumes the workflow with identical
 * variables ({{response_count}} etc. used to exist only on the UI path).
 *
 * `values` are the User Task field values: validated against
 * `metadata.fields` (nothing is recorded when they are invalid) and merged
 * into `metadata.template_values`. On multi-assignee tasks the last
 * responder's values win — there are no per-responder values.
 */
export async function recordTaskResponse(params: {
  supabase: SupabaseClient;
  task: Record<string, any>;
  userId: string | null;
  outcome: string;
  outcomeNotes?: string | null;
  values?: Record<string, unknown> | null;
  source: "ui" | "api" | "agent";
  /** The form button pressed (task forms with a button bar). */
  buttonId?: string | null;
  /**
   * Acting on behalf of the assignee (lib/task-authz.ts): `userId` is then
   * the assignee (their response is the one counted) and `actorId` the
   * manager / break-glass holder who submitted it.
   */
  onBehalf?: { actorId: string; note: string | null; actedAs: "on_behalf" | "break_glass" } | null;
  /** How the caller was authorised (lifecycle metadata), e.g. 'credential'. */
  actedAs?: string | null;
}): Promise<RecordTaskResponseResult> {
  const { supabase, task, userId, outcome, outcomeNotes, values, source } =
    params;
  const onBehalf = params.onBehalf ?? null;
  // The person who clicked (audit actor); userId is whose response it is.
  const actorId = onBehalf ? onBehalf.actorId : userId;
  const behalfMeta = onBehalf
    ? { on_behalf_of: userId, on_behalf_note: onBehalf.note, acted_as: onBehalf.actedAs }
    : params.actedAs ? { acted_as: params.actedAs } : {};
  const taskId = String(task.id);
  const tenantId = String(task.tenant_id);
  const now = new Date().toISOString();
  const taskMeta = (task.metadata ?? {}) as Record<string, any>;
  const completionRule = taskMeta.completion_rule ?? "first_response";

  const { errors, templateValues } = await mergeTaskFieldValuesChecked(supabase, tenantId, taskMeta, values, { taskId, task });
  if (Object.keys(errors).length > 0) return { status: "invalid", errors };
  const meta = {
    ...taskMeta,
    template_values: templateValues,
  };
  // Attachments the values now hold belong to the task (no longer pending).
  const bindTaskFiles = async () => {
    const { attachmentIdsIn, bindFormFiles } = await import("@/lib/services/form-files");
    const ids = attachmentIdsIn(normalizeTaskFields(taskMeta.fields), templateValues);
    if (!ids.length) return;
    const { createServiceClient } = await import("@/lib/cron-auth");
    await bindFormFiles(createServiceClient() as any, tenantId, ids, { taskId });
  };

  // Record this response. Userless API keys can't vote per-user — treat as
  // first_response-style completion under the synthetic (null) responder.
  if (userId) {
    await (supabase as any).from("task_responses").upsert(
      {
        task_id: taskId,
        tenant_id: tenantId,
        user_id: userId,
        outcome: outcome || "completed",
        outcome_notes: outcomeNotes || null,
        responded_at: now,
        actioned_by: actorId,
      },
      { onConflict: "task_id,user_id" },
    );
  }

  await writeLifecycleEvent({
    supabase,
    tenantId,
    taskId,
    eventType: "task_response",
    actorId,
    metadata: {
      outcome,
      outcome_notes: outcomeNotes ?? null,
      completion_rule: completionRule,
      via: source,
      ...behalfMeta,
    },
  });

  const { data: allResponses } = await (supabase as any)
    .from("task_responses")
    .select("user_id, outcome")
    .eq("task_id", taskId);
  const responses = (allResponses ?? []) as Array<{
    user_id: string;
    outcome: string;
  }>;
  if (!userId && responses.length === 0) {
    // Synthetic single response so the evaluation has something to count.
    responses.push({ user_id: "api", outcome: outcome || "completed" });
  }

  let assigneeCount = 1;
  if (task.assigned_team_id) {
    const { count } = await (supabase as any)
      .from("user_teams")
      .select("*", { count: "exact", head: true })
      .eq("team_id", task.assigned_team_id);
    assigneeCount = count ?? 1;
  }
  const { count: collabCount } = await (supabase as any)
    .from("task_assignees")
    .select("*", { count: "exact", head: true })
    .eq("task_id", taskId);
  if (collabCount && collabCount > 0)
    assigneeCount = Math.max(assigneeCount, collabCount);

  const evaluation = evaluateCompletionRule({
    rule: completionRule,
    responses,
    assigneeCount,
    latestOutcome: outcome,
    meta,
  });

  if (evaluation.unanimousFailed) {
    await writeLifecycleEvent({
      supabase,
      tenantId,
      taskId,
      eventType: "task_unanimous_failed",
      actorId,
      metadata: {
        outcome_counts: evaluation.outcomeCounts,
        winning_outcome: evaluation.winningOutcome,
      },
    });
  }

  if (!evaluation.isComplete) {
    await (supabase as any)
      .from("tasks")
      .update({
        metadata: {
          ...meta,
          response_count: evaluation.responseCount,
          outcome_counts: evaluation.outcomeCounts,
        },
      })
      .eq("id", taskId)
      .eq("tenant_id", tenantId);
    await bindTaskFiles();
    return {
      status: "waiting",
      responses: evaluation.responseCount,
      needed: evaluation.assigneeCount,
    };
  }

  await (supabase as any)
    .from("tasks")
    .update({
      status: "completed",
      outcome: evaluation.winningOutcome,
      outcome_notes: outcomeNotes || null,
      actioned_by: actorId,
      actioned_on_behalf_of: onBehalf ? userId : null,
      actioned_at: now,
      completed_at: now,
      acceptance_status: "accepted",
      metadata: {
        ...meta,
        response_count: evaluation.responseCount,
        outcome_counts: evaluation.outcomeCounts,
        completion_rule: completionRule,
      },
    })
    .eq("id", taskId)
    .eq("tenant_id", tenantId);
  await bindTaskFiles();

  // A task form linked to a reusable form: a form submission (and the
  // "Form submitted" trigger), whichever surface completed it.
  if ((taskMeta.form_ref as Record<string, unknown> | undefined)?.form_id) {
    const [{ recordTaskFormSubmission }, { createServiceClient }] = await Promise.all([
      import("@/lib/services/form-submissions"),
      import("@/lib/cron-auth"),
    ]);
    await recordTaskFormSubmission(createServiceClient() as any, {
      tenantId,
      task: { ...task, metadata: meta },
      userId,
      outcome: evaluation.winningOutcome,
      values: templateValues,
      buttonId: params.buttonId ?? null,
    });
  }

  const nameOf = async (id: string | null, fallback: string) => {
    if (!id) return fallback;
    const { data: profile } = await (supabase as any)
      .from("users")
      .select("display_name, email")
      .eq("id", id)
      .maybeSingle();
    return (profile as any)?.display_name ?? (profile as any)?.email ?? "Unknown";
  };
  const actionedByName = await nameOf(actorId, "Automation");
  const onBehalfOfName = onBehalf ? await nameOf(userId, "") : "";

  return {
    status: "completed",
    outcome: evaluation.winningOutcome,
    responses: evaluation.responseCount,
    resume: {
      outcome: evaluation.winningOutcome,
      outcome_notes: outcomeNotes || "",
      actioned_by: actorId,
      actioned_by_name: actionedByName,
      actioned_on_behalf_of: onBehalf ? (userId ?? "") : "",
      actioned_on_behalf_of_name: onBehalfOfName,
      on_behalf_note: onBehalf?.note ?? "",
      user_task_id: taskId,
      response_count: evaluation.responseCount,
      outcome_counts: evaluation.outcomeCounts,
      task_data: templateValues,
    },
  };
}
