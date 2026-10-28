import { NextRequest } from "next/server";
import {
  validateApiKey,
  ok,
  err,
  requireApiPermission,
  parsePagination,
} from "@/lib/api-auth";
import {
  enqueueApiSyncRun,
  GITHUB_SYNC_RUN_SELECT,
  normalizeApiSyncScope,
  type ApiSyncKind,
} from "@/lib/github-sync/api-runs";

/** GET /api/v1/github-sync/runs — list sync-run history. */
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.success) return auth.response;
  const forbidden = requireApiPermission(auth, "sync.view");
  if (forbidden) return forbidden;
  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const status = request.nextUrl.searchParams.get("status");
  const kind = request.nextUrl.searchParams.get("kind");
  let query = (auth.supabase as any)
    .from("github_sync_runs")
    .select(GITHUB_SYNC_RUN_SELECT, { count: "exact" })
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (kind) query = query.eq("kind", kind);
  query = query.range(offset, offset + (limit ?? 50) - 1);
  const { data, count, error } = await query;
  if (error) return err(error.message, 500);
  return ok({ runs: data ?? [], total: count ?? 0 });
}

/** POST /api/v1/github-sync/runs — enqueue a full, pending-change, or scoped sync. */
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.success) return auth.response;
  const forbidden = requireApiPermission(auth, "sync.manage");
  if (forbidden) return forbidden;
  const body = await request.json().catch(() => ({}));
  const kind = String(body.kind ?? "full_resync") as ApiSyncKind;
  if (!["full_resync", "commit", "template"].includes(kind)) {
    return err("kind must be full_resync, commit, or template", 400);
  }
  const scope = normalizeApiSyncScope(body.scope);
  try {
    const result = await enqueueApiSyncRun({
      supabase: auth.supabase,
      tenantId: auth.tenantId,
      actorId: auth.actingUserId,
      kind,
      message: typeof body.message === "string" ? body.message : undefined,
      scope,
    });
    return ok(
      { ...result, status_url: `/api/v1/github-sync/runs/${result.run.id}` },
      result.already_running ? 200 : 202,
    );
  } catch (error: any) {
    return err(
      error?.message ?? "Could not start GitHub sync",
      /not connected/i.test(error?.message ?? "") ? 409 : 400,
    );
  }
}
