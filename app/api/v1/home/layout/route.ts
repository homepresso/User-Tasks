import { apiRoute } from '@/lib/api/route'
import { getHomeLayoutEndpoint, resetHomeLayoutEndpoint, updateHomeLayoutEndpoint } from '@/lib/api-schemas/home'
import { getHomeLayout, resetHomeLayout, setHomeLayout } from '@/lib/services/home'

/** GET /api/v1/home/layout */
export const GET = apiRoute(getHomeLayoutEndpoint, async ({ ctx }) => getHomeLayout(ctx))

/** PUT /api/v1/home/layout */
export const PUT = apiRoute(updateHomeLayoutEndpoint, async ({ ctx, body }) => setHomeLayout(ctx, body))

/** DELETE /api/v1/home/layout */
export const DELETE = apiRoute(resetHomeLayoutEndpoint, async ({ ctx }) => resetHomeLayout(ctx))
