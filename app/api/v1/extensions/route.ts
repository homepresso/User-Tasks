import { apiRoute } from '@/lib/api/route'
import { listExtensionsEndpoint } from '@/lib/api-schemas/extensions'
import { listExtensions } from '@/lib/services/extensions'

/** GET /api/v1/extensions — the extensions in this build and their state in this workspace. */
export const GET = apiRoute(listExtensionsEndpoint, async ({ ctx }) => listExtensions(ctx))
