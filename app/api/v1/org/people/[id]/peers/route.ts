import { apiRoute } from '@/lib/api/route'
import { listOrgPeersEndpoint } from '@/lib/api-schemas/org'
import { getPeers } from '@/lib/services/org'

/** GET /api/v1/org/people/{id}/peers — others with the same manager. */
export const GET = apiRoute(listOrgPeersEndpoint, async ({ ctx, params }) => getPeers(ctx, params.id))
