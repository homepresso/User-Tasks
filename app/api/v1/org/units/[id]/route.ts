import { apiRoute } from '@/lib/api/route'
import { deleteOrgUnitEndpoint, getOrgUnitEndpoint, updateOrgUnitEndpoint } from '@/lib/api-schemas/org'
import { deleteOrgUnit, getOrgUnit, updateOrgUnit } from '@/lib/services/org'

/** GET /api/v1/org/units/{id} — path, children, members, teams and projects. */
export const GET = apiRoute(getOrgUnitEndpoint, async ({ ctx, params }) => getOrgUnit(ctx, params.id))

/** PATCH /api/v1/org/units/{id} */
export const PATCH = apiRoute(updateOrgUnitEndpoint, async ({ ctx, params, body }) => ({ unit: await updateOrgUnit(ctx, params.id, body) }))

/** DELETE /api/v1/org/units/{id} — sub-units move up to its parent. */
export const DELETE = apiRoute(deleteOrgUnitEndpoint, async ({ ctx, params }) => deleteOrgUnit(ctx, params.id))
