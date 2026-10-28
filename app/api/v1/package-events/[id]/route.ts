import { apiRoute } from '@/lib/api/route'
import { getPackageEventEndpoint } from '@/lib/api-schemas/packages'
import { getPackageEvent } from '@/lib/services/package-events'

/** GET /api/v1/package-events/{id} — one history event with its plan */
export const GET = apiRoute(getPackageEventEndpoint, async ({ ctx, params }) => getPackageEvent(ctx, params.id))
