import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDirectoryConnection, resolveCredentialRefs, type EntraStoredCredentials } from '@/lib/directory-sync/connection'
import { createEntraClient, type EntraGroupMember } from '@/lib/directory-sync/entra'
import { escapeLikePattern } from '@/lib/utils'
import { MAX_AAD_GROUP_ASSIGNEES, type DirectoryCapabilities } from '@/lib/tasks/aad-group-assignment'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows read with an untyped (service-role) client */

/**
 * AAD (Entra ID) groups for workflow task assignment (server only).
 *
 *  - entraGroupCapabilities: is AAD group assignment available (an enabled
 *    Entra ID directory connection with credentials)?
 *  - searchEntraGroups: the designer's group picker — the groups directory
 *    sync already stored (directory_links, object_type 'group') when the
 *    connection syncs groups, else a live Microsoft Graph search.
 *  - resolveEntraGroupAssignees: at run time, the group's (transitive)
 *    members from Graph → local users via directory_links (provider entra),
 *    then email; only active members of the workspace are kept.
 *
 * Graph calls use the connection's app registration (client credentials):
 * GroupMember.Read.All (or Group.Read.All) + User.Read.All, application
 * permissions with admin consent. 429 / 503 honour Retry-After (entra.ts).
 * Member lists are cached for 5 minutes per workspace + group + nesting, picker
 * pages for 60 seconds.
 *
 * `db` must read tenant_connectors / directory_links / users /
 * user_memberships for the tenant: a service-role client with the explicit
 * tenant filters used here.
 */

export class EntraGroupsUnavailableError extends Error {
  constructor(message = 'Entra ID is not configured for this workspace') {
    super(message)
    this.name = 'EntraGroupsUnavailableError'
  }
}

const MEMBER_CACHE_MS = 5 * 60_000
const SEARCH_CACHE_MS = 60_000
const CLIENT_CACHE_MS = 10 * 60_000
const CACHE_MAX_ENTRIES = 500
/** Members read from Graph for one group (the assignee cap applies after mapping). */
const MAX_MEMBERS_FETCHED = 5_000
const CHUNK = 100

type Client = ReturnType<typeof createEntraClient>

interface Cached<T> { value: T; expiresAt: number }
const clientCache = new Map<string, Cached<Client>>()
const memberCache = new Map<string, Cached<EntraGroupMember[]>>()
const searchCache = new Map<string, Cached<EntraGroupSearchResult>>()

function getCached<T>(cache: Map<string, Cached<T>>, key: string): T | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() >= hit.expiresAt) { cache.delete(key); return null }
  return hit.value
}

function setCached<T>(cache: Map<string, Cached<T>>, key: string, value: T, ttlMs: number) {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/** Drop every cached client, member list and picker page (tests; a connection change). */
export function clearEntraGroupCaches(): void {
  clientCache.clear()
  memberCache.clear()
  searchCache.clear()
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function hasEntraCredentials(credentials: unknown): credentials is EntraStoredCredentials {
  const c = (credentials ?? {}) as Record<string, unknown>
  return ['tenant_id', 'client_id', 'client_secret'].every((key) => typeof c[key] === 'string' && String(c[key]).trim() !== '')
}

async function loadEntraConnection(db: SupabaseClient, tenantId: string) {
  try {
    return await getDirectoryConnection(db, tenantId, 'entra', { includeCredentials: true })
  } catch {
    // Undecryptable credentials (rotated key): treated as not configured.
    return null
  }
}

/** Is AAD group assignment available in this workspace? */
export async function entraGroupCapabilities(db: SupabaseClient, tenantId: string): Promise<DirectoryCapabilities> {
  if (!tenantId) return { entraGroups: false, syncedGroups: false }
  const connection = await loadEntraConnection(db, tenantId)
  const entraGroups = Boolean(connection && connection.isEnabled && hasEntraCredentials(connection.credentials))
  return { entraGroups, syncedGroups: entraGroups && Boolean(connection?.syncGroups) }
}

/** A Graph client on the workspace's connection (cached so its token is reused), or null when not configured. */
export async function entraGroupClient(db: SupabaseClient, tenantId: string): Promise<Client | null> {
  const connection = await loadEntraConnection(db, tenantId)
  if (!connection || !connection.isEnabled || !hasEntraCredentials(connection.credentials)) return null
  const credentials = await resolveCredentialRefs(tenantId, connection.credentials as unknown as Record<string, unknown>) as unknown as EntraStoredCredentials
  const key = `${tenantId}:${createHash('sha256').update(`${credentials.tenant_id}\n${credentials.client_id}\n${credentials.client_secret}`).digest('hex')}`
  const cached = getCached(clientCache, key)
  if (cached) return cached
  const client = createEntraClient({ tenantId: credentials.tenant_id, clientId: credentials.client_id, clientSecret: credentials.client_secret })
  setCached(clientCache, key, client, CLIENT_CACHE_MS)
  return client
}

export interface EntraGroupOption {
  /** The Entra group's object id (store as aad_group_id). */
  id: string
  name: string
  description: string | null
  /** The team directory sync keeps for this group, when it syncs groups. */
  team_id: string | null
}

export interface EntraGroupSearchResult {
  groups: EntraGroupOption[]
  /** Pass back as `cursor` for the next page; null at the end. */
  next_cursor: string | null
  source: 'synced' | 'graph'
}

const SYNCED_CURSOR = /^synced:(\d{1,6})$/

/**
 * Search the workspace's Entra groups for the picker. Synced groups first
 * (when the connection syncs groups and has stored some), else live Graph.
 */
export async function searchEntraGroups(
  db: SupabaseClient,
  tenantId: string,
  input: { search?: string | null; limit?: number | null; cursor?: string | null } = {},
): Promise<EntraGroupSearchResult> {
  const capabilities = await entraGroupCapabilities(db, tenantId)
  if (!capabilities.entraGroups) throw new EntraGroupsUnavailableError()
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit) || 25), 1), 50)
  const search = String(input.search ?? '').trim().slice(0, 100)
  const cursor = input.cursor ? String(input.cursor) : null

  const syncedCursor = cursor ? SYNCED_CURSOR.exec(cursor) : null
  if (capabilities.syncedGroups && (!cursor || syncedCursor)) {
    const offset = syncedCursor ? Number(syncedCursor[1]) : 0
    let query = (db as any).from('directory_links')
      .select('external_id, local_id, display_name')
      .eq('tenant_id', tenantId).eq('provider', 'entra').eq('object_type', 'group')
    if (search) query = query.ilike('display_name', `%${escapeLikePattern(search)}%`)
    const { data, error } = await query.order('display_name', { ascending: true }).order('external_id').range(offset, offset + limit)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as any[]
    // Nothing stored on a first page (groups not synced yet, or a group newer
    // than the last sync): fall through to a live Graph search.
    if (rows.length || offset > 0) {
      return {
        groups: rows.slice(0, limit).map((row) => ({ id: String(row.external_id), name: String(row.display_name ?? row.external_id), description: null, team_id: row.local_id ? String(row.local_id) : null })),
        next_cursor: rows.length > limit ? `synced:${offset + limit}` : null,
        source: 'synced',
      }
    }
  }

  const cacheKey = `${tenantId}\n${search.toLowerCase()}\n${limit}\n${cursor ?? ''}`
  const cached = getCached(searchCache, cacheKey)
  if (cached) return cached
  const client = await entraGroupClient(db, tenantId)
  if (!client) throw new EntraGroupsUnavailableError()
  const page = await client.searchGroups({ search, limit, next: cursor && !syncedCursor ? cursor : null })
  const teamIds = await syncedTeamIds(db, tenantId, page.groups.map((g) => g.externalId))
  const result: EntraGroupSearchResult = {
    groups: page.groups.map((g) => ({ id: g.externalId, name: g.displayName, description: g.description, team_id: teamIds.get(g.externalId) ?? null })),
    next_cursor: page.next,
    source: 'graph',
  }
  setCached(searchCache, cacheKey, result, SEARCH_CACHE_MS)
  return result
}

/** Entra group id → the team directory sync keeps for it. */
export async function syncedTeamIds(db: SupabaseClient, tenantId: string, groupIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const ids of chunk([...new Set(groupIds.filter(Boolean))], CHUNK)) {
    const { data } = await (db as any).from('directory_links').select('external_id, local_id')
      .eq('tenant_id', tenantId).eq('provider', 'entra').eq('object_type', 'group').in('external_id', ids)
    for (const row of (data ?? []) as any[]) if (row?.local_id) out.set(String(row.external_id), String(row.local_id))
  }
  return out
}

export interface EntraGroupAssignees {
  /** Local users, active members of the workspace, in Graph order (at most MAX_AAD_GROUP_ASSIGNEES). */
  userIds: string[]
  /** User members Graph returned. */
  memberCount: number
  /** Members with no UserTasks account (no directory link, no matching email). */
  skippedNoAccount: number
  /** Members with an account that is not an active member of this workspace. */
  skippedNotMember: number
  /** Members dropped by the assignee cap. */
  skippedOverLimit: number
  /** The member list came from the 5-minute cache. */
  cached: boolean
}

/**
 * The local assignees of an Entra group: Graph members (transitive unless
 * includeNested is false) mapped through directory_links (provider entra,
 * object_type user), then by email; people without an active membership in
 * the workspace are skipped. Throws EntraGroupsUnavailableError when the
 * connection is missing; Graph errors (DirectoryApiError) propagate.
 */
export async function resolveEntraGroupAssignees(
  db: SupabaseClient,
  tenantId: string,
  groupId: string,
  opts: { includeNested?: boolean; max?: number } = {},
): Promise<EntraGroupAssignees> {
  const includeNested = opts.includeNested !== false
  const cacheKey = `${tenantId}\n${groupId}\n${includeNested ? 'nested' : 'direct'}`
  let members = getCached(memberCache, cacheKey)
  const cached = Boolean(members)
  if (!members) {
    const client = await entraGroupClient(db, tenantId)
    if (!client) throw new EntraGroupsUnavailableError()
    members = await client.listGroupUserMembers(groupId, { transitive: includeNested, max: MAX_MEMBERS_FETCHED })
    setCached(memberCache, cacheKey, members, MEMBER_CACHE_MS)
  }

  // 1. directory_links: the sync's external id → local user.
  const byExternal = new Map<string, string>()
  for (const ids of chunk(members.map((m) => m.externalId), CHUNK)) {
    const { data } = await (db as any).from('directory_links').select('external_id, local_id')
      .eq('tenant_id', tenantId).eq('provider', 'entra').eq('object_type', 'user').in('external_id', ids)
    for (const row of (data ?? []) as any[]) if (row?.local_id) byExternal.set(String(row.external_id), String(row.local_id))
  }

  // 2. Email fallback (case-insensitive) for members the sync has not linked.
  const unlinkedEmails = [...new Set(members.filter((m) => !byExternal.has(m.externalId) && m.email).map((m) => String(m.email)))]
  const byEmail = new Map<string, string>()
  for (const emails of chunk(unlinkedEmails, CHUNK)) {
    const { data } = await (db as any).from('users').select('id, email').ilikeAnyOf('email', emails.map((e) => escapeLikePattern(e)))
    for (const row of (data ?? []) as any[]) if (row?.email) byEmail.set(String(row.email).toLowerCase(), String(row.id))
  }

  const candidates: string[] = []
  let skippedNoAccount = 0
  for (const member of members) {
    const local = byExternal.get(member.externalId) ?? (member.email ? byEmail.get(member.email) : undefined)
    if (!local) { skippedNoAccount++; continue }
    if (!candidates.includes(local)) candidates.push(local)
  }

  // 3. Only active members of this workspace.
  const active = new Set<string>()
  for (const ids of chunk(candidates, CHUNK)) {
    const { data } = await (db as any).from('user_memberships').select('user_id, is_active').eq('tenant_id', tenantId).in('user_id', ids)
    for (const row of (data ?? []) as any[]) if (row?.is_active !== false) active.add(String(row.user_id))
  }
  const inWorkspace = candidates.filter((id) => active.has(id))
  const max = Math.max(1, opts.max ?? MAX_AAD_GROUP_ASSIGNEES)
  return {
    userIds: inWorkspace.slice(0, max),
    memberCount: members.length,
    skippedNoAccount,
    skippedNotMember: candidates.length - inWorkspace.length,
    skippedOverLimit: Math.max(0, inWorkspace.length - max),
    cached,
  }
}
