import { apiRoute } from '@/lib/api/route'
import { formControlUsagesEndpoint } from '@/lib/api-schemas/form-controls'
import { getFormControlUsages } from '@/lib/services/form-controls'

/** GET /api/v1/form-controls/{id}/usages — forms, workflows and open tasks using it. */
export const GET = apiRoute(formControlUsagesEndpoint, async ({ ctx, params }) => {
  const usages = await getFormControlUsages(ctx, params.id)
  return { usages, total: usages.length }
})
