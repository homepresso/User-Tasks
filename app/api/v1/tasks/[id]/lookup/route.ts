import { apiRoute } from '@/lib/api/route'
import { lookupTaskEndpoint } from '@/lib/api-schemas/tasks'
import { lookupTaskField } from '@/lib/services/form-lookup'

/** POST /api/v1/tasks/{id}/lookup — suggestions for a lookup field of the task's form. */
export const POST = apiRoute(lookupTaskEndpoint, async ({ ctx, params, body }) =>
  lookupTaskField(ctx, params.id, body))
