import { apiRoute } from '@/lib/api/route'
import { buildPackageVersionEndpoint, listPackageVersionsEndpoint } from '@/lib/api-schemas/packages'
import { resolvePage } from '@/lib/services/_shared'
import { listPackageVersions } from '@/lib/services/packages'
import { buildPackageVersionHandler } from '@/lib/user-jobs/kinds/api'

export const maxDuration = 120

/** GET /api/v1/packages/{id}/versions */
export const GET = apiRoute(listPackageVersionsEndpoint, async ({ ctx, params, query }) => listPackageVersions(ctx, params.id, resolvePage(query)))

/** POST /api/v1/packages/{id}/versions — build, sign and publish a version (async variant: 202 job) */
export const POST = apiRoute(buildPackageVersionEndpoint, buildPackageVersionHandler)
