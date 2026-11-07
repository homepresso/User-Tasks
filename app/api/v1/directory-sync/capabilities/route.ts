import { apiRoute } from '@/lib/api/route'
import { getDirectoryCapabilitiesEndpoint } from '@/lib/api-schemas/directory-sync'
import { getDirectoryCapabilities } from '@/lib/services/directory-groups'

/** GET /api/v1/directory-sync/capabilities */
export const GET = apiRoute(getDirectoryCapabilitiesEndpoint, async ({ ctx }) => getDirectoryCapabilities(ctx))
