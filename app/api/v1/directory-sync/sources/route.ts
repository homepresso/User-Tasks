import { apiRoute } from '@/lib/api/route'
import { listDirectorySourcesEndpoint } from '@/lib/api-schemas/directory-sync'
import { listDirectorySourceViews } from '@/lib/services/directory-sources'

/** GET /api/v1/directory-sync/sources */
export const GET = apiRoute(listDirectorySourcesEndpoint, async ({ ctx }) => listDirectorySourceViews(ctx))
