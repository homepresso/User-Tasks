import { apiRoute } from '@/lib/api/route'
import { listTagObjectsEndpoint } from '@/lib/api-schemas/tags'
import { listTagObjects } from '@/lib/services/tags'

/** GET /api/v1/tags/objects — the objects of one type carrying a tag. */
export const GET = apiRoute(listTagObjectsEndpoint, async ({ ctx, query }) => listTagObjects(ctx, query))
