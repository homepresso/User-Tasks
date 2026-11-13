import { instanceAdminRoute } from '@/lib/api/instance-admin-route'
import { grantEntitlementEndpoint, listEntitlementsEndpoint } from '@/lib/api-schemas/licence'
import { grantTenantEntitlement, listTenantEntitlements } from '@/lib/licensing/admin'

/** /api/v1/licence/entitlements — cloud workspace entitlements (instance admin token only). */
export const GET = instanceAdminRoute(listEntitlementsEndpoint, async ({ query }) => {
  return { entitlements: await listTenantEntitlements({ tenantId: query.tenant_id, extensionId: query.extension_id }) }
})

export const PUT = instanceAdminRoute(grantEntitlementEndpoint, async ({ body, ip }) => {
  return { entitlement: await grantTenantEntitlement(body, { actor: `api (${ip})` }) }
})
