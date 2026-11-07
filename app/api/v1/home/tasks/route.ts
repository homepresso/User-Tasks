import { apiRoute } from '@/lib/api/route'
import { listMyHomeTasksEndpoint } from '@/lib/api-schemas/home'
import { resolvePage } from '@/lib/services/_shared'
import { listMyTasks } from '@/lib/services/home'

/** GET /api/v1/home/tasks — my open tasks with process and stage. */
export const GET = apiRoute(listMyHomeTasksEndpoint, async ({ ctx, query }) =>
  listMyTasks(ctx, { search: query.search, sort: query.sort }, resolvePage(query)))
