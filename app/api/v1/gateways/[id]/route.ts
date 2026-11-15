import { apiRoute } from '@/lib/api/route'
import { getGatewayEndpoint, revokeGatewayEndpoint, updateGatewayEndpoint } from '@/lib/api-schemas/gateways'
import { getGateway, revokeGateway, updateGateway } from '@/lib/services/gateways'

/** GET /api/v1/gateways/{id} */
export const GET = apiRoute(getGatewayEndpoint, async ({ ctx, params }) => getGateway(ctx, params.id))

/** PATCH /api/v1/gateways/{id} */
export const PATCH = apiRoute(updateGatewayEndpoint, async ({ ctx, params, body }) => updateGateway(ctx, params.id, body))

/** DELETE /api/v1/gateways/{id} — revokes (the record stays for the audit trail). */
export const DELETE = apiRoute(revokeGatewayEndpoint, async ({ ctx, params }) => revokeGateway(ctx, params.id))
