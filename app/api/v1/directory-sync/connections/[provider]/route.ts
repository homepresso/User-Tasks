import { apiRoute } from '@/lib/api/route'
import { deleteDirectoryConnectionEndpoint, getDirectoryConnectionEndpoint, updateDirectoryConnectionEndpoint } from '@/lib/api-schemas/directory-sync'
import { deleteDirectoryConnection, getDirectoryConnectionView, updateDirectoryConnection } from '@/lib/services/directory-sync'

/** GET /api/v1/directory-sync/connections/{provider} */
export const GET = apiRoute(getDirectoryConnectionEndpoint, async ({ ctx, params }) => getDirectoryConnectionView(ctx, params.provider))

/** PATCH /api/v1/directory-sync/connections/{provider} */
export const PATCH = apiRoute(updateDirectoryConnectionEndpoint, async ({ ctx, params, body }) => updateDirectoryConnection(ctx, params.provider, body))

/** DELETE /api/v1/directory-sync/connections/{provider} */
export const DELETE = apiRoute(deleteDirectoryConnectionEndpoint, async ({ ctx, params }) => deleteDirectoryConnection(ctx, params.provider))
