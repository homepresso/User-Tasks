import { apiRoute } from '@/lib/api/route'
import { revokeApiKeyEndpoint } from '@/lib/api-schemas/api-keys'
import { revokeApiKey } from '@/lib/services/api-keys'

/** POST /api/v1/api-keys/{id}/revoke */
export const POST = apiRoute(revokeApiKeyEndpoint, async ({ ctx, params }) => revokeApiKey(ctx, params.id))
