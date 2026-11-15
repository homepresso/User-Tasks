import { apiRoute } from '@/lib/api/route'
import { createGatewayTokenEndpoint } from '@/lib/api-schemas/gateways'
import { createGatewayRegistrationToken } from '@/lib/services/gateways'

/** POST /api/v1/gateways/{id}/tokens */
export const POST = apiRoute(createGatewayTokenEndpoint, async ({ ctx, params, body }) => createGatewayRegistrationToken(ctx, params.id, body ?? {}))
