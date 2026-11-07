import { apiRoute } from '@/lib/api/route'
import { getHomeStatsEndpoint } from '@/lib/api-schemas/home'
import { getHomeActivityStats } from '@/lib/services/home-stats'

/** GET /api/v1/home/stats — the Home "My activity" charts for the calling person. */
export const GET = apiRoute(getHomeStatsEndpoint, async ({ ctx, query }) =>
  getHomeActivityStats(ctx, { period: query.period, timezone: query.timezone }))
