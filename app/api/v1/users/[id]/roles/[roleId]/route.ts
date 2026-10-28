import { apiRoute } from '@/lib/api/route'
import { assignUserRoleEndpoint, removeUserRoleEndpoint } from '@/lib/api-schemas/governance'
import { assignRole, removeUserRole } from '@/lib/services/roles'

/** PUT /api/v1/users/{id}/roles/{roleId} — idempotent assignment. */
export const PUT = apiRoute(assignUserRoleEndpoint, async ({ ctx, params }) => assignRole(ctx, params.id, params.roleId))

/** DELETE /api/v1/users/{id}/roles/{roleId} */
export const DELETE = apiRoute(removeUserRoleEndpoint, async ({ ctx, params }) => removeUserRole(ctx, params.id, params.roleId))
