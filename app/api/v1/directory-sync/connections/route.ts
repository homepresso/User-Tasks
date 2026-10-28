import { apiRoute } from '@/lib/api/route'
import { createDirectoryConnectionEndpoint, listDirectoryConnectionsEndpoint } from '@/lib/api-schemas/directory-sync'
import { createDirectoryConnection, listDirectoryConnections } from '@/lib/services/directory-sync'

/** GET /api/v1/directory-sync/connections */
export const GET = apiRoute(listDirectoryConnectionsEndpoint, async ({ ctx }) => listDirectoryConnections(ctx))

/** POST /api/v1/directory-sync/connections */
export const POST = apiRoute(createDirectoryConnectionEndpoint, async ({ ctx, body }) => createDirectoryConnection(ctx, body))
