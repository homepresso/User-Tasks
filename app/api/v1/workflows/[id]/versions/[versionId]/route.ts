import { apiRoute } from '@/lib/api/route'
import { getWorkflowVersionEndpoint } from '@/lib/api-schemas/workflows'
import { getWorkflowVersion } from '@/lib/services/workflows'

/** GET /api/v1/workflows/{id}/versions/{versionId} — one snapshot with its full definition. */
export const GET = apiRoute(getWorkflowVersionEndpoint, async ({ ctx, params }) =>
  ({ version: await getWorkflowVersion(ctx, params.id, params.versionId) }))
