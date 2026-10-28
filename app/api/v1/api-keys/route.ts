import { apiRoute } from '@/lib/api/route'
import { createApiKeyEndpoint, listApiKeysEndpoint } from '@/lib/api-schemas/api-keys'
import { resolvePage } from '@/lib/services/_shared'
import { createApiKey, listApiKeys } from '@/lib/services/api-keys'

/** GET /api/v1/api-keys — key metadata only. */
export const GET = apiRoute(listApiKeysEndpoint, async ({ ctx, query }) =>
  listApiKeys(ctx, { include_revoked: query.include_revoked !== 'false' }, resolvePage(query)))

/** POST /api/v1/api-keys — capped to the caller; the plaintext key is returned once. */
export const POST = apiRoute(createApiKeyEndpoint, async ({ ctx, body }) => createApiKey(ctx, body))
