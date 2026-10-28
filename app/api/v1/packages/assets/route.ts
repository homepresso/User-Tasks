import { apiRoute } from '@/lib/api/route'
import { searchPackageAssetsEndpoint } from '@/lib/api-schemas/packages'
import { searchPackageAssets } from '@/lib/services/package-assets'

/** GET /api/v1/packages/assets */
export const GET = apiRoute(searchPackageAssetsEndpoint, async ({ ctx, query }) => searchPackageAssets(ctx, { ...query, types: query.type }))
