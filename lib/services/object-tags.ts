/**
 * Tags on objects (the row "Tags…" quick action, bulk add / remove, and
 * POST /api/v1/tags/apply): read an object's tags, then save them through
 * that object type's own update service, so its edit permission, scoping,
 * audit and sync apply exactly as when the object is edited elsewhere.
 *
 * New tags: when the workspace turns off "anyone who can edit may add new
 * tags" (tenants.settings.tags.allow_new = false), adding a tag that is in
 * neither the registry nor on any object needs tags.manage.
 *
 * Tag names are tidied (trimmed, inner spaces collapsed) and matched
 * case-insensitively: adding "Finance" where "finance" exists keeps the
 * existing spelling, and removing matches any case.
 */

import { cleanTagName, tagKey, TAG_NAME_MAX } from '@/lib/tags/palette'
import { TAG_OBJECT_TYPE_KEYS } from '@/lib/tags/object-types'
import { getDb, hasPerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'
import { knownTagSpellings, listTagStyles } from './tags'
import { isMissingTagsColumn, tagsNotApplied } from './tags-column'
import { updateTask } from './tasks'
import { requireDesignAccess } from './design-access'
import { updateForm } from './forms'
import { updateIntegration } from './integrations'
import { updateReference } from './references'
import { updateAgent } from './agents'
import { updateWorkflowActivity } from './workflow-activities'
import { updateDataTable } from './data-tables'
import { setReportTags } from './reports'
import { updateDecisionTable } from './decision-tables'
import { updateEmailTemplate } from './email-templates'
import { updateFormControl } from './form-controls'
import { updateApp } from './apps'
import { setPackageTags } from './packages'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows */

export const TAGGABLE_TYPES = TAG_OBJECT_TYPE_KEYS
export type TaggableType = (typeof TAGGABLE_TYPES)[number]

/** Table and the permission that lets someone edit an object's tags (the services check again). */
export const TAGGABLE: Record<TaggableType, { table: string; editPerm: string; label: string }> = {
  tasks: { table: 'tasks', editPerm: 'tasks.complete', label: 'task' },
  workflows: { table: 'workflows', editPerm: 'workflows.edit', label: 'workflow' },
  forms: { table: 'forms', editPerm: 'forms.edit', label: 'form' },
  integrations: { table: 'integrations', editPerm: 'integrations.edit', label: 'integration' },
  references: { table: 'integration_references', editPerm: 'integrations.manage_references', label: 'reference' },
  agents: { table: 'agents', editPerm: 'agents.edit', label: 'agent' },
  activities: { table: 'custom_workflow_activities', editPerm: 'extensibility.edit', label: 'workflow activity' },
  data_tables: { table: 'custom_tables', editPerm: 'data.edit_schema', label: 'data table' },
  // Only the report's creator, as for every report edit (setReportTags).
  reports: { table: 'reports', editPerm: 'reports.edit_own', label: 'report' },
  business_rules: { table: 'decision_tables', editPerm: 'workflows.edit', label: 'business rule' },
  email_templates: { table: 'email_templates', editPerm: 'workflows.edit', label: 'email template' },
  form_controls: { table: 'form_controls', editPerm: 'extensibility.edit', label: 'form control' },
  // Builders (apps.manage) or the app's named editors (updateApp decides per app).
  apps: { table: 'apps', editPerm: 'apps.manage', label: 'app' },
  packages: { table: 'packages', editPerm: 'packages.manage', label: 'package' },
}

/** Types whose rows have no client read grant: read with the service role (the type's service gates access). */
const SERVICE_READ_TYPES: ReadonlySet<TaggableType> = new Set(['packages', 'apps'])

/** Types that arrive with migration 20270122150000_tags_everywhere. */
export const TAGS_EVERYWHERE_TYPES: ReadonlySet<TaggableType> = new Set(['data_tables', 'reports', 'business_rules', 'email_templates', 'form_controls', 'apps', 'packages'])

export function isTaggableType(value: unknown): value is TaggableType {
  return typeof value === 'string' && (TAGGABLE_TYPES as readonly string[]).includes(value)
}

/** Whether the caller may edit tags of this type at all (UI hint; the object's service decides per object). */
export function canEditTagsOf(ctx: ServiceContext, type: TaggableType): boolean {
  // An app's named editors hold only apps.view; updateApp checks the app.
  if (type === 'apps') return hasPerm(ctx, 'apps.manage') || hasPerm(ctx, 'apps.view')
  return hasPerm(ctx, TAGGABLE[type].editPerm)
}

const MAX_TAGS = 30
const MAX_IDS = 200

function cleanList(values: unknown, field: string): string[] {
  if (values === undefined || values === null) return []
  if (!Array.isArray(values)) throw ServiceError.validation(`${field} must be an array of tag names`)
  const out: string[] = []
  for (const v of values) {
    const name = cleanTagName(v)
    if (!name) continue
    if (name.length > TAG_NAME_MAX) throw ServiceError.validation(`Tags must be at most ${TAG_NAME_MAX} characters`)
    if (!out.some((o) => tagKey(o) === tagKey(name))) out.push(name)
  }
  return out
}

/**
 * The resulting tags: current minus `remove`, plus `add` (an existing
 * spelling wins over the typed one; nothing is added twice). Pure.
 */
export function mergeTags(current: readonly string[], add: readonly string[], remove: readonly string[], known: ReadonlyMap<string, string> = new Map()): string[] {
  const removeKeys = new Set(remove.map(tagKey))
  const out = current.filter((t) => cleanTagName(t) && !removeKeys.has(tagKey(t)))
  for (const name of add) {
    const key = tagKey(name)
    if (!key || removeKeys.has(key) || out.some((t) => tagKey(t) === key)) continue
    out.push(known.get(key) ?? cleanTagName(name))
  }
  return out
}

async function readTags(ctx: ServiceContext, type: TaggableType, id: string): Promise<string[]> {
  const db = SERVICE_READ_TYPES.has(type) ? await serviceRoleClient(ctx) : getDb(ctx)
  const { data, error } = await (db as any).from(TAGGABLE[type].table).select('id, tags').eq('id', id).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw isMissingTagsColumn(error) ? tagsNotApplied(`${TAGGABLE[type].label}s`) : dbError(error)
  if (!data) throw ServiceError.notFound(`That ${TAGGABLE[type].label} was not found`)
  return Array.isArray(data.tags) ? data.tags.map(String) : []
}

/** Save through the object type's own service (its permission, audit and sync). */
async function writeTags(ctx: ServiceContext, type: TaggableType, id: string, tags: string[]): Promise<void> {
  switch (type) {
    case 'tasks':
      await updateTask(ctx, id, { tags } as any)
      return
    case 'workflows': {
      // Tags are list metadata, not part of the published definition: a tag
      // change must not mark the workflow as having unpublished changes.
      await requireDesignAccess(ctx, 'workflow', id)
      const { error } = await (getDb(ctx) as any).from('workflows').update({ tags }).eq('id', id).eq('tenant_id', ctx.tenantId)
      if (error) throw dbError(error)
      await audit(ctx, { objectType: 'workflow', objectId: id, action: 'update', summary: `Tags set to ${tags.join(', ') || '(none)'}`, diff: { tags: { before: null, after: tags } } })
      return
    }
    case 'forms':
      await updateForm(ctx, id, { tags })
      return
    case 'integrations':
      await updateIntegration(ctx, id, { tags })
      return
    case 'references':
      await updateReference(ctx, id, { tags })
      return
    case 'agents':
      await updateAgent(ctx, id, { tags } as any, { note: 'Tags changed', action: 'update' })
      return
    case 'activities':
      await updateWorkflowActivity(ctx, id, { tags } as any)
      return
    case 'data_tables':
      await updateDataTable(ctx, id, { tags })
      return
    case 'reports':
      await setReportTags(ctx, id, tags)
      return
    case 'business_rules':
      await updateDecisionTable(ctx, id, { tags })
      return
    case 'email_templates':
      await updateEmailTemplate(ctx, id, { tags })
      return
    case 'form_controls':
      await updateFormControl(ctx, id, { tags })
      return
    case 'apps':
      await updateApp(ctx, id, { tags })
      return
    case 'packages':
      await setPackageTags(ctx, id, tags)
      return
  }
}

/** Whether new tags (in no registry row and on no object) may be added by this caller. */
async function newTagGate(ctx: ServiceContext, add: string[], known: ReadonlyMap<string, string>): Promise<void> {
  const fresh = add.filter((t) => !known.has(tagKey(t)))
  if (!fresh.length || hasPerm(ctx, 'tags.manage')) return
  const { settings } = await listTagStyles(ctx)
  if (settings.allow_new) return
  throw ServiceError.forbidden(`New tags need the 'tags.manage' permission in this workspace: ${fresh.join(', ')}. Pick an existing tag instead.`)
}

export interface ApplyTagsResult {
  updated: Array<{ id: string; tags: string[] }>
  unchanged: string[]
  failed: Array<{ id: string; error: string }>
}

/**
 * Add and / or remove tags on one or more objects of a type, or replace an
 * object's tags (`set`, single object). Each object is saved through its
 * own service; failures (no access, not found) are reported per object.
 */
export async function applyObjectTags(ctx: ServiceContext, input: { type: unknown; ids: unknown; add?: unknown; remove?: unknown; set?: unknown }): Promise<ApplyTagsResult> {
  if (!isTaggableType(input.type)) throw ServiceError.validation(`type must be one of ${TAGGABLE_TYPES.join(', ')}`)
  const type = input.type
  const ids = Array.isArray(input.ids) ? [...new Set(input.ids.map(String).filter(Boolean))] : []
  if (!ids.length) throw ServiceError.validation('ids must list at least one object')
  if (ids.length > MAX_IDS) throw ServiceError.validation(`At most ${MAX_IDS} objects at a time`)
  const set = input.set === undefined ? null : cleanList(input.set, 'set')
  if (set && ids.length > 1) throw ServiceError.validation('set replaces the tags of one object; use add / remove for several')
  const add = set ?? cleanList(input.add, 'add')
  const remove = cleanList(input.remove, 'remove')
  if (!set && !add.length && !remove.length) throw ServiceError.validation('Nothing to change: give add, remove or set')
  if (!canEditTagsOf(ctx, type)) throw ServiceError.forbidden(`Forbidden: changing a ${TAGGABLE[type].label}'s tags needs '${TAGGABLE[type].editPerm}'`)

  const known = await knownTagSpellings(ctx)
  await newTagGate(ctx, add, known)

  const result: ApplyTagsResult = { updated: [], unchanged: [], failed: [] }
  for (const id of ids) {
    try {
      const current = await readTags(ctx, type, id)
      const next = set ? mergeTags([], set, [], known) : mergeTags(current, add, remove, known)
      if (next.length > MAX_TAGS) throw ServiceError.validation(`At most ${MAX_TAGS} tags on one object`)
      if (next.length === current.length && next.every((t, i) => t === current[i])) { result.unchanged.push(id); continue }
      await writeTags(ctx, type, id, next)
      result.updated.push({ id, tags: next })
    } catch (error) {
      if (ids.length === 1) throw error
      result.failed.push({ id, error: error instanceof Error ? error.message : 'Failed' })
    }
  }
  return result
}
