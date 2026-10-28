import { apiRoute } from '@/lib/api/route'
import { listUsersEndpoint } from '@/lib/api-schemas/governance'
import { resolvePage } from '@/lib/services/_shared'
import { listUsers } from '@/lib/services/roles'

/** GET /api/v1/users — workspace users, optionally with roles and teams. */
export const GET = apiRoute(listUsersEndpoint, async ({ ctx, query }) => listUsers(ctx, {
  search: query.search,
  include_roles: query.include_roles === 'true',
  include_teams: query.include_teams === 'true',
}, resolvePage(query)))
