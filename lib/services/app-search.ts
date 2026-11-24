/**
 * App builder pickers (Phase 2): server-side search with paging for every
 * object / principal input in the builder (widget settings, page filters,
 * menu entries, app settings) and the page filter bar.
 *
 * Reads run on the caller's SESSION client (RLS applies) and on top of it
 * the permission each object's own screens need, so a picker only lists
 * what the person using it may see:
 *  - mode 'design' (builder): the caller must be able to edit the app; the
 *    list is what the DESIGNER can see.
 *  - mode 'filter' (page filter bar): anyone who can open the app; the list
 *    is what the VIEWER can see.
 *
 * Every result carries a name plus secondary information (status, owner,
 * row count, team size, email / avatar) for the picker's second line.
 */

import { z } from 'zod'
import { escapeLikePattern } from '@/lib/utils'
import { getDb, hasPerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'
import { getAppAccess } from './apps'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped joins */

export const PICKER_KINDS = ['workflow', 'form', 'table', 'report', 'team', 'user', 'role', 'agent', 'reference', 'page', 'column', 'view'] as const
export type PickerKind = (typeof PICKER_KINDS)[number]

export const PICKER_PAGE_SIZE = 20
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const pickerSearchSchema = z.object({
  app: z.string().min(1).max(80),
  kind: z.enum(PICKER_KINDS),
  q: z.string().max(100).optional(),
  offset: z.number().int().min(0).max(10_000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  /** Resolve these ids (labels for chosen values) instead of searching. */
  ids: z.array(z.string().max(80)).max(50).optional(),
  /** column / view: the data table they belong to. */
  table: z.string().max(80).nullable().optional(),
  mode: z.enum(['design', 'filter']).optional(),
}).strict()
export type PickerSearchInput = z.infer<typeof pickerSearchSchema>

export interface PickerItem {
  id: string
  name: string
  /** Second line: status, owner, counts, email… */
  hint: string | null
  /** Users: avatar image URL. */
  avatar?: string | null
  /** Columns: the column type. */
  type?: string
}

export interface PickerResult {
  items: PickerItem[]
  /** Offset of the next page, null at the end. */
  next: number | null
  /** The caller can't see this kind at all (missing permission): the picker says so. */
  denied?: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
const countOf = (v: unknown): number => (Array.isArray(v) ? Number((v[0] as any)?.count ?? 0) : Number((v as any)?.count ?? 0)) || 0
export const personName = (u: { display_name?: string | null; email?: string | null } | null | undefined): string =>
  String(u?.display_name || (u?.email ? String(u.email).split('@')[0] : '') || 'Someone')

/** Second-line text per kind (pure; tested). */
export function pickerHint(kind: PickerKind, row: Record<string, any>): string | null {
  switch (kind) {
    case 'workflow': {
      const parts = [row.is_active ? 'Active' : row.published_version_id ? 'Inactive' : 'Draft']
      if (row.trigger_type) parts.push(String(row.trigger_type).replace(/_/g, ' '))
      if (typeof row.run_count === 'number') parts.push(plural(row.run_count, 'run'))
      return parts.join(' · ')
    }
    case 'form': {
      const parts: string[] = []
      if (row.owner) parts.push(`Owner ${row.owner}`)
      if (row.version) parts.push(`v${row.version}`)
      return parts.join(' · ') || null
    }
    case 'table': {
      const cols = Array.isArray(row.columns) ? row.columns.length : 0
      return `${plural(countOf(row.row_count), 'row')} · ${plural(cols, 'column')}`
    }
    case 'report': return [row.category ? String(row.category) : null, row.is_shared ? 'Shared' : 'Private'].filter(Boolean).join(' · ')
    case 'team': return plural(countOf(row.member_count), 'member')
    case 'user': return row.email ?? null
    case 'role': return row.description ? String(row.description).slice(0, 80) : null
    case 'agent': return [row.model, row.is_active === false ? 'Inactive' : null].filter(Boolean).join(' · ') || null
    case 'reference': return row.integration?.name ? String(row.integration.name) : null
    default: return null
  }
}

const like = (q: string) => `%${escapeLikePattern(q.trim())}%`

/** Search (or resolve ids of) one kind, as the caller may see it. */
export async function searchPicker(ctx: ServiceContext, input: PickerSearchInput): Promise<PickerResult> {
  const args = pickerSearchSchema.parse(input)
  const mode = args.mode ?? 'design'
  const access = await getAppAccess(ctx, args.app)
  if (!access || (mode === 'design' && access !== 'edit')) throw ServiceError.notFound('App not found')
  return searchKind(ctx, args)
}

/**
 * Builder search without an open app (the AI Agent / MCP apps_search, before
 * an app exists): for people who may build apps (apps.manage) — or, with
 * `app`, edit that app. Same per-kind permissions as the pickers.
 */
export const builderSearchSchema = pickerSearchSchema.omit({ app: true, mode: true }).extend({ app: z.string().min(1).max(80).nullable().optional() })
export type BuilderSearchInput = z.infer<typeof builderSearchSchema>

export async function searchForBuilder(ctx: ServiceContext, input: BuilderSearchInput): Promise<PickerResult> {
  const args = builderSearchSchema.parse(input)
  if (args.app) return searchPicker(ctx, { ...args, app: args.app, mode: 'design' })
  if (args.kind === 'page') return { items: [], next: null }
  if (!hasPerm(ctx, 'apps.manage')) throw ServiceError.forbidden('Searching without an app needs Build apps (apps.manage) — pass the app you are editing')
  return searchKind(ctx, { ...args, app: '' })
}

async function searchKind(ctx: ServiceContext, args: PickerSearchInput): Promise<PickerResult> {
  const db = getDb(ctx) as any
  const t = ctx.tenantId
  const q = (args.q ?? '').trim()
  const offset = args.offset ?? 0
  const limit = args.limit ?? PICKER_PAGE_SIZE
  const ids = args.ids?.filter((id) => id.length > 0)
  const uuidIds = ids?.filter((id) => UUID_RE.test(id))
  const page = (query: any) => {
    let out = query
    if (ids) out = out.in('id', uuidIds ?? [])
    else if (q) out = out.ilike('name', like(q))
    return ids ? out : out.range(offset, offset + limit)
  }
  const finish = (items: PickerItem[]): PickerResult => {
    if (ids) return { items, next: null }
    return { items: items.slice(0, limit), next: items.length > limit ? offset + limit : null }
  }
  const denied = (permission: string): PickerResult => ({ items: [], next: null, denied: permission })
  if (ids && !uuidIds?.length && args.kind !== 'page' && args.kind !== 'column' && args.kind !== 'view') return { items: [], next: null }

  switch (args.kind) {
    case 'workflow': {
      if (!hasPerm(ctx, 'workflows.view')) return denied('workflows.view')
      const { data, error } = await page(db.from('workflows').select('id, name, is_active, published_version_id, trigger_type, run_count').eq('tenant_id', t).order('name'))
      if (error) throw dbError(error)
      return finish(((data ?? []) as any[]).map((r) => ({ id: String(r.id), name: String(r.name ?? 'Workflow'), hint: pickerHint('workflow', r) })))
    }
    case 'form': {
      if (!hasPerm(ctx, 'forms.view') && !hasPerm(ctx, 'forms.edit') && !hasPerm(ctx, 'forms.submit')) return denied('forms.view')
      const { data, error } = await page(db.from('forms').select('id, name, version, created_by').eq('tenant_id', t).order('name'))
      if (error) throw dbError(error)
      const rows = (data ?? []) as any[]
      const owners = await userNames(db, rows.map((r) => r.created_by))
      return finish(rows.map((r) => ({ id: String(r.id), name: String(r.name ?? 'Form'), hint: pickerHint('form', { ...r, owner: owners.get(r.created_by) }) })))
    }
    case 'table': {
      if (!hasPerm(ctx, 'data.view')) return denied('data.view')
      const { data, error } = await page(db.from('custom_tables').select('id, name, columns, row_count:custom_table_rows(count)').eq('tenant_id', t).order('name'))
      if (error) throw dbError(error)
      return finish(((data ?? []) as any[]).map((r) => ({ id: String(r.id), name: String(r.name ?? 'Data table'), hint: pickerHint('table', r) })))
    }
    case 'column':
    case 'view': {
      if (!hasPerm(ctx, 'data.view')) return denied('data.view')
      if (!args.table || !UUID_RE.test(args.table)) return { items: [], next: null }
      const { data, error } = await db.from('custom_tables').select('id, columns, views').eq('tenant_id', t).eq('id', args.table).maybeSingle()
      if (error) throw dbError(error)
      const list = args.kind === 'column'
        ? ((Array.isArray(data?.columns) ? data.columns : []) as any[]).filter((c) => c?.key).map((c) => ({ id: String(c.key), name: String(c.name ?? c.key), hint: String(c.type ?? 'text'), type: String(c.type ?? 'text') }))
        : ((Array.isArray(data?.views) ? data.views : []) as any[]).filter((v) => v?.id).map((v) => ({ id: String(v.id), name: String(v.name ?? 'View'), hint: v.shared === false ? 'Private view' : null }))
      return localPage(list, { q, ids, offset, limit })
    }
    case 'report': {
      if (!hasPerm(ctx, 'reports.view')) return denied('reports.view')
      let query = db.from('reports').select('id, name, category, is_shared, created_by').eq('tenant_id', t).order('name')
      if (ctx.actorId && UUID_RE.test(ctx.actorId)) query = query.or(`is_shared.eq.true,created_by.eq.${ctx.actorId}`)
      const { data, error } = await page(query)
      if (error) throw dbError(error)
      return finish(((data ?? []) as any[]).map((r) => ({ id: String(r.id), name: String(r.name ?? 'Report'), hint: pickerHint('report', r) })))
    }
    case 'team': {
      if (!hasPerm(ctx, 'team.view_members')) {
        // Without View members: only the caller's own teams.
        const { data, error } = await db.from('user_teams').select('team:teams!inner(id, name, tenant_id, member_count:user_teams(count))').eq('user_id', ctx.actorId).eq('team.tenant_id', t)
        if (error) throw dbError(error)
        const list = ((data ?? []) as any[]).filter((x) => x.team).map((x) => ({ id: String(x.team.id), name: String(x.team.name ?? 'Team'), hint: pickerHint('team', x.team) }))
        return localPage(list, { q, ids, offset, limit })
      }
      const { data, error } = await page(db.from('teams').select('id, name, member_count:user_teams(count)').eq('tenant_id', t).order('name'))
      if (error) throw dbError(error)
      return finish(((data ?? []) as any[]).map((r) => ({ id: String(r.id), name: String(r.name ?? 'Team'), hint: pickerHint('team', r) })))
    }
    case 'user': {
      if (!hasPerm(ctx, 'team.view_members')) {
        // Without View members: only themselves.
        const { data } = await db.from('users').select('id, display_name, email, avatar_url').eq('id', ctx.actorId).maybeSingle()
        const list = data ? [{ id: String(data.id), name: personName(data), hint: data.email ?? null, avatar: data.avatar_url ?? null }] : []
        return localPage(list, { q, ids, offset, limit })
      }
      let query = db.from('user_memberships').select('user_id, user:users!inner(id, display_name, email, avatar_url)').eq('tenant_id', t).eq('is_active', true).order('user_id')
      if (ids) query = query.in('user_id', uuidIds)
      else if (q) query = query.or(`display_name.ilike.${like(q).replace(/[,()]/g, ' ')},email.ilike.${like(q).replace(/[,()]/g, ' ')}`, { referencedTable: 'user' })
      if (!ids) query = query.range(offset, offset + limit)
      const { data, error } = await query
      if (error) throw dbError(error)
      const rows = ((data ?? []) as any[]).filter((m) => m.user)
      return finish(rows.map((m) => ({ id: String(m.user_id), name: personName(m.user), hint: pickerHint('user', m.user), avatar: m.user.avatar_url ?? null })))
    }
    case 'role': {
      const { data, error } = await page(db.from('roles').select('id, name, description').eq('tenant_id', t).order('name'))
      if (error) throw dbError(error)
      return finish(((data ?? []) as any[]).map((r) => ({ id: String(r.id), name: String(r.name ?? 'Role'), hint: pickerHint('role', r) })))
    }
    case 'agent': {
      if (!hasPerm(ctx, 'agents.view')) return denied('agents.view')
      const { data, error } = await page(db.from('agents').select('id, name, model, is_active').eq('tenant_id', t).order('name'))
      if (error) throw dbError(error)
      return finish(((data ?? []) as any[]).map((r) => ({ id: String(r.id), name: String(r.name ?? 'Agent'), hint: pickerHint('agent', r) })))
    }
    case 'reference': {
      if (!hasPerm(ctx, 'integrations.view')) return denied('integrations.view')
      const { data, error } = await page(db.from('integration_references').select('id, name, integration:integrations(name)').eq('tenant_id', t).order('name'))
      if (error) throw dbError(error)
      return finish(((data ?? []) as any[]).map((r) => ({ id: String(r.id), name: String(r.name ?? 'API reference'), hint: pickerHint('reference', r) })))
    }
    case 'page': {
      // Pages of this app (slugs), for links and "open page" actions.
      const { data: app } = await db.from('apps').select('id').eq('tenant_id', t).or(UUID_RE.test(args.app) ? `id.eq.${args.app}` : `slug.eq.${args.app}`).maybeSingle()
      if (!app) return { items: [], next: null }
      const { data, error } = await db.from('app_pages').select('slug, title, position').eq('tenant_id', t).eq('app_id', app.id).order('position')
      if (error) throw dbError(error)
      return localPage(((data ?? []) as any[]).map((p) => ({ id: String(p.slug), name: String(p.title ?? p.slug), hint: `/${p.slug}` })), { q, ids, offset, limit })
    }
  }
}

function localPage(list: PickerItem[], o: { q: string; ids?: string[]; offset: number; limit: number }): PickerResult {
  if (o.ids) return { items: list.filter((i) => o.ids!.includes(i.id)), next: null }
  const needle = o.q.toLowerCase()
  const hits = needle ? list.filter((i) => i.name.toLowerCase().includes(needle) || (i.hint ?? '').toLowerCase().includes(needle)) : list
  const items = hits.slice(o.offset, o.offset + o.limit)
  return { items, next: hits.length > o.offset + o.limit ? o.offset + o.limit : null }
}

async function userNames(db: any, ids: unknown[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  const { data } = await db.from('users').select('id, display_name, email').in('id', unique)
  for (const u of (data ?? []) as any[]) out.set(String(u.id), personName(u))
  return out
}
