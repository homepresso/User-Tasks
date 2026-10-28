import { apiRoute } from '@/lib/api/route'
import { upgradePackageInstallEndpoint } from '@/lib/api-schemas/packages'
import { upgradePackageInstallHandler } from '@/lib/user-jobs/kinds/api'

export const maxDuration = 300

/** POST /api/v1/package-installs/{id}/upgrade (async variant: 202 job) */
export const POST = apiRoute(upgradePackageInstallEndpoint, upgradePackageInstallHandler)
