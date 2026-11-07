import { apiRoute } from '@/lib/api/route'
import { getWizardResultsEndpoint } from '@/lib/api-schemas/form-wizard'
import { getWizardResults } from '@/lib/services/form-wizard'

/** GET /api/v1/forms/wizard/{id}/results — summary, charts and a page of responses. */
export const GET = apiRoute(getWizardResultsEndpoint, async ({ ctx, params, query }) =>
  getWizardResults(ctx, params.id, query))
