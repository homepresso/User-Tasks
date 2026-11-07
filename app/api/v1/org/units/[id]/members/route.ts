import { apiRoute } from '@/lib/api/route'
import { listOrgUnitMembersEndpoint } from '@/lib/api-schemas/org'
import { getOrgUnitMembers } from '@/lib/services/org'

/** GET /api/v1/org/units/{id}/members — direct or recursive members. */
export const GET = apiRoute(listOrgUnitMembersEndpoint, async ({ ctx, params, query }) =>
  getOrgUnitMembers(ctx, params.id, { recursive: query.recursive === 'true' }))
