/**
 * Who may change the design of one workflow or form: the role permission
 * (workflows.edit / forms.edit) as everywhere, OR an explicit Edit grant on
 * that object (object_permissions.can_edit, naming the person, a role they
 * hold or a team they are in — the grants of the object's Access panel).
 *
 * The grant covers the designer's own work on that one object: saving the
 * draft, restoring a version into it, and test runs of the draft. It does
 * NOT cover publishing / activating (workflows.activate, the form's publish),
 * deleting, creating other objects, or anything the role doesn't allow
 * elsewhere. It applies to people signed in (session) only: API keys and
 * OAuth tokens keep exactly their scopes.
 *
 * This lets an outside authority delegate one object — e.g. "Follow
 * SharePoint permissions": a list manager in SharePoint gets an Edit grant on
 * the workflows and forms bound to their list — without a workspace-wide role.
 */

import type { ObjectPermissionType } from '@/lib/object-permission-types'
import { getDb, hasPerm, ServiceError, type ServiceContext } from './context'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped tables */

export type DesignObjectType = Extract<ObjectPermissionType, 'workflow' | 'form'>

export const DESIGN_PERMISSION: Record<DesignObjectType, string> = { workflow: 'workflows.edit', form: 'forms.edit' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Does `userId` hold an explicit `can_edit` grant on the object (directly,
 * through a role they hold in the workspace, or a team of the workspace)?
 */
export async function holdsEditGrant(db: any, tenantId: string, userId: string, objectType: DesignObjectType, objectId: string): Promise<boolean> {
  if (!UUID.test(objectId) || !UUID.test(userId)) return false
  const [grants, roles, teams] = await Promise.all([
    db.from('object_permissions').select('user_id, role_id, team_id')
      .eq('tenant_id', tenantId).eq('object_type', objectType).eq('object_id', objectId).eq('can_edit', true),
    db.from('user_roles').select('role_id').eq('tenant_id', tenantId).eq('user_id', userId),
    db.from('user_teams').select('team_id').eq('user_id', userId),
  ])
  for (const r of [grants, roles, teams]) if (r.error) throw new ServiceError('internal', 'Failed to load the object grants')
  const rows = (grants.data ?? []) as any[]
  if (!rows.length) return false
  if (rows.some((g) => g.user_id === userId)) return true
  const roleIds = new Set(((roles.data ?? []) as any[]).map((r) => r.role_id).filter(Boolean))
  if (rows.some((g) => g.role_id && roleIds.has(g.role_id))) return true
  const teamIds = ((teams.data ?? []) as any[]).map((t) => String(t.team_id)).filter(Boolean)
  const granted = rows.map((g) => g.team_id && String(g.team_id)).filter((id): id is string => Boolean(id) && teamIds.includes(id))
  if (!granted.length) return false
  // Teams of this workspace only (user_teams has no tenant column).
  const { data, error } = await db.from('teams').select('id').eq('tenant_id', tenantId).in('id', granted)
  if (error) throw new ServiceError('internal', 'Failed to load teams')
  return ((data ?? []) as any[]).length > 0
}

/** May the caller change the design of this object (role permission, or an Edit grant on it when signed in)? */
export async function canDesignObject(ctx: ServiceContext, objectType: DesignObjectType, objectId: string): Promise<boolean> {
  if (hasPerm(ctx, DESIGN_PERMISSION[objectType])) return true
  if (ctx.authKind !== 'session' || !ctx.actorId || !ctx.tenantId) return false
  return holdsEditGrant(getDb(ctx), ctx.tenantId, ctx.actorId, objectType, objectId)
}

/** Throw 403 unless canDesignObject. */
export async function requireDesignAccess(ctx: ServiceContext, objectType: DesignObjectType, objectId: string): Promise<void> {
  if (await canDesignObject(ctx, objectType, objectId)) return
  throw ServiceError.forbidden(`Forbidden: you lack the '${DESIGN_PERMISSION[objectType]}' permission (or an Edit grant on this ${objectType})`)
}
