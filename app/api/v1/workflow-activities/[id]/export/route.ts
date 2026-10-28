import { apiRoute } from '@/lib/api/route'
import { exportWorkflowActivityEndpoint } from '@/lib/api-schemas/workflow-activities'
import { exportWorkflowActivity } from '@/lib/services/workflow-activities'

/** GET /api/v1/workflow-activities/{id}/export — portable JSON for POST /workflow-activities/import. */
export const GET = apiRoute(exportWorkflowActivityEndpoint, async ({ ctx, params }) =>
  exportWorkflowActivity(ctx, params.id))
