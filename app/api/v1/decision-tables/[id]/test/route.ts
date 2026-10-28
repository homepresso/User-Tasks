import { apiRoute } from '@/lib/api/route'
import { testDecisionTableEndpoint } from '@/lib/api-schemas/decision-tables'
import { testDecisionTable } from '@/lib/services/decision-tables'

/** POST /api/v1/decision-tables/{id}/test — evaluate against sample input values. */
export const POST = apiRoute(testDecisionTableEndpoint, async ({ ctx, params, body }) => testDecisionTable(ctx, params.id, body.values))
