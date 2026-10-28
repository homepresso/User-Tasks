/**
 * Read access to the unified event stream (public.event_stream, written by the
 * app_events triggers — see supabase/migrations/20261024000000_event_stream.sql).
 * Backs GET /api/v1/events, the SSE stream at /api/v1/events/stream, the MCP
 * events_list tool and `usertasks logs tail|export`.
 *
 * Permissions: observability.view; audit and security events additionally need
 * settings.view (the same permission as the audit log). Without it, an
 * unfiltered read silently leaves those categories out and an explicit request
 * for them is a 403.
 *
 * event_stream has no client grants (RLS on, no policies), so reads always go
 * through a service-role client with an explicit tenant filter. API and MCP
 * contexts already carry one; session (UI) contexts get one here.
 *
 * Pagination is a cursor over the global, monotonic `id`: pass the previous
 * response's `next_cursor` as `after`. Events come oldest first.
 */

import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- event_stream is not in the generated client typing used by services */

export const EVENT_CATEGORIES = ['workflow', 'integration', 'agent', 'audit', 'security', 'task', 'system'] as const
export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export const EVENT_SEVERITIES = ['debug', 'info', 'warn', 'error'] as const
export type EventSeverity = (typeof EVENT_SEVERITIES)[number]

/** Categories that also need settings.view. */
export const RESTRICTED_EVENT_CATEGORIES: readonly EventCategory[] = ['audit', 'security']

export const EVENTS_DEFAULT_LIMIT = 100
export const EVENTS_MAX_LIMIT = 1000

export const EVENT_COLUMNS =
  'id, occurred_at, type, category, severity, message, source_table, source_id, trace_id, run_id, workflow_id, task_id, actor_id, attributes'

/** Event type or glob: lower-case segments separated by dots, `*` matches anything. */
export const EVENT_TYPE_PATTERN = /^[a-z0-9_*]+(\.[a-z0-9_*]+)*$/

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURSOR_PATTERN = /^\d{1,19}$/
const DURATION_PATTERN = /^(\d+)\s*(s|m|h|d|w)$/i
const DURATION_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }

export interface EventRecord {
  id: number
  occurred_at: string
  type: string
  category: EventCategory
  severity: EventSeverity
  message: string
  source_table: string
  source_id: string | null
  trace_id: string | null
  run_id: string | null
  workflow_id: string | null
  task_id: string | null
  actor_id: string | null
  attributes: Record<string, unknown>
}

export interface EventFilters {
  /** Only these categories. */
  categories?: string[]
  /** Event types or globs (`workflow.*`, `*.failed`); any may match. */
  types?: string[]
  /** Minimum severity (debug < info < warn < error). */
  min_severity?: string
  workflow_id?: string
  run_id?: string
  task_id?: string
  trace_id?: string
}

export interface ListEventsInput extends EventFilters {
  /** Cursor: only events with a larger id (the previous `next_cursor`). */
  after?: string | number | null
  /** ISO timestamp or a duration back from now (`30s`, `15m`, `1h`, `2d`, `1w`). */
  since?: string
  /** ISO timestamp or duration: events that occurred at or before. */
  until?: string
  /** 1–1000, default 100. */
  limit?: number
}

export interface ListEventsResult {
  events: EventRecord[]
  /** Pass as `after` to continue (the last returned id, else the incoming cursor). */
  next_cursor: string | null
  has_more: boolean
}

/** Severities at or above `min` (all when unset). */
export function severitiesFrom(min: string | undefined): EventSeverity[] {
  if (!min) return [...EVENT_SEVERITIES]
  const index = EVENT_SEVERITIES.indexOf(min as EventSeverity)
  if (index < 0) throw ServiceError.validation(`severity must be one of ${EVENT_SEVERITIES.join(', ')}`)
  return EVENT_SEVERITIES.slice(index)
}

/** `ISO` or a relative duration (`1h`) → ISO timestamp. */
export function resolveTimestamp(value: string, name: string, now: number = Date.now()): string {
  const trimmed = value.trim()
  const duration = DURATION_PATTERN.exec(trimmed)
  if (duration) return new Date(now - Number(duration[1]) * DURATION_MS[duration[2].toLowerCase()]).toISOString()
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) throw ServiceError.validation(`${name} must be an ISO timestamp or a duration such as 15m, 1h or 2d`)
  return new Date(parsed).toISOString()
}

/** `workflow.*` → LIKE pattern `workflow.%` (LIKE metacharacters in the literal part escaped). */
export function typeGlobToLike(glob: string): string {
  return glob.replace(/[\\%_]/g, '\\$&').replace(/\*/g, '%')
}

/** True when `type` matches the glob (same semantics as the SQL filter). */
export function typeMatchesGlob(type: string, glob: string): boolean {
  const pattern = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${pattern}$`).test(type)
}

/** Split `a,b` / repeated query values into a trimmed, de-duplicated list. */
export function splitList(value: string | string[] | undefined | null): string[] | undefined {
  if (value === undefined || value === null) return undefined
  const items = (Array.isArray(value) ? value : [value]).flatMap((item) => String(item).split(','))
  const out = [...new Set(items.map((item) => item.trim()).filter(Boolean))]
  return out.length ? out : undefined
}

function checkUuid(value: string | undefined, name: string) {
  if (value !== undefined && !UUID_PATTERN.test(value)) throw ServiceError.validation(`${name} must be a UUID`)
}

/** Validate filters; returns the category set to query (null = no category restriction). */
export function resolveEventFilters(ctx: ServiceContext, filters: EventFilters): { categories: string[] | null; severities: EventSeverity[]; types: string[] | undefined } {
  requirePerm(ctx, 'observability.view')
  const canReadAudit = hasPerm(ctx, 'settings.view')

  let categories: string[] | null = null
  if (filters.categories?.length) {
    const unknown = filters.categories.filter((c) => !(EVENT_CATEGORIES as readonly string[]).includes(c))
    if (unknown.length) throw ServiceError.validation(`Unknown category ${unknown.join(', ')} (expected ${EVENT_CATEGORIES.join(', ')})`)
    const restricted = filters.categories.filter((c) => (RESTRICTED_EVENT_CATEGORIES as readonly string[]).includes(c))
    if (restricted.length && !canReadAudit) {
      throw ServiceError.forbidden(`Forbidden: ${restricted.join(' and ')} events also need the 'settings.view' permission`)
    }
    categories = filters.categories
  } else if (!canReadAudit) {
    categories = EVENT_CATEGORIES.filter((c) => !RESTRICTED_EVENT_CATEGORIES.includes(c))
  }

  for (const type of filters.types ?? []) {
    if (!EVENT_TYPE_PATTERN.test(type)) throw ServiceError.validation(`Invalid event type "${type}" (lower-case dotted segments, * as a wildcard)`)
  }
  checkUuid(filters.workflow_id, 'workflow_id')
  checkUuid(filters.run_id, 'run_id')
  checkUuid(filters.task_id, 'task_id')
  checkUuid(filters.trace_id, 'trace_id')

  return { categories, severities: severitiesFrom(filters.min_severity), types: filters.types }
}

/** Client for event_stream reads (the table has no client grants). */
export function eventsClient(ctx: ServiceContext): Promise<AnySupabaseClient> {
  return serviceRoleClient(ctx)
}

function parseCursor(value: string | number | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).trim()
  if (!CURSOR_PATTERN.test(text)) throw ServiceError.validation('after must be an event id (a non-negative integer)')
  return text
}

export async function listEvents(ctx: ServiceContext, input: ListEventsInput = {}): Promise<ListEventsResult> {
  const { categories, severities, types } = resolveEventFilters(ctx, input)
  const after = parseCursor(input.after)
  const since = input.since ? resolveTimestamp(input.since, 'since') : undefined
  const until = input.until ? resolveTimestamp(input.until, 'until') : undefined
  const limit = Math.min(Math.max(Math.floor(input.limit ?? EVENTS_DEFAULT_LIMIT), 1), EVENTS_MAX_LIMIT)

  const supabase = await eventsClient(ctx)
  let query = (supabase as any).from('event_stream')
    .select(EVENT_COLUMNS)
    .eq('tenant_id', ctx.tenantId)
  if (after) query = query.gt('id', after)
  if (since) query = query.gte('occurred_at', since)
  if (until) query = query.lte('occurred_at', until)
  if (categories) query = query.in('category', categories)
  if (severities.length < EVENT_SEVERITIES.length) query = query.in('severity', severities)
  if (types?.length === 1) {
    query = types[0].includes('*') ? query.like('type', typeGlobToLike(types[0])) : query.eq('type', types[0])
  } else if (types?.length) {
    // PostgREST or(): `*` is its LIKE wildcard; type patterns contain no `,()`.
    query = query.or(types.map((t) => (t.includes('*') ? `type.like.${t.replace(/_/g, '\\_')}` : `type.eq.${t}`)).join(','))
  }
  if (input.workflow_id) query = query.eq('workflow_id', input.workflow_id)
  if (input.run_id) query = query.eq('run_id', input.run_id)
  if (input.task_id) query = query.eq('task_id', input.task_id)
  if (input.trace_id) query = query.eq('trace_id', input.trace_id)

  const { data, error } = await query.order('id', { ascending: true }).limit(limit + 1)
  if (error) throw dbError(error)
  const rows = (data ?? []) as EventRecord[]
  const hasMore = rows.length > limit
  const events = hasMore ? rows.slice(0, limit) : rows
  const last = events[events.length - 1]
  return { events, next_cursor: last ? String(last.id) : after, has_more: hasMore }
}

/**
 * Highest event id for the tenant (0 when it has none): the "from now"
 * starting cursor for live tails and new log destinations.
 */
export async function latestEventId(ctx: ServiceContext, supabase?: AnySupabaseClient): Promise<number> {
  const client = supabase ?? await eventsClient(ctx)
  const { data, error } = await (client as any).from('event_stream')
    .select('id').eq('tenant_id', ctx.tenantId)
    .order('id', { ascending: false }).limit(1).maybeSingle()
  if (error) throw dbError(error)
  return data ? Number(data.id) : 0
}
