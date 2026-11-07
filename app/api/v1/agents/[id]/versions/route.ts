import { apiRoute } from '@/lib/api/route'
import { listAgentVersionsEndpoint } from '@/lib/api-schemas/agents'
import { listAgentVersions } from '@/lib/services/agents'

/** GET /api/v1/agents/{id}/versions — saved versions, newest first. */
export const GET = apiRoute(listAgentVersionsEndpoint, async ({ ctx, params }) => listAgentVersions(ctx, params.id))
