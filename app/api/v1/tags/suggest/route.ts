import { apiRoute } from '@/lib/api/route'
import { suggestTagsEndpoint } from '@/lib/api-schemas/tags'
import { suggestTags } from '@/lib/services/tags'

/** GET /api/v1/tags/suggest — autocomplete. */
export const GET = apiRoute(suggestTagsEndpoint, async ({ ctx, query }) => suggestTags(ctx, { q: query.q ?? null, limit: query.limit ?? 10 }))
