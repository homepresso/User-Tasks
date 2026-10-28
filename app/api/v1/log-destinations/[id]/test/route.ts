import { apiRoute } from '@/lib/api/route'
import { testLogDestinationEndpoint } from '@/lib/api-schemas/log-destinations'
import { testLogDestination } from '@/lib/services/log-destinations'

/** POST /api/v1/log-destinations/{id}/test */
export const POST = apiRoute(testLogDestinationEndpoint, async ({ ctx, params }) => testLogDestination(ctx, params.id))
