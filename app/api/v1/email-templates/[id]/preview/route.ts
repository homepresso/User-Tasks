import { apiRoute } from '@/lib/api/route'
import { previewEmailTemplateEndpoint } from '@/lib/api-schemas/email-templates'
import { previewEmailTemplate } from '@/lib/services/email-templates'

/** POST /api/v1/email-templates/{id}/preview — render with sample variables; nothing is sent. */
export const POST = apiRoute(previewEmailTemplateEndpoint, async ({ ctx, params, body }) =>
  previewEmailTemplate(ctx, params.id, body))
