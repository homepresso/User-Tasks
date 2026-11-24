import { apiRoute } from '@/lib/api/route'
import { runAppActionEndpoint } from '@/lib/api-schemas/apps'
import { runAppRuleAction } from '@/lib/services/app-rule-actions'

/** POST /api/v1/apps/{id}/actions — an app rule's server action (lib/services/app-rule-actions.ts). */
export const POST = apiRoute(runAppActionEndpoint, async ({ ctx, params, body }) => runAppRuleAction(ctx, params.id, body))
