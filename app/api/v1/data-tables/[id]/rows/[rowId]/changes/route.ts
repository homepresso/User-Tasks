import { apiRoute } from '@/lib/api/route'
import { rowChangesEndpoint } from '@/lib/api-schemas/data-tables'
import { listRowChanges } from '@/lib/services/data-table-audit'

/** GET /api/v1/data-tables/{id}/rows/{rowId}/changes — the row's field-change history (tables with audit_changes). */
export const GET = apiRoute(rowChangesEndpoint, async ({ ctx, params, query }) => listRowChanges(ctx, params.id, params.rowId, { limit: query.limit }))
