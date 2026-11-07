import { apiRoute } from '@/lib/api/route'
import { queryFormDataTableEndpoint } from '@/lib/api-schemas/forms'
import { queryDataTable } from '@/lib/services/form-data-table'

/** POST /api/v1/forms/{id}/data-table — rows of a Data table field of a reusable form. */
export const POST = apiRoute(queryFormDataTableEndpoint, async ({ ctx, params, body }) =>
  queryDataTable(ctx, { form_id: params.id }, body))
