import { apiRoute } from '@/lib/api/route'
import { getTaskNextStepEndpoint } from '@/lib/api-schemas/task-completion'
import { getTaskNextStep } from '@/lib/services/task-completion-screen'

/** GET /api/v1/tasks/{id}/next — what happens next after the task was actioned. */
export const GET = apiRoute(getTaskNextStepEndpoint, async ({ ctx, params }) => ({ next: await getTaskNextStep(ctx, params.id) }))
