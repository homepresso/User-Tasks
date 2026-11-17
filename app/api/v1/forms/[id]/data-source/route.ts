import { apiRoute } from '@/lib/api/route'
import { describeFormDataSourceEndpoint } from '@/lib/api-schemas/forms'
import { describeSavedFormSource } from '@/lib/services/form-sources'

/** POST /api/v1/forms/{id}/data-source — the form's data source (data binding): its fields and the mapping (or of an unsaved definition). */
export const POST = apiRoute(describeFormDataSourceEndpoint, async ({ ctx, params, body }) =>
  describeSavedFormSource(ctx, params.id, { definition: body?.definition ?? null }))
