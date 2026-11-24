import { apiRoute } from '@/lib/api/route'
import { getTagSettingsEndpoint, updateTagSettingsEndpoint } from '@/lib/api-schemas/tags'
import { listTagStyles, updateTagSettings } from '@/lib/services/tags'

/** GET /api/v1/tags/settings */
export const GET = apiRoute(getTagSettingsEndpoint, async ({ ctx }) => (await listTagStyles(ctx)).settings)

/** PATCH /api/v1/tags/settings */
export const PATCH = apiRoute(updateTagSettingsEndpoint, async ({ ctx, body }) => updateTagSettings(ctx, body))
