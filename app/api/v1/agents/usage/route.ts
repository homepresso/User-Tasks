import { apiRoute } from '@/lib/api/route'
import { getWorkspaceAgentUsageEndpoint } from '@/lib/api-schemas/agents'
import { workspaceAgentUsage } from '@/lib/services/agents'

/** GET /api/v1/agents/usage — workspace agent tokens and cost, per agent, budgets and prices; with group_by / period / filters also the AI cost breakdown. */
export const GET = apiRoute(getWorkspaceAgentUsageEndpoint, async ({ ctx, query }) => {
  const { days, ...breakdown } = query
  return workspaceAgentUsage(ctx, days ?? 30, breakdown)
})
