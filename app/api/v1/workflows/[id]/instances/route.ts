import { apiRoute } from '@/lib/api/route'
import { listWorkflowInstancesEndpoint } from '@/lib/api-schemas/workflows'
import { listLiveInstances } from '@/lib/services/workflow-runs'

/** GET /api/v1/workflows/{id}/instances — live (waiting / paused) runs with current node, version and open task. */
export const GET = apiRoute(listWorkflowInstancesEndpoint, async ({ ctx, params, query }) =>
  listLiveInstances(ctx, params.id, { status: query.status, versionId: query.version_id, limit: query.limit, offset: query.offset }))
