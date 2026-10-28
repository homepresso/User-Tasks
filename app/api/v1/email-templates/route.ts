import { apiRoute } from '@/lib/api/route'
import { createEmailTemplateEndpoint, listEmailTemplatesEndpoint } from '@/lib/api-schemas/email-templates'
import { resolvePage } from '@/lib/services/_shared'
import { createEmailTemplate, listEmailTemplates } from '@/lib/services/email-templates'

/** GET /api/v1/email-templates — list templates (no bodies). */
export const GET = apiRoute(listEmailTemplatesEndpoint, async ({ ctx, query }) =>
  listEmailTemplates(ctx, { search: query.search }, resolvePage(query)))

/** POST /api/v1/email-templates — create a template (HTML sanitised). */
export const POST = apiRoute(createEmailTemplateEndpoint, async ({ ctx, body }) =>
  ({ email_template: await createEmailTemplate(ctx, body) }))
