import type { SupabaseClient } from "@supabase/supabase-js";
import { getGitHubSyncConnection } from "@/lib/github-sync/connection";
import { kickGitHubPusher } from "@/lib/github-sync/enqueue";
import { SYNC_SECTION_CATALOG } from "@/lib/github-sync/scope-catalog";
import type { SyncScope } from "@/lib/github-sync/push";

export type ApiSyncKind = "full_resync" | "commit" | "template";

export function normalizeApiSyncScope(raw: unknown): SyncScope | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as Record<string, any>;
  const validSections = new Set(
    SYNC_SECTION_CATALOG.map((item) => item.section),
  );
  const assetTypes = Array.isArray(input.asset_types)
    ? input.asset_types
        .map(String)
        .filter((section: string) => validSections.has(section))
    : [];
  const assets = Array.isArray(input.assets)
    ? input.assets
        .filter(
          (asset: any) =>
            validSections.has(String(asset?.section ?? "")) &&
            String(asset?.id ?? "").trim(),
        )
        .map((asset: any) => ({
          section: String(asset.section),
          id: String(asset.id),
          ...(asset.name ? { name: String(asset.name) } : {}),
        }))
    : [];
  if (!assetTypes.length && !assets.length) return undefined;
  return { asset_types: assetTypes, assets };
}

export async function enqueueApiSyncRun(options: {
  supabase: SupabaseClient | any;
  tenantId: string;
  actorId?: string | null;
  kind: ApiSyncKind;
  message?: string;
  scope?: SyncScope;
}) {
  const { supabase, tenantId } = options;
  const connection = await getGitHubSyncConnection(supabase, tenantId);
  if (!connection?.isEnabled)
    throw new Error("GitHub sync is not connected for this workspace");

  const { data: active } = await (supabase as any)
    .from("github_sync_runs")
    .select("id, kind, status, created_at, started_at")
    .eq("tenant_id", tenantId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1);
  const activeRun = (active ?? [])[0];
  if (activeRun) return { run: activeRun, already_running: true };

  if (options.kind === "template" && !options.scope) {
    throw new Error("A scoped sync requires scope.asset_types or scope.assets");
  }

  const { data, error } = await (supabase as any)
    .from("github_sync_runs")
    .insert({
      tenant_id: tenantId,
      kind: options.kind,
      message: options.message?.trim() || null,
      created_by: options.actorId ?? null,
      ...(options.scope ? { scope: options.scope } : {}),
    })
    .select("id, kind, status, created_at")
    .single();
  if (error) {
    if (String(error.code ?? "") === "23505") {
      const { data: winner } = await (supabase as any)
        .from("github_sync_runs")
        .select("id, kind, status, created_at, started_at")
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "running"])
        .limit(1);
      if ((winner ?? [])[0])
        return { run: (winner ?? [])[0], already_running: true };
    }
    throw new Error(error.message);
  }

  kickGitHubPusher();
  return { run: data, already_running: false };
}

export const GITHUB_SYNC_RUN_SELECT =
  "id, kind, status, progress, commit_sha, files_changed, error, message, scope, created_at, started_at, completed_at";
