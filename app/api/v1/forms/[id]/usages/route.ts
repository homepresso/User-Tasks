import { apiRoute } from '@/lib/api/route'
import { listFormUsagesEndpoint } from '@/lib/api-schemas/forms'
import { getFormUsages } from '@/lib/services/forms'

/** GET /api/v1/forms/{id}/usages — workflow steps and start forms linking the form. */
export const GET = apiRoute(listFormUsagesEndpoint, async ({ ctx, params }) =>
  ({ usages: await getFormUsages(ctx, params.id) }))
