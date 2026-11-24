import { apiRoute } from '@/lib/api/route'
import { createAppEndpoint, listAppsEndpoint } from '@/lib/api-schemas/apps'
import { createApp, listApps } from '@/lib/services/apps'

/** GET /api/v1/apps — the apps you can open. */
export const GET = apiRoute(listAppsEndpoint, async ({ ctx, query }) => {
  const apps = await listApps(ctx, { search: query.q ?? null, editable: query.editable === 'true', tag: query.tag ?? null })
  return { apps, total: apps.length }
})

/** POST /api/v1/apps */
export const POST = apiRoute(createAppEndpoint, async ({ ctx, body }) => ({ app: await createApp(ctx, body) }))
