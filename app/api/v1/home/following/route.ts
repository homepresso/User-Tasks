import { apiRoute } from '@/lib/api/route'
import { listFollowedRunsEndpoint } from '@/lib/api-schemas/home'
import { resolvePage } from '@/lib/services/_shared'
import { listFollowedRuns } from '@/lib/services/home'

/** GET /api/v1/home/following — runs I follow. */
export const GET = apiRoute(listFollowedRunsEndpoint, async ({ ctx, query }) =>
  listFollowedRuns(ctx, { search: query.search, status: query.status }, resolvePage(query)))
