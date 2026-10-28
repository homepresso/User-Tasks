import { apiRoute } from '@/lib/api/route'
import { deleteApiKeyEndpoint } from '@/lib/api-schemas/api-keys'
import { deleteApiKey } from '@/lib/services/api-keys'

/** DELETE /api/v1/api-keys/{id} */
export const DELETE = apiRoute(deleteApiKeyEndpoint, async ({ ctx, params }) => deleteApiKey(ctx, params.id))
