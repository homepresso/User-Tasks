import { apiRoute } from '@/lib/api/route'
import { disableConnectorEndpoint } from '@/lib/api-schemas/integrations'
import { setConnectorEnabled } from '@/lib/services/connectors'

/** POST /api/v1/connectors/{id}/disable — Disable the connector and deactivate its integration. */
export const POST = apiRoute(disableConnectorEndpoint, async ({ ctx, params }) => setConnectorEnabled(ctx, params.id, false))
