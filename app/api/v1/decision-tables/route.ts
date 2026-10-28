import { apiRoute } from '@/lib/api/route'
import { createDecisionTableEndpoint, listDecisionTablesEndpoint } from '@/lib/api-schemas/decision-tables'
import { createDecisionTable, listDecisionTables } from '@/lib/services/decision-tables'
import { resolvePage } from '@/lib/services/_shared'

/** GET /api/v1/decision-tables */
export const GET = apiRoute(listDecisionTablesEndpoint, async ({ ctx, query }) =>
  listDecisionTables(ctx, { search: query.search }, resolvePage(query)))

/** POST /api/v1/decision-tables */
export const POST = apiRoute(createDecisionTableEndpoint, async ({ ctx, body }) => ({ decision_table: await createDecisionTable(ctx, body) }))
