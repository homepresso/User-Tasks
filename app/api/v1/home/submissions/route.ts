import { apiRoute } from '@/lib/api/route'
import { listMySubmissionsEndpoint } from '@/lib/api-schemas/home'
import { resolvePage } from '@/lib/services/_shared'
import { listMySubmissions } from '@/lib/services/home'

/** GET /api/v1/home/submissions — my submissions with their runs' progress. */
export const GET = apiRoute(listMySubmissionsEndpoint, async ({ ctx, query }) =>
  listMySubmissions(ctx, { search: query.search, status: query.status }, resolvePage(query)))
