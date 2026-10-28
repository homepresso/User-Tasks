import { apiRoute } from '@/lib/api/route'
import { deleteEmailTemplateEndpoint, getEmailTemplateEndpoint, updateEmailTemplateEndpoint } from '@/lib/api-schemas/email-templates'
import { deleteEmailTemplate, getEmailTemplate, updateEmailTemplate } from '@/lib/services/email-templates'

/** GET /api/v1/email-templates/{id} — template with subject and bodies. */
export const GET = apiRoute(getEmailTemplateEndpoint, async ({ ctx, params }) =>
  ({ email_template: await getEmailTemplate(ctx, params.id) }))

/** PATCH /api/v1/email-templates/{id} — partial update; is_default: true moves the default here. */
export const PATCH = apiRoute(updateEmailTemplateEndpoint, async ({ ctx, params, body }) =>
  ({ email_template: await updateEmailTemplate(ctx, params.id, body) }))

/** DELETE /api/v1/email-templates/{id} — 409 for the default template. */
export const DELETE = apiRoute(deleteEmailTemplateEndpoint, async ({ ctx, params }) => {
  await deleteEmailTemplate(ctx, params.id)
  return { deleted: true }
})
