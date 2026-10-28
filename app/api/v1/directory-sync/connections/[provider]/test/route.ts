import { apiRoute } from '@/lib/api/route'
import { testDirectoryConnectionEndpoint } from '@/lib/api-schemas/directory-sync'
import { testDirectoryConnection } from '@/lib/services/directory-sync'

/** POST /api/v1/directory-sync/connections/{provider}/test */
export const POST = apiRoute(testDirectoryConnectionEndpoint, async ({ ctx, params, body }) => testDirectoryConnection(ctx, params.provider, body))
