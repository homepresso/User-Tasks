import { apiRoute } from '@/lib/api/route'
import { deleteConnectorEndpoint, getConnectorEndpoint, updateConnectorEndpoint } from '@/lib/api-schemas/integrations'
import { deleteConnector, getConnector, updateConnector } from '@/lib/services/connectors'

/** GET /api/v1/connectors/{id} — connector (masked), template, integration and references. */
export const GET = apiRoute(getConnectorEndpoint, async ({ ctx, params }) => getConnector(ctx, params.id))

/** PATCH /api/v1/connectors/{id} — merge config/credentials; '__SECRET__' keeps a stored value. */
export const PATCH = apiRoute(updateConnectorEndpoint, async ({ ctx, params, body }) =>
  ({ connector: await updateConnector(ctx, params.id, body, { mode: 'merge' }) }))

/** DELETE /api/v1/connectors/{id} */
export const DELETE = apiRoute(deleteConnectorEndpoint, async ({ ctx, params }) => {
  const { integration_id } = await deleteConnector(ctx, params.id)
  return { deleted: true, integration_id }
})
