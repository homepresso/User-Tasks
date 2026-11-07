import { apiRoute } from '@/lib/api/route'
import { getWorkspaceAddressEndpoint, updateWorkspaceAddressEndpoint } from '@/lib/api-schemas/workspace-address'
import { getWorkspaceAddress, setWorkspaceSubdomain } from '@/lib/services/workspace-address'

/** GET /api/v1/workspace/address */
export const GET = apiRoute(getWorkspaceAddressEndpoint, async ({ ctx }) => getWorkspaceAddress(ctx))

/** PATCH /api/v1/workspace/address — { subdomain } (settings.edit; audited). */
export const PATCH = apiRoute(updateWorkspaceAddressEndpoint, async ({ ctx, body }) => setWorkspaceSubdomain(ctx, body.subdomain))
