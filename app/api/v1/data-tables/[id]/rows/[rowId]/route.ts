import { apiRoute } from '@/lib/api/route'
import { deleteRowEndpoint, getRowEndpoint, updateRowEndpoint } from '@/lib/api-schemas/data-tables'
import { deleteRow, getRow, updateRow } from '@/lib/services/data-tables'

/** GET /api/v1/data-tables/{id}/rows/{rowId} */
export const GET = apiRoute(getRowEndpoint, async ({ ctx, params }) => ({ row: await getRow(ctx, params.id, params.rowId) }))

/** PATCH /api/v1/data-tables/{id}/rows/{rowId} — merge cells (fires "updated" workflows). */
export const PATCH = apiRoute(updateRowEndpoint, async ({ ctx, params, body }) =>
  ({ row: await updateRow(ctx, params.id, params.rowId, body.data) }))

/** DELETE /api/v1/data-tables/{id}/rows/{rowId} — queued (fires "deleted" workflows). */
export const DELETE = apiRoute(deleteRowEndpoint, async ({ ctx, params }) => deleteRow(ctx, params.id, params.rowId))
