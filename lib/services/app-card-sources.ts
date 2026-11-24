/**
 * Card view widget data: records from a data table (optionally one of its
 * saved views), a saved report's result rows, or an API reference, mapped
 * through the card template.
 *
 *  - data table: read as the viewer (data-tables service: data.view, table
 *    scope); search / sort / paging server-side.
 *  - report: reports.view and the report shared or created by the viewer;
 *    run on the viewer's session client with their permissions (the report
 *    page's own preview path).
 *  - API reference: runs with the WORKSPACE connection, so:
 *     · read-only references only (a reference that writes is refused);
 *     · people with View integrations see it; other app viewers only when a
 *       designer with Manage references turned on "Allow app viewers"
 *       (checked again when the page is saved — lib/services/apps.ts — and
 *       audited); builder previews always need View integrations;
 *     · inputs only through the reference's DECLARED inputs, from a fixed
 *       value, the viewer (me_id / me_email) or a page filter — nothing
 *       else reaches the request;
 *     · responses cached per widget for its TTL, calls rate-limited per
 *       viewer and widget; credentials, URLs and request details never
 *       leave the server — the browser gets only the template's values.
 */

import { createHash } from 'node:crypto'
import type { CardField, CardTemplate, WidgetConfig } from '@/lib/apps/schema'
import { displayText, formatCardField, type CardColumn } from '@/lib/apps/field-format'
export { displayText, formatCardField, type CardColumn } from '@/lib/apps/field-format'
import { rowFiltersOf, type FilterValues } from '@/lib/apps/widgets'
import { getDb, hasPerm, ServiceError, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'
import { getDataTable, queryRows, type RowFilter } from './data-tables'
import { displayRow, instanceList, instanceRowId, widgetColumnType } from './instance-admin/widgets'
import { eligibleCaller } from './instance-admin/access'

/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies and rows */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const CARD_RECORD_CAP = 500
export const REFERENCE_TIMEOUT_MS = 8000
/** Most uncached reference calls one viewer makes for one widget per minute. */
export const REFERENCE_RATE_PER_MIN = 20

export interface Card {
  id: string
  title: string
  subtitle: string | null
  description: string | null
  image: string | null
  badge: string | null
  badge_tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'
  /** `progress` (0–1): the field shows as a progress bar. */
  fields: Array<{ label: string; icon: string | null; value: string; progress?: number }>
  footer: string | null
  /** Values the card's actions / click-through use (only template- and action-referenced keys). */
  values: Record<string, string>
}

export interface CardViewData {
  type: 'card_view'
  cards: Card[]
  total: number
  page: number
  next: number | null
  source: 'table' | 'report' | 'reference' | 'instance'
  /** Table source: the table (row detail drawer). */
  table_id?: string
  cached?: boolean
  truncated?: boolean
}

interface Extra { params: { q?: string; page?: number }; filters: FilterValues; widgetKey: string; preview: boolean }

/* ── Pure mapping (tested) ───────────────────────────────────────────── */

/** A value at a key or dotted path of a record. */
export function pick(record: Record<string, unknown>, key: string | null | undefined): unknown {
  if (!key) return undefined
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key]
  let cursor: any = record
  for (const part of key.split('.')) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined
    cursor = cursor[part]
  }
  return cursor
}

const safeImage = (v: string | null) => (v && /^(https:\/\/|\/(?!\/))/i.test(v) ? v.slice(0, 2000) : null)

/** Keys a card's template and actions read (only these values are sent to the browser). */
export function templateKeys(t: CardTemplate, actions: WidgetConfig<'card_view'>['actions'], extra: Array<string | null | undefined> = []): string[] {
  const keys = [t.title, t.subtitle, t.description, t.image, t.badge, t.footer, ...t.fields.map((f) => f.key), ...extra]
  for (const a of actions) {
    if (a.kind === 'open_page') keys.push(a.value_key)
    if (a.kind === 'open_form') keys.push(...a.prefill.map((p) => p.key))
    if (a.kind === 'open_url') for (const m of a.url.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) keys.push(m[1])
  }
  return [...new Set(keys.filter((k): k is string => !!k))]
}

/** One record → a card through the template (`columns`: the data table's, for column currencies; `currency`: a fallback such as a board's). */
export function toCard(record: Record<string, unknown>, id: string, c: Pick<WidgetConfig<'card_view'>, 'template' | 'actions' | 'click_key'>, columns: readonly CardColumn[] = [], o: { currency?: string | null } = {}): Card {
  const t = c.template
  const badge = displayText(pick(record, t.badge))
  const tone = badge ? (t.badge_colors.find((b) => b.value.toLowerCase() === badge.toLowerCase())?.tone ?? 'neutral') : 'neutral'
  const values: Record<string, string> = {}
  for (const k of templateKeys(t, c.actions, [c.click_key])) {
    const v = displayText(pick(record, k))
    if (v !== null) values[k] = v
  }
  return {
    id,
    title: displayText(pick(record, t.title)) ?? (t.title ? '—' : 'Untitled'),
    subtitle: displayText(pick(record, t.subtitle)),
    description: displayText(pick(record, t.description)),
    image: t.image_style === 'none' ? null : safeImage(displayText(pick(record, t.image))),
    badge, badge_tone: tone,
    fields: t.fields.map((f) => ({ label: f.label ?? f.key, icon: f.icon ?? null, ...formatCardField(f, pick(record, f.key), { column: columns.find((col) => col?.key === f.key), currency: o.currency }) })),
    footer: t.footer && t.footer_format && t.footer_format !== 'text' ? (displayText(pick(record, t.footer)) === null ? null : formatCardField({ key: t.footer, format: t.footer_format }, pick(record, t.footer), { column: columns.find((col) => col?.key === t.footer), currency: o.currency }).value) : displayText(pick(record, t.footer)),
    values,
  }
}

/** Search, sort and page records in memory (report / reference sources). */
export function searchSortPage(records: Array<Record<string, unknown>>, o: { q?: string; sort?: string | null; dir: 'asc' | 'desc'; page: number; size: number }): { list: Array<Record<string, unknown>>; total: number } {
  let list = records
  const q = (o.q ?? '').trim().toLowerCase()
  if (q) list = list.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
  if (o.sort) {
    const key = o.sort
    const dir = o.dir === 'desc' ? -1 : 1
    list = [...list].sort((a, b) => {
      const x = pick(a, key)
      const y = pick(b, key)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(displayText(x) ?? '').localeCompare(String(displayText(y) ?? ''), undefined, { numeric: true }) * dir
    })
  }
  return { list: list.slice(o.page * o.size, o.page * o.size + o.size), total: list.length }
}

/**
 * The declared reference inputs, resolved: each value a literal, `{{me_id}}`,
 * `{{me_email}}`, `{{filter:<id>}}` or a bound parameter / variable / system
 * value (`{{filter:var.x}}` — the page runtime sends its value with the filters). Names the reference doesn't declare
 * are dropped; values are strings, capped.
 */
export function resolveReferenceInputs(mapping: Record<string, string>, declared: readonly string[], ctx: { userId: string | null; email: string | null; filters: FilterValues }): Record<string, string> {
  const allowed = new Set(declared)
  const out: Record<string, string> = {}
  for (const [name, raw] of Object.entries(mapping)) {
    if (!allowed.has(name)) continue
    const value = raw.replace(/\{\{\s*(me_id|me_email|filter:([a-z][a-z0-9_]{0,39}|(?:param|var|sys)\.[A-Za-z0-9_.]{1,36}))\s*\}\}/g, (_m, token: string, filterId?: string) => {
      if (token === 'me_id') return ctx.userId ?? ''
      if (token === 'me_email') return ctx.email ?? ''
      const v = filterId ? ctx.filters[filterId] : null
      return typeof v === 'string' ? v : ''
    })
    out[name] = value.slice(0, 400)
  }
  return out
}

/* ── Cache and rate limit (in-process, bounded) ──────────────────────── */

const CACHE_MAX = 300
const cache = new Map<string, { expires: number; records: Array<Record<string, unknown>> }>()
const calls = new Map<string, number[]>()
export const cardDeps = { now: () => Date.now() }

export function rateLimited(key: string, now = cardDeps.now()): boolean {
  const recent = (calls.get(key) ?? []).filter((t) => now - t < 60_000)
  if (recent.length >= REFERENCE_RATE_PER_MIN) { calls.set(key, recent); return true }
  recent.push(now)
  calls.set(key, recent)
  if (calls.size > 2000) calls.delete(calls.keys().next().value as string)
  return false
}

export function _resetCardCache() { cache.clear(); calls.clear() }

/* ── Sources ─────────────────────────────────────────────────────────── */

export async function cardViewData(ctx: ServiceContext, c: WidgetConfig<'card_view'>, extra: Extra): Promise<CardViewData | { type: 'empty'; reason: string }> {
  const page = Math.max(0, Math.min(1000, Math.floor(Number(extra.params.page ?? 0)) || 0))
  const q = (typeof extra.params.q === 'string' ? extra.params.q : typeof c.search === 'string' ? c.search : '').trim().slice(0, 200)
  const size = c.page_size
  const finish = (records: Array<{ id: string; record: Record<string, unknown> }>, total: number, more: Partial<CardViewData>, columns: readonly CardColumn[] = []): CardViewData => ({
    type: 'card_view', source: c.source, page, total, next: (page + 1) * size < total ? page + 1 : null,
    cards: records.map((r) => toCard(r.record, r.id, c, columns)), ...more,
  })

  if (c.source === 'table') {
    const tableId = typeof c.table_id === 'string' && UUID_RE.test(c.table_id) ? c.table_id : null
    if (!tableId) return { type: 'empty', reason: 'Choose a data table' }
    const table = await getDataTable(ctx, tableId) as any
    const columns: CardColumn[] = Array.isArray(table?.columns) ? table.columns : []
    const filters = rowFiltersOf(c.where) as RowFilter[]
    const result = await queryRows(ctx, tableId, { ...(q ? { search: q } : {}), ...(filters.length ? { filters } : {}), ...(c.sort ? { sort_field: c.sort, sort_direction: c.sort_dir } : {}) }, { limit: size, offset: page * size })
    return finish((result.rows as any[]).map((r) => ({ id: String(r.id), record: { ...(r.data ?? {}), id: r.id, created_at: r.created_at } })), result.total, { table_id: tableId, truncated: !!result.truncated }, columns)
  }

  if (c.source === 'instance') {
    // The built-in "UserTasks instance" source: instance admins only (403 with an access message for anyone else); paged, searched and sorted on the server.
    const result = await instanceList(ctx, { dataset: c.instance_dataset, params: c.instance_params as never, filters: extra.filters, page, size, q: q || undefined, sort: c.sort ?? null, dir: c.sort_dir })
    if (!result) return { type: 'empty', reason: 'Choose a UserTasks instance dataset' }
    const columns: CardColumn[] = result.columns.map((col) => ({ key: col.key, type: widgetColumnType(col) }))
    return finish(result.page.rows.map((r, i) => ({ id: instanceRowId(r, i), record: displayRow(result.columns, r) })), result.page.total, { truncated: !!result.page.truncated }, columns)
  }

  if (c.source === 'report') {
    const reportId = typeof c.report_id === 'string' && UUID_RE.test(c.report_id) ? c.report_id : null
    if (!reportId) return { type: 'empty', reason: 'Choose a report' }
    if (!hasPerm(ctx, 'reports.view')) throw ServiceError.forbidden('You don’t have access to reports')
    const db = getDb(ctx) as any
    const { data: report, error } = await db.from('reports').select('id, config, is_shared, created_by').eq('tenant_id', ctx.tenantId).eq('id', reportId).maybeSingle()
    if (error) throw dbError(error)
    if (!report || !(report.is_shared || report.created_by === ctx.actorId)) throw ServiceError.notFound('This report isn’t available to you')
    const { executeReportPreview } = await import('@/lib/mcp/tools/reports')
    const rows = await executeReportPreview(db, ctx.tenantId, report.config ?? {}, ctx.resourceScopes?.table_ids ?? null, ctx.permissions ? [...ctx.permissions] : null, { maxRows: CARD_RECORD_CAP, actorId: eligibleCaller(ctx) }) as any
    const records = (Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : []) as Array<Record<string, unknown>>
    const { list, total } = searchSortPage(records, { q, sort: c.sort, dir: c.sort_dir, page, size })
    return finish(list.map((r, i) => ({ id: String(r.id ?? `${page}-${i}`), record: r })), total, { truncated: records.length >= CARD_RECORD_CAP })
  }

  // API reference.
  const referenceId = typeof c.reference_id === 'string' && UUID_RE.test(c.reference_id) ? c.reference_id : null
  if (!referenceId) return { type: 'empty', reason: 'Choose an API reference' }
  const canIntegrations = hasPerm(ctx, 'integrations.view')
  if (extra.preview && !canIntegrations) throw ServiceError.forbidden('Binding an API reference needs View integrations')
  if (!canIntegrations && !c.allow_viewers) throw ServiceError.forbidden('This API data is only shown to people with integration access')
  const db = await serviceRoleClient(ctx)
  const { data: ref, error } = await (db as any).from('integration_references').select('id, inputs, request_config').eq('tenant_id', ctx.tenantId).eq('id', referenceId).maybeSingle()
  if (error) throw dbError(error)
  if (!ref) return { type: 'empty', reason: 'This API reference no longer exists' }
  const { isWriteReference } = await import('@/lib/custom-references/types')
  if (isWriteReference(ref)) throw ServiceError.validation('This API reference writes data — cards only read')
  const declared = ((Array.isArray(ref.inputs) ? ref.inputs : []) as any[]).map((i) => String(i?.name ?? i?.key ?? '')).filter(Boolean)
  let email: string | null = null
  if (Object.values(c.reference_inputs).some((v) => v.includes('me_email')) && ctx.actorId) {
    const { data: u } = await (db as any).from('users').select('email').eq('id', ctx.actorId).maybeSingle()
    email = u?.email ?? null
  }
  const inputs = resolveReferenceInputs(c.reference_inputs, declared, { userId: ctx.actorId ?? null, email, filters: extra.filters })
  const key = createHash('sha256').update(JSON.stringify([ctx.tenantId, extra.widgetKey, referenceId, inputs, c.results_path ?? ''])).digest('hex')
  const now = cardDeps.now()
  let records: Array<Record<string, unknown>> | null = null
  let cached = false
  const hit = cache.get(key)
  if (hit && hit.expires > now) { records = hit.records; cached = true }
  if (!records) {
    if (rateLimited(`${ctx.actorId ?? 'anon'}:${extra.widgetKey}`)) throw new ServiceError('rate_limited', 'Too many refreshes — try again in a minute', { status: 429 })
    let data: unknown
    try {
      const { executeReference } = await import('@/lib/reference-executor')
      const { newTraceId } = await import('@/lib/trace')
      const result = await executeReference({
        supabase: db as any, referenceId, inputValues: inputs, timeout: REFERENCE_TIMEOUT_MS, expectedTenantId: ctx.tenantId,
        caller: { traceId: newTraceId(), callerType: 'app_widget', callerId: ctx.actorId ?? null }, readOnly: true,
      } as any)
      if ((result.status ?? 200) >= 400) throw new Error('status')
      data = result.data
    } catch {
      throw new ServiceError('internal', 'The API behind these cards isn’t available right now', { status: 502 })
    }
    const { readResultPath } = await import('@/lib/forms/reference-results')
    const body = readResultPath(data, c.results_path ?? '')
    const list = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : []
    records = list.slice(0, CARD_RECORD_CAP).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r))
    if (c.cache_ttl_s > 0) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
      cache.set(key, { expires: now + c.cache_ttl_s * 1000, records })
    }
  }
  const { list, total } = searchSortPage(records, { q, sort: c.sort, dir: c.sort_dir, page, size })
  return finish(list.map((r, i) => ({ id: String(r.id ?? r.key ?? `${page}-${i}`).slice(0, 80), record: r })), total, { cached, truncated: records.length >= CARD_RECORD_CAP })
}
