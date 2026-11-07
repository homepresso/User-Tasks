import { apiRoute } from '@/lib/api/route'
import { deleteFormControlEndpoint, getFormControlEndpoint, updateFormControlEndpoint } from '@/lib/api-schemas/form-controls'
import { deleteFormControl, getFormControl, updateFormControl } from '@/lib/services/form-controls'

/** GET /api/v1/form-controls/{id} — a control (id or tag) with its versions. */
export const GET = apiRoute(getFormControlEndpoint, async ({ ctx, params }) => ({ form_control: await getFormControl(ctx, params.id) }))

/** PATCH /api/v1/form-controls/{id} — enable / disable, rename, approve hosts (trusted: UI, instance admins only). */
export const PATCH = apiRoute(updateFormControlEndpoint, async ({ ctx, params, body }) => ({ form_control: await updateFormControl(ctx, params.id, body) }))

/** DELETE /api/v1/form-controls/{id}[?only_version=] — refused while in use. */
export const DELETE = apiRoute(deleteFormControlEndpoint, async ({ ctx, params, query }) => {
  await deleteFormControl(ctx, params.id, { version: query.only_version ?? null })
  return { deleted: true }
})
