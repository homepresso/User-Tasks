import { apiRoute } from '@/lib/api/route'
import { revokeGatewayInstanceEndpoint } from '@/lib/api-schemas/gateways'
import { revokeGatewayInstance } from '@/lib/services/gateways'

/** DELETE /api/v1/gateways/{id}/instances/{instance_id} */
export const DELETE = apiRoute(revokeGatewayInstanceEndpoint, async ({ ctx, params }) => revokeGatewayInstance(ctx, params.id, params.instance_id))
