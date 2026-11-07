import { apiRoute } from '@/lib/api/route'
import { checkFormSystemNameEndpoint } from '@/lib/api-schemas/forms'
import { checkFormSystemName } from '@/lib/services/form-links'

/** GET /api/v1/forms/system-name-check?system_name=…&form_id=… */
export const GET = apiRoute(checkFormSystemNameEndpoint, async ({ ctx, query }) => checkFormSystemName(ctx, query.form_id ?? null, query.system_name))
