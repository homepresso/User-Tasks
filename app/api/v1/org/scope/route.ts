import { apiRoute } from '@/lib/api/route'
import { resolveOrgScopeEndpoint } from '@/lib/api-schemas/org'
import { resolvePeopleScope } from '@/lib/services/org'
import { scopeFromQuery } from '@/lib/api/org-route-helpers'

/** GET /api/v1/org/scope — the people a scope covers. */
export const GET = apiRoute(resolveOrgScopeEndpoint, async ({ ctx, query }) => resolvePeopleScope(ctx, scopeFromQuery(query)))
