import { syncDirectoryManagers } from './managers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { invalidateCredentialCache } from '@/lib/api-auth-cache'
import { writeAudit } from '@/lib/audit-log'
import { createEntraClient } from '@/lib/directory-sync/entra'
import { createGoogleDirectoryClient } from '@/lib/directory-sync/google'
import { createLdapClient } from '@/lib/directory-sync/ldap'
import { createOktaClient } from '@/lib/directory-sync/okta'
import {
  DIRECTORY_CONNECTOR_KEYS,
  DIRECTORY_PROVIDER_LABELS,
  getDirectoryConnection,
  providerForConnectorKey,
  resolveCredentialRefs,
  updateDirectorySyncState,
  type DirectoryConnection,
  type EntraStoredCredentials,
  type GoogleStoredCredentials,
  type LdapStoredCredentials,
  type OktaStoredCredentials,
} from '@/lib/directory-sync/connection'
import {
  isDirectoryProvider,
  type DirectoryClient,
  type DirectoryGroup,
  type DirectoryLinkProvider,
  type DirectoryProvider,
  type DirectoryUser,
} from '@/lib/directory-sync/types'
import { activeAuthProviderId, resolveAuthProvider } from '@/lib/providers/auth'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role rows are untyped */

/**
 * Directory sync engine: pulls users/groups from Entra ID, Okta, LDAP /
 * Active Directory or Google Workspace and reconciles them into local
 * `users` / `user_memberships` / `teams` / `user_teams`, tracked via
 * `directory_links` so repeated syncs update instead of duplicating. Mirrors
 * lib/github-sync/push.ts run execution.
 *
 * Full vs delta: a client with delta support (LDAP) records a cursor after
 * each full sync; later runs fetch only users changed since it, and a full
 * sync runs at least daily (and whenever the connection settings change) —
 * only a full sync can notice users that disappeared from the directory,
 * which, with deprovision_missing (LDAP, Google; on by default), lose access
 * like disabled ones. The reconciliation helpers below are shared with the
 * SCIM endpoint (lib/scim), so pushed and pulled users get the same
 * linking, provisioning and deprovisioning.
 *
 * IMPORTANT: `supabase` must be a SERVICE-ROLE client — auto-provisioning
 * calls supabase.auth.admin.createUser and writes cross the tenant boundary.
 */

export interface DirectorySyncStats {
  users_seen: number
  users_created: number
  users_linked: number
  users_deactivated: number
  groups_created: number
  groups_updated: number
  memberships_added: number
  memberships_removed: number
}

export interface DirectorySyncProgress {
  phase: 'fetching' | 'users' | 'groups' | 'done'
  message: string
  users_done?: number
  users_total?: number
  groups_done?: number
  groups_total?: number
}

interface LinkRow {
  id: string
  object_type: 'user' | 'group'
  external_id: string
  local_id: string
  display_name: string | null
}

const CHUNK = 100
const GROUP_FETCH_CONCURRENCY = 5
const USER_SYNC_CONCURRENCY = 10

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Escape LIKE wildcards so an email can be used as an exact ilike pattern. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

/** Full syncs at least this often for delta-capable directories (and on demand). */
export const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000

async function buildClient(provider: DirectoryProvider, connection: DirectoryConnection, tenantId: string): Promise<DirectoryClient> {
  const credentials = connection.credentials
  if (!credentials) throw new Error('Directory credentials are missing — reconnect the directory')
  if (provider === 'entra') {
    const c = await resolveCredentialRefs(tenantId, credentials as unknown as EntraStoredCredentials & Record<string, unknown>)
    if (!c.tenant_id || !c.client_id || !c.client_secret) {
      throw new Error('Entra ID credentials are incomplete — reconnect the directory')
    }
    return createEntraClient({ tenantId: c.tenant_id, clientId: c.client_id, clientSecret: c.client_secret })
  }
  if (provider === 'ldap') {
    const c = await resolveCredentialRefs(tenantId, credentials as unknown as LdapStoredCredentials & Record<string, unknown>)
    if (!c.bind_password) throw new Error('LDAP bind password is missing — reconnect the directory')
    return createLdapClient({ settings: connection.settings, bindPassword: c.bind_password })
  }
  if (provider === 'google') {
    const c = await resolveCredentialRefs(tenantId, credentials as unknown as GoogleStoredCredentials & Record<string, unknown>)
    if (!c.service_account_json) throw new Error('Google service account key is missing — reconnect the directory')
    return createGoogleDirectoryClient({ settings: connection.settings, serviceAccountJson: c.service_account_json })
  }
  const c = await resolveCredentialRefs(tenantId, credentials as unknown as OktaStoredCredentials & Record<string, unknown>)
  if (!c.org_url || !c.api_token) throw new Error('Okta credentials are incomplete — reconnect the directory')
  return createOktaClient({ orgUrl: c.org_url, apiToken: c.api_token })
}

/** The directory client for a stored connection (credentials loaded and secret:// refs resolved). */
export async function directoryClientFor(supabase: SupabaseClient, tenantId: string, provider: DirectoryProvider): Promise<DirectoryClient> {
  const connection = await getDirectoryConnection(supabase, tenantId, provider, { includeCredentials: true })
  if (!connection?.isEnabled) throw new Error(`${DIRECTORY_PROVIDER_LABELS[provider]} directory sync is not connected`)
  return buildClient(provider, connection, tenantId)
}

/** Whether a full sync deactivates linked users the directory no longer returns. */
function deprovisionsMissing(provider: DirectoryProvider, connection: DirectoryConnection): boolean {
  if (provider !== 'ldap' && provider !== 'google') return false
  return connection.settings.deprovision_missing !== false
}

/**
 * Auth account for a directory user (no password: they sign in through SSO).
 * Supabase Auth: the admin API on the sync's service client, as before; other
 * auth providers: their admin API (built-in credentials + onUserCreated).
 */
async function createDirectoryAuthUser(supabase: SupabaseClient, email: string, metadata: Record<string, unknown>): Promise<string | null> {
  const authId = await activeAuthProviderId()
  if (authId !== 'supabase') {
    try {
      return (await resolveAuthProvider(authId).admin.createUser({ email, emailConfirmed: true, metadata })).id
    } catch (error) {
      console.warn(`[directory-sync] auth user creation failed for ${email}:`, (error as Error).message)
      return null
    }
  }
  const { data: created, error: createErr } = await (supabase as any).auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: metadata,
  })
  if (createErr || !created?.user) {
    console.warn(`[directory-sync] auth user creation failed for ${email}:`, createErr?.message)
    return null
  }
  return String(created.user.id)
}

/**
 * Resolve the role a provisioned directory user gets: the tenant's system
 * 'member' role, falling back to 'viewer', then any non-owner system role.
 * (roles shape verified in app/actions/beta-signup.ts:175-196.)
 */
export async function resolveProvisionRoleId(supabase: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data: roles } = await (supabase as any)
    .from('roles')
    .select('id, slug')
    .eq('tenant_id', tenantId)
    .eq('is_system', true)
  const list = (roles ?? []) as Array<{ id: string; slug: string }>
  const pick = list.find((r) => r.slug === 'member')
    ?? list.find((r) => r.slug === 'viewer')
    ?? list.find((r) => r.slug !== 'owner')
  return pick?.id ?? null
}


// ── Reconciliation helpers (shared with SCIM) ────────────────────────────────

/**
 * Active membership in the tenant. Upsert so a previously deactivated
 * membership is re-activated when the directory user comes back; falls back
 * to a tolerant insert when the composite onConflict isn't supported.
 */
export async function ensureDirectoryMembership(supabase: SupabaseClient, tenantId: string, userId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('user_memberships')
    .upsert({ user_id: userId, tenant_id: tenantId, is_active: true }, { onConflict: 'user_id,tenant_id' })
  if (error) {
    await (supabase as any)
      .from('user_memberships')
      .insert({ user_id: userId, tenant_id: tenantId, is_active: true })
      .then(() => {}, () => {})
  }
}

/** Membership plus the provisioning role when the user holds no role in the tenant yet. */
export async function grantDirectoryAccess(supabase: SupabaseClient, tenantId: string, userId: string, roleId: string | null): Promise<void> {
  await ensureDirectoryMembership(supabase, tenantId, userId)
  if (!roleId) return
  const { data } = await (supabase as any).from('user_roles').select('user_id').eq('tenant_id', tenantId).eq('user_id', userId).limit(1)
  if ((data ?? []).length > 0) return
  await (supabase as any).from('user_roles').insert({ tenant_id: tenantId, user_id: userId, role_id: roleId }).then(() => {}, () => {})
}

/**
 * Directory deprovisioning: deactivate the users' membership in this tenant
 * AND delete their user_roles rows here (permissions flow from user_roles —
 * membership alone is decorative). Never deletes or modifies the users row.
 * Returns how many memberships actually flipped.
 */
export async function revokeDirectoryAccess(supabase: SupabaseClient, tenantId: string, userIds: string[]): Promise<number> {
  let deactivated = 0
  for (const ids of chunk([...new Set(userIds)], CHUNK)) {
    const { data: activeRows } = await (supabase as any)
      .from('user_memberships')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('user_id', ids)
    const stillActive = ((activeRows ?? []) as any[]).map((r) => String(r.user_id))
    if (stillActive.length > 0) {
      const { error } = await (supabase as any)
        .from('user_memberships')
        .update({ is_active: false })
        .eq('tenant_id', tenantId)
        .in('user_id', stillActive)
      if (!error) deactivated += stillActive.length
    }
    // Idempotent — repeated runs delete nothing once the roles are gone.
    await (supabase as any)
      .from('user_roles')
      .delete()
      .eq('tenant_id', tenantId)
      .in('user_id', ids)
      .then(() => {}, () => {})
  }
  // Deactivated users' API keys / OAuth tokens must stop working at once.
  if (userIds.length > 0) await invalidateCredentialCache()
  return deactivated
}

/** The local user with this email (case-insensitive), if any. */
export async function findLocalUserByEmail(supabase: SupabaseClient, email: string): Promise<{ id: string; display_name: string | null } | null> {
  const { data } = await (supabase as any)
    .from('users')
    .select('id, email, display_name')
    .ilike('email', escapeLikePattern(email))
    .limit(1)
  const row = ((data ?? []) as any[])[0]
  return row ? { id: String(row.id), display_name: row.display_name ?? null } : null
}

/**
 * Create the account for a directory user (no password: they sign in through
 * SSO or LDAP) as a member of this tenant only, with the provisioning role.
 */
export async function provisionDirectoryUser(
  supabase: SupabaseClient,
  tenantId: string,
  provider: DirectoryLinkProvider,
  user: { email: string; displayName: string },
  roleId: string | null,
): Promise<string | null> {
  const email = user.email
  const userId = await createDirectoryAuthUser(supabase, email, { display_name: user.displayName, directory_provider: provider })
  if (!userId) return null

  // An auth-level trigger may have inserted a `users` row pointing at the
  // platform's default tenant (see app/actions/beta-signup.ts:198-208) —
  // repoint tenant columns only when they don't already point at this tenant.
  const { data: existingRow } = await (supabase as any)
    .from('users')
    .select('id, tenant_id, current_tenant_id')
    .eq('id', userId)
    .maybeSingle()
  const payload: Record<string, any> = {
    id: userId,
    email,
    display_name: user.displayName,
    role: 'member',
  }
  if (!existingRow || existingRow.tenant_id !== tenantId) payload.tenant_id = tenantId
  if (!existingRow || existingRow.current_tenant_id !== tenantId) payload.current_tenant_id = tenantId
  const { error: userErr } = await (supabase as any).from('users').upsert(payload, { onConflict: 'id' })
  if (userErr) {
    console.warn(`[directory-sync] users upsert failed for ${email}:`, userErr.message)
    return null
  }

  if (roleId) {
    await (supabase as any)
      .from('user_roles')
      .insert({ tenant_id: tenantId, user_id: userId, role_id: roleId })
      .then(() => {}, () => {})
  }
  await ensureDirectoryMembership(supabase, tenantId, userId)

  // The auth-level trigger also grants membership/roles in the platform's
  // DEFAULT tenant (see app/actions/beta-signup.ts:229-230) — strip every
  // grant outside the syncing tenant so directory-provisioned users can't
  // switch into it. Only safe here: this auth user was FRESHLY created.
  await (supabase as any).from('user_memberships').delete().eq('user_id', userId).neq('tenant_id', tenantId).then(() => {}, () => {})
  await (supabase as any).from('user_roles').delete().eq('user_id', userId).neq('tenant_id', tenantId).then(() => {}, () => {})

  return userId
}

export async function runDirectorySync(
  supabase: SupabaseClient,
  tenantId: string,
  provider: DirectoryProvider,
  opts?: {
    onProgress?: (progress: DirectorySyncProgress) => Promise<void> | void
    actorId?: string | null
    /** 'full' forces a full sync; default: delta when the client supports it and a recent full sync exists. */
    mode?: 'full' | 'auto'
    onMode?: (mode: 'full' | 'delta') => Promise<void> | void
  },
): Promise<DirectorySyncStats> {
  const label = DIRECTORY_PROVIDER_LABELS[provider]
  const report = async (progress: DirectorySyncProgress) => {
    try { await opts?.onProgress?.(progress) } catch { /* progress is best-effort */ }
  }
  const stats: DirectorySyncStats = {
    users_seen: 0,
    users_created: 0,
    users_linked: 0,
    users_deactivated: 0,
    groups_created: 0,
    groups_updated: 0,
    memberships_added: 0,
    memberships_removed: 0,
  }

  // ── Phase 1: fetching ──────────────────────────────────────────────────────
  await report({ phase: 'fetching', message: `Connecting to ${label}…` })
  const connection = await getDirectoryConnection(supabase, tenantId, provider, { includeCredentials: true })
  if (!connection?.isEnabled) throw new Error(`${label} directory sync is not connected`)
  const client = await buildClient(provider, connection, tenantId)
  try {
    return await syncWithClient(client, connection)
  } finally {
    await client.close?.().catch(() => undefined)
  }

  async function syncWithClient(client: DirectoryClient, connection: DirectoryConnection): Promise<DirectorySyncStats> {
  const fullDue = !connection.lastFullSyncAt || Date.now() - new Date(connection.lastFullSyncAt).getTime() >= FULL_SYNC_INTERVAL_MS
  const delta = Boolean(client.listUserChanges && connection.deltaCursor && opts?.mode !== 'full' && !fullDue)
  await opts?.onMode?.(delta ? 'delta' : 'full')

  let nextCursor: string | null = null
  let directoryUsers: DirectoryUser[]
  if (delta) {
    const changes = await client.listUserChanges!(connection.deltaCursor!)
    directoryUsers = changes.users
    nextCursor = changes.cursor
    await report({ phase: 'fetching', message: `Fetched ${directoryUsers.length} changed directory users…` })
  } else {
    // Taken before the listing, so changes made during it are seen next time.
    nextCursor = client.deltaCursor ? await client.deltaCursor().catch(() => null) : null
    directoryUsers = await client.listUsers()
    await report({ phase: 'fetching', message: `Fetched ${directoryUsers.length} directory users…` })
  }
  stats.users_seen = directoryUsers.length

  let directoryGroups: DirectoryGroup[] = []
  const groupMemberIds = new Map<string, string[]>()
  if (connection.syncGroups) {
    directoryGroups = await client.listGroups()
    // Fetch member lists a few groups at a time — sequential batches with a
    // small concurrency cap so big directories don't hammer the API.
    for (const batch of chunk(directoryGroups, GROUP_FETCH_CONCURRENCY)) {
      await Promise.all(batch.map(async (group) => {
        groupMemberIds.set(group.externalId, await client.listGroupMemberIds(group.externalId))
      }))
      await report({
        phase: 'fetching',
        message: `Fetched members for ${groupMemberIds.size} of ${directoryGroups.length} groups…`,
      })
    }
  }

  // Existing links for this tenant+provider — the sync's memory.
  const { data: linkRows } = await (supabase as any)
    .from('directory_links')
    .select('id, object_type, external_id, local_id, display_name')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
  const userLinks = new Map<string, LinkRow>()
  const groupLinks = new Map<string, LinkRow>()
  for (const row of (linkRows ?? []) as LinkRow[]) {
    ;(row.object_type === 'group' ? groupLinks : userLinks).set(row.external_id, row)
  }

  // ── Phase 2: users ─────────────────────────────────────────────────────────
  const activeUsers = directoryUsers.filter((u) => u.active && u.email)
  await report({ phase: 'users', message: `Syncing ${activeUsers.length} users…`, users_done: 0, users_total: activeUsers.length })

  // Local rows for already-linked users (display-name drift detection).
  const linkedLocalIds = [...userLinks.values()].map((l) => l.local_id)
  const localUsersById = new Map<string, { id: string; display_name: string | null; email: string | null }>()
  for (const ids of chunk(linkedLocalIds, CHUNK)) {
    const { data } = await (supabase as any).from('users').select('id, display_name, email').in('id', ids)
    for (const row of (data ?? []) as any[]) localUsersById.set(String(row.id), row)
  }

  // Email → local user for the not-yet-linked directory users (case-insensitive).
  const unlinkedEmails = activeUsers
    .filter((u) => !userLinks.has(u.externalId))
    .map((u) => String(u.email))
  const localUsersByEmail = new Map<string, { id: string; display_name: string | null }>()
  for (const emails of chunk([...new Set(unlinkedEmails)], CHUNK)) {
    const { data } = await (supabase as any)
      .from('users')
      .select('id, email, display_name')
      .ilikeAnyOf('email', emails.map((e) => escapeLikePattern(e)))
    for (const row of (data ?? []) as any[]) {
      if (row?.email) localUsersByEmail.set(String(row.email).toLowerCase(), { id: String(row.id), display_name: row.display_name ?? null })
    }
  }

  // Resolved regardless of auto_provision: email-linked and re-activated
  // users need a role row too (permissions flow from user_roles).
  const provisionRoleId = await resolveProvisionRoleId(supabase, tenantId)
  const nowIso = new Date().toISOString()
  const seenLinkIds: string[] = []
  const seenExternalIds = new Set<string>()

  const ensureMembership = (userId: string) => ensureDirectoryMembership(supabase, tenantId, userId)

  // Which linked/matched local users already hold a role in this tenant —
  // access comes from user_roles, so membership without a role is useless.
  const usersWithRole = new Set<string>()
  const roleCheckIds = [...new Set([...linkedLocalIds, ...[...localUsersByEmail.values()].map((u) => u.id)])]
  for (const ids of chunk(roleCheckIds, CHUNK)) {
    const { data } = await (supabase as any)
      .from('user_roles')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .in('user_id', ids)
    for (const row of (data ?? []) as any[]) usersWithRole.add(String(row.user_id))
  }

  const ensureRole = async (userId: string) => {
    if (!provisionRoleId || usersWithRole.has(userId)) return
    usersWithRole.add(userId)
    await (supabase as any)
      .from('user_roles')
      .insert({ tenant_id: tenantId, user_id: userId, role_id: provisionRoleId })
      .then(() => {}, () => {})
  }

  const recordLink = async (objectType: 'user' | 'group', externalId: string, localId: string, displayName: string | null) => {
    const { data } = await (supabase as any)
      .from('directory_links')
      .upsert({
        tenant_id: tenantId,
        provider,
        object_type: objectType,
        external_id: externalId,
        local_id: localId,
        display_name: displayName,
        last_seen_at: nowIso,
      }, { onConflict: 'tenant_id,provider,object_type,external_id' })
      .select('id, object_type, external_id, local_id, display_name')
      .maybeSingle()
    const row = (data ?? {
      id: '', object_type: objectType, external_id: externalId, local_id: localId, display_name: displayName,
    }) as LinkRow
    ;(objectType === 'group' ? groupLinks : userLinks).set(externalId, row)
    return row
  }

  const provisionUser = async (user: DirectoryUser): Promise<string | null> => {
    const userId = await provisionDirectoryUser(supabase, tenantId, provider, { email: String(user.email), displayName: user.displayName }, provisionRoleId)
    if (userId && provisionRoleId) usersWithRole.add(userId)
    return userId
  }

  const processUser = async (user: DirectoryUser) => {
    const link = userLinks.get(user.externalId)
    if (link) {
      // Already linked: refresh display name when drifted, stamp last_seen_at.
      const local = localUsersById.get(link.local_id)
      if (local && user.displayName && local.display_name !== user.displayName) {
        await (supabase as any).from('users').update({ display_name: user.displayName }).eq('id', link.local_id)
      }
      if (link.display_name !== user.displayName) {
        await (supabase as any).from('directory_links').update({ display_name: user.displayName, last_seen_at: nowIso }).eq('id', link.id)
      } else if (link.id) {
        seenLinkIds.push(link.id)
      }
      // Re-enabled directory users must get access back: membership upsert
      // re-activates a deactivated row, and a missing role row is re-granted.
      await ensureMembership(link.local_id)
      await ensureRole(link.local_id)
    } else {
      const existing = localUsersByEmail.get(String(user.email).toLowerCase())
      if (existing) {
        // Local account already exists — link it, make it a member here, and
        // grant a role (membership without user_roles carries no permissions).
        await ensureMembership(existing.id)
        await ensureRole(existing.id)
        await recordLink('user', user.externalId, existing.id, user.displayName)
        stats.users_linked++
      } else if (connection.autoProvision) {
        const userId = await provisionUser(user)
        if (userId) {
          await recordLink('user', user.externalId, userId, user.displayName)
          stats.users_created++
        }
      }
    }
  }

  // Dedupe directory duplicates, then process in concurrent batches so a big
  // first sync (hundreds of provisions) stays inside the worker's 60s budget.
  const uniqueActiveUsers: DirectoryUser[] = []
  for (const user of activeUsers) {
    if (seenExternalIds.has(user.externalId)) continue
    seenExternalIds.add(user.externalId)
    uniqueActiveUsers.push(user)
  }
  let usersDone = 0
  for (const batch of chunk(uniqueActiveUsers, USER_SYNC_CONCURRENCY)) {
    await Promise.all(batch.map((user) =>
      processUser(user).catch((error) => {
        console.warn(`[directory-sync] user sync failed for ${user.email}:`, error?.message ?? error)
      }),
    ))
    usersDone += batch.length
    await report({ phase: 'users', message: `Synced ${usersDone} of ${uniqueActiveUsers.length} users…`, users_done: usersDone, users_total: uniqueActiveUsers.length })
  }

  // Bulk last_seen_at stamp for unchanged links.
  for (const ids of chunk(seenLinkIds, CHUNK)) {
    await (supabase as any).from('directory_links').update({ last_seen_at: nowIso }).in('id', ids)
  }

  // Reporting lines from the directory's manager attribute (every user now
  // has a link, so manager references resolve). Best-effort.
  await syncDirectoryManagers(supabase, tenantId, provider, uniqueActiveUsers).catch((error) => {
    console.warn('[directory-sync] manager sync failed:', error?.message ?? error)
  })

  // Inactive directory users that are linked → deactivate their membership in
  // this tenant AND delete their user_roles rows here (revokeDirectoryAccess).
  // A full sync of a directory that lists everyone (LDAP, Google) also treats
  // linked users it no longer returns as inactive — unless it returned nobody
  // (a broken filter must not deprovision the whole workspace).
  const inactiveLinkedIds = directoryUsers
    .filter((u) => !u.active && userLinks.has(u.externalId))
    .map((u) => userLinks.get(u.externalId)!.local_id)
  if (!delta && deprovisionsMissing(provider, connection) && directoryUsers.length > 0) {
    const returned = new Set(directoryUsers.map((u) => u.externalId))
    for (const [externalId, link] of userLinks) {
      if (!returned.has(externalId)) inactiveLinkedIds.push(link.local_id)
    }
  }
  if (inactiveLinkedIds.length > 0) {
    stats.users_deactivated += await revokeDirectoryAccess(supabase, tenantId, inactiveLinkedIds)
  }

  // ── Phase 3: groups ────────────────────────────────────────────────────────
  if (connection.syncGroups) {
    await report({ phase: 'groups', message: `Syncing ${directoryGroups.length} groups…`, groups_done: 0, groups_total: directoryGroups.length })
    let groupsDone = 0

    for (const group of directoryGroups) {
      let teamId: string
      const link = groupLinks.get(group.externalId)
      if (link) {
        teamId = link.local_id
        await (supabase as any)
          .from('teams')
          .update({ name: group.displayName, description: group.description })
          .eq('id', teamId)
        await (supabase as any)
          .from('directory_links')
          .update({ display_name: group.displayName, last_seen_at: nowIso })
          .eq('id', link.id)
        stats.groups_updated++
      } else {
        const { data: team, error } = await (supabase as any)
          .from('teams')
          .insert({ tenant_id: tenantId, name: group.displayName, description: group.description })
          .select('id')
          .single()
        if (error || !team) {
          console.warn(`[directory-sync] team insert failed for ${group.displayName}:`, error?.message)
          continue
        }
        teamId = String(team.id)
        await recordLink('group', group.externalId, teamId, group.displayName)
        stats.groups_created++
      }

      // Reconcile team membership against the directory's member list.
      const desired = new Set(
        (groupMemberIds.get(group.externalId) ?? [])
          .map((externalId) => userLinks.get(externalId)?.local_id)
          .filter((id): id is string => Boolean(id)),
      )
      const { data: currentRows } = await (supabase as any)
        .from('user_teams')
        .select('user_id')
        .eq('team_id', teamId)
      const current = new Set(((currentRows ?? []) as any[]).map((r) => String(r.user_id)))

      // Insert individually with per-row tolerance: one stale link local_id
      // (deleted user) would otherwise abort the whole batch via FK violation
      // and silently drop every other member add.
      const toAdd = [...desired].filter((id) => !current.has(id))
      for (const userId of toAdd) {
        const { error } = await (supabase as any)
          .from('user_teams')
          .insert({ team_id: teamId, user_id: userId, role: 'member' })
        if (!error) stats.memberships_added++
      }

      // Only remove members that were synced from the directory (they have a
      // user link) — never touch manually-added members without links.
      const directoryManagedIds = new Set([...userLinks.values()].map((l) => l.local_id))
      const toRemove = [...current].filter((id) => !desired.has(id) && directoryManagedIds.has(id))
      for (const ids of chunk(toRemove, CHUNK)) {
        const { error } = await (supabase as any)
          .from('user_teams')
          .delete()
          .eq('team_id', teamId)
          .in('user_id', ids)
        if (!error) stats.memberships_removed += ids.length
      }

      groupsDone++
      if (groupsDone % 10 === 0) {
        await report({ phase: 'groups', message: `Synced ${groupsDone} of ${directoryGroups.length} groups…`, groups_done: groupsDone, groups_total: directoryGroups.length })
      }
    }
  }

  // ── Phase 4: done ──────────────────────────────────────────────────────────
  await updateDirectorySyncState(supabase, tenantId, provider, {
    last_sync_at: nowIso,
    last_sync_stats: { ...stats },
    ...(client.listUserChanges ? { delta_cursor: nextCursor } : {}),
    ...(client.listUserChanges && !delta ? { last_full_sync_at: nowIso } : {}),
  })
  const summary = `${label} ${delta ? 'delta ' : ''}sync: ${directoryUsers.length} ${delta ? 'changed ' : ''}users (${stats.users_created} new), ${directoryGroups.length} groups`
  await writeAudit({
    supabase, tenantId, actorId: opts?.actorId ?? null,
    objectType: 'directory_sync', objectId: connection.id,
    action: 'sync', summary,
    metadata: { provider, mode: delta ? 'delta' : 'full', ...stats },
  })
  await report({ phase: 'done', message: summary })
  return stats
  }
}

// ─── Background runs (mirror lib/github-sync/push.ts executeSyncRun) ─────────

/** Execute one claimed directory_sync_runs row with live progress updates. */
export async function executeDirectorySyncRun(supabase: SupabaseClient, run: Record<string, any>): Promise<void> {
  const tenantId = String(run.tenant_id)
  const provider: DirectoryProvider = isDirectoryProvider(run.provider) ? run.provider : 'entra'
  const updateRun = async (patch: Record<string, unknown>) => {
    await (supabase as any).from('directory_sync_runs').update(patch).eq('id', run.id)
  }
  try {
    const stats = await runDirectorySync(supabase, tenantId, provider, {
      actorId: run.created_by ?? null,
      mode: run.mode === 'full' ? 'full' : 'auto',
      onProgress: (progress) => updateRun({ progress }),
      onMode: (mode) => updateRun({ mode }),
    })
    await updateRun({
      status: 'completed',
      stats,
      progress: { phase: 'done', message: 'Sync complete' },
      completed_at: new Date().toISOString(),
    })
  } catch (error: any) {
    await updateRun({
      status: 'failed',
      error: String(error?.message ?? error),
      completed_at: new Date().toISOString(),
    })
    await writeAudit({
      supabase, tenantId, actorId: run.created_by ?? null,
      objectType: 'directory_sync', objectId: String(run.id),
      action: 'sync',
      summary: `${DIRECTORY_PROVIDER_LABELS[provider]} sync failed: ${String(error?.message ?? error).slice(0, 200)}`,
      metadata: { provider, failed: true },
    })
  }
}

/** Claim-and-run loop for background sync runs. */
export async function processDirectorySyncRuns(supabase: SupabaseClient, workerId: string, maxRuns = 2): Promise<number> {
  let processed = 0
  for (let i = 0; i < maxRuns; i++) {
    const { data: claimed, error } = await (supabase as any).rpc('claim_next_directory_sync_run', { p_worker_id: workerId })
    if (error) break // table/function not migrated yet — skip gracefully
    const run = Array.isArray(claimed) ? claimed[0] : claimed
    if (!run) break
    await executeDirectorySyncRun(supabase, run)
    processed++
  }
  return processed
}

const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000 // hourly by default, driven by a 10-min cron tick
const MIN_SYNC_INTERVAL_MS = 10 * 60 * 1000

/** Per-connector interval (settings.sync_interval_minutes, at least 10), default hourly. */
function syncIntervalMs(config: Record<string, any> | null | undefined): number {
  const minutes = Number(config?.settings?.sync_interval_minutes)
  return Number.isFinite(minutes) && minutes > 0 ? Math.max(minutes * 60_000, MIN_SYNC_INTERVAL_MS) : AUTO_SYNC_INTERVAL_MS
}

/** Connector keys of the pull directories (scheduled syncs). */
export const SYNC_CONNECTOR_KEYS = (['entra', 'okta', 'ldap', 'google'] as const).map((p) => DIRECTORY_CONNECTOR_KEYS[p])

/**
 * Enqueue a run for every enabled directory connector whose last RUN is older
 * than its interval (hourly unless settings.sync_interval_minutes says
 * otherwise) or that has never run. Gating on the most recent run's
 * created_at — regardless of status — keeps a permanently failing connector
 * at one attempt per interval instead of a failed run + audit row every
 * 10-min cron tick (config.last_sync_at only advances on success).
 */
export async function enqueueScheduledDirectorySyncs(supabase: SupabaseClient): Promise<number> {
  const { data: connectors } = await (supabase as any)
    .from('tenant_connectors')
    .select('id, tenant_id, connector_key, config')
    .in('connector_key', SYNC_CONNECTOR_KEYS)
    .eq('is_enabled', true)

  let enqueued = 0
  for (const connector of (connectors ?? []) as any[]) {
    const provider = providerForConnectorKey(String(connector.connector_key))
    if (!provider || provider === 'scim') continue
    const interval = syncIntervalMs(connector.config)
    const lastSyncAt: string | null = (connector.config as any)?.last_sync_at ?? null
    if (lastSyncAt && Date.now() - new Date(lastSyncAt).getTime() < interval) continue

    const tenantId = String(connector.tenant_id)
    const { data: lastRuns, error } = await (supabase as any)
      .from('directory_sync_runs')
      .select('id, status, created_at')
      .eq('tenant_id', tenantId)
      .eq('provider', provider)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) break // table not migrated yet
    const lastRun = ((lastRuns ?? []) as any[])[0]
    if (lastRun) {
      if (lastRun.status === 'pending' || lastRun.status === 'running') continue
      if (Date.now() - new Date(lastRun.created_at).getTime() < interval) continue
    }

    const { error: insertError } = await (supabase as any)
      .from('directory_sync_runs')
      .insert({ tenant_id: tenantId, provider })
    if (!insertError) enqueued++
  }
  return enqueued
}
