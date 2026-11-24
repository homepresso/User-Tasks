/**
 * Query settings: where report metrics come from — the flat rollup tables
 * (lib/services/report-rollups.ts) or real-time queries over the raw rows.
 * Settings → Query; GET / PATCH /api/v1/settings/query; MCP
 * query_settings_get / _update; `usertasks query-settings`.
 *
 * Levels, each inheriting from the one above unless set:
 *   workspace default → service → app (per app id) → widget (when the
 *   workspace allows per-widget overrides; the widget's `data_source`).
 * Modes:
 *   auto      the rollups when they cover the window and have no queued
 *             rebuilds for the workspace; real time otherwise (default)
 *   rollup    "Flat table": the rollups whenever they cover the window
 *   live      "Real time": always the raw rows
 * Real time stays the fallback of every mode: when the rollups can't answer
 * (not installed, not backfilled that far back, REPORT_ROLLUPS=off) the read
 * is made live. Permissions and visibility are the same in both modes —
 * the services apply the viewer's scope either way.
 *
 * Cache TTL per service (seconds, 0 = off): the short per-query cache
 * (lib/report-rollups/cache.ts); default 20 s.
 *
 * Stored in tenants.settings.query (jsonb) when self-hosted; in the cloud
 * edition one instance-wide configuration (instance setting
 * instance.query_settings, instance admins only) governs every workspace.
 * resolveDataSource() is the one resolver every read path uses; settings
 * are cached per process for 30 s (and dropped on save).
 */

import { z } from 'zod'

export const QUERY_SERVICES = [
  'reports_hub', 'report_charts', 'home_stats', 'app_widgets', 'extension_stats', 'task_sla', 'form_submission_stats', 'api_reports',
] as const
export type QueryService = (typeof QUERY_SERVICES)[number]

export const QUERY_MODES = ['auto', 'rollup', 'live'] as const
export type QueryMode = (typeof QUERY_MODES)[number]
export type QueryModeSetting = QueryMode | 'inherit'

export interface QueryServiceInfo {
  label: string
  description: string
  /** false: this service always reads real time (the rollups don't hold what it shows). */
  rollups: boolean
  why?: string
}

export const QUERY_SERVICE_INFO: Record<QueryService, QueryServiceInfo> = {
  reports_hub: { label: 'Reports hub and workflow reports', description: 'Run counts, durations and node visits on /reports (hub, process overview, compare).', rollups: true },
  report_charts: { label: 'Report charts', description: 'Saved reports and their summary charts.', rollups: false, why: 'Saved reports filter and group by any column, which the daily rollups do not keep.' },
  home_stats: { label: 'Home stats', description: 'Home → My activity (your own tasks and submissions).', rollups: false, why: 'Personal and small (only your own work), in your time zone; already a quick indexed query.' },
  app_widgets: { label: 'App widgets', description: 'Metric, KPI, goal, gauge, chart, pivot, throughput, submission trend, cycle time and SLA trend widgets.', rollups: true },
  extension_stats: { label: 'Extension pages stats', description: 'ctx.workflows.stats in extension pages.', rollups: true },
  task_sla: { label: 'Task SLA and workload', description: 'Open tasks: SLA status, workload, overdue and bottleneck widgets.', rollups: false, why: 'Shows what is open right now (current state), not history.' },
  form_submission_stats: { label: 'Form submission stats', description: 'ctx.forms.submissionStats in extension pages.', rollups: true },
  api_reports: { label: 'API and MCP report endpoints', description: 'The run analytics read through the REST API, MCP and CLI.', rollups: true },
}

export const DEFAULT_CACHE_TTL_SECONDS = 20

const modeSetting = z.enum(['inherit', ...QUERY_MODES])
const ttl = z.number().int().min(0).max(300)

export const queryServiceSettingSchema = z.object({
  mode: modeSetting.default('inherit'),
  cache_ttl_seconds: ttl.nullable().default(null).describe('null: the workspace default'),
}).strict()

export const querySettingsSchema = z.object({
  default_mode: z.enum(QUERY_MODES).default('auto'),
  default_cache_ttl_seconds: ttl.default(DEFAULT_CACHE_TTL_SECONDS),
  allow_widget_override: z.boolean().default(false),
  services: z.partialRecord(z.enum(QUERY_SERVICES), queryServiceSettingSchema).default({}),
  /** Per app (app id → mode). */
  apps: z.record(z.string().uuid(), modeSetting).default({}),
}).strict()

export type QuerySettings = z.output<typeof querySettingsSchema>

export const DEFAULT_QUERY_SETTINGS: QuerySettings = querySettingsSchema.parse({})

/** tenants.settings → query settings (invalid or missing parts fall back to the defaults). */
export function querySettingsFromTenantSettings(settings: unknown): QuerySettings {
  const raw = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).query : undefined
  const parsed = querySettingsSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : DEFAULT_QUERY_SETTINGS
}

export type QueryLevel = 'instance' | 'workspace' | 'service' | 'app' | 'widget' | 'fixed'

export interface ResolvedDataSource {
  service: QueryService
  mode: QueryMode
  /** Where the mode came from. */
  level: QueryLevel
  cacheTtlMs: number
}

/** Pure resolution over loaded settings (exported for tests). */
export function resolveFromSettings(settings: QuerySettings, input: { service: QueryService; appId?: string | null; widgetMode?: QueryModeSetting | null }, opts: { instance?: boolean } = {}): ResolvedDataSource {
  const info = QUERY_SERVICE_INFO[input.service]
  const svc = settings.services[input.service]
  const cacheTtlMs = 1000 * (svc?.cache_ttl_seconds ?? settings.default_cache_ttl_seconds)
  if (!info.rollups) return { service: input.service, mode: 'live', level: 'fixed', cacheTtlMs }
  let mode: QueryMode = settings.default_mode
  let level: QueryLevel = opts.instance ? 'instance' : 'workspace'
  if (svc && svc.mode !== 'inherit') { mode = svc.mode; level = 'service' }
  // Cloud (one instance-wide config): app and widget overrides only when the platform admin allows them.
  const app = input.appId && (!opts.instance || settings.allow_widget_override) ? settings.apps[input.appId] : undefined
  if (app && app !== 'inherit') { mode = app; level = 'app' }
  if (settings.allow_widget_override && input.widgetMode && input.widgetMode !== 'inherit') { mode = input.widgetMode; level = 'widget' }
  return { service: input.service, mode, level, cacheTtlMs }
}

/* ── Loading (per process, 30 s) ─────────────────────────────────────── */

/**
 * Cloud edition (DEPLOYMENT_MODE=cloud): ONE configuration for every
 * workspace, stored in the instance settings (INSTANCE_QUERY_SETTING) and
 * managed by instance admins only; workspace settings (tenants.settings.query)
 * are ignored. Self-hosted: per workspace, as before.
 */
export const INSTANCE_QUERY_SETTING = 'instance.query_settings'

type Loader = (tenantId: string) => Promise<unknown>
type InstanceLoader = () => Promise<unknown>
const cache = new Map<string, { at: number; value: QuerySettings }>()
const CACHE_MS = 30_000
const INSTANCE_KEY = '\u0000instance'
let loader: Loader | null = null
let instanceLoader: InstanceLoader | null = null
let cloudMode: () => boolean = () => false

/**
 * Where settings come from (set by lib/services/query-settings-loader at
 * import; tests may override): the workspace loader, and for the cloud
 * edition the instance loader and the mode check.
 */
export function setQuerySettingsLoader(fn: Loader | null, opts: { instance?: InstanceLoader | null; isCloud?: () => boolean } = {}): void {
  loader = fn
  if (opts.instance !== undefined) instanceLoader = opts.instance
  if (opts.isCloud) cloudMode = opts.isCloud
  cache.clear()
}

/** Whether the one instance-wide configuration applies (the cloud edition). */
export function queryConfigIsInstanceWide(): boolean {
  try { return cloudMode() } catch { return false }
}

export function forgetQuerySettings(tenantId?: string): void {
  if (tenantId) { cache.delete(tenantId); cache.delete(INSTANCE_KEY) } else cache.clear()
}

async function cached(key: string, load: () => Promise<unknown>, parse: (raw: unknown) => QuerySettings): Promise<QuerySettings> {
  const hit = cache.get(key)
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.value
  let value = DEFAULT_QUERY_SETTINGS
  try {
    value = parse(await load())
  } catch { /* defaults */ }
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 1000) cache.delete(cache.keys().next().value as string)
  return value
}

/** The instance-wide configuration (cloud). */
export function querySettingsFromInstanceSetting(raw: unknown): QuerySettings {
  const parsed = querySettingsSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : DEFAULT_QUERY_SETTINGS
}

export async function loadInstanceQuerySettings(): Promise<QuerySettings> {
  if (!instanceLoader) return DEFAULT_QUERY_SETTINGS
  return cached(INSTANCE_KEY, instanceLoader, querySettingsFromInstanceSetting)
}

/** The settings that govern a workspace's reads: the instance-wide ones in the cloud, else the workspace's. */
export async function loadQuerySettings(tenantId: string): Promise<QuerySettings> {
  if (queryConfigIsInstanceWide()) return loadInstanceQuerySettings()
  if (!tenantId || !loader) return DEFAULT_QUERY_SETTINGS
  return cached(tenantId, () => loader!(tenantId), querySettingsFromTenantSettings)
}

/** The effective data source of a read: the one resolver every report read path uses. */
export async function resolveDataSource(ctx: { tenantId: string }, input: { service: QueryService; appId?: string | null; widgetMode?: QueryModeSetting | null }): Promise<ResolvedDataSource> {
  const instance = queryConfigIsInstanceWide()
  return resolveFromSettings(await loadQuerySettings(ctx.tenantId), input, { instance })
}

/* ── Timings (this process; shown on Settings → Query) ───────────────── */

const timings = new Map<string, number[]>()
const KEEP = 50

/** Record how long a read took on a path ('rollup' or 'live'). */
export function recordQueryTiming(tenantId: string, service: QueryService, path: 'rollup' | 'live', ms: number): void {
  if (tenantId !== '*') recordQueryTiming('*', service, path, ms) // every workspace together (cloud page)
  const key = `${tenantId}|${service}|${path}`
  const list = timings.get(key) ?? []
  list.push(ms)
  if (list.length > KEEP) list.shift()
  timings.set(key, list)
  if (timings.size > 5000) timings.delete(timings.keys().next().value as string)
}

/** Median and count of the recent reads on each path (null when none). */
export function queryTimings(tenantId: string, service: QueryService): Record<'rollup' | 'live', { median_ms: number; samples: number } | null> {
  const stat = (path: 'rollup' | 'live') => {
    const list = [...(timings.get(`${tenantId}|${service}|${path}`) ?? [])].sort((a, b) => a - b)
    if (!list.length) return null
    const mid = Math.floor(list.length / 2)
    const median = list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2
    return { median_ms: Math.round(median * 10) / 10, samples: list.length }
  }
  return { rollup: stat('rollup'), live: stat('live') }
}

/**
 * Run a read on the path the mode picks: `rollup()` returns null when the
 * rollups can't answer (then `live()` runs — real time is always the
 * fallback). Records the timing of the path that answered.
 */
export async function readWithDataSource<T>(ctx: { tenantId: string }, ds: ResolvedDataSource, rollup: () => Promise<T | null>, live: () => Promise<T>): Promise<T> {
  if (ds.mode !== 'live') {
    const t0 = performance.now()
    const value = await rollup()
    if (value !== null) {
      recordQueryTiming(ctx.tenantId, ds.service, 'rollup', performance.now() - t0)
      return value
    }
  }
  const t1 = performance.now()
  const value = await live()
  recordQueryTiming(ctx.tenantId, ds.service, 'live', performance.now() - t1)
  return value
}
