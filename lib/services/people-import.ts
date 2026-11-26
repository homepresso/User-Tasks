/**
 * Organization → Import people: pick a source (a connected Entra ID / Okta /
 * Google Workspace / LDAP-AD directory, or a CSV — the CSV path is the
 * existing org import, lib/services/org-import.ts), preview the people and
 * groups (read-only, lib/directory-sync/preview.ts), select people or groups,
 * then either
 *  - invite: one-off invitations for the selected people, with a role
 *    (lib/services/invitations.ts sendInvitation, so the same checks, email
 *    and audit apply), or
 *  - keep in sync: save the selected groups as the connection's group scope
 *    (lib/directory-sync/scope.ts), turn on group sync and provisioning, and
 *    start a full sync.
 *
 * Permissions (server side, every call): sources — team.invite or
 * settings.edit; preview — the same; invite — team.invite, plus
 * team.change_roles for the admin role (owners are never invited from here);
 * keep in sync — settings.edit (the directory admin permission). Selected
 * people are re-read from the directory on the server: a client's emails are
 * never trusted. There is no workspace seat limit in the core licence (licence
 * limits are per extension), so the only cap is MAX_INVITES_PER_IMPORT per
 * request. Each invite / sync action is audited (directory_sync).
 */

import { directoryClientFor } from '@/lib/directory-sync/sync'
import { DIRECTORY_PROVIDER_LABELS, getDirectoryConnection } from '@/lib/directory-sync/connection'
import { previewDirectory, type DirectoryPreview } from '@/lib/directory-sync/preview'
import { MAX_SCOPE_GROUPS, scopeGroupIds } from '@/lib/directory-sync/scope'
import { DIRECTORY_PROVIDERS, isDirectoryProvider, type DirectoryClient, type DirectoryProvider } from '@/lib/directory-sync/types'
import { escapeLikePattern } from '@/lib/utils'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, serviceRoleClient } from './_shared'
import { sendInvitation } from './invitations'
import { startDirectorySyncRun, updateDirectoryConnection } from './directory-sync'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role rows */

export const MAX_INVITES_PER_IMPORT = 200
export const IMPORT_INVITE_ROLES = ['viewer', 'member', 'manager', 'admin'] as const
export type ImportInviteRole = (typeof IMPORT_INVITE_ROLES)[number]

/** Seams for tests (mocked directory clients; never a real directory). */
export const peopleImportDeps = {
  clientFor: (db: AnySupabaseClient, tenantId: string, provider: DirectoryProvider): Promise<DirectoryClient> => directoryClientFor(db as any, tenantId, provider),
  db: (ctx: ServiceContext): Promise<AnySupabaseClient> => serviceRoleClient(ctx),
  invite: sendInvitation,
  updateConnection: updateDirectoryConnection,
  startSync: startDirectorySyncRun,
}

export interface ImportSource {
  provider: DirectoryProvider
  label: string
  org_name: string | null
  scope_group_ids: string[]
  sync_groups: boolean
  auto_provision: boolean
  last_sync_at: string | null
}

export type PreviewStatus = 'new' | 'member' | 'invited' | 'no_email' | 'inactive'

export interface PeopleImportPreview extends Omit<DirectoryPreview, 'users'> {
  provider: DirectoryProvider
  users: Array<DirectoryPreview['users'][number] & { status: PreviewStatus }>
  scope_group_ids: string[]
}

function requireImportAccess(ctx: ServiceContext): void {
  if (!hasPerm(ctx, 'team.invite') && !hasPerm(ctx, 'settings.edit')) requirePerm(ctx, 'team.invite')
}

function parseProvider(raw: unknown): DirectoryProvider {
  if (!isDirectoryProvider(raw)) throw ServiceError.validation(`provider must be one of: ${DIRECTORY_PROVIDERS.join(', ')}`)
  return raw
}

function cleanIds(raw: unknown, max: number, label: string): string[] {
  if (!Array.isArray(raw)) throw ServiceError.validation(`${label} must be an array`)
  const ids = [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= 512).map((v) => v.trim()))]
  if (ids.length > max) throw ServiceError.validation(`At most ${max} ${label} at a time`)
  return ids
}

/** The connected pull directories this workspace can import from (CSV is always available). */
export async function listImportSources(ctx: ServiceContext): Promise<{ sources: ImportSource[] }> {
  requireImportAccess(ctx)
  const db = await peopleImportDeps.db(ctx)
  const sources: ImportSource[] = []
  for (const provider of DIRECTORY_PROVIDERS) {
    const connection = await getDirectoryConnection(db as any, ctx.tenantId, provider)
    if (!connection?.isEnabled) continue
    sources.push({
      provider, label: DIRECTORY_PROVIDER_LABELS[provider], org_name: connection.orgName,
      scope_group_ids: scopeGroupIds(connection.settings), sync_groups: connection.syncGroups,
      auto_provision: connection.autoProvision, last_sync_at: connection.lastSyncAt,
    })
  }
  return { sources }
}

async function withClient<T>(ctx: ServiceContext, provider: DirectoryProvider, fn: (client: DirectoryClient, db: AnySupabaseClient) => Promise<T>): Promise<T> {
  const db = await peopleImportDeps.db(ctx)
  const connection = await getDirectoryConnection(db as any, ctx.tenantId, provider)
  if (!connection?.isEnabled) throw ServiceError.notFound(`${DIRECTORY_PROVIDER_LABELS[provider]} is not connected`)
  let client: DirectoryClient
  try {
    client = await peopleImportDeps.clientFor(db, ctx.tenantId, provider)
  } catch (error) {
    throw ServiceError.validation(`Could not reach ${DIRECTORY_PROVIDER_LABELS[provider]}: ${(error as Error).message}`)
  }
  try {
    return await fn(client, db)
  } finally {
    await client.close?.().catch(() => undefined)
  }
}

/** Emails already in this workspace (active members) and with a pending invitation. */
async function workspaceStatus(db: AnySupabaseClient, tenantId: string, emails: string[]): Promise<{ members: Set<string>; invited: Set<string> }> {
  const members = new Set<string>()
  const invited = new Set<string>()
  for (let i = 0; i < emails.length; i += 200) {
    const batch = emails.slice(i, i + 200)
    const { data: users } = await (db as any).from('users').select('id, email').ilikeAnyOf('email', batch.map((e) => escapeLikePattern(e)))
    const byId = new Map<string, string>(((users ?? []) as any[]).filter((u) => u?.email).map((u) => [String(u.id), String(u.email).toLowerCase()]))
    if (byId.size) {
      const { data: memberships } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).eq('is_active', true).in('user_id', [...byId.keys()])
      for (const m of (memberships ?? []) as any[]) { const email = byId.get(String(m.user_id)); if (email) members.add(email) }
    }
    const { data: invites } = await (db as any).from('invitations').select('email').eq('tenant_id', tenantId).is('accepted_at', null).in('email', batch)
    for (const inv of (invites ?? []) as any[]) if (inv?.email) invited.add(String(inv.email).toLowerCase())
  }
  return { members, invited }
}

/** Read-only: the people (and groups) a directory would bring in, each with its status here. */
export async function previewPeopleImport(ctx: ServiceContext, input: { provider: unknown; group_ids?: unknown }): Promise<PeopleImportPreview> {
  requireImportAccess(ctx)
  const provider = parseProvider(input.provider)
  const groupIds = input.group_ids === undefined ? [] : cleanIds(input.group_ids, MAX_SCOPE_GROUPS, 'groups')
  return withClient(ctx, provider, async (client, db) => {
    const preview = await previewDirectory(client, { groupIds })
    const emails = [...new Set(preview.users.map((u) => u.email).filter((e): e is string => Boolean(e)))]
    const { members, invited } = await workspaceStatus(db, ctx.tenantId, emails)
    const connection = await getDirectoryConnection(db as any, ctx.tenantId, provider)
    return {
      ...preview,
      provider,
      scope_group_ids: scopeGroupIds(connection?.settings),
      users: preview.users.map((u) => ({
        ...u,
        status: !u.active ? 'inactive' : !u.email ? 'no_email' : members.has(u.email) ? 'member' : invited.has(u.email) ? 'invited' : 'new',
      })),
    }
  })
}

export interface InviteResult {
  invited: string[]
  skipped: Array<{ external_id: string; email: string | null; reason: string }>
  email_failures: number
}

/**
 * One-off invitations for the selected directory people (by externalId),
 * with a role. Emails come from the directory, re-read here; members,
 * pending invitations, inactive people and people without an email are
 * skipped with a reason.
 */
export async function invitePeopleFromDirectory(ctx: ServiceContext, input: { provider: unknown; external_ids: unknown; role?: unknown }): Promise<InviteResult> {
  requirePerm(ctx, 'team.invite')
  const provider = parseProvider(input.provider)
  const role = (input.role ?? 'member') as ImportInviteRole
  if (!IMPORT_INVITE_ROLES.includes(role)) throw ServiceError.validation(`role must be one of: ${IMPORT_INVITE_ROLES.join(', ')}`)
  if (role === 'admin') requirePerm(ctx, 'team.change_roles')
  const ids = cleanIds(input.external_ids, MAX_INVITES_PER_IMPORT, 'people')
  if (!ids.length) throw ServiceError.validation('Select at least one person')

  return withClient(ctx, provider, async (client, db) => {
    const wanted = new Set(ids)
    const found = new Map((await client.listUsers()).filter((u) => wanted.has(u.externalId)).map((u) => [u.externalId, u]))
    const emails = [...found.values()].map((u) => u.email?.toLowerCase()).filter((e): e is string => Boolean(e))
    const { members, invited } = await workspaceStatus(db, ctx.tenantId, [...new Set(emails)])
    const result: InviteResult = { invited: [], skipped: [], email_failures: 0 }
    const sentNow = new Set<string>()
    for (const id of ids) {
      const user = found.get(id)
      const email = user?.email?.toLowerCase() ?? null
      const skip = (reason: string) => result.skipped.push({ external_id: id, email, reason })
      if (!user) { skip('Not found in the directory'); continue }
      if (!user.active) { skip('Inactive in the directory'); continue }
      if (!email) { skip('No email address in the directory'); continue }
      if (members.has(email)) { skip('Already a member'); continue }
      if (invited.has(email) || sentNow.has(email)) { skip('Already invited'); continue }
      try {
        const sent = await peopleImportDeps.invite(ctx, { email, role })
        sentNow.add(email)
        result.invited.push(email)
        if (!sent.email_sent) result.email_failures++
      } catch (error) {
        skip((error as Error).message || 'Could not invite')
      }
    }
    await audit(ctx, {
      objectType: 'directory_sync', objectId: provider, action: 'import_invite',
      summary: `Invited ${result.invited.length} ${result.invited.length === 1 ? 'person' : 'people'} from ${DIRECTORY_PROVIDER_LABELS[provider]} as ${role}`,
      metadata: { provider, role, invited: result.invited.length, skipped: result.skipped.length, requested: ids.length },
    })
    return result
  })
}

/**
 * Keep in sync: the selected groups become the connection's group scope
 * (empty = no scope: everyone), group sync and provisioning are turned on, and
 * a full sync starts. settings.edit.
 */
export async function keepPeopleInSync(ctx: ServiceContext, input: { provider: unknown; group_ids: unknown }): Promise<{ run_id: string; already_running: boolean; scope_group_ids: string[] }> {
  requirePerm(ctx, 'settings.edit')
  const provider = parseProvider(input.provider)
  const groupIds = cleanIds(input.group_ids, MAX_SCOPE_GROUPS, 'groups')
  // The groups must exist in the directory (a typo would scope the sync to nobody).
  if (groupIds.length) {
    await withClient(ctx, provider, async (client) => {
      const known = new Set((await client.listGroups()).map((g) => g.externalId))
      const unknown = groupIds.filter((id) => !known.has(id))
      if (unknown.length) throw ServiceError.validation(`Unknown directory group${unknown.length === 1 ? '' : 's'}: ${unknown.slice(0, 5).join(', ')}`)
    })
  }
  await peopleImportDeps.updateConnection(ctx, provider, {
    settings: { scope_group_ids: groupIds.length ? groupIds : null },
    sync_groups: true,
    auto_provision: true,
  })
  const run = await peopleImportDeps.startSync(ctx, provider, { full: true })
  await audit(ctx, {
    objectType: 'directory_sync', objectId: provider, action: 'import_sync',
    summary: groupIds.length
      ? `Keeping ${groupIds.length} ${DIRECTORY_PROVIDER_LABELS[provider]} group${groupIds.length === 1 ? '' : 's'} in sync`
      : `Keeping everyone in ${DIRECTORY_PROVIDER_LABELS[provider]} in sync`,
    metadata: { provider, scope_group_ids: groupIds, run_id: run.run_id },
  })
  return { ...run, scope_group_ids: groupIds }
}
