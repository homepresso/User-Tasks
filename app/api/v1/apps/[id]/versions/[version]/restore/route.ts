import { apiRoute } from '@/lib/api/route'
import { restoreAppVersionEndpoint } from '@/lib/api-schemas/apps'
import { restoreAppVersion } from '@/lib/services/app-versions'

/** POST /api/v1/apps/{id}/versions/{version}/restore — the version becomes the draft. */
export const POST = apiRoute(restoreAppVersionEndpoint, async ({ ctx, params }) => restoreAppVersion(ctx, params.id, params.version))
