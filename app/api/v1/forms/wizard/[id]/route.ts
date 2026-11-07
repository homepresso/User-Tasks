import { apiRoute } from '@/lib/api/route'
import { getWizardFormEndpoint, updateWizardFormEndpoint } from '@/lib/api-schemas/form-wizard'
import { getWizardProject, updateWizardForm } from '@/lib/services/form-wizard'

/** GET /api/v1/forms/wizard/{id} — a wizard form's spec, manifest and links. */
export const GET = apiRoute(getWizardFormEndpoint, async ({ ctx, params }) =>
  ({ project: await getWizardProject(ctx, params.id) }))

/** PATCH /api/v1/forms/wizard/{id} — apply an edited spec to the objects it made. */
export const PATCH = apiRoute(updateWizardFormEndpoint, async ({ ctx, params, body }) =>
  updateWizardForm(ctx, params.id, body.spec))
