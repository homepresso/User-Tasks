import { apiRoute } from '@/lib/api/route'
import { createAppPageEndpoint, listAppPagesEndpoint } from '@/lib/api-schemas/apps'
import { createPage, listPages } from '@/lib/services/apps'

/** GET /api/v1/apps/{id}/pages */
export const GET = apiRoute(listAppPagesEndpoint, async ({ ctx, params, query }) => {
  const pages = await listPages(ctx, params.id, { version: query.version ?? null })
  return { pages, total: pages.length }
})

/** POST /api/v1/apps/{id}/pages */
export const POST = apiRoute(createAppPageEndpoint, async ({ ctx, params, body }) => ({ page: await createPage(ctx, params.id, body) }))
