import { apiRoute } from '@/lib/api/route'
import { completePackageInstallEndpoint } from '@/lib/api-schemas/packages'
import { completePackageInstall } from '@/lib/services/package-installs'

export const maxDuration = 120

/** POST /api/v1/package-installs/{id}/complete — complete setup */
export const POST = apiRoute(completePackageInstallEndpoint, async ({ ctx, params, body }) => completePackageInstall(ctx, params.id, body))
