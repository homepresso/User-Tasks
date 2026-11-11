import { apiRoute } from '@/lib/api/route'
import { addPackageItemsEndpoint, listPackageItemsEndpoint } from '@/lib/api-schemas/packages'
import { addPackageItems, listPackageItems } from '@/lib/services/package-items'

/** GET /api/v1/packages/{id}/items */
export const GET = apiRoute(listPackageItemsEndpoint, async ({ ctx, params }) => listPackageItems(ctx, params.id))

/** POST /api/v1/packages/{id}/items */
export const POST = apiRoute(addPackageItemsEndpoint, async ({ ctx, params, body }) => addPackageItems(ctx, params.id, body))
