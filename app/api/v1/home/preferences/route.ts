import { apiRoute } from '@/lib/api/route'
import { getHomePreferencesEndpoint, updateHomePreferencesEndpoint } from '@/lib/api-schemas/home'
import { getHomePreferences, setHomePreferences } from '@/lib/services/home'

/** GET /api/v1/home/preferences */
export const GET = apiRoute(getHomePreferencesEndpoint, async ({ ctx }) => ({ preferences: await getHomePreferences(ctx) }))

/** PATCH /api/v1/home/preferences */
export const PATCH = apiRoute(updateHomePreferencesEndpoint, async ({ ctx, body }) => ({ preferences: await setHomePreferences(ctx, body ?? {}) }))
