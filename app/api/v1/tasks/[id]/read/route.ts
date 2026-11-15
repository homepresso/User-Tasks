import { apiRoute } from '@/lib/api/route'
import { markTaskReadEndpoint, markTaskUnreadEndpoint } from '@/lib/api-schemas/task-reads'
import { markTaskRead, markTaskUnread } from '@/lib/services/task-reads'

/** PUT /api/v1/tasks/{id}/read — mark a task you can see as read. */
export const PUT = apiRoute(markTaskReadEndpoint, async ({ ctx, params }) => markTaskRead(ctx, params.id))

/** DELETE /api/v1/tasks/{id}/read — mark it as unread again. */
export const DELETE = apiRoute(markTaskUnreadEndpoint, async ({ ctx, params }) => markTaskUnread(ctx, params.id))
