import { apiRoute } from '@/lib/api/route'
import { getOrgChartEndpoint } from '@/lib/api-schemas/org'
import { getOrgChart } from '@/lib/services/org'

/** GET /api/v1/org/chart — every member with manager, attributes and report counts. */
export const GET = apiRoute(getOrgChartEndpoint, async ({ ctx }) => getOrgChart(ctx))
