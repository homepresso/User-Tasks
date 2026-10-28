import { apiRoute } from '@/lib/api/route'
import { listRowsEndpoint, upsertRowsEndpoint } from '@/lib/api-schemas/data-tables'
import { resolvePage } from '@/lib/services/_shared'
import { DATA_ROW_LIMITS, parseRowOrder, queryRows, upsertRows } from '@/lib/services/data-tables'

/** GET /api/v1/data-tables/{id}/rows — search / filters / order / limit / offset. */
export const GET = apiRoute(listRowsEndpoint, async ({ ctx, params, query }) => {
  const page = resolvePage(query)
  return queryRows(ctx, params.id, { search: query.search, filters: query.filters, ...parseRowOrder(query.order) }, {
    limit: page.limit ?? DATA_ROW_LIMITS.scan,
    offset: page.offset,
  })
})

/** POST /api/v1/data-tables/{id}/rows — insert, or replace by row_id; single (`data`) or bulk (`rows`). */
export const POST = apiRoute(upsertRowsEndpoint, async ({ ctx, params, body }) => {
  const rows = await upsertRows(ctx, params.id, body.rows ?? [{ row_id: body.row_id, data: body.data ?? {} }])
  return {
    rows,
    created: rows.filter((row) => row.action === 'created').length,
    updated: rows.filter((row) => row.action === 'updated').length,
  }
})
