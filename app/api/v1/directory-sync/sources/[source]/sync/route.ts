import { apiRoute } from '@/lib/api/route'
import { startDirectorySourceSyncEndpoint } from '@/lib/api-schemas/directory-sync'
import { startDirectorySourceSync } from '@/lib/services/directory-sources'

/** POST /api/v1/directory-sync/sources/{source}/sync */
export const POST = apiRoute(startDirectorySourceSyncEndpoint, async ({ ctx, params, body }) => startDirectorySourceSync(ctx, params.source, body))
