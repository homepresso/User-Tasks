import { instanceAdminRoute } from '@/lib/api/instance-admin-route'
import { revokeEntitlementEndpoint } from '@/lib/api-schemas/licence'
import { revokeTenantEntitlement } from '@/lib/licensing/admin'

/** DELETE /api/v1/licence/entitlements/{tenant_id}/{extension_id} (instance admin token only). */
export const DELETE = instanceAdminRoute(revokeEntitlementEndpoint, async ({ params, ip }) => {
  return revokeTenantEntitlement(params.tenant_id, params.extension_id, { actor: `api (${ip})` })
})
