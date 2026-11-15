import { apiRoute } from '@/lib/api/route'
import { listDirectorySourceEntriesEndpoint } from '@/lib/api-schemas/directory-sync'
import { resolvePage } from '@/lib/services/_shared'
import { listDirectorySourceEntries } from '@/lib/services/directory-sources'

/** GET /api/v1/directory-sync/sources/{source}/entries */
export const GET = apiRoute(listDirectorySourceEntriesEndpoint, async ({ ctx, params, query }) =>
  listDirectorySourceEntries(ctx, params.source, resolvePage(query), { status: query.status ?? null, search: query.search ?? null }))
