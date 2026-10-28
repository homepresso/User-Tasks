import { apiRoute } from '@/lib/api/route'
import { createPackageEndpoint, listPackagesEndpoint } from '@/lib/api-schemas/packages'
import { resolvePage } from '@/lib/services/_shared'
import { createPackage, listPackages } from '@/lib/services/packages'

/** GET /api/v1/packages */
export const GET = apiRoute(listPackagesEndpoint, async ({ ctx, query }) => listPackages(ctx, resolvePage(query)))

/** POST /api/v1/packages */
export const POST = apiRoute(createPackageEndpoint, async ({ ctx, body }) => createPackage(ctx, body))
