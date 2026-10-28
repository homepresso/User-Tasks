import { apiRoute } from '@/lib/api/route'
import { getPackageContentsEndpoint } from '@/lib/api-schemas/packages'
import { getPackageContents } from '@/lib/services/packages'

/** GET /api/v1/packages/{id}/contents */
export const GET = apiRoute(getPackageContentsEndpoint, async ({ ctx, params }) => getPackageContents(ctx, params.id))
