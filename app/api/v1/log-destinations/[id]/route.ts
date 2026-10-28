import { apiRoute } from '@/lib/api/route'
import { deleteLogDestinationEndpoint, getLogDestinationEndpoint, updateLogDestinationEndpoint } from '@/lib/api-schemas/log-destinations'
import { deleteLogDestination, getLogDestination, updateLogDestination } from '@/lib/services/log-destinations'

/** GET /api/v1/log-destinations/{id} */
export const GET = apiRoute(getLogDestinationEndpoint, async ({ ctx, params }) => getLogDestination(ctx, params.id))

/** PATCH /api/v1/log-destinations/{id} */
export const PATCH = apiRoute(updateLogDestinationEndpoint, async ({ ctx, params, body }) => updateLogDestination(ctx, params.id, body))

/** DELETE /api/v1/log-destinations/{id} */
export const DELETE = apiRoute(deleteLogDestinationEndpoint, async ({ ctx, params }) => deleteLogDestination(ctx, params.id))
