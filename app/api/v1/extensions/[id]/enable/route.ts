import { apiRoute } from '@/lib/api/route'
import { enableExtensionEndpoint } from '@/lib/api-schemas/extensions'
import { enableExtension } from '@/lib/services/extensions'

/** POST /api/v1/extensions/{id}/enable (settings.edit; 402 unlicensed; audited). */
export const POST = apiRoute(enableExtensionEndpoint, async ({ ctx, params }) => enableExtension(ctx, params.id))
