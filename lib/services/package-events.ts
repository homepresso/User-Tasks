/**
 * Package history (package_events): one row per install / upgrade /
 * reinstall / downgrade / reconfigure (Complete setup) / uninstall, failed
 * attempts included — when, who, channel (UI / CLI / API / MCP), version
 * from → to, signature status, counts, requirement changes, options, errors
 * and the full plan / diff that was applied (secrets masked).
 *
 * Written by lib/services/package-installs (recordPackageEvent never throws:
 * history must not break the install it describes). Read with packages.view
 * through REST /api/v1/package-events, MCP packages_history* and
 * `usertasks packages history`. The table is service-role only.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- plans and rows are free-form JSON */

import { scrubSecretsForExport } from '@/lib/portability/scrub'
import { isUuid } from '@/lib/portability/plan'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { applyPage, dbError, serviceRoleClient, type Page } from './_shared'

export const PACKAGE_EVENT_ACTIONS = ['install', 'upgrade', 'reinstall', 'downgrade', 'reconfigure', 'uninstall'] as const
export const PACKAGE_EVENT_STATUSES = ['succeeded', 'partial', 'failed'] as const
export const PACKAGE_EVENT_CHANNELS = ['ui', 'cli', 'api', 'mcp'] as const
export type PackageEventAction = typeof PACKAGE_EVENT_ACTIONS[number]
export type PackageEventStatus = typeof PACKAGE_EVENT_STATUSES[number]
export type PackageEventChannel = typeof PACKAGE_EVENT_CHANNELS[number]

export interface PackageEventCounts {
  created?: number
  updated?: number
  unchanged?: number
  removed?: number
  skipped?: number
  gone?: number
  errors?: number
  rows_inserted?: number
  rows_updated?: number
  rows_deleted?: number
  runs_cancelled?: number
}

export interface RequirementChange {
  id: string
  label: string
  before: 'met' | 'missing' | null
  after: 'met' | 'missing' | null
}

export interface PackageEventInput {
  install_id?: string | null
  package_uid?: string | null
  package_name: string
  package_slug?: string | null
  action: PackageEventAction
  status: PackageEventStatus
  from_version?: string | null
  to_version?: string | null
  channel: PackageEventChannel
  source?: string | null
  source_label?: string | null
  signed?: boolean | null
  signature_valid?: boolean | null
  fingerprint?: string | null
  trust?: string | null
  counts?: PackageEventCounts
  requirement_changes?: RequirementChange[]
  options?: Record<string, unknown>
  plan?: unknown
  errors?: unknown[]
  error?: string | null
  summary?: string | null
}

const LIST_COLUMNS = 'id, install_id, package_uid, package_name, package_slug, action, status, from_version, to_version, channel, source, source_label, signed, signature_valid, fingerprint, trust, counts, requirement_changes, options, errors, error, summary, actor_id, backfilled, created_at'
const DETAIL_COLUMNS = `${LIST_COLUMNS}, plan`

/** Stored plans are capped: per-asset diffs first, then the whole plan. */
const MAX_PLAN_BYTES = 512 * 1024
const MAX_DIFFS_PER_ASSET = 50

/** UI / API / MCP from the context; CLI when the caller said so (the CLI calls the REST API). */
export function eventChannel(ctx: ServiceContext, declared?: string | null): PackageEventChannel {
  if (declared === 'cli') return 'cli'
  if (declared === 'mcp' || ctx.source === 'mcp') return 'mcp'
  return ctx.source === 'ui' ? 'ui' : 'api'
}

/** Mask secrets and cap the size of a plan before it is stored. */
export function storablePlan(plan: unknown): unknown {
  if (plan === undefined || plan === null) return null
  let copy: any = scrubSecretsForExport(structuredClone(plan) as any)
  const assets = Array.isArray(copy?.plan?.assets) ? copy.plan.assets : Array.isArray(copy?.assets) ? copy.assets : null
  if (assets) {
    for (const asset of assets) {
      if (Array.isArray(asset?.diffs) && asset.diffs.length > MAX_DIFFS_PER_ASSET) {
        asset.diffs = asset.diffs.slice(0, MAX_DIFFS_PER_ASSET)
        asset.diffs_truncated = true
      }
    }
  }
  if (JSON.stringify(copy).length > MAX_PLAN_BYTES) {
    // Keep the per-asset actions, drop the field diffs.
    if (assets) for (const asset of assets) { if (asset?.diffs) { delete asset.diffs; asset.diffs_truncated = true } }
    if (JSON.stringify(copy).length > MAX_PLAN_BYTES) copy = { truncated: true, note: 'The plan was too large to keep' }
    else copy.truncated = true
  }
  return copy
}

/** Requirement status before → after (new, removed and changed requirements only). */
export function requirementChanges(
  before: Array<{ id: string; label?: string; status?: string }> | null | undefined,
  after: Array<{ id: string; label?: string; status?: string }> | null | undefined,
): RequirementChange[] {
  const norm = (s: unknown) => (s === 'missing' ? 'missing' : 'met') as 'met' | 'missing'
  const prev = new Map((before ?? []).map((r) => [r.id, r]))
  const next = new Map((after ?? []).map((r) => [r.id, r]))
  const out: RequirementChange[] = []
  for (const [id, r] of next) {
    const p = prev.get(id)
    const b = p ? norm(p.status) : null
    const a = norm(r.status)
    if (b !== a) out.push({ id, label: String(r.label ?? id), before: b, after: a })
  }
  for (const [id, r] of prev) if (!next.has(id)) out.push({ id, label: String(r.label ?? id), before: norm(r.status), after: null })
  return out
}

/** Record one history event. Never throws. */
export async function recordPackageEvent(ctx: ServiceContext, input: PackageEventInput): Promise<string | null> {
  try {
    const db = await serviceRoleClient(ctx) as any
    const row = {
      tenant_id: ctx.tenantId,
      install_id: input.install_id && isUuid(input.install_id) ? input.install_id : null,
      package_uid: input.package_uid && isUuid(input.package_uid) ? input.package_uid : null,
      package_name: input.package_name || 'Unknown package',
      package_slug: input.package_slug ?? null,
      action: input.action,
      status: input.status,
      from_version: input.from_version ?? null,
      to_version: input.to_version ?? null,
      channel: input.channel,
      source: input.source ?? null,
      source_label: input.source_label ?? null,
      signed: input.signed ?? null,
      signature_valid: input.signature_valid ?? null,
      fingerprint: input.fingerprint ?? null,
      trust: input.trust ?? null,
      counts: input.counts ?? {},
      requirement_changes: input.requirement_changes ?? [],
      options: input.options ?? {},
      plan: storablePlan(input.plan),
      errors: scrubSecretsForExport((input.errors ?? []) as any),
      error: input.error ? String(input.error).slice(0, 4000) : null,
      summary: input.summary ?? null,
      actor_id: ctx.actorId,
    }
    const { data, error } = await db.from('package_events').insert(row).select('id').single()
    if (error) { console.warn('[package-events] record failed:', error.message); return null }
    return data?.id ? String(data.id) : null
  } catch (error) {
    console.warn('[package-events] record failed:', error instanceof Error ? error.message : error)
    return null
  }
}

export interface PackageEventFilters {
  /** Install id, package uid or package slug. */
  package?: string | null
  action?: string | null
  status?: string | null
  channel?: string | null
  /** Actor user id or email. */
  actor?: string | null
  /** ISO date / timestamp bounds on created_at (until is inclusive of that day when a date). */
  since?: string | null
  until?: string | null
}

function csvList(value: string | null | undefined, allowed: readonly string[], label: string): string[] {
  if (!value) return []
  const items = value.split(',').map((s) => s.trim()).filter(Boolean)
  for (const item of items) if (!allowed.includes(item)) throw ServiceError.validation(`Unknown ${label} "${item}" (one of ${allowed.join(', ')})`)
  return items
}

function parseBound(value: string | null | undefined, end: boolean): string | null {
  if (!value) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const parsed = new Date(dateOnly ? `${value}T00:00:00.000Z` : value)
  if (Number.isNaN(parsed.getTime())) throw ServiceError.validation(`Invalid date "${value}" (use YYYY-MM-DD or an ISO timestamp)`)
  if (dateOnly && end) parsed.setUTCDate(parsed.getUTCDate() + 1)
  return parsed.toISOString()
}

async function actorDirectory(db: any, ids: string[]): Promise<Map<string, { id: string; name: string | null; email: string | null }>> {
  const out = new Map<string, { id: string; name: string | null; email: string | null }>()
  const unique = [...new Set(ids.filter((id) => id && isUuid(id)))]
  if (!unique.length) return out
  const { data } = await db.from('users').select('id, display_name, email').in('id', unique)
  for (const row of data ?? []) out.set(String(row.id), { id: String(row.id), name: row.display_name ?? null, email: row.email ?? null })
  return out
}

function present(row: any, actors: Map<string, { id: string; name: string | null; email: string | null }>) {
  return { ...row, actor: row.actor_id ? actors.get(String(row.actor_id)) ?? { id: String(row.actor_id), name: null, email: null } : null }
}

/** Wrapped: a PostgREST builder is thenable, so returning it from an async function would run it. */
async function buildQuery(ctx: ServiceContext, db: any, filters: PackageEventFilters, columns: string): Promise<{ query: any }> {
  let query = db.from('package_events').select(columns, { count: 'exact' }).eq('tenant_id', ctx.tenantId)
  const pkg: string = filters.package?.trim() ?? ''
  if (pkg) {
    if (isUuid(pkg)) query = query.or(`install_id.eq.${pkg},package_uid.eq.${pkg}`)
    else {
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(pkg)) throw ServiceError.validation('package must be an install id, package id or slug')
      query = query.eq('package_slug', pkg)
    }
  }
  const actions = csvList(filters.action, PACKAGE_EVENT_ACTIONS, 'action')
  if (actions.length) query = query.in('action', actions)
  const statuses = csvList(filters.status, PACKAGE_EVENT_STATUSES, 'status')
  if (statuses.length) query = query.in('status', statuses)
  const channels = csvList(filters.channel, PACKAGE_EVENT_CHANNELS, 'channel')
  if (channels.length) query = query.in('channel', channels)
  const actor: string = filters.actor?.trim() ?? ''
  if (actor) {
    if (isUuid(actor)) query = query.eq('actor_id', actor)
    else {
      const { data } = await db.from('users').select('id').ilike('email', String(actor).replace(/[%_\\]/g, (c: string) => `\\${c}`))
      const ids = (data ?? []).map((u: any) => String(u.id))
      query = ids.length ? query.in('actor_id', ids) : query.eq('actor_id', '00000000-0000-0000-0000-000000000000')
    }
  }
  const since = parseBound(filters.since, false)
  const until = parseBound(filters.until, true)
  if (since) query = query.gte('created_at', since)
  if (until) query = query[/^\d{4}-\d{2}-\d{2}$/.test(filters.until ?? '') ? 'lt' : 'lte']('created_at', until)
  return { query: query.order('created_at', { ascending: false }).order('id', { ascending: false }) }
}

export async function listPackageEvents(ctx: ServiceContext, filters: PackageEventFilters, page: Page) {
  requirePerm(ctx, 'packages.view')
  const db = await serviceRoleClient(ctx) as any
  const { data, error, count } = await applyPage((await buildQuery(ctx, db, filters, LIST_COLUMNS)).query, page)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const actors = await actorDirectory(db, rows.map((r) => r.actor_id))
  return { events: rows.map((row) => present(row, actors)), total: count ?? rows.length }
}

export async function getPackageEvent(ctx: ServiceContext, eventId: string) {
  requirePerm(ctx, 'packages.view')
  if (!isUuid(eventId)) throw ServiceError.notFound('Package event not found')
  const db = await serviceRoleClient(ctx) as any
  const { data, error } = await db.from('package_events').select(DETAIL_COLUMNS).eq('tenant_id', ctx.tenantId).eq('id', eventId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Package event not found')
  const actors = await actorDirectory(db, [data.actor_id])
  return { event: present(data, actors) }
}

const CSV_COLUMNS = ['created_at', 'package_name', 'package_slug', 'action', 'status', 'from_version', 'to_version', 'channel', 'source', 'source_label', 'actor_email', 'actor_name', 'signature', 'fingerprint', 'created', 'updated', 'unchanged', 'removed', 'skipped', 'errors', 'requirement_changes', 'error', 'summary', 'id'] as const

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  // Spreadsheet formula injection: neutralise cells that would be evaluated.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function signatureLabel(event: { signed?: boolean | null; signature_valid?: boolean | null; trust?: string | null }): string {
  if (event.signed === null || event.signed === undefined) return ''
  if (!event.signed) return 'unsigned'
  if (event.signature_valid === false) return 'invalid signature'
  return event.trust === 'instance' ? 'signed (this instance)' : event.trust === 'trusted' ? 'signed (trusted key)' : event.trust === 'untrusted' ? 'signed (unknown key)' : 'signed'
}

/** The filtered history as CSV (newest first, at most 10,000 rows). */
export async function packageEventsCsv(ctx: ServiceContext, filters: PackageEventFilters): Promise<{ file_name: string; csv: string; rows: number }> {
  requirePerm(ctx, 'packages.view')
  const db = await serviceRoleClient(ctx) as any
  const rows: any[] = []
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const { data, error } = await (await buildQuery(ctx, db, filters, LIST_COLUMNS)).query.range(offset, offset + 999)
    if (error) throw dbError(error)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const actors = await actorDirectory(db, rows.map((r) => r.actor_id))
  const lines = [CSV_COLUMNS.join(',')]
  for (const row of rows) {
    const actor = row.actor_id ? actors.get(String(row.actor_id)) : null
    const c = row.counts ?? {}
    const values: Record<(typeof CSV_COLUMNS)[number], unknown> = {
      created_at: row.created_at, package_name: row.package_name, package_slug: row.package_slug, action: row.action, status: row.status,
      from_version: row.from_version, to_version: row.to_version, channel: row.channel, source: row.source, source_label: row.source_label,
      actor_email: actor?.email ?? '', actor_name: actor?.name ?? '', signature: signatureLabel(row), fingerprint: row.fingerprint,
      created: c.created, updated: c.updated, unchanged: c.unchanged, removed: c.removed, skipped: c.skipped, errors: c.errors,
      requirement_changes: (row.requirement_changes ?? []).map((r: RequirementChange) => `${r.label}: ${r.before ?? 'new'} → ${r.after ?? 'removed'}`).join('; '),
      error: row.error, summary: row.summary, id: row.id,
    }
    lines.push(CSV_COLUMNS.map((key) => csvCell(values[key])).join(','))
  }
  return { file_name: `package-history-${new Date().toISOString().slice(0, 10)}.csv`, csv: `${lines.join('\n')}\n`, rows: rows.length }
}
