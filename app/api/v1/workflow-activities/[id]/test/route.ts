import { apiRoute } from '@/lib/api/route'
import { testWorkflowActivityEndpoint } from '@/lib/api-schemas/workflow-activities'
import { testWorkflowActivity } from '@/lib/services/workflow-activities'

/** POST /api/v1/workflow-activities/{id}/test — run one operation in the sandbox. */
export const POST = apiRoute(testWorkflowActivityEndpoint, async ({ ctx, params, body }) =>
  testWorkflowActivity(ctx, params.id, { operation: body.operation ?? null, inputs: body.inputs ?? null, version: body.version ?? null }))
