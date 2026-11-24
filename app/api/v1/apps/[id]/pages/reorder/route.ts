import { apiRoute } from '@/lib/api/route'
import { reorderAppPagesEndpoint } from '@/lib/api-schemas/apps'
import { reorderPages } from '@/lib/services/apps'

/** POST /api/v1/apps/{id}/pages/reorder */
export const POST = apiRoute(reorderAppPagesEndpoint, async ({ ctx, params, body }) => {
  const pages = await reorderPages(ctx, params.id, body.order)
  return { pages, total: pages.length }
})
