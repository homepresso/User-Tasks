import { apiRoute } from '@/lib/api/route'
import { listQueueTasksEndpoint } from '@/lib/api-schemas/home'
import { resolvePage } from '@/lib/services/_shared'
import { listQueueTasks } from '@/lib/services/home'

/** GET /api/v1/home/queue — tasks I can accept or claim. */
export const GET = apiRoute(listQueueTasksEndpoint, async ({ ctx, query }) => listQueueTasks(ctx, { search: query.search }, resolvePage(query)))
