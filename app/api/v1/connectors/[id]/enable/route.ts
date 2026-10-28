import { apiRoute } from '@/lib/api/route'
import { enableConnectorEndpoint } from '@/lib/api-schemas/integrations'
import { setConnectorEnabled } from '@/lib/services/connectors'

/** POST /api/v1/connectors/{id}/enable — Re-enable the connector and its integration. */
export const POST = apiRoute(enableConnectorEndpoint, async ({ ctx, params }) => setConnectorEnabled(ctx, params.id, true))
