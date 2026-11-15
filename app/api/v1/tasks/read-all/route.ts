import { apiRoute } from '@/lib/api/route'
import { markAllTasksReadEndpoint } from '@/lib/api-schemas/task-reads'
import { markAllTasksRead } from '@/lib/services/task-reads'

/** POST /api/v1/tasks/read-all — mark every task that is unread for you as read. */
export const POST = apiRoute(markAllTasksReadEndpoint, async ({ ctx }) => markAllTasksRead(ctx))
