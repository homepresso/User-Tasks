'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as objects from '@/lib/services/objects'

/*
 * Composite objects from the integrations view (they were written from the
 * browser before): create, delete and generate references, through
 * lib/services/objects — the same code /api/v1/objects and the MCP tools use,
 * which also queues the GitHub-sync changes.
 */

export async function createIntegrationObject(input: { name: string; description?: string | null; sources: objects.ObjectSourceInput[] }): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction('createIntegrationObject', 'Could not create the object.', async () => {
    const result = await objects.createObject(await fromSession(), input)
    return result.object
  })
}

export async function deleteIntegrationObject(objectId: string): Promise<ActionResult<{ deleted_reference_count: number }>> {
  return runAction('deleteIntegrationObject', 'Could not delete the object.', async () => {
    const { deleted_reference_count } = await objects.deleteObject(await fromSession(), objectId)
    return { deleted_reference_count }
  })
}

export async function generateIntegrationObjectReferences(objectId: string): Promise<ActionResult<{ created: number }>> {
  return runAction('generateIntegrationObjectReferences', 'Could not generate the references.', async () => {
    const { created } = await objects.generateObjectReferences(await fromSession(), objectId)
    return { created }
  })
}
