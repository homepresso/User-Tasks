import { apiRoute } from '@/lib/api/route'
import { listOrgSubordinatesEndpoint } from '@/lib/api-schemas/org'
import { getSubordinates } from '@/lib/services/org'

/** GET /api/v1/org/people/{id}/subordinates — direct or all reports. */
export const GET = apiRoute(listOrgSubordinatesEndpoint, async ({ ctx, params, query }) =>
  getSubordinates(ctx, params.id, { depth: query.depth ?? 'direct', includeSelf: query.include_self === 'true' }))
