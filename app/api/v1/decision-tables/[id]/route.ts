import { apiRoute } from '@/lib/api/route'
import {
  deleteDecisionTableEndpoint,
  getDecisionTableEndpoint,
  patchDecisionTableEndpoint,
  updateDecisionTableEndpoint,
} from '@/lib/api-schemas/decision-tables'
import { deleteDecisionTable, getDecisionTable, updateDecisionTable } from '@/lib/services/decision-tables'

/** GET /api/v1/decision-tables/{id} */
export const GET = apiRoute(getDecisionTableEndpoint, async ({ ctx, params }) => ({ decision_table: await getDecisionTable(ctx, params.id) }))

/** PUT/PATCH /api/v1/decision-tables/{id} — omitted fields are kept; the GET response is accepted as the body. */
export const PUT = apiRoute(updateDecisionTableEndpoint, async ({ ctx, params, body }) => {
  const { changed, ...decisionTable } = await updateDecisionTable(ctx, params.id, body)
  return { decision_table: decisionTable, changed }
})
export const PATCH = apiRoute(patchDecisionTableEndpoint, async ({ ctx, params, body }) => {
  const { changed, ...decisionTable } = await updateDecisionTable(ctx, params.id, body)
  return { decision_table: decisionTable, changed }
})

/** DELETE /api/v1/decision-tables/{id} — queued, as in the UI. */
export const DELETE = apiRoute(deleteDecisionTableEndpoint, async ({ ctx, params }) => deleteDecisionTable(ctx, params.id))
