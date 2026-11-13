import { apiRoute } from '@/lib/api/route'
import { getExtensionEndpoint } from '@/lib/api-schemas/extensions'
import { getExtension } from '@/lib/services/extensions'

/** GET /api/v1/extensions/{id} */
export const GET = apiRoute(getExtensionEndpoint, async ({ ctx, params }) => getExtension(ctx, params.id))
