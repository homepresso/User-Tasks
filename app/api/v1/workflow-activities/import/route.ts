import { apiRoute } from '@/lib/api/route'
import { importWorkflowActivityEndpoint } from '@/lib/api-schemas/workflow-activities'
import { importWorkflowActivity } from '@/lib/services/workflow-activities'

/** POST /api/v1/workflow-activities/import — create an activity from a portable export. */
export const POST = apiRoute(importWorkflowActivityEndpoint, async ({ ctx, query, body }) =>
  ({ workflow_activity: await importWorkflowActivity(ctx, body, { publish: query.publish === 'true' }) }))
