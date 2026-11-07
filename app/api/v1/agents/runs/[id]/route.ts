import { apiRoute } from '@/lib/api/route'
import { getAgentRunEndpoint } from '@/lib/api-schemas/agents'
import { getAgentRun } from '@/lib/services/agents'

/** GET /api/v1/agents/runs/{id} — one run with its step trace. */
export const GET = apiRoute(getAgentRunEndpoint, async ({ ctx, params }) => getAgentRun(ctx, params.id))
