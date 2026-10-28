import { apiRoute } from '@/lib/api/route'
import { getFormSubmissionEndpoint } from '@/lib/api-schemas/forms'
import { getFormSubmission } from '@/lib/services/form-submissions'

/** GET /api/v1/form-submissions/{id} — one submission. */
export const GET = apiRoute(getFormSubmissionEndpoint, async ({ ctx, params }) =>
  ({ submission: await getFormSubmission(ctx, params.id) }))
