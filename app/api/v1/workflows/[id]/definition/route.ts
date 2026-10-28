import { apiRoute } from '@/lib/api/route'
import { getWorkflowDefinitionEndpoint } from '@/lib/api-schemas/workflows'
import { getWorkflowDefinition } from '@/lib/services/workflows'

/** GET /api/v1/workflows/:id/definition — the draft in author-payload shape (round-trips through PATCH /workflows/:id). */
export const GET = apiRoute(getWorkflowDefinitionEndpoint, async ({ ctx, params }) => getWorkflowDefinition(ctx, params.id))
