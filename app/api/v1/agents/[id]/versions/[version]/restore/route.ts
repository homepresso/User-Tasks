import { apiRoute } from '@/lib/api/route'
import { restoreAgentVersionEndpoint } from '@/lib/api-schemas/agents'
import { restoreAgentVersion } from '@/lib/services/agents'

/** POST /api/v1/agents/{id}/versions/{version}/restore — restore as a new version. */
export const POST = apiRoute(restoreAgentVersionEndpoint, async ({ ctx, params }) =>
  ({ agent: await restoreAgentVersion(ctx, params.id, params.version) }))
