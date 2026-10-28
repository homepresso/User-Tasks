import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAudit } from '@/lib/audit-log'
import { buildTenantExport } from '@/lib/portability/export'
import { createGitHubClient, type GitHubCommitFile } from '@/lib/github-sync/client'
import {
  getGitHubSyncConnection,
  updateGitHubSyncState,
  type GitHubSyncConnection,
} from '@/lib/github-sync/connection'
import {
  assetRepoFile,
  buildSyncManifest,
  manifestPath,
  planManifestFiles,
  repoPathPrefix,
  SECTION_TO_DIR,
  stringifyForRepo,
  type ManifestIndexEntry,
  type SyncManifest,
} from '@/lib/github-sync/layout'

/**
 * Push side of GitHub sync: turns the tenant's portable configuration into
 * one-file-per-asset JSON in the connected repo.
 *
 * - runFullResync: rewrites every asset file + manifest.json in one commit
 *   (first push after connecting, drift repair, and the MCP-mutation gap).
 * - processPushBatch: flushes pending github_sync_queue rows as one commit
 *   (auto mode: called by the cron worker/kick; queue mode: called by the
 *   user's "Commit now" or the /commit API).
 */

/** Queue asset_type → manifest section (used for incremental pushes). */
const QUEUE_TYPE_TO_SECTION: Record<string, string> = {
  workflow: 'workflows',
  data_table: 'data_tables',
  decision_table: 'decision_tables',
  integration: 'integrations',
  reference: 'references',
  retention_policy: 'retention_policies',
  agent: 'agents',
  report: 'reports',
  workflow_activity: 'workflow_activities',
  role: 'roles',
  mcp_server: 'mcp_servers',
  object: 'objects',
  email_template: 'email_templates',
  connector: 'connectors',
  log_destination: 'log_destinations',
  form: 'forms',
  form_theme: 'form_themes',
}

/** Build the complete file set + manifest index from a tenant export. */
function planFullRepo(manifest: Record<string, any>, pathPrefix: string): { files: GitHubCommitFile[]; index: ManifestIndexEntry[] } {
  return planManifestFiles(manifest, repoPathPrefix(pathPrefix))
}

async function requireConnection(supabase: SupabaseClient, tenantId: string): Promise<GitHubSyncConnection & { token: string }> {
  const connection = await getGitHubSyncConnection(supabase, tenantId, { includeToken: true })
  if (!connection?.isEnabled) throw new Error('GitHub sync is not connected')
  if (!connection.token) throw new Error('GitHub token is missing — reconnect the repository')
  return connection as GitHubSyncConnection & { token: string }
}

export interface SyncProgress {
  phase: 'exporting' | 'planning' | 'pruning' | 'uploading' | 'done'
  files_done: number
  files_total: number
  message: string
}

/** Rewrite every asset file + manifest.json in one commit. */
export async function runFullResync(
  supabase: SupabaseClient,
  tenantId: string,
  opts?: { message?: string; onProgress?: (progress: SyncProgress) => Promise<void> | void },
): Promise<{ commitSha: string; filesChanged: number }> {
  const connection = await requireConnection(supabase, tenantId)
  const client = createGitHubClient(connection.token)
  const report = async (progress: SyncProgress) => { try { await opts?.onProgress?.(progress) } catch { /* progress is best-effort */ } }

  await report({ phase: 'exporting', files_done: 0, files_total: 0, message: 'Exporting workspace configuration…' })
  const manifest = await buildTenantExport(supabase, tenantId)
  const plan = planFullRepo(manifest, connection.pathPrefix)
  await report({ phase: 'planning', files_done: 0, files_total: plan.files.length, message: `Prepared ${plan.files.length} files` })

  // Prune repo files under the prefix that no longer correspond to assets.
  // Empty repos (no initial commit) have nothing to prune — skip gracefully;
  // commitFiles bootstraps the first commit.
  const manifestFile = manifestPath(connection.pathPrefix)
  await report({ phase: 'pruning', files_done: 0, files_total: plan.files.length, message: 'Checking repository for stale files…' })
  try {
    const ref = await client.getRef(connection.owner, connection.repo, connection.branch)
    const commit = await client.getCommit(connection.owner, connection.repo, ref.sha)
    const tree = await client.getTree(connection.owner, connection.repo, commit.treeSha)
    const managedPrefix = `${connection.pathPrefix.replace(/\/+$/g, '')}/`
    const plannedPaths = new Set(plan.files.map((f) => f.path))
    for (const entry of tree) {
      if (entry.type !== 'blob') continue
      if (!entry.path.startsWith(managedPrefix)) continue
      if (entry.path === manifestFile) continue
      if (!entry.path.endsWith('.json')) continue
      if (!plannedPaths.has(entry.path)) {
        plan.files.push({ path: entry.path, content: null })
      }
    }
  } catch (error: any) {
    if (!(error?.status === 409 || error?.status === 404)) throw error
  }

  plan.files.push({ path: manifestFile, content: stringifyForRepo(buildSyncManifest(plan.index)) })

  await report({ phase: 'uploading', files_done: 0, files_total: plan.files.length, message: `Committing ${plan.files.length} files to ${connection.owner}/${connection.repo}…` })
  const result = await client.commitFiles({
    owner: connection.owner,
    repo: connection.repo,
    branch: connection.branch,
    message: opts?.message?.trim() || 'usertasks: full configuration sync',
    files: plan.files,
  })

  await updateGitHubSyncState(supabase, tenantId, {
    last_push_sha: result.commitSha,
    last_push_at: new Date().toISOString(),
  })
  await report({ phase: 'done', files_done: plan.files.length, files_total: plan.files.length, message: 'Sync complete' })
  return { commitSha: result.commitSha, filesChanged: plan.files.length }
}

export interface SyncScope {
  /** Manifest section keys synced in full (e.g. 'workflows', 'reports'). */
  asset_types?: string[]
  /** Individual assets: section + id (name is display-only). */
  assets?: Array<{ section: string; id: string; name?: string }>
  template_id?: string
  template_name?: string
}

/** Human summary of a scope, for commit messages and audit entries. */
export function describeScope(scope: SyncScope): string {
  const parts: string[] = []
  if (scope.asset_types?.length) parts.push(`${scope.asset_types.length} asset type${scope.asset_types.length === 1 ? '' : 's'}`)
  if (scope.assets?.length) parts.push(`${scope.assets.length} item${scope.assets.length === 1 ? '' : 's'}`)
  return parts.join(' + ') || 'empty selection'
}

/**
 * Push a SELECTION of assets (whole types and/or individual items) as one
 * commit. Writes only the matching files and patches manifest.json's index —
 * never prunes, so assets outside the scope are untouched. Renamed assets
 * have their old file removed (path is derived from the name).
 */
export async function runScopedSync(
  supabase: SupabaseClient,
  tenantId: string,
  scope: SyncScope,
  opts?: { message?: string; onProgress?: (progress: SyncProgress) => Promise<void> | void },
): Promise<{ commitSha: string; filesChanged: number }> {
  const connection = await requireConnection(supabase, tenantId)
  const client = createGitHubClient(connection.token)
  const report = async (progress: SyncProgress) => { try { await opts?.onProgress?.(progress) } catch { /* best-effort */ } }

  await report({ phase: 'exporting', files_done: 0, files_total: 0, message: 'Exporting selected configuration…' })
  const manifest = await buildTenantExport(supabase, tenantId)

  const typeSet = new Set(scope.asset_types ?? [])
  const idsBySection = new Map<string, Set<string>>()
  for (const item of scope.assets ?? []) {
    if (!item?.section || !item?.id) continue
    if (!idsBySection.has(item.section)) idsBySection.set(item.section, new Set())
    idsBySection.get(item.section)!.add(String(item.id))
  }

  const scoped = planManifestFiles(manifest, repoPathPrefix(connection.pathPrefix), (section, asset) =>
    typeSet.has(section) || Boolean(idsBySection.get(section)?.has(String(asset.id))))
  const files: GitHubCommitFile[] = scoped.files
  const newEntries: ManifestIndexEntry[] = scoped.index
  if (newEntries.length === 0) {
    throw new Error('Nothing matched the selection — the chosen items may have been deleted.')
  }
  await report({ phase: 'planning', files_done: 0, files_total: files.length, message: `Prepared ${files.length} files (${describeScope(scope)})` })

  // Merge into the repo's current index; drop old files for renamed assets.
  const manifestFile = manifestPath(connection.pathPrefix)
  let currentIndex: ManifestIndexEntry[] = []
  try {
    const currentManifestRaw = await client.getFileText(connection.owner, connection.repo, manifestFile, connection.branch)
    currentIndex = currentManifestRaw ? ((JSON.parse(currentManifestRaw) as SyncManifest).index ?? []) : []
  } catch { /* empty repo or unreadable manifest → start fresh */ }
  const indexById = new Map(currentIndex.map((entry) => [`${entry.asset_type}:${entry.id}`, entry]))
  for (const entry of newEntries) {
    const key = `${entry.asset_type}:${entry.id}`
    const existing = indexById.get(key)
    if (existing && existing.file !== entry.file) {
      files.push({ path: existing.file, content: null })
    }
    indexById.set(key, entry)
  }
  files.push({ path: manifestFile, content: stringifyForRepo(buildSyncManifest([...indexById.values()])) })

  await report({ phase: 'uploading', files_done: 0, files_total: files.length, message: `Committing ${files.length} files to ${connection.owner}/${connection.repo}…` })
  const result = await client.commitFiles({
    owner: connection.owner,
    repo: connection.repo,
    branch: connection.branch,
    message: opts?.message?.trim()
      || (scope.template_name ? `usertasks: template sync (${scope.template_name})` : `usertasks: selected sync (${describeScope(scope)})`),
    files,
  })

  await updateGitHubSyncState(supabase, tenantId, {
    last_push_sha: result.commitSha,
    last_push_at: new Date().toISOString(),
  })
  await report({ phase: 'done', files_done: files.length, files_total: files.length, message: 'Sync complete' })
  return { commitSha: result.commitSha, filesChanged: files.length }
}

/**
 * Flush pending queue rows for a tenant as one commit. Incremental: exports
 * only the queued assets, patches manifest.json's index, and handles renames
 * (old path deleted when the slug changed) and deletions.
 */
export async function processPushBatch(
  supabase: SupabaseClient,
  tenantId: string,
  opts?: { message?: string; actorName?: string },
): Promise<{ commitSha: string | null; filesChanged: number; processed: number }> {
  const connection = await requireConnection(supabase, tenantId)
  const client = createGitHubClient(connection.token)

  const { data: pending } = await (supabase as any)
    .from('github_sync_queue')
    .select('id, asset_type, asset_id, asset_name, action')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .order('queued_at', { ascending: true })
    .limit(200)
  const rows = (pending ?? []) as Array<{ id: string; asset_type: string; asset_id: string; asset_name: string | null; action: 'save' | 'delete' }>
  if (rows.length === 0) return { commitSha: null, filesChanged: 0, processed: 0 }

  const rowIds = rows.map((r) => r.id)
  await (supabase as any).from('github_sync_queue').update({ status: 'processing', updated_at: new Date().toISOString() }).in('id', rowIds)

  try {
    // Full tenant export once — cheaper than per-asset queries and reuses the
    // exact manifest shapes; we pick out only the queued assets.
    const manifest = await buildTenantExport(supabase, tenantId)
    const assetsBySection: Record<string, Map<string, any>> = {}
    for (const { section } of SECTION_TO_DIR) {
      const list = manifest[section]
      if (Array.isArray(list)) assetsBySection[section] = new Map(list.map((a: any) => [String(a.id), a]))
    }

    // Current manifest index (for rename/delete path resolution).
    const manifestFile = manifestPath(connection.pathPrefix)
    const currentManifestRaw = await client.getFileText(connection.owner, connection.repo, manifestFile, connection.branch)
    let currentIndex: ManifestIndexEntry[] = []
    try {
      currentIndex = currentManifestRaw ? (JSON.parse(currentManifestRaw) as SyncManifest).index ?? [] : []
    } catch { currentIndex = [] }
    const indexById = new Map(currentIndex.map((entry) => [`${entry.asset_type}:${entry.id}`, entry]))

    const files: GitHubCommitFile[] = []

    for (const row of rows) {
      const section = QUEUE_TYPE_TO_SECTION[row.asset_type] ?? row.asset_type
      const existingEntry = indexById.get(`${section}:${row.asset_id}`)

      if (row.action === 'delete') {
        if (existingEntry) {
          files.push({ path: existingEntry.file, content: null })
          indexById.delete(`${section}:${row.asset_id}`)
        }
        continue
      }

      const asset = assetsBySection[section]?.get(String(row.asset_id))
      if (!asset) {
        // Asset vanished between queue and push — treat as delete.
        if (existingEntry) {
          files.push({ path: existingEntry.file, content: null })
          indexById.delete(`${section}:${row.asset_id}`)
        }
        continue
      }

      const { file, entry } = assetRepoFile(repoPathPrefix(connection.pathPrefix), section, asset)
      if (existingEntry && existingEntry.file !== file.path) {
        files.push({ path: existingEntry.file, content: null }) // rename: drop old path
      }
      files.push(file)
      indexById.set(`${section}:${row.asset_id}`, entry)
    }

    files.push({ path: manifestFile, content: stringifyForRepo(buildSyncManifest([...indexById.values()])) })

    const summaryNames = rows.slice(0, 3).map((r) => r.asset_name || r.asset_type).join(', ')
    const message = opts?.message?.trim()
      || `usertasks: sync ${rows.length} change${rows.length === 1 ? '' : 's'} (${summaryNames}${rows.length > 3 ? ', …' : ''})`

    const result = await client.commitFiles({
      owner: connection.owner,
      repo: connection.repo,
      branch: connection.branch,
      message,
      files,
      authorName: opts?.actorName,
    })

    await (supabase as any)
      .from('github_sync_queue')
      .update({ status: 'committed', commit_sha: result.commitSha, updated_at: new Date().toISOString() })
      .in('id', rowIds)
    await updateGitHubSyncState(supabase, tenantId, {
      last_push_sha: result.commitSha,
      last_push_at: new Date().toISOString(),
    })
    return { commitSha: result.commitSha, filesChanged: files.length, processed: rows.length }
  } catch (error: any) {
    await (supabase as any)
      .from('github_sync_queue')
      .update({
        status: 'pending', // retry on the next tick
        error: String(error?.message ?? error),
        updated_at: new Date().toISOString(),
      })
      .in('id', rowIds)
    throw error
  }
}

/** Cron/kick entry: process every tenant with an enabled auto-mode connection and pending rows. */
export async function processAllPendingPushes(supabase: SupabaseClient): Promise<{ tenants: number; commits: number }> {
  const { data: tenants } = await (supabase as any)
    .from('github_sync_queue')
    .select('tenant_id')
    .eq('status', 'pending')
    .limit(500)
  const uniqueTenants = [...new Set(((tenants ?? []) as any[]).map((row) => String(row.tenant_id)))]

  let commits = 0
  for (const tenantId of uniqueTenants) {
    try {
      const connection = await getGitHubSyncConnection(supabase, tenantId)
      if (!connection?.isEnabled || connection.mode !== 'auto') continue // queue mode waits for explicit commit
      const result = await processPushBatch(supabase, tenantId)
      if (result.commitSha) commits++
    } catch (error) {
      console.error('[github-sync] push failed for tenant', tenantId, error)
    }
  }
  return { tenants: uniqueTenants.length, commits }
}


// ─── Background runs + scheduled syncs ──────────────────────────────────────

/** Execute one claimed github_sync_runs row with live progress updates. */
export async function executeSyncRun(supabase: SupabaseClient, run: Record<string, any>): Promise<void> {
  const tenantId = String(run.tenant_id)
  const updateRun = async (patch: Record<string, unknown>) => {
    await (supabase as any).from('github_sync_runs').update(patch).eq('id', run.id)
  }
  try {
    const scope = (run.scope ?? null) as SyncScope | null
    const result = run.kind === 'commit'
      ? await processPushBatch(supabase, tenantId, { message: run.message ?? undefined })
      : scope
        ? await runScopedSync(supabase, tenantId, scope, {
            message: run.message ?? undefined,
            onProgress: (progress) => updateRun({ progress }),
          })
        : await runFullResync(supabase, tenantId, {
            message: run.message ?? (run.kind === 'scheduled' ? 'usertasks: scheduled configuration sync' : undefined),
            onProgress: (progress) => updateRun({ progress }),
          })
    if (run.template_id) {
      await (supabase as any)
        .from('github_sync_templates')
        .update({ last_run_at: new Date().toISOString() })
        .eq('id', run.template_id)
    }
    await updateRun({
      status: 'completed',
      commit_sha: result.commitSha,
      files_changed: result.filesChanged,
      progress: { phase: 'done', files_done: result.filesChanged, files_total: result.filesChanged, message: 'Sync complete' },
      completed_at: new Date().toISOString(),
    })
    await writeAudit({
      supabase, tenantId, actorId: run.created_by ?? null,
      objectType: 'github_sync', objectId: run.id,
      action: 'export',
      summary: result.commitSha
        ? `Pushed ${result.filesChanged} files to GitHub (${
            run.kind === 'template' ? `template${(run.scope as SyncScope | null)?.template_name ? `: ${(run.scope as SyncScope).template_name}` : ''}`
            : run.kind === 'scheduled' ? 'scheduled sync'
            : run.kind === 'commit' ? 'commit'
            : 'full sync'})`
        : 'GitHub sync ran — nothing to commit',
      metadata: { kind: run.kind, commit_sha: result.commitSha, files_changed: result.filesChanged },
    })
  } catch (error: any) {
    await updateRun({
      status: 'failed',
      error: String(error?.message ?? error),
      completed_at: new Date().toISOString(),
    })
    await writeAudit({
      supabase, tenantId, actorId: run.created_by ?? null,
      objectType: 'github_sync', objectId: run.id,
      action: 'export',
      summary: `GitHub sync failed: ${String(error?.message ?? error).slice(0, 200)}`,
      metadata: { kind: run.kind, failed: true },
    })
  }
}

/** Claim-and-run loop for background sync runs. */
export async function processSyncRuns(supabase: SupabaseClient, workerId: string, maxRuns = 2): Promise<number> {
  let processed = 0
  for (let i = 0; i < maxRuns; i++) {
    const { data: claimed, error } = await (supabase as any).rpc('claim_next_github_sync_run', { p_worker_id: workerId })
    if (error) break // table/function not migrated yet — skip gracefully
    const run = Array.isArray(claimed) ? claimed[0] : claimed
    if (!run) break
    await executeSyncRun(supabase, run)
    processed++
  }
  return processed
}

/**
 * Scheduled syncs: connectors opt in via config.schedule, stored in the same
 * shape as workflow schedule triggers ({schedule_mode, minute_of_hour,
 * time_of_day, day_of_week, timezone}) so the occurrence math is shared.
 * Due connectors get a 'scheduled' run enqueued (deduped against any
 * already-pending run).
 */
export async function enqueueScheduledSyncs(supabase: SupabaseClient): Promise<number> {
  const { normalizeScheduleConfig, getDueOccurrence } = await import('@/lib/workflow-schedule')
  const { data: connectors } = await (supabase as any)
    .from('tenant_connectors')
    .select('id, tenant_id, config')
    .eq('connector_key', 'github_sync')
    .eq('is_enabled', true)

  let enqueued = 0
  for (const connector of (connectors ?? []) as any[]) {
    // One tenant's bad config must never abort the sweep for everyone else.
    try {
      const normalized = normalizeScheduleConfig((connector.config as any)?.schedule)
      if (!normalized) continue
      const lastFired: string | null = (connector.config as any)?.schedule_last_fired_at ?? null
      const due = getDueOccurrence(normalized, new Date(), lastFired)
      if (!due) continue

      const tenantId = String(connector.tenant_id)
      const { data: existing } = await (supabase as any)
        .from('github_sync_runs')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'running'])
        .limit(1)
      if ((existing ?? []).length > 0) continue

      // Compare-and-set the fired marker (atomic jsonb patch — a whole-config
      // rewrite here would clobber a concurrently updated last_push_sha).
      const { data: claimed, error: claimError } = await (supabase as any).rpc('claim_scheduled_sync', {
        p_tenant_id: tenantId,
        p_connector_key: 'github_sync',
        p_expected: lastFired,
        p_fired_at: due.toISOString(),
      })
      if (claimError || claimed !== true) continue

      const { error: insertError } = await (supabase as any).from('github_sync_runs').insert({
        tenant_id: tenantId,
        kind: 'scheduled',
        message: 'usertasks: scheduled configuration sync',
      })
      if (insertError) {
        // Don't consume the occurrence when the run was never enqueued.
        await (supabase as any).rpc('claim_scheduled_sync', {
          p_tenant_id: tenantId,
          p_connector_key: 'github_sync',
          p_expected: due.toISOString(),
          p_fired_at: lastFired,
        })
        continue
      }
      enqueued++
    } catch { /* next connector */ }
  }

  // Template schedules: each template can sync its selection on its own
  // schedule. CAS on the template row's fired marker (plain column, not
  // jsonb) keeps overlapping sweeps to one run per occurrence.
  const enabledTenants = new Set(
    ((connectors ?? []) as any[]).map((c) => String(c.tenant_id)),
  )
  const { data: templates, error: templatesError } = await (supabase as any)
    .from('github_sync_templates')
    .select('id, tenant_id, name, asset_types, assets, schedule, schedule_last_fired_at')
    .not('schedule', 'is', null)
  if (templatesError) return enqueued // table not migrated yet

  for (const template of (templates ?? []) as any[]) {
    try {
      const tenantId = String(template.tenant_id)
      if (!enabledTenants.has(tenantId)) continue
      const normalized = normalizeScheduleConfig(template.schedule)
      if (!normalized) continue
      const lastFired: string | null = template.schedule_last_fired_at ?? null
      const due = getDueOccurrence(normalized, new Date(), lastFired)
      if (!due) continue

      const { data: existing } = await (supabase as any)
        .from('github_sync_runs')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'running'])
        .limit(1)
      if ((existing ?? []).length > 0) continue

      const { data: claimed } = await (supabase as any)
        .from('github_sync_templates')
        .update({ schedule_last_fired_at: due.toISOString() })
        .eq('id', template.id)
        .filter('schedule_last_fired_at', lastFired ? 'eq' : 'is', lastFired)
        .select('id')
      if (!claimed || claimed.length === 0) continue

      const scope: SyncScope = {
        asset_types: Array.isArray(template.asset_types) ? template.asset_types : [],
        assets: Array.isArray(template.assets) ? template.assets : [],
        template_id: String(template.id),
        template_name: String(template.name ?? ''),
      }
      const { error: insertError } = await (supabase as any).from('github_sync_runs').insert({
        tenant_id: tenantId,
        kind: 'template',
        scope,
        template_id: template.id,
        message: `usertasks: scheduled template sync (${template.name})`,
      })
      if (insertError) {
        await (supabase as any)
          .from('github_sync_templates')
          .update({ schedule_last_fired_at: lastFired })
          .eq('id', template.id)
        continue
      }
      enqueued++
    } catch { /* next template */ }
  }
  return enqueued
}
