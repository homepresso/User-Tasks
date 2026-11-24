/**
 * Tag colours (public.tag_styles, migration 20270121150000_tag_styles): the
 * workspace's tag registry, mapping a tag name — case-insensitively — to a
 * colour token from lib/tags/palette.ts and an optional description, plus
 * the workspace's auto-colour switch (tenants.settings.tags.auto_color).
 *
 * The tags themselves stay free text on each object (tasks, workflows,
 * forms, integrations, references, agents, workflow activities, data
 * tables, reports, business rules, email templates, form controls, apps and
 * authored packages — the last seven with migration 20270122150000).
 *
 *  - Reading styles (every chip in every list) needs only membership.
 *  - Listing tags in use counts each object type the caller may view, and
 *    only the rows RLS shows them (public.tag_usage is SECURITY INVOKER),
 *    so counts and names on hidden objects don't leak.
 *  - Setting / deleting a style, renaming or merging a tag and the auto
 *    colour switch need tags.manage (audited). Rename / merge runs
 *    server-side in one transaction (public.rename_tag).
 *
 * Until the migration is applied, styles read as empty (every tag gets its
 * auto colour) and writes answer "apply migration 20270121150000".
 */

import {
  cleanTagName, isTagColorToken, resolveTagColor, tagKey, TAG_COLOR_TOKENS, TAG_DESCRIPTION_MAX, TAG_NAME_MAX,
  type TagColorToken,
} from '@/lib/tags/palette'
import { getDb, hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'
import { scopeReportRead } from '@/lib/reports-access'
import { isMissingTagsColumn } from './tags-column'
import { listApps } from './apps'

/* eslint-disable @typescript-eslint/no-explicit-any -- tag_styles is not in the generated types yet */

export const TAG_STYLES_MIGRATION = '20270121150000_tag_styles'

export interface TagStyle {
  name: string
  key: string
  /** Chosen colour; null = automatic. */
  color: TagColorToken | null
  description: string | null
  updated_at: string | null
}

export interface TagSettings {
  /** Uncoloured tags get a colour from their name (true) or stay neutral grey (false). */
  auto_color: boolean
  /** Anyone who can edit an object may add a brand-new tag to it (true), or only people with tags.manage (false; others pick existing tags). */
  allow_new: boolean
}

export interface TagStyles {
  styles: TagStyle[]
  settings: TagSettings
}

/** Object types that carry tags, with the permission that lets the caller see their usage. */
export const TAG_OBJECT_TYPES = {
  // Task RLS is workspace-wide (the lists filter to own tasks), so counting tasks needs View all tasks.
  tasks: { label: 'Tasks', perm: ['tasks.view_all'] },
  workflows: { label: 'Workflows', perm: ['workflows.view'] },
  forms: { label: 'Forms', perm: ['forms.view'] },
  integrations: { label: 'Integrations', perm: ['integrations.view'] },
  references: { label: 'References', perm: ['integrations.view'] },
  agents: { label: 'Agents', perm: ['agents.view'] },
  activities: { label: 'Workflow activities', perm: ['extensibility.view'] },
  data_tables: { label: 'Data tables', perm: ['data.view'] },
  reports: { label: 'Reports', perm: ['reports.view'] },
  business_rules: { label: 'Business rules', perm: ['workflows.view'] },
  email_templates: { label: 'Email templates', perm: ['workflows.view'] },
  form_controls: { label: 'Form controls', perm: ['extensibility.view'] },
  apps: { label: 'Apps', perm: ['apps.view'] },
  packages: { label: 'Packages', perm: ['packages.view'] },
} as const satisfies Record<string, { label: string; perm: readonly string[] }>

export type TagObjectType = keyof typeof TAG_OBJECT_TYPES

/**
 * Types counted and listed here rather than by the SQL functions, so the
 * caller sees exactly what that type's own reads show them: reports (own and
 * shared only — API keys and MCP bypass RLS, scopeReportRead applies), apps
 * (the audience / editors rule of listApps) and authored packages (a
 * service-role table behind packages.view).
 */
const SCOPED_TYPES: ReadonlySet<TagObjectType> = new Set(['reports', 'apps', 'packages'])

interface ScopedRow { id: string; name: string; tags: string[]; slug?: string | null }

async function scopedRows(ctx: ServiceContext, type: TagObjectType): Promise<ScopedRow[]> {
  const clean = (rows: any[]): ScopedRow[] => rows
    .filter((r) => Array.isArray(r.tags) && r.tags.length)
    .map((r) => ({ id: String(r.id), name: String(r.name ?? ''), tags: (r.tags as unknown[]).map(String), slug: r.slug ?? null }))
  if (type === 'reports') {
    const query = (getDb(ctx) as any).from('reports').select('id, name, tags').eq('tenant_id', ctx.tenantId).limit(5000)
    const { data, error } = await scopeReportRead(query, ctx.authKind === 'session' ? null : ctx.actorId)
    if (error) { if (isMissingTagsColumn(error)) return []; throw dbError(error, 'Failed to read report tags') }
    return clean(data ?? [])
  }
  if (type === 'packages') {
    const admin = await serviceRoleClient(ctx)
    const { data, error } = await (admin as any).from('packages').select('id, name, slug, tags').eq('tenant_id', ctx.tenantId).limit(5000)
    if (error) { if (isMissingTagsColumn(error)) return []; throw dbError(error, 'Failed to read package tags') }
    return clean(data ?? [])
  }
  if (type === 'apps') {
    return clean(await listApps(ctx))
  }
  return []
}

export interface TagSummary {
  name: string
  key: string
  /** The colour chips show (chosen, else automatic / neutral). */
  color: TagColorToken
  /** The chosen colour, null when automatic. */
  chosen_color: TagColorToken | null
  description: string | null
  /** Has a row in the registry (a colour or description was set). */
  styled: boolean
  /** Objects carrying the tag, per type the caller may view. */
  usage: Partial<Record<TagObjectType, number>>
  total: number
}

const STYLE_COLUMNS = 'name, name_key, color, description, updated_at'

/** PostgREST / Postgres "relation does not exist" (the migration isn't applied yet). */
function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202' || error.code === '42883'
    || /tag_styles|tag_usage|rename_tag/.test(String(error.message ?? '')) && /does not exist|could not find|schema cache/i.test(String(error.message ?? ''))
}

function notApplied(): ServiceError {
  return new ServiceError('internal', `Tag colours need database migration ${TAG_STYLES_MIGRATION}; ask your administrator to apply it`, { status: 503 })
}

function toStyle(row: any): TagStyle {
  return {
    name: String(row.name),
    key: String(row.name_key ?? tagKey(row.name)),
    color: isTagColorToken(row.color) ? row.color : null,
    description: row.description ?? null,
    updated_at: row.updated_at ?? null,
  }
}

export function settingsFromTenant(settings: unknown): TagSettings {
  const tags = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as any).tags : null
  const obj = tags && typeof tags === 'object' ? tags : {}
  return { auto_color: obj.auto_color !== false, allow_new: obj.allow_new !== false }
}

async function readSettings(db: AnySupabaseClient, tenantId: string): Promise<TagSettings> {
  const { data } = await (db as any).from('tenants').select('settings').eq('id', tenantId).maybeSingle()
  return settingsFromTenant(data?.settings)
}

async function readStyles(db: AnySupabaseClient, tenantId: string): Promise<TagStyle[]> {
  const { data, error } = await (db as any).from('tag_styles').select(STYLE_COLUMNS).eq('tenant_id', tenantId).order('name_key').limit(5000)
  if (error) {
    if (isMissingRelation(error)) return []
    throw dbError(error, 'Failed to load tag styles')
  }
  return ((data ?? []) as any[]).map(toStyle)
}

/** Every style of the workspace and the auto-colour switch (any member). */
export async function listTagStyles(ctx: ServiceContext): Promise<TagStyles> {
  if (!ctx.tenantId) return { styles: [], settings: { auto_color: true, allow_new: true } }
  const db = getDb(ctx)
  const [styles, settings] = await Promise.all([readStyles(db, ctx.tenantId), readSettings(db, ctx.tenantId)])
  return { styles, settings }
}

/**
 * Tags in use across the workspace's objects, merged with the registry
 * (styled tags with no uses are listed too, with total 0). Usage counts
 * only object types the caller may view.
 */
export async function listTags(ctx: ServiceContext, input: { q?: string | null } = {}): Promise<{ tags: TagSummary[]; settings: TagSettings; object_types: Array<{ type: TagObjectType; label: string }> }> {
  const { styles, settings } = await listTagStyles(ctx)
  const visibleTypes = (Object.keys(TAG_OBJECT_TYPES) as TagObjectType[])
    .filter((t) => TAG_OBJECT_TYPES[t].perm.some((p) => hasPerm(ctx, p)))
  const byKey = new Map<string, TagSummary>()
  for (const s of styles) {
    byKey.set(s.key, {
      name: s.name, key: s.key, color: resolveTagColor(s.name, s.color, settings.auto_color), chosen_color: s.color,
      description: s.description, styled: true, usage: {}, total: 0,
    })
  }
  if (visibleTypes.length && ctx.tenantId) {
    // SECURITY INVOKER: a signed-in caller counts only the rows RLS shows them;
    // reports, apps and packages are counted by their own read rules.
    const scoped = visibleTypes.filter((t) => SCOPED_TYPES.has(t))
    const scopedUsage = (await Promise.all(scoped.map(async (type) => scopedUsageRows(type, await scopedRows(ctx, type))))).flat()
    for (const row of [...(await usageRows(ctx)).filter((r) => !SCOPED_TYPES.has(r.object_type)), ...scopedUsage]) {
      const type = row.object_type as TagObjectType
      if (!visibleTypes.includes(type)) continue
      const key = String(row.name_key)
      let entry = byKey.get(key)
      if (!entry) {
        const name = cleanTagName(row.name) || key
        entry = { name, key, color: resolveTagColor(name, null, settings.auto_color), chosen_color: null, description: null, styled: false, usage: {}, total: 0 }
        byKey.set(key, entry)
      }
      const uses = Number(row.uses) || 0
      entry.usage[type] = (entry.usage[type] ?? 0) + uses
      entry.total += uses
    }
  }
  const q = tagKey(input.q ?? '')
  const tags = [...byKey.values()]
    .filter((t) => !q || t.key.includes(q) || (t.description ?? '').toLowerCase().includes(q))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
  return { tags, settings, object_types: visibleTypes.map((type) => ({ type, label: TAG_OBJECT_TYPES[type].label })) }
}

/** tag_usage rows for one scoped type: per tag key, the most used spelling and the objects carrying it. */
function scopedUsageRows(type: TagObjectType, rows: ScopedRow[]): Array<{ name_key: string; name: string; object_type: TagObjectType; uses: number }> {
  const byKey = new Map<string, { ids: Set<string>; spellings: Map<string, number> }>()
  for (const row of rows) {
    for (const tag of row.tags) {
      const key = tagKey(tag)
      if (!key) continue
      const entry = byKey.get(key) ?? { ids: new Set<string>(), spellings: new Map<string, number>() }
      entry.ids.add(row.id)
      const spelling = cleanTagName(tag)
      entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? 0) + 1)
      byKey.set(key, entry)
    }
  }
  return [...byKey].map(([key, entry]) => ({
    name_key: key,
    name: [...entry.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    object_type: type,
    uses: entry.ids.size,
  }))
}

async function usageRows(ctx: ServiceContext): Promise<any[]> {
  const { data, error } = await (getDb(ctx) as any).rpc('tag_usage', { p_tenant_id: ctx.tenantId })
  if (error && !isMissingRelation(error)) throw dbError(error, 'Failed to count tags')
  return (data ?? []) as any[]
}

/** Every tag spelling the caller can see (registry + in use), by key: the existing spelling wins when someone types another case. */
export async function knownTagSpellings(ctx: ServiceContext): Promise<Map<string, string>> {
  const { tags } = await listTags(ctx)
  return new Map(tags.map((t) => [t.key, t.name]))
}

export interface TagSuggestion { name: string; key: string; color: TagColorToken; total: number; description: string | null }

/**
 * Rank tags for an autocomplete: exact key first, then names starting with
 * the text, then names containing it (or its description); ties by usage,
 * then name. Case- and whitespace-insensitive. Pure.
 */
export function rankTagSuggestions<T extends { key: string; total: number; description?: string | null }>(tags: readonly T[], q: string, limit = 10): T[] {
  const key = tagKey(q)
  const score = (t: T) => (!key ? 3 : t.key === key ? 0 : t.key.startsWith(key) ? 1 : t.key.split(/[\s\-_/]+/).some((w) => w.startsWith(key)) ? 2 : t.key.includes(key) ? 3 : (t.description ?? '').toLowerCase().includes(key) ? 4 : 9)
  return tags.map((t) => ({ t, s: score(t) })).filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || b.t.total - a.t.total || a.t.key.localeCompare(b.t.key))
    .slice(0, Math.max(1, Math.min(50, limit))).map((x) => x.t)
}

/** Autocomplete: the workspace's tags matching the text, ranked, with colour and usage; plus whether the caller may create a new one. */
export async function suggestTags(ctx: ServiceContext, input: { q?: string | null; limit?: number | null } = {}): Promise<{ suggestions: TagSuggestion[]; exact: TagSuggestion | null; can_create: boolean }> {
  const { tags, settings } = await listTags(ctx)
  const ranked = rankTagSuggestions(tags, input.q ?? '', input.limit ?? 10)
  const toSuggestion = (t: TagSummary): TagSuggestion => ({ name: t.name, key: t.key, color: t.color, total: t.total, description: t.description })
  const key = tagKey(input.q ?? '')
  const exact = key ? tags.find((t) => t.key === key) ?? null : null
  return { suggestions: ranked.map(toSuggestion), exact: exact ? toSuggestion(exact) : null, can_create: settings.allow_new || hasPerm(ctx, 'tags.manage') }
}

/**
 * The objects of one type carrying a tag, by name, paged (Settings → Tags
 * detail panel). Needs the type's view permission; RLS (SECURITY INVOKER
 * public.tag_objects on the caller's client) hides what they may not see.
 */
export async function listTagObjects(ctx: ServiceContext, input: { name: unknown; type: unknown; limit?: number | null; offset?: number | null }): Promise<{ type: TagObjectType; items: Array<{ id: string; name: string; href: string }>; total: number; limit: number; offset: number }> {
  const type = input.type as TagObjectType
  if (!(type in TAG_OBJECT_TYPES)) throw ServiceError.validation(`type must be one of ${Object.keys(TAG_OBJECT_TYPES).join(', ')}`)
  if (!TAG_OBJECT_TYPES[type].perm.some((p) => hasPerm(ctx, p))) throw ServiceError.forbidden(`Forbidden: you can't view ${TAG_OBJECT_TYPES[type].label.toLowerCase()}`)
  const name = validName(input.name)
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 20))
  const offset = Math.max(0, Number(input.offset) || 0)
  if (SCOPED_TYPES.has(type)) {
    const key = tagKey(name)
    const hits = (await scopedRows(ctx, type)).filter((r) => r.tags.some((t) => tagKey(t) === key))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id))
    return {
      type,
      items: hits.slice(offset, offset + limit).map((r) => ({ id: r.id, name: r.name || 'Untitled', href: tagObjectHref(type, r.id, r.name, null, r.slug ?? null) })),
      total: hits.length,
      limit, offset,
    }
  }
  const { data, error } = await (getDb(ctx) as any).rpc('tag_objects', { p_tenant_id: ctx.tenantId, p_key: name, p_type: type, p_limit: limit, p_offset: offset })
  if (error) throw isMissingRelation(error) ? notApplied() : dbError(error, 'Failed to list the tagged objects')
  const rows = (data ?? []) as any[]
  return {
    type,
    items: rows.map((r) => ({ id: String(r.id), name: String(r.name ?? 'Untitled'), href: tagObjectHref(type, String(r.id), String(r.name ?? ''), r.parent_id ?? null) })),
    total: rows.length ? Number(rows[0].total) : 0,
    limit, offset,
  }
}

/** Where an object opens in the app. */
export function tagObjectHref(type: TagObjectType, id: string, name: string, parentId: string | null, slug: string | null = null): string {
  switch (type) {
    case 'tasks': return `/tasks/${encodeURIComponent(id)}`
    case 'workflows': return `/automations/${encodeURIComponent(id)}`
    case 'forms': return `/automations/forms/${encodeURIComponent(id)}`
    case 'integrations': return `/integrations/${encodeURIComponent(id)}`
    case 'references': return parentId ? `/integrations/${encodeURIComponent(parentId)}` : `/integrations?tab=references&q=${encodeURIComponent(name)}`
    case 'agents': return `/agents/${encodeURIComponent(id)}`
    case 'activities': return `/extensibility?q=${encodeURIComponent(name)}`
    case 'data_tables': return `/data/${encodeURIComponent(id)}`
    case 'reports': return `/reports/${encodeURIComponent(id)}`
    case 'business_rules': return `/automations/rules/${encodeURIComponent(id)}`
    case 'email_templates': return `/automations/email-templates?open=${encodeURIComponent(id)}`
    case 'form_controls': return `/extensibility?tab=form-controls&q=${encodeURIComponent(name)}`
    case 'apps': return `/apps/${encodeURIComponent(slug || id)}`
    case 'packages': return `/packages?tab=authored&q=${encodeURIComponent(name)}`
  }
}

/**
 * Remove a tag from every object of the workspace and drop its style
 * (tags.manage). One transaction (public.remove_tag); audited.
 */
export async function removeTag(ctx: ServiceContext, input: { name: unknown }): Promise<{ name: string; objects: Record<TagObjectType, number>; total: number }> {
  requirePerm(ctx, 'tags.manage')
  if (!ctx.tenantId) throw ServiceError.validation('Pick a workspace first')
  const name = validName(input.name)
  const admin = await serviceRoleClient(ctx)
  const { data, error } = await (admin as any).rpc('remove_tag', { p_tenant_id: ctx.tenantId, p_name: name })
  if (error) throw isMissingRelation(error) ? notApplied() : dbError(error, 'Failed to remove the tag')
  const objects = Object.fromEntries((Object.keys(TAG_OBJECT_TYPES) as TagObjectType[]).map((t) => [t, Number(data?.objects?.[t] ?? 0)])) as Record<TagObjectType, number>
  const total = Object.values(objects).reduce((a, b) => a + b, 0)
  await audit(ctx, {
    objectType: 'tag', objectId: ctx.tenantId, action: 'delete',
    summary: `Removed tag "${name}" from ${total} object${total === 1 ? '' : 's'}`,
    diff: { name: { before: name, after: null } }, metadata: { objects },
  })
  return { name, objects, total }
}

function validName(name: unknown, field = 'name'): string {
  const clean = cleanTagName(name)
  if (!clean || clean.length > TAG_NAME_MAX) throw ServiceError.validation(`${field} must be 1-${TAG_NAME_MAX} characters`)
  return clean
}

function validColor(color: unknown): TagColorToken | null {
  if (color === null || color === undefined || color === '' || color === 'auto') return null
  if (!isTagColorToken(color)) throw ServiceError.validation(`color must be one of ${TAG_COLOR_TOKENS.join(', ')} or auto`)
  return color
}

function validDescription(description: unknown): string | null {
  if (description === null || description === undefined) return null
  const text = String(description).trim()
  if (text.length > TAG_DESCRIPTION_MAX) throw ServiceError.validation(`description must be at most ${TAG_DESCRIPTION_MAX} characters`)
  return text || null
}

/**
 * Set a tag's colour and / or description (tags.manage). Send only what
 * changes: `color` "auto" (or null) goes back to the automatic colour,
 * `description` "" clears it. A tag left with neither is removed from the
 * registry (returns its automatic look, styled false) unless `keep` is true
 * (creating a tag ahead of use: a registry row with the automatic colour).
 */
export async function setTagStyle(ctx: ServiceContext, input: { name: unknown; color?: unknown; description?: unknown; keep?: unknown }): Promise<TagStyle & { styled: boolean }> {
  requirePerm(ctx, 'tags.manage')
  if (!ctx.tenantId) throw ServiceError.validation('Pick a workspace first')
  const name = validName(input.name)
  const key = tagKey(name)
  const db = getDb(ctx)
  const { data: existing, error: readError } = await (db as any).from('tag_styles').select(`id, ${STYLE_COLUMNS}`)
    .eq('tenant_id', ctx.tenantId).eq('name_key', key).maybeSingle()
  if (readError) throw isMissingRelation(readError) ? notApplied() : dbError(readError, 'Failed to load the tag')
  const color = input.color !== undefined ? validColor(input.color) : (existing ? (isTagColorToken(existing.color) ? existing.color : null) : null)
  const description = input.description !== undefined ? validDescription(input.description) : (existing?.description ?? null)
  const before = existing ? { color: existing.color ?? null, description: existing.description ?? null } : null

  if (color === null && description === null && input.keep !== true) {
    if (existing) {
      const { error } = await (db as any).from('tag_styles').delete().eq('id', existing.id).eq('tenant_id', ctx.tenantId)
      if (error) throw dbError(error, 'Failed to reset the tag')
      await audit(ctx, { objectType: 'tag', objectId: existing.id, action: 'delete', summary: `Reset tag "${existing.name}" to its automatic colour`, diff: { style: { before, after: null } } })
    }
    return { name: existing?.name ?? name, key, color: null, description: null, updated_at: null, styled: false }
  }

  const values = { color, description, updated_by: ctx.actorId }
  const query = existing
    ? (db as any).from('tag_styles').update(values).eq('id', existing.id).eq('tenant_id', ctx.tenantId)
    : (db as any).from('tag_styles').insert({ ...values, tenant_id: ctx.tenantId, name, created_by: ctx.actorId })
  const { data, error } = await query.select(`id, ${STYLE_COLUMNS}`).single()
  if (error || !data) {
    if (isMissingRelation(error)) throw notApplied()
    if (error?.code === '23505') throw ServiceError.conflict(`Tag "${name}" was just styled by someone else; reload and try again`)
    throw dbError(error, 'Failed to save the tag')
  }
  await audit(ctx, {
    objectType: 'tag', objectId: data.id, action: existing ? 'update' : 'create',
    summary: `${existing ? 'Changed' : 'Styled'} tag "${data.name}": ${color ?? 'automatic colour'}${description ? `, "${description}"` : ''}`,
    diff: { style: { before, after: { color, description } } },
  })
  return { ...toStyle(data), styled: true }
}

/** Remove a tag's style (tags.manage): it goes back to its automatic colour. The tag stays on its objects. */
export async function deleteTagStyle(ctx: ServiceContext, name: unknown): Promise<{ deleted: true }> {
  await setTagStyle(ctx, { name, color: null, description: null })
  return { deleted: true }
}

/**
 * Rename a tag on every object of the workspace (tags.manage). When `to`
 * is already a tag the two are merged: objects carrying both keep one,
 * and the target keeps its style (taking the source's colour /
 * description where it has none). One transaction; audited.
 */
export async function renameTag(ctx: ServiceContext, input: { from: unknown; to: unknown }): Promise<{ name: string; merged: boolean; objects: Record<TagObjectType, number>; total: number }> {
  requirePerm(ctx, 'tags.manage')
  if (!ctx.tenantId) throw ServiceError.validation('Pick a workspace first')
  const from = validName(input.from, 'from')
  const to = validName(input.to, 'to')
  if (from === to) throw ServiceError.validation('The new name is the same as the old one')
  const admin = await serviceRoleClient(ctx)
  const { data, error } = await (admin as any).rpc('rename_tag', { p_tenant_id: ctx.tenantId, p_from: from, p_to: to, p_actor: ctx.actorId })
  if (error) throw isMissingRelation(error) ? notApplied() : dbError(error, 'Failed to rename the tag')
  const objects = Object.fromEntries((Object.keys(TAG_OBJECT_TYPES) as TagObjectType[]).map((t) => [t, Number(data?.objects?.[t] ?? 0)])) as Record<TagObjectType, number>
  const total = Object.values(objects).reduce((a, b) => a + b, 0)
  const merged = data?.merged === true
  await audit(ctx, {
    objectType: 'tag', objectId: ctx.tenantId, action: merged ? 'merge' : 'rename',
    summary: `${merged ? 'Merged' : 'Renamed'} tag "${from}" ${merged ? 'into' : 'to'} "${to}" on ${total} object${total === 1 ? '' : 's'}`,
    diff: { name: { before: from, after: to } },
    metadata: { objects },
  })
  return { name: String(data?.name ?? to), merged, objects, total }
}

/** Switch automatic tag colours on or off (tags.manage); other workspace settings are kept. */
export async function updateTagSettings(ctx: ServiceContext, input: { auto_color?: unknown; allow_new?: unknown }): Promise<TagSettings> {
  requirePerm(ctx, 'tags.manage')
  if (!ctx.tenantId) throw ServiceError.validation('Pick a workspace first')
  if (input.auto_color !== undefined && typeof input.auto_color !== 'boolean') throw ServiceError.validation('auto_color must be true or false')
  if (input.allow_new !== undefined && typeof input.allow_new !== 'boolean') throw ServiceError.validation('allow_new must be true or false')
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('id, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? { ...data.settings } : {}
  const before = settingsFromTenant(settings)
  const next: TagSettings = {
    auto_color: input.auto_color === undefined ? before.auto_color : input.auto_color as boolean,
    allow_new: input.allow_new === undefined ? before.allow_new : input.allow_new as boolean,
  }
  settings.tags = { ...(settings.tags && typeof settings.tags === 'object' ? settings.tags : {}), auto_color: next.auto_color, allow_new: next.allow_new }
  const { error: writeError } = await (db as any).from('tenants').update({ settings }).eq('id', ctx.tenantId)
  if (writeError) throw dbError(writeError)
  const diff: Record<string, { before: unknown; after: unknown }> = {}
  if (before.auto_color !== next.auto_color) diff['tags.auto_color'] = { before: before.auto_color, after: next.auto_color }
  if (before.allow_new !== next.allow_new) diff['tags.allow_new'] = { before: before.allow_new, after: next.allow_new }
  if (Object.keys(diff).length) {
    const parts = [
      ...(diff['tags.auto_color'] ? [`automatic tag colours ${next.auto_color ? 'on' : 'off'}`] : []),
      ...(diff['tags.allow_new'] ? [`new tags by ${next.allow_new ? 'anyone who can edit' : 'tag managers only'}`] : []),
    ]
    await audit(ctx, { objectType: 'workspace', objectId: ctx.tenantId, action: 'update', summary: `Tag settings: ${parts.join(', ')}`, diff })
  }
  return next
}
