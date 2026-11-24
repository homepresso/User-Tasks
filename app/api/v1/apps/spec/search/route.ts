import { apiRoute } from '@/lib/api/route'
import { searchAppObjectsEndpoint } from '@/lib/api-schemas/apps'
import { searchForBuilder } from '@/lib/services/app-search'

/** GET /api/v1/apps/spec/search — objects to put in an app (what the caller may see). */
export const GET = apiRoute(searchAppObjectsEndpoint, async ({ ctx, query }) => searchForBuilder(ctx, query))
