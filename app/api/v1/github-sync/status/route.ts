import { NextRequest } from "next/server";
import { validateApiKey, ok, err, requireApiPermission } from "@/lib/api-auth";
import { getGitHubSyncConnection } from "@/lib/github-sync/connection";
import { GITHUB_SYNC_RUN_SELECT } from "@/lib/github-sync/api-runs";

/** GET /api/v1/github-sync/status — connection, queue, latest sync run, and latest deployment. */
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.success) return auth.response;
  const forbidden = requireApiPermission(auth, "sync.view");
  if (forbidden) return forbidden;
  const { supabase, tenantId } = auth;

  const [connection, pending, latestRun, latestDeployment] = await Promise.all([
    getGitHubSyncConnection(supabase, tenantId),
    (supabase as any)
      .from("github_sync_queue")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "pending"),
    (supabase as any)
      .from("github_sync_runs")
      .select(GITHUB_SYNC_RUN_SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    (supabase as any)
      .from("github_deployments")
      .select(
        "id, source, dry_run, status, stats, error, created_at, started_at, completed_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (latestRun.error) return err(latestRun.error.message, 500);
  if (latestDeployment.error) return err(latestDeployment.error.message, 500);
  return ok({
    connected: Boolean(connection?.isEnabled),
    connection,
    pending_changes: pending.count ?? 0,
    latest_run: latestRun.data ?? null,
    latest_deployment: latestDeployment.data ?? null,
  });
}
