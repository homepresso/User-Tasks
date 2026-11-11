import { apiRoute } from '@/lib/api/route'
import { adoptInstallItemsEndpoint } from '@/lib/api-schemas/packages'
import { adoptInstallItems } from '@/lib/services/package-installs'

/** POST /api/v1/package-installs/{id}/adopt */
export const POST = apiRoute(adoptInstallItemsEndpoint, async ({ ctx, params, body }) => adoptInstallItems(ctx, params.id, body))
