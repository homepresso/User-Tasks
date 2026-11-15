import { apiRoute } from '@/lib/api/route'
import { countUnreadTasksEndpoint } from '@/lib/api-schemas/task-reads'
import { countUnreadTasks } from '@/lib/services/task-reads'

/** GET /api/v1/tasks/unread-count — how many of your top-level tasks are unread. */
export const GET = apiRoute(countUnreadTasksEndpoint, async ({ ctx }) => countUnreadTasks(ctx))
