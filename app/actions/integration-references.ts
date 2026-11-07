'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/permissions-server'
import { fromSession } from '@/lib/services/context'
import * as referencesService from '@/lib/services/references'
import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { findRecentDuplicate } from '@/lib/recent-duplicate'

// Ownership checks, audit and GitHub-sync capture live in lib/services/references.

export async function createReference(formData: FormData) {
  await requirePermission('integrations.manage_references')
  const ctx = await fromSession()
  const integrationId = formData.get('integration_id') as string
  const name = formData.get('name') as string
  const description = formData.get('description') as string

  // A repeated submit (double click, retry) must not add a second reference
  // (no creator column: match integration + name).
  if (await findRecentDuplicate(ctx.supabase, 'integration_references', { tenant_id: ctx.tenantId, integration_id: integrationId, name: String(name ?? '').trim() })) {
    revalidatePath('/integrations')
    return
  }

  await referencesService.createReference(ctx, integrationId, {
    name,
    description: description || null,
    inputs: [],
    outputs: [],
    request_config: { method: 'GET', path_template: '', body_template: '', query_params: {}, headers: {} },
  })
  revalidatePath('/integrations')
}

export async function updateReference(refId: string, updates: { inputs?: unknown[]; outputs?: unknown[]; request_config?: object; response_schema?: unknown; name?: string; description?: string }) {
  await requirePermission('integrations.manage_references')
  const ctx = await fromSession()
  await referencesService.updateReference(ctx, refId, updates as referencesService.ReferenceUpdateInput)
  revalidatePath('/integrations')
}

export async function deleteReference(refId: string) {
  await requirePermission('integrations.manage_references')
  const ctx = await fromSession()
  await referencesService.deleteReference(ctx, refId)
  revalidatePath('/integrations')
}

export async function bulkDeleteReferences(refIds: string[]) {
  await requirePermission('integrations.manage_references')
  const ctx = await fromSession()
  const { deleted } = await referencesService.bulkDeleteReferences(ctx, refIds)
  revalidatePath('/integrations')
  return { deleted }
}

/** Create one reference from a full description (integration wizard, database step). */
export async function createIntegrationReference(integrationId: string, input: referencesService.ReferenceInput): Promise<ActionResult<{ id: string }>> {
  return runAction('createIntegrationReference', 'Could not create the reference.', async () => {
    const created = await referencesService.createReference(await fromSession(), integrationId, input)
    return { id: created.id }
  })
}

/** Create a custom reference (the builder's Save). The server materialises the source and builds inputs/outputs/model. */
export async function createCustomReference(integrationId: string, input: { name: string; description?: string | null; custom: Record<string, unknown> }): Promise<ActionResult<{ id: string }>> {
  return runAction('createCustomReference', 'Could not save the custom reference.', async () => {
    const created = await referencesService.createReference(await fromSession(), integrationId, {
      name: input.name,
      description: input.description ?? null,
      request_config: { origin: 'custom', custom: input.custom },
    })
    revalidatePath('/integrations')
    return { id: created.id }
  })
}

/** Save an existing custom reference (Fixed values, shaping, source). */
export async function updateCustomReference(refId: string, input: { name?: string; description?: string | null; custom: Record<string, unknown> }): Promise<ActionResult<{ id: string }>> {
  return runAction('updateCustomReference', 'Could not save the custom reference.', async () => {
    await referencesService.updateReference(await fromSession(), refId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      request_config: { origin: 'custom', custom: input.custom },
    })
    revalidatePath('/integrations')
    return { id: refId }
  })
}

/** "Duplicate as custom" from a generated reference. */
export async function duplicateReferenceAsCustom(refId: string): Promise<ActionResult<{ id: string }>> {
  return runAction('duplicateReferenceAsCustom', 'Could not duplicate the reference.', async () => {
    const created = await referencesService.duplicateAsCustom(await fromSession(), refId)
    revalidatePath('/integrations')
    return { id: created.id }
  })
}
