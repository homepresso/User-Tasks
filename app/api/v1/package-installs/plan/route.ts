import { apiRoute } from '@/lib/api/route'
import { planPackageInstallEndpoint } from '@/lib/api-schemas/packages'
import { planPackageInstall } from '@/lib/services/package-installs'

export const maxDuration = 120

/** POST /api/v1/package-installs/plan — dry run */
export const POST = apiRoute(planPackageInstallEndpoint, async ({ ctx, body }) => planPackageInstall(ctx, body))
