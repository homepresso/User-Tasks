import { apiRoute } from '@/lib/api/route'
import { getAgentUsageEndpoint } from '@/lib/api-schemas/agents'
import { agentUsage } from '@/lib/services/agents'

/** GET /api/v1/agents/{id}/usage — tokens per day and against the agent's limits. */
export const GET = apiRoute(getAgentUsageEndpoint, async ({ ctx, params, query }) => agentUsage(ctx, params.id, query.days ?? 30))
