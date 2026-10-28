import { apiRoute } from '@/lib/api/route'
import { createWorkflowActivityEndpoint, listWorkflowActivitiesEndpoint } from '@/lib/api-schemas/workflow-activities'
import { resolvePage } from '@/lib/services/_shared'
import { createWorkflowActivity, listWorkflowActivities } from '@/lib/services/workflow-activities'

/** GET /api/v1/workflow-activities — list activities (no source code). */
export const GET = apiRoute(listWorkflowActivitiesEndpoint, async ({ ctx, query }) =>
  listWorkflowActivities(ctx, { status: query.status, search: query.search }, resolvePage(query)))

/** POST /api/v1/workflow-activities — create an activity (code is validated, never run). */
export const POST = apiRoute(createWorkflowActivityEndpoint, async ({ ctx, body }) =>
  ({ workflow_activity: await createWorkflowActivity(ctx, body) }))
