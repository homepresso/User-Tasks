import { apiRoute } from '@/lib/api/route'
import { publishWorkflowEndpoint } from '@/lib/api-schemas/workflows'
import { publishWorkflow } from '@/lib/services/workflows'

/** POST /api/v1/workflows/:id/publish — snapshot the draft as the next active version. */
export const POST = apiRoute(publishWorkflowEndpoint, async ({ ctx, params, body }) => publishWorkflow(ctx, params.id, body.notes))
