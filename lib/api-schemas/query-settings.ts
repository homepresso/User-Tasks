import { z } from 'zod'
import { defineEndpoint } from './registry'
import { QUERY_MODES, QUERY_SERVICES } from '@/lib/reports/data-source'

/**
 * Settings → Query (lib/reports/data-source.ts): per service, whether
 * report metrics read the flat rollup tables or real-time queries, the
 * short cache TTL, per-app modes and whether widgets may override; plus the
 * rollup actions for the workspace (backfill, rebuild, reconcile).
 */

const MODE_HELP = 'auto = the rollups when they cover the window and nothing is queued for the workspace, else real time; rollup = "Flat table" (the rollups whenever they cover the window); live = "Real time" (raw rows). Real time is always the fallback.'
const modeSetting = z.enum(['inherit', ...QUERY_MODES])

const serviceSetting = z.object({
  mode: modeSetting.describe(`inherit (the workspace default), or ${MODE_HELP}`),
  cache_ttl_seconds: z.number().int().min(0).max(300).nullable().describe('Short per-query cache (0 = off; null = the workspace default)'),
})

export const querySettingsBody = z.object({
  default_mode: z.enum(QUERY_MODES).optional().describe(`Workspace default: ${MODE_HELP}`),
  default_cache_ttl_seconds: z.number().int().min(0).max(300).optional().describe('Default cache TTL (seconds, 0 = off; default 20)'),
  allow_widget_override: z.boolean().optional().describe('Let app editors set a data source per widget (Inherit / Flat table / Real time)'),
  services: z.partialRecord(z.enum(QUERY_SERVICES), serviceSetting.partial().nullable()).optional().describe(`Per service (${QUERY_SERVICES.join(', ')}); null removes the override`),
  apps: z.record(z.string(), modeSetting.nullable()).optional().describe('Per app id: a mode, or inherit / null to remove'),
})

const querySettingsResponse = z.looseObject({
  default_mode: z.enum(QUERY_MODES),
  default_cache_ttl_seconds: z.number(),
  allow_widget_override: z.boolean(),
  services: z.record(z.string(), serviceSetting),
  apps: z.record(z.string(), modeSetting),
})

const queryStatusResponse = z.looseObject({
  settings: querySettingsResponse,
  rollups: z.looseObject({ installed: z.boolean(), enabled: z.boolean() }).describe('Coverage of this workspace: covered_from, done, dirty_ranges, last_refresh_at, last_reconciled_at, newest_delta_at'),
  reconcile_every_minutes: z.number(),
  services: z.array(z.looseObject({
    service: z.enum(QUERY_SERVICES),
    label: z.string(),
    rollups: z.boolean().describe('false: this service always reads real time'),
    effective: z.looseObject({ mode: z.enum(QUERY_MODES), level: z.string(), cache_ttl_seconds: z.number() }),
    current_path: z.enum(['rollup', 'live']),
    timings: z.looseObject({}).describe('Median read time (ms) and sample count per path on the replica that answered'),
  })),
})

const ACCESS = 'Self-hosted: per workspace — reading needs settings.view, changes settings.edit. Cloud edition: one configuration for every workspace, instance admins only (404 for anyone else).'

const tags = ['Query settings']

export const getQuerySettingsEndpoint = defineEndpoint({
  method: 'GET', path: '/settings/query', operationId: 'getQuerySettings', tags,
  summary: 'Get the query settings and status',
  description: `Per service: the setting, the effective mode and what reads use right now, the rollup coverage and recent read times. ${MODE_HELP} ${ACCESS}`,
  permission: null,
  response: queryStatusResponse,
  cli: { resource: 'query-settings', verb: 'get' },
})

export const updateQuerySettingsEndpoint = defineEndpoint({
  method: 'PATCH', path: '/settings/query', operationId: 'updateQuerySettings', tags,
  summary: 'Change the query settings',
  description: `Send only what changes; services and apps are merged per key (null removes an override). Audited. ${ACCESS}`,
  permission: null,
  body: querySettingsBody,
  response: querySettingsResponse,
  cli: { resource: 'query-settings', verb: 'update' },
})

export const runQueryRollupsEndpoint = defineEndpoint({
  method: 'POST', path: '/settings/query/rollups', operationId: 'runQueryRollups', tags,
  summary: 'Run a report rollups action for the workspace',
  description: `backfill: continue the history backfill (up to ~20 s here, then the scheduler); rebuild: restart it from today (reads use real time until covered again); reconcile: rebuild today and yesterday. Audited. ${ACCESS}`,
  permission: null,
  body: z.object({
    action: z.enum(['backfill', 'rebuild', 'reconcile']),
    tenant_id: z.string().optional().describe('Cloud edition (instance admins): a workspace id, or "all" (default) for every workspace. Self-hosted: this workspace only'),
  }),
  response: z.looseObject({ action: z.string(), steps: z.number(), days: z.number(), rollups: z.looseObject({}).nullable() }),
  cli: { resource: 'query-settings', verb: 'rollups' },
})

export const querySettingsEndpoints = [getQuerySettingsEndpoint, updateQuerySettingsEndpoint, runQueryRollupsEndpoint]
