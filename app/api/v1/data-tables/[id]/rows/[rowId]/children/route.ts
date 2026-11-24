import { apiRoute } from '@/lib/api/route'
import { rowChildrenEndpoint } from '@/lib/api-schemas/data-tables'
import { rowChildren } from '@/lib/services/data-table-grouping'

/** GET /api/v1/data-tables/{id}/rows/{rowId}/children — a child relation's rows of the row, or the counts per relation. */
export const GET = apiRoute(rowChildrenEndpoint, async ({ ctx, params, query }) => rowChildren(ctx, params.id, params.rowId, query))
