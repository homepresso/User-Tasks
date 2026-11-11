import { apiRoute } from '@/lib/api/route'
import { removeTaskViewerEndpoint } from '@/lib/api-schemas/task-viewers'
import { removeTaskViewer } from '@/lib/services/task-viewers'

/** DELETE /api/v1/tasks/{id}/viewers/{viewerId} — stop sharing the task with that person, team or role. */
export const DELETE = apiRoute(removeTaskViewerEndpoint, async ({ ctx, params }) => removeTaskViewer(ctx, params.id, params.viewerId, { via: 'api' }))
