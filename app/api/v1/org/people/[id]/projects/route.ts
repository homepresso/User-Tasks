import { apiRoute } from '@/lib/api/route'
import { listOrgPersonProjectsEndpoint } from '@/lib/api-schemas/org'
import { getMyProjects } from '@/lib/services/projects'

/** GET /api/v1/org/people/{id}/projects — projects the person is on. */
export const GET = apiRoute(listOrgPersonProjectsEndpoint, async ({ ctx, params, query }) =>
  getMyProjects(ctx, params.id, { include_archived: query.include_archived === 'true' }))
