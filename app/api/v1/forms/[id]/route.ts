import { apiRoute } from '@/lib/api/route'
import { deleteFormEndpoint, getFormEndpoint, updateFormEndpoint } from '@/lib/api-schemas/forms'
import { deleteForm, getForm, updateForm } from '@/lib/services/forms'

/** GET /api/v1/forms/{id} — form with fields, layout, theme and usages. */
export const GET = apiRoute(getFormEndpoint, async ({ ctx, params }) =>
  ({ form: await getForm(ctx, params.id) }))

/** PATCH /api/v1/forms/{id} — partial update; a content change bumps the version. */
export const PATCH = apiRoute(updateFormEndpoint, async ({ ctx, params, body }) =>
  ({ form: await updateForm(ctx, params.id, body) }))

/** DELETE /api/v1/forms/{id} — 409 with the usages while a workflow uses the form. */
export const DELETE = apiRoute(deleteFormEndpoint, async ({ ctx, params }) => deleteForm(ctx, params.id))
