'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as integrationsService from '@/lib/services/integrations'
import * as referencesService from '@/lib/services/references'
import * as tagsService from '@/lib/services/tags'
import * as objectTags from '@/lib/services/object-tags'
import type { ApplyTagsResult, TaggableType } from '@/lib/services/object-tags'
import type { TagColorToken } from '@/lib/tags/palette'

/*
 * Tags: colours and descriptions (the workspace tag registry,
 * lib/services/tags.ts), rename / merge, the auto-colour switch, and the
 * tags on integrations / references. Thin wrappers over
 * lib/services (permissions, tenant scoping, audit and sync live there).
 */

export async function setTagStyle(name: string, input: { color?: TagColorToken | 'auto' | null; description?: string | null; keep?: boolean }): Promise<ActionResult<tagsService.TagStyle & { styled: boolean }>> {
  return runAction('setTagStyle', 'Could not save the tag colour.', async () =>
    tagsService.setTagStyle(await fromSession(), { name, ...input }))
}

export async function deleteTagStyle(name: string): Promise<ActionResult<{ deleted: true }>> {
  return runAction('deleteTagStyle', 'Could not reset the tag.', async () =>
    tagsService.deleteTagStyle(await fromSession(), name))
}

export async function renameTag(from: string, to: string): Promise<ActionResult<Awaited<ReturnType<typeof tagsService.renameTag>>>> {
  return runAction('renameTag', 'Could not rename the tag.', async () =>
    tagsService.renameTag(await fromSession(), { from, to }))
}

export async function removeTag(name: string): Promise<ActionResult<Awaited<ReturnType<typeof tagsService.removeTag>>>> {
  return runAction('removeTag', 'Could not remove the tag.', async () =>
    tagsService.removeTag(await fromSession(), { name }))
}

/** Add / remove / replace tags on objects (each saved through its own service and permission). */
export async function applyObjectTags(input: { type: TaggableType; ids: string[]; add?: string[]; remove?: string[]; set?: string[] }): Promise<ActionResult<ApplyTagsResult>> {
  return runAction('applyObjectTags', 'Could not change the tags.', async () =>
    objectTags.applyObjectTags(await fromSession(), input))
}

export async function updateTagSettings(input: { auto_color?: boolean; allow_new?: boolean }): Promise<ActionResult<tagsService.TagSettings>> {
  return runAction('updateTagSettings', 'Could not save the tag settings.', async () =>
    tagsService.updateTagSettings(await fromSession(), input))
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
