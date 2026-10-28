import { apiRoute } from '@/lib/api/route'
import { getFormVersionEndpoint } from '@/lib/api-schemas/forms'
import { getFormVersion } from '@/lib/services/forms'

/** GET /api/v1/forms/{id}/versions/{version} — one immutable snapshot. */
export const GET = apiRoute(getFormVersionEndpoint, async ({ ctx, params }) =>
  ({ version: await getFormVersion(ctx, params.id, params.version) }))
