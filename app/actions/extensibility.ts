"use server";

import { revalidatePath } from "next/cache";
import type {
  WorkflowActivitySourceKind,
  WorkflowActivityStatus,
} from "@/lib/extensibility";
import { fromSession } from "@/lib/services/context";
import * as activities from "@/lib/services/workflow-activities";

// Thin wrappers over lib/services/workflow-activities (validation, deletion
// queue, audit and GitHub-sync capture live there).

export interface WorkflowActivityUpsertInput {
  id?: string;
  name: string;
  description?: string;
  key?: string;
  status: WorkflowActivityStatus;
  sourceKind: WorkflowActivitySourceKind;
  version?: string;
  iconName?: string;
  color?: string;
  sourceCode: string;
  manifest?: Record<string, unknown>;
  demoInputs?: Record<string, unknown>;
  tags?: string[];
  sourceFilename?: string;
}

export async function saveWorkflowActivity(input: WorkflowActivityUpsertInput) {
  const ctx = await fromSession();
  const fields = {
    name: input.name,
    description: input.description ?? null,
    key: input.key ?? null,
    status: input.status,
    source_kind: input.sourceKind,
    version: input.version ?? null,
    icon_name: input.iconName ?? null,
    color: input.color ?? null,
    source_code: input.sourceCode,
    manifest: input.manifest ?? {},
    demo_inputs: input.demoInputs ?? {},
    tags: input.tags ?? [],
    source_filename: input.sourceFilename ?? null,
  };
  const saved = input.id
    ? await activities.updateWorkflowActivity(ctx, input.id, fields)
    : await activities.createWorkflowActivity(ctx, fields);
  revalidatePath("/extensibility");
  return saved;
}

export async function deleteWorkflowActivity(activityId: string) {
  // The UI reports the delete as queued, so the queue is drained in the background.
  await activities.deleteWorkflowActivity(await fromSession(), activityId, {
    processInline: false,
  });
  revalidatePath("/extensibility");
}

export async function bulkDeleteWorkflowActivities(activityIds: string[]) {
  if (activityIds.length === 0) return { queued: 0 };
  const result = await activities.bulkDeleteWorkflowActivities(
    await fromSession(),
    activityIds,
  );
  revalidatePath("/extensibility");
  return { queued: result.deleted };
}

export async function exportWorkflowActivity(activityId: string) {
  return activities.exportWorkflowActivity(await fromSession(), activityId);
}

export async function importWorkflowActivity(importJson: string) {
  const saved = await activities.importWorkflowActivity(
    await fromSession(),
    importJson,
  );
  revalidatePath("/extensibility");
  return saved;
}
