import { apiRoute } from '@/lib/api/route'
import { listAgentEvalRunsEndpoint, runAgentEvalsEndpoint } from '@/lib/api-schemas/agents'
import { listEvalRuns, startEvalRun } from '@/lib/services/agents'

// Small suites finish inside the invocation; larger ones keep running after the response (after()).
export const maxDuration = 300

/** POST /api/v1/agents/{id}/evals/runs — run the suite (side-effecting tools simulated). */
export const POST = apiRoute(runAgentEvalsEndpoint, async ({ ctx, params, body }) =>
  startEvalRun(ctx, params.id, { case_ids: body.case_ids }))

/** GET /api/v1/agents/{id}/evals/runs — evaluation runs, newest first. */
export const GET = apiRoute(listAgentEvalRunsEndpoint, async ({ ctx, params }) => listEvalRuns(ctx, params.id))
