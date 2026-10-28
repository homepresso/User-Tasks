/**
 * Tag definitions (name + colour) shared by the workflow and integration
 * lists. Tenant-wide; creating or recolouring one needs edit rights on the
 * list it is used from (workflows.edit / integrations.edit).
 */

import { requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- tag_definitions is not in the generated types */

export type TagScope = 'workflows' | 'integrations'

export interface TagDefinition { id: string; name: string; color: string }

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^[a-z]{3,20}$/

function scopePermission(scope: TagScope): string {
  if (scope === 'workflows') return 'workflows.edit'
  if (scope === 'integrations') return 'integrations.edit'
  throw ServiceError.validation('scope must be workflows or integrations')
}

function validColor(color: unknown): string {
  const value = String(color ?? '').trim()
  if (!COLOR_RE.test(value)) throw ServiceError.validation('color must be a hex colour such as #6B7280')
  return value
}

export async function createTagDefinition(ctx: ServiceContext, scope: TagScope, input: { name: string; color: string }): Promise<TagDefinition> {
  requirePerm(ctx, scopePermission(scope))
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 60) throw ServiceError.validation('Tag name must be 1-60 characters')
  const { data, error } = await (ctx.supabase as any).from('tag_definitions')
    .insert({ tenant_id: ctx.tenantId, name, color: validColor(input.color) })
    .select('id, name, color').single()
  if (error || !data) throw dbError(error, 'Failed to create the tag')
  return data as TagDefinition
}

export async function updateTagDefinitionColor(ctx: ServiceContext, scope: TagScope, tagId: string, color: string): Promise<TagDefinition> {
  requirePerm(ctx, scopePermission(scope))
  const { data, error } = await (ctx.supabase as any).from('tag_definitions')
    .update({ color: validColor(color) }).eq('id', tagId).eq('tenant_id', ctx.tenantId)
    .select('id, name, color').maybeSingle()
  if (error) throw dbError(error, 'Failed to update the tag')
  if (!data) throw ServiceError.notFound('Tag not found')
  return data as TagDefinition
}
