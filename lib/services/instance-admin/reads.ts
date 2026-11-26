import {
  INSTANCE_ACTION_LABELS, INSTANCE_DATASET_COLUMNS, isInstanceAction, projectRow, workspaceSummary,
  type InstanceDataset, type InstanceDatasetParams,
} from '@/lib/instance-admin/schema'
import { ServiceError } from '../context'
import { instanceDb } from './access'
import { accountStates, authKind, lockedAccounts } from './auth-state'
import { dailyCounts, workspaceStats, type WorkspaceStats } from './stats'

/**
 * Cross-workspace reads for instance admins (callers run requireInstanceAdmin
 * first). Operational data only: every query lists its columns, and every
 * row leaves through projectRow() — the dataset's declared columns and
 * nothing else (INSTANCE_DATASET_COLUMNS). Never selected: form submission
 * data, data table rows, task titles / descriptions / comments, files,
 * workflow definitions, audit summaries or diffs, invitation tokens, secrets.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

export interface InstancePage {
  dataset: InstanceDataset
  rows: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
  /** Some counts came from a capped fallback (migration not applied). */
  truncated?: boolean
  note?: string
}

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null)
const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0 }
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)
const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`).replace(/[,()"*]/g, ' ')}%`

function paging(params: InstanceDatasetParams, defaultLimit = 25) {
  return { limit: Math.min(200, Math.max(1, params.limit ?? defaultLimit)), offset: Math.max(0, params.offset ?? 0) }
}

function sortRows(rows: Array<Record<string, unknown>>, key: string, dir: 'asc' | 'desc') {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = a[key]; const y = b[key]
    if (x === y) return 0
    if (x === null || x === undefined) return 1
    if (y === null || y === undefined) return -1
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * sign
  })
}

function page(dataset: InstanceDataset, all: Array<Record<string, unknown>>, params: InstanceDatasetParams, defaults: { sort: string; dir: 'asc' | 'desc' }, extra: Partial<InstancePage> = {}): InstancePage {
  const { limit, offset } = paging(params)
  const keys = new Set(INSTANCE_DATASET_COLUMNS[dataset].map((c) => c.key))
  const sort = params.sort && keys.has(params.sort) ? params.sort : defaults.sort
  const sorted = sortRows(all, sort, params.dir ?? (params.sort && keys.has(params.sort) ? 'asc' : defaults.dir))
  return { dataset, rows: sorted.slice(offset, offset + limit).map((r) => projectRow(dataset, r)), total: all.length, limit, offset, ...extra }
}

async function tenantNames(ids: readonly string[]): Promise<Map<string, { name: string; slug: string }>> {
  const out = new Map<string, { name: string; slug: string }>()
  const unique = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await (instanceDb() as any).from('tenants').select('id, name, slug').in('id', unique.slice(i, i + 200))
    for (const t of (data ?? []) as any[]) out.set(t.id, { name: t.name, slug: t.slug })
  }
  return out
}

async function userNames(ids: readonly string[]): Promise<Map<string, { name: string; email: string }>> {
  const out = new Map<string, { name: string; email: string }>()
  const unique = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await (instanceDb() as any).from('users').select('id, display_name, email').in('id', unique.slice(i, i + 200))
    for (const u of (data ?? []) as any[]) out.set(u.id, { name: u.display_name || u.email, email: u.email })
  }
  return out
}

/* ── Entitlements (licences / trials) ─────────────────────────────────── */

interface Entitlement { id: string; tenant_id: string; extension_id: string; edition: string | null; status: string; source: string; starts_at: string | null; ends_at: string | null; updated_at: string | null }

async function entitlements(filter: { tenantId?: string } = {}): Promise<Entitlement[]> {
  try {
    let q = (instanceDb() as any).from('tenant_entitlements').select('id, tenant_id, extension_id, edition, status, source, starts_at, ends_at, updated_at').limit(5000)
    if (filter.tenantId) q = q.eq('tenant_id', filter.tenantId)
    const { data, error } = await q
    return error ? [] : ((data ?? []) as Entitlement[])
  } catch {
    return []
  }
}

/** active | expiring (≤14 days) | expired | suspended | revoked */
export function entitlementState(e: Pick<Entitlement, 'status' | 'ends_at'>, now = Date.now()): string {
  if (e.status !== 'active') return e.status
  if (!e.ends_at) return 'active'
  const left = new Date(e.ends_at).getTime() - now
  if (left < 0) return 'expired'
  return left <= 14 * DAY ? 'expiring' : 'active'
}

function workspaceStatus(stats: WorkspaceStats | undefined, ents: Entitlement[], deleted: boolean): string {
  if (deleted) return 'Deleted'
  if (ents.some((e) => ['expired', 'suspended'].includes(entitlementState(e)))) return 'Licence lapsed'
  if (ents.some((e) => e.source === 'trial' && entitlementState(e) !== 'revoked')) return 'Trial'
  if (stats && stats.members > 0 && stats.active_30d === 0) return 'Idle'
  return 'Active'
}

const trialEnd = (ents: Entitlement[]) => ents.filter((e) => e.source === 'trial' && e.ends_at && e.status === 'active').map((e) => e.ends_at!).sort()[0] ?? null

/* ── Workspaces ───────────────────────────────────────────────────────── */

const TENANT_COLUMNS = 'id, name, slug, plan, industry, company_size, created_at, deleted_at'
const DB_SORTS = new Set(['name', 'slug', 'plan', 'created_at', 'industry'])

export async function listWorkspaces(params: InstanceDatasetParams): Promise<InstancePage> {
  const { limit, offset } = paging(params)
  const db = instanceDb() as any
  const statsSort = params.sort && !DB_SORTS.has(params.sort) && INSTANCE_DATASET_COLUMNS.workspaces.some((c) => c.key === params.sort)
  const needAll = statsSort || Boolean(params.status)
  let q = db.from('tenants').select(TENANT_COLUMNS, { count: 'exact' })
  if (params.status !== 'Deleted') q = q.is('deleted_at', null)
  else q = q.not('deleted_at', 'is', null)
  if (params.q) q = q.or(`name.ilike.${like(params.q)},slug.ilike.${like(params.q)}`)
  if (params.plan) q = q.eq('plan', params.plan)
  if (params.workspace_id) q = q.eq('id', params.workspace_id)
  const dbSort = params.sort && DB_SORTS.has(params.sort) ? params.sort : 'created_at'
  q = q.order(dbSort, { ascending: params.sort && DB_SORTS.has(params.sort) ? (params.dir ?? 'asc') === 'asc' : false })
  q = needAll ? q.limit(2000) : q.range(offset, offset + limit - 1)
  const { data, error, count } = await q
  if (error) throw new Error(`tenants: ${error.message}`)
  const tenants = (data ?? []) as any[]
  const ids = tenants.map((t) => t.id)
  const [stats, ents] = await Promise.all([workspaceStats(ids), entitlements()])
  const byTenant = new Map<string, Entitlement[]>()
  for (const e of ents) byTenant.set(e.tenant_id, [...(byTenant.get(e.tenant_id) ?? []), e])
  let rows = tenants.map((t) => {
    const s = stats.get(t.id)
    const te = byTenant.get(t.id) ?? []
    return {
      ...t, status: workspaceStatus(s, te, Boolean(t.deleted_at)), members: s?.members ?? null, active_7d: s?.active_7d ?? null,
      pending_invitations: s?.pending_invitations ?? null, runs_30d: s?.runs_30d ?? null, failed_runs_7d: s?.failed_runs_7d ?? null,
      ai_cost_30d: s?.ai_cost_30d ?? null, storage_bytes: s?.storage_bytes ?? null, trial_ends_at: trialEnd(te), last_activity_at: s?.last_activity_at ?? null,
    }
  })
  if (!needAll) return { dataset: 'workspaces', rows: rows.map((r) => projectRow('workspaces', r)), total: count ?? rows.length, limit, offset }
  if (params.status && params.status !== 'Deleted') rows = rows.filter((r) => r.status === params.status)
  return page('workspaces', rows, params, { sort: 'created_at', dir: 'desc' }, { truncated: (count ?? 0) > 2000 })
}

export async function getWorkspace(workspaceId: string): Promise<Record<string, unknown>> {
  const db = instanceDb() as any
  const { data: t, error } = await db.from('tenants').select(`${TENANT_COLUMNS}, subdomain, custom_domain, onboarding_completed, settings->sso`).eq('id', workspaceId).maybeSingle()
  if (error) throw new Error(`tenants: ${error.message}`)
  if (!t) throw ServiceError.notFound('No such workspace')
  const [stats, ents, owners] = await Promise.all([workspaceStats([workspaceId]), entitlements({ tenantId: workspaceId }), ownersOf(workspaceId)])
  const s = stats.get(workspaceId)
  return projectRow('workspace', {
    ...t, status: workspaceStatus(s, ents, Boolean(t.deleted_at)), owners: owners.join(', '),
    summary: workspaceSummary({ slug: t.slug, members: s?.members ?? null, owners: owners.join(', ') }),
    members: s?.members ?? null, active_members: s?.active_members ?? null, active_7d: s?.active_7d ?? null, active_30d: s?.active_30d ?? null,
    pending_invitations: s?.pending_invitations ?? null, runs_30d: s?.runs_30d ?? null, failed_runs_7d: s?.failed_runs_7d ?? null,
    open_tasks: s?.open_tasks ?? null, ai_requests_30d: s?.ai_requests_30d ?? null, ai_cost_30d: s?.ai_cost_30d ?? null,
    storage_bytes: s?.storage_bytes ?? null, queue_pending: s?.queue_pending ?? null, queue_dead: s?.queue_dead ?? null,
    licences: ents.length, trial_ends_at: trialEnd(ents), sso_only: Boolean((t as any).sso?.sso_only), last_activity_at: s?.last_activity_at ?? null,
  })
}

/** Role slugs per (tenant, user). */
async function rolesOf(tenantIds: readonly string[], userIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!tenantIds.length || !userIds.length) return out
  const db = instanceDb() as any
  const { data: links } = await db.from('user_roles').select('tenant_id, user_id, role_id').in('tenant_id', [...new Set(tenantIds)].slice(0, 200)).in('user_id', [...new Set(userIds)].slice(0, 500)).limit(5000)
  const roleIds = [...new Set(((links ?? []) as any[]).map((l) => l.role_id))]
  const roles = new Map<string, string>()
  for (let i = 0; i < roleIds.length; i += 200) {
    const { data } = await db.from('roles').select('id, slug').in('id', roleIds.slice(i, i + 200))
    for (const r of (data ?? []) as any[]) roles.set(r.id, r.slug)
  }
  for (const l of (links ?? []) as any[]) {
    const key = `${l.tenant_id}:${l.user_id}`
    const slug = roles.get(l.role_id)
    if (slug) out.set(key, [...(out.get(key) ?? []), slug])
  }
  return out
}

const ROLE_ORDER = ['owner', 'admin', 'manager', 'member', 'viewer']
const topRole = (roles: string[]) => [...roles].sort((a, b) => (ROLE_ORDER.indexOf(a) + 99) % 99 - (ROLE_ORDER.indexOf(b) + 99) % 99)[0] ?? null

async function ownersOf(workspaceId: string): Promise<string[]> {
  const db = instanceDb() as any
  const { data: role } = await db.from('roles').select('id').eq('tenant_id', workspaceId).eq('slug', 'owner').maybeSingle()
  if (!role) return []
  const { data: links } = await db.from('user_roles').select('user_id').eq('tenant_id', workspaceId).eq('role_id', role.id).limit(20)
  const names = await userNames(((links ?? []) as any[]).map((l) => l.user_id))
  return [...names.values()].map((n) => n.email)
}

/* ── People ───────────────────────────────────────────────────────────── */

const USER_SORTS = new Set(['email', 'display_name', 'created_at', 'last_seen_at'])

export async function listUsers(params: InstanceDatasetParams): Promise<InstancePage> {
  const { limit, offset } = paging(params)
  const db = instanceDb() as any
  let q = db.from('users').select('id, email, display_name, tenant_id, last_seen_at, created_at', { count: 'exact' }).is('deleted_at', null)
  if (params.q) q = q.or(`email.ilike.${like(params.q)},display_name.ilike.${like(params.q)}`)
  if (params.user_id) q = q.eq('id', params.user_id)
  if (params.workspace_id) {
    const { data: m } = await db.from('user_memberships').select('user_id').eq('tenant_id', params.workspace_id).limit(5000)
    q = q.in('id', ((m ?? []) as any[]).map((r) => r.user_id).concat(['00000000-0000-0000-0000-000000000000']))
  }
  let locked: Map<string, string | null> | null = null
  if (params.status === 'Locked') {
    locked = new Map((await lockedAccounts(2000)).map((l) => [l.user_id, l.until]))
    q = q.in('id', [...locked.keys(), '00000000-0000-0000-0000-000000000000'])
  } else if (params.status === 'Never signed in') q = q.is('last_seen_at', null)
  const sort = params.sort && USER_SORTS.has(params.sort) ? params.sort : 'created_at'
  q = q.order(sort, { ascending: params.sort && USER_SORTS.has(params.sort) ? (params.dir ?? 'asc') === 'asc' : false, nullsFirst: false }).range(offset, offset + limit - 1)
  const { data, error, count } = await q
  if (error) throw new Error(`users: ${error.message}`)
  const users = (data ?? []) as any[]
  const ids = users.map((u) => u.id)
  const [states, memberships, homes] = await Promise.all([
    accountStates(ids),
    ids.length ? db.from('user_memberships').select('user_id, is_active').in('user_id', ids).limit(5000) : Promise.resolve({ data: [] }),
    tenantNames(users.map((u) => u.tenant_id)),
  ])
  const counts = new Map<string, { all: number; active: number }>()
  for (const m of (memberships.data ?? []) as any[]) {
    const c = counts.get(m.user_id) ?? { all: 0, active: 0 }
    c.all += 1
    if (m.is_active) c.active += 1
    counts.set(m.user_id, c)
  }
  const rows = users.map((u) => {
    const st = states.get(u.id)
    const c = counts.get(u.id) ?? { all: 0, active: 0 }
    const status = st?.locked ? 'Locked' : !u.last_seen_at && !st?.last_sign_in_at ? 'Never signed in' : c.all > 0 && c.active === 0 ? 'Deactivated' : 'Active'
    return { ...u, home_workspace: homes.get(u.tenant_id)?.name ?? null, workspaces: c.active, status, locked: Boolean(st?.locked) }
  })
  return { dataset: 'users', rows: rows.map((r) => projectRow('users', r)), total: count ?? rows.length, limit, offset }
}

export async function getUser(userId: string): Promise<Record<string, unknown>> {
  const db = instanceDb() as any
  const { data: u, error } = await db.from('users').select('id, email, display_name, tenant_id, timezone, last_seen_at, created_at').eq('id', userId).is('deleted_at', null).maybeSingle()
  if (error) throw new Error(`users: ${error.message}`)
  if (!u) throw ServiceError.notFound('No such person')
  const [states, memberships, homes, kind] = await Promise.all([
    accountStates([userId]),
    db.from('user_memberships').select('is_active').eq('user_id', userId).limit(500),
    tenantNames([u.tenant_id]),
    authKind(),
  ])
  const st = states.get(userId)
  const ms = (memberships.data ?? []) as any[]
  const active = ms.filter((m) => m.is_active).length
  return projectRow('user', {
    ...u, home_workspace_id: u.tenant_id, home_workspace: homes.get(u.tenant_id)?.name ?? null, workspaces: active,
    status: st?.locked ? 'Locked' : !u.last_seen_at && !st?.last_sign_in_at ? 'Never signed in' : ms.length > 0 && active === 0 ? 'Deactivated' : 'Active',
    locked: Boolean(st?.locked), locked_until: st?.locked_until ?? null, failed_attempts: st?.failed_attempts ?? null,
    banned_until: st?.banned_until ?? null, email_confirmed: st?.email_confirmed ?? null,
    mfa: st?.mfa === 'on' ? 'On' : st?.mfa === 'off' ? 'Off' : 'Not available', sign_in_methods: (st?.sign_in_methods ?? []).join(', ') || null,
    open_sessions: st?.open_sessions ?? null, last_sign_in_at: st?.last_sign_in_at ?? null, auth_provider: kind === 'supabase' ? 'Supabase Auth' : 'Built-in',
  })
}

export async function listMemberships(params: InstanceDatasetParams): Promise<InstancePage> {
  if (!params.workspace_id && !params.user_id) throw ServiceError.validation('Give workspace_id or user_id')
  const db = instanceDb() as any
  let q = db.from('user_memberships').select('id, tenant_id, user_id, is_active, is_home, joined_at').limit(5000)
  if (params.workspace_id) q = q.eq('tenant_id', params.workspace_id)
  if (params.user_id) q = q.eq('user_id', params.user_id)
  const { data, error } = await q
  if (error) throw new Error(`user_memberships: ${error.message}`)
  const ms = (data ?? []) as any[]
  const [tenants, users, roles] = await Promise.all([
    tenantNames(ms.map((m) => m.tenant_id)),
    (async () => {
      const out = new Map<string, any>()
      const ids = [...new Set(ms.map((m) => m.user_id))]
      for (let i = 0; i < ids.length; i += 200) {
        const { data: us } = await db.from('users').select('id, email, display_name, last_seen_at').in('id', ids.slice(i, i + 200))
        for (const u of (us ?? []) as any[]) out.set(u.id, u)
      }
      return out
    })(),
    rolesOf(ms.map((m) => m.tenant_id), ms.map((m) => m.user_id)),
  ])
  let rows = ms.map((m) => {
    const u = users.get(m.user_id)
    const r = roles.get(`${m.tenant_id}:${m.user_id}`) ?? []
    return {
      id: m.id, workspace_id: m.tenant_id, workspace: tenants.get(m.tenant_id)?.name ?? null, workspace_slug: tenants.get(m.tenant_id)?.slug ?? null,
      user_id: m.user_id, email: u?.email ?? null, display_name: u?.display_name ?? null, role: topRole(r), roles: r.join(', ') || null,
      active: Boolean(m.is_active), is_home: Boolean(m.is_home), joined_at: m.joined_at, last_seen_at: u?.last_seen_at ?? null,
    }
  })
  if (params.q) { const t = params.q.toLowerCase(); rows = rows.filter((r) => `${r.email} ${r.display_name} ${r.workspace}`.toLowerCase().includes(t)) }
  if (params.status === 'active') rows = rows.filter((r) => r.active)
  if (params.status === 'inactive') rows = rows.filter((r) => !r.active)
  return page('memberships', rows, params, { sort: 'joined_at', dir: 'desc' })
}

/* ── Invitations ──────────────────────────────────────────────────────── */

export function invitationStatus(i: { accepted_at: string | null; expires_at: string | null }, now = Date.now()): 'accepted' | 'expired' | 'pending' {
  if (i.accepted_at) return 'accepted'
  if (i.expires_at && new Date(i.expires_at).getTime() < now) return 'expired'
  return 'pending'
}

export async function listInvitations(params: InstanceDatasetParams): Promise<InstancePage> {
  const { limit, offset } = paging(params)
  const db = instanceDb() as any
  // Never `token`.
  let q = db.from('invitations').select('id, tenant_id, email, role, invited_by, accepted_at, expires_at, created_at', { count: 'exact' })
  if (params.workspace_id) q = q.eq('tenant_id', params.workspace_id)
  if (params.q) q = q.ilike('email', like(params.q))
  const nowIso = new Date().toISOString()
  if (params.status === 'pending') q = q.is('accepted_at', null).gt('expires_at', nowIso)
  else if (params.status === 'expired') q = q.is('accepted_at', null).lte('expires_at', nowIso)
  else if (params.status === 'accepted') q = q.not('accepted_at', 'is', null)
  const sortable = new Set(['email', 'role', 'created_at', 'expires_at', 'accepted_at'])
  const sort = params.sort && sortable.has(params.sort) ? params.sort : 'created_at'
  q = q.order(sort, { ascending: params.sort && sortable.has(params.sort) ? (params.dir ?? 'asc') === 'asc' : false }).range(offset, offset + limit - 1)
  const { data, error, count } = await q
  if (error) throw new Error(`invitations: ${error.message}`)
  const inv = (data ?? []) as any[]
  const [tenants, inviters] = await Promise.all([tenantNames(inv.map((i) => i.tenant_id)), userNames(inv.map((i) => i.invited_by))])
  const rows = inv.map((i) => ({
    ...i, workspace_id: i.tenant_id, workspace: tenants.get(i.tenant_id)?.name ?? null, status: invitationStatus(i),
    invited_by: inviters.get(i.invited_by)?.name ?? null,
  }))
  return { dataset: 'invitations', rows: rows.map((r) => projectRow('invitations', r)), total: count ?? rows.length, limit, offset }
}

/* ── Usage, AI, assets, health, queue ─────────────────────────────────── */

export async function listUsage(params: InstanceDatasetParams): Promise<InstancePage> {
  const days = params.days ?? 30
  const from = ago(days); const to = new Date()
  const db = instanceDb() as any
  let tq = db.from('tenants').select('id, name').is('deleted_at', null).limit(2000)
  if (params.workspace_id) tq = tq.eq('id', params.workspace_id)
  if (params.q) tq = tq.ilike('name', like(params.q))
  const [{ data: tenants }, runs, tasks, ai, keys, stats] = await Promise.all([
    tq, dailyCounts('runs', from, to), dailyCounts('tasks', from, to), dailyCounts('ai_requests', from, to),
    db.from('api_keys').select('tenant_id, last_used_at').eq('is_revoked', false).limit(10_000),
    Promise.resolve(null),
  ])
  void stats
  const list = (tenants ?? []) as any[]
  const storage = await workspaceStats(list.map((t) => t.id).slice(0, params.workspace_id ? 1 : 2000))
  const acc = new Map<string, any>()
  const get = (id: string | null) => {
    if (!id) return null
    if (!acc.has(id)) acc.set(id, { runs: 0, failed_runs: 0, tasks: 0, ai_requests: 0, ai_cost: 0, api_keys: 0, api_last_used_at: null })
    return acc.get(id)
  }
  for (const r of runs.rows) { const a = get(r.tenant_id); if (a) { a.runs += r.n; if (r.status === 'failed') a.failed_runs += r.n } }
  for (const r of tasks.rows) { const a = get(r.tenant_id); if (a) a.tasks += r.n }
  for (const r of ai.rows) { const a = get(r.tenant_id); if (a) { a.ai_requests += r.n; a.ai_cost += r.amount ?? 0 } }
  for (const k of (keys.data ?? []) as any[]) {
    const a = get(k.tenant_id); if (!a) continue
    a.api_keys += 1
    if (k.last_used_at && (!a.api_last_used_at || k.last_used_at > a.api_last_used_at)) a.api_last_used_at = k.last_used_at
  }
  const rows = list.map((t) => {
    const a = acc.get(t.id) ?? get(t.id)
    return {
      workspace_id: t.id, workspace: t.name, ...a, ai_cost: Math.round(a.ai_cost * 100) / 100,
      failure_rate: pct(a.failed_runs, a.runs), storage_bytes: storage.get(t.id)?.storage_bytes ?? null, days,
    }
  })
  return page('usage', rows, params, { sort: 'runs', dir: 'desc' }, { truncated: runs.truncated || tasks.truncated || ai.truncated })
}

export async function listAiUsage(params: InstanceDatasetParams): Promise<InstancePage> {
  const days = params.days ?? 30
  const from = ago(days).toISOString()
  const db = instanceDb() as any
  const CAP = 10_000
  let a = db.from('agent_runs').select('tenant_id, model, status, input_tokens, output_tokens, total_tokens, cost_amount, cost_currency, price, started_at').gte('started_at', from).order('started_at', { ascending: false }).limit(CAP)
  let b = db.from('assistant_usage').select('tenant_id, provider, model, status, prompt_tokens, completion_tokens, total_tokens, cost_amount, cost_currency, source, created_at').gte('created_at', from).order('created_at', { ascending: false }).limit(CAP)
  if (params.workspace_id) { a = a.eq('tenant_id', params.workspace_id); b = b.eq('tenant_id', params.workspace_id) }
  const [ra, rb] = await Promise.all([a, b])
  const groups = new Map<string, any>()
  const add = (day: string, tenant: string, source: string, provider: string | null, model: string | null, status: string, inT: number, outT: number, total: number, cost: number, currency: string | null) => {
    const key = `${day}|${tenant}|${source}|${provider}|${model}`
    const g = groups.get(key) ?? { id: key, day, workspace_id: tenant, source, provider, model, requests: 0, failed: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost: 0, cost_currency: currency ?? 'USD' }
    g.requests += 1
    if (status === 'failed') g.failed += 1
    g.input_tokens += inT; g.output_tokens += outT; g.total_tokens += total; g.cost += cost
    groups.set(key, g)
  }
  for (const r of (ra.data ?? []) as any[]) add(String(r.started_at).slice(0, 10), r.tenant_id, 'Agents', r.price?.provider ?? null, r.model, r.status, num(r.input_tokens), num(r.output_tokens), num(r.total_tokens), num(r.cost_amount), r.cost_currency)
  for (const r of (rb.data ?? []) as any[]) add(String(r.created_at).slice(0, 10), r.tenant_id, r.source === 'pdf_import' ? 'PDF import' : r.source === 'redact_ai' ? 'Redaction' : 'Assistant', r.provider, r.model, r.status, num(r.prompt_tokens), num(r.completion_tokens), num(r.total_tokens), num(r.cost_amount), r.cost_currency)
  const names = await tenantNames([...groups.values()].map((g) => g.workspace_id))
  let rows = [...groups.values()].map((g) => ({ ...g, cost: Math.round(g.cost * 10000) / 10000, workspace: names.get(g.workspace_id)?.name ?? null }))
  if (params.q) { const t = params.q.toLowerCase(); rows = rows.filter((r) => `${r.workspace} ${r.model} ${r.provider}`.toLowerCase().includes(t)) }
  return page('ai_usage', rows, params, { sort: 'day', dir: 'desc' }, { truncated: (ra.data ?? []).length >= CAP || (rb.data ?? []).length >= CAP })
}

const ASSET_KINDS: Array<{ kind: string; label: string; table: string; active?: (q: any) => any; scope?: (q: any) => any }> = [
  { kind: 'forms', label: 'Forms', table: 'forms' },
  { kind: 'workflows', label: 'Workflows', table: 'workflows', active: (q) => q.eq('is_active', true) },
  { kind: 'apps', label: 'Apps', table: 'apps' },
  { kind: 'data_tables', label: 'Data tables', table: 'custom_tables' },
  { kind: 'reports', label: 'Reports', table: 'reports' },
  { kind: 'agents', label: 'Agents', table: 'agents', active: (q) => q.eq('is_active', true) },
  { kind: 'decision_tables', label: 'Decision tables', table: 'decision_tables' },
  { kind: 'email_templates', label: 'Email templates', table: 'email_templates' },
  { kind: 'integrations', label: 'Integrations', table: 'integrations', active: (q) => q.eq('is_active', true) },
  { kind: 'api_keys', label: 'API keys', table: 'api_keys', active: (q) => q.eq('is_revoked', false) },
  { kind: 'workflow_runs', label: 'Workflow runs (all time)', table: 'workflow_runs' },
  { kind: 'tasks', label: 'Tasks (all time)', table: 'tasks', scope: (q) => q.is('deleted_at', null) },
  { kind: 'form_submissions', label: 'Form submissions (count)', table: 'form_submissions' },
  { kind: 'data_rows', label: 'Data table rows (count)', table: 'custom_table_rows' },
]

export async function listAssets(params: InstanceDatasetParams): Promise<InstancePage> {
  const db = instanceDb() as any
  const head = async (table: string, extra?: (q: any) => any) => {
    let q = db.from(table).select('id', { count: 'exact', head: true })
    if (params.workspace_id) q = q.eq('tenant_id', params.workspace_id)
    if (extra) q = extra(q)
    const { count, error } = await q
    return error ? null : Number(count ?? 0)
  }
  const rows = await Promise.all(ASSET_KINDS.map(async (k) => ({
    workspace_id: params.workspace_id ?? null, kind: k.kind, label: k.label,
    count: await head(k.table, k.scope), active: k.active ? await head(k.table, (q) => k.active!(k.scope ? k.scope(q) : q)) : null,
  })))
  return page('assets', rows, { ...params, limit: params.limit ?? 50 }, { sort: 'label', dir: 'asc' })
}

export async function listHealth(params: InstanceDatasetParams): Promise<InstancePage> {
  const from = ago(7); const to = new Date()
  const db = instanceDb() as any
  const [runs, agents, queue, paused, dead, failures] = await Promise.all([
    dailyCounts('runs', from, to), dailyCounts('agent_runs', from, to),
    db.from('workflow_queue').select('tenant_id, status, created_at').or(`status.in.(pending,processing),and(status.eq.dead,created_at.gte.${from.toISOString()})`).limit(10_000),
    db.from('workflow_runs').select('tenant_id').eq('status', 'paused').not('pause_variables->>_licence_blocked_node_id', 'is', null).limit(10_000),
    db.from('dead_letter_events').select('tenant_id').gte('created_at', from.toISOString()).limit(10_000),
    db.from('workflow_runs').select('tenant_id, started_at').eq('status', 'failed').gte('started_at', from.toISOString()).order('started_at', { ascending: false }).limit(5000),
  ])
  const acc = new Map<string, any>()
  const get = (id: string | null) => {
    if (!id) return null
    if (!acc.has(id)) acc.set(id, { workspace_id: id, runs_7d: 0, failed_runs_7d: 0, agent_errors_7d: 0, queue_pending: 0, queue_dead_7d: 0, paused_runs: 0, dead_letters_7d: 0, last_failure_at: null })
    return acc.get(id)
  }
  for (const r of runs.rows) { const a = get(r.tenant_id); if (a) { a.runs_7d += r.n; if (r.status === 'failed') a.failed_runs_7d += r.n } }
  for (const r of agents.rows) { const a = get(r.tenant_id); if (a && r.status === 'failed') a.agent_errors_7d += r.n }
  for (const q of (queue.data ?? []) as any[]) { const a = get(q.tenant_id); if (!a) continue; if (q.status === 'dead') a.queue_dead_7d += 1; else a.queue_pending += 1 }
  for (const p of (paused.data ?? []) as any[]) { const a = get(p.tenant_id); if (a) a.paused_runs += 1 }
  for (const d of (dead.data ?? []) as any[]) { const a = get(d.tenant_id); if (a) a.dead_letters_7d += 1 }
  for (const f of (failures.data ?? []) as any[]) { const a = get(f.tenant_id); if (a && !a.last_failure_at) a.last_failure_at = f.started_at }
  if (params.workspace_id) for (const id of [...acc.keys()]) if (id !== params.workspace_id) acc.delete(id)
  if (params.workspace_id) get(params.workspace_id)
  const names = await tenantNames([...acc.keys()])
  let rows = [...acc.values()].map((a) => {
    const rate = pct(a.failed_runs_7d, a.runs_7d)
    const status = (a.failed_runs_7d >= 10 && rate >= 20) || a.queue_dead_7d >= 5 || a.agent_errors_7d >= 20 ? 'Failing'
      : a.failed_runs_7d > 0 || a.queue_dead_7d > 0 || a.agent_errors_7d > 0 || a.paused_runs > 0 || a.dead_letters_7d > 0 ? 'Warning' : 'Healthy'
    return { ...a, workspace: names.get(a.workspace_id)?.name ?? null, failure_rate_7d: rate, status }
  }).filter((r) => r.workspace !== null)
  if (params.status) rows = rows.filter((r) => r.status === params.status)
  if (params.q) { const t = params.q.toLowerCase(); rows = rows.filter((r) => String(r.workspace).toLowerCase().includes(t)) }
  return page('health', rows, params, { sort: 'failed_runs_7d', dir: 'desc' }, { truncated: runs.truncated || agents.truncated })
}

/** The instance's workflow queue health (get_queue_health, migration 20270124090000), or null. */
async function queueHealth(): Promise<Record<string, number> | null> {
  try {
    const { data, error } = await (instanceDb() as any).rpc('get_queue_health', { p_tenant_id: null })
    return error ? null : (data as Record<string, number>)
  } catch {
    return null
  }
}

export async function listQueue(): Promise<InstancePage> {
  const db = instanceDb() as any
  const rows: Array<Record<string, unknown>> = []
  const qh: any = await queueHealth()
  rows.push({
    queue: 'Workflow queue', due: qh?.due ?? null, scheduled: qh?.scheduled ?? null, processing: qh?.processing ?? null, stuck: qh?.stuck ?? null,
    retrying: qh?.retrying ?? null, dead_24h: qh?.dead_24h ?? null, oldest_due_seconds: qh?.oldest_due_seconds ?? null,
  })
  const head = async (table: string, build: (q: any) => any) => {
    const { count, error } = await build(db.from(table).select('id', { count: 'exact', head: true }))
    return error ? null : Number(count ?? 0)
  }
  const day = ago(1).toISOString()
  const now = new Date().toISOString()
  const [aDue, aProc, aFail, jQueued, jRun, jFail, dPending, dFail] = await Promise.all([
    head('agent_queue', (q) => q.eq('status', 'pending').lte('scheduled_for', now)),
    head('agent_queue', (q) => q.eq('status', 'processing')),
    head('agent_queue', (q) => q.in('status', ['failed', 'dead']).gte('created_at', day)),
    head('user_jobs', (q) => q.eq('status', 'queued')),
    head('user_jobs', (q) => q.eq('status', 'running')),
    head('user_jobs', (q) => q.eq('status', 'failed').gte('created_at', day)),
    head('deletion_queue', (q) => q.eq('status', 'pending')),
    head('deletion_queue', (q) => q.eq('status', 'failed')),
  ])
  rows.push({ queue: 'Agent queue', due: aDue, scheduled: null, processing: aProc, stuck: null, retrying: null, dead_24h: aFail, oldest_due_seconds: null })
  rows.push({ queue: 'Background jobs', due: jQueued, scheduled: null, processing: jRun, stuck: null, retrying: null, dead_24h: jFail, oldest_due_seconds: null })
  rows.push({ queue: 'Deletion queue', due: dPending, scheduled: null, processing: null, stuck: null, retrying: null, dead_24h: dFail, oldest_due_seconds: null })
  return { dataset: 'queue', rows: rows.map((r) => projectRow('queue', r)), total: rows.length, limit: rows.length, offset: 0 }
}

export async function listSignins(params: InstanceDatasetParams): Promise<InstancePage> {
  const { limit, offset } = paging(params)
  const db = instanceDb() as any
  let q = db.from('users').select('id, email, display_name, tenant_id, last_seen_at, created_at', { count: 'exact' }).is('deleted_at', null).not('last_seen_at', 'is', null)
  if (params.days) q = q.gte('last_seen_at', ago(params.days).toISOString())
  if (params.q) q = q.or(`email.ilike.${like(params.q)},display_name.ilike.${like(params.q)}`)
  if (params.workspace_id) {
    const { data: m } = await db.from('user_memberships').select('user_id').eq('tenant_id', params.workspace_id).limit(5000)
    q = q.in('id', ((m ?? []) as any[]).map((r) => r.user_id).concat(['00000000-0000-0000-0000-000000000000']))
  }
  const { data, error, count } = await q.order('last_seen_at', { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw new Error(`users: ${error.message}`)
  const users = (data ?? []) as any[]
  const homes = await tenantNames(users.map((u) => u.tenant_id))
  const rows = users.map((u) => ({ ...u, user_id: u.id, home_workspace: homes.get(u.tenant_id)?.name ?? null }))
  return { dataset: 'signins', rows: rows.map((r) => projectRow('signins', r)), total: count ?? rows.length, limit, offset }
}

export async function listLicences(params: InstanceDatasetParams): Promise<InstancePage> {
  const ents = await entitlements({ tenantId: params.workspace_id })
  const names = await tenantNames(ents.map((e) => e.tenant_id))
  let rows = ents.map((e) => ({
    ...e, workspace_id: e.tenant_id, workspace: names.get(e.tenant_id)?.name ?? null, state: entitlementState(e),
    days_left: e.ends_at ? Math.ceil((new Date(e.ends_at).getTime() - Date.now()) / DAY) : null,
  }))
  if (params.status) rows = rows.filter((r) => r.state === params.status || r.source === params.status)
  if (params.q) { const t = params.q.toLowerCase(); rows = rows.filter((r) => `${r.workspace} ${r.extension_id} ${r.edition}`.toLowerCase().includes(t)) }
  return page('licences', rows, params, { sort: 'ends_at', dir: 'asc' })
}

/* ── Audit ────────────────────────────────────────────────────────────── */

export async function listInstanceAudit(params: InstanceDatasetParams): Promise<InstancePage> {
  const { limit, offset } = paging(params)
  const db = instanceDb() as any
  let q = db.from('instance_admin_audit').select('id, created_at, admin_email, action, target_tenant_id, target_user_id, target_label, reason, outcome, via', { count: 'exact' })
  if (params.workspace_id) q = q.eq('target_tenant_id', params.workspace_id)
  if (params.user_id) q = q.eq('target_user_id', params.user_id)
  if (params.status) q = q.eq('outcome', params.status)
  if (params.days) q = q.gte('created_at', ago(params.days).toISOString())
  if (params.q) q = q.or(`admin_email.ilike.${like(params.q)},action.ilike.${like(params.q)},target_label.ilike.${like(params.q)},reason.ilike.${like(params.q)}`)
  const { data, error, count } = await q.order('created_at', { ascending: params.dir === 'asc' }).range(offset, offset + limit - 1)
  if (error) {
    if (/does not exist|schema cache|relation/i.test(error.message ?? '')) {
      return { dataset: 'audit', rows: [], total: 0, limit, offset, note: 'The instance admin audit table is missing: apply migration 20270129090000_instance_admin.sql' }
    }
    throw new Error(`instance_admin_audit: ${error.message}`)
  }
  const rows = (data ?? []) as any[]
  const names = await tenantNames(rows.map((r) => r.target_tenant_id))
  return {
    dataset: 'audit', total: count ?? rows.length, limit, offset,
    rows: rows.map((r) => projectRow('audit', {
      ...r, workspace_id: r.target_tenant_id, workspace: names.get(r.target_tenant_id)?.name ?? null,
      action_label: isInstanceAction(r.action) ? INSTANCE_ACTION_LABELS[r.action as keyof typeof INSTANCE_ACTION_LABELS] : r.action,
    })),
  }
}

export async function listWorkspaceAudit(params: InstanceDatasetParams): Promise<InstancePage> {
  if (!params.workspace_id) throw ServiceError.validation('Give workspace_id')
  const { limit, offset } = paging(params)
  const db = instanceDb() as any
  // Never summary / diff / the rest of metadata (they can name content).
  let q = db.from('object_audit_log').select('id, created_at, object_type, action, actor_id, via:metadata->>via', { count: 'exact' }).eq('tenant_id', params.workspace_id)
  if (params.days) q = q.gte('created_at', ago(params.days).toISOString())
  if (params.status) q = q.eq('object_type', params.status)
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw new Error(`object_audit_log: ${error.message}`)
  const rows = (data ?? []) as any[]
  const actors = await userNames(rows.map((r) => r.actor_id))
  return {
    dataset: 'workspace_audit', total: count ?? rows.length, limit, offset,
    rows: rows.map((r) => projectRow('workspace_audit', {
      ...r, workspace_id: params.workspace_id, on_behalf: r.via === 'instance_support',
      actor: r.via === 'instance_support' ? 'UserTasks support (on behalf)' : actors.get(r.actor_id)?.name ?? (r.actor_id ? 'Former member' : 'System'),
    })),
  }
}

/* ── Overview and alerts ──────────────────────────────────────────────── */

export async function getOverview(): Promise<Record<string, unknown>> {
  const db = instanceDb() as any
  const head = async (table: string, build: (q: any) => any) => {
    const { count, error } = await build(db.from(table).select('id', { count: 'exact', head: true }))
    return error ? null : Number(count ?? 0)
  }
  const now = new Date()
  const [workspaces, newWs, people, a7, a30, s7, pending, locked, ents, runs, ai, queue] = await Promise.all([
    head('tenants', (q) => q.is('deleted_at', null)),
    head('tenants', (q) => q.is('deleted_at', null).gte('created_at', ago(30).toISOString())),
    head('users', (q) => q.is('deleted_at', null)),
    head('users', (q) => q.is('deleted_at', null).gte('last_seen_at', ago(7).toISOString())),
    head('users', (q) => q.is('deleted_at', null).gte('last_seen_at', ago(30).toISOString())),
    head('users', (q) => q.is('deleted_at', null).gte('created_at', ago(7).toISOString())),
    head('invitations', (q) => q.is('accepted_at', null).gt('expires_at', now.toISOString())),
    lockedAccounts(2000),
    entitlements(),
    dailyCounts('runs', ago(7), now),
    dailyCounts('ai_requests', ago(30), now),
    queueHealth(),
  ])
  // Summed in the database (migration 20270131130000): the row lists were
  // cut at max_rows (1,000), so the figure stopped at ~1,000 files.
  let storage: number
  const summed = await (db as any).rpc('instance_admin_storage_bytes')
  if (!summed.error && summed.data !== null && summed.data !== undefined) {
    storage = num(summed.data)
  } else {
    const [filesA, filesB] = await Promise.all([
      db.from('form_files').select('size').limit(50_000),
      db.from('task_attachments').select('size').is('deleted_at', null).limit(50_000),
    ])
    storage = [...((filesA.data ?? []) as any[]), ...((filesB.data ?? []) as any[])].reduce((s, r) => s + num(r.size), 0)
  }
  const runsTotal = runs.rows.reduce((s, r) => s + r.n, 0)
  const failed = runs.rows.filter((r) => r.status === 'failed').reduce((s, r) => s + r.n, 0)
  const qh: any = queue
  return projectRow('overview', {
    workspaces, new_workspaces_30d: newWs, people, active_7d: a7, active_30d: a30, signups_7d: s7, pending_invitations: pending,
    locked_accounts: locked.length,
    trials_ending_14d: ents.filter((e) => e.source === 'trial' && entitlementState(e) === 'expiring').length,
    runs_7d: runsTotal, failed_runs_7d: failed, failure_rate_7d: pct(failed, runsTotal),
    ai_cost_30d: Math.round(ai.rows.reduce((s, r) => s + (r.amount ?? 0), 0) * 100) / 100,
    ai_requests_30d: ai.rows.reduce((s, r) => s + r.n, 0), storage_bytes: storage,
    queue_due: qh?.due ?? null, queue_dead_24h: qh?.dead_24h ?? null, generated_at: now.toISOString(),
    summary: `${workspaces ?? 0} workspaces · ${people ?? 0} people`, locked_summary: `${locked.length} locked right now`,
  })
}

export async function listAlerts(params: InstanceDatasetParams): Promise<InstancePage> {
  const alerts: Array<Record<string, unknown>> = []
  const now = new Date()
  const [locked, ents, health, aiDaily] = await Promise.all([
    lockedAccounts(50), entitlements(), listHealth({ limit: 200 }), dailyCounts('ai_requests', ago(8), now),
  ])
  const users = await userNames(locked.map((l) => l.user_id))
  for (const l of locked) {
    alerts.push({ id: `locked:${l.user_id}`, severity: 'warning', kind: 'locked_account', title: `Locked account: ${users.get(l.user_id)?.email ?? l.user_id}`, detail: l.until ? `Until ${l.until}` : 'Suspended', user_id: l.user_id, at: now.toISOString() })
  }
  const names = await tenantNames(ents.map((e) => e.tenant_id))
  for (const e of ents) {
    const state = entitlementState(e)
    if (e.source === 'trial' && state === 'expiring') {
      alerts.push({ id: `trial:${e.id}`, severity: 'info', kind: 'trial_ending', title: `Trial ending: ${names.get(e.tenant_id)?.name ?? e.tenant_id} (${e.extension_id})`, detail: `Ends ${iso(e.ends_at)}`, workspace_id: e.tenant_id, workspace: names.get(e.tenant_id)?.name ?? null, at: e.ends_at })
    } else if (state === 'expired' || state === 'suspended') {
      alerts.push({ id: `licence:${e.id}`, severity: 'warning', kind: 'licence_lapsed', title: `Licence ${state}: ${names.get(e.tenant_id)?.name ?? e.tenant_id} (${e.extension_id})`, detail: e.ends_at ? `Ended ${iso(e.ends_at)}` : state, workspace_id: e.tenant_id, workspace: names.get(e.tenant_id)?.name ?? null, at: e.updated_at })
    }
  }
  for (const h of health.rows) {
    if (h.status === 'Failing') {
      alerts.push({ id: `failing:${h.workspace_id}`, severity: 'danger', kind: 'failing_workspace', title: `Failing workspace: ${h.workspace}`, detail: `${h.failed_runs_7d} failed runs, ${h.agent_errors_7d} agent errors, ${h.queue_dead_7d} dead jobs (7 days)`, workspace_id: h.workspace_id, workspace: h.workspace, at: h.last_failure_at ?? now.toISOString() })
    }
  }
  // AI spend spike: the last 24 hours over 3× the daily average of the 7 days before, and over $5.
  const dayStart = now.getTime() - DAY
  const byTenant = new Map<string, { recent: number; before: number }>()
  for (const r of aiDaily.rows) {
    if (!r.tenant_id) continue
    const t = byTenant.get(r.tenant_id) ?? { recent: 0, before: 0 }
    if (new Date(`${r.day}T23:59:59Z`).getTime() >= dayStart) t.recent += r.amount ?? 0
    else t.before += r.amount ?? 0
    byTenant.set(r.tenant_id, t)
  }
  const spikeNames = await tenantNames([...byTenant.keys()])
  for (const [id, t] of byTenant) {
    const avg = t.before / 7
    if (t.recent > 5 && t.recent > avg * 3) {
      alerts.push({ id: `ai:${id}`, severity: 'warning', kind: 'ai_spend_spike', title: `AI spend spike: ${spikeNames.get(id)?.name ?? id}`, detail: `$${t.recent.toFixed(2)} today vs $${avg.toFixed(2)} a day before`, workspace_id: id, workspace: spikeNames.get(id)?.name ?? null, at: now.toISOString() })
    }
  }
  let rows = alerts
  if (params.status) rows = rows.filter((a) => a.severity === params.status || a.kind === params.status)
  if (params.workspace_id) rows = rows.filter((a) => a.workspace_id === params.workspace_id)
  const rank: Record<string, number> = { danger: 0, warning: 1, info: 2 }
  rows.sort((a, b) => rank[String(a.severity)] - rank[String(b.severity)])
  const { limit, offset } = paging(params, 50)
  return { dataset: 'alerts', rows: rows.slice(offset, offset + limit).map((r) => projectRow('alerts', r)), total: rows.length, limit, offset }
}

/* ── Dispatcher ───────────────────────────────────────────────────────── */

/** One dataset (callers check the instance admin first). Records come back as a one-row page. */
export async function readDataset(dataset: InstanceDataset, params: InstanceDatasetParams): Promise<InstancePage> {
  const one = (row: Record<string, unknown>): InstancePage => ({ dataset, rows: [row], total: 1, limit: 1, offset: 0 })
  switch (dataset) {
    case 'overview': return one(await getOverview())
    case 'alerts': return listAlerts(params)
    case 'workspaces': return listWorkspaces(params)
    case 'workspace':
      if (!params.workspace_id) throw ServiceError.validation('Give workspace_id')
      return one(await getWorkspace(params.workspace_id))
    case 'users': return listUsers(params)
    case 'user':
      if (!params.user_id) throw ServiceError.validation('Give user_id')
      return one(await getUser(params.user_id))
    case 'memberships': return listMemberships(params)
    case 'invitations': return listInvitations(params)
    case 'usage': return listUsage(params)
    case 'ai_usage': return listAiUsage(params)
    case 'assets': return listAssets(params)
    case 'health': return listHealth(params)
    case 'queue': return listQueue()
    case 'signins': return listSignins(params)
    case 'licences': return listLicences(params)
    case 'audit': return listInstanceAudit(params)
    case 'workspace_audit': return listWorkspaceAudit(params)
  }
}
