import { apiRoute } from '@/lib/api/route'
import { getQuerySettingsEndpoint, updateQuerySettingsEndpoint } from '@/lib/api-schemas/query-settings'
import { getQueryStatus, updateQuerySettings } from '@/lib/services/query-settings'

/** GET /api/v1/settings/query — settings, effective mode per service, rollup coverage, read times. */
export const GET = apiRoute(getQuerySettingsEndpoint, async ({ ctx }) => getQueryStatus(ctx))

/** PATCH /api/v1/settings/query — change some settings (settings.edit; audited). */
export const PATCH = apiRoute(updateQuerySettingsEndpoint, async ({ ctx, body }) => updateQuerySettings(ctx, body as Record<string, unknown>))
