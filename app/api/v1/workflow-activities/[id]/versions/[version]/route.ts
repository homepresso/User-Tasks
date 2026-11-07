import { apiRoute } from '@/lib/api/route'
import { getWorkflowActivityVersionEndpoint } from '@/lib/api-schemas/workflow-activities'
import { getWorkflowActivityVersion } from '@/lib/services/workflow-activities'

/** GET /api/v1/workflow-activities/{id}/versions/{version} — manifest, checksum (and the module with include_source=true). */
export const GET = apiRoute(getWorkflowActivityVersionEndpoint, async ({ ctx, params, query }) =>
  ({ version: await getWorkflowActivityVersion(ctx, params.id, params.version, { includeSource: query.include_source === 'true' }) }))
