import { apiRoute } from '@/lib/api/route'
import { getUserManagerEndpoint, setUserManagerEndpoint } from '@/lib/api-schemas/governance'
import { ServiceError, type ServiceContext } from '@/lib/services/context'
import { getReportingLine, setManager } from '@/lib/services/manager-tasks'

function userIdOf(ctx: ServiceContext, id: string): string {
  if (id !== 'me') return id
  if (!ctx.actorId) throw ServiceError.validation('`me` needs a user-bound credential')
  return ctx.actorId
}

/** GET /api/v1/users/{id}/manager — manager, chain and direct reports. */
export const GET = apiRoute(getUserManagerEndpoint, async ({ ctx, params }) => getReportingLine(ctx, userIdOf(ctx, params.id)))

/** PUT /api/v1/users/{id}/manager — set or clear the manager. */
export const PUT = apiRoute(setUserManagerEndpoint, async ({ ctx, params, body }) => setManager(ctx, userIdOf(ctx, params.id), body.manager_user_id))
