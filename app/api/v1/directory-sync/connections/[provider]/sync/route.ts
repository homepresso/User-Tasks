import { apiRoute } from '@/lib/api/route'
import { startDirectorySyncEndpoint } from '@/lib/api-schemas/directory-sync'
import { startDirectorySyncRun } from '@/lib/services/directory-sync'

/** POST /api/v1/directory-sync/connections/{provider}/sync */
export const POST = apiRoute(startDirectorySyncEndpoint, async ({ ctx, params, body }) => startDirectorySyncRun(ctx, params.provider, body))
