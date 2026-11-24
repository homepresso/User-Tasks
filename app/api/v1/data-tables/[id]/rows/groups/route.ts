import { apiRoute } from '@/lib/api/route'
import { groupRowsEndpoint } from '@/lib/api-schemas/data-tables'
import { groupRows } from '@/lib/services/data-table-grouping'

/** GET /api/v1/data-tables/{id}/rows/groups — counts and sums per group over the whole filtered result. */
export const GET = apiRoute(groupRowsEndpoint, async ({ ctx, params, query }) => groupRows(ctx, params.id, {
  group_by: query.group_by,
  search: query.search,
  filters: query.filters,
  sum: query.sum,
  direction: query.group_order ? [query.group_order, query.group_order] : undefined,
}))
