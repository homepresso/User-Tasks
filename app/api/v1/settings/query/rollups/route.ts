import { apiRoute } from '@/lib/api/route'
import { runQueryRollupsEndpoint } from '@/lib/api-schemas/query-settings'
import { runQueryRollupAction } from '@/lib/services/query-settings'

/** POST /api/v1/settings/query/rollups — backfill / rebuild / reconcile this workspace's rollups (settings.edit; audited). */
export const POST = apiRoute(runQueryRollupsEndpoint, async ({ ctx, body }) => runQueryRollupAction(ctx, body.action, { tenantId: body.tenant_id ?? null }))
