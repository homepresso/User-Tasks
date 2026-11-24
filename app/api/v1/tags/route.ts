import { apiRoute } from '@/lib/api/route'
import { listTagsEndpoint } from '@/lib/api-schemas/tags'
import { listTags } from '@/lib/services/tags'

/** GET /api/v1/tags — tags in use with colours, descriptions and usage. */
export const GET = apiRoute(listTagsEndpoint, async ({ ctx, query }) => {
  const result = await listTags(ctx, { q: query.q ?? null })
  return { ...result, total: result.tags.length }
})
