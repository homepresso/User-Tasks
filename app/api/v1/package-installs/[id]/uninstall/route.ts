import { apiRoute } from '@/lib/api/route'
import { uninstallPackageEndpoint } from '@/lib/api-schemas/packages'
import { uninstallPackageHandler } from '@/lib/user-jobs/kinds/api'

export const maxDuration = 120

/** POST /api/v1/package-installs/{id}/uninstall (async variant: 202 job) */
export const POST = apiRoute(uninstallPackageEndpoint, uninstallPackageHandler)
