import { apiRoute } from '@/lib/api/route'
import { installPackageEndpoint, listPackageInstallsEndpoint } from '@/lib/api-schemas/packages'
import { resolvePage } from '@/lib/services/_shared'
import { listPackageInstalls } from '@/lib/services/package-installs'
import { installPackageHandler } from '@/lib/user-jobs/kinds/api'

export const maxDuration = 300

/** GET /api/v1/package-installs — the package library */
export const GET = apiRoute(listPackageInstallsEndpoint, async ({ ctx, query }) => listPackageInstalls(ctx, resolvePage(query)))

/** POST /api/v1/package-installs — install or upgrade (async variant: 202 job) */
export const POST = apiRoute(installPackageEndpoint, installPackageHandler)
