import { apiRoute } from '@/lib/api/route'
import { writeRowCellsEndpoint } from '@/lib/api-schemas/data-tables'
import { writeGridCells } from '@/lib/services/data-table-views'

/** PATCH /api/v1/data-tables/{id}/rows/{rowId}/cells — inline edit through a view (read-only columns refused; 409 on a stale row). */
export const PATCH = apiRoute(writeRowCellsEndpoint, async ({ ctx, params, body }) => writeGridCells(ctx, params.id, params.rowId, body))
