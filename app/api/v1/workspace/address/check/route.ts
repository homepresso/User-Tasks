import { apiRoute } from '@/lib/api/route'
import { checkWorkspaceAddressEndpoint } from '@/lib/api-schemas/workspace-address'
import { checkSubdomain } from '@/lib/services/workspace-address'

/** GET /api/v1/workspace/address/check?subdomain=… */
export const GET = apiRoute(checkWorkspaceAddressEndpoint, async ({ ctx, query }) => checkSubdomain(ctx, query.subdomain))
