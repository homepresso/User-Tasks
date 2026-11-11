import { apiRoute } from '@/lib/api/route'
import { removePackageItemsEndpoint } from '@/lib/api-schemas/packages'
import { removePackageItems } from '@/lib/services/package-items'

/** POST /api/v1/packages/{id}/items/remove */
export const POST = apiRoute(removePackageItemsEndpoint, async ({ ctx, params, body }) => removePackageItems(ctx, params.id, body))
