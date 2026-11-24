import { z } from 'zod'
import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as query from '@/lib/services/query-settings'
import { QUERY_MODES, QUERY_SERVICES } from '@/lib/reports/data-source'
import { messageOf } from './_util'

/*
 * Settings → Query (lib/reports/data-source.ts): flat rollup tables or real
 * time per service, cache TTLs, per-app modes, per-widget overrides, and the
 * rollup actions. Thin wrappers over lib/services/query-settings.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const MODES = 'auto (rollups when they cover the window and nothing is queued, else real time), rollup ("Flat table"), live ("Real time"); real time is always the fallback'
const modeSetting = z.enum(['inherit', ...QUERY_MODES])
const ACCESS = 'Self-hosted: per workspace (settings.view to read, settings.edit to change). Cloud: one configuration for every workspace, instance admins only.'

export function registerQuerySettingsTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('query_settings_get', `Get the workspace's query settings (Settings → Query): per service (${QUERY_SERVICES.join(', ')}) the mode, the effective mode and what reads use right now, cache TTLs, per-app modes, whether widgets may override, the rollup coverage (backfill, queued rebuilds, last reconcile) and recent median read times per path. Modes: ${MODES}. ${ACCESS}`, {},
    async () => run(() => query.getQueryStatus(svc())))

  server.tool('query_settings_update', `Change the query settings (audited). Send only what changes; services and apps merge per key, null removes an override. Modes: ${MODES}. ${ACCESS}`, {
    default_mode: z.enum(QUERY_MODES).optional(),
    default_cache_ttl_seconds: z.number().int().min(0).max(300).optional().describe('0 = no cache'),
    allow_widget_override: z.boolean().optional(),
    services: z.record(z.string(), z.object({ mode: modeSetting.optional(), cache_ttl_seconds: z.number().int().min(0).max(300).nullable().optional() }).nullable()).optional().describe(`Keys: ${QUERY_SERVICES.join(', ')}`),
    apps: z.record(z.string(), modeSetting.nullable()).optional().describe('App id → mode (inherit / null removes)'),
  }, async (args) => run(async () => ({ settings: await query.updateQuerySettings(svc(), args as Record<string, unknown>) })))

  server.tool('query_rollups_run', `Run a report rollups action (audited): backfill (continue the history backfill), rebuild (restart it from today; reads use real time until covered again) or reconcile (rebuild today and yesterday). ${ACCESS}`, {
    action: z.enum(['backfill', 'rebuild', 'reconcile']),
    tenant_id: z.string().optional().describe('Cloud (instance admins): a workspace id or "all" (default). Self-hosted: this workspace only'),
  }, async (args) => run(() => query.runQueryRollupAction(svc(), args.action, { tenantId: args.tenant_id ?? null })))
}
