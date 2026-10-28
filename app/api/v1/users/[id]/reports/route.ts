import { apiRoute } from '@/lib/api/route'
import { listUserReportsEndpoint } from '@/lib/api-schemas/governance'
import { ServiceError } from '@/lib/services/context'
import { listReportsOf } from '@/lib/services/manager-tasks'

/** GET /api/v1/users/{id}/reports — direct (or all) reports. */
export const GET = apiRoute(listUserReportsEndpoint, async ({ ctx, params, query }) => {
  const id = params.id === 'me' ? ctx.actorId : params.id
  if (!id) throw ServiceError.validation('`me` needs a user-bound credential')
  return listReportsOf(ctx, id, { indirect: query.indirect === 'true' })
})
