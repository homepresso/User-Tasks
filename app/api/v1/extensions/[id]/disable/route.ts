import { apiRoute } from '@/lib/api/route'
import { disableExtensionEndpoint } from '@/lib/api-schemas/extensions'
import { disableExtension } from '@/lib/services/extensions'

/** POST /api/v1/extensions/{id}/disable (settings.edit; settings and data kept; audited). */
export const POST = apiRoute(disableExtensionEndpoint, async ({ ctx, params }) => disableExtension(ctx, params.id))
