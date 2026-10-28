import { apiRoute } from '@/lib/api/route'
import { deleteScimTokenEndpoint } from '@/lib/api-schemas/directory-sync'
import { deleteScimToken } from '@/lib/services/directory-sync'

/** DELETE /api/v1/directory-sync/scim-tokens/{id} */
export const DELETE = apiRoute(deleteScimTokenEndpoint, async ({ ctx, params }) => deleteScimToken(ctx, params.id))
