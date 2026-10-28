import { apiRoute } from '@/lib/api/route'
import { applyConfigEndpoint } from '@/lib/api-schemas/config'
import { applyConfigHandler } from '@/lib/user-jobs/kinds/api'

// Synchronous apply of up to 2000 assets (one row write each): allow the
// longest common serverless limit rather than the 60 s used elsewhere.
export const maxDuration = 300

/** POST /api/v1/config/apply — plan (dry_run) or apply config-as-code files (async variant: 202 job). */
export const POST = apiRoute(applyConfigEndpoint, applyConfigHandler)
