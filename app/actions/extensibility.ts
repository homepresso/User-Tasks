"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { runAction } from "@/lib/actions/run-action";
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

export async function deleteWorkflowActivity(activityId: string): Promise<ActionResult<{ deleted: true; id: string }>> {
  // The UI reports the delete as queued, so the queue is drained in the background.
  // Refused (with the usages) while a workflow uses the action.
  return runAction("deleteWorkflowActivity", "Could not delete the action.", async () => {
    const result = await activities.deleteWorkflowActivity(await fromSession(), activityId, { processInline: false });
    revalidatePath("/extensibility");
    return result;
  });
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

// ── Packaged workflow actions: upload, access, secrets, test ───────────────

type Ctx = Awaited<ReturnType<typeof fromSession>>

function act<T>(label: string, fallback: string, fn: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(label, fallback, async () => fn(await fromSession()))
}

/** Upload: FormData with `file` (a .zip, or a .js / .mjs module) and, for a module, `manifest` (file or JSON text). */
export async function uploadWorkflowAction(form: FormData) {
  return act("uploadWorkflowAction", "Could not upload the action.", async (ctx) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a .zip package or an ES module");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const manifestField = form.get("manifest");
    const manifest = manifestField instanceof File ? await manifestField.text() : typeof manifestField === "string" ? manifestField : undefined;
    const isZip = /\.zip$/i.test(file.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
    const result = await activities.uploadWorkflowAction(ctx, isZip ? { zip: bytes } : { module: new TextDecoder().decode(bytes), manifest });
    revalidatePath("/extensibility");
    return result;
  });
}

/** Full detail for the Manage dialog: the action (versions, which secrets are set) and its usages. */
export async function getWorkflowActionDetail(activityId: string) {
  return act("getWorkflowActionDetail", "Could not load the action.", async (ctx) => {
    const [activity, usages] = await Promise.all([
      activities.getWorkflowActivity(ctx, activityId),
      activities.getWorkflowActivityUsages(ctx, activityId),
    ]);
    return { activity, usages };
  });
}

/** Kill switch, approved hosts, data grants. */
export async function updateWorkflowActionAccess(activityId: string, input: { enabled?: boolean; approved_hosts?: string[]; data_grants?: Array<{ table_id: string; access: "read" | "write" }> }) {
  return act("updateWorkflowActionAccess", "Could not update the action.", async (ctx) => {
    const result = await activities.updateWorkflowActivity(ctx, activityId, input);
    revalidatePath("/extensibility");
    return result;
  });
}

export async function setWorkflowActionSecrets(activityId: string, values: Record<string, string | null>) {
  return act("setWorkflowActionSecrets", "Could not store the secrets.", (ctx) => activities.setWorkflowActivitySecrets(ctx, activityId, values));
}

export async function testWorkflowAction(activityId: string, input: { operation?: string | null; inputs?: Record<string, unknown> | null; version?: string | null }) {
  return act("testWorkflowAction", "Could not run the test.", (ctx) => activities.testWorkflowActivity(ctx, activityId, input));
}

/** Data tables an administrator can grant (id + name). */
export async function listGrantableTables() {
  return act("listGrantableTables", "Could not list data tables.", async (ctx) => {
    const { listDataTables } = await import("@/lib/services/data-tables");
    const { data_tables } = await listDataTables(ctx, {}, { limit: 500, offset: 0 });
    return data_tables.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }));
  });
}
