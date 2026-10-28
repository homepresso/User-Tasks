import { apiRoute } from '@/lib/api/route'
import { listWorkflowVersionsEndpoint } from '@/lib/api-schemas/workflows'
import { resolvePage } from '@/lib/services/_shared'
import { listWorkflowVersions } from '@/lib/services/workflows'

/** GET /api/v1/workflows/{id}/versions — published snapshots, newest first. */
export const GET = apiRoute(listWorkflowVersionsEndpoint, async ({ ctx, params, query }) =>
  listWorkflowVersions(ctx, params.id, resolvePage(query)))
