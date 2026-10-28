import { apiRoute } from '@/lib/api/route'
import { createConnectorEndpoint, listConnectorsEndpoint } from '@/lib/api-schemas/integrations'
import { resolvePage } from '@/lib/services/_shared'
import { createConnector, listConnectors } from '@/lib/services/connectors'

/** GET /api/v1/connectors — the workspace's connectors (credentials masked). */
export const GET = apiRoute(listConnectorsEndpoint, async ({ ctx, query }) =>
  listConnectors(ctx, {
    enabled: query.enabled === undefined ? undefined : query.enabled === 'true',
    connectorKey: query.connector_key,
  }, resolvePage(query)))

/** POST /api/v1/connectors — enable a catalog connector. */
export const POST = apiRoute(createConnectorEndpoint, async ({ ctx, body }) => createConnector(ctx, body))
