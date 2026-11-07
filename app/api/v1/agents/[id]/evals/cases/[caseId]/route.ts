import { apiRoute } from '@/lib/api/route'
import { deleteAgentEvalCaseEndpoint, updateAgentEvalCaseEndpoint } from '@/lib/api-schemas/agents'
import { deleteEvalCase, saveEvalCase } from '@/lib/services/agents'

/** PUT /api/v1/agents/{id}/evals/cases/{caseId} — update a test case. */
export const PUT = apiRoute(updateAgentEvalCaseEndpoint, async ({ ctx, params, body }) =>
  saveEvalCase(ctx, params.id, { id: params.caseId, name: body.name, input_message: body.input_message, expected: body.expected, is_active: body.is_active }))

/** DELETE /api/v1/agents/{id}/evals/cases/{caseId} — delete a test case. */
export const DELETE = apiRoute(deleteAgentEvalCaseEndpoint, async ({ ctx, params }) =>
  deleteEvalCase(ctx, params.id, params.caseId) as Promise<{ deleted: true }>)
