import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { writeAudit } from '@/lib/audit-log'
import { getDirectoryConnection } from '@/lib/directory-sync/connection'
import { kickDirectorySyncWorker } from '@/lib/directory-sync/kick'
import { grantDirectoryAccess, resolveProvisionRoleId, revokeDirectoryAccess, type DirectorySyncProgress, type DirectorySyncStats } from '@/lib/directory-sync/sync'
import { isDirectoryProvider, type DirectoryLinkProvider } from '@/lib/directory-sync/types'
import type { DirectoryGroupRef, DirectorySourceHandler, DirectorySourceSnapshot, DirectorySourceStatus, DirectoryUserRef } from '@/lib/extensions/sdk'
import type { DirectorySourceContribution } from '@/lib/extensions/manifest'
import { getExtensionManifest, getExtensionManifests } from '@/lib/extensions/registry'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role rows are untyped */

/**
 * Directory sources contributed by extensions (manifest
 * contributes.directorySources + server module directorySources): people and
 * groups an extension reads from its system (e.g. SharePoint site groups),
 * reconciled by core into the directory-sync tables under the source id
 * `ext.<extension id>.<key>`:
 *
 *  - every person becomes a directory_entries row with the keys they are
 *    matched on (lower-case e-mail / UPN) and their external login names;
 *  - a person who already is an active member of the workspace (an account
 *    whose e-mail is one of the keys) is linked at once (directory_links);
 *  - everyone else stays a PENDING entry: no account, no membership, no
 *    licence seat, no e-mail. At their first sign-in (SSO, LDAP bind) the
 *    entry is claimed (claimDirectoryEntries): membership with the
 *    provisioning role, the link, and the source's groups;
 *  - every group becomes a read-only team (teams.source / source_label)
 *    whose members are the linked people of the group, plus the members of
 *    nested groups of a directory connected in core (an AD group kept by
 *    LDAP sync), else the source's own expansion of them;
 *  - a complete snapshot removes what the source no longer lists: team
 *    memberships at once, and the workspace membership of people whose
 *    access came from this source (granted at their first sign-in).
 *
 * Runs are directory_sync_runs rows (provider = the source id), executed by
 * the directory-sync worker (lib/directory-sync/sync.ts executeDirectorySyncRun)
 * and queued by the extension (ctx.directory.requestSync: its scheduled job,
 * "Refresh now") or Settings → SSO & Directory.
 *
 * IMPORTANT: `db` is a SERVICE-ROLE client; every query filters the tenant.
 */

export const EXTENSION_SOURCE_RE = /^ext\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9_]*)$/
export const FULL_SOURCE_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000
export const MAX_SOURCE_USERS = 50_000
export const MAX_SOURCE_GROUPS = 5_000
const CHUNK = 100
const MIGRATION = '20270113100000_directory_sources.sql'

export function isExtensionSourceId(value: unknown): value is string {
  return typeof value === 'string' && EXTENSION_SOURCE_RE.test(value)
}

export function parseSourceId(value: string): { extensionId: string; key: string } | null {
  const m = EXTENSION_SOURCE_RE.exec(String(value ?? ''))
  return m ? { extensionId: m[1], key: m[2] } : null
}

export function sourceIdFor(extensionId: string, key: string): string {
  return `ext.${extensionId}.${key}`
}

export interface RegisteredDirectorySource extends DirectorySourceContribution {
  /** `ext.<id>.<key>` */
  id: string
  extensionId: string
  extensionName: string
}

/** Every directory source declared by an extension in this build. */
export function listDirectorySources(): RegisteredDirectorySource[] {
  return getExtensionManifests().flatMap((m) => m.contributes.directorySources.map((s) => ({ ...s, id: sourceIdFor(m.id, s.key), extensionId: m.id, extensionName: m.name })))
}

export function getDirectorySource(id: string): RegisteredDirectorySource | null {
  const parsed = parseSourceId(id)
  if (!parsed) return null
  const manifest = getExtensionManifest(parsed.extensionId)
  const source = manifest?.contributes.directorySources.find((s) => s.key === parsed.key)
  return manifest && source ? { ...source, id, extensionId: manifest.id, extensionName: manifest.name } : null
}

/** Label of any directory provider or source (directory_sync_runs.provider). */
export function directoryProviderLabel(provider: string): string {
  const source = getDirectorySource(provider)
  return source ? source.label : provider
}

async function handlerFor(source: RegisteredDirectorySource): Promise<DirectorySourceHandler | null> {
  const { getServerExtension } = await import('@/lib/extensions/server-registry')
  return getServerExtension(source.extensionId)?.directorySources?.[source.key] ?? null
}

/** Can this workspace use the source now (extension usable + its licence feature)? */
export async function directorySourceAccess(tenantId: string, source: RegisteredDirectorySource): Promise<{ usable: boolean; reason: string | null }> {
  const { extensionAccess } = await import('@/lib/extensions/state')
  const access = await extensionAccess(tenantId, source.extensionId, source.feature)
  return { usable: access.usable, reason: access.reason }
}

async function contextFor(source: RegisteredDirectorySource, tenantId: string, actorId: string | null = null) {
  const { createExtensionContext } = await import('@/lib/extensions/host')
  return createExtensionContext({ extensionId: source.extensionId, tenantId, actorId })
}

function migrationMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || /does not exist|could not find the/i.test(error.message ?? '')))
}

function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

/** Lower-case, trimmed match keys (addresses / UPNs); anything without an @ is dropped. */
export function normaliseMatchKeys(values: Array<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const value of values) {
    const key = String(value ?? '').trim().toLowerCase()
    if (key && key.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(key)) out.add(key)
  }
  return [...out]
}

/* ── snapshot validation ────────────────────────────────────────────── */

const str = (max: number) => z.string().trim().min(1).max(max)
const snapshotSchema = z.object({
  users: z.array(z.object({
    externalId: str(500),
    displayName: z.string().max(300).nullable().optional(),
    email: z.string().max(320).nullable().optional(),
    aliases: z.array(z.string().max(320)).max(20).optional(),
    claims: z.array(z.string().max(500)).max(20).optional(),
    active: z.boolean().optional(),
    attributes: z.record(z.string(), z.union([z.string().max(500), z.null()])).optional(),
  })).max(MAX_SOURCE_USERS),
  groups: z.array(z.object({
    externalId: str(500),
    displayName: str(200),
    description: z.string().max(1000).nullable().optional(),
    label: z.string().max(200).nullable().optional(),
    members: z.array(z.string().max(500)).max(MAX_SOURCE_USERS),
    nested: z.array(z.object({
      directory: z.enum(['ldap', 'entra', 'okta', 'google', 'scim']),
      name: z.string().max(300).nullable().optional(),
      externalId: z.string().max(500).nullable().optional(),
      members: z.array(z.string().max(500)).max(MAX_SOURCE_USERS).optional(),
    })).max(50).optional(),
  })).max(MAX_SOURCE_GROUPS),
  complete: z.boolean().optional(),
  cursor: z.string().max(10_000).nullable().optional(),
  warnings: z.array(z.string().max(500)).max(100).optional(),
})

interface SourceUser {
  externalId: string
  displayName: string
  email: string | null
  keys: string[]
  claims: string[]
  active: boolean
  attributes: Record<string, string | null>
}

interface SourceGroup {
  externalId: string
  displayName: string
  description: string | null
  label: string | null
  members: string[]
  nested: Array<{ directory: DirectoryLinkProvider; name: string | null; externalId: string | null; members: string[] }>
}

export interface NormalisedSnapshot {
  users: SourceUser[]
  groups: SourceGroup[]
  complete: boolean
  cursor: string | null
  warnings: string[]
}

/** Validate an extension's snapshot and normalise it (dedupe, lower-case keys and claims). */
export function normaliseSnapshot(raw: DirectorySourceSnapshot): NormalisedSnapshot {
  const parsed = snapshotSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`The directory source returned an invalid snapshot: ${issues}`)
  }
  const users = new Map<string, SourceUser>()
  for (const u of parsed.data.users) {
    const keys = normaliseMatchKeys([u.email, ...(u.aliases ?? [])])
    const existing = users.get(u.externalId)
    if (existing) {
      existing.keys = [...new Set([...existing.keys, ...keys])]
      existing.claims = [...new Set([...existing.claims, ...(u.claims ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean)])]
      continue
    }
    const email = keys.includes(String(u.email ?? '').trim().toLowerCase()) ? String(u.email).trim().toLowerCase() : keys[0] ?? null
    users.set(u.externalId, {
      externalId: u.externalId,
      displayName: (u.displayName ?? '').trim() || email || u.externalId,
      email,
      keys,
      claims: [...new Set((u.claims ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean))],
      active: u.active !== false,
      attributes: u.attributes ?? {},
    })
  }
  const groups = new Map<string, SourceGroup>()
  for (const g of parsed.data.groups) {
    if (groups.has(g.externalId)) continue
    groups.set(g.externalId, {
      externalId: g.externalId,
      displayName: g.displayName,
      description: g.description?.trim() || null,
      label: g.label?.trim() || null,
      members: [...new Set(g.members)],
      nested: (g.nested ?? []).map((n) => ({ directory: n.directory, name: n.name?.trim() || null, externalId: n.externalId?.trim() || null, members: [...new Set(n.members ?? [])] })),
    })
  }
  return { users: [...users.values()], groups: [...groups.values()], complete: parsed.data.complete !== false, cursor: parsed.data.cursor ?? null, warnings: parsed.data.warnings ?? [] }
}

/* ── state ──────────────────────────────────────────────────────────── */

interface SourceState {
  id: string | null
  cursor: string | null
  last_sync_at: string | null
  last_full_sync_at: string | null
  last_sync_stats: Record<string, number> | null
  last_error: string | null
}

async function loadState(db: SupabaseClient, tenantId: string, sourceId: string): Promise<SourceState> {
  const { data, error } = await (db as any).from('directory_sources')
    .select('id, cursor, last_sync_at, last_full_sync_at, last_sync_stats, last_error')
    .eq('tenant_id', tenantId).eq('source', sourceId).maybeSingle()
  if (error) {
    if (migrationMissing(error)) throw new Error(`Directory sources need the database migration ${MIGRATION}`)
    throw new Error(error.message)
  }
  return (data as SourceState | null) ?? { id: null, cursor: null, last_sync_at: null, last_full_sync_at: null, last_sync_stats: null, last_error: null }
}

async function saveState(db: SupabaseClient, tenantId: string, sourceId: string, patch: Partial<SourceState>): Promise<void> {
  await (db as any).from('directory_sources')
    .upsert({ tenant_id: tenantId, source: sourceId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,source' })
}

/* ── queueing ───────────────────────────────────────────────────────── */

export interface SourceSyncRequest {
  queued: boolean
  runId: string | null
  reason?: string
}

/**
 * Queue a run of an extension source. `ifDue`: only when the last run (of
 * any status, so a failing source retries once per interval) is older than
 * the interval and the handler says there is something to sync.
 */
export async function requestDirectorySourceSync(
  db: SupabaseClient,
  tenantId: string,
  sourceId: string,
  options: { full?: boolean; ifDue?: boolean; intervalMinutes?: number; actorId?: string | null } = {},
): Promise<SourceSyncRequest> {
  const source = getDirectorySource(sourceId)
  if (!source) return { queued: false, runId: null, reason: 'unknown_source' }
  const access = await directorySourceAccess(tenantId, source)
  if (!access.usable) return { queued: false, runId: null, reason: access.reason ?? 'not_available' }

  const { data: active, error: activeError } = await (db as any).from('directory_sync_runs').select('id')
    .eq('tenant_id', tenantId).eq('provider', sourceId).in('status', ['pending', 'running']).limit(1)
  if (activeError) throw new Error(activeError.message)
  if ((active ?? []).length) return { queued: false, runId: String(active[0].id), reason: 'already_running' }

  if (options.ifDue) {
    const minutes = Math.max(10, Math.min(10_080, Math.floor(options.intervalMinutes ?? source.intervalMinutes)))
    const { data: last } = await (db as any).from('directory_sync_runs').select('created_at')
      .eq('tenant_id', tenantId).eq('provider', sourceId).order('created_at', { ascending: false }).limit(1)
    const lastAt = (last ?? [])[0]?.created_at
    if (lastAt && Date.now() - new Date(lastAt).getTime() < minutes * 60_000) return { queued: false, runId: null, reason: 'not_due' }
    const handler = await handlerFor(source)
    if (handler?.enabled && !(await handler.enabled({ ctx: await contextFor(source, tenantId) }))) return { queued: false, runId: null, reason: 'nothing_to_sync' }
  }

  const { data, error } = await (db as any).from('directory_sync_runs')
    .insert({ tenant_id: tenantId, provider: sourceId, created_by: options.actorId ?? null, ...(options.full ? { mode: 'full' } : {}) })
    .select('id').single()
  if (error) {
    if (error.code === '23505') return { queued: false, runId: null, reason: 'already_running' }
    if (error.code === '23514') throw new Error(`Directory sources need the database migration ${MIGRATION}`)
    throw new Error(error.message)
  }
  kickDirectorySyncWorker()
  return { queued: true, runId: String(data.id) }
}

/* ── the sync ───────────────────────────────────────────────────────── */

export interface SourceSyncStats extends DirectorySyncStats {
  entries_pending: number
  entries_linked: number
  entries_inactive: number
}

interface LinkRow { id: string; object_type: 'user' | 'group'; external_id: string; local_id: string; display_name: string | null }

/**
 * Run one sync of an extension source for a workspace: call the extension's
 * handler, then reconcile its snapshot (see the module comment).
 */
export async function runExtensionDirectorySync(
  db: SupabaseClient,
  tenantId: string,
  sourceId: string,
  opts: {
    mode?: 'full' | 'auto'
    actorId?: string | null
    onProgress?: (progress: DirectorySyncProgress) => Promise<void> | void
    onMode?: (mode: 'full' | 'delta') => Promise<void> | void
    deadline?: number
  } = {},
): Promise<SourceSyncStats> {
  const report = async (progress: DirectorySyncProgress) => { try { await opts.onProgress?.(progress) } catch { /* best effort */ } }
  const source = getDirectorySource(sourceId)
  if (!source) throw new Error(`Unknown directory source "${sourceId}" (the extension is not in this build)`)
  const access = await directorySourceAccess(tenantId, source)
  if (!access.usable) throw new Error(access.reason ?? `${source.label} is not available in this workspace`)
  const handler = await handlerFor(source)
  if (!handler) throw new Error(`${source.extensionName} does not implement the directory source "${source.key}"`)

  const state = await loadState(db, tenantId, sourceId)
  const fullDue = !state.last_full_sync_at || Date.now() - new Date(state.last_full_sync_at).getTime() >= FULL_SOURCE_SYNC_INTERVAL_MS
  const mode: 'full' | 'delta' = opts.mode === 'full' || fullDue ? 'full' : 'delta'
  await opts.onMode?.(mode)
  await report({ phase: 'fetching', message: `Reading ${source.label}…` })

  let snapshot: NormalisedSnapshot
  try {
    const ctx = await contextFor(source, tenantId, opts.actorId ?? null)
    snapshot = normaliseSnapshot(await handler.sync({ ctx, mode, cursor: state.cursor, lastFullSyncAt: state.last_full_sync_at, deadline: opts.deadline ?? Date.now() + 50_000 }))
  } catch (error) {
    await saveState(db, tenantId, sourceId, { last_error: String((error as Error)?.message ?? error).slice(0, 1000) }).catch(() => undefined)
    throw error
  }
  await report({ phase: 'fetching', message: `${source.label}: ${snapshot.users.length} people, ${snapshot.groups.length} groups` })

  const stats = await applySnapshot(db, tenantId, source, snapshot, report)
  const nowIso = new Date().toISOString()
  await saveState(db, tenantId, sourceId, {
    cursor: snapshot.cursor,
    last_sync_at: nowIso,
    last_sync_stats: { ...stats },
    last_error: null,
    ...(mode === 'full' ? { last_full_sync_at: nowIso } : {}),
  })
  const summary = `${source.label} ${mode} sync: ${snapshot.users.length} people (${stats.entries_linked} with an account, ${stats.entries_pending} pending first sign-in), ${snapshot.groups.length} groups`
  await writeAudit({
    supabase: db, tenantId, actorId: opts.actorId ?? null,
    objectType: 'directory_sync', objectId: state.id ?? sourceId,
    action: 'sync', summary,
    metadata: { provider: sourceId, mode, ...stats, warnings: snapshot.warnings.slice(0, 20) },
  })
  await report({ phase: 'done', message: summary })
  return stats
}

/** Reconcile a normalised snapshot (exported for tests). */
export async function applySnapshot(
  db: SupabaseClient,
  tenantId: string,
  source: Pick<RegisteredDirectorySource, 'id' | 'label'>,
  snapshot: NormalisedSnapshot,
  report: (progress: DirectorySyncProgress) => Promise<void> = async () => undefined,
): Promise<SourceSyncStats> {
  const sourceId = source.id
  const nowIso = new Date().toISOString()
  const stats: SourceSyncStats = {
    users_seen: snapshot.users.length, users_created: 0, users_linked: 0, users_deactivated: 0,
    groups_created: 0, groups_updated: 0, memberships_added: 0, memberships_removed: 0,
    profiles_updated: 0, org_units_created: 0, org_units_updated: 0, org_unit_memberships_changed: 0,
    entries_pending: 0, entries_linked: 0, entries_inactive: 0,
  }

  const { data: linkRows, error: linkError } = await (db as any).from('directory_links')
    .select('id, object_type, external_id, local_id, display_name').eq('tenant_id', tenantId).eq('provider', sourceId)
  if (linkError) throw new Error(linkError.message)
  const userLinks = new Map<string, LinkRow>()
  const groupLinks = new Map<string, LinkRow>()
  for (const row of (linkRows ?? []) as LinkRow[]) (row.object_type === 'group' ? groupLinks : userLinks).set(row.external_id, row)

  const { data: entryRows, error: entryError } = await (db as any).from('directory_entries')
    .select('id, external_id, local_user_id, granted_access, active').eq('tenant_id', tenantId).eq('source', sourceId)
  if (entryError) {
    if (migrationMissing(entryError)) throw new Error(`Directory sources need the database migration ${MIGRATION}`)
    throw new Error(entryError.message)
  }
  const entries = new Map<string, { id: string; external_id: string; local_user_id: string | null; granted_access: boolean; active: boolean }>()
  for (const row of (entryRows ?? []) as any[]) entries.set(String(row.external_id), row)

  const recordLink = async (objectType: 'user' | 'group', externalId: string, localId: string, displayName: string | null) => {
    const { data } = await (db as any).from('directory_links').upsert({
      tenant_id: tenantId, provider: sourceId, object_type: objectType, external_id: externalId,
      local_id: localId, display_name: displayName, last_seen_at: nowIso,
    }, { onConflict: 'tenant_id,provider,object_type,external_id' }).select('id, object_type, external_id, local_id, display_name').maybeSingle()
    const row = (data ?? { id: '', object_type: objectType, external_id: externalId, local_id: localId, display_name: displayName }) as LinkRow
    ;(objectType === 'group' ? groupLinks : userLinks).set(externalId, row)
    return row
  }

  // ── people ──
  await report({ phase: 'users', message: `Matching ${snapshot.users.length} people…`, users_done: 0, users_total: snapshot.users.length })
  const unlinkedKeys = [...new Set(snapshot.users.filter((u) => u.active && !userLinks.has(u.externalId)).flatMap((u) => u.keys))]
  const accountsByKey = new Map<string, string>()
  for (const keys of chunk(unlinkedKeys)) {
    const { data } = await (db as any).from('users').select('id, email').ilikeAnyOf('email', keys.map(escapeLikePattern))
    for (const row of (data ?? []) as any[]) if (row?.email) accountsByKey.set(String(row.email).toLowerCase(), String(row.id))
  }
  // Only ACTIVE members of this workspace are linked now; anyone else waits for their first sign-in.
  const activeMembers = new Set<string>()
  for (const ids of chunk([...new Set(accountsByKey.values())])) {
    const { data } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).eq('is_active', true).in('user_id', ids)
    for (const row of (data ?? []) as any[]) activeMembers.add(String(row.user_id))
  }

  const localIdOf = new Map<string, string>()
  for (const user of snapshot.users) {
    let link = userLinks.get(user.externalId)
    if (!link && user.active) {
      const match = user.keys.map((k) => accountsByKey.get(k)).find((id) => id && activeMembers.has(id))
      if (match) {
        link = await recordLink('user', user.externalId, match, user.displayName)
        stats.users_linked++
      }
    } else if (link && link.display_name !== user.displayName) {
      await (db as any).from('directory_links').update({ display_name: user.displayName, last_seen_at: nowIso }).eq('id', link.id)
    }
    if (link?.local_id) localIdOf.set(user.externalId, link.local_id)
  }
  const seenUserLinkIds = snapshot.users.map((u) => userLinks.get(u.externalId)?.id).filter((id): id is string => Boolean(id))
  for (const ids of chunk(seenUserLinkIds)) await (db as any).from('directory_links').update({ last_seen_at: nowIso }).in('id', ids)

  // ── groups: which source groups each person is in (direct + the source's nested expansion) ──
  const activeUser = new Set(snapshot.users.filter((u) => u.active).map((u) => u.externalId))
  const groupIdsOf = new Map<string, Set<string>>()
  for (const group of snapshot.groups) {
    for (const member of [...group.members, ...group.nested.flatMap((n) => n.members)]) {
      if (!activeUser.has(member)) continue
      const set = groupIdsOf.get(member) ?? new Set<string>()
      set.add(group.externalId)
      groupIdsOf.set(member, set)
    }
  }

  // ── entries ──
  const payload = snapshot.users.map((u) => {
    const localId = localIdOf.get(u.externalId) ?? null
    if (u.active) { if (localId) stats.entries_linked++; else stats.entries_pending++ } else stats.entries_inactive++
    return {
      tenant_id: tenantId, source: sourceId, external_id: u.externalId, display_name: u.displayName, email: u.email,
      match_keys: u.keys, claims: u.claims, group_ids: [...(groupIdsOf.get(u.externalId) ?? [])].sort(), attributes: u.attributes,
      active: u.active, local_user_id: localId, last_seen_at: nowIso, updated_at: nowIso,
    }
  })
  for (const rows of chunk(payload)) {
    const { error } = await (db as any).from('directory_entries').upsert(rows, { onConflict: 'tenant_id,source,external_id' })
    if (error) throw new Error(`directory_entries: ${error.message}`)
  }
  const listed = new Set(snapshot.users.map((u) => u.externalId))
  const gone = snapshot.complete ? [...entries.values()].filter((e) => !listed.has(e.external_id) && e.active) : []
  for (const ids of chunk(gone.map((e) => e.id))) {
    await (db as any).from('directory_entries').update({ active: false, group_ids: [], updated_at: nowIso }).in('id', ids)
  }
  stats.entries_inactive += gone.length

  // Workspace access that came from this source ends when the source stops listing the person.
  // (Never when the source returned nobody at all: a broken source must not empty the workspace.)
  if (snapshot.users.length > 0) {
    const inactiveListed = new Set(snapshot.users.filter((u) => !u.active).map((u) => u.externalId))
    const revokedEntries = [...entries.values()]
      .filter((e) => e.granted_access && e.local_user_id && (inactiveListed.has(e.external_id) || (snapshot.complete && !listed.has(e.external_id))))
    const revoke = revokedEntries.map((e) => String(e.local_user_id))
    if (revoke.length) {
      // Unless another active entry of a source still grants them this workspace.
      const { data: others } = await (db as any).from('directory_entries').select('local_user_id, source, external_id')
        .eq('tenant_id', tenantId).eq('active', true).eq('granted_access', true).in('local_user_id', revoke)
      const kept = new Set(((others ?? []) as any[]).filter((o) => !(o.source === sourceId && (inactiveListed.has(o.external_id) || !listed.has(o.external_id)))).map((o) => String(o.local_user_id)))
      const ids = revoke.filter((id) => !kept.has(id))
      if (ids.length) {
        stats.users_deactivated += await revokeDirectoryAccess(db, tenantId, ids)
        // Back to pending: if the source lists them again, their next sign-in brings the access back.
        const revokedIds = new Set(ids)
        const externalIds = revokedEntries.filter((e) => revokedIds.has(String(e.local_user_id))).map((e) => e.external_id)
        for (const part of chunk(externalIds)) {
          await (db as any).from('directory_entries').update({ local_user_id: null, granted_access: false, claimed_at: null }).eq('tenant_id', tenantId).eq('source', sourceId).in('external_id', part)
          await (db as any).from('directory_links').delete().eq('tenant_id', tenantId).eq('provider', sourceId).eq('object_type', 'user').in('external_id', part)
          for (const externalId of part) { userLinks.delete(externalId); localIdOf.delete(externalId) }
        }
      }
    }
  }

  // ── teams ──
  await report({ phase: 'groups', message: `Syncing ${snapshot.groups.length} groups…`, groups_done: 0, groups_total: snapshot.groups.length })
  const linkedTeamIds = snapshot.groups.map((g) => groupLinks.get(g.externalId)?.local_id).filter((id): id is string => Boolean(id))
  const teams = new Map<string, any>()
  for (const ids of chunk(linkedTeamIds)) {
    const { data } = await (db as any).from('teams').select('id, name, description, source, source_label').eq('tenant_id', tenantId).in('id', ids)
    for (const row of (data ?? []) as any[]) teams.set(String(row.id), row)
  }
  const nestedCache = new Map<string, string[] | null>()
  const resolveNested = async (ref: SourceGroup['nested'][number]): Promise<string[] | null> => {
    const cacheKey = `${ref.directory}|${ref.externalId ?? ''}|${(ref.name ?? '').toLowerCase()}`
    if (nestedCache.has(cacheKey)) return nestedCache.get(cacheKey)!
    const members = await nestedMembers(db, tenantId, ref).catch(() => null)
    nestedCache.set(cacheKey, members)
    return members
  }

  let groupsDone = 0
  for (const group of snapshot.groups) {
    const label = group.label ?? source.label
    let link = groupLinks.get(group.externalId)
    let teamId = link?.local_id ?? null
    const team = teamId ? teams.get(teamId) : null
    if (teamId && team) {
      if (team.name !== group.displayName || (team.description ?? null) !== group.description || team.source !== sourceId || (team.source_label ?? null) !== label) {
        await (db as any).from('teams').update({ name: group.displayName, description: group.description, source: sourceId, source_label: label, updated_at: nowIso }).eq('id', teamId).eq('tenant_id', tenantId)
        stats.groups_updated++
      }
      if (link && link.display_name !== group.displayName) await (db as any).from('directory_links').update({ display_name: group.displayName, last_seen_at: nowIso }).eq('id', link.id)
      else if (link?.id) await (db as any).from('directory_links').update({ last_seen_at: nowIso }).eq('id', link.id)
    } else {
      const { data: created, error } = await (db as any).from('teams')
        .insert({ tenant_id: tenantId, name: group.displayName, description: group.description, source: sourceId, source_label: label })
        .select('id').single()
      if (error || !created) {
        if (migrationMissing(error)) throw new Error(`Directory sources need the database migration ${MIGRATION}`)
        console.warn(`[directory-sources] team insert failed for ${group.displayName}:`, error?.message)
        continue
      }
      teamId = String(created.id)
      link = await recordLink('group', group.externalId, teamId, group.displayName)
      stats.groups_created++
    }

    const desired = new Set<string>()
    for (const member of group.members) {
      const id = activeUser.has(member) ? localIdOf.get(member) : undefined
      if (id) desired.add(id)
    }
    for (const ref of group.nested) {
      const viaDirectory = await resolveNested(ref)
      if (viaDirectory) for (const id of viaDirectory) desired.add(id)
      else for (const member of ref.members) {
        const id = activeUser.has(member) ? localIdOf.get(member) : undefined
        if (id) desired.add(id)
      }
    }
    const changed = await reconcileTeam(db, teamId, desired)
    stats.memberships_added += changed.added
    stats.memberships_removed += changed.removed
    groupsDone++
    if (groupsDone % 10 === 0) await report({ phase: 'groups', message: `Synced ${groupsDone} of ${snapshot.groups.length} groups…`, groups_done: groupsDone, groups_total: snapshot.groups.length })
  }

  // Groups the source no longer has: the team stays (tasks may point at it) but loses its members.
  if (snapshot.complete) {
    const listedGroups = new Set(snapshot.groups.map((g) => g.externalId))
    for (const [externalId, link] of groupLinks) {
      if (listedGroups.has(externalId)) continue
      const changed = await reconcileTeam(db, link.local_id, new Set())
      stats.memberships_removed += changed.removed
    }
  }
  return stats
}

/** Make a source team's members exactly `desired` (source teams are read-only, so every member is the source's). */
async function reconcileTeam(db: SupabaseClient, teamId: string, desired: Set<string>): Promise<{ added: number; removed: number }> {
  const { data: rows } = await (db as any).from('user_teams').select('user_id').eq('team_id', teamId)
  const current = new Set(((rows ?? []) as any[]).map((r) => String(r.user_id)))
  let added = 0
  let removed = 0
  for (const userId of desired) {
    if (current.has(userId)) continue
    const { error } = await (db as any).from('user_teams').insert({ team_id: teamId, user_id: userId, role: 'member' })
    if (!error) added++
  }
  const toRemove = [...current].filter((id) => !desired.has(id))
  for (const ids of chunk(toRemove)) {
    const { error } = await (db as any).from('user_teams').delete().eq('team_id', teamId).in('user_id', ids)
    if (!error) removed += ids.length
  }
  return { added, removed }
}

/**
 * Members (local user ids) of a group of a directory connected in core, from
 * the team its sync keeps — null when that directory is not connected with
 * group sync, or the group is not found (the caller falls back to the
 * source's own expansion).
 */
async function nestedMembers(db: SupabaseClient, tenantId: string, ref: SourceGroup['nested'][number]): Promise<string[] | null> {
  if (!isDirectoryProvider(ref.directory) && ref.directory !== 'scim') return null
  const connection = await getDirectoryConnection(db, tenantId, ref.directory)
  if (!connection?.isEnabled || (ref.directory !== 'scim' && !connection.syncGroups)) return null
  let link: { local_id: string } | null = null
  if (ref.externalId) {
    const { data } = await (db as any).from('directory_links').select('local_id')
      .eq('tenant_id', tenantId).eq('provider', ref.directory).eq('object_type', 'group').eq('external_id', ref.externalId).maybeSingle()
    link = data ?? null
  }
  if (!link && ref.name) {
    const name = ref.name.replace(/^[^\\]+\\/, '').trim()
    if (name) {
      const { data } = await (db as any).from('directory_links').select('local_id, display_name')
        .eq('tenant_id', tenantId).eq('provider', ref.directory).eq('object_type', 'group').ilikeAnyOf('display_name', [escapeLikePattern(name)])
      link = ((data ?? []) as any[])[0] ?? null
    }
  }
  if (!link) return null
  const { data: members } = await (db as any).from('user_teams').select('user_id').eq('team_id', link.local_id)
  return [...new Set(((members ?? []) as any[]).map((m) => String(m.user_id)))]
}

/* ── first sign-in ──────────────────────────────────────────────────── */

const ENTRY_COLUMNS = 'id, tenant_id, source, external_id, display_name, group_ids'

/** Pending entries (any workspace) for these keys whose source is usable there. */
async function pendingEntries(db: SupabaseClient, keys: string[]): Promise<Array<{ entry: any; source: RegisteredDirectorySource }>> {
  const normalised = normaliseMatchKeys(keys)
  if (!normalised.length || !listDirectorySources().length) return []
  const { data, error } = await (db as any).from('directory_entries').select(ENTRY_COLUMNS)
    .overlaps('match_keys', normalised).is('local_user_id', null).eq('active', true).limit(200)
  if (error) return [] // table not migrated yet: nothing pending
  const out: Array<{ entry: any; source: RegisteredDirectorySource }> = []
  for (const entry of (data ?? []) as any[]) {
    const source = getDirectorySource(String(entry.source))
    if (!source) continue
    if (!(await directorySourceAccess(String(entry.tenant_id), source)).usable) continue
    out.push({ entry, source })
  }
  return out
}

/** Is someone with one of these (verified) addresses waiting as a pending directory entry? */
export async function hasPendingDirectoryEntry(db: SupabaseClient, keys: string[]): Promise<boolean> {
  return (await pendingEntries(db, keys)).length > 0
}

/** The workspaces whose directory sources list the person (pending) — where a first sign-in lands. */
export async function pendingDirectoryTenants(db: SupabaseClient, keys: string[]): Promise<string[]> {
  const entries = await pendingEntries(db, keys)
  return [...new Set(entries.map(({ entry }) => String(entry.tenant_id)))]
}

async function seatCount(db: SupabaseClient, sourceId: string): Promise<number> {
  const { data } = await (db as any).from('directory_links').select('local_id').eq('provider', sourceId).eq('object_type', 'user').limit(100_000)
  return new Set(((data ?? []) as any[]).map((r) => String(r.local_id))).size
}

/** Usage of a source's seat limit: people with an account linked to the source, across workspaces. */
export async function directorySourceSeatUsage(db: SupabaseClient, extensionId: string, seatLimit: string): Promise<number> {
  const ids = listDirectorySources().filter((s) => s.extensionId === extensionId && s.seatLimit === seatLimit).map((s) => s.id)
  let total = 0
  for (const id of ids) total += await seatCount(db, id)
  return total
}

export interface ClaimResult {
  /** Workspaces the person joined or was linked in. */
  tenants: string[]
  /** Entries that stayed pending (seat limit reached). */
  refused: number
}

/**
 * First sign-in of a person with verified addresses `keys`: every pending
 * entry for them becomes theirs — the workspace (membership with the
 * provisioning role, unless they already belong), the directory link, and
 * the teams of the source groups they are in. Best effort per entry.
 */
export async function claimDirectoryEntries(db: SupabaseClient, input: { userId: string; keys: string[] }): Promise<ClaimResult> {
  const result: ClaimResult = { tenants: [], refused: 0 }
  for (const { entry, source } of await pendingEntries(db, input.keys)) {
    const tenantId = String(entry.tenant_id)
    try {
      const { data: membership } = await (db as any).from('user_memberships').select('user_id, is_active')
        .eq('tenant_id', tenantId).eq('user_id', input.userId).maybeSingle()
      const wasMember = Boolean(membership && membership.is_active !== false)
      if (source.seatLimit && !wasMember) {
        const ctx = await contextFor(source, tenantId)
        const verdict = await ctx.licence.limit(source.seatLimit, { usage: await directorySourceSeatUsage(db, source.extensionId, source.seatLimit) })
        if (!verdict.allowed) {
          result.refused++
          await writeAudit({ supabase: db, tenantId, actorId: input.userId, objectType: 'directory_sync', objectId: String(entry.id), action: 'sync', summary: `${source.label}: ${entry.display_name ?? 'a person'} stays pending — ${verdict.reason ?? 'the licence limit is reached'}`, metadata: { provider: source.id, seat_limit: source.seatLimit, refused: true } })
          continue
        }
      }
      if (!wasMember) await grantDirectoryAccess(db, tenantId, input.userId, await resolveProvisionRoleId(db, tenantId))
      await (db as any).from('directory_links').upsert({
        tenant_id: tenantId, provider: source.id, object_type: 'user', external_id: String(entry.external_id),
        local_id: input.userId, display_name: entry.display_name ?? null, last_seen_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,provider,object_type,external_id' })
      await (db as any).from('directory_entries').update({ local_user_id: input.userId, claimed_at: new Date().toISOString(), granted_access: !wasMember }).eq('id', entry.id)
      const groupIds = ((entry.group_ids ?? []) as string[]).filter(Boolean)
      let teamsJoined = 0
      for (const ids of chunk(groupIds)) {
        const { data: links } = await (db as any).from('directory_links').select('local_id')
          .eq('tenant_id', tenantId).eq('provider', source.id).eq('object_type', 'group').in('external_id', ids)
        for (const link of (links ?? []) as any[]) {
          const { error } = await (db as any).from('user_teams').insert({ team_id: String(link.local_id), user_id: input.userId, role: 'member' })
          if (!error) teamsJoined++
        }
      }
      result.tenants.push(tenantId)
      await writeAudit({
        supabase: db, tenantId, actorId: input.userId, objectType: 'directory_sync', objectId: String(entry.id), action: 'sync',
        summary: `${source.label}: ${entry.display_name ?? 'a person'} signed in for the first time${wasMember ? '' : ' and joined the workspace'} (${teamsJoined} group${teamsJoined === 1 ? '' : 's'})`,
        metadata: { provider: source.id, claimed: true, joined: !wasMember, teams: teamsJoined },
      })
    } catch (error) {
      console.warn(`[directory-sources] claiming a pending entry in ${tenantId} failed:`, (error as Error)?.message ?? error)
    }
  }
  result.tenants = [...new Set(result.tenants)]
  return result
}

/* ── status and lookups (ctx.directory, services) ───────────────────── */

export async function directorySourceStatus(db: SupabaseClient, tenantId: string, sourceId: string): Promise<DirectorySourceStatus> {
  const state = await loadState(db, tenantId, sourceId)
  const count = async (table: string, apply: (q: any) => any) => {
    const { count: n, error } = await apply((db as any).from(table).select('id', { count: 'exact', head: true }))
    return error ? 0 : (n ?? 0)
  }
  const [linked, pending, groups, active] = await Promise.all([
    count('directory_entries', (q) => q.eq('tenant_id', tenantId).eq('source', sourceId).eq('active', true).not('local_user_id', 'is', null)),
    count('directory_entries', (q) => q.eq('tenant_id', tenantId).eq('source', sourceId).eq('active', true).is('local_user_id', null)),
    count('teams', (q) => q.eq('tenant_id', tenantId).eq('source', sourceId)),
    (db as any).from('directory_sync_runs').select('id').eq('tenant_id', tenantId).eq('provider', sourceId).in('status', ['pending', 'running']).limit(1),
  ])
  return {
    source: sourceId,
    lastSyncAt: state.last_sync_at,
    lastFullSyncAt: state.last_full_sync_at,
    lastError: state.last_error,
    stats: state.last_sync_stats,
    activeRunId: ((active as any)?.data ?? [])[0]?.id ?? null,
    counts: { linked, pending, groups },
  }
}

function entryRef(row: any): DirectoryUserRef {
  return {
    userId: row.local_user_id ? String(row.local_user_id) : null,
    displayName: row.display_name ?? null,
    email: row.email ?? null,
    externalId: String(row.external_id),
    claims: (row.claims ?? []) as string[],
    matchKeys: (row.match_keys ?? []) as string[],
    pending: !row.local_user_id,
  }
}

const LOOKUP_COLUMNS = 'external_id, display_name, email, match_keys, claims, local_user_id'

/**
 * Workspace members and source entries by account id, e-mail / UPN, external
 * id or claim — scoped to one workspace and the given sources. Members are
 * returned only while they are active members of the workspace.
 */
export async function lookupDirectoryUsers(
  db: SupabaseClient,
  tenantId: string,
  sourceIds: string[],
  input: { userIds?: string[]; emails?: string[]; externalIds?: string[]; claims?: string[] },
): Promise<DirectoryUserRef[]> {
  const take = (values: string[] | undefined) => [...new Set((values ?? []).map((v) => String(v ?? '').trim()).filter(Boolean))].slice(0, 500)
  const userIds = take(input.userIds)
  const emails = normaliseMatchKeys(take(input.emails))
  const externalIds = take(input.externalIds)
  const claims = take(input.claims).map((c) => c.toLowerCase())
  const out = new Map<string, DirectoryUserRef>()
  const add = (ref: DirectoryUserRef) => {
    const key = ref.userId ? `u:${ref.userId}` : `e:${ref.externalId}`
    const existing = out.get(key)
    if (!existing) out.set(key, ref)
    else if (!existing.externalId && ref.externalId) out.set(key, { ...ref, userId: existing.userId })
  }
  if (!sourceIds.length) return []
  const entryQuery = () => (db as any).from('directory_entries').select(LOOKUP_COLUMNS).eq('tenant_id', tenantId).in('source', sourceIds).eq('active', true)
  if (externalIds.length) for (const row of ((await entryQuery().in('external_id', externalIds)).data ?? []) as any[]) add(entryRef(row))
  if (claims.length) for (const row of ((await entryQuery().overlaps('claims', claims)).data ?? []) as any[]) add(entryRef(row))
  if (emails.length) for (const row of ((await entryQuery().overlaps('match_keys', emails)).data ?? []) as any[]) add(entryRef(row))
  if (userIds.length) for (const row of ((await entryQuery().in('local_user_id', userIds)).data ?? []) as any[]) add(entryRef(row))

  // Members asked for by id or e-mail who have no entry of these sources.
  const memberIds = new Set<string>(userIds)
  if (emails.length) {
    const { data } = await (db as any).from('users').select('id, email').ilikeAnyOf('email', emails.map(escapeLikePattern))
    for (const row of (data ?? []) as any[]) memberIds.add(String(row.id))
  }
  for (const ref of out.values()) if (ref.userId) memberIds.add(ref.userId)
  if (memberIds.size) {
    const ids = [...memberIds]
    const active = new Set<string>()
    for (const part of chunk(ids)) {
      const { data } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).eq('is_active', true).in('user_id', part)
      for (const row of (data ?? []) as any[]) active.add(String(row.user_id))
    }
    const users = new Map<string, any>()
    for (const part of chunk([...active])) {
      const { data } = await (db as any).from('users').select('id, display_name, email').in('id', part)
      for (const row of (data ?? []) as any[]) users.set(String(row.id), row)
    }
    for (const [key, ref] of out) {
      if (ref.userId && !active.has(ref.userId)) out.set(key, { ...ref, userId: null, pending: true })
    }
    for (const id of active) {
      const user = users.get(id)
      if (!user || out.has(`u:${id}`)) continue
      out.set(`u:${id}`, { userId: id, displayName: user.display_name ?? null, email: user.email ?? null, externalId: null, claims: [], matchKeys: normaliseMatchKeys([user.email]), pending: false })
    }
    for (const ref of out.values()) {
      const user = ref.userId ? users.get(ref.userId) : null
      if (user && !ref.email) ref.email = user.email ?? null
    }
  }
  return [...out.values()]
}

export async function lookupDirectoryGroups(
  db: SupabaseClient,
  tenantId: string,
  sourceIds: string[],
  input: { teamIds?: string[]; externalIds?: string[] },
): Promise<DirectoryGroupRef[]> {
  if (!sourceIds.length) return []
  const teamIds = [...new Set(input.teamIds ?? [])].slice(0, 500)
  const externalIds = [...new Set(input.externalIds ?? [])].slice(0, 500)
  const links: any[] = []
  if (teamIds.length) links.push(...(((await (db as any).from('directory_links').select('external_id, local_id, display_name').eq('tenant_id', tenantId).in('provider', sourceIds).eq('object_type', 'group').in('local_id', teamIds)).data ?? []) as any[]))
  if (externalIds.length) links.push(...(((await (db as any).from('directory_links').select('external_id, local_id, display_name').eq('tenant_id', tenantId).in('provider', sourceIds).eq('object_type', 'group').in('external_id', externalIds)).data ?? []) as any[]))
  if (!links.length) return []
  const { data: teamRows } = await (db as any).from('teams').select('id, name, source_label').eq('tenant_id', tenantId).in('id', [...new Set(links.map((l) => String(l.local_id)))])
  const teams = new Map(((teamRows ?? []) as any[]).map((t) => [String(t.id), t]))
  const out = new Map<string, DirectoryGroupRef>()
  for (const link of links) {
    const team = teams.get(String(link.local_id))
    if (!team) continue
    out.set(String(link.local_id), { teamId: String(link.local_id), externalId: String(link.external_id), name: String(team.name ?? link.display_name ?? ''), label: team.source_label ?? null })
  }
  return [...out.values()]
}

/** Directory entries of a source for the admin list (pending first, then by name). */
export async function listDirectoryEntries(
  db: SupabaseClient,
  tenantId: string,
  sourceId: string,
  options: { status?: 'pending' | 'linked' | 'inactive' | null; search?: string | null; limit: number; offset: number },
): Promise<{ entries: any[]; total: number }> {
  let query = (db as any).from('directory_entries')
    .select('id, external_id, display_name, email, match_keys, claims, group_ids, active, local_user_id, claimed_at, last_seen_at', { count: 'exact' })
    .eq('tenant_id', tenantId).eq('source', sourceId)
  if (options.status === 'pending') query = query.eq('active', true).is('local_user_id', null)
  else if (options.status === 'linked') query = query.eq('active', true).not('local_user_id', 'is', null)
  else if (options.status === 'inactive') query = query.eq('active', false)
  if (options.search) query = query.ilike('display_name', `%${escapeLikePattern(options.search.trim())}%`)
  const { data, error, count } = await query.order('display_name').range(options.offset, options.offset + options.limit - 1)
  if (error) {
    if (migrationMissing(error)) throw new Error(`Directory sources need the database migration ${MIGRATION}`)
    throw new Error(error.message)
  }
  return {
    entries: ((data ?? []) as any[]).map((row) => ({
      id: String(row.id),
      external_id: String(row.external_id),
      display_name: row.display_name ?? null,
      email: row.email ?? null,
      match_keys: row.match_keys ?? [],
      claims: row.claims ?? [],
      group_ids: row.group_ids ?? [],
      status: !row.active ? 'inactive' : row.local_user_id ? 'linked' : 'pending',
      user_id: row.local_user_id ?? null,
      claimed_at: row.claimed_at ?? null,
      last_seen_at: row.last_seen_at ?? null,
    })),
    total: count ?? (data ?? []).length,
  }
}
