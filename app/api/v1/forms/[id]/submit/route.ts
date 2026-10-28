import { apiRoute } from '@/lib/api/route'
import { submitFormEndpoint } from '@/lib/api-schemas/forms'
import { submitForm } from '@/lib/services/form-submissions'

/** POST /api/v1/forms/{id}/submit — submit a reusable form (validated; button actions run). */
export const POST = apiRoute(submitFormEndpoint, async ({ ctx, params, body }) =>
  submitForm(ctx, params.id, body, { source: 'api' }))
