import { apiRoute } from '@/lib/api/route'
import { deletePackageEndpoint, getPackageEndpoint, updatePackageEndpoint } from '@/lib/api-schemas/packages'
import { deletePackage, getPackage, updatePackage } from '@/lib/services/packages'

/** GET /api/v1/packages/{id} */
export const GET = apiRoute(getPackageEndpoint, async ({ ctx, params }) => getPackage(ctx, params.id))

/** PATCH /api/v1/packages/{id} */
export const PATCH = apiRoute(updatePackageEndpoint, async ({ ctx, params, body }) => updatePackage(ctx, params.id, body))

/** DELETE /api/v1/packages/{id} */
export const DELETE = apiRoute(deletePackageEndpoint, async ({ ctx, params }) => deletePackage(ctx, params.id))
