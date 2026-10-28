import { z } from 'zod'
import { getDb, requirePerm, ServiceError, type ServiceContext } from '@/lib/services/context'
import { dbError } from '@/lib/services/_shared'
import { BULK_DELETE_TYPES, bulkDeletePermission, bulkQueueDeletion, MAX_BULK_IDS, type BulkDeleteType } from '@/lib/services/bulk-delete'
import * as references from '@/lib/services/references'
import * as apiKeys from '@/lib/services/api-keys'
import * as activities from '@/lib/services/workflow-activities'
import * as roles from '@/lib/services/roles'
import * as connectors from '@/lib/services/connectors'
import { invalidateDataTableTriggerCache } from '@/lib/data-table-workflow-triggers'
import { defineJobKind } from '../define'

/*
 * Bulk actions from list selection bars: delete, activate / deactivate,
 * object permissions, add tag, role assignment, connector reference
 * regeneration. Each wraps the service the server action used (or its
 * set-based replacement, lib/services/bulk-delete) with the same permission.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

const uuid = z.string().uuid()
const ids = z.array(uuid).min(1).max(MAX_BULK_IDS)

const OTHER_DELETE_TYPES = ['workflow_activity', 'reference', 'api_key'] as const
type DeleteType = BulkDeleteType | (typeof OTHER_DELETE_TYPES)[number]

const NOUNS: Record<DeleteType, [string, string]> = {
  workflow: ['workflow', 'workflows'],
  data_table: ['data table', 'data tables'],
  data_row: ['row', 'rows'],
  decision_table: ['business rule', 'business rules'],
  agent: ['agent', 'agents'],
  report: ['report', 'reports'],
  retention_policy: ['retention policy', 'retention policies'],
  workflow_activity: ['workflow activity', 'workflow activities'],
  reference: ['reference', 'references'],
  api_key: ['API key', 'API keys'],
}

const plural = (type: DeleteType, n: number) => `${n} ${NOUNS[type][n === 1 ? 0 : 1]}`

function deletePermission(type: DeleteType): string {
  if (type === 'workflow_activity') return 'extensibility.delete'
  if (type === 'reference') return 'integrations.manage_references'
  if (type === 'api_key') return 'settings.manage_api_keys'
  return bulkDeletePermission(type)
}

export const bulkDeleteJob = defineJobKind({
  kind: 'bulk.delete',
  effect: 'change',
  params: z.object({ type: z.enum([...BULK_DELETE_TYPES, ...OTHER_DELETE_TYPES]), ids }),
  title: (p) => `Delete ${plural(p.type, p.ids.length)}`,
  authorize: (ctx, p) => requirePerm(ctx, deletePermission(p.type)),
  async run({ ctx, params, progress }) {
    const { type } = params
    if (type === 'workflow_activity') {
      const r = await activities.bulkDeleteWorkflowActivities(ctx, params.ids)
      return { counts: { queued: r.deleted } as Record<string, number>, summary: `${plural(type, r.deleted)} queued for deletion` }
    }
    if (type === 'reference') {
      const r = await references.bulkDeleteReferences(ctx, params.ids)
      return { counts: { deleted: r.deleted }, summary: `${plural(type, r.deleted)} deleted` }
    }
    if (type === 'api_key') {
      let deleted = 0
      for (let i = 0; i < params.ids.length; i += 500) deleted += (await apiKeys.deleteApiKeys(ctx, params.ids.slice(i, i + 500))).deleted
      return { counts: { deleted }, summary: `${plural(type, deleted)} deleted` }
    }
    const r = await bulkQueueDeletion(ctx, type, params.ids, { onProgress: (done, total) => progress((done / total) * 100, `${done} of ${total}`) })
    const extra = [r.missing ? `${r.missing} not found` : '', r.blocked.length ? `${r.blocked.length} still in use` : ''].filter(Boolean).join(', ')
    return {
      counts: { queued: r.queued, missing: r.missing, blocked: r.blocked.length },
      data: r,
      summary: `${plural(type, r.queued)} queued for deletion${extra ? ` (${extra})` : ''}`,
    }
  },
})

/** Activate / deactivate workflows (no publish), as the list's bulk buttons always did. */
export async function setWorkflowsActive(ctx: ServiceContext, workflowIds: string[], active: boolean) {
  requirePerm(ctx, 'workflows.activate')
  const { data, error } = await (getDb(ctx) as any).from('workflows').update({ is_active: active })
    .eq('tenant_id', ctx.tenantId).in('id', workflowIds).select('id')
  if (error) throw dbError(error)
  invalidateDataTableTriggerCache()
  return { updated: (data ?? []).length }
}

export const workflowsSetActiveJob = defineJobKind({
  kind: 'workflows.set_active',
  effect: 'change',
  params: z.object({ ids, active: z.boolean() }),
  title: (p) => `${p.active ? 'Activate' : 'Deactivate'} ${p.ids.length} workflow${p.ids.length === 1 ? '' : 's'}`,
  authorize: (ctx) => requirePerm(ctx, 'workflows.activate'),
  async run({ ctx, params }) {
    const { updated } = await setWorkflowsActive(ctx, params.ids, params.active)
    return { counts: { updated }, summary: `${updated} workflow${updated === 1 ? '' : 's'} ${params.active ? 'activated' : 'deactivated'}` }
  },
})

const OBJECT_TABLES: Record<string, string> = { workflow: 'workflows', data_table: 'custom_tables' }

/**
 * Grant one role / team / user the same object permissions on many objects
 * (bulk-permissions dialog). Objects, and the grantee, must belong to the
 * workspace; existing grants are updated, the rest inserted, per batch.
 */
export async function bulkSetObjectPermissions(ctx: ServiceContext, input: {
  objectType: string; objectIds: string[]; roleId?: string | null; teamId?: string | null; userId?: string | null
  canView: boolean; canEdit: boolean; canDelete: boolean; canExecute: boolean
}, onProgress?: (done: number, total: number) => Promise<void>) {
  requirePerm(ctx, 'team.change_roles')
  const db = getDb(ctx) as any
  const table = OBJECT_TABLES[input.objectType]
  if (!table) throw ServiceError.validation(`Unsupported object type "${input.objectType}"`)
  const [matchCol, matchVal] = input.roleId ? ['role_id', input.roleId] : input.teamId ? ['team_id', input.teamId] : ['user_id', input.userId]
  if (!matchVal) throw ServiceError.validation('Choose a role, team or user')
  const grantee = matchCol === 'role_id'
    ? await db.from('roles').select('id').eq('tenant_id', ctx.tenantId).eq('id', matchVal).maybeSingle()
    : matchCol === 'team_id'
      ? await db.from('teams').select('id').eq('tenant_id', ctx.tenantId).eq('id', matchVal).maybeSingle()
      : await db.from('users').select('id').eq('tenant_id', ctx.tenantId).eq('id', matchVal).maybeSingle()
  if (!grantee.data) throw ServiceError.notFound('That role, team or user is not in this workspace')

  const flags = { can_view: input.canView, can_edit: input.canEdit, can_delete: input.canDelete, can_execute: input.canExecute }
  const objectIds = Array.from(new Set(input.objectIds))
  let updated = 0
  let inserted = 0
  for (let i = 0; i < objectIds.length; i += 100) {
    const batch = objectIds.slice(i, i + 100)
    const { data: owned, error: ownedError } = await db.from(table).select('id').eq('tenant_id', ctx.tenantId).in('id', batch)
    if (ownedError) throw dbError(ownedError)
    const ownedIds = (owned ?? []).map((row: any) => String(row.id))
    if (ownedIds.length) {
      const { data: existing, error } = await db.from('object_permissions').select('id, object_id')
        .eq('tenant_id', ctx.tenantId).eq('object_type', input.objectType).in('object_id', ownedIds).eq(matchCol, matchVal)
      if (error) throw dbError(error)
      const existingRows = (existing ?? []) as Array<{ id: string; object_id: string }>
      if (existingRows.length) {
        const { error: updateError } = await db.from('object_permissions')
          .update({ ...flags, granted_by: ctx.actorId, updated_at: new Date().toISOString() })
          .eq('tenant_id', ctx.tenantId).in('id', existingRows.map((row) => row.id))
        if (updateError) throw dbError(updateError)
        updated += existingRows.length
      }
      const have = new Set(existingRows.map((row) => row.object_id))
      const fresh = ownedIds.filter((id: string) => !have.has(id))
      if (fresh.length) {
        const { error: insertError } = await db.from('object_permissions').insert(fresh.map((objectId: string) => ({
          tenant_id: ctx.tenantId, object_type: input.objectType, object_id: objectId, ...flags, granted_by: ctx.actorId, [matchCol]: matchVal,
        })))
        if (insertError) throw dbError(insertError)
        inserted += fresh.length
      }
    }
    await onProgress?.(Math.min(i + 100, objectIds.length), objectIds.length)
  }
  return { updated, inserted }
}

export const objectPermissionsJob = defineJobKind({
  kind: 'object_permissions.bulk_set',
  effect: 'change',
  params: z.object({
    objectType: z.enum(['workflow', 'data_table']),
    objectIds: ids,
    roleId: uuid.nullish(), teamId: uuid.nullish(), userId: uuid.nullish(),
    canView: z.boolean(), canEdit: z.boolean(), canDelete: z.boolean(), canExecute: z.boolean(),
  }),
  title: (p) => `Set permissions on ${p.objectIds.length} ${p.objectType === 'workflow' ? 'workflow' : 'data table'}${p.objectIds.length === 1 ? '' : 's'}`,
  authorize: (ctx) => requirePerm(ctx, 'team.change_roles'),
  async run({ ctx, params, progress }) {
    const r = await bulkSetObjectPermissions(ctx, params, (done, total) => progress((done / total) * 100))
    return { counts: r, summary: `${r.inserted + r.updated} permission${r.inserted + r.updated === 1 ? '' : 's'} set` }
  },
})

export const referencesAddTagJob = defineJobKind({
  kind: 'references.add_tag',
  effect: 'change',
  params: z.object({ ids, tag: z.string().trim().min(1).max(60) }),
  title: (p) => `Tag ${p.ids.length} reference${p.ids.length === 1 ? '' : 's'} “${p.tag}”`,
  authorize: (ctx) => requirePerm(ctx, 'integrations.manage_references'),
  async run({ ctx, params }) {
    const r = await references.addTagToReferences(ctx, params.ids, params.tag)
    return { counts: r, data: r, summary: `${r.updated} reference${r.updated === 1 ? '' : 's'} tagged` }
  },
})

export const rolesBulkJob = defineJobKind({
  kind: 'roles.bulk',
  effect: 'change',
  params: z.object({ action: z.enum(['assign', 'remove']), role_id: uuid, user_ids: z.array(uuid).min(1).max(500), role_name: z.string().max(200).default('role') }),
  title: (p) => `${p.action === 'assign' ? 'Assign' : 'Remove'} “${p.role_name}” ${p.action === 'assign' ? 'to' : 'from'} ${p.user_ids.length} user${p.user_ids.length === 1 ? '' : 's'}`,
  authorize: (ctx) => requirePerm(ctx, 'team.change_roles'),
  async run({ ctx, params }) {
    if (params.action === 'assign') {
      const r = await roles.bulkAssignRole(ctx, params.user_ids, params.role_id)
      return { counts: r, data: r, summary: `Assigned to ${r.assigned}${r.skipped ? ` (${r.skipped} already had it)` : ''}` }
    }
    const r = await roles.bulkRemoveUserRole(ctx, params.user_ids, params.role_id)
    return { counts: r, data: r, summary: `Removed from ${r.removed}` }
  },
})

export const connectorRegenerateJob = defineJobKind({
  kind: 'connectors.regenerate_references',
  effect: 'change',
  params: z.object({ connector_id: uuid, name: z.string().max(200).default('connector') }),
  title: (p) => `Regenerate references for ${p.name}`,
  authorize: (ctx) => requirePerm(ctx, 'integrations.manage_references'),
  async run({ ctx, params }) {
    const { count } = await connectors.regenerateConnectorReferences(ctx, params.connector_id)
    return { counts: { references: count }, data: { count }, summary: `${count} reference${count === 1 ? '' : 's'} generated` }
  },
})
