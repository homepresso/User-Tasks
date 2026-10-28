import { apiRoute } from '@/lib/api/route'
import { createScimTokenEndpoint, listScimTokensEndpoint } from '@/lib/api-schemas/directory-sync'
import { createScimToken, listScimTokens } from '@/lib/services/directory-sync'

/** GET /api/v1/directory-sync/scim-tokens */
export const GET = apiRoute(listScimTokensEndpoint, async ({ ctx }) => listScimTokens(ctx))

/** POST /api/v1/directory-sync/scim-tokens */
export const POST = apiRoute(createScimTokenEndpoint, async ({ ctx, body }) => createScimToken(ctx, body))
