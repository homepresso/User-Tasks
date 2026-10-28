import type { SupabaseClient } from "@supabase/supabase-js";
import { GITHUB_CONNECTOR_KEY } from "@/lib/github-sync/connection";
import { configuredAppUrl, processorSecret } from "@/lib/config/bootstrap";

/**
 * Change capture for GitHub sync. Called (fire-and-forget) from every asset
 * save/delete server action. Cheap no-op when the tenant has no enabled
 * GitHub connection. A failure here must never fail the user's save — all
 * errors are swallowed and logged.
 */

/** Asset types the sync understands — mirror of the manifest sections. */
export type SyncAssetType =
  | "workflow"
  | "data_table"
  | "decision_table"
  | "integration"
  | "reference"
  | "object"
  | "retention_policy"
  | "agent"
  | "report"
  | "workflow_activity"
  | "space"
  | "role"
  | "mcp_server"
  | "email_template"
  | "connector"
  | "log_destination"
  | "form"
  | "form_theme";

export async function recordAssetChange(params: {
  supabase: SupabaseClient;
  tenantId: string;
  assetType: SyncAssetType;
  assetId: string;
  assetName?: string | null;
  action?: "save" | "delete";
  actorId?: string | null;
}): Promise<void> {
  const { supabase, tenantId, assetType, assetId, assetName, actorId } = params;
  const action = params.action ?? "save";
  try {
    const { data: connector } = await (supabase as any)
      .from("tenant_connectors")
      .select("id, is_enabled, config")
      .eq("tenant_id", tenantId)
      .eq("connector_key", GITHUB_CONNECTOR_KEY)
      .maybeSingle();
    if (!connector?.is_enabled) return;

    // One pending row per asset (partial unique index): a later save
    // supersedes, and a delete overwrites a queued save.
    const { error: upsertError } = await (supabase as any)
      .from("github_sync_queue")
      .upsert(
        {
          tenant_id: tenantId,
          asset_type: assetType,
          asset_id: assetId,
          asset_name: assetName ?? null,
          action,
          status: "pending",
          queued_by: actorId ?? null,
          queued_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,asset_type,asset_id" },
      );
    if (upsertError) {
      // Partial-index upserts can be unsupported depending on PostgREST
      // version — fall back to delete+insert of the pending row.
      await (supabase as any)
        .from("github_sync_queue")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("asset_type", assetType)
        .eq("asset_id", assetId)
        .eq("status", "pending");
      await (supabase as any).from("github_sync_queue").insert({
        tenant_id: tenantId,
        asset_type: assetType,
        asset_id: assetId,
        asset_name: assetName ?? null,
        action,
        queued_by: actorId ?? null,
      });
    }

    if ((connector.config as any)?.mode === "auto") {
      kickGitHubPusher();
    }
  } catch (error) {
    console.warn("[github-sync] recordAssetChange failed:", error);
  }
}

/** Fire-and-forget nudge to the push worker (kickDeletionProcessor pattern). */
export function kickGitHubPusher(): void {
  try {
    const baseUrl =
      configuredAppUrl()?.trim() || "http://localhost:3000";
    const secret =
      processorSecret();
    void fetch(`${baseUrl}/api/github-sync/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-Processor-Secret": secret } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => {});
  } catch {
    // never throw from a kick
  }
}
