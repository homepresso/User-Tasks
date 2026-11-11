import { apiRoute } from '@/lib/api/route'
import { updateSubtaskEndpoint } from '@/lib/api-schemas/task-subtasks'
import { updateSubtask } from '@/lib/services/tasks'

/** PATCH /api/v1/tasks/{id}/subtasks/{subtaskId} — edit a subtask of this task. */
export const PATCH = apiRoute(updateSubtaskEndpoint, async ({ ctx, params, body }) =>
  ({ subtask: await updateSubtask(ctx, params.subtaskId, body, { parentTaskId: params.id }) }))
