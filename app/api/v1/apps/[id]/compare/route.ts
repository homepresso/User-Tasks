import { apiRoute } from '@/lib/api/route'
import { compareAppVersionsEndpoint } from '@/lib/api-schemas/apps'
import { compareAppVersions } from '@/lib/services/app-versions'

/** GET /api/v1/apps/{id}/compare?from=published&to=draft — what changes between two versions. */
export const GET = apiRoute(compareAppVersionsEndpoint, async ({ ctx, params, query }) => compareAppVersions(ctx, params.id, { from: query.from, to: query.to }))
