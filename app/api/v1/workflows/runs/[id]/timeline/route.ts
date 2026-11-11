import { apiRoute } from '@/lib/api/route'
import { getRunTimelineEndpoint } from '@/lib/api-schemas/timeline'
import { getRunTimeline } from '@/lib/services/run-timeline'

/** GET /api/v1/workflows/runs/{id}/timeline — the run as a readable timeline (lib/services/run-timeline). */
export const GET = apiRoute(getRunTimelineEndpoint, async ({ ctx, params }) => ({ timeline: await getRunTimeline(ctx, params.id) }))
