import { apiRoute } from '@/lib/api/route'
import { deleteAppEndpoint, getAppEndpoint, updateAppEndpoint } from '@/lib/api-schemas/apps'
import { deleteApp, getApp, updateApp } from '@/lib/services/apps'

/** GET /api/v1/apps/{id} */
export const GET = apiRoute(getAppEndpoint, async ({ ctx, params, query }) => ({ app: await getApp(ctx, params.id, { version: query.version ?? null }) }))

/** PATCH /api/v1/apps/{id} */
export const PATCH = apiRoute(updateAppEndpoint, async ({ ctx, params, body }) => ({ app: await updateApp(ctx, params.id, body) }))

/** DELETE /api/v1/apps/{id} */
export const DELETE = apiRoute(deleteAppEndpoint, async ({ ctx, params }) => deleteApp(ctx, params.id))
