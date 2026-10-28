import { apiRoute } from '@/lib/api/route'
import { listFormSubmissionsEndpoint } from '@/lib/api-schemas/forms'
import { resolvePage } from '@/lib/services/_shared'
import { listFormSubmissions } from '@/lib/services/form-submissions'

/** GET /api/v1/forms/{id}/submissions — a form's submissions (own; all with forms.edit). */
export const GET = apiRoute(listFormSubmissionsEndpoint, async ({ ctx, params, query }) =>
  listFormSubmissions(ctx, { form_id: params.id, submitted_by: query.submitted_by, button_id: query.button_id, source: query.source, since: query.since, until: query.until }, resolvePage(query)))
