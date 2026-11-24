import { z } from 'zod'
import { TAG_COLOR_TOKENS, TAG_DESCRIPTION_MAX, TAG_NAME_MAX } from '@/lib/tags/palette'
import { TAG_OBJECT_TYPE_KEYS } from '@/lib/tags/object-types'
import { defineEndpoint } from './registry'

/**
 * Tag colours (lib/services/tags.ts): the workspace's tags in use with
 * their colour, description and usage per object type, and the tag
 * registry writes — colour / description, rename or merge, the
 * auto-colour switch. Tags themselves stay free text on each object.
 * Reads: any member (usage counts only the object types you may view).
 * Writes: tags.manage (audited).
 */

const tags = ['Tags']
const COLORS = TAG_COLOR_TOKENS.join(', ')
const OBJECTS = 'tasks, workflows, forms, integrations, references, agents, workflow activities, data tables, reports, business rules, email templates, form controls, apps and packages'
const objectTypeSchema = z.enum(TAG_OBJECT_TYPE_KEYS)
const colorSchema = z.enum([...TAG_COLOR_TOKENS, 'auto'] as [string, ...string[]])

export const tagSettingsSchema = z.object({
  auto_color: z.boolean().describe('Uncoloured tags get a colour from their name (true, default) or show in neutral grey (false)'),
  allow_new: z.boolean().describe('Anyone who can edit an object may add a brand-new tag to it (true, default); false: only people with tags.manage, everyone else picks existing tags'),
})

const tagSummary = z.looseObject({
  name: z.string().describe('The tag (most used spelling)'),
  key: z.string().describe('Case-insensitive key: trimmed, inner spaces collapsed, lower case'),
  color: z.string().describe(`The colour chips show: ${COLORS}`),
  chosen_color: z.string().nullable().describe('The colour chosen for the tag; null = automatic'),
  description: z.string().nullable(),
  styled: z.boolean().describe('Has a colour or description in the registry'),
  usage: z.record(z.string(), z.number().int()).describe(`Objects carrying the tag per type you may view: ${TAG_OBJECT_TYPE_KEYS.join(', ')}`),
  total: z.number().int(),
})

const tagStyle = z.looseObject({
  name: z.string(), key: z.string(), color: z.string().nullable(), description: z.string().nullable(), styled: z.boolean(),
})

export const listTagsEndpoint = defineEndpoint({
  method: 'GET', path: '/tags', operationId: 'listTags', tags,
  summary: 'List the tags in use with their colours, descriptions and usage per object type',
  description: `Every tag on the workspace's ${OBJECTS} (usage counts only the object types — and objects — you may view), plus styled tags not in use. Sorted by total use. Also returns the auto-colour setting.`,
  permission: null,
  query: z.object({ q: z.string().max(100).optional().describe('Tag name or description contains') }),
  response: z.looseObject({ tags: z.array(tagSummary), total: z.number().int(), settings: tagSettingsSchema, object_types: z.array(z.looseObject({ type: z.string(), label: z.string() })) }),
  listKey: 'tags',
  cli: { resource: 'tags', verb: 'list' },
})

export const setTagStyleEndpoint = defineEndpoint({
  method: 'PUT', path: '/tags/style', operationId: 'setTagStyle', tags,
  summary: 'Set a tag\'s colour and / or description',
  description: `Send only what changes. color is a palette token (${COLORS}) or "auto" (the colour the name gets by itself); description "" clears it. Names match case-insensitively. A tag left with neither is removed from the registry. Audited.`,
  permission: 'tags.manage',
  body: z.object({
    name: z.string().min(1).max(TAG_NAME_MAX).describe('The tag'),
    color: colorSchema.optional().describe(`${COLORS} or auto`),
    description: z.string().max(TAG_DESCRIPTION_MAX).optional().describe('Shown when hovering over the tag; "" clears it'),
    keep: z.boolean().optional().describe('Keep the tag in the registry even with no colour or description (create a tag ahead of use)'),
  }),
  response: itemStyle(),
  cli: { resource: 'tags', verb: 'set-style' },
})

function itemStyle() {
  return z.looseObject({ tag: tagStyle })
}

export const deleteTagStyleEndpoint = defineEndpoint({
  method: 'DELETE', path: '/tags/style', operationId: 'deleteTagStyle', tags,
  summary: 'Reset a tag to its automatic colour (removes its colour and description)',
  description: 'The tag stays on its objects. Audited.',
  permission: 'tags.manage',
  query: z.object({ name: z.string().min(1).max(TAG_NAME_MAX).describe('The tag') }),
  response: z.looseObject({ deleted: z.literal(true) }),
  cli: { resource: 'tags', verb: 'reset-style' },
})

export const renameTagEndpoint = defineEndpoint({
  method: 'POST', path: '/tags/rename', operationId: 'renameTag', tags,
  summary: 'Rename a tag on every object, or merge it into another tag',
  description: `Changes the tag on every tagged object of the workspace (${OBJECTS}) in one transaction; its colour and description move with it. When \`to\` is already a tag the two merge (objects keep one; the target keeps its own style, taking the source's where it has none). Audited.`,
  permission: 'tags.manage',
  body: z.object({
    from: z.string().min(1).max(TAG_NAME_MAX).describe('The tag to rename (any case)'),
    to: z.string().min(1).max(TAG_NAME_MAX).describe('The new name, or an existing tag to merge into'),
  }),
  response: z.looseObject({ name: z.string(), merged: z.boolean(), objects: z.record(z.string(), z.number().int()), total: z.number().int() }),
  cli: { resource: 'tags', verb: 'rename' },
})

export const getTagSettingsEndpoint = defineEndpoint({
  method: 'GET', path: '/tags/settings', operationId: 'getTagSettings', tags,
  summary: 'Get the tag settings (automatic colours on or off)',
  permission: null,
  response: tagSettingsSchema,
  cli: { resource: 'tags', verb: 'settings' },
})

export const updateTagSettingsEndpoint = defineEndpoint({
  method: 'PATCH', path: '/tags/settings', operationId: 'updateTagSettings', tags,
  summary: 'Change the tag settings (automatic colours, who may add new tags)',
  description: 'auto_color off: tags without a chosen colour show in neutral grey. allow_new off: only people with tags.manage may add brand-new tags. Audited.',
  permission: 'tags.manage',
  body: tagSettingsSchema.partial(),
  response: tagSettingsSchema,
  cli: { resource: 'tags', verb: 'update-settings' },
})

export const suggestTagsEndpoint = defineEndpoint({
  method: 'GET', path: '/tags/suggest', operationId: 'suggestTags', tags,
  summary: 'Autocomplete: workspace tags matching some text, ranked, with colours and usage',
  description: 'Exact match first, then names starting with the text, then names or descriptions containing it; ties by usage. Case- and space-insensitive. `exact` is the existing tag matching the text (use its spelling); `can_create` says whether you may add a brand-new tag.',
  permission: null,
  query: z.object({
    q: z.string().max(100).optional().describe('What was typed'),
    limit: z.coerce.number().int().min(1).max(50).optional().describe('At most this many (default 10)'),
  }),
  response: z.looseObject({ suggestions: z.array(z.looseObject({ name: z.string(), key: z.string(), color: z.string(), total: z.number().int() })), exact: z.looseObject({}).nullable(), can_create: z.boolean() }),
  listKey: 'suggestions',
  cli: { resource: 'tags', verb: 'suggest' },
})

export const listTagObjectsEndpoint = defineEndpoint({
  method: 'GET', path: '/tags/objects', operationId: 'listTagObjects', tags,
  summary: 'The objects of one type that carry a tag, by name, paged',
  description: 'Each with its id, name and app link. Needs the type\'s view permission, and lists only objects you may see.',
  permission: null,
  query: z.object({
    name: z.string().min(1).max(TAG_NAME_MAX).describe('The tag (any case)'),
    type: objectTypeSchema.describe('Object type'),
    limit: z.coerce.number().int().min(1).max(100).optional().describe('Page size (default 20)'),
    offset: z.coerce.number().int().min(0).optional().describe('Rows to skip'),
  }),
  response: z.looseObject({ items: z.array(z.looseObject({ id: z.string(), name: z.string(), href: z.string() })), total: z.number().int() }),
  listKey: 'items',
  cli: { resource: 'tags', verb: 'objects' },
})

export const removeTagEndpoint = defineEndpoint({
  method: 'POST', path: '/tags/remove', operationId: 'removeTag', tags,
  summary: 'Remove a tag from every object and delete its colour and description',
  description: `Every tagged object of the workspace (${OBJECTS}), in one transaction. Audited.`,
  permission: 'tags.manage',
  body: z.object({ name: z.string().min(1).max(TAG_NAME_MAX).describe('The tag (any case)') }),
  response: z.looseObject({ name: z.string(), objects: z.record(z.string(), z.number().int()), total: z.number().int() }),
  cli: { resource: 'tags', verb: 'remove' },
})

export const applyTagsEndpoint = defineEndpoint({
  method: 'POST', path: '/tags/apply', operationId: 'applyTags', tags,
  summary: 'Add or remove tags on objects (or replace one object\'s tags)',
  description: 'Each object is saved through its own update, so it needs that object\'s edit permission (tasks.complete, workflows.edit, forms.edit, integrations.edit, integrations.manage_references, agents.edit, extensibility.edit, data.edit_schema, reports.edit_own and the report\'s creator, apps.manage or the app\'s editors, packages.manage). An existing tag\'s spelling wins over the typed case. With allow_new off, brand-new tags need tags.manage. Several objects: per-object failures are reported, the rest are saved.',
  permission: null,
  body: z.object({
    type: objectTypeSchema.describe('Object type'),
    ids: z.array(z.string()).min(1).max(200).describe('Object ids'),
    add: z.array(z.string().max(TAG_NAME_MAX)).max(30).optional().describe('Tags to add'),
    remove: z.array(z.string().max(TAG_NAME_MAX)).max(30).optional().describe('Tags to remove (any case)'),
    set: z.array(z.string().max(TAG_NAME_MAX)).max(30).optional().describe('Replace the tags (one object only)'),
  }),
  response: z.looseObject({ updated: z.array(z.looseObject({ id: z.string(), tags: z.array(z.string()) })), unchanged: z.array(z.string()), failed: z.array(z.looseObject({ id: z.string(), error: z.string() })) }),
  cli: { resource: 'tags', verb: 'apply' },
})

export const tagEndpoints = [listTagsEndpoint, suggestTagsEndpoint, listTagObjectsEndpoint, setTagStyleEndpoint, deleteTagStyleEndpoint, renameTagEndpoint, removeTagEndpoint, applyTagsEndpoint, getTagSettingsEndpoint, updateTagSettingsEndpoint]
