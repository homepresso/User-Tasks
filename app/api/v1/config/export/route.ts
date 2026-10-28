import { apiRoute } from '@/lib/api/route'
import { exportConfigEndpoint } from '@/lib/api-schemas/config'
import { exportConfigHandler } from '@/lib/user-jobs/kinds/api'

export const maxDuration = 60

/**
 * GET /api/v1/config/export — workspace configuration as GitHub-sync layout
 * files (secrets scrubbed). `?async=true` / `Prefer: respond-async` → 202 job.
 */
export const GET = apiRoute(exportConfigEndpoint, exportConfigHandler)
