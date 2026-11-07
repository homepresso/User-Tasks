import { apiRoute } from '@/lib/api/route'
import { detachOrgUnitEndpoint } from '@/lib/api-schemas/org'
import { detachOrgUnit } from '@/lib/services/org'

/** POST /api/v1/org/units/{id}/detach — an imported unit becomes editable here. */
export const POST = apiRoute(detachOrgUnitEndpoint, async ({ ctx, params }) => detachOrgUnit(ctx, params.id))
