import { apiRoute } from '@/lib/api/route'
import { createLogDestinationEndpoint, listLogDestinationsEndpoint } from '@/lib/api-schemas/log-destinations'
import { resolvePage } from '@/lib/services/_shared'
import { createLogDestination, listLogDestinations } from '@/lib/services/log-destinations'

/** GET /api/v1/log-destinations */
export const GET = apiRoute(listLogDestinationsEndpoint, async ({ ctx, query }) => listLogDestinations(ctx, resolvePage(query)))

/** POST /api/v1/log-destinations */
export const POST = apiRoute(createLogDestinationEndpoint, async ({ ctx, body }) => createLogDestination(ctx, body))
