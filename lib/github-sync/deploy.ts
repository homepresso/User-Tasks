import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAudit } from '@/lib/audit-log'
import { createGitHubClient } from '@/lib/github-sync/client'
import { getGitHubSyncConnection } from '@/lib/github-sync/connection'
import { filesToManifest, manifestPath, type RepoFile, type SyncManifest } from '@/lib/github-sync/layout'
import { importTenantManifest } from '@/lib/portability/import'
import { createEmptyAssetIdMaps, type AssetIdMaps } from '@/lib/portability/id-maps'

/**
 * Deploy side of GitHub sync: reconstruct a tenant manifest from the repo at
 * a pinned commit and import it into THIS tenant. Repeated deploys are
 * idempotent — github_sync_asset_map records source→local ids so assets are
 * UPDATED rather than duplicated.
 */

async function loadAssetIdMapSeed(supabase: SupabaseClient, tenantId: string): Promise<AssetIdMaps> {
  const seed = createEmptyAssetIdMaps()
  const { data } = await (supabase as any)
    .from('github_sync_asset_map')
    .select('asset_type, source_id, local_id')
    .eq('tenant_id', tenantId)
    .limit(10000)
  for (const row of (data ?? []) as any[]) {
    const key = row.asset_type as keyof AssetIdMaps
    if (seed[key]) seed[key][String(row.source_id)] = String(row.local_id)
  }
  return seed
}

/** Fetch the repo state at a commit and rebuild the v3 manifest object. */
export async function fetchManifestFromRepo(params: {
  token: string
  owner: string
  repo: string
  commitSha: string
  pathPrefix: string
}): Promise<Record<string, any>> {
  const { token, owner, repo, commitSha, pathPrefix } = params
  const client = createGitHubClient(token)
  const commit = await client.getCommit(owner, repo, commitSha)
  const tree = await client.getTree(owner, repo, commit.treeSha)

  const manifestFile = manifestPath(pathPrefix)
  const manifestEntry = tree.find((entry) => entry.path === manifestFile)
  if (!manifestEntry) throw new Error(`No ${manifestFile} found at ${commitSha.slice(0, 8)} — run a push from the source workspace first`)

  const manifestText = await client.getBlobText(owner, repo, manifestEntry.sha)
  const syncManifest = JSON.parse(manifestText) as SyncManifest
  const blobShaByPath = new Map(tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]))

  // Only the indexed blobs are fetched; filesToManifest then rebuilds the
  // sections in index order (listed-but-missing files are skipped).
  const files: RepoFile[] = [{ path: manifestFile, content: manifestText }]
  for (const entry of syncManifest.index ?? []) {
    const blobSha = blobShaByPath.get(entry.file)
    if (!blobSha) continue // listed but missing — skip, preflight will surface counts
    files.push({ path: entry.file, content: await client.getBlobText(owner, repo, blobSha) })
  }
  return filesToManifest(files, pathPrefix, { indexOnly: true }).manifest
}

/** Process one claimed deployment row end to end. */
export async function runDeployment(supabase: SupabaseClient, deployment: Record<string, any>): Promise<void> {
  const tenantId = String(deployment.tenant_id)
  const source = (deployment.source ?? {}) as Record<string, any>

  try {
    const connection = await getGitHubSyncConnection(supabase, tenantId, { includeToken: true })
    if (!connection?.token) throw new Error('GitHub sync is not connected')

    const manifest = await fetchManifestFromRepo({
      token: connection.token,
      owner: String(source.owner ?? connection.owner),
      repo: String(source.repo ?? connection.repo),
      commitSha: String(source.commit_sha),
      pathPrefix: String(source.path_prefix ?? connection.pathPrefix),
    })

    const sectionCounts: Record<string, number> = {}
    for (const [section, assets] of Object.entries(manifest)) {
      if (Array.isArray(assets)) sectionCounts[section] = assets.length
    }

    if (deployment.dry_run) {
      await (supabase as any).from('github_deployments').update({
        status: 'completed',
        stats: { dry_run: true, sections: sectionCounts },
        completed_at: new Date().toISOString(),
      }).eq('id', deployment.id)
      await writeAudit({
        supabase, tenantId, actorId: deployment.created_by ?? null,
        objectType: 'github_sync', objectId: deployment.id,
        action: 'import',
        summary: `Dry-run deployment from ${source.owner}/${source.repo}@${String(source.commit_sha ?? '').slice(0, 8)} (no changes applied)`,
        metadata: { source, sections: sectionCounts, dry_run: true },
      })
      return
    }

    const idMapSeed = await loadAssetIdMapSeed(supabase, tenantId)
    const mappingsToRecord: Array<{ asset_type: string; source_id: string; local_id: string }> = []

    const result = await importTenantManifest({
      supabase,
      tenantId,
      manifest,
      mode: 'upsert',
      idMapSeed,
      onAssetWritten: (assetType: string, sourceId: string, localId: string) => {
        // onAssetWritten already reports the internal singular type
        // ('workflow', 'reference', …), which IS the AssetIdMaps key.
        mappingsToRecord.push({ asset_type: String(assetType), source_id: sourceId, local_id: localId })
      },
    } as any)

    if (mappingsToRecord.length > 0) {
      await (supabase as any).from('github_sync_asset_map').upsert(
        mappingsToRecord.map((m) => ({
          tenant_id: tenantId,
          ...m,
          source_repo: `${source.owner}/${source.repo}`,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'tenant_id,asset_type,source_id' },
      )
    }

    await (supabase as any).from('github_deployments').update({
      status: 'completed',
      stats: {
        sections: sectionCounts,
        created: (result as any)?.counts ?? (result as any)?.created ?? null,
        updated: (result as any)?.updated ?? null,
        errors: (result as any)?.errors ?? [],
      },
      completed_at: new Date().toISOString(),
    }).eq('id', deployment.id)
    const totalAssets = Object.values(sectionCounts).reduce((sum, n) => sum + n, 0)
    await writeAudit({
      supabase, tenantId, actorId: deployment.created_by ?? null,
      objectType: 'github_sync', objectId: deployment.id,
      action: 'import',
      summary: `Deployed ${totalAssets} assets from ${source.owner}/${source.repo}@${String(source.commit_sha ?? '').slice(0, 8)}`,
      metadata: { source, sections: sectionCounts },
    })
  } catch (error: any) {
    await (supabase as any).from('github_deployments').update({
      status: 'failed',
      error: String(error?.message ?? error),
      completed_at: new Date().toISOString(),
    }).eq('id', deployment.id)
    await writeAudit({
      supabase, tenantId, actorId: deployment.created_by ?? null,
      objectType: 'github_sync', objectId: deployment.id,
      action: 'import',
      summary: `GitHub deployment failed: ${String(error?.message ?? error).slice(0, 200)}`,
      metadata: { source, failed: true },
    })
  }
}

/** Claim-and-run loop for the cron worker / kick endpoint. */
export async function processDeploymentQueue(supabase: SupabaseClient, workerId: string, maxJobs = 3): Promise<number> {
  let processed = 0
  for (let i = 0; i < maxJobs; i++) {
    const { data: claimed } = await (supabase as any).rpc('claim_next_github_deployment', { p_worker_id: workerId })
    const deployment = Array.isArray(claimed) ? claimed[0] : claimed
    if (!deployment) break
    await runDeployment(supabase, deployment)
    processed++
  }
  return processed
}
