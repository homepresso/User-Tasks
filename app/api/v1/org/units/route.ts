import { apiRoute } from '@/lib/api/route'
import { createOrgUnitEndpoint, listOrgUnitsEndpoint } from '@/lib/api-schemas/org'
import { createOrgUnit, getOrgUnitTree } from '@/lib/services/org'

/** GET /api/v1/org/units — every org unit with headcounts. */
export const GET = apiRoute(listOrgUnitsEndpoint, async ({ ctx }) => getOrgUnitTree(ctx))

/** POST /api/v1/org/units */
export const POST = apiRoute(createOrgUnitEndpoint, async ({ ctx, body }) => ({ unit: await createOrgUnit(ctx, body) }))
