import { apiRoute } from '@/lib/api/route'
import { listDirectorySyncRunsEndpoint } from '@/lib/api-schemas/directory-sync'
import { resolvePage } from '@/lib/services/_shared'
import { listDirectorySyncRuns } from '@/lib/services/directory-sync'

/** GET /api/v1/directory-sync/runs */
export const GET = apiRoute(listDirectorySyncRunsEndpoint, async ({ ctx, query }) => listDirectorySyncRuns(ctx, resolvePage(query), { provider: query.provider }))
