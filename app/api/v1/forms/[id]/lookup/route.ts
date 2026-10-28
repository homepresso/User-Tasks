import { apiRoute } from '@/lib/api/route'
import { lookupFormFieldEndpoint } from '@/lib/api-schemas/forms'
import { lookupFormField } from '@/lib/services/form-lookup'

/** POST /api/v1/forms/{id}/lookup — suggestions for a lookup field of a reusable form. */
export const POST = apiRoute(lookupFormFieldEndpoint, async ({ ctx, params, body }) =>
  lookupFormField(ctx, params.id, body))
