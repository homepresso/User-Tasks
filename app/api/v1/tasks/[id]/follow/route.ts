import { apiRoute } from '@/lib/api/route'
import { followTaskEndpoint, unfollowTaskEndpoint } from '@/lib/api-schemas/task-follows'
import { setTaskFollowed } from '@/lib/services/task-follows'

/** PUT /api/v1/tasks/{id}/follow — follow a task you can see. */
export const PUT = apiRoute(followTaskEndpoint, async ({ ctx, params }) => setTaskFollowed(ctx, params.id, true))

/** DELETE /api/v1/tasks/{id}/follow — stop following a task. */
export const DELETE = apiRoute(unfollowTaskEndpoint, async ({ ctx, params }) => setTaskFollowed(ctx, params.id, false))
