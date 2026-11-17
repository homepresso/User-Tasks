import { apiRoute } from '@/lib/api/route'
import { getTableViewsEndpoint, updateTableViewsEndpoint } from '@/lib/api-schemas/data-tables'
import { getTableViews, saveTableViews } from '@/lib/services/data-table-views'

/** GET /api/v1/data-tables/{id}/views — the grid views: columns, controls, bindings, editing. */
export const GET = apiRoute(getTableViewsEndpoint, async ({ ctx, params }) => getTableViews(ctx, params.id))

/** PUT /api/v1/data-tables/{id}/views — replace the grid views (data.edit_schema). */
export const PUT = apiRoute(updateTableViewsEndpoint, async ({ ctx, params, body }) => saveTableViews(ctx, params.id, body.views))
