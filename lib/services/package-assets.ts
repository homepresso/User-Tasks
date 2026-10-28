/**
 * Packages — asset search for the package editor: one paged, server-side
 * search across every artifact type a package can carry (workflows, custom
 * steps, data tables, integrations (and their references), connectors,
 * decision tables, email templates, agents, reports, roles, MCP servers,
 * retention policies, log destinations), built for workspaces with thousands
 * of assets.
 *
 * Shared by GET /api/v1/packages/assets, MCP packages_assets_search,
 * `usertasks packages assets` / `packages add --search` and the Settings →
 * Packages picker.
 *
 * - Tenant-scoped; packages.view plus, per type, the view permission that
 *   building a package of it needs (PACKAGE_ASSET_TYPES) — types the caller
 *   may not view are left out (and listed in `hidden_types`).
 * - One query per permitted type, in parallel, each `LIMIT page + 1` on the
 *   tenant index; results are merged in JS.
 * - Keyset paging: the cursor holds the last row returned *per type*, so each
 *   type resumes in its own database order (no OFFSET, no skipped or repeated
 *   rows whatever the collation).
 * - Search is a case-insensitive substring match (ILIKE, wildcards escaped)
 *   on the name and description; integrations also match by the names of
 *   their references.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role client */

import { DEPENDENCY_TYPES, resolveDependencyClosure, type AssetRef, type DependencyAssetType } from '@/lib/portability/dependencies'
import { escapeLikePattern } from '@/lib/utils'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'
import { PACKAGE_ASSET_TYPES, PACKAGE_LIMITS } from './packages'

export type AssetSort = 'name' | 'updated'

export interface AssetSearchInput {
  /** Text matched against the name and description (and integration reference names). */
  search?: string | null
  /** Asset types (array or comma-separated); default every type the caller may view. */
  types?: string[] | string | null
  /** Tag (workflows, custom steps, integrations, agents) or report category. */
  tag?: string | null
  /** Created by: a user id, or "me". */
  owner?: string | null
  /** Updated on or after: ISO date / timestamp, or relative (24h, 7d, 30d). */
  updated_since?: string | null
  sort?: AssetSort | null
  /** Page size, 1–100 (default 50). */
  limit?: number | null
  /** The previous page's next_cursor. */
  after?: string | null
  /** Package id or slug: mark each hit as in the package (root / added / dependency / left out). */
  package?: string | null
}

export type InPackage = 'root' | 'manual' | 'dependency' | 'excluded'

export interface AssetHit {
  type: DependencyAssetType
  id: string
  name: string
  label: string
  description: string | null
  updated_at: string | null
  created_by: string | null
  tags: string[]
  /** The reference whose name matched (integrations found through a reference). */
  matched_reference?: string
  in_package?: InPackage | null
}

export interface AssetSearchResult {
  assets: AssetHit[]
  /** Matches across all searched types (not just this page). */
  total: number
  /** Matches per type. */
  counts: Partial<Record<DependencyAssetType, number>>
  next_cursor: string | null
  /** Types searched, with labels (for filter chips). */
  types: Array<{ type: DependencyAssetType; label: string }>
  /** Types left out because the caller may not view them. */
  hidden_types: DependencyAssetType[]
  /** Tags and report categories in use (first page only). */
  facets?: { tags: string[] }
}

interface Source {
  table: string
  name: string
  description?: boolean
  tags?: boolean
  category?: boolean
  owner?: boolean
  /** Extra filters (e.g. hide system roles). */
  scope?: (query: any) => any
}

/** Where each type lives. Connector-generated integrations travel as their connector, so they are not listed as integrations. */
export const ASSET_SOURCES: Record<DependencyAssetType, Source> = {
  workflow: { table: 'workflows', name: 'name', description: true, tags: true, owner: true },
  workflow_activity: { table: 'custom_workflow_activities', name: 'name', description: true, tags: true, owner: true },
  data_table: { table: 'custom_tables', name: 'name', description: true, owner: true },
  integration: {
    table: 'integrations', name: 'name', tags: true, owner: true,
    scope: (q) => q.neq('name', '__objects__').not('name', 'like', '%(Connector)'),
  },
  connector: { table: 'tenant_connectors', name: 'display_name', owner: true },
  decision_table: { table: 'decision_tables', name: 'name', description: true, owner: true },
  email_template: { table: 'email_templates', name: 'name', description: true, owner: true },
  agent: { table: 'agents', name: 'name', description: true, tags: true, owner: true },
  report: { table: 'reports', name: 'name', description: true, category: true, owner: true },
  role: { table: 'roles', name: 'name', description: true, scope: (q) => q.eq('is_system', false) },
  mcp_server: { table: 'mcp_servers', name: 'name', description: true, owner: true },
  retention_policy: { table: 'retention_policies', name: 'name', description: true, owner: true },
  log_destination: { table: 'log_destinations', name: 'name', owner: true },
  form: { table: 'forms', name: 'name', description: true, tags: true, owner: true },
  form_theme: { table: 'form_themes', name: 'name', description: true, owner: true },
}

export const ASSET_SEARCH_MAX_LIMIT = 100
const DEFAULT_LIMIT = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── Input parsing ──────────────────────────────────────────────────────────

export function parseTypes(value: AssetSearchInput['types']): DependencyAssetType[] | null {
  if (value === undefined || value === null || value === '') return null
  const list = (Array.isArray(value) ? value : String(value).split(',')).map((t) => String(t).trim().replace(/-/g, '_')).filter(Boolean)
  if (!list.length) return null
  const out: DependencyAssetType[] = []
  for (const type of list) {
    if (!DEPENDENCY_TYPES.includes(type as DependencyAssetType)) throw ServiceError.validation(`type: unknown type "${type}" (expected ${DEPENDENCY_TYPES.join(', ')})`)
    if (!out.includes(type as DependencyAssetType)) out.push(type as DependencyAssetType)
  }
  return out
}

/** "7d" / "24h" / "2w" / ISO date → ISO timestamp. */
export function parseUpdatedSince(value: string | null | undefined, now = Date.now()): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const relative = /^(\d{1,4})\s*([hdw])$/i.exec(raw)
  if (relative) {
    const unit = { h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[relative[2].toLowerCase() as 'h' | 'd' | 'w']
    return new Date(now - Number(relative[1]) * unit).toISOString()
  }
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) throw ServiceError.validation('updated_since must be a date (YYYY-MM-DD), a timestamp or relative (24h, 7d, 4w)')
  return new Date(parsed).toISOString()
}

interface CursorState { s: AssetSort; f: string; p: Partial<Record<DependencyAssetType, [string, string]>> }

/** Filters a cursor belongs to (a cursor from another search is refused rather than misapplied). */
function filterKey(input: { search: string; types: string[]; tag: string; owner: string; since: string }) {
  return [input.search, input.types.join(','), input.tag, input.owner, input.since].join('\u0001')
}

function shortHash(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

export function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

export function decodeCursor(value: string | null | undefined): CursorState | null {
  if (!value) return null
  try {
    const state = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!state || (state.s !== 'name' && state.s !== 'updated') || typeof state.f !== 'string' || typeof state.p !== 'object' || Array.isArray(state.p)) throw new Error('shape')
    for (const [type, pos] of Object.entries(state.p)) {
      if (!DEPENDENCY_TYPES.includes(type as DependencyAssetType) || !Array.isArray(pos) || pos.length !== 2 || typeof pos[0] !== 'string' || !UUID.test(String(pos[1]))) throw new Error('position')
    }
    return state as CursorState
  } catch {
    throw ServiceError.validation('after: not a cursor from this search (pass the previous next_cursor unchanged)')
  }
}

/** A value inside a PostgREST or=() list: double-quoted, with " and \ escaped. */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** ILIKE pattern for a substring search, wildcards escaped (quote it for or=()). */
export function substringPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`
}

// ─── Search ─────────────────────────────────────────────────────────────────

const collator = new Intl.Collator('en', { sensitivity: 'base' })

function compareHits(sort: AssetSort) {
  return (a: AssetHit, b: AssetHit) => {
    const primary = sort === 'updated'
      ? String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))
      : collator.compare(a.name, b.name)
    return primary || a.type.localeCompare(b.type) || a.id.localeCompare(b.id)
  }
}

/**
 * k-way merge that keeps each type's rows in their database order (the order
 * the per-type cursor assumes), choosing between the heads with `compare`.
 */
export function mergeByType<T>(lists: T[][], compare: (a: T, b: T) => number, limit: number): T[] {
  const heads = lists.map(() => 0)
  const out: T[] = []
  while (out.length < limit) {
    let best = -1
    for (let i = 0; i < lists.length; i++) {
      if (heads[i] >= lists[i].length) continue
      if (best < 0 || compare(lists[i][heads[i]], lists[best][heads[best]]) < 0) best = i
    }
    if (best < 0) break
    out.push(lists[best][heads[best]++])
  }
  return out
}

async function packageMembership(ctx: ServiceContext, db: AnySupabaseClient, packageId: string): Promise<Map<string, InPackage>> {
  const column = UUID.test(packageId) ? 'id' : 'slug'
  const { data: pkg, error } = await (db as any).from('packages').select('roots, items, excluded').eq('tenant_id', ctx.tenantId).eq(column, packageId).maybeSingle()
  if (error) throw dbError(error)
  if (!pkg) throw ServiceError.notFound('Package not found')
  const list = (value: unknown) => (Array.isArray(value) ? value : []) as AssetRef[]
  const key = (ref: AssetRef) => `${ref.type}:${ref.id}`
  const roots = list(pkg.roots)
  const items = list(pkg.items)
  const excluded = new Set(list(pkg.excluded).map(key))
  const out = new Map<string, InPackage>()
  const closure = await resolveDependencyClosure(db, ctx.tenantId, [...roots, ...items].filter((r) => !excluded.has(key(r))), { exclude: excluded, maxItems: PACKAGE_LIMITS.maxAssets })
  for (const item of closure.items) out.set(key(item), 'dependency')
  for (const ref of items) if (out.has(key(ref))) out.set(key(ref), 'manual')
  for (const ref of roots) if (out.has(key(ref))) out.set(key(ref), 'root')
  for (const k of excluded) out.set(k, 'excluded')
  return out
}

async function tagFacets(ctx: ServiceContext, db: AnySupabaseClient, types: DependencyAssetType[]): Promise<string[]> {
  const tags = new Set<string>()
  const tasks: Array<Promise<void>> = []
  if (types.some((t) => ASSET_SOURCES[t].tags)) {
    tasks.push((async () => {
      const { data } = await (db as any).from('tag_definitions').select('name').eq('tenant_id', ctx.tenantId).order('name').limit(500)
      for (const row of data ?? []) if (row.name) tags.add(String(row.name))
    })())
  }
  if (types.includes('report')) {
    tasks.push((async () => {
      const { data } = await (db as any).from('reports').select('category').eq('tenant_id', ctx.tenantId).not('category', 'is', null).limit(1000)
      for (const row of data ?? []) if (row.category) tags.add(String(row.category))
    })())
  }
  await Promise.all(tasks)
  return [...tags].sort((a, b) => collator.compare(a, b))
}

export async function searchPackageAssets(ctx: ServiceContext, input: AssetSearchInput = {}): Promise<AssetSearchResult> {
  requirePerm(ctx, 'packages.view')
  const requested = parseTypes(input.types)
  const candidates = requested ?? [...DEPENDENCY_TYPES]
  const permitted = candidates.filter((type) => hasPerm(ctx, PACKAGE_ASSET_TYPES[type].view))
  const hidden = candidates.filter((type) => !permitted.includes(type))
  if (requested && !permitted.length) {
    throw ServiceError.forbidden(`Forbidden: searching ${requested.map((t) => PACKAGE_ASSET_TYPES[t].label.toLowerCase()).join(', ')} needs ${[...new Set(requested.map((t) => `'${PACKAGE_ASSET_TYPES[t].view}'`))].join(', ')}`)
  }

  const search = String(input.search ?? '').trim().slice(0, 200)
  const tag = String(input.tag ?? '').trim().slice(0, 100)
  const ownerRaw = String(input.owner ?? '').trim()
  const owner = ownerRaw === 'me' ? ctx.actorId ?? '' : ownerRaw
  if (ownerRaw && !UUID.test(owner)) throw ServiceError.validation(ownerRaw === 'me' ? 'owner=me needs a signed-in user (or an API key that belongs to one)' : 'owner must be a user id or "me"')
  const since = parseUpdatedSince(input.updated_since)
  const sort: AssetSort = input.sort === 'updated' ? 'updated' : 'name'
  if (input.sort && input.sort !== 'name' && input.sort !== 'updated') throw ServiceError.validation('sort must be "name" or "updated"')
  const rawLimit = input.limit ?? DEFAULT_LIMIT
  if (!Number.isFinite(Number(rawLimit))) throw ServiceError.validation('limit must be a number')
  const limit = Math.min(Math.max(Math.trunc(Number(rawLimit)) || DEFAULT_LIMIT, 1), ASSET_SEARCH_MAX_LIMIT)

  // Types that can match the filters at all.
  const searched = permitted.filter((type) => {
    const source = ASSET_SOURCES[type]
    if (tag && !source.tags && !source.category) return false
    if (owner && !source.owner) return false
    return true
  })
  const fkey = shortHash(filterKey({ search, types: searched, tag, owner, since: since ? String(input.updated_since) : '' }))
  const cursor = decodeCursor(input.after)
  if (cursor && (cursor.s !== sort || cursor.f !== fkey)) throw ServiceError.validation('after: the cursor belongs to a different search (filters or sort changed); start again without it')

  const db = await serviceRoleClient(ctx)
  const pattern = search ? quoteFilterValue(substringPattern(search)) : ''

  // Integrations also match by reference name.
  const referenceMatches = new Map<string, string>()
  if (search && searched.includes('integration')) {
    const { data, error } = await (db as any).from('integration_references').select('integration_id, name')
      .eq('tenant_id', ctx.tenantId).ilike('name', substringPattern(search)).limit(200)
    if (error) throw dbError(error)
    for (const row of data ?? []) if (!referenceMatches.has(String(row.integration_id))) referenceMatches.set(String(row.integration_id), String(row.name))
  }

  const sortColumn = (source: Source) => (sort === 'updated' ? 'updated_at' : source.name)
  const filtered = (type: DependencyAssetType, query: any) => {
    const source = ASSET_SOURCES[type]
    let q = query.eq('tenant_id', ctx.tenantId).not(source.name, 'is', null)
    if (source.scope) q = source.scope(q)
    if (search) {
      const ors = [`${source.name}.ilike.${pattern}`]
      if (source.description) ors.push(`description.ilike.${pattern}`)
      if (type === 'integration' && referenceMatches.size) ors.push(`id.in.(${[...referenceMatches.keys()].filter((id) => UUID.test(id)).join(',')})`)
      q = q.or(ors.join(','))
    }
    if (tag) q = source.tags ? q.contains('tags', [tag]) : q.eq('category', tag)
    if (owner) q = q.eq('created_by', owner)
    if (since) q = q.gte('updated_at', since)
    return q
  }

  const firstPage = !cursor
  const facets = firstPage ? tagFacets(ctx, db, permitted) : null
  const perType = await Promise.all(searched.map(async (type) => {
    const source = ASSET_SOURCES[type]
    const columns = ['id', source.name, 'updated_at', source.owner ? 'created_by' : null, source.description ? 'description' : null, source.tags ? 'tags' : null, source.category ? 'category' : null].filter(Boolean).join(', ')
    const column = sortColumn(source)
    const ascending = sort === 'name'
    let rowsQuery = filtered(type, (db as any).from(source.table).select(columns, firstPage ? { count: 'exact' } : undefined))
    const position = cursor?.p[type]
    if (position) {
      const [value, id] = position
      const op = ascending ? 'gt' : 'lt'
      if (!value && !ascending) {
        // Past the dated rows: only never-updated rows remain (NULLS LAST).
        rowsQuery = rowsQuery.is(column, null).lt('id', id)
      } else {
        const after = [`${column}.${op}.${quoteFilterValue(value)}`, `and(${column}.eq.${quoteFilterValue(value)},id.${op}.${id})`]
        if (!ascending) after.push(`${column}.is.null`)
        rowsQuery = rowsQuery.or(after.join(','))
      }
    }
    rowsQuery = rowsQuery.order(column, { ascending, nullsFirst: false }).order('id', { ascending }).limit(limit + 1)
    const countQuery = firstPage ? null : filtered(type, (db as any).from(source.table).select('id', { count: 'exact', head: true }))
    const [rows, counted] = await Promise.all([rowsQuery, countQuery])
    if (rows.error) throw dbError(rows.error)
    if (counted?.error) throw dbError(counted.error)
    const hits: AssetHit[] = ((rows.data ?? []) as any[]).map((row) => ({
      type,
      id: String(row.id),
      name: String(row[source.name] ?? ''),
      label: PACKAGE_ASSET_TYPES[type].label,
      description: source.description && row.description ? String(row.description) : null,
      updated_at: row.updated_at ? String(row.updated_at) : null,
      created_by: row.created_by ? String(row.created_by) : null,
      tags: source.tags ? (Array.isArray(row.tags) ? row.tags.map(String) : []) : source.category && row.category ? [String(row.category)] : [],
      ...(type === 'integration' && referenceMatches.has(String(row.id)) ? { matched_reference: referenceMatches.get(String(row.id)) } : {}),
    }))
    return { type, hits, count: (firstPage ? rows.count : counted?.count) ?? 0 }
  }))

  const page = mergeByType(perType.map((entry) => entry.hits), compareHits(sort), limit)
  const more = perType.reduce((sum, entry) => sum + entry.hits.length, 0) > page.length
  const counts: AssetSearchResult['counts'] = {}
  for (const entry of perType) counts[entry.type] = entry.count

  let nextCursor: string | null = null
  if (more) {
    const positions: CursorState['p'] = { ...(cursor?.p ?? {}) }
    for (const hit of page) {
      positions[hit.type] = [sort === 'updated' ? String(hit.updated_at ?? '') : hit.name, hit.id]
    }
    nextCursor = encodeCursor({ s: sort, f: fkey, p: positions })
  }

  if (input.package) {
    const membership = await packageMembership(ctx, db, String(input.package))
    for (const hit of page) hit.in_package = membership.get(`${hit.type}:${hit.id}`) ?? null
  }

  return {
    assets: page,
    total: perType.reduce((sum, entry) => sum + entry.count, 0),
    counts,
    next_cursor: nextCursor,
    types: permitted.map((type) => ({ type, label: PACKAGE_ASSET_TYPES[type].label })),
    hidden_types: hidden,
    ...(facets ? { facets: { tags: await facets } } : {}),
  }
}
