import { apiRoute } from '@/lib/api/route'
import { getTaskTimelineEndpoint } from '@/lib/api-schemas/timeline'
import { getTaskTimeline } from '@/lib/services/run-timeline'

/** GET /api/v1/tasks/{id}/timeline — the task's run as a timeline, else the task's own history (lib/services/run-timeline). */
export const GET = apiRoute(getTaskTimelineEndpoint, async ({ ctx, params }) => ({ timeline: await getTaskTimeline(ctx, params.id) }))
