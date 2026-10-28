'use server'

import { getUserPermissions, requirePermission } from '@/lib/permissions-server'
import { writeAudit } from '@/lib/audit-log'
import { createGitHubClient, GitHubApiError } from '@/lib/github-sync/client'
import {
  disconnectGitHubSync,
  getGitHubSyncConnection,
  saveGitHubSyncConnection,
  type GitHubSyncMode,
} from '@/lib/github-sync/connection'
import { processPushBatch, runFullResync, runScopedSync, type SyncScope } from '@/lib/github-sync/push'
import { SYNC_SECTION_CATALOG } from '@/lib/github-sync/scope-catalog'
import { kickGitHubPusher } from '@/lib/github-sync/enqueue'
import { kickGitHubDeployWorker } from '@/lib/github-sync/deploy-kick'
import { normalizeScheduleConfig } from '@/lib/workflow-schedule'
import type { GitHubSyncSchedule } from '@/lib/github-sync/connection'
import { updateGitHubSyncState } from '@/lib/github-sync/connection'
import { DEFAULT_PATH_PREFIX } from '@/lib/github-sync/layout'
import { createServiceClient } from '@/lib/cron-auth'
import { requireTenant } from '@/lib/actions/require-tenant'

/** Guard that passes when the user holds ANY of the listed permissions. */
async function requireAnyPermission(permissions: string[]): Promise<void> {
  const perms = await getUserPermissions()
  if (!permissions.some((permission) => perms.has(permission))) {
    throw new Error('Forbidden')
  }
}

function friendlyGitHubError(error: unknown): Error {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) {
      return new Error('GitHub rejected the token. Check that the personal access token is valid and has repo/contents access.')
    }
    if (error.status === 403) {
      return new Error(
        'GitHub returned 403 — the token cannot WRITE to this repository. '
        + 'For fine-grained tokens: grant this repository with "Contents: Read and write". '
        + 'For classic tokens: the full "repo" scope. '
        + 'Organization repositories may also need the org to approve the token.',
      )
    }
    if (error.status === 404) {
      return new Error('GitHub returned 404 — the repository or branch was not found, or the token cannot see it.')
    }
    return new Error(error.message)
  }
  return error instanceof Error ? error : new Error(String(error))
}

// ── Status ───────────────────────────────────────────────────────────────────

export async function getGitHubSyncStatus() {
  await requireAnyPermission(['sync.view', 'settings.view'])
  const { supabase, tenantId } = await requireTenant()

  const connection = await getGitHubSyncConnection(supabase, tenantId)

  const [pendingResult, committedResult, deploymentsResult, runsResult] = await Promise.all([
    (supabase as any)
      .from('github_sync_queue')
      .select('id, asset_type, asset_id, asset_name, action, status, error, queued_at, updated_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('queued_at', { ascending: false })
      .limit(200),
    (supabase as any)
      .from('github_sync_queue')
      .select('id, asset_type, asset_id, asset_name, action, status, commit_sha, queued_at, updated_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'committed')
      .order('updated_at', { ascending: false })
      .limit(20),
    (supabase as any)
      .from('github_deployments')
      .select('id, source, dry_run, status, stats, error, created_at, started_at, completed_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(20),
    (supabase as any)
      .from('github_sync_runs')
      .select('id, kind, status, progress, commit_sha, files_changed, error, created_at, started_at, completed_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  return {
    connection, // token is never loaded here (includeToken defaults to false)
    pendingChanges: (pendingResult.data ?? []) as Array<{
      id: string
      asset_type: string
      asset_id: string
      asset_name: string | null
      action: 'save' | 'delete'
      status: string
      error: string | null
      queued_at: string
      updated_at: string
    }>,
    recentCommits: (committedResult.data ?? []) as Array<{
      id: string
      asset_type: string
      asset_id: string
      asset_name: string | null
      action: 'save' | 'delete'
      status: string
      commit_sha: string | null
      queued_at: string
      updated_at: string
    }>,
    deployments: (deploymentsResult.data ?? []) as Array<{
      id: string
      source: { owner?: string; repo?: string; ref?: string; commit_sha?: string; path_prefix?: string } | null
      dry_run: boolean
      status: 'pending' | 'running' | 'completed' | 'failed'
      stats: Record<string, any> | null
      error: string | null
      created_at: string
      started_at: string | null
      completed_at: string | null
    }>,
    // github_sync_runs may not be migrated yet — treat errors as "no runs"
    syncRuns: ((runsResult.error ? [] : runsResult.data) ?? []) as SyncRunRow[],
  }
}

export interface SyncRunRow {
  id: string
  kind: 'full_resync' | 'commit' | 'scheduled'
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: { phase: string; files_done: number; files_total: number; message: string } | null
  commit_sha: string | null
  files_changed: number | null
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

/** Recent commits on the synced branch, for the history section. */
export async function getGitHubCommits() {
  await requireAnyPermission(['sync.view', 'settings.view'])
  const { supabase, tenantId } = await requireTenant()

  const connection = await getGitHubSyncConnection(supabase, tenantId, { includeToken: true })
  if (!connection?.isEnabled || !connection.token) return []

  try {
    const client = createGitHubClient(connection.token)
    return await client.listCommits(connection.owner, connection.repo, connection.branch, 15)
  } catch (error) {
    // History is informational — an empty repo or revoked token shouldn't break the page.
    if (error instanceof GitHubApiError && (error.status === 404 || error.status === 409)) return []
    throw friendlyGitHubError(error)
  }
}

// ── Connect / configure ──────────────────────────────────────────────────────

export async function connectGitHubSync(input: {
  token: string
  owner: string
  repo: string
  branch: string
  mode: GitHubSyncMode
  pathPrefix?: string
}) {
  await requirePermission('settings.edit')
  const { supabase, user, tenantId } = await requireTenant()

  const token = input.token.trim()
  const owner = input.owner.trim()
  const repo = input.repo.trim()
  const branch = input.branch.trim() || 'main'
  if (!token) throw new Error('A GitHub personal access token is required')
  if (!owner || !repo) throw new Error('Choose a repository to sync to')

  let connectedLogin: string
  try {
    const client = createGitHubClient(token)
    const verified = await client.verifyToken()
    // Fail at connect time, not at first push: the token must be able to
    // WRITE to the chosen repository.
    try {
      const repoInfo = await client.getRepo(input.owner, input.repo)
      if (!repoInfo.permissions.push) {
        throw new GitHubApiError(403, 'Resource not accessible by personal access token')
      }
    } catch (error) {
      throw friendlyGitHubError(error)
    }
    connectedLogin = verified.login
  } catch (error) {
    throw friendlyGitHubError(error)
  }

  await saveGitHubSyncConnection({
    supabase,
    tenantId,
    owner,
    repo,
    branch,
    mode: input.mode === 'auto' ? 'auto' : 'queue',
    pathPrefix: String(input.pathPrefix ?? '').trim() || DEFAULT_PATH_PREFIX,
    token,
    connectedLogin,
  })

  const connection = await getGitHubSyncConnection(supabase, tenantId)
  await writeAudit({
    supabase, tenantId, actorId: user.id,
    objectType: 'integration', objectId: connection?.id ?? tenantId,
    action: 'create', summary: `Connected GitHub sync to ${owner}/${repo}`,
  })
  return connection
}

export async function listGitHubRepos(input?: { token?: string }) {
  await requirePermission('settings.edit')
  const { supabase, tenantId } = await requireTenant()

  let token = String(input?.token ?? '').trim()
  if (!token) {
    const connection = await getGitHubSyncConnection(supabase, tenantId, { includeToken: true })
    token = connection?.token ?? ''
  }
  if (!token) throw new Error('No GitHub token available — enter a personal access token first')

  try {
    const client = createGitHubClient(token)
    return await client.listRepos()
  } catch (error) {
    throw friendlyGitHubError(error)
  }
}

export async function listGitHubBranches(input: { owner: string; repo: string; token?: string }) {
  await requirePermission('settings.edit')
  const { supabase, tenantId } = await requireTenant()

  let token = String(input.token ?? '').trim()
  if (!token) {
    const connection = await getGitHubSyncConnection(supabase, tenantId, { includeToken: true })
    token = connection?.token ?? ''
  }
  if (!token) throw new Error('No GitHub token available')

  try {
    const client = createGitHubClient(token)
    return await client.listBranches(input.owner.trim(), input.repo.trim())
  } catch (error) {
    throw friendlyGitHubError(error)
  }
}

export async function setGitHubSyncMode(mode: GitHubSyncMode) {
  await requirePermission('settings.edit')
  const { supabase, tenantId } = await requireTenant()

  const connection = await getGitHubSyncConnection(supabase, tenantId)
  if (!connection) throw new Error('GitHub sync is not connected')

  await saveGitHubSyncConnection({
    supabase,
    tenantId,
    owner: connection.owner,
    repo: connection.repo,
    branch: connection.branch,
    mode: mode === 'auto' ? 'auto' : 'queue',
    pathPrefix: connection.pathPrefix,
    // token undefined → keep the stored credential
  })
}

export async function disconnectGitHub() {
  await requirePermission('settings.edit')
  const { supabase, user, tenantId } = await requireTenant()

  const connection = await getGitHubSyncConnection(supabase, tenantId)
  if (!connection) return

  await disconnectGitHubSync(supabase, tenantId)
  await writeAudit({
    supabase, tenantId, actorId: user.id,
    objectType: 'integration', objectId: connection.id,
    action: 'delete', summary: `Disconnected GitHub sync from ${connection.owner}/${connection.repo}`,
  })
}

// ── Push ─────────────────────────────────────────────────────────────────────

/**
 * Enqueue a background sync run (executed by the push worker) so the UI can
 * return immediately and poll progress. Falls back to running synchronously
 * when the github_sync_runs table hasn't been migrated yet.
 */
async function startSyncRun(
  kind: 'full_resync' | 'commit' | 'template',
  message?: string,
  extra?: { scope?: SyncScope; templateId?: string | null },
) {
  const { supabase, user, tenantId } = await requireTenant()

  const connection = await getGitHubSyncConnection(supabase, tenantId)
  if (!connection?.isEnabled) throw new Error('GitHub sync is not connected')

  // One in-flight run per tenant — a second full export would just race the
  // first. The partial unique index is the real guard; this check just gives
  // a friendlier answer without burning an insert.
  const { data: active } = await (supabase as any)
    .from('github_sync_runs')
    .select('id, status, started_at')
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'running'])
    .limit(1)
  const activeRun = (active ?? [])[0] as { id: string; status: string; started_at: string | null } | undefined
  // A 'running' row stuck past the worker's own recovery window is stale
  // (the claim RPC will requeue or fail it) — don't let it block the button.
  const staleMs = 6 * 60 * 1000
  const isStale = activeRun?.status === 'running'
    && activeRun.started_at != null
    && Date.now() - new Date(activeRun.started_at).getTime() > staleMs
  if (activeRun && !isStale) {
    return { runId: String(activeRun.id), alreadyRunning: true }
  }

  const { data, error } = await (supabase as any)
    .from('github_sync_runs')
    .insert({
      tenant_id: tenantId,
      kind,
      message: message?.trim() || null,
      created_by: user.id,
      ...(extra?.scope ? { scope: extra.scope } : {}),
      ...(extra?.templateId ? { template_id: extra.templateId } : {}),
    })
    .select('id')
    .single()

  if (error) {
    const code = String((error as any)?.code ?? '')
    // Unique-index conflict: someone else won the insert race — report theirs.
    if (code === '23505') {
      const { data: winner } = await (supabase as any)
        .from('github_sync_runs')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'running'])
        .limit(1)
      const winnerId = (winner ?? [])[0]?.id
      if (winnerId) return { runId: String(winnerId), alreadyRunning: true }
    }
    // Only a missing table/schema-cache (migration not applied yet) degrades
    // to the old blocking path — anything else (RLS, transient DB error) must
    // surface, not silently hang the request on a synchronous full resync.
    if (code !== '42P01' && code !== 'PGRST205' && code !== 'PGRST202') {
      throw new Error(`Could not start the sync: ${(error as any)?.message ?? 'unknown error'}`)
    }
    try {
      const result = kind === 'commit'
        ? await processPushBatch(supabase, tenantId, { message })
        : extra?.scope
          ? await runScopedSync(supabase, tenantId, extra.scope, { message })
          : await runFullResync(supabase, tenantId)
      return { commitSha: result.commitSha, filesChanged: result.filesChanged, synchronous: true }
    } catch (syncError) {
      throw friendlyGitHubError(syncError)
    }
  }

  kickGitHubPusher()
  return { runId: String((data as any).id) }
}

export async function commitPendingChanges(input?: { message?: string }) {
  await requirePermission('settings.edit')
  return startSyncRun('commit', input?.message)
}

export async function pushEverything() {
  await requirePermission('settings.edit')
  return startSyncRun('full_resync')
}

// ── Selection & templates ────────────────────────────────────────────────────

/** id+name of every selectable asset, keyed by manifest section. */
export async function listSyncableAssets() {
  await requireAnyPermission(['sync.view', 'settings.view'])
  const { supabase, tenantId } = await requireTenant()

  const results = await Promise.all(SYNC_SECTION_CATALOG.map(async (info) => {
    const nameColumn = info.nameColumn ?? 'name'
    // Only id + name, filtered to the caller's tenant.
    const client = info.serviceRole ? createServiceClient() : supabase
    let query = (client as any)
      .from(info.table)
      .select(`id, ${nameColumn}`)
      .eq('tenant_id', tenantId)
      .order(nameColumn)
      .limit(300)
    if (info.filter) {
      if (info.filter.op === 'eq') query = query.eq(info.filter.column, info.filter.value)
      else if (info.filter.op === 'in') query = query.in(info.filter.column, info.filter.value)
      else query = query.not(info.filter.column, 'in', `(${(info.filter.value as string[]).join(',')})`)
    }
    const { data } = await query
    return [info.section, ((data ?? []) as any[]).map((row) => ({ id: String(row.id), name: String(row[nameColumn] ?? row.id) }))] as const
  }))

  return Object.fromEntries(results) as Record<string, Array<{ id: string; name: string }>>
}

export interface GitHubSyncTemplateRow {
  id: string
  name: string
  description: string | null
  asset_types: string[]
  assets: Array<{ section: string; id: string; name?: string }>
  schedule: GitHubSyncSchedule | null
  last_run_at: string | null
  updated_at: string
}

export async function listGitHubSyncTemplates(): Promise<GitHubSyncTemplateRow[]> {
  await requireAnyPermission(['sync.view', 'settings.view'])
  const { supabase, tenantId } = await requireTenant()
  const { data, error } = await (supabase as any)
    .from('github_sync_templates')
    .select('id, name, description, asset_types, assets, schedule, last_run_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(100)
  if (error) return [] // table not migrated yet
  return (data ?? []).map((row: any) => ({
    ...row,
    asset_types: Array.isArray(row.asset_types) ? row.asset_types : [],
    assets: Array.isArray(row.assets) ? row.assets : [],
  })) as GitHubSyncTemplateRow[]
}

export async function saveGitHubSyncTemplate(input: {
  id?: string
  name: string
  description?: string | null
  assetTypes: string[]
  assets: Array<{ section: string; id: string; name?: string }>
  schedule: GitHubSyncSchedule | null
}) {
  await requirePermission('settings.edit')
  const { supabase, user, tenantId } = await requireTenant()

  const name = input.name.trim()
  if (!name) throw new Error('Template name is required')
  const validSections = new Set(SYNC_SECTION_CATALOG.map((s) => s.section))
  const assetTypes = (input.assetTypes ?? []).filter((s) => validSections.has(s))
  const assets = (input.assets ?? []).filter((a) => validSections.has(a?.section) && a?.id)
    .map((a) => ({ section: a.section, id: String(a.id), name: a.name ?? null }))
  if (assetTypes.length === 0 && assets.length === 0) {
    throw new Error('Select at least one asset type or item')
  }
  if (input.schedule !== null && !normalizeScheduleConfig(input.schedule)) {
    throw new Error('Invalid schedule — pick a frequency and time')
  }

  const row = {
    tenant_id: tenantId,
    name,
    description: String(input.description ?? '').trim() || null,
    asset_types: assetTypes,
    assets,
    schedule: input.schedule,
    // New/changed schedules start from now — never retro-fire old occurrences.
    schedule_last_fired_at: input.schedule ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }

  let templateId = input.id ?? null
  if (templateId) {
    const { error } = await (supabase as any)
      .from('github_sync_templates')
      .update(row)
      .eq('tenant_id', tenantId)
      .eq('id', templateId)
    if (error) throw new Error(error.message)
  } else {
    const { data, error } = await (supabase as any)
      .from('github_sync_templates')
      .insert({ ...row, created_by: user.id })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    templateId = String((data as any).id)
  }

  await writeAudit({
    supabase, tenantId, actorId: user.id,
    objectType: 'github_sync', objectId: templateId!,
    action: input.id ? 'update' : 'create',
    summary: `${input.id ? 'Updated' : 'Created'} GitHub sync template "${name}"`,
  })
  return { templateId }
}

export async function deleteGitHubSyncTemplate(templateId: string) {
  await requirePermission('settings.edit')
  const { supabase, user, tenantId } = await requireTenant()
  const { data: template } = await (supabase as any)
    .from('github_sync_templates')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('id', templateId)
    .maybeSingle()
  const { error } = await (supabase as any)
    .from('github_sync_templates')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', templateId)
  if (error) throw new Error(error.message)
  await writeAudit({
    supabase, tenantId, actorId: user.id,
    objectType: 'github_sync', objectId: templateId,
    action: 'delete', summary: `Deleted GitHub sync template "${(template as any)?.name ?? templateId}"`,
  })
}

export async function runGitHubSyncTemplate(templateId: string) {
  await requirePermission('settings.edit')
  const { supabase, tenantId } = await requireTenant()
  const { data: template, error } = await (supabase as any)
    .from('github_sync_templates')
    .select('id, name, asset_types, assets')
    .eq('tenant_id', tenantId)
    .eq('id', templateId)
    .single()
  if (error || !template) throw new Error('Template not found')
  const scope: SyncScope = {
    asset_types: Array.isArray((template as any).asset_types) ? (template as any).asset_types : [],
    assets: Array.isArray((template as any).assets) ? (template as any).assets : [],
    template_id: String((template as any).id),
    template_name: String((template as any).name ?? ''),
  }
  return startSyncRun('template', undefined, { scope, templateId: String((template as any).id) })
}

/** Ad-hoc "sync just these" without saving a template. */
export async function pushSelection(input: {
  assetTypes: string[]
  assets: Array<{ section: string; id: string; name?: string }>
  message?: string
}) {
  await requirePermission('settings.edit')
  const validSections = new Set(SYNC_SECTION_CATALOG.map((s) => s.section))
  const scope: SyncScope = {
    asset_types: (input.assetTypes ?? []).filter((s) => validSections.has(s)),
    assets: (input.assets ?? []).filter((a) => validSections.has(a?.section) && a?.id),
  }
  if ((scope.asset_types?.length ?? 0) === 0 && (scope.assets?.length ?? 0) === 0) {
    throw new Error('Select at least one asset type or item')
  }
  return startSyncRun('template', input.message, { scope })
}

// ── Schedule ─────────────────────────────────────────────────────────────────

export async function setGitHubSyncSchedule(schedule: GitHubSyncSchedule | null) {
  await requirePermission('settings.edit')
  const { supabase, user, tenantId } = await requireTenant()

  const connection = await getGitHubSyncConnection(supabase, tenantId)
  if (!connection) throw new Error('GitHub sync is not connected')

  if (schedule !== null && !normalizeScheduleConfig(schedule)) {
    throw new Error('Invalid schedule — pick a frequency and time')
  }

  await updateGitHubSyncState(supabase, tenantId, {
    schedule,
    // Reset the fired marker so the new schedule's next occurrence fires cleanly.
    schedule_last_fired_at: schedule ? new Date().toISOString() : null,
  })

  await writeAudit({
    supabase, tenantId, actorId: user.id,
    objectType: 'github_sync', objectId: connection.id,
    action: 'update',
    summary: schedule
      ? `Scheduled automatic GitHub sync (${schedule.schedule_mode})`
      : 'Disabled scheduled GitHub sync',
    metadata: { schedule },
  })
}

// ── Deploy ───────────────────────────────────────────────────────────────────

export async function deployFromGitHub(input?: { ref?: string; dryRun?: boolean }) {
  await requirePermission('settings.edit')
  const { supabase, user, tenantId } = await requireTenant()

  const connection = await getGitHubSyncConnection(supabase, tenantId, { includeToken: true })
  if (!connection?.isEnabled) throw new Error('GitHub sync is not connected')
  if (!connection.token) throw new Error('GitHub token is missing — reconnect the repository')

  const ref = String(input?.ref ?? '').trim() || connection.branch

  // Pin the exact commit the deployment will read from.
  let commitSha: string
  try {
    const client = createGitHubClient(connection.token)
    if (/^[0-9a-f]{40}$/i.test(ref)) {
      commitSha = ref
    } else {
      const resolved = await client.getRef(connection.owner, connection.repo, ref)
      commitSha = resolved.sha
    }
  } catch (error) {
    throw friendlyGitHubError(error)
  }

  const { data, error } = await (supabase as any)
    .from('github_deployments')
    .insert({
      tenant_id: tenantId,
      source: {
        owner: connection.owner,
        repo: connection.repo,
        ref,
        commit_sha: commitSha,
        path_prefix: connection.pathPrefix,
      },
      dry_run: Boolean(input?.dryRun),
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  kickGitHubDeployWorker()
  return { deploymentId: String((data as any).id) }
}
