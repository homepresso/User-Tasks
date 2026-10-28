import { apiRoute } from '@/lib/api/route'
import { deleteIntegrationEndpoint, getIntegrationEndpoint, updateIntegrationEndpoint } from '@/lib/api-schemas/integrations'
import { deleteIntegration, getIntegration, updateIntegration } from '@/lib/services/integrations'

/** GET /api/v1/integrations/{id} — integration with masked config and its references. */
export const GET = apiRoute(getIntegrationEndpoint, async ({ ctx, params }) =>
  ({ integration: await getIntegration(ctx, params.id) }))

/** PATCH /api/v1/integrations/{id} — partial update ('__SECRET__' keeps a stored secret). */
export const PATCH = apiRoute(updateIntegrationEndpoint, async ({ ctx, params, body }) =>
  ({ integration: await updateIntegration(ctx, params.id, body) }))

/** DELETE /api/v1/integrations/{id} — delete the integration and its references. */
export const DELETE = apiRoute(deleteIntegrationEndpoint, async ({ ctx, params }) => {
  await deleteIntegration(ctx, params.id)
  return { deleted: true }
})
