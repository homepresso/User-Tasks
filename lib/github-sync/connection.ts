import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSensitiveFields, encryptSensitiveFields } from '@/lib/secret-fields'
import { DEFAULT_PATH_PREFIX } from '@/lib/github-sync/layout'

export const GITHUB_CONNECTOR_KEY = 'github_sync'

export type GitHubSyncMode = 'auto' | 'queue'

/** Same shape as workflow schedule triggers — lib/workflow-schedule normalizes it. */
export interface GitHubSyncSchedule {
  schedule_mode: 'hourly' | 'daily' | 'weekly'
  minute_of_hour?: number
  time_of_day?: string
  day_of_week?: number
  timezone?: string
}

export interface GitHubSyncConnection {
  id: string
  owner: string
  repo: string
  branch: string
  mode: GitHubSyncMode
  pathPrefix: string
  isEnabled: boolean
  /** Decrypted PAT — only present when loaded with includeToken. */
  token?: string
  connectedLogin?: string | null
  lastPushSha?: string | null
  lastPushAt?: string | null
  schedule?: GitHubSyncSchedule | null
  scheduleLastFiredAt?: string | null
}

function rowToConnection(row: any, includeToken: boolean): GitHubSyncConnection {
  const config = (row.config ?? {}) as Record<string, any>
  const connection: GitHubSyncConnection = {
    id: String(row.id),
    owner: String(config.owner ?? ''),
    repo: String(config.repo ?? ''),
    branch: String(config.branch ?? 'main'),
    mode: config.mode === 'auto' ? 'auto' : 'queue',
    pathPrefix: String(config.path_prefix ?? DEFAULT_PATH_PREFIX),
    isEnabled: Boolean(row.is_enabled),
    connectedLogin: config.connected_login ?? null,
    lastPushSha: config.last_push_sha ?? null,
    lastPushAt: config.last_push_at ?? null,
    schedule: (config.schedule as GitHubSyncSchedule | undefined) ?? null,
    scheduleLastFiredAt: config.schedule_last_fired_at ?? null,
  }
  if (includeToken) {
    const credentials = decryptSensitiveFields((row.credentials ?? {}) as Record<string, any>) as Record<string, any>
    connection.token = String(credentials.github_token ?? '')
  }
  return connection
}

export async function getGitHubSyncConnection(
  supabase: SupabaseClient,
  tenantId: string,
  opts?: { includeToken?: boolean },
): Promise<GitHubSyncConnection | null> {
  const { data } = await (supabase as any)
    .from('tenant_connectors')
    .select('id, config, credentials, is_enabled')
    .eq('tenant_id', tenantId)
    .eq('connector_key', GITHUB_CONNECTOR_KEY)
    .maybeSingle()
  if (!data) return null
  return rowToConnection(data, Boolean(opts?.includeToken))
}

export async function saveGitHubSyncConnection(params: {
  supabase: SupabaseClient
  tenantId: string
  owner: string
  repo: string
  branch: string
  mode: GitHubSyncMode
  pathPrefix?: string
  token?: string | null // undefined = keep existing
  connectedLogin?: string | null
}): Promise<void> {
  const { supabase, tenantId } = params
  const existing = await (supabase as any)
    .from('tenant_connectors')
    .select('id, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('connector_key', GITHUB_CONNECTOR_KEY)
    .maybeSingle()

  const config = {
    ...(existing.data?.config ?? {}),
    owner: params.owner,
    repo: params.repo,
    branch: params.branch,
    mode: params.mode,
    path_prefix: params.pathPrefix ?? DEFAULT_PATH_PREFIX,
    connected_login: params.connectedLogin ?? (existing.data?.config as any)?.connected_login ?? null,
  }

  const credentials = params.token !== undefined && params.token !== null && params.token !== ''
    ? encryptSensitiveFields({ github_token: params.token })
    : existing.data?.credentials ?? {}

  if (existing.data?.id) {
    const { error } = await (supabase as any)
      .from('tenant_connectors')
      .update({ config, credentials, is_enabled: true, updated_at: new Date().toISOString() })
      .eq('id', existing.data.id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await (supabase as any)
      .from('tenant_connectors')
      .insert({
        tenant_id: tenantId,
        connector_key: GITHUB_CONNECTOR_KEY,
        display_name: 'GitHub Sync',
        config,
        credentials,
        is_enabled: true,
      })
    if (error) throw new Error(error.message)
  }
}

export async function updateGitHubSyncState(
  supabase: SupabaseClient,
  tenantId: string,
  patch: { last_push_sha?: string; last_push_at?: string; schedule?: GitHubSyncSchedule | null; schedule_last_fired_at?: string | null },
): Promise<void> {
  // Atomic jsonb merge — a read-modify-write here races concurrent writers
  // (a finishing push vs. a schedule save) and silently drops their keys.
  const { error } = await (supabase as any).rpc('merge_tenant_connector_config', {
    p_tenant_id: tenantId,
    p_connector_key: GITHUB_CONNECTOR_KEY,
    p_patch: patch,
  })
  if (!error) return

  // RPC not migrated yet — degrade to the old read-modify-write.
  const existing = await (supabase as any)
    .from('tenant_connectors')
    .select('id, config')
    .eq('tenant_id', tenantId)
    .eq('connector_key', GITHUB_CONNECTOR_KEY)
    .maybeSingle()
  if (!existing.data?.id) return
  await (supabase as any)
    .from('tenant_connectors')
    .update({ config: { ...(existing.data.config ?? {}), ...patch } })
    .eq('id', existing.data.id)
}

export async function disconnectGitHubSync(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('tenant_connectors')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('connector_key', GITHUB_CONNECTOR_KEY)
  if (error) throw new Error(error.message)
}
