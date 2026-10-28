import { apiRoute } from '@/lib/api/route'
import {
  deleteWorkflowActivityEndpoint, getWorkflowActivityEndpoint, updateWorkflowActivityEndpoint,
} from '@/lib/api-schemas/workflow-activities'
import { deleteWorkflowActivity, getWorkflowActivity, updateWorkflowActivity } from '@/lib/services/workflow-activities'

/** GET /api/v1/workflow-activities/{id} — activity with source code and manifest. */
export const GET = apiRoute(getWorkflowActivityEndpoint, async ({ ctx, params }) =>
  ({ workflow_activity: await getWorkflowActivity(ctx, params.id) }))

/** PATCH /api/v1/workflow-activities/{id} — partial update. */
export const PATCH = apiRoute(updateWorkflowActivityEndpoint, async ({ ctx, params, body }) =>
  ({ workflow_activity: await updateWorkflowActivity(ctx, params.id, body) }))

/** DELETE /api/v1/workflow-activities/{id} — delete via the deletion queue (drained inline). */
export const DELETE = apiRoute(deleteWorkflowActivityEndpoint, async ({ ctx, params }) => {
  await deleteWorkflowActivity(ctx, params.id)
  return { deleted: true }
})
