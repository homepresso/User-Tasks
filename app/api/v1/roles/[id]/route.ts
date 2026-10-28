import { apiRoute } from '@/lib/api/route'
import { deleteRoleEndpoint, getRoleEndpoint, updateRoleEndpoint } from '@/lib/api-schemas/governance'
import { deleteRole, getRole, updateRole } from '@/lib/services/roles'

/** GET /api/v1/roles/{id} */
export const GET = apiRoute(getRoleEndpoint, async ({ ctx, params }) => ({ role: await getRole(ctx, params.id) }))

/** PATCH /api/v1/roles/{id} — system roles keep their name. */
export const PATCH = apiRoute(updateRoleEndpoint, async ({ ctx, params, body }) => ({ role: await updateRole(ctx, params.id, body) }))

/** DELETE /api/v1/roles/{id} — custom roles only (409 for system roles). */
export const DELETE = apiRoute(deleteRoleEndpoint, async ({ ctx, params }) => deleteRole(ctx, params.id))
