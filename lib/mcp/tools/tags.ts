import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as tagsService from '@/lib/services/tags'
import { applyObjectTags } from '@/lib/services/object-tags'
import { TAG_COLOR_TOKENS, TAG_DESCRIPTION_MAX, TAG_NAME_MAX } from '@/lib/tags/palette'
import { TAG_OBJECT_TYPE_KEYS } from '@/lib/tags/object-types'
import { messageOf } from './_util'

/*
 * Tag colours: the workspace's tags with their colour, description and
 * usage, and the registry writes (tags.manage, audited in the service).
 * Thin wrappers over lib/services/tags.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const COLORS = TAG_COLOR_TOKENS.join(', ')
const OBJECTS = 'tasks, workflows, forms, integrations, references, agents, workflow activities, data tables, reports, business rules, email templates, form controls, apps and packages'
const objectType = z.enum(TAG_OBJECT_TYPE_KEYS)

export function registerTagTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('tags_list', `List the tags in use across the workspace (${OBJECTS}) with each tag's colour, chosen colour (null = automatic), description and usage per object type you may view, plus the auto-colour setting. Tags match case-insensitively.`, {
    q: z.string().max(100).optional().describe('Tag name or description contains'),
  }, async (args) => run(async () => tagsService.listTags(svc(), { q: args.q ?? null })))

  server.tool('tags_set_style', `Set a tag's colour and / or description (tags.manage). Send only what changes. color: ${COLORS}, or auto (the colour the name gets by itself). description "" clears it. The colour shows wherever the tag appears. Audited.`, {
    name: z.string().min(1).max(TAG_NAME_MAX).describe('The tag (any case)'),
    color: z.enum([...TAG_COLOR_TOKENS, 'auto'] as [string, ...string[]]).optional(),
    description: z.string().max(TAG_DESCRIPTION_MAX).optional(),
    keep: z.boolean().optional().describe('true: keep the tag in the registry with no colour or description (create it ahead of use)'),
  }, async (args) => run(async () => ({ tag: await tagsService.setTagStyle(svc(), args) })))

  server.tool('tags_reset_style', 'Reset a tag to its automatic colour, removing its colour and description (tags.manage). The tag stays on its objects. Audited.', {
    name: z.string().min(1).max(TAG_NAME_MAX).describe('The tag (any case)'),
  }, async (args) => run(async () => tagsService.deleteTagStyle(svc(), args.name)))

  server.tool('tags_rename', `Rename a tag on every tagged object of the workspace (${OBJECTS}), in one transaction (tags.manage). If \`to\` is already a tag the two merge. The colour and description move with the tag. Audited.`, {
    from: z.string().min(1).max(TAG_NAME_MAX).describe('The tag to rename (any case)'),
    to: z.string().min(1).max(TAG_NAME_MAX).describe('The new name, or an existing tag to merge into'),
  }, async (args) => run(async () => tagsService.renameTag(svc(), args)))

  server.tool('tags_suggest', 'Autocomplete: the workspace tags matching some text, ranked (exact, then starts-with, then contains; ties by usage), with colour and usage. `exact` is the existing tag matching the text — use its spelling; `can_create` says whether a brand-new tag may be added.', {
    q: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }, async (args) => run(async () => tagsService.suggestTags(svc(), { q: args.q ?? null, limit: args.limit ?? 10 })))

  server.tool('tags_objects', 'The objects of one type carrying a tag, by name, paged (id, name, app link). Needs the type\'s view permission; lists only objects you may see.', {
    name: z.string().min(1).max(TAG_NAME_MAX),
    type: objectType,
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }, async (args) => run(async () => tagsService.listTagObjects(svc(), args)))

  server.tool('tags_remove', `Remove a tag from every tagged object of the workspace (${OBJECTS}) and delete its colour and description, in one transaction (tags.manage). Audited.`, {
    name: z.string().min(1).max(TAG_NAME_MAX),
  }, async (args) => run(async () => tagsService.removeTag(svc(), args)))

  server.tool('tags_apply', 'Add or remove tags on objects of one type, or replace one object\'s tags (set). Each object is saved through its own update and needs its edit permission; an existing tag\'s spelling wins over the typed case.', {
    type: objectType,
    ids: z.array(z.string()).min(1).max(200),
    add: z.array(z.string().max(TAG_NAME_MAX)).max(30).optional(),
    remove: z.array(z.string().max(TAG_NAME_MAX)).max(30).optional(),
    set: z.array(z.string().max(TAG_NAME_MAX)).max(30).optional(),
  }, async (args) => run(async () => applyObjectTags(svc(), args)))

  server.tool('tags_settings_get', 'Get the tag settings: auto_color (uncoloured tags get a colour from their name; false shows them in grey) and allow_new (anyone who can edit may add new tags; false: tag managers only).', {},
    async () => run(async () => ({ settings: (await tagsService.listTagStyles(svc())).settings })))

  server.tool('tags_settings_update', 'Change the tag settings (tags.manage): auto_color (off: tags without a chosen colour show in neutral grey) and allow_new (off: only tag managers may add brand-new tags). Audited.', {
    auto_color: z.boolean().optional(),
    allow_new: z.boolean().optional(),
  }, async (args) => run(async () => ({ settings: await tagsService.updateTagSettings(svc(), args) })))
}
