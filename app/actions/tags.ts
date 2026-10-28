'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as integrationsService from '@/lib/services/integrations'
import * as referencesService from '@/lib/services/references'
import * as tagDefinitions from '@/lib/services/tag-definitions'

/*
 * Tags in the workflow and integration lists: tag definitions (name +
 * colour) and the tags on integrations / references. Thin wrappers over
 * lib/services (permissions, tenant scoping, audit and sync live there).
 */

export async function createTagDefinition(scope: tagDefinitions.TagScope, name: string, color: string): Promise<ActionResult<tagDefinitions.TagDefinition>> {
  return runAction('createTagDefinition', 'Could not create the tag.', async () =>
    tagDefinitions.createTagDefinition(await fromSession(), scope, { name, color }))
}

export async function updateTagDefinitionColor(scope: tagDefinitions.TagScope, tagId: string, color: string): Promise<ActionResult<tagDefinitions.TagDefinition>> {
  return runAction('updateTagDefinitionColor', 'Could not update the tag.', async () =>
    tagDefinitions.updateTagDefinitionColor(await fromSession(), scope, tagId, color))
}

function cleanTags(tags: string[]): string[] {
  return Array.from(new Set((Array.isArray(tags) ? tags : []).map((t) => String(t).trim()).filter(Boolean))).slice(0, 50)
}

export async function setIntegrationTags(integrationId: string, tags: string[]): Promise<ActionResult<null>> {
  return runAction('setIntegrationTags', 'Could not update the tags.', async () => {
    await integrationsService.updateIntegration(await fromSession(), integrationId, { tags: cleanTags(tags) })
    return null
  })
}

export async function setReferenceTags(referenceId: string, tags: string[]): Promise<ActionResult<null>> {
  return runAction('setReferenceTags', 'Could not update the tags.', async () => {
    await referencesService.updateReference(await fromSession(), referenceId, { tags: cleanTags(tags) })
    return null
  })
}

export async function addTagToReferences(referenceIds: string[], tag: string): Promise<ActionResult<{ updated: number }>> {
  return runAction('addTagToReferences', 'Could not tag the references.', async () =>
    referencesService.addTagToReferences(await fromSession(), referenceIds, tag))
}
