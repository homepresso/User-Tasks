import { apiRoute } from '@/lib/api/route'
import { deleteDataTableEndpoint, getDataTableEndpoint, updateDataTableEndpoint } from '@/lib/api-schemas/data-tables'
import { deleteDataTable, getDataTable, updateDataTable } from '@/lib/services/data-tables'

/** GET /api/v1/data-tables/{id} — table with its columns. */
export const GET = apiRoute(getDataTableEndpoint, async ({ ctx, params }) =>
  ({ data_table: await getDataTable(ctx, params.id) }))

/** PATCH /api/v1/data-tables/{id} — rename / describe / replace custom columns. */
export const PATCH = apiRoute(updateDataTableEndpoint, async ({ ctx, params, body }) =>
  ({ data_table: await updateDataTable(ctx, params.id, body) }))

/** DELETE /api/v1/data-tables/{id} — queued delete of the table, its rows and files. */
export const DELETE = apiRoute(deleteDataTableEndpoint, async ({ ctx, params }) => deleteDataTable(ctx, params.id))
