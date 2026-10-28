import { apiRoute } from '@/lib/api/route'
import { deactivateWorkflowEndpoint } from '@/lib/api-schemas/workflows'
import { setWorkflowActive } from '@/lib/services/workflows'

/** POST /api/v1/workflows/{id}/deactivate */
export const POST = apiRoute(deactivateWorkflowEndpoint, async ({ ctx, params }) => setWorkflowActive(ctx, params.id, false))
