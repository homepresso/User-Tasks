import { apiRoute } from '@/lib/api/route'
import { testConnectorEndpoint } from '@/lib/api-schemas/integrations'
import { testSavedConnector } from '@/lib/services/connectors'

/** POST /api/v1/connectors/{id}/test — preflight + probe with the stored credentials. */
export const POST = apiRoute(testConnectorEndpoint, async ({ ctx, params }) => testSavedConnector(ctx, params.id))
