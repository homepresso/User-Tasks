import { apiRoute } from '@/lib/api/route'
import { listEventsEndpoint } from '@/lib/api-schemas/events'
import { listEvents, splitList } from '@/lib/services/events'

/** GET /api/v1/events */
export const GET = apiRoute(listEventsEndpoint, async ({ ctx, query }) => listEvents(ctx, {
  categories: splitList(query.category),
  types: splitList(query.type),
  min_severity: query.severity,
  workflow_id: query.workflow_id,
  run_id: query.run_id,
  task_id: query.task_id,
  trace_id: query.trace_id,
  after: query.after,
  since: query.since,
  until: query.until,
  limit: query.limit,
}))
