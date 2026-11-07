import { apiRoute } from '@/lib/api/route'
import { getOrgManagerChainEndpoint } from '@/lib/api-schemas/org'
import { getManagerChain } from '@/lib/services/org'

/** GET /api/v1/org/people/{id}/manager-chain — managers, nearest first. */
export const GET = apiRoute(getOrgManagerChainEndpoint, async ({ ctx, params }) => getManagerChain(ctx, params.id))
