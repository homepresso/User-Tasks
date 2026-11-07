import { apiRoute } from '@/lib/api/route'
import { listOrgTeamMembersEndpoint } from '@/lib/api-schemas/org'
import { getTeamMembers } from '@/lib/services/org'

/** GET /api/v1/org/teams/{id}/members — direct or recursive members. */
export const GET = apiRoute(listOrgTeamMembersEndpoint, async ({ ctx, params, query }) =>
  getTeamMembers(ctx, params.id, { recursive: query.recursive === 'true' }))
