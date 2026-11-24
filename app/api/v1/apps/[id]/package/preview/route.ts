import { apiRoute } from '@/lib/api/route'
import { previewAppPackageEndpoint } from '@/lib/api-schemas/apps'
import { previewAppPackage } from '@/lib/services/app-packages'

/** POST /api/v1/apps/{id}/package/preview — what packaging the app would include. */
export const POST = apiRoute(previewAppPackageEndpoint, async ({ ctx, params, body }) => previewAppPackage(ctx, params.id, body))
