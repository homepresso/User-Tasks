import { writeAudit } from '@/lib/audit-log'
import {
  findLocalUserByEmail,
  grantDirectoryAccess,
  provisionDirectoryUser,
  resolveProvisionRoleId,
  revokeDirectoryAccess,
} from '@/lib/directory-sync/sync'
import { looksLikeEmail } from '@/lib/directory-sync/types'
import { ScimError } from './errors'
import { planManagerChanges } from '@/lib/directory-sync/managers'
import { CORE_GROUP_SCHEMA, CORE_USER_SCHEMA, ENTERPRISE_USER_SCHEMA, getProp, indexableEquality, matchesFilter, parseFilter, type ScimFilter } from './filter'
import { applyPatch, memberChanges, type PatchOperation } from './patch'
import { DEFAULT_PAGE_SIZE, MAX_FILTER_RESULTS } from './schemas'

/* eslint-disable @typescript-eslint/no-explicit-any -- SCIM resources are free-form JSON */

/**
 * SCIM Users and Groups for one workspace (scim_resources,
 * scim_group_members) and their reconciliation into local accounts and
 * teams — the same rules as the pull directories (lib/directory-sync/sync):
 *
 *  - an active user with an email links to the local account with that
 *    email, or (auto_provision, default on) gets a new account; either way a
 *    membership in this workspace and the provisioning role;
 *  - active: false, or DELETE, deactivates the membership and removes the
 *    roles here (the account itself is never deleted);
 *  - a group becomes a team (sync_groups, default on); its members are the
 *    linked users; removals touch only SCIM-managed members, never people
 *    added to the team by hand.
 *
 * Every query filters the token's workspace: ids of another workspace's
 * resources are simply not found.
 */

export interface ScimRequestContext {
  db: any
  tenantId: string
  tokenId: string
  baseUrl: string
  autoProvision: boolean
  syncGroups: boolean
}

export type ResourceType = 'User' | 'Group'

interface ResourceRow {
  id: string
  tenant_id: string
  resource_type: ResourceType
  external_id: string | null
  user_name: string | null
  display_name: string | null
  active: boolean
  attributes: Record<string, any>
  local_id: string | null
  version: number
  created_at: string
  updated_at: string
}

export interface ListParams {
  filter?: string | null
  startIndex?: number
  count?: number
  attributes?: string[]
  excludedAttributes?: string[]
}

export interface ScimResult {
  status: number
  body?: unknown
  etag?: string
  location?: string
}

const COLUMNS = 'id, tenant_id, resource_type, external_id, user_name, display_name, active, attributes, local_id, version, created_at, updated_at'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const READ_ONLY_KEYS = new Set(['id', 'meta', 'schemas', 'password', 'groups'])
const CHUNK = 200
const SCAN_PAGE = 1000

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

export function etagOf(row: Pick<ResourceRow, 'version'>): string {
  return `W/"${row.version}"`
}

function checkIfMatch(ifMatch: string | null | undefined, row: ResourceRow): void {
  if (!ifMatch || ifMatch.trim() === '*') return
  const tags = ifMatch.split(',').map((t) => t.trim())
  if (!tags.includes(etagOf(row)) && !tags.includes(`"${row.version}"`)) {
    throw new ScimError(412, 'The resource changed (ETag mismatch)', 'invalidVers')
  }
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  return fallback
}

function optionalString(value: unknown, field: string, max = 1024): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw ScimError.badRequest(`${field} must be a string`)
  if (value.length > max) throw ScimError.badRequest(`${field} is too long`)
  return value
}

/** Body → stored attributes plus the indexed columns. */
function userFromBody(body: Record<string, any>) {
  const userName = getProp(body, 'userName')
  if (typeof userName !== 'string' || !userName.trim()) throw ScimError.badRequest('userName is required')
  if (userName.length > 256) throw ScimError.badRequest('userName is too long')
  const attributes: Record<string, any> = {}
  for (const [key, value] of Object.entries(body)) {
    if (READ_ONLY_KEYS.has(key.toLowerCase())) continue
    if (['username', 'externalid', 'active'].includes(key.toLowerCase())) continue
    attributes[key] = value
  }
  return {
    userName: userName.trim(),
    externalId: optionalString(getProp(body, 'externalId'), 'externalId'),
    active: toBool(getProp(body, 'active'), true),
    displayName: optionalString(getProp(body, 'displayName'), 'displayName'),
    attributes,
  }
}

function groupFromBody(body: Record<string, any>) {
  const displayName = getProp(body, 'displayName')
  if (typeof displayName !== 'string' || !displayName.trim()) throw ScimError.badRequest('displayName is required')
  if (displayName.length > 256) throw ScimError.badRequest('displayName is too long')
  const attributes: Record<string, any> = {}
  for (const [key, value] of Object.entries(body)) {
    if (READ_ONLY_KEYS.has(key.toLowerCase())) continue
    if (['displayname', 'externalid', 'members'].includes(key.toLowerCase())) continue
    attributes[key] = value
  }
  const rawMembers = getProp(body, 'members')
  const members = Array.isArray(rawMembers)
    ? rawMembers.map((m) => (m && typeof m === 'object' ? getProp(m, 'value') : m)).filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
  return {
    displayName: displayName.trim(),
    externalId: optionalString(getProp(body, 'externalId'), 'externalId'),
    attributes,
    members: [...new Set(members)],
  }
}

function extensionSchemas(attributes: Record<string, any>): string[] {
  return Object.keys(attributes).filter((key) => /^urn:/i.test(key) && attributes[key] && typeof attributes[key] === 'object')
}

function metaFor(ctx: ScimRequestContext, row: ResourceRow) {
  return {
    resourceType: row.resource_type,
    created: new Date(row.created_at).toISOString(),
    lastModified: new Date(row.updated_at).toISOString(),
    location: `${ctx.baseUrl}/${row.resource_type === 'User' ? 'Users' : 'Groups'}/${row.id}`,
    version: etagOf(row),
  }
}

export function renderUser(ctx: ScimRequestContext, row: ResourceRow): Record<string, any> {
  const attributes = row.attributes ?? {}
  return {
    schemas: [CORE_USER_SCHEMA, ...extensionSchemas(attributes)],
    id: row.id,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    userName: row.user_name,
    ...attributes,
    active: row.active,
    meta: metaFor(ctx, row),
  }
}

export function renderGroup(ctx: ScimRequestContext, row: ResourceRow, members: Array<{ value: string; display: string | null }> | null): Record<string, any> {
  return {
    schemas: [CORE_GROUP_SCHEMA, ...extensionSchemas(row.attributes ?? {})],
    id: row.id,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    displayName: row.display_name,
    ...(row.attributes ?? {}),
    ...(members ? {
      members: members.map((m) => ({ value: m.value, ...(m.display ? { display: m.display } : {}), $ref: `${ctx.baseUrl}/Users/${m.value}`, type: 'User' })),
    } : {}),
    meta: metaFor(ctx, row),
  }
}

/** attributes / excludedAttributes (top level; id and schemas always stay). */
function project(resource: Record<string, any>, params: ListParams): Record<string, any> {
  const include = (params.attributes ?? []).map((a) => a.split('.')[0].replace(/^urn:.*:/i, '').toLowerCase()).filter(Boolean)
  const exclude = (params.excludedAttributes ?? []).map((a) => a.split('.')[0].toLowerCase()).filter(Boolean)
  if (include.length === 0 && exclude.length === 0) return resource
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(resource)) {
    const lower = key.toLowerCase()
    const always = lower === 'id' || lower === 'schemas'
    if (!always && include.length > 0 && !include.includes(lower) && !include.some((a) => lower.endsWith(`:${a}`))) continue
    if (!always && exclude.includes(lower)) continue
    out[key] = value
  }
  return out
}

function wantsMembers(params: ListParams, filter: ScimFilter | null): boolean {
  const mentions = (f: ScimFilter | null): boolean => {
    if (!f) return false
    switch (f.kind) {
      case 'and':
      case 'or': return mentions(f.left) || mentions(f.right)
      case 'not': return mentions(f.filter)
      default: return f.path.attr.toLowerCase() === 'members'
    }
  }
  if (mentions(filter)) return true
  if ((params.excludedAttributes ?? []).some((a) => a.split('.')[0].toLowerCase() === 'members')) return false
  const include = (params.attributes ?? []).map((a) => a.split('.')[0].toLowerCase())
  return include.length === 0 || include.includes('members')
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function getRow(ctx: ScimRequestContext, type: ResourceType, id: string): Promise<ResourceRow> {
  if (!UUID_RE.test(id)) throw ScimError.notFound(`${type} ${id} not found`)
  const { data, error } = await ctx.db
    .from('scim_resources')
    .select(COLUMNS)
    .eq('tenant_id', ctx.tenantId)
    .eq('resource_type', type)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new ScimError(500, 'Lookup failed')
  if (!data) throw ScimError.notFound(`${type} ${id} not found`)
  return data as ResourceRow
}

async function loadMembers(ctx: ScimRequestContext, groupIds: string[]): Promise<Map<string, Array<{ value: string; display: string | null }>>> {
  const out = new Map<string, Array<{ value: string; display: string | null }>>(groupIds.map((id) => [id, []]))
  const memberIds = new Set<string>()
  const pairs: Array<{ group_id: string; member_id: string }> = []
  for (const ids of chunk(groupIds, CHUNK)) {
    let from = 0
    for (;;) {
      const { data, error } = await ctx.db
        .from('scim_group_members')
        .select('group_id, member_id')
        .eq('tenant_id', ctx.tenantId)
        .in('group_id', ids)
        .order('created_at', { ascending: true })
        .order('member_id', { ascending: true })
        .range(from, from + SCAN_PAGE - 1)
      if (error) throw new ScimError(500, 'Member lookup failed')
      for (const row of (data ?? []) as any[]) { pairs.push(row); memberIds.add(String(row.member_id)) }
      if ((data ?? []).length < SCAN_PAGE) break
      from += SCAN_PAGE
    }
  }
  const displays = new Map<string, string | null>()
  for (const ids of chunk([...memberIds], CHUNK)) {
    const { data } = await ctx.db.from('scim_resources').select('id, display_name, user_name').eq('tenant_id', ctx.tenantId).in('id', ids)
    for (const row of (data ?? []) as any[]) displays.set(String(row.id), row.display_name ?? row.user_name ?? null)
  }
  for (const pair of pairs) out.get(String(pair.group_id))?.push({ value: String(pair.member_id), display: displays.get(String(pair.member_id)) ?? null })
  return out
}

export async function getResource(ctx: ScimRequestContext, type: ResourceType, id: string, params: ListParams = {}): Promise<ScimResult> {
  const row = await getRow(ctx, type, id)
  if (type === 'User') return { status: 200, body: project(renderUser(ctx, row), params), etag: etagOf(row) }
  const members = wantsMembers(params, null) ? (await loadMembers(ctx, [row.id])).get(row.id) ?? [] : null
  return { status: 200, body: project(renderGroup(ctx, row, members), params), etag: etagOf(row) }
}

const INDEXED: Record<ResourceType, string[]> = {
  User: ['id', 'userName', 'externalId', 'displayName'],
  Group: ['id', 'displayName', 'externalId'],
}

function narrow(query: any, eq: { attr: string; value: string } | null): any {
  if (!eq) return query
  switch (eq.attr) {
    case 'id': return UUID_RE.test(eq.value) ? query.eq('id', eq.value) : query.eq('id', '00000000-0000-0000-0000-000000000000')
    case 'userName': return query.ilike('user_name', escapeLike(eq.value))
    case 'externalId': return query.eq('external_id', eq.value)
    case 'displayName': return query.ilike('display_name', escapeLike(eq.value))
    default: return query
  }
}

export async function listResources(ctx: ScimRequestContext, type: ResourceType, params: ListParams): Promise<ScimResult> {
  const startIndex = Math.max(1, Math.floor(params.startIndex ?? 1))
  const count = Math.min(Math.max(0, Math.floor(params.count ?? DEFAULT_PAGE_SIZE)), MAX_FILTER_RESULTS)
  const filter = params.filter?.trim() ? parseFilter(params.filter.trim()) : null
  const withMembers = type === 'Group' && wantsMembers(params, filter)

  let rows: ResourceRow[]
  let total: number
  if (!filter) {
    // Unfiltered: paginate in the database.
    const { count: exact, error: countError } = await ctx.db
      .from('scim_resources').select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId).eq('resource_type', type)
    if (countError) throw new ScimError(500, 'List failed')
    total = exact ?? 0
    if (count === 0) {
      rows = []
    } else {
      const { data, error } = await ctx.db
        .from('scim_resources').select(COLUMNS)
        .eq('tenant_id', ctx.tenantId).eq('resource_type', type)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(startIndex - 1, startIndex - 1 + count - 1)
      if (error) throw new ScimError(500, 'List failed')
      rows = (data ?? []) as ResourceRow[]
    }
  } else {
    // Filtered: narrow by an indexed equality when there is one, then
    // evaluate the whole filter on the candidates.
    const eq = indexableEquality(filter, INDEXED[type])
    const candidates: ResourceRow[] = []
    for (let from = 0; ; from += SCAN_PAGE) {
      const { data, error } = await narrow(ctx.db.from('scim_resources').select(COLUMNS).eq('tenant_id', ctx.tenantId).eq('resource_type', type), eq)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(from, from + SCAN_PAGE - 1)
      if (error) throw new ScimError(500, 'List failed')
      candidates.push(...((data ?? []) as ResourceRow[]))
      if ((data ?? []).length < SCAN_PAGE) break
    }
    const members = withMembers ? await loadMembers(ctx, candidates.map((r) => r.id)) : null
    const matched = candidates.filter((row) => {
      const rendered = type === 'User' ? renderUser(ctx, row) : renderGroup(ctx, row, members?.get(row.id) ?? [])
      return matchesFilter(rendered, filter)
    })
    total = matched.length
    rows = matched.slice(startIndex - 1, startIndex - 1 + count)
  }

  const members = type === 'Group' && withMembers ? await loadMembers(ctx, rows.map((r) => r.id)) : null
  const resources = rows.map((row) => project(
    type === 'User' ? renderUser(ctx, row) : renderGroup(ctx, row, members ? members.get(row.id) ?? [] : null),
    params,
  ))
  return {
    status: 200,
    body: { schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: total, startIndex, itemsPerPage: resources.length, Resources: resources },
  }
}

// ── Reconciliation ───────────────────────────────────────────────────────────

const roleCache = new WeakMap<ScimRequestContext, Promise<string | null>>()
function provisionRole(ctx: ScimRequestContext): Promise<string | null> {
  let found = roleCache.get(ctx)
  if (!found) {
    found = resolveProvisionRoleId(ctx.db, ctx.tenantId)
    roleCache.set(ctx, found)
  }
  return found
}

function primaryEmail(row: ResourceRow): string | null {
  const emails = getProp(row.attributes, 'emails')
  const list = Array.isArray(emails) ? emails.filter((e) => e && typeof e === 'object') : []
  const pick = list.find((e) => toBool(getProp(e, 'primary'), false))
    ?? list.find((e) => String(getProp(e, 'type') ?? '').toLowerCase() === 'work')
    ?? list[0]
  const value = pick ? getProp(pick, 'value') : null
  if (looksLikeEmail(value)) return value.toLowerCase()
  return looksLikeEmail(row.user_name) ? row.user_name.toLowerCase() : null
}

function userDisplayName(row: ResourceRow): string {
  const name = getProp(row.attributes, 'name') as Record<string, unknown> | undefined
  const formatted = name ? getProp(name, 'formatted') : null
  const given = name ? getProp(name, 'givenName') : null
  const family = name ? getProp(name, 'familyName') : null
  return String(row.display_name || formatted || [given, family].filter(Boolean).join(' ').trim() || row.user_name || '')
}

async function upsertLink(ctx: ScimRequestContext, objectType: 'user' | 'group', scimId: string, localId: string, displayName: string | null): Promise<void> {
  await ctx.db.from('directory_links').upsert({
    tenant_id: ctx.tenantId,
    provider: 'scim',
    object_type: objectType,
    external_id: scimId,
    local_id: localId,
    display_name: displayName,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,provider,object_type,external_id' })
}

async function deleteLink(ctx: ScimRequestContext, objectType: 'user' | 'group', scimId: string): Promise<void> {
  await ctx.db.from('directory_links').delete().eq('tenant_id', ctx.tenantId).eq('provider', 'scim').eq('object_type', objectType).eq('external_id', scimId)
}

function audit(ctx: ScimRequestContext, objectId: string, action: string, summary: string, metadata: Record<string, unknown> = {}) {
  return writeAudit({
    supabase: ctx.db, tenantId: ctx.tenantId, actorId: null,
    objectType: 'directory_sync', objectId, action, summary,
    metadata: { provider: 'scim', via: 'scim', token_id: ctx.tokenId, ...metadata },
  })
}

/** Teams of the SCIM groups this user belongs to (for adding a newly linked user). */
async function addUserToGroupTeams(ctx: ScimRequestContext, row: ResourceRow, localId: string): Promise<void> {
  if (!ctx.syncGroups) return
  const { data: memberships } = await ctx.db.from('scim_group_members').select('group_id').eq('tenant_id', ctx.tenantId).eq('member_id', row.id)
  const groupIds = ((memberships ?? []) as any[]).map((m) => String(m.group_id))
  for (const ids of chunk(groupIds, CHUNK)) {
    const { data: groups } = await ctx.db.from('scim_resources').select('local_id').eq('tenant_id', ctx.tenantId).in('id', ids)
    for (const group of (groups ?? []) as any[]) {
      if (!group.local_id) continue
      await ctx.db.from('user_teams').insert({ team_id: group.local_id, user_id: localId, role: 'member' }).then(() => {}, () => {})
    }
  }
}

async function reconcileUser(ctx: ScimRequestContext, row: ResourceRow, previous: ResourceRow | null): Promise<ResourceRow> {
  const email = primaryEmail(row)
  if (!row.active) {
    if (row.local_id && (previous?.active ?? true)) await revokeDirectoryAccess(ctx.db, ctx.tenantId, [row.local_id])
    return row
  }
  if (!email) return row
  let localId = row.local_id
  const displayName = userDisplayName(row)
  const roleId = await provisionRole(ctx)
  let created = false
  if (!localId) {
    const existing = await findLocalUserByEmail(ctx.db, email)
    if (existing) localId = existing.id
    else if (ctx.autoProvision) {
      localId = await provisionDirectoryUser(ctx.db, ctx.tenantId, 'scim', { email, displayName }, roleId)
      created = Boolean(localId)
    }
    if (!localId) return row
    const { data } = await ctx.db.from('scim_resources').update({ local_id: localId }).eq('tenant_id', ctx.tenantId).eq('id', row.id).select(COLUMNS).maybeSingle()
    row = (data as ResourceRow | null) ?? { ...row, local_id: localId }
    await addUserToGroupTeams(ctx, row, localId)
  }
  if (!created) await grantDirectoryAccess(ctx.db, ctx.tenantId, localId, roleId)
  if (displayName && previous && userDisplayName(previous) !== displayName) {
    await ctx.db.from('users').update({ display_name: displayName }).eq('id', localId)
  }
  await upsertLink(ctx, 'user', row.id, localId, displayName || null)
  await syncScimManager(ctx, row, localId)
  return row
}

/**
 * Enterprise extension `manager.value` (the manager's SCIM id) → the
 * member's manager in this workspace (lib/directory-sync/managers.ts rules).
 * Resolves once the manager's own SCIM user is linked; best-effort.
 */
async function syncScimManager(ctx: ScimRequestContext, row: ResourceRow, localId: string): Promise<void> {
  try {
    const enterprise = getProp(row.attributes, ENTERPRISE_USER_SCHEMA) as Record<string, unknown> | undefined
    if (!enterprise || typeof enterprise !== 'object' || !Object.keys(enterprise).some((k) => k.toLowerCase() === 'manager')) return
    const manager = getProp(enterprise, 'manager') as Record<string, unknown> | string | null | undefined
    const value = typeof manager === 'string' ? manager : manager && typeof manager === 'object' ? getProp(manager, 'value') : null
    const ref = typeof value === 'string' && value.trim() ? { externalId: value.trim() } : null
    const localIdByExternalId = new Map<string, string>([[row.id, localId]])
    if (ref) {
      const { data: target } = await ctx.db.from('scim_resources').select('id, local_id').eq('tenant_id', ctx.tenantId).eq('resource_type', 'User').eq('id', ref.externalId).maybeSingle()
      if (target?.local_id) localIdByExternalId.set(String(target.id), String(target.local_id))
    }
    const { data: member } = await ctx.db.from('user_memberships').select('user_id, manager_user_id, manager_source').eq('tenant_id', ctx.tenantId).eq('user_id', localId).maybeSingle()
    if (!member) return
    const [change] = planManagerChanges({
      users: [{ externalId: row.id, displayName: '', email: null, active: true, manager: ref }],
      localIdByExternalId,
      localIdByEmail: new Map(),
      current: new Map([[localId, { manager_user_id: member.manager_user_id ?? null, manager_source: member.manager_source ?? null }]]),
    })
    if (!change) return
    await ctx.db.from('user_memberships')
      .update({ manager_user_id: change.manager_user_id, manager_source: change.manager_user_id ? 'directory' : null, manager_updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId).eq('user_id', localId)
  } catch (error) {
    console.warn('[scim] manager sync failed:', error instanceof Error ? error.message : error)
  }
}

async function reconcileGroup(ctx: ScimRequestContext, row: ResourceRow, memberIds: string[]): Promise<ResourceRow> {
  if (!ctx.syncGroups) return row
  const description = typeof getProp(row.attributes, 'description') === 'string' ? String(getProp(row.attributes, 'description')) : null
  let teamId = row.local_id
  if (teamId) {
    await ctx.db.from('teams').update({ name: row.display_name }).eq('tenant_id', ctx.tenantId).eq('id', teamId)
  } else {
    const { data: team, error } = await ctx.db.from('teams').insert({ tenant_id: ctx.tenantId, name: row.display_name, description }).select('id').single()
    if (error || !team) return row
    teamId = String(team.id)
    const { data } = await ctx.db.from('scim_resources').update({ local_id: teamId }).eq('tenant_id', ctx.tenantId).eq('id', row.id).select(COLUMNS).maybeSingle()
    row = (data as ResourceRow | null) ?? { ...row, local_id: teamId }
  }
  await upsertLink(ctx, 'group', row.id, teamId, row.display_name)

  // Desired team members: the linked users among the group's members.
  const desired = new Set<string>()
  for (const ids of chunk(memberIds, CHUNK)) {
    const { data } = await ctx.db.from('scim_resources').select('local_id').eq('tenant_id', ctx.tenantId).eq('resource_type', 'User').in('id', ids)
    for (const member of (data ?? []) as any[]) if (member.local_id) desired.add(String(member.local_id))
  }
  const { data: currentRows } = await ctx.db.from('user_teams').select('user_id').eq('team_id', teamId)
  const current = new Set(((currentRows ?? []) as any[]).map((r) => String(r.user_id)))
  for (const userId of desired) {
    if (!current.has(userId)) await ctx.db.from('user_teams').insert({ team_id: teamId, user_id: userId, role: 'member' }).then(() => {}, () => {})
  }
  // Remove only SCIM-managed members (users linked through SCIM in this workspace).
  const stale = [...current].filter((id) => !desired.has(id))
  for (const ids of chunk(stale, CHUNK)) {
    const { data } = await ctx.db.from('scim_resources').select('local_id').eq('tenant_id', ctx.tenantId).eq('resource_type', 'User').in('local_id', ids)
    const managed = ((data ?? []) as any[]).map((r) => String(r.local_id))
    if (managed.length > 0) await ctx.db.from('user_teams').delete().eq('team_id', teamId).in('user_id', managed)
  }
  return row
}

// ── Users ────────────────────────────────────────────────────────────────────

async function assertUserNameFree(ctx: ScimRequestContext, userName: string, exceptId: string | null): Promise<void> {
  let query = ctx.db.from('scim_resources').select('id').eq('tenant_id', ctx.tenantId).eq('resource_type', 'User').ilike('user_name', escapeLike(userName)).limit(1)
  if (exceptId) query = query.neq('id', exceptId)
  const { data } = await query
  if ((data ?? []).length > 0) throw ScimError.conflict(`A user with userName "${userName}" already exists`)
}

function isUniqueViolation(error: any): boolean {
  return error?.code === '23505' || /duplicate key|unique/i.test(String(error?.message ?? ''))
}

export async function createUser(ctx: ScimRequestContext, body: Record<string, any>): Promise<ScimResult> {
  const input = userFromBody(body)
  await assertUserNameFree(ctx, input.userName, null)
  const { data, error } = await ctx.db.from('scim_resources').insert({
    tenant_id: ctx.tenantId,
    resource_type: 'User',
    user_name: input.userName,
    external_id: input.externalId,
    display_name: input.displayName,
    active: input.active,
    attributes: input.attributes,
  }).select(COLUMNS).single()
  if (error) {
    if (isUniqueViolation(error)) throw ScimError.conflict(`A user with userName "${input.userName}" already exists`)
    throw new ScimError(500, 'Create failed')
  }
  const row = await reconcileUser(ctx, data as ResourceRow, null)
  await audit(ctx, row.id, 'create', `SCIM provisioned user ${input.userName}${row.local_id ? '' : ' (not linked)'}`, { scim_id: row.id, linked: Boolean(row.local_id) })
  return { status: 201, body: renderUser(ctx, row), etag: etagOf(row), location: `${ctx.baseUrl}/Users/${row.id}` }
}

async function writeUser(ctx: ScimRequestContext, previous: ResourceRow, body: Record<string, any>): Promise<ScimResult> {
  const input = userFromBody(body)
  if (input.userName.toLowerCase() !== String(previous.user_name).toLowerCase()) await assertUserNameFree(ctx, input.userName, previous.id)
  const { data, error } = await ctx.db.from('scim_resources').update({
    user_name: input.userName,
    external_id: input.externalId,
    display_name: input.displayName,
    active: input.active,
    attributes: input.attributes,
    version: previous.version + 1,
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', ctx.tenantId).eq('id', previous.id).select(COLUMNS).single()
  if (error) {
    if (isUniqueViolation(error)) throw ScimError.conflict(`A user with userName "${input.userName}" already exists`)
    throw new ScimError(500, 'Update failed')
  }
  const row = await reconcileUser(ctx, data as ResourceRow, previous)
  if (previous.active !== row.active) {
    await audit(ctx, row.id, 'update', `SCIM ${row.active ? 'reactivated' : 'deactivated'} user ${row.user_name}`, { scim_id: row.id, active: row.active })
  }
  return { status: 200, body: renderUser(ctx, row), etag: etagOf(row) }
}

export async function replaceUser(ctx: ScimRequestContext, id: string, body: Record<string, any>, ifMatch?: string | null): Promise<ScimResult> {
  const previous = await getRow(ctx, 'User', id)
  checkIfMatch(ifMatch, previous)
  return writeUser(ctx, previous, body)
}

export async function patchUser(ctx: ScimRequestContext, id: string, operations: PatchOperation[], ifMatch?: string | null): Promise<ScimResult> {
  const previous = await getRow(ctx, 'User', id)
  checkIfMatch(ifMatch, previous)
  const current = {
    ...previous.attributes,
    userName: previous.user_name,
    ...(previous.external_id ? { externalId: previous.external_id } : {}),
    active: previous.active,
  }
  return writeUser(ctx, previous, applyPatch(current, operations))
}

export async function deleteUser(ctx: ScimRequestContext, id: string, ifMatch?: string | null): Promise<ScimResult> {
  const row = await getRow(ctx, 'User', id)
  checkIfMatch(ifMatch, row)
  if (row.local_id) {
    await revokeDirectoryAccess(ctx.db, ctx.tenantId, [row.local_id])
    // Out of the teams of SCIM groups it was in.
    const { data: memberships } = await ctx.db.from('scim_group_members').select('group_id').eq('tenant_id', ctx.tenantId).eq('member_id', row.id)
    const groupIds = ((memberships ?? []) as any[]).map((m) => String(m.group_id))
    for (const ids of chunk(groupIds, CHUNK)) {
      const { data: groups } = await ctx.db.from('scim_resources').select('local_id').eq('tenant_id', ctx.tenantId).in('id', ids)
      const teamIds = ((groups ?? []) as any[]).map((g) => g.local_id).filter(Boolean)
      if (teamIds.length > 0) await ctx.db.from('user_teams').delete().eq('user_id', row.local_id).in('team_id', teamIds)
    }
    await deleteLink(ctx, 'user', row.id)
  }
  await ctx.db.from('scim_resources').delete().eq('tenant_id', ctx.tenantId).eq('id', row.id)
  await audit(ctx, row.id, 'delete', `SCIM deprovisioned user ${row.user_name}`, { scim_id: row.id })
  return { status: 204 }
}

// ── Groups ───────────────────────────────────────────────────────────────────

/** The member ids that are Users of this workspace (others are ignored). */
async function validMemberIds(ctx: ScimRequestContext, ids: string[]): Promise<string[]> {
  const candidates = [...new Set(ids)].filter((id) => UUID_RE.test(id))
  const valid: string[] = []
  for (const part of chunk(candidates, CHUNK)) {
    const { data } = await ctx.db.from('scim_resources').select('id').eq('tenant_id', ctx.tenantId).eq('resource_type', 'User').in('id', part)
    valid.push(...((data ?? []) as any[]).map((r) => String(r.id)))
  }
  return valid
}

async function currentMemberIds(ctx: ScimRequestContext, groupId: string): Promise<string[]> {
  return ((await loadMembers(ctx, [groupId])).get(groupId) ?? []).map((m) => m.value)
}

async function setMembers(ctx: ScimRequestContext, groupId: string, add: string[], remove: string[]): Promise<void> {
  const additions = await validMemberIds(ctx, add)
  for (const ids of chunk(additions, CHUNK)) {
    await ctx.db.from('scim_group_members').upsert(
      ids.map((memberId) => ({ tenant_id: ctx.tenantId, group_id: groupId, member_id: memberId })),
      { onConflict: 'group_id,member_id', ignoreDuplicates: true },
    )
  }
  for (const ids of chunk([...new Set(remove)].filter((id) => UUID_RE.test(id)), CHUNK)) {
    await ctx.db.from('scim_group_members').delete().eq('tenant_id', ctx.tenantId).eq('group_id', groupId).in('member_id', ids)
  }
}

export async function createGroup(ctx: ScimRequestContext, body: Record<string, any>): Promise<ScimResult> {
  const input = groupFromBody(body)
  const { data, error } = await ctx.db.from('scim_resources').insert({
    tenant_id: ctx.tenantId,
    resource_type: 'Group',
    display_name: input.displayName,
    external_id: input.externalId,
    attributes: input.attributes,
  }).select(COLUMNS).single()
  if (error) throw new ScimError(500, 'Create failed')
  await setMembers(ctx, data.id, input.members, [])
  const memberIds = await currentMemberIds(ctx, data.id)
  const row = await reconcileGroup(ctx, data as ResourceRow, memberIds)
  await audit(ctx, row.id, 'create', `SCIM created group ${input.displayName}`, { scim_id: row.id, members: memberIds.length })
  const members = (await loadMembers(ctx, [row.id])).get(row.id) ?? []
  return { status: 201, body: renderGroup(ctx, row, members), etag: etagOf(row), location: `${ctx.baseUrl}/Groups/${row.id}` }
}

async function writeGroup(ctx: ScimRequestContext, previous: ResourceRow, input: { displayName: string; externalId: string | null; attributes: Record<string, any> }, members: { add: string[]; remove: string[] }): Promise<ResourceRow> {
  const { data, error } = await ctx.db.from('scim_resources').update({
    display_name: input.displayName,
    external_id: input.externalId,
    attributes: input.attributes,
    version: previous.version + 1,
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', ctx.tenantId).eq('id', previous.id).select(COLUMNS).single()
  if (error) throw new ScimError(500, 'Update failed')
  await setMembers(ctx, previous.id, members.add, members.remove)
  return reconcileGroup(ctx, data as ResourceRow, await currentMemberIds(ctx, previous.id))
}

export async function replaceGroup(ctx: ScimRequestContext, id: string, body: Record<string, any>, ifMatch?: string | null): Promise<ScimResult> {
  const previous = await getRow(ctx, 'Group', id)
  checkIfMatch(ifMatch, previous)
  const input = groupFromBody(body)
  const before = await currentMemberIds(ctx, id)
  const row = await writeGroup(ctx, previous, input, { add: input.members, remove: before.filter((m) => !input.members.includes(m)) })
  const members = (await loadMembers(ctx, [row.id])).get(row.id) ?? []
  return { status: 200, body: renderGroup(ctx, row, members), etag: etagOf(row) }
}

export async function patchGroup(ctx: ScimRequestContext, id: string, operations: PatchOperation[], ifMatch?: string | null, params: ListParams = {}): Promise<ScimResult> {
  const previous = await getRow(ctx, 'Group', id)
  checkIfMatch(ifMatch, previous)
  const fast = memberChanges(operations)
  let row: ResourceRow
  if (fast && !fast.replace) {
    row = await writeGroup(ctx, previous, { displayName: String(previous.display_name), externalId: previous.external_id, attributes: previous.attributes }, fast)
  } else {
    const before = await currentMemberIds(ctx, id)
    const current = {
      ...previous.attributes,
      displayName: previous.display_name,
      ...(previous.external_id ? { externalId: previous.external_id } : {}),
      members: before.map((value) => ({ value })),
    }
    const patched = applyPatch(current, operations)
    const input = groupFromBody(patched)
    row = await writeGroup(ctx, previous, input, { add: input.members.filter((m) => !before.includes(m)), remove: before.filter((m) => !input.members.includes(m)) })
  }
  if ((params.attributes ?? []).length > 0) {
    const members = wantsMembers(params, null) ? (await loadMembers(ctx, [row.id])).get(row.id) ?? [] : null
    return { status: 200, body: project(renderGroup(ctx, row, members), params), etag: etagOf(row) }
  }
  return { status: 204, etag: etagOf(row) }
}

export async function deleteGroup(ctx: ScimRequestContext, id: string, ifMatch?: string | null): Promise<ScimResult> {
  const row = await getRow(ctx, 'Group', id)
  checkIfMatch(ifMatch, row)
  if (row.local_id) {
    // The team stays (it may carry assignments and queues); SCIM-managed members leave it.
    const memberIds = await currentMemberIds(ctx, row.id)
    for (const ids of chunk(memberIds, CHUNK)) {
      const { data } = await ctx.db.from('scim_resources').select('local_id').eq('tenant_id', ctx.tenantId).in('id', ids)
      const localIds = ((data ?? []) as any[]).map((r) => r.local_id).filter(Boolean)
      if (localIds.length > 0) await ctx.db.from('user_teams').delete().eq('team_id', row.local_id).in('user_id', localIds)
    }
    await deleteLink(ctx, 'group', row.id)
  }
  await ctx.db.from('scim_resources').delete().eq('tenant_id', ctx.tenantId).eq('id', row.id)
  await audit(ctx, row.id, 'delete', `SCIM deleted group ${row.display_name}`, { scim_id: row.id })
  return { status: 204 }
}
