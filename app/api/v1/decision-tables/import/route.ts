import { apiRoute } from '@/lib/api/route'
import { importDecisionTableEndpoint } from '@/lib/api-schemas/decision-tables'
import { importDecisionTable } from '@/lib/services/decision-tables'

/** POST /api/v1/decision-tables/import — always creates a new table. */
export const POST = apiRoute(importDecisionTableEndpoint, async ({ ctx, body }) => {
  const { name_override, description_override, ...payload } = body
  return { decision_table: await importDecisionTable(ctx, { payload, name_override, description_override }) }
})
