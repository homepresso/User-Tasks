import { apiRoute } from '@/lib/api/route'
import { getAgentQueueJobEndpoint } from '@/lib/api-schemas/agents'
import { getAgentQueueJob } from '@/lib/services/agents'

/** GET /api/v1/agents/queue/{id} — a queued agent job (status, result, run id). */
export const GET = apiRoute(getAgentQueueJobEndpoint, async ({ ctx, params }) => getAgentQueueJob(ctx, params.id))
