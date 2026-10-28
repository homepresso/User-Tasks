import { apiRoute } from '@/lib/api/route'
import { activateWorkflowEndpoint } from '@/lib/api-schemas/workflows'
import { setWorkflowActive } from '@/lib/services/workflows'

/** POST /api/v1/workflows/{id}/activate */
export const POST = apiRoute(activateWorkflowEndpoint, async ({ ctx, params }) => setWorkflowActive(ctx, params.id, true))
