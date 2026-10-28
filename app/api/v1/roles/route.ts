import { apiRoute } from '@/lib/api/route'
import { createRoleEndpoint, listRolesEndpoint } from '@/lib/api-schemas/governance'
import { createRole, listRoles } from '@/lib/services/roles'

/** GET /api/v1/roles — system and custom roles. */
export const GET = apiRoute(listRolesEndpoint, async ({ ctx }) => listRoles(ctx))

/** POST /api/v1/roles — create a custom role. */
export const POST = apiRoute(createRoleEndpoint, async ({ ctx, body }) => ({ role: await createRole(ctx, body) }))
