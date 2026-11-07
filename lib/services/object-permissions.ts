/**
 * Explicit grants on objects (object_permissions): list, set (add or change
 * one grantee's grant) and remove. Shared by the ObjectPermissions panel
 * (server actions in app/actions/object-permissions), GET/POST/DELETE
 * /api/v1/object-permissions and the MCP object_permissions_* tools.
 *
 * Managing grants needs team.change_roles on every surface. Every change is
 * written to the object audit log on the object (`grant` / `revoke`, with the
 * grantee and the granted columns), so a form's access history sits next to
 * its other changes. The object must exist in the caller's workspace, and the
 * grantee (role, team or person) must belong to it too.
 */

import {
  describeGrant, grantColumns, isObjectPermissionType, OBJECT_PERMISSION_META, OBJECT_PERMISSION_TYPES,
  type ObjectPermissionType,
} from '@/lib/object-permission-types'
import type { AuditObjectType } from '@/lib/audit-log'
import { getDb, requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped tables */

const COLUMNS = 'id, object_type, object_id, role_id, user_id, team_id, can_view, can_edit, can_delete, can_execute, granted_by, created_at, updated_at'
const EMBEDS = 'role:roles(id, name, slug), user:users!object_permissions_user_id_fkey(id, display_name, email), team:teams!object_permissions_team_id_fkey(id, name)'

export interface GrantInput {
  object_type: string
  object_id: string
  role_id?: string | null
  user_id?: string | null
  team_id?: string | null
  can_view?: boolean
  can_edit?: boolean
  can_delete?: boolean
  can_execute?: boolean
}

function checkType(type: unknown): ObjectPermissionType {
  if (!isObjectPermissionType(type)) throw ServiceError.validation(`object_type must be one of: ${OBJECT_PERMISSION_TYPES.join(', ')}`)
  return type
}

async function loadObject(ctx: ServiceContext, type: ObjectPermissionType, id: string): Promise<{ id: string; name: string }> {
  if (!String(id ?? '').trim()) throw ServiceError.validation('object_id is required')
  const { data, error } = await (getDb(ctx) as any).from(OBJECT_PERMISSION_META[type].table).select('id, name')
    .eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound(`${OBJECT_PERMISSION_META[type].label} not found`)
  return { id: String(data.id), name: String(data.name ?? data.id) }
}

async function grantee(ctx: ServiceContext, input: { role_id?: string | null; user_id?: string | null; team_id?: string | null }) {
  const given = (['role_id', 'team_id', 'user_id'] as const).filter((k) => String(input[k] ?? '').trim())
  if (given.length !== 1) throw ServiceError.validation('Give exactly one of role_id, team_id or user_id')
  const column = given[0]
  const id = String(input[column]).trim()
  const db = getDb(ctx) as any
  const kind = column === 'role_id' ? 'role' : column === 'team_id' ? 'team' : 'user'
  const query = kind === 'role' ? db.from('roles').select('id, name').eq('tenant_id', ctx.tenantId).eq('id', id)
    : kind === 'team' ? db.from('teams').select('id, name').eq('tenant_id', ctx.tenantId).eq('id', id)
      // A person in the workspace: a member of it (user_roles) or whose home workspace it is.
      : db.from('users').select('id, display_name, email, tenant_id').eq('id', id)
  const { data, error } = await query.maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound(`${kind[0].toUpperCase()}${kind.slice(1)} not found`)
  if (kind === 'user' && data.tenant_id !== ctx.tenantId) {
    const { data: member } = await db.from('user_roles').select('id').eq('tenant_id', ctx.tenantId).eq('user_id', id).limit(1)
    if (!member?.length) throw ServiceError.notFound('User not found')
  }
  return { column, id, kind, name: String(data.name ?? data.display_name ?? data.email ?? id) }
}

function auditType(type: ObjectPermissionType): AuditObjectType {
  return type as AuditObjectType
}

/** Grants on one object, with the role / team / person they name. */
export async function listObjectPermissions(ctx: ServiceContext, objectType: string, objectId: string) {
  requirePerm(ctx, 'team.change_roles')
  const type = checkType(objectType)
  const { data, error } = await (getDb(ctx) as any).from('object_permissions').select(`${COLUMNS}, ${EMBEDS}`)
    .eq('tenant_id', ctx.tenantId).eq('object_type', type).eq('object_id', objectId).order('created_at')
  if (error) throw dbError(error)
  return (data ?? []) as Array<Record<string, any>>
}

/**
 * Add or change one grantee's grant on an object. Columns a type does not use
 * (forms: Edit, Delete) are stored false. Returns the grant row.
 */
export async function setObjectPermission(ctx: ServiceContext, input: GrantInput) {
  requirePerm(ctx, 'team.change_roles')
  const type = checkType(input?.object_type)
  const object = await loadObject(ctx, type, String(input.object_id ?? '').trim())
  const who = await grantee(ctx, input)
  const used = new Set(grantColumns(type))
  const flags = {
    can_view: used.has('can_view') && input.can_view !== false,
    can_edit: used.has('can_edit') && Boolean(input.can_edit),
    can_delete: used.has('can_delete') && Boolean(input.can_delete),
    can_execute: used.has('can_execute') && Boolean(input.can_execute),
  }
  const db = getDb(ctx) as any
  const { data: existing, error: findError } = await db.from('object_permissions').select(COLUMNS)
    .eq('tenant_id', ctx.tenantId).eq('object_type', type).eq('object_id', object.id).eq(who.column, who.id).maybeSingle()
  if (findError) throw dbError(findError)
  const write = existing
    ? db.from('object_permissions').update({ ...flags, granted_by: ctx.actorId, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('tenant_id', ctx.tenantId)
    : db.from('object_permissions').insert({ tenant_id: ctx.tenantId, object_type: type, object_id: object.id, [who.column]: who.id, ...flags, granted_by: ctx.actorId })
  const { data, error } = await write.select(COLUMNS).single()
  if (error) throw dbError(error, 'Failed to save the grant')
  const before = existing ? describeGrant(type, existing) : null
  const after = describeGrant(type, flags)
  if (before !== after) {
    await audit(ctx, {
      objectType: auditType(type), objectId: object.id, action: 'grant',
      summary: existing
        ? `Changed ${who.kind} "${who.name}" on ${OBJECT_PERMISSION_META[type].label.toLowerCase()} "${object.name}" from ${before} to ${after}`
        : `Gave ${who.kind} "${who.name}" ${after} on ${OBJECT_PERMISSION_META[type].label.toLowerCase()} "${object.name}"`,
      metadata: {
        grantee_type: who.kind, grantee_id: who.id, grantee_name: who.name, ...flags,
        ...(existing ? { before: { can_view: existing.can_view, can_edit: existing.can_edit, can_delete: existing.can_delete, can_execute: existing.can_execute } } : {}),
      },
    })
  }
  return data as Record<string, any>
}

async function describeRow(ctx: ServiceContext, row: Record<string, any>) {
  const db = getDb(ctx) as any
  const kind = row.role_id ? 'role' : row.team_id ? 'team' : 'user'
  const id = row.role_id ?? row.team_id ?? row.user_id
  const { data } = kind === 'role' ? await db.from('roles').select('name').eq('id', id).maybeSingle()
    : kind === 'team' ? await db.from('teams').select('name').eq('id', id).maybeSingle()
      : await db.from('users').select('display_name, email').eq('id', id).maybeSingle()
  return { kind, id: String(id), name: String(data?.name ?? data?.display_name ?? data?.email ?? id) }
}

/** Remove one grant (by its id). */
export async function removeObjectPermission(ctx: ServiceContext, grantId: string) {
  requirePerm(ctx, 'team.change_roles')
  const db = getDb(ctx) as any
  const { data: row, error } = await db.from('object_permissions').select(COLUMNS).eq('tenant_id', ctx.tenantId).eq('id', grantId).maybeSingle()
  if (error) throw dbError(error)
  if (!row) throw ServiceError.notFound('Grant not found')
  const { error: deleteError } = await db.from('object_permissions').delete().eq('tenant_id', ctx.tenantId).eq('id', grantId)
  if (deleteError) throw dbError(deleteError)
  const type = checkType(row.object_type)
  const who = await describeRow(ctx, row)
  const object = await loadObject(ctx, type, row.object_id).catch(() => ({ id: String(row.object_id), name: String(row.object_id) }))
  await audit(ctx, {
    objectType: auditType(type), objectId: String(row.object_id), action: 'revoke',
    summary: `Removed ${who.kind} "${who.name}" from ${OBJECT_PERMISSION_META[type].label.toLowerCase()} "${object.name}"`,
    metadata: { grantee_type: who.kind, grantee_id: who.id, grantee_name: who.name },
  })
  return { deleted: true as const, id: grantId }
}

/** Remove every grant on an object ("Reset to open"). */
export async function removeAllObjectPermissions(ctx: ServiceContext, objectType: string, objectId: string) {
  requirePerm(ctx, 'team.change_roles')
  const type = checkType(objectType)
  const object = await loadObject(ctx, type, objectId)
  const { count, error } = await (getDb(ctx) as any).from('object_permissions').delete({ count: 'exact' })
    .eq('tenant_id', ctx.tenantId).eq('object_type', type).eq('object_id', object.id)
  if (error) throw dbError(error)
  if (count) {
    await audit(ctx, {
      objectType: auditType(type), objectId: object.id, action: 'revoke',
      summary: `Removed all ${count} grant${count === 1 ? '' : 's'} on ${OBJECT_PERMISSION_META[type].label.toLowerCase()} "${object.name}"`,
      metadata: { removed: count },
    })
  }
  return { deleted: count ?? 0 }
}
