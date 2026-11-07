import { apiRoute } from '@/lib/api/route'
import { removeObjectPermissionEndpoint } from '@/lib/api-schemas/governance'
import { removeObjectPermission } from '@/lib/services/object-permissions'

/** DELETE /api/v1/object-permissions/{id} — remove a grant (audited). */
export const DELETE = apiRoute(removeObjectPermissionEndpoint, async ({ ctx, params }) => removeObjectPermission(ctx, params.id))
