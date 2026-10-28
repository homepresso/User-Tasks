import { NextRequest } from "next/server";
import { validateApiKey, ok, err, requireApiPermission } from "@/lib/api-auth";
import { GITHUB_SYNC_RUN_SELECT } from "@/lib/github-sync/api-runs";

/** GET /api/v1/github-sync/runs/{id} — poll one sync run. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await validateApiKey(request);
  if (!auth.success) return auth.response;
  const forbidden = requireApiPermission(auth, "sync.view");
  if (forbidden) return forbidden;
  const { id } = await params;
  const { data, error } = await (auth.supabase as any)
    .from("github_sync_runs")
    .select(GITHUB_SYNC_RUN_SELECT)
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) return err(error.message, 500);
  if (!data) return err("GitHub sync run not found", 404);
  return ok({ run: data });
}
