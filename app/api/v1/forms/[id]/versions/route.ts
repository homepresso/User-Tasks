import { apiRoute } from '@/lib/api/route'
import { listFormVersionsEndpoint } from '@/lib/api-schemas/forms'
import { resolvePage } from '@/lib/services/_shared'
import { listFormVersions } from '@/lib/services/forms'

/** GET /api/v1/forms/{id}/versions — versions, newest first (no content). */
export const GET = apiRoute(listFormVersionsEndpoint, async ({ ctx, params, query }) =>
  listFormVersions(ctx, params.id, resolvePage(query)))
