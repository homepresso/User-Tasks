import { apiRoute } from '@/lib/api/route'
import { listFollowedTasksEndpoint } from '@/lib/api-schemas/task-follows'
import { resolvePage } from '@/lib/services/_shared'
import { pageFollowedTasks } from '@/lib/services/task-follows'

const csv = (value: string | undefined) => value?.split(',').map((s) => s.trim()).filter(Boolean)

/** GET /api/v1/tasks/following — the calling person's followed tasks (Task tracker → Following). */
export const GET = apiRoute(listFollowedTasksEndpoint, async ({ ctx, query }) =>
  pageFollowedTasks(ctx, {
    search: query.search,
    status: csv(query.status),
    priority: csv(query.priority),
    hideCompleted: query.hide_completed === 'true',
    sharedOnly: query.shared_only === 'true',
  }, resolvePage({ limit: query.limit, offset: query.offset })))
