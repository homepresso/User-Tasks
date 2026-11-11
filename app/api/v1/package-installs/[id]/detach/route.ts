import { apiRoute } from '@/lib/api/route'
import { detachInstallItemsEndpoint } from '@/lib/api-schemas/packages'
import { detachInstallItems } from '@/lib/services/package-installs'

/** POST /api/v1/package-installs/{id}/detach */
export const POST = apiRoute(detachInstallItemsEndpoint, async ({ ctx, params, body }) => detachInstallItems(ctx, params.id, body))
