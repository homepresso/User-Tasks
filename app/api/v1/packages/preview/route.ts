import { apiRoute } from '@/lib/api/route'
import { previewPackageEndpoint } from '@/lib/api-schemas/packages'
import { previewPackageContents } from '@/lib/services/packages'

/** POST /api/v1/packages/preview */
export const POST = apiRoute(previewPackageEndpoint, async ({ ctx, body }) => previewPackageContents(ctx, body))
