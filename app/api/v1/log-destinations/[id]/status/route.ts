import { apiRoute } from '@/lib/api/route'
import { getLogDestinationStatusEndpoint } from '@/lib/api-schemas/log-destinations'
import { getLogDestinationStatus } from '@/lib/services/log-destinations'

/** GET /api/v1/log-destinations/{id}/status */
export const GET = apiRoute(getLogDestinationStatusEndpoint, async ({ ctx, params }) => getLogDestinationStatus(ctx, params.id))
