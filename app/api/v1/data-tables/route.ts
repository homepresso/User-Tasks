import { apiRoute } from '@/lib/api/route'
import { createDataTableEndpoint, listDataTablesEndpoint } from '@/lib/api-schemas/data-tables'
import { resolvePage } from '@/lib/services/_shared'
import { createDataTable, listDataTables } from '@/lib/services/data-tables'

/** GET /api/v1/data-tables — tables the credential can reach (resource scopes apply). */
export const GET = apiRoute(listDataTablesEndpoint, async ({ ctx, query }) =>
  listDataTables(ctx, { search: query.search }, resolvePage(query)))

/** POST /api/v1/data-tables — system ID / Date Created columns are added. */
export const POST = apiRoute(createDataTableEndpoint, async ({ ctx, body }) =>
  ({ data_table: await createDataTable(ctx, body) }))
