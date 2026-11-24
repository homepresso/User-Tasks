/**
 * Settings → Query (lib/reports/data-source.ts has the model and the
 * resolver): read and change the query settings, the per-service status
 * (effective mode, rollup coverage, recent read times per path) and the
 * rollup actions (rebuild / run backfill / reconcile now).
 *
 * Two editions:
 *  - self-hosted (any non-cloud mode): per workspace, in
 *    tenants.settings.query. Reading needs settings.view; changing settings
 *    and running the actions need settings.edit (workspace admins); writes
 *    use the service-role client scoped to ctx.tenantId and are audited.
 *  - cloud (DEPLOYMENT_MODE=cloud): ONE configuration for every workspace, in
 *    the instance setting instance.query_settings; workspace settings are
 *    ignored. Only instance admins (INSTANCE_ADMIN_EMAILS /
 *    instance.admin_emails, a verified email — the Settings → Infrastructure
 *    gate) may read or change it; anyone else, workspace owners included,
 *    gets 404 (as the page does). Rollup actions can target every workspace
 *    or one chosen workspace. Changes are recorded on the instance setting
 *    (updated_by), in the acting admin's workspace audit log with
 *    scope "instance", and in the server log.
 *
 * REST GET / PATCH /api/v1/settings/query, POST /api/v1/settings/query/rollups;
 * MCP query_settings_get / _update / query_rollups_run; `usertasks query-settings`.
 */

import {
  DEFAULT_QUERY_SETTINGS, INSTANCE_QUERY_SETTING, QUERY_SERVICE_INFO, QUERY_SERVICES, forgetQuerySettings, queryConfigIsInstanceWide, queryTimings,
  querySettingsFromInstanceSetting, querySettingsFromTenantSettings, querySettingsSchema, resolveFromSettings,
  type QueryMode, type QueryService, type QuerySettings,
} from '@/lib/reports/data-source'
import { bumpRollupGeneration } from '@/lib/report-rollups/cache'
import { getInstanceSetting, setInstanceSetting } from '@/lib/config/instance-settings'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'
import { rollupStatus, rollupTenantFreshness, rollupsEnabled, type RollupStatus, type TenantFreshness } from './report-rollups'
import './query-settings-loader'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants.settings is untyped JSON */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ── Access ───────────────────────────────────────────────────────────── */

type AdminCheck = (viewer: { id: string; email: string | null }) => Promise<boolean>
let adminCheck: AdminCheck = (viewer) => viewerCanSeeInfrastructure(viewer)

/** Tests: replace the instance-admin check (null restores it). */
export function setQueryAdminCheckForTests(fn: AdminCheck | null): void {
  adminCheck = fn ?? ((viewer) => viewerCanSeeInfrastructure(viewer))
}

/** Whether the caller is an instance admin (a signed-in person with a verified email on the instance admin list). */
export async function isQueryInstanceAdmin(ctx: ServiceContext): Promise<boolean> {
  if (!ctx.actorId || !UUID_RE.test(ctx.actorId) || ctx.keyType === 'tenant' || ctx.authKind === 'anonymous') return false
  try {
    const db = await serviceRoleClient(ctx) as any
    const { data } = await db.from('users').select('email').eq('id', ctx.actorId).maybeSingle()
    return await adminCheck({ id: ctx.actorId, email: data?.email ?? null })
  } catch {
    return false
  }
}

/** Who may read / change: cloud → instance admins only (404 otherwise); self-hosted → the workspace permission. */
async function requireAccess(ctx: ServiceContext, perm: 'settings.view' | 'settings.edit'): Promise<void> {
  if (queryConfigIsInstanceWide()) {
    if (!(await isQueryInstanceAdmin(ctx))) throw ServiceError.notFound('Not found')
    return
  }
  requirePerm(ctx, perm)
}

/** For the page and navigation: may this person open Settings → Query, and edit it? */
export async function queryPageAccess(ctx: ServiceContext | null): Promise<{ cloud: boolean; canView: boolean; canEdit: boolean }> {
  const cloud = queryConfigIsInstanceWide()
  if (!ctx) return { cloud, canView: false, canEdit: false }
  if (cloud) { const admin = await isQueryInstanceAdmin(ctx); return { cloud, canView: admin, canEdit: admin } }
  const has = (p: string) => ctx.permissions === null || ctx.permissions.has(p)
  return { cloud, canView: has('settings.view'), canEdit: has('settings.view') && has('settings.edit') }
}

/* ── Settings ─────────────────────────────────────────────────────────── */

export async function getQuerySettings(ctx: ServiceContext): Promise<QuerySettings> {
  await requireAccess(ctx, 'settings.view')
  if (queryConfigIsInstanceWide()) return querySettingsFromInstanceSetting(await getInstanceSetting(INSTANCE_QUERY_SETTING))
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  return querySettingsFromTenantSettings(data?.settings)
}

/** before + a partial change → the next settings (services / apps merged per key; null removes an override). */
export function mergeQuerySettings(before: QuerySettings, input: Record<string, unknown>): QuerySettings {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const merged: Record<string, unknown> = { ...before }
  for (const key of ['default_mode', 'default_cache_ttl_seconds', 'allow_widget_override'] as const) if (raw[key] !== undefined) merged[key] = raw[key]
  if (raw.services !== undefined) {
    if (!raw.services || typeof raw.services !== 'object') throw ServiceError.validation('services must be an object')
    const services: Record<string, unknown> = { ...before.services }
    for (const [k, v] of Object.entries(raw.services as Record<string, unknown>)) {
      if (!(QUERY_SERVICES as readonly string[]).includes(k)) throw ServiceError.validation(`Unknown service "${k}" (one of ${QUERY_SERVICES.join(', ')})`)
      if (v === null) delete services[k]
      else services[k] = { ...(before.services[k as QueryService] ?? { mode: 'inherit', cache_ttl_seconds: null }), ...(v as object) }
    }
    merged.services = services
  }
  if (raw.apps !== undefined) {
    if (!raw.apps || typeof raw.apps !== 'object') throw ServiceError.validation('apps must be an object')
    const apps: Record<string, unknown> = { ...before.apps }
    for (const [k, v] of Object.entries(raw.apps as Record<string, unknown>)) {
      if (v === null || v === 'inherit') delete apps[k]
      else apps[k] = v
    }
    merged.apps = apps
  }
  const parsed = querySettingsSchema.safeParse(merged)
  if (!parsed.success) throw ServiceError.validation(`Invalid query settings: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
  return parsed.data
}

/** Change some settings (self-hosted: settings.edit; cloud: instance admins, every workspace). Audited. */
export async function updateQuerySettings(ctx: ServiceContext, input: Record<string, unknown>): Promise<QuerySettings> {
  await requireAccess(ctx, 'settings.edit')
  if (queryConfigIsInstanceWide()) {
    const before = querySettingsFromInstanceSetting(await getInstanceSetting(INSTANCE_QUERY_SETTING))
    const next = mergeQuerySettings(before, input)
    await setInstanceSetting(INSTANCE_QUERY_SETTING, next, { updatedBy: ctx.actorId })
    forgetQuerySettings()
    console.info(`[query-settings] instance-wide settings changed by ${ctx.actorId}`)
    await audit(ctx, {
      objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
      summary: 'Changed the instance-wide query settings (Settings → Query, every workspace)',
      diff: { [INSTANCE_QUERY_SETTING]: { before, after: next } },
      metadata: { scope: 'instance' },
    }).catch(() => undefined)
    return next
  }
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('id, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? { ...data.settings } : {}
  const before = querySettingsFromTenantSettings(settings)
  const next = mergeQuerySettings(before, input)
  settings.query = next
  const { error: updateError } = await (db as any).from('tenants').update({ settings }).eq('id', ctx.tenantId)
  if (updateError) throw dbError(updateError)
  forgetQuerySettings(ctx.tenantId)
  await bumpRollupGeneration(ctx.tenantId)
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: 'Changed the query settings (Settings → Query)',
    diff: { 'settings.query': { before, after: next } },
  })
  return next
}

/* ── Status ───────────────────────────────────────────────────────────── */

export interface QueryServiceStatus {
  service: QueryService
  label: string
  description: string
  rollups: boolean
  why: string | null
  setting: { mode: string; cache_ttl_seconds: number | null }
  effective: { mode: QueryMode; level: string; cache_ttl_seconds: number }
  /** What reads use right now (auto resolved against coverage / queue). */
  current_path: 'rollup' | 'live'
  timings: ReturnType<typeof queryTimings>
}

export interface QueryStatus {
  /** 'instance': one configuration for every workspace (cloud); 'workspace': this workspace's (self-hosted). */
  scope: 'instance' | 'workspace'
  settings: QuerySettings
  defaults: QuerySettings
  rollups: TenantFreshness & { enabled: boolean } | { installed: false; enabled: boolean }
  /** Cloud: rollups across every workspace (backfill progress, queue, per workspace). */
  instance_rollups?: RollupStatus | null
  reconcile_every_minutes: number
  services: QueryServiceStatus[]
}

/** Settings, the per-service effective mode and path, coverage and recent read times. */
export async function getQueryStatus(ctx: ServiceContext): Promise<QueryStatus> {
  const settings = await getQuerySettings(ctx)
  const instance = queryConfigIsInstanceWide()
  const db = await serviceRoleClient(ctx)
  const enabled = rollupsEnabled()
  const [fresh, all] = await Promise.all([
    rollupTenantFreshness(db, ctx.tenantId, { fresh: true }),
    instance ? rollupStatus(db).catch(() => null) : Promise.resolve(undefined),
  ])
  const covered = instance ? Boolean(all && all.backfilled > 0) : Boolean(fresh && (fresh.done || fresh.covered_from))
  const queued = instance ? (all?.dirty_ranges ?? 0) : (fresh?.dirty_ranges ?? 0)
  const services = QUERY_SERVICES.map((service): QueryServiceStatus => {
    const info = QUERY_SERVICE_INFO[service]
    const eff = resolveFromSettings(settings, { service }, { instance })
    const usable = enabled && covered && info.rollups
    const path = eff.mode === 'live' || !usable ? 'live' : eff.mode === 'auto' && queued > 0 ? 'live' : 'rollup'
    const svc = settings.services[service]
    return {
      service, label: info.label, description: info.description, rollups: info.rollups, why: info.why ?? null,
      setting: { mode: svc?.mode ?? 'inherit', cache_ttl_seconds: svc?.cache_ttl_seconds ?? null },
      effective: { mode: eff.mode, level: eff.level, cache_ttl_seconds: eff.cacheTtlMs / 1000 },
      current_path: path,
      timings: queryTimings(instance ? '*' : ctx.tenantId, service),
    }
  })
  return {
    scope: instance ? 'instance' : 'workspace',
    settings, defaults: DEFAULT_QUERY_SETTINGS,
    rollups: fresh ? { ...fresh, enabled } : { installed: false, enabled },
    ...(instance ? { instance_rollups: all ?? null } : {}),
    reconcile_every_minutes: 60,
    services,
  }
}

/* ── Rollup actions ───────────────────────────────────────────────────── */

export type RollupAction = 'backfill' | 'rebuild' | 'reconcile'

/**
 * Run a rollup action now (audited): backfill continues the history
 * backfill, rebuild restarts it from today (reads use real time until it is
 * covered again — the backfill runs here for up to ~20 s and then in the
 * scheduler), reconcile rebuilds today and yesterday.
 * Self-hosted: this workspace (settings.edit). Cloud: instance admins;
 * `tenantId` = one workspace, or 'all' (default) = every workspace.
 */
export async function runQueryRollupAction(ctx: ServiceContext, action: RollupAction, opts: { budgetMs?: number; tenantId?: string | null } = {}) {
  await requireAccess(ctx, 'settings.edit')
  if (!['backfill', 'rebuild', 'reconcile'].includes(action)) throw ServiceError.validation('action must be backfill, rebuild or reconcile')
  const instance = queryConfigIsInstanceWide()
  let target: string | null = ctx.tenantId
  if (instance) {
    const t = opts.tenantId ?? 'all'
    if (t !== 'all' && !UUID_RE.test(t)) throw ServiceError.validation('tenant_id must be a workspace id or "all"')
    target = t === 'all' ? null : t
  } else if (opts.tenantId && opts.tenantId !== ctx.tenantId) {
    throw ServiceError.forbidden('Rollup actions apply to this workspace only')
  }
  const db = await serviceRoleClient(ctx) as any
  const deadline = Date.now() + Math.min(Math.max(opts.budgetMs ?? 20_000, 1_000), 25_000)
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args)
    if (error) {
      if (['PGRST202', '42883'].includes(String(error.code))) throw ServiceError.conflict('Report rollups are not installed (apply migration 20270123100000)')
      throw dbError(error)
    }
    return data
  }
  let steps = 0
  let days = 0
  const touched = new Set<string>()
  if (action === 'rebuild') await rpc('report_rollup_request_rebuild', { p_tenant_id: target, p_from: null, p_to: null })
  if (action === 'reconcile') {
    while (Date.now() < deadline) {
      // One workspace: once. Every workspace: each one not reconciled in the last minute.
      const r = await rpc('report_rollup_reconcile_next', { p_min_age_minutes: target ? 0 : 1, p_tenant_id: target })
      if (!r || r.idle) break
      steps++; days += Number(r.rebuilt?.days ?? 0)
      if (r.tenant_id) touched.add(String(r.tenant_id))
      if (target) break
    }
  } else {
    while (Date.now() < deadline) {
      const r = await rpc('report_rollup_backfill_next', { p_tenant_id: target, p_days: 31 })
      if (!r || r.idle || r.busy) break
      steps++; days += Number(r.rebuilt?.days ?? 0)
      if (r.tenant_id) touched.add(String(r.tenant_id))
      if (target && r.done) break
    }
  }
  for (const t of target ? [target] : touched) await bumpRollupGeneration(t)
  const freshness = target ? await rollupTenantFreshness(db, target, { fresh: true }) : null
  const what = action === 'rebuild' ? 'Rebuilt the report rollups' : action === 'reconcile' ? 'Reconciled the report rollups (today and yesterday)' : 'Ran the report rollups backfill'
  if (instance) console.info(`[query-settings] ${what} for ${target ?? 'every workspace'} by ${ctx.actorId}`)
  await audit(ctx, {
    objectType: 'workspace', objectId: target ?? ctx.tenantId, action: 'update',
    summary: instance ? `${what} — ${target ? `workspace ${target}` : 'every workspace'} (instance)` : what,
    metadata: { kind: `report_rollups.${action}`, steps, days, ...(instance ? { scope: 'instance', target: target ?? 'all' } : {}) },
  }).catch(() => undefined)
  return { action, target: target ?? 'all', steps, days, rollups: freshness, ...(instance ? { instance_rollups: await rollupStatus(db).catch(() => null) } : {}) }
}
