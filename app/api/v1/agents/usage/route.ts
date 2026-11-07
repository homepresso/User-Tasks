import { apiRoute } from '@/lib/api/route'
import { getWorkspaceAgentUsageEndpoint } from '@/lib/api-schemas/agents'
import { workspaceAgentUsage } from '@/lib/services/agents'

/** GET /api/v1/agents/usage — workspace agent tokens and cost, per agent, budgets and prices. */
export const GET = apiRoute(getWorkspaceAgentUsageEndpoint, async ({ ctx, query }) => workspaceAgentUsage(ctx, query.days ?? 30))
