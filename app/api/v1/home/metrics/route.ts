import { apiRoute } from '@/lib/api/route'
import { getHomeMetricsEndpoint } from '@/lib/api-schemas/home'
import { getHomeMetrics } from '@/lib/services/home'

/** GET /api/v1/home/metrics — the Home cards for the calling person. */
export const GET = apiRoute(getHomeMetricsEndpoint, async ({ ctx }) => getHomeMetrics(ctx))
