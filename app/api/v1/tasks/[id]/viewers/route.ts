import { apiRoute } from '@/lib/api/route'
import { addTaskViewersEndpoint, listTaskViewersEndpoint } from '@/lib/api-schemas/task-viewers'
import { addTaskViewers, listTaskViewers } from '@/lib/services/task-viewers'

/** GET /api/v1/tasks/{id}/viewers — who the task is shared with (read only invites). */
export const GET = apiRoute(listTaskViewersEndpoint, async ({ ctx, params }) => listTaskViewers(ctx, params.id))

/** POST /api/v1/tasks/{id}/viewers — invite people, teams or roles to view the task. */
export const POST = apiRoute(addTaskViewersEndpoint, async ({ ctx, params, body }) =>
  addTaskViewers(ctx, params.id, { principals: body.viewers, note: body.note ?? null, include_subtasks: body.include_subtasks, via: 'api' }))
