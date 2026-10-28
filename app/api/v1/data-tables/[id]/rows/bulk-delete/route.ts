import { apiRoute } from '@/lib/api/route'
import { bulkDeleteRowsEndpoint } from '@/lib/api-schemas/data-tables'
import { bulkDeleteRowsHandler } from '@/lib/user-jobs/kinds/api'

/** POST /api/v1/data-tables/{id}/rows/bulk-delete — rows of other tables/tenants are ignored (async variant: 202 job). */
export const POST = apiRoute(bulkDeleteRowsEndpoint, bulkDeleteRowsHandler)
