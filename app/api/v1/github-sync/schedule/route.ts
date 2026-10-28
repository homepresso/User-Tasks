import { NextRequest } from "next/server";
import { validateApiKey, ok, err, requireApiPermission } from "@/lib/api-auth";
import {
  getGitHubSyncConnection,
  updateGitHubSyncState,
} from "@/lib/github-sync/connection";
import { normalizeScheduleConfig } from "@/lib/workflow-schedule";
import { writeAudit } from "@/lib/audit-log";

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.success) return auth.response;
  const forbidden = requireApiPermission(auth, "sync.view");
  if (forbidden) return forbidden;
  const connection = await getGitHubSyncConnection(
    auth.supabase,
    auth.tenantId,
  );
  if (!connection)
    return err("GitHub sync is not connected for this workspace", 404);
  return ok({
    schedule: connection.schedule ?? null,
    last_fired_at: connection.scheduleLastFiredAt ?? null,
  });
}

export async function PUT(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.success) return auth.response;
  const forbidden = requireApiPermission(auth, "sync.manage");
  if (forbidden) return forbidden;
  const connection = await getGitHubSyncConnection(
    auth.supabase,
    auth.tenantId,
  );
  if (!connection)
    return err("GitHub sync is not connected for this workspace", 409);
  const body = await request.json().catch(() => ({}));
  const normalized = normalizeScheduleConfig(body.schedule ?? body);
  if (
    !normalized ||
    !["hourly", "daily", "weekly"].includes(normalized.schedule_mode)
  ) {
    return err(
      "Schedule must use hourly, daily, or weekly mode with valid time settings",
      400,
    );
  }
  await updateGitHubSyncState(auth.supabase, auth.tenantId, {
    schedule: normalized as any,
    schedule_last_fired_at: new Date().toISOString(),
  });
  await writeAudit({
    supabase: auth.supabase,
    tenantId: auth.tenantId,
    actorId: auth.actingUserId,
    objectType: "github_sync",
    objectId: connection.id,
    action: "update",
    summary: `Scheduled automatic GitHub sync (${normalized.schedule_mode}) via API`,
    metadata: { schedule: normalized },
  });
  return ok({ schedule: normalized, last_fired_at: new Date().toISOString() });
}

export async function DELETE(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.success) return auth.response;
  const forbidden = requireApiPermission(auth, "sync.manage");
  if (forbidden) return forbidden;
  const connection = await getGitHubSyncConnection(
    auth.supabase,
    auth.tenantId,
  );
  if (!connection)
    return err("GitHub sync is not connected for this workspace", 409);
  await updateGitHubSyncState(auth.supabase, auth.tenantId, {
    schedule: null,
    schedule_last_fired_at: null,
  });
  await writeAudit({
    supabase: auth.supabase,
    tenantId: auth.tenantId,
    actorId: auth.actingUserId,
    objectType: "github_sync",
    objectId: connection.id,
    action: "update",
    summary: "Disabled scheduled GitHub sync via API",
  });
  return ok({ schedule: null, disabled: true });
}
