import { apiRoute } from '@/lib/api/route'
import { createFormEndpoint, listFormsEndpoint } from '@/lib/api-schemas/forms'
import { resolvePage } from '@/lib/services/_shared'
import { createForm, listForms } from '@/lib/services/forms'

/** GET /api/v1/forms — list reusable forms (summaries with field and usage counts). */
export const GET = apiRoute(listFormsEndpoint, async ({ ctx, query }) =>
  listForms(ctx, { search: query.search, tag: query.tag }, resolvePage(query)))

/** POST /api/v1/forms — create a form (version 1). */
export const POST = apiRoute(createFormEndpoint, async ({ ctx, body }) =>
  ({ form: await createForm(ctx, body) }))
