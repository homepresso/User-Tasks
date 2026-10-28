import { apiRoute } from '@/lib/api/route'
import { bulkDeleteReferencesEndpoint } from '@/lib/api-schemas/integrations'
import { bulkDeleteReferencesHandler } from '@/lib/user-jobs/kinds/api'

/** POST /api/v1/references/bulk-delete — delete the given references in this workspace (async variant: 202 job). */
export const POST = apiRoute(bulkDeleteReferencesEndpoint, bulkDeleteReferencesHandler)
