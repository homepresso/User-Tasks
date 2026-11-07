import { apiRoute } from '@/lib/api/route'
import { updateAgentCostSettingsEndpoint } from '@/lib/api-schemas/agents'
import { saveAgentCostSettings } from '@/lib/services/agents'

/** PUT /api/v1/agents/cost-settings — workspace price overrides and agent budgets (settings.edit). */
export const PUT = apiRoute(updateAgentCostSettingsEndpoint, async ({ ctx, body }) => saveAgentCostSettings(ctx, body))
