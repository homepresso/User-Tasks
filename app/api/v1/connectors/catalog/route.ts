import { apiRoute } from '@/lib/api/route'
import { connectorCatalogEndpoint } from '@/lib/api-schemas/integrations'
import { listConnectorCatalog } from '@/lib/services/connectors'

/** GET /api/v1/connectors/catalog — built-in connector templates. */
export const GET = apiRoute(connectorCatalogEndpoint, async ({ ctx, query }) =>
  listConnectorCatalog(ctx, { category: query.category }))
