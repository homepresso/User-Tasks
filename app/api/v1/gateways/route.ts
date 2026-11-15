import { apiRoute } from '@/lib/api/route'
import { createGatewayEndpoint, listGatewaysEndpoint } from '@/lib/api-schemas/gateways'
import { createGateway, listGateways } from '@/lib/services/gateways'

/** GET /api/v1/gateways */
export const GET = apiRoute(listGatewaysEndpoint, async ({ ctx, query }) => listGateways(ctx, { include_revoked: query.include_revoked === 'true' }))

/** POST /api/v1/gateways */
export const POST = apiRoute(createGatewayEndpoint, async ({ ctx, body }) => createGateway(ctx, body))
