import { apiRoute } from '@/lib/api/route'
import { listAgentRunsEndpoint } from '@/lib/api-schemas/agents'
import { listAgentRuns } from '@/lib/services/agents'

/** GET /api/v1/agents/runs — agent runs, newest first. */
export const GET = apiRoute(listAgentRunsEndpoint, async ({ ctx, query }) =>
  listAgentRuns(ctx, { agentId: query.agent_id, status: query.status, callerType: query.caller_type, limit: query.limit, offset: query.offset }))
