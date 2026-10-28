import { apiRoute } from '@/lib/api/route'
import { getPackageVersionEndpoint } from '@/lib/api-schemas/packages'
import { getPackageVersion } from '@/lib/services/packages'

/** GET /api/v1/packages/{id}/versions/{versionId} */
export const GET = apiRoute(getPackageVersionEndpoint, async ({ ctx, params }) => getPackageVersion(ctx, params.id, params.versionId))
