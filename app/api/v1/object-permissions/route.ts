import { apiRoute } from '@/lib/api/route'
import { listObjectPermissionsEndpoint, setObjectPermissionEndpoint } from '@/lib/api-schemas/governance'
import { listObjectPermissions, setObjectPermission } from '@/lib/services/object-permissions'

/** GET /api/v1/object-permissions?object_type=&object_id= — the grants on one object. */
export const GET = apiRoute(listObjectPermissionsEndpoint, async ({ ctx, query }) => {
  const permissions = await listObjectPermissions(ctx, query.object_type, query.object_id)
  return { permissions, total: permissions.length }
})

/** POST /api/v1/object-permissions — add or change one grantee's grant (audited). */
export const POST = apiRoute(setObjectPermissionEndpoint, async ({ ctx, body }) =>
  ({ permission: await setObjectPermission(ctx, body) }))
