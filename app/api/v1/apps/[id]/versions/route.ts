import { apiRoute } from '@/lib/api/route'
import { listAppVersionsEndpoint } from '@/lib/api-schemas/apps'
import { listAppVersions } from '@/lib/services/app-versions'

/** GET /api/v1/apps/{id}/versions — published versions, newest first. */
export const GET = apiRoute(listAppVersionsEndpoint, async ({ ctx, params, query }) => listAppVersions(ctx, params.id, { limit: query.limit, offset: query.offset }))
