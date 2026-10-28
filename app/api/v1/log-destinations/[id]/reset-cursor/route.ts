import { apiRoute } from '@/lib/api/route'
import { resetLogDestinationCursorEndpoint } from '@/lib/api-schemas/log-destinations'
import { resetLogDestinationCursor } from '@/lib/services/log-destinations'

/** POST /api/v1/log-destinations/{id}/reset-cursor */
export const POST = apiRoute(resetLogDestinationCursorEndpoint, async ({ ctx, params, body }) => resetLogDestinationCursor(ctx, params.id, body.from))
