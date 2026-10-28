import { apiRoute } from '@/lib/api/route'
import { getPackageInstallEndpoint } from '@/lib/api-schemas/packages'
import { getPackageInstall } from '@/lib/services/package-installs'

/** GET /api/v1/package-installs/{id} */
export const GET = apiRoute(getPackageInstallEndpoint, async ({ ctx, params }) => getPackageInstall(ctx, params.id))
