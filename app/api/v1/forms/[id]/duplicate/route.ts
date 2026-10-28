import { apiRoute } from '@/lib/api/route'
import { duplicateFormEndpoint } from '@/lib/api-schemas/forms'
import { duplicateForm } from '@/lib/services/forms'

/** POST /api/v1/forms/{id}/duplicate — copy into a new form (version 1). */
export const POST = apiRoute(duplicateFormEndpoint, async ({ ctx, params, body }) =>
  ({ form: await duplicateForm(ctx, params.id, body.name) }))
