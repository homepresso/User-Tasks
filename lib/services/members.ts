/**
 * Workspace members: deactivating a member, and the facts the guards need
 * (who holds the Owner role, a member's live role permissions).
 *
 * Deactivating is the same step directory sync takes when a user leaves the
 * directory (lib/directory-sync/sync.ts revokeDirectoryAccess): the
 * membership is set inactive and the member's roles here are removed, so they
 * lose access at once (API keys and OAuth tokens included). The account is
 * never deleted and their work (tasks, submissions, history) stays; an admin
 * gives access back by inviting them again or through directory sync.
 *
 * Guards (on top of team.remove): never yourself, never the last owner, and
 * never someone who holds a permission you don't (an Admin can't deactivate
 * an Owner). Written to the governance log and the audit log.
 */

import { revokeDirectoryAccess } from '@/lib/directory-sync/sync'
import { expandPermissions } from '@/lib/permissions'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError } from './_shared'
import { userRolePermissions } from './roles'

/* eslint-disable @typescript-eslint/no-explicit-any -- user_memberships / user_roles are not in the generated types */

export interface MemberSummary {
  id: string
  display_name: string | null
  email: string | null
  active: boolean
  roles: Array<{ id: string; name: string; slug: string | null; is_system: boolean }>
}

/** A user of this workspace with their membership state and roles (null: not a member). */
export async function loadMember(ctx: ServiceContext, userId: string): Promise<MemberSummary | null> {
  const db = ctx.supabase as any
  const [{ data: user, error }, { data: membership }, { data: assignments }] = await Promise.all([
    db.from('users').select('id, display_name, email').eq('id', userId).maybeSingle(),
    db.from('user_memberships').select('user_id, is_active').eq('tenant_id', ctx.tenantId).eq('user_id', userId).maybeSingle(),
    db.from('user_roles').select('role_id, role:roles(id, name, slug, is_system)').eq('tenant_id', ctx.tenantId).eq('user_id', userId),
  ])
  if (error) throw dbError(error)
  if (!user || !membership) return null
  const rows = (assignments ?? []) as any[]
  // Clients that don't embed (test doubles) fall back to a direct lookup.
  const missing = rows.filter((a) => !(Array.isArray(a.role) ? a.role[0] : a.role)).map((a) => String(a.role_id))
  const looked = new Map<string, any>()
  if (missing.length) {
    const { data } = await db.from('roles').select('id, name, slug, is_system').eq('tenant_id', ctx.tenantId).in('id', missing)
    for (const r of (data ?? []) as any[]) looked.set(String(r.id), r)
  }
  const roles = rows.map((a) => {
    const r = (Array.isArray(a.role) ? a.role[0] : a.role) ?? looked.get(String(a.role_id))
    return { id: String(r?.id ?? a.role_id), name: String(r?.name ?? 'Role'), slug: r?.slug ?? null, is_system: r?.is_system === true }
  })
  return { id: String(user.id), display_name: user.display_name ?? null, email: user.email ?? null, active: membership.is_active !== false, roles }
}

/** The Owner system role's id in this workspace (null when missing). */
export async function ownerRoleId(ctx: ServiceContext): Promise<string | null> {
  const { data } = await (ctx.supabase as any).from('roles').select('id').eq('tenant_id', ctx.tenantId).eq('slug', 'owner').eq('is_system', true).maybeSingle()
  return data?.id ? String(data.id) : null
}

/** Active members holding the Owner role. */
export async function activeOwnerIds(ctx: ServiceContext): Promise<string[]> {
  const roleId = await ownerRoleId(ctx)
  if (!roleId) return []
  const db = ctx.supabase as any
  const { data: holders } = await db.from('user_roles').select('user_id').eq('tenant_id', ctx.tenantId).eq('role_id', roleId)
  const ids = [...new Set(((holders ?? []) as any[]).map((h) => String(h.user_id)))]
  if (!ids.length) return []
  const { data: active } = await db.from('user_memberships').select('user_id, is_active').eq('tenant_id', ctx.tenantId).in('user_id', ids)
  const activeIds = new Set(((active ?? []) as any[]).filter((m) => m.is_active !== false).map((m) => String(m.user_id)))
  return ids.filter((id) => activeIds.has(id))
}

/** Permissions `userId` holds through their roles here (implied ones included). */
export async function memberPermissions(ctx: ServiceContext, userId: string): Promise<Set<string>> {
  return new Set(expandPermissions(await userRolePermissions(ctx, userId)))
}

/** Permissions in `theirs` the acting person does not hold (empty: they don't outrank the actor). */
export function permissionsBeyond(actor: ReadonlySet<string> | null, theirs: Iterable<string>): string[] {
  if (!actor) return []
  const own = new Set(expandPermissions(actor))
  return [...new Set(theirs)].filter((p) => !own.has(p)).sort()
}

/** Deactivate a member (team.remove): membership inactive, roles removed. See the header for the guards. */
export async function deactivateMember(ctx: ServiceContext, userId: string) {
  requirePerm(ctx, 'team.remove')
  if (ctx.actorId && userId === ctx.actorId) throw ServiceError.validation('You can\'t deactivate yourself')
  const member = await loadMember(ctx, userId)
  if (!member) throw ServiceError.notFound('That person is not a member of this workspace')
  if (!member.active) return { deactivated: false as const, already_inactive: true as const, user_id: userId }
  const owners = await activeOwnerIds(ctx)
  if (owners.includes(userId) && owners.length <= 1) throw ServiceError.conflict('This is the workspace\'s last owner — make someone else an owner first')
  const beyond = permissionsBeyond(ctx.permissions, await memberPermissions(ctx, userId))
  if (beyond.length) throw ServiceError.forbidden(`${member.display_name || member.email || 'This person'} holds permissions you don't (${beyond.slice(0, 5).join(', ')}${beyond.length > 5 ? '…' : ''}) — only someone with at least their access can deactivate them`)

  await revokeDirectoryAccess(ctx.supabase as any, ctx.tenantId, [userId])
  const actorId = ctx.actorId ?? ctx.credentialOwnerId ?? null
  if (actorId) {
    try {
      await (ctx.supabase as any).from('permission_audit_log').insert({
        tenant_id: ctx.tenantId, actor_id: actorId, action: 'member_deactivated', target_user_id: userId, role_id: null,
        details: { email: member.email, roles_removed: member.roles.map((r) => r.name) },
      })
    } catch (error) {
      console.warn('[members] permission_audit_log insert failed:', error)
    }
  }
  await audit(ctx, {
    objectType: 'member', objectId: userId, action: 'revoke',
    summary: `Deactivated ${member.email || member.display_name || userId}`,
    metadata: { roles_removed: member.roles.map((r) => r.name) },
  })
  return { deactivated: true as const, user_id: userId, roles_removed: member.roles.map((r) => r.name) }
}
