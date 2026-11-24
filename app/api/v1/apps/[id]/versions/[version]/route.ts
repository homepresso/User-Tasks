import { apiRoute } from '@/lib/api/route'
import { getAppVersionEndpoint } from '@/lib/api-schemas/apps'
import { getAppVersion } from '@/lib/services/app-versions'

/** GET /api/v1/apps/{id}/versions/{version} — one immutable snapshot. */
export const GET = apiRoute(getAppVersionEndpoint, async ({ ctx, params }) => getAppVersion(ctx, params.id, params.version))
