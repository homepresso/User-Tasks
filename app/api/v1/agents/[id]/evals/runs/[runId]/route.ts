import { apiRoute } from '@/lib/api/route'
import { getAgentEvalRunEndpoint } from '@/lib/api-schemas/agents'
import { getEvalRun } from '@/lib/services/agents'

/** GET /api/v1/agents/{id}/evals/runs/{runId} — one evaluation run with per-case checks. */
export const GET = apiRoute(getAgentEvalRunEndpoint, async ({ ctx, params }) => getEvalRun(ctx, params.runId))
