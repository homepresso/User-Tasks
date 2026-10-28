'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/permissions-server'
import { fromSession } from '@/lib/services/context'
import * as referencesService from '@/lib/services/references'
import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'

// Ownership checks, audit and GitHub-sync capture live in lib/services/references.

export async function createReference(formData: FormData) {
  await requirePermission('integrations.manage_references')
  const ctx = await fromSession()
  const integrationId = formData.get('integration_id') as string
  const name = formData.get('name') as string
  const description = formData.get('description') as string

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
