import { apiRoute } from '@/lib/api/route'
import { addSubtaskEndpoint, listSubtasksEndpoint } from '@/lib/api-schemas/task-subtasks'
import { addSubtask, listSubtasks } from '@/lib/services/tasks'

/** GET /api/v1/tasks/{id}/subtasks — the task's direct subtasks (and whether you may add more). */
export const GET = apiRoute(listSubtasksEndpoint, async ({ ctx, params }) => listSubtasks(ctx, params.id))

/** POST /api/v1/tasks/{id}/subtasks — add a subtask (anyone who can work on the open task). */
export const POST = apiRoute(addSubtaskEndpoint, async ({ ctx, params, body }) => ({ subtask: await addSubtask(ctx, params.id, body) }))
