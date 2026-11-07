import { apiRoute } from '@/lib/api/route'
import { addOrgUnitMemberEndpoint, removeOrgUnitMemberEndpoint } from '@/lib/api-schemas/org'
import { addOrgUnitMember, removeOrgUnitMember } from '@/lib/services/org'

/** PUT /api/v1/org/units/{id}/members/{userId} — add or update (idempotent). */
export const PUT = apiRoute(addOrgUnitMemberEndpoint, async ({ ctx, params, body }) =>
  addOrgUnitMember(ctx, params.id, params.userId, { role: body.role, is_primary: body.is_primary }))

/** DELETE /api/v1/org/units/{id}/members/{userId} */
export const DELETE = apiRoute(removeOrgUnitMemberEndpoint, async ({ ctx, params }) => removeOrgUnitMember(ctx, params.id, params.userId))
