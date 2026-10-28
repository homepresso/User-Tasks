import { NextRequest } from "next/server";
import { validateApiKey, ok, err, requireApiPermission } from "@/lib/api-auth";
import { getGitHubSyncConnection } from "@/lib/github-sync/connection";
import { createGitHubClient } from "@/lib/github-sync/client";
import { kickGitHubDeployWorker } from "@/lib/github-sync/deploy-kick";

export const maxDuration = 60;

/**
 * POST /api/v1/github-sync/deploy
 * Body: { ref?: string, commit_sha?: string, dry_run?: boolean }
 * Enqueues a deployment that imports the connected repo's configuration
 * into this tenant. Returns 202 with a deployment id to poll.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.success) return auth.response;
  const forbidden = requireApiPermission(auth, "sync.deploy");
  if (forbidden) return forbidden;
  const { tenantId, supabase, actingUserId } = auth;

  const body = await request.json().catch(() => ({}));
  const dryRun = Boolean(body.dry_run);

  const connection = await getGitHubSyncConnection(supabase, tenantId, {
    includeToken: true,
  });
  if (!connection?.isEnabled || !connection.token) {
    return err("GitHub sync is not connected for this workspace", 409);
  }

  // Pin the deployment to a concrete commit so status reporting is stable.
  let commitSha = String(body.commit_sha ?? "").trim();
  const ref = String(body.ref ?? connection.branch).trim();
  if (!commitSha) {
    try {
      const client = createGitHubClient(connection.token);
      commitSha = (await client.getRef(connection.owner, connection.repo, ref))
        .sha;
    } catch (error: any) {
      return err(
        `Could not resolve ref "${ref}": ${error?.message ?? error}`,
        502,
      );
    }
  }

  const { data: deployment, error } = await (supabase as any)
    .from("github_deployments")
    .insert({
      tenant_id: tenantId,
      source: {
        owner: connection.owner,
        repo: connection.repo,
        ref,
        commit_sha: commitSha,
        path_prefix: connection.pathPrefix,
      },
      dry_run: dryRun,
      created_by: actingUserId ?? null,
    })
    .select("id, status")
    .single();
  if (error) return err(error.message, 500);

  kickGitHubDeployWorker();
  return ok(
    {
      deployment_id: deployment.id,
      status: deployment.status,
      status_url: `/api/v1/github-sync/deployments/${deployment.id}`,
      commit_sha: commitSha,
      dry_run: dryRun,
    },
    202,
  );
}
