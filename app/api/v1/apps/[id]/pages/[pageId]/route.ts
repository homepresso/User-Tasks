import { apiRoute } from '@/lib/api/route'
import { deleteAppPageEndpoint, getAppPageEndpoint, updateAppPageEndpoint } from '@/lib/api-schemas/apps'
import { deletePage, getPage, updatePage } from '@/lib/services/apps'

/** GET /api/v1/apps/{id}/pages/{pageId} */
export const GET = apiRoute(getAppPageEndpoint, async ({ ctx, params, query }) => ({ page: await getPage(ctx, params.id, params.pageId, { version: query.version ?? null }) }))

/** PATCH /api/v1/apps/{id}/pages/{pageId} */
export const PATCH = apiRoute(updateAppPageEndpoint, async ({ ctx, params, body }) => ({ page: await updatePage(ctx, params.id, params.pageId, body) }))

/** DELETE /api/v1/apps/{id}/pages/{pageId} */
export const DELETE = apiRoute(deleteAppPageEndpoint, async ({ ctx, params }) => deletePage(ctx, params.id, params.pageId))
