import { apiRoute } from '@/lib/api/route'
import { workflowActivityUsagesEndpoint } from '@/lib/api-schemas/workflow-activities'
import { getWorkflowActivityUsages } from '@/lib/services/workflow-activities'

/** GET /api/v1/workflow-activities/{id}/usages — workflow steps that run the action. */
export const GET = apiRoute(workflowActivityUsagesEndpoint, async ({ ctx, params }) => {
  const usages = await getWorkflowActivityUsages(ctx, params.id)
  return { usages, total: usages.length }
})
