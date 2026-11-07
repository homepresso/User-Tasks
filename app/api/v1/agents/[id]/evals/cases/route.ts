import { apiRoute } from '@/lib/api/route'
import { createAgentEvalCaseEndpoint, listAgentEvalCasesEndpoint } from '@/lib/api-schemas/agents'
import { listEvalCases, saveEvalCase } from '@/lib/services/agents'

/** GET /api/v1/agents/{id}/evals/cases — the agent's test cases. */
export const GET = apiRoute(listAgentEvalCasesEndpoint, async ({ ctx, params }) => listEvalCases(ctx, params.id))

/** POST /api/v1/agents/{id}/evals/cases — add a test case. */
export const POST = apiRoute(createAgentEvalCaseEndpoint, async ({ ctx, params, body }) =>
  saveEvalCase(ctx, params.id, { name: body.name, input_message: body.input_message, expected: body.expected, is_active: body.is_active }))
