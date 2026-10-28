import { apiRoute } from '@/lib/api/route'
import { rotateScimTokenEndpoint } from '@/lib/api-schemas/directory-sync'
import { rotateScimToken } from '@/lib/services/directory-sync'

/** POST /api/v1/directory-sync/scim-tokens/{id}/rotate */
export const POST = apiRoute(rotateScimTokenEndpoint, async ({ ctx, params, body }) => rotateScimToken(ctx, params.id, body))
