import { apiRoute } from '@/lib/api/route'
import { gridOptionsEndpoint } from '@/lib/api-schemas/data-tables'
import { gridColumnOptions } from '@/lib/services/data-table-views'

/** POST /api/v1/data-tables/{id}/views/{viewId}/options — a bound column's options from its saved binding. */
export const POST = apiRoute(gridOptionsEndpoint, async ({ ctx, params, body }) => gridColumnOptions(ctx, params.id, params.viewId, body))
