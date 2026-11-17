import { apiRoute } from '@/lib/api/route'
import { writeRowsCellsEndpoint } from '@/lib/api-schemas/data-tables'
import { writeGridRows } from '@/lib/services/data-table-views'

/** PATCH /api/v1/data-tables/{id}/rows/cells — batch inline edit ("Edit all rows"): an outcome per row, nothing rolled back. */
export const PATCH = apiRoute(writeRowsCellsEndpoint, async ({ ctx, params, body }) => writeGridRows(ctx, params.id, body))
