import { apiRoute } from '@/lib/api/route'
import { searchEntraGroupsEndpoint } from '@/lib/api-schemas/directory-sync'
import { searchDirectoryEntraGroups } from '@/lib/services/directory-groups'

/** GET /api/v1/directory-sync/entra/groups */
export const GET = apiRoute(searchEntraGroupsEndpoint, async ({ ctx, query }) => searchDirectoryEntraGroups(ctx, { search: query.search ?? null, limit: query.limit ?? null, cursor: query.cursor ?? null }))
